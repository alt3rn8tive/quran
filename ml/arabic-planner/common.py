import hashlib, json
from pathlib import Path


def artifact_fingerprint(artifact):
    artifact = Path(artifact)
    names = [
        "onnx/model_quantized.onnx",
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "catalog.json",
        "references.json",
        "builder-contract.json",
        "runtime-contract.json",
        "policy.json",
        "labels.json",
        "training-report.json",
        "model.json",
    ]
    h = hashlib.sha256()
    for name in names:
        h.update(name.encode())
        h.update((artifact / name).read_bytes())
    return h.hexdigest()


def refresh_manifest(artifact):
    artifact = Path(artifact)
    manifest = json.loads((artifact / "manifest.json").read_text())
    manifest["approved"] = False
    manifest["files"] = {
        str(p.relative_to(artifact)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(artifact.rglob("*"))
        if p.is_file() and p.name != "manifest.json"
    }
    manifest["total_bytes"] = sum(
        p.stat().st_size
        for p in artifact.rglob("*")
        if p.is_file() and p.name != "manifest.json"
    )
    manifest["artifact_fingerprint"] = artifact_fingerprint(artifact)
    (artifact / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest
