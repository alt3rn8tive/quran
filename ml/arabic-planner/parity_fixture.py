"""Produce Python ONNX/tokenizer outputs for browser comparison, without tuning on test."""

import argparse, json, subprocess
from pathlib import Path
import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer
from common import artifact_fingerprint

ROOT = Path(__file__).resolve().parent


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--artifact", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    tokenizer = AutoTokenizer.from_pretrained(a.artifact)
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 2
    session_options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(a.artifact / "onnx/model_quantized.onnx"),
        sess_options=session_options,
        providers=["CPUExecutionProvider"],
    )
    manifest = json.loads((a.artifact / "manifest.json").read_text())
    policy = json.loads((a.artifact / "policy.json").read_text())
    labels = manifest["labels"]
    all_examples = [
        json.loads(line) for line in (ROOT / "data/test.jsonl").read_text().splitlines()
    ]
    examples = []
    for label in labels:
        group = [row for row in all_examples if row["intent"] == label]
        if group:
            examples.extend(
                group[min(len(group) - 1, int(i * (len(group) - 1) / 2))]
                for i in range(3)
            )
    prepared = json.loads(
        subprocess.run(
            ["node", str(ROOT / "preprocess.cjs")],
            input=json.dumps([row["request"] for row in examples]),
            text=True,
            capture_output=True,
            check=True,
        ).stdout
    )
    rows = []
    for row, text in zip(examples, prepared):
        if text is None:
            continue
        inputs = tokenizer(text, return_tensors="np", truncation=False)
        if inputs["input_ids"].shape[-1] > manifest["max_tokens"]:
            continue
        logits = session.run(
            None, {name: value.astype(np.int64) for name, value in inputs.items()}
        )[0][0]
        probs = np.exp(logits - logits.max())
        probs /= probs.sum()
        rows.append(
            dict(
                row,
                model_input=text,
                tokens=inputs["input_ids"][0].tolist(),
                scores=[
                    {"label": label, "score": float(probs[i])}
                    for i, label in enumerate(labels)
                ],
            )
        )
    decisions = json.loads(
        subprocess.run(
            ["node", str(ROOT / "bridge.cjs")],
            input=json.dumps({"operation": "predict", "rows": rows, "policy": policy}),
            text=True,
            capture_output=True,
            check=True,
        ).stdout
    )
    for row, decision in zip(rows, decisions):
        row["decision"] = decision
    a.output.write_text(
        json.dumps(
            {
                "artifact_fingerprint": artifact_fingerprint(a.artifact),
                "smoke_only": manifest["smoke_only"],
                "rows": rows,
            },
            ensure_ascii=False,
        )
        + "\n"
    )
    print(json.dumps({"samples": len(rows), "output": str(a.output)}))


if __name__ == "__main__":
    main()
