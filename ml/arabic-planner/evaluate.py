"""Calibrate on calibration only, evaluate exact plans on untouched test/reviewed rows.
Release approval also needs measured browser parity/performance and reviewer attestation.
"""

import argparse, hashlib, json, math, subprocess
from pathlib import Path
import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer
from common import artifact_fingerprint, refresh_manifest

ROOT = Path(__file__).resolve().parent


def rows(path):
    return [
        json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()
    ]


def softmax(values):
    values = values - values.max(axis=-1, keepdims=True)
    out = np.exp(values)
    return out / out.sum(axis=-1, keepdims=True)


def wilson(successes, total, upper=False):
    if not total:
        return 1.0 if upper else 0.0
    z = 1.959963984540054
    p = successes / total
    d = 1 + z * z / total
    c = p + z * z / (2 * total)
    w = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
    return (c + w if upper else c - w) / d


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--artifact", type=Path, required=True)
    p.add_argument("--calibrate", action="store_true")
    p.add_argument("--browser-scores", type=Path)
    p.add_argument(
        "--calibration-data", type=Path, default=ROOT / "data/calibration.jsonl"
    )
    p.add_argument("--data", type=Path, default=ROOT / "data/test.jsonl")
    p.add_argument("--report", type=Path, required=True)
    a = p.parse_args()
    manifest = json.loads((a.artifact / "manifest.json").read_text())
    labels = manifest["labels"]
    tokenizer = AutoTokenizer.from_pretrained(a.artifact)
    browser_scores = None
    if a.browser_scores:
        collected = json.loads(a.browser_scores.read_text())
        if collected.get("engine") != "onnxruntime-web-wasm" or collected.get(
            "inference_fingerprint"
        ) != artifact_fingerprint(a.artifact, include_policy=False):
            raise ValueError("Browser scores do not describe this inference artifact.")
        browser_scores = {
            row["id"]: dict(
                row,
                scores=(
                    collected["predictions"][row["score_index"]]
                    if row.get("score_index") is not None
                    else row.get("scores")
                ),
            )
            for row in collected["rows"]
        }
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 2
    session_options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(a.artifact / "onnx/model_quantized.onnx"),
        sess_options=session_options,
        providers=["CPUExecutionProvider"],
    )

    def infer(examples):
        prepared = subprocess.run(
            ["node", str(ROOT / "preprocess.cjs")],
            input=json.dumps([row["request"] for row in examples], ensure_ascii=False),
            text=True,
            capture_output=True,
            check=True,
        )
        texts = json.loads(prepared.stdout)
        results = []
        for row, text in zip(examples, texts):
            # Reviewed inputs must be re-prepared with the shared JS implementation, never trusted model_input.
            if text is None:
                results.append(None)
                continue
            inputs = tokenizer(text, return_tensors="np", truncation=False)
            if inputs["input_ids"].shape[-1] > manifest["max_tokens"]:
                results.append(None)
                continue
            if browser_scores is not None:
                entry = browser_scores.get(row["id"])
                if (
                    not entry
                    or entry["request"] != row["request"]
                    or entry["model_input"] != text
                ):
                    raise ValueError(
                        "Missing/mismatched browser evaluation row: " + row["id"]
                    )
                values = {item["label"]: item["score"] for item in entry["scores"]}
                probabilities = np.array([values[label] for label in labels])
                if (
                    len(values) != len(labels)
                    or not np.isfinite(probabilities).all()
                    or (probabilities < 0).any()
                    or abs(probabilities.sum() - 1) > 0.001
                ):
                    raise ValueError("Invalid browser score vector.")
                results.append(np.log(np.maximum(probabilities, 1e-30)))
                continue
            results.append(
                session.run(
                    None,
                    {name: value.astype(np.int64) for name, value in inputs.items()},
                )[0][0]
            )
        return results

    if a.calibrate:
        calibration = rows(a.calibration_data)
        outputs = infer(calibration)
        valid = [
            (row, logit)
            for row, logit in zip(calibration, outputs)
            if logit is not None
        ]
        logits = np.stack([item[1] for item in valid])
        gold = np.array([labels.index(item[0]["intent"]) for item in valid])
        best = None
        for temperature in [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]:
            probs = softmax(logits / temperature)
            nll = float(
                -np.log(np.maximum(probs[np.arange(len(gold)), gold], 1e-30)).mean()
            )
            if best is None or nll < best[0]:
                best = (nll, temperature, probs)
        probs = best[2]
        ranked = np.sort(probs, axis=1)
        top = probs.argmax(axis=1)
        # Calibrate the system that users actually see: invalid assembled plans
        # already abstain, and valid plans must match the complete gold settings.
        grounded_rows = [
            dict(row, intent=labels[int(prediction)])
            for (row, _), prediction in zip(valid, top)
        ]
        grounded = json.loads(
            subprocess.run(
                ["node", str(ROOT / "bridge.cjs")],
                input=json.dumps(
                    {"operation": "candidate", "rows": grounded_rows},
                    ensure_ascii=False,
                ),
                text=True,
                capture_output=True,
                check=True,
            ).stdout
        )
        supported = np.array([row["status"] == "suggestion" for row in grounded])
        exact = np.array([bool(row["correct"]) for row in grounded])
        thresholds = {}
        for idx, label in enumerate(labels):
            choice = None
            for probability in [0.7, 0.8, 0.9, 0.95, 0.97, 0.98, 0.99, 0.995, 0.999]:
                for margin in [0.1, 0.2, 0.3, 0.4, 0.5, 0.7]:
                    accept = (
                        (top == idx)
                        & (probs[:, idx] >= probability)
                        & ((ranked[:, -1] - ranked[:, -2]) >= margin)
                        & supported
                    )
                    n = int(accept.sum())
                    families = {
                        valid[i][0]["family_id"] for i in np.flatnonzero(accept)
                    }
                    if (
                        n >= 20
                        and float(exact[accept].mean()) >= 0.99
                        and (choice is None or n > choice[0])
                    ):
                        choice = (n, probability, margin, len(families))
            thresholds[label] = {
                "probability": choice[1] if choice else 1.1,
                "margin": choice[2] if choice else 1.0,
                "calibration_families": choice[3] if choice else 0,
            }
        policy = {
            "inference_engine": (
                "onnxruntime-web-wasm"
                if browser_scores is not None
                else "onnxruntime-python-cpu"
            ),
            "calibration_target": "exact_grounded_plan",
            "temperature": best[1],
            "thresholds": thresholds,
            "calibration_sha256": hashlib.sha256(
                a.calibration_data.read_bytes()
            ).hexdigest(),
            "calibration_requests_sha256": [
                hashlib.sha256(row["request"].encode()).hexdigest()
                for row in calibration
            ],
        }
        (a.artifact / "policy.json").write_text(json.dumps(policy, indent=2) + "\n")
        refresh_manifest(a.artifact)
    else:
        policy = json.loads((a.artifact / "policy.json").read_text())
    examples = rows(a.data)
    if len({row["request"] for row in examples}) != len(examples):
        raise ValueError("Evaluation requests must be unique.")
    training = json.loads((a.artifact / "training-report.json").read_text())
    used = set(training.get("training_requests_sha256", [])) | set(
        policy.get("calibration_requests_sha256", [])
    )
    if any(
        hashlib.sha256(row["request"].encode()).hexdigest() in used for row in examples
    ):
        raise ValueError(
            "Evaluation overlaps training/validation/calibration requests."
        )
    outputs = infer(examples)
    enriched = []
    for row, logits in zip(examples, outputs):
        scores = (
            softmax(np.asarray(logits)[None, :])[0]
            if logits is not None
            else np.ones(len(labels)) / len(labels)
        )
        enriched.append(
            dict(
                row,
                scores=[
                    {"label": label, "score": float(scores[i])}
                    for i, label in enumerate(labels)
                ],
            )
        )
    evaluated = json.loads(
        subprocess.run(
            ["node", str(ROOT / "bridge.cjs")],
            input=json.dumps(
                {"operation": "evaluate", "policy": policy, "rows": enriched},
                ensure_ascii=False,
            ),
            text=True,
            capture_output=True,
            check=True,
        ).stdout
    )
    # Token overflows and preflight rejections must abstain, regardless of artificial score placeholders.
    for item, logits, row in zip(evaluated, outputs, examples):
        if logits is None:
            item.update(
                status="clarify", correct=row["expected"]["status"] == "clarify"
            )
    accepted = [x for x in evaluated if x["status"] == "suggestion"]
    correct = sum(x["correct"] for x in accepted)
    ood = [
        x
        for x, row in zip(evaluated, examples)
        if row["expected"]["status"] == "clarify"
    ]
    false_accept = sum(x["status"] == "suggestion" for x in ood)
    per_intent = {}
    for label in labels:
        if label == "clarify":
            continue
        group = [x for x in accepted if x["intent"] == label]
        n_correct = sum(x["correct"] for x in group)
        per_intent[label] = {
            "accepted": len(group),
            "precision": n_correct / max(1, len(group)),
            "precision_95_lower": wilson(n_correct, len(group)),
        }
    report = {
        "inference_engine": (
            "onnxruntime-web-wasm"
            if browser_scores is not None
            else "onnxruntime-python-cpu"
        ),
        "browser_scores_sha256": (
            hashlib.sha256(a.browser_scores.read_bytes()).hexdigest()
            if a.browser_scores
            else None
        ),
        "samples": len(examples),
        "accepted": len(accepted),
        "coverage": len(accepted) / max(1, len(examples)),
        "accepted_exact_plan_precision": correct / max(1, len(accepted)),
        "precision_95_lower": wilson(correct, len(accepted)),
        "ood_samples": len(ood),
        "ood_false_accepts": false_accept,
        "ood_fpr_95_upper": wilson(false_accept, len(ood), True),
        "all_reviewed": all(
            x.get("reviewed") is True and x.get("reviewed_by") for x in examples
        ),
        "smoke_only": manifest["smoke_only"],
        "per_intent": per_intent,
        "artifact_fingerprint": artifact_fingerprint(a.artifact),
        "dataset_sha256": hashlib.sha256(a.data.read_bytes()).hexdigest(),
        "approved": False,
    }
    report["in_scope_coverage"] = sum(
        x["status"] == "suggestion" and row["expected"]["status"] == "suggestion"
        for x, row in zip(evaluated, examples)
    ) / max(1, len(examples) - len(ood))

    def coverage_for(indices):
        selected = [evaluated[i] for i in indices]
        accepted_here = [row for row in selected if row["status"] == "suggestion"]
        return {
            "supported_requests": len(selected),
            "accepted": len(accepted_here),
            "precision": sum(row["correct"] for row in accepted_here)
            / max(1, len(accepted_here)),
            "coverage": len(accepted_here) / max(1, len(selected)),
        }

    block_types = sorted(
        {
            block["type"]
            for row in examples
            for block in row["expected"].get("blocks", [])
        }
    )
    report["per_block_type"] = {
        type_: coverage_for(
            [
                i
                for i, row in enumerate(examples)
                if any(
                    block["type"] == type_
                    for block in row["expected"].get("blocks", [])
                )
            ]
        )
        for type_ in block_types
    }
    report["per_global_option"] = {
        key: coverage_for(
            [
                i
                for i, row in enumerate(examples)
                if row["expected"].get("settings", {}).get(key)
            ]
        )
        for key in ["searchFromBeginning", "searchOnEnd", "removeLastHarakah"]
    }
    report["per_option_mask"] = {
        str(bits): coverage_for(
            [
                i
                for i, row in enumerate(examples)
                if row["expected"]["status"] == "suggestion"
                and sum(
                    (1 << bit)
                    for bit, key in enumerate(
                        ["searchFromBeginning", "searchOnEnd", "removeLastHarakah"]
                    )
                    if row["expected"].get("settings", {}).get(key)
                )
                == bits
            ]
        )
        for bits in range(8)
    }
    if (ROOT / "data/adversarial.jsonl").exists():
        adversarial = rows(ROOT / "data/adversarial.jsonl")
        checked = json.loads(
            subprocess.run(
                ["node", str(ROOT / "bridge.cjs")],
                input=json.dumps(
                    {"operation": "candidate", "rows": adversarial}, ensure_ascii=False
                ),
                text=True,
                capture_output=True,
                check=True,
            ).stdout
        )
        report["grounding_adversarial"] = {
            "rows": len(checked),
            "rejected": sum(row["status"] == "clarify" for row in checked),
            "classification_metric": False,
        }
    report["statistical_gates_pass"] = (
        not manifest["smoke_only"]
        and report["all_reviewed"]
        and len(accepted) >= 500
        and report["in_scope_coverage"] >= 0.6
        and report["precision_95_lower"] >= 0.99
        and len(ood) >= 1000
        and report["ood_fpr_95_upper"] <= 0.005
        and all(
            v["accepted"] >= 100
            and v["precision"] >= 0.99
            and v["precision_95_lower"] >= 0.95
            for v in per_intent.values()
        )
    )
    # Demonstrations are separate from training, threshold fitting and test metrics.
    priority = [
        "context_after",
        "context_before",
        "exclude_verse",
        "exclude_word",
        "cross_ayah",
        "unknown_word",
        "reference",
    ]
    demonstrations = []
    source_rows = rows(ROOT / "data/train.jsonl")
    for label in priority:
        example = next((row for row in source_rows if row["intent"] == label), None)
        if example:
            demonstrations.append(example)
    if (ROOT / "data/demonstrations.jsonl").exists():
        demonstrations = rows(ROOT / "data/demonstrations.jsonl")
    demo_outputs = infer(demonstrations)
    demo_rows = []
    for row, logits in zip(demonstrations, demo_outputs):
        if logits is None:
            continue
        probabilities = softmax(np.asarray(logits)[None, :])[0]
        demo_rows.append(
            dict(
                row,
                scores=[
                    {"label": label, "score": float(probabilities[i])}
                    for i, label in enumerate(labels)
                ],
            )
        )
    demo_decisions = json.loads(
        subprocess.run(
            ["node", str(ROOT / "bridge.cjs")],
            input=json.dumps(
                {"operation": "evaluate", "policy": policy, "rows": demo_rows},
                ensure_ascii=False,
            ),
            text=True,
            capture_output=True,
            check=True,
        ).stdout
    )
    report["examples"] = [
        row["request"]
        for row, result in zip(demo_rows, demo_decisions)
        if result["status"] == "suggestion" and result["correct"]
    ][:14]
    a.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
