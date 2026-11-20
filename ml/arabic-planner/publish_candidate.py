"""Publish an opt-in experimental candidate, without granting production approval.

Run only after fine-tuning, calibration and draft evaluation. Existing versioned
directories must match byte-for-byte; publication never overwrites a release.
"""

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from common import artifact_fingerprint, refresh_manifest

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent


def copy_immutable(source, target):
    if target.exists():
        if target.read_bytes() != source.read_bytes():
            raise ValueError("Refusing to overwrite published asset: " + str(target))
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--evaluation", type=Path, required=True)
    parser.add_argument("--experimental", action="store_true", required=True)
    args = parser.parse_args()
    artifact = args.artifact.resolve()
    manifest = json.loads((artifact / "manifest.json").read_text())
    training = json.loads((artifact / "training-report.json").read_text())
    evaluation = json.loads(args.evaluation.read_text())
    if evaluation.get("inference_engine") != "onnxruntime-web-wasm":
        raise ValueError(
            "The website candidate must be calibrated/evaluated using collected browser WASM scores."
        )
    if artifact_fingerprint(artifact) != manifest["artifact_fingerprint"]:
        raise ValueError("Artifact changed after evaluation.")
    contract = json.loads((artifact / "runtime-contract.json").read_text())
    if any(
        hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest
        for name, digest in contract.items()
    ):
        raise ValueError(
            "Runtime changed; export and evaluate again before publication."
        )
    if (
        manifest["smoke_only"]
        or training["smoke_only"]
        or training["training_steps"] < 100
        or not training["retained_layers"]
    ):
        raise ValueError(
            "A fine-tuned pretrained Arabic model is required, never a smoke model."
        )
    if evaluation["artifact_fingerprint"] != manifest["artifact_fingerprint"]:
        raise ValueError("Evaluation does not describe this model and policy.")
    if (
        evaluation["accepted"] < 30
        or evaluation["accepted_exact_plan_precision"] < 0.95
        or not evaluation.get("examples")
    ):
        raise ValueError(
            "Candidate needs at least 30 accepted draft plans with >=95% exact precision. This is not production certification."
        )
    if json.loads((ROOT / "catalog.json").read_text()).get("version", 1) >= 2:
        if len(evaluation.get("per_block_type", {})) != 12 or any(
            row["accepted"] < 1 for row in evaluation["per_block_type"].values()
        ):
            raise ValueError(
                "The expanded candidate must demonstrate accepted held-out plans for every requested block type."
            )
        if any(
            evaluation.get("per_global_option", {}).get(key, {}).get("accepted", 0) < 20
            for key in ["searchFromBeginning", "searchOnEnd", "removeLastHarakah"]
        ):
            raise ValueError(
                "All three global controls need accepted browser-evaluated plans."
            )
    # Copy actual model attribution and the Apache-2.0 license, as declared upstream.
    shutil.copy2(ROOT / "MODEL-NOTICE.md", artifact / "MODEL-NOTICE.md")
    shutil.copy2(
        ROOT / "browser/node_modules/@huggingface/transformers/LICENSE",
        artifact / "LICENSE-Apache-2.0.txt",
    )
    shutil.copy2(args.evaluation, artifact / "candidate-evaluation.json")
    manifest.update(release_channel="experimental", approved=False)
    (artifact / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    manifest = refresh_manifest(artifact)
    if manifest["total_bytes"] > 80 * 1024 * 1024:
        raise ValueError("Candidate exceeds the browser model budget.")
    browser = ROOT / "browser"
    assets = [
        browser / name
        for name in ["client.js", "planner-worker.js", "runner.js", "planner-core.js"]
    ]
    assets += [
        browser / "vendor" / name
        for name in [
            "transformers.js",
            "query-builder.mjs",
            "ort-wasm-simd-threaded.jsep.mjs",
            "ort-wasm-simd-threaded.jsep.wasm",
        ]
    ]
    assets += list((ROOT / "runtime-licenses").glob("*"))
    runtime_hash = hashlib.sha256(
        b"".join(path.name.encode() + path.read_bytes() for path in assets)
    ).hexdigest()[:16]
    runtime_path = Path("models/runtime") / runtime_hash
    for source in assets:
        relative = (
            source.relative_to(browser)
            if source.is_relative_to(browser)
            else Path("licenses") / source.name
        )
        copy_immutable(source, REPO / runtime_path / relative)
    version = hashlib.sha256((artifact / "manifest.json").read_bytes()).hexdigest()[:16]
    model_path = Path("models") / ("arabic-" + version)
    for source in artifact.rglob("*"):
        if source.is_file():
            copy_immutable(source, REPO / model_path / source.relative_to(artifact))
    info = {
        "version": (
            2
            if json.loads((ROOT / "catalog.json").read_text()).get("version", 1) >= 2
            else 1
        ),
        "channel": "experimental",
        "model": model_path.as_posix() + "/",
        "client": (runtime_path / "client.js").as_posix(),
        "bytes": manifest["total_bytes"],
        "runtime_bytes": sum(p.stat().st_size for p in assets),
        "fingerprint": manifest["artifact_fingerprint"],
        "examples": evaluation.get("examples", []),
    }
    (REPO / "models/planner.json").write_text(json.dumps(info, indent=2) + "\n")
    print(json.dumps(info))


if __name__ == "__main__":
    main()
