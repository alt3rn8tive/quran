"""Prepare calibration, held-out test and training-demo inputs for authoritative WASM evaluation."""

import argparse, json, subprocess
from pathlib import Path
from common import artifact_fingerprint

ROOT = Path(__file__).resolve().parent


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--artifact", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    rows = []
    for name in ["calibration", "test"]:
        rows.extend(
            json.loads(line)
            for line in (ROOT / "data" / (name + ".jsonl")).read_text().splitlines()
        )
    seen = set()
    for line in (ROOT / "data/train.jsonl").read_text().splitlines():
        row = json.loads(line)
        if row["intent"] not in seen:
            rows.append(row)
            seen.add(row["intent"])
    if (ROOT / "data/demonstrations.jsonl").exists():
        rows.extend(
            json.loads(line)
            for line in (ROOT / "data/demonstrations.jsonl").read_text().splitlines()
        )
    prepared = json.loads(
        subprocess.run(
            ["node", str(ROOT / "preprocess.cjs")],
            input=json.dumps([row["request"] for row in rows]),
            text=True,
            capture_output=True,
            check=True,
        ).stdout
    )
    output = {
        "inference_fingerprint": artifact_fingerprint(a.artifact, include_policy=False),
        "rows": [
            {"id": row["id"], "request": row["request"], "model_input": text}
            for row, text in zip(rows, prepared)
        ],
    }
    a.output.write_text(json.dumps(output, ensure_ascii=False) + "\n")
    print(json.dumps({"rows": len(rows)}))


if __name__ == "__main__":
    main()
