"""Export BERT classification to int8 ONNX and check dynamic-shape inference parity."""

import argparse, hashlib, json, shutil, subprocess
from pathlib import Path
import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic
from common import refresh_manifest

ROOT = Path(__file__).resolve().parent


class Logits(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids, attention_mask, token_type_ids):
        return self.model(
            input_ids=input_ids,
            attention_mask=attention_mask,
            token_type_ids=token_type_ids,
        ).logits


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    torch.set_num_threads(4)
    a.output.mkdir(parents=True, exist_ok=True)
    onnx_dir = a.output / "onnx"
    onnx_dir.mkdir(exist_ok=True)
    report = json.loads((a.checkpoint / "training-report.json").read_text())
    spec = json.loads((ROOT / "model.json").read_text())
    model = AutoModelForSequenceClassification.from_pretrained(
        a.checkpoint, attn_implementation="eager"
    ).eval()
    tokenizer = AutoTokenizer.from_pretrained(a.checkpoint)
    model.config.save_pretrained(a.output)
    tokenizer.save_pretrained(a.output)
    inputs = tokenizer("ابحث عن «عبارة»", return_tensors="pt")
    names = ["input_ids", "attention_mask", "token_type_ids"]
    # The wrapper must also be eval: ONNX export restores its training flag recursively.
    wrapper = Logits(model).eval()
    float_path = onnx_dir / "model.onnx"
    quantized = onnx_dir / "model_quantized.onnx"
    torch.onnx.export(
        wrapper,
        tuple(inputs[name] for name in names),
        str(float_path),
        input_names=names,
        output_names=["logits"],
        dynamic_axes={
            **{name: {0: "batch", 1: "sequence"} for name in names},
            "logits": {0: "batch"},
        },
        opset_version=17,
        dynamo=False,
    )
    # Include Gather weights: otherwise BERT's embedding table alone can exceed the budget.
    quantize_dynamic(
        str(float_path),
        str(quantized),
        per_channel=True,
        # U8/U8 avoids the saturating U8/S8 AVX2 path, keeping the Python CPU
        # evaluator aligned with browser WASM without reducing embedding precision.
        weight_type=QuantType.QUInt8,
        op_types_to_quantize=["MatMul", "Gather"],
    )
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 2
    session = ort.InferenceSession(
        str(quantized), sess_options=session_options, providers=["CPUExecutionProvider"]
    )
    maximum = 0.0
    maximum_probability_difference = 0.0
    maximum_suggestion_probability_difference = 0.0
    agreements = 0
    raw_probes = [
        "ابحث عن نص «الحمد»، في بداية الآية فقط",
        "اجمع ٣ كلمات بعد «ولكن»، جمع النتائج دون الحركة الأخيرة",
        "ابحث عن العلامة القرآنية ۩",
    ]
    samples = json.loads(
        subprocess.run(
            ["node", str(ROOT / "preprocess.cjs")],
            input=json.dumps(raw_probes, ensure_ascii=False),
            text=True,
            capture_output=True,
            check=True,
        ).stdout
    )
    samples = [sample for sample in samples if sample]
    # Probe every intent's training template as export plumbing, separately from
    # held-out accuracy. Raw logits have an arbitrary scale; compare probabilities.
    seen = set()
    for line in (ROOT / "data/train.jsonl").read_text().splitlines():
        row = json.loads(line)
        if row["intent"] not in seen and row["model_input"]:
            seen.add(row["intent"])
            samples.append(row["model_input"])
    samples = list(dict.fromkeys(samples))
    for text in samples:
        encoded = tokenizer(text, return_tensors="pt")
        expected = wrapper(*(encoded[name] for name in names)).detach().numpy()
        actual = session.run(None, {name: encoded[name].numpy() for name in names})[0]
        if not np.isfinite(expected).all() or not np.isfinite(actual).all():
            raise ValueError("Non-finite exported logits.")

        def probabilities(values):
            values = values - values.max(axis=-1, keepdims=True)
            values = np.exp(values)
            return values / values.sum(axis=-1, keepdims=True)

        probability_difference = float(
            np.max(np.abs(probabilities(actual) - probabilities(expected)))
        )
        maximum_probability_difference = max(
            maximum_probability_difference, probability_difference
        )
        # Clarify always abstains regardless of its score; it must keep its top
        # label, while the probability budget applies to potentially usable plans.
        if model.config.id2label[int(expected.argmax())] != "clarify":
            maximum_suggestion_probability_difference = max(
                maximum_suggestion_probability_difference, probability_difference
            )
        maximum = max(maximum, float(np.max(np.abs(actual - expected))))
        agreements += int(actual.argmax() == expected.argmax())
    if maximum_suggestion_probability_difference > 0.02 or agreements != len(samples):
        raise ValueError(
            "Quantization changes probe decisions or probabilities beyond the export budget."
        )
    # Use only q8 at runtime; do not accidentally download the much larger float model.
    float_path.unlink()
    for name in [
        "catalog.json",
        "references.json",
        "builder-contract.json",
        "model.json",
    ]:
        shutil.copy2(ROOT / name, a.output / name)
    runtime_files = [
        "browser/planner-core.js",
        "browser/runner.js",
        "browser/client.js",
        "browser/planner-worker.js",
        "browser/build.cjs",
        "browser/package-lock.json",
    ]
    (a.output / "runtime-contract.json").write_text(
        json.dumps(
            {
                name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                for name in runtime_files
            },
            indent=2,
        )
        + "\n"
    )
    shutil.copy2(
        a.checkpoint / "training-report.json", a.output / "training-report.json"
    )
    shutil.copy2(a.checkpoint / "labels.json", a.output / "labels.json")
    labels = json.loads((a.output / "labels.json").read_text())
    policy = {
        "temperature": 1.0,
        "thresholds": {label: {"probability": 1.1, "margin": 1.0} for label in labels},
    }
    (a.output / "policy.json").write_text(json.dumps(policy, indent=2) + "\n")
    files = {
        str(file.relative_to(a.output)): hashlib.sha256(file.read_bytes()).hexdigest()
        for file in sorted(a.output.rglob("*"))
        if file.is_file() and file.name != "manifest.json"
    }
    size = sum(file.stat().st_size for file in a.output.rglob("*") if file.is_file())
    manifest = {
        "format": "quran-arabic-planner",
        "version": 1,
        "approved": False,
        "smoke_only": report["smoke_only"],
        "max_tokens": spec["max_tokens"],
        "max_characters": spec["max_characters"],
        "labels": labels,
        "total_bytes": size,
        "browser_budget_bytes": spec["browser_budget_bytes"],
        "files": files,
        "quantization": {
            "weight_type": "uint8",
            "max_logit_difference": maximum,
            "max_probability_difference": maximum_probability_difference,
            "max_suggestion_probability_difference": maximum_suggestion_probability_difference,
            "argmax_agreements": agreements,
            "sample_count": len(samples),
        },
        "note": "Run calibration and reviewed evaluation; no reliability claim is made by this export.",
    }
    (a.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    manifest = refresh_manifest(a.output)
    print(
        json.dumps(
            {
                "bytes": manifest["total_bytes"],
                "max_logit_difference": maximum,
                "approved": False,
            }
        )
    )


if __name__ == "__main__":
    main()
