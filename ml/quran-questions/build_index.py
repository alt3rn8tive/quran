"""Build an Arabic-only E5 retrieval bundle from the bundled Quran text."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import unicodedata
from urllib.request import urlretrieve

import numpy as np
import onnx
from onnx import numpy_helper
import onnxruntime
from transformers import AutoTokenizer


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
RUNTIME = REPO / "models/runtime/04bc735bf80374db/vendor"
REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78"
UPSTREAM = "Xenova/multilingual-e5-small"
INPUT_FILES = {
    "config.json": "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1",
    "tokenizer.json": "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
    "tokenizer_config.json": "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
    "special_tokens_map.json": "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7",
    "onnx/model_quantized.onnx": "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value, indent=None):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=indent) + "\n")


def normalize(text):
    text = unicodedata.normalize("NFKC", text).replace("ٱ", "ا").replace("ـ", "")
    text = re.sub(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]", "", text)
    text = text.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789"))
    return " ".join(
        re.findall(r"[\u0621-\u063a\u0641-\u064a\u0671-\u06d3\u06fa-\u06ff0-9]+", text)
    )


def load_corpus():
    return json.loads(
        subprocess.check_output(
            [
                "node",
                "-e",
                "const fs = require('node:fs'), vm = require('node:vm');"
                "const data = vm.runInNewContext(fs.readFileSync(process.argv[1], 'utf8') + '\\nall_ayat');"
                "process.stdout.write(JSON.stringify(data.map(a => [a.sura_id + ':' + a.verse_id, a.text])));",
                str(REPO / "js/data.js"),
            ],
            text=True,
        )
    )


def source_files(cache):
    cache.mkdir(parents=True, exist_ok=True)
    assets = {}
    for remote, expected in INPUT_FILES.items():
        local = cache / Path(remote).name
        if not local.exists():
            urlretrieve(
                f"https://huggingface.co/{UPSTREAM}/resolve/{REVISION}/{remote}", local
            )
        if sha(local) != expected:
            raise ValueError(f"Unexpected upstream hash: {remote}")
        assets[remote] = local
    return assets


def create_arabic_model(assets, original_tokenizer, texts, output):
    # E5's multilingual vocabulary dominates its size. Preserve the tokenization of
    # the entire verse corpus and keep every Arabic/digit piece for new questions.
    tokenizer_spec = json.loads(assets["tokenizer.json"].read_text())
    model_spec = tokenizer_spec["model"]
    assert model_spec["type"] == "Unigram"
    old_vocab = model_spec["vocab"]
    required = set(original_tokenizer("query:").input_ids)
    required.update(original_tokenizer("passage:").input_ids)
    required.update(t["id"] for t in tokenizer_spec["added_tokens"])
    for start in range(0, len(texts), 200):
        for tokens in original_tokenizer(
            texts[start : start + 200], verbose=False
        ).input_ids:
            required.update(tokens)
    arabic_piece = re.compile(r"[▁\u0600-\u06ff0-9]+")
    retained = [
        i
        for i, (token, _) in enumerate(old_vocab)
        if i in required or arabic_piece.fullmatch(token)
    ]
    new_ids = {old: new for new, old in enumerate(retained)}
    model_spec["vocab"] = [old_vocab[i] for i in retained]
    model_spec["unk_id"] = new_ids[model_spec["unk_id"]]
    for token in tokenizer_spec["added_tokens"]:
        token["id"] = new_ids[token["id"]]
    for token in tokenizer_spec["post_processor"]["special_tokens"].values():
        token["ids"] = [new_ids[i] for i in token["ids"]]
    write_json(output / "tokenizer.json", tokenizer_spec)
    for name in ["tokenizer_config.json", "special_tokens_map.json"]:
        shutil.copyfile(assets[name], output / name)

    config = json.loads(assets["config.json"].read_text())
    config["vocab_size"] = len(retained)
    config["pad_token_id"] = new_ids[config["pad_token_id"]]
    write_json(output / "config.json", config)

    model = onnx.load(assets["onnx/model_quantized.onnx"])
    weights = next(
        a
        for a in model.graph.initializer
        if a.name == "embeddings.word_embeddings.weight_quantized"
    )
    weights.CopyFrom(
        numpy_helper.from_array(numpy_helper.to_array(weights)[retained], weights.name)
    )
    model.graph.doc_string = (
        "Arabic vocabulary subset of Xenova/multilingual-e5-small q8"
    )
    model_path = output / "onnx/model_quantized.onnx"
    model_path.parent.mkdir(exist_ok=True)
    onnx.checker.check_model(model)
    onnx.save(model, model_path)
    return retained


def session(path):
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    return onnxruntime.InferenceSession(
        str(path), options, providers=["CPUExecutionProvider"]
    )


def encode(model, tokenizer, texts):
    inputs = tokenizer(texts, padding=True, truncation=False, return_tensors="np")
    if inputs["input_ids"].shape[1] > 512:
        raise ValueError("Input would exceed the 512 token model context")
    inputs["token_type_ids"] = np.zeros_like(inputs["input_ids"])
    outputs = model.run(["last_hidden_state"], dict(inputs))[0]
    mask = inputs["attention_mask"].astype(np.float32)[:, :, None]
    pooled = (outputs * mask).sum(axis=1) / mask.sum(axis=1)
    return pooled / np.linalg.norm(pooled, axis=1, keepdims=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    assets = source_files(args.cache)
    corpus = load_corpus()
    assert len(corpus) == len({ref for ref, _ in corpus}) == 6236
    passages = ["passage: " + normalize(text) for _, text in corpus]
    tests = json.loads((HERE / "benchmark.json").read_text())
    corpus_refs = {ref for ref, _ in corpus}
    if any(
        not case["refs"] or not corpus_refs.issuperset(case["refs"]) for case in tests
    ):
        raise ValueError("Invalid benchmark evidence references")
    query_texts = ["query: " + normalize(case["question"]) for case in tests]
    texts = passages + query_texts
    assert all(normalize(text) for _, text in corpus)
    args.output.mkdir(parents=True, exist_ok=True)
    old_tokenizer = AutoTokenizer.from_pretrained(args.cache, local_files_only=True)
    retained = create_arabic_model(assets, old_tokenizer, texts, args.output)
    tokenizer = AutoTokenizer.from_pretrained(args.output, local_files_only=True)

    lengths = []
    for start in range(0, len(texts), 200):
        batch = texts[start : start + 200]
        full_tokens = old_tokenizer(batch, verbose=False).input_ids
        subset_tokens = tokenizer(batch, verbose=False).input_ids
        for original, current in zip(full_tokens, subset_tokens):
            if original != [retained[i] for i in current]:
                raise ValueError(f"Original and Arabic tokenizer disagree: {batch}")
            lengths.append(len(current))
    print(
        f"Arabic vocabulary: {len(retained):,} tokens. Token parity: {len(texts):,} texts. Max verse length: {max(lengths)}.",
        flush=True,
    )

    model = session(args.output / "onnx/model_quantized.onnx")
    upstream = session(assets["onnx/model_quantized.onnx"])
    parity_probes = query_texts + [passages[i] for i in (0, 288, 2000, 4000, 6235)]
    upstream_vectors = encode(upstream, old_tokenizer, parity_probes)
    subset_vectors = encode(model, tokenizer, parity_probes)
    delta = float(np.max(np.abs(upstream_vectors - subset_vectors)))
    if delta > 1e-5:
        raise ValueError(
            f"Arabic model differs from upstream on parity probes: {delta}"
        )
    del upstream
    print(f"Maximum upstream-vs-Arabic embedding difference: {delta:.8g}.", flush=True)

    embeddings = np.empty((len(corpus), 384), dtype=np.float32)
    ordered = sorted(range(len(corpus)), key=lambda index: lengths[index])
    for start in range(0, len(corpus), 24):
        indices = ordered[start : start + 24]
        embeddings[indices] = encode(
            model, tokenizer, [passages[index] for index in indices]
        )
        if start % 480 == 0:
            print(f"Indexed {start + len(indices):,}/{len(corpus):,}", flush=True)
    refs = [ref for ref, _ in corpus]
    write_json(args.output / "refs.json", refs)
    quantized = np.rint(embeddings * 32767).astype("<i2")
    quantized.tofile(args.output / "vectors.i16")
    # Rank exactly as the worker does after loading the int16 verse index.
    scores = (subset_vectors[: len(tests)] @ quantized.astype(np.float32).T) / 32767
    report = []
    for case, row in zip(tests, scores):
        top = np.argsort(-row, kind="stable")[:12]
        report.append(
            {
                **case,
                "top12": [refs[i] for i in top],
                "expectedInTop12": any(refs[i] in case["refs"] for i in top),
            }
        )
    write_json(
        args.output / "benchmark-report.json",
        {
            "tokenParity": len(texts),
            "embeddingParityProbes": len(parity_probes),
            "embeddingParityMaxAbsoluteDifference": delta,
            "maxVerseTokens": max(lengths[: len(corpus)]),
            "arabicVocabulary": len(retained),
            "quranAyat": len(corpus),
            "expectedInTop12": sum(r["expectedInTop12"] for r in report),
            "questions": report,
        },
        indent=2,
    )

    bundle(args.output, len(corpus), embeddings.shape[1])


def bundle(output, count, dimensions):
    for name in ["worker.js", "MODEL-NOTICE.md", "LICENSE-MIT.txt"]:
        shutil.copyfile(HERE / name, output / name)
    files = {
        str(path.relative_to(output)): {
            "bytes": path.stat().st_size,
            "sha256": sha(path),
        }
        for path in sorted(output.rglob("*"))
        if path.is_file() and path.name != "manifest.json"
    }
    runtime_bytes = sum(
        (RUNTIME / name).stat().st_size
        for name in [
            "transformers.js",
            "ort-wasm-simd-threaded.jsep.wasm",
            "ort-wasm-simd-threaded.jsep.mjs",
        ]
    )
    write_json(
        output / "manifest.json",
        {
            "version": 1,
            "count": count,
            "dimensions": dimensions,
            "worker": "worker.js",
            "quranSourceSha256": sha(REPO / "js/data.js"),
            "totalBytes": sum(f["bytes"] for f in files.values()) + runtime_bytes,
            "runtimeBytes": runtime_bytes,
            "modelRevision": REVISION,
            "files": files,
        },
        indent=2,
    )


if __name__ == "__main__":
    main()
