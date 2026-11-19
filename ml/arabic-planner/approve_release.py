"""Fail closed: approval requires reviewed data AND real-device browser evidence.
This is a local release gate, not proof that supplied reviewer attestations are true.
"""

import argparse, hashlib, json
from pathlib import Path
from common import artifact_fingerprint

ROOT = Path(__file__).resolve().parent


def read(path):
    return json.loads(Path(path).read_text())


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--artifact", type=Path, required=True)
    p.add_argument("--evaluation", type=Path, required=True)
    p.add_argument("--browser-report", type=Path, required=True)
    p.add_argument("--attestation", type=Path, required=True)
    a = p.parse_args()
    manifest = read(a.artifact / "manifest.json")
    evaluation = read(a.evaluation)
    browser = read(a.browser_report)
    attestation = read(a.attestation)
    errors = []

    def require(condition, reason):
        if not condition:
            errors.append(reason)

    fingerprint = artifact_fingerprint(a.artifact)
    require(not manifest["smoke_only"], "Smoke models can never be approved.")
    require(
        manifest["total_bytes"] <= 80 * 1024 * 1024, "Model download exceeds 80 MiB."
    )
    actual_files = {
        str(f.relative_to(a.artifact)): hashlib.sha256(f.read_bytes()).hexdigest()
        for f in a.artifact.rglob("*")
        if f.is_file() and f.name != "manifest.json"
    }
    require(
        actual_files == manifest["files"],
        "Artifact files changed; export/calibrate again.",
    )
    require(
        fingerprint
        == manifest.get("artifact_fingerprint")
        == evaluation.get("artifact_fingerprint")
        == browser.get("artifact_fingerprint")
        == attestation.get("artifact_fingerprint"),
        "Reports/attestation must describe this exact artifact and policy.",
    )
    contract = read(a.artifact / "runtime-contract.json")
    require(
        all(
            hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest
            for name, digest in contract.items()
        ),
        "Runtime changed after export.",
    )
    require(
        hashlib.sha256((ROOT / "../../js/query-builder.js").read_bytes()).hexdigest()
        == read(a.artifact / "builder-contract.json")["sha256"],
        "Production builder changed.",
    )
    require(
        evaluation.get("statistical_gates_pass") is True
        and evaluation.get("all_reviewed") is True
        and not evaluation.get("smoke_only"),
        "Reviewed exact-plan evaluation gates must pass.",
    )
    require(
        browser.get("parity_pass") is True
        and browser.get("samples", 0) >= 100
        and not browser.get("smoke_only"),
        "Real-model browser tokenizer/probability/decision parity must pass.",
    )
    require(
        browser.get("warm_p95_ms", float("inf")) <= 2500
        and browser.get("cold_load_ms", float("inf")) <= 30000,
        "Browser latency exceeds the proposed budget.",
    )
    require(
        attestation.get("independent_gold_review") is True
        and bool(attestation.get("reviewer")),
        "An independent Arabic gold-plan reviewer is required.",
    )
    devices = attestation.get("devices", [])
    for platform in ["android", "ios"]:
        require(
            any(
                d.get("platform") == platform
                and d.get("physical_device") is True
                and d.get("artifact_fingerprint") == fingerprint
                and d.get("parity_pass") is True
                and isinstance(d.get("warm_p95_ms"), (int, float))
                and 0 < d["warm_p95_ms"] <= 2500
                and isinstance(d.get("cold_load_ms"), (int, float))
                and 0 < d["cold_load_ms"] <= 30000
                and d.get("responsive_ui") is True
                and d.get("no_remote_requests") is True
                for d in devices
            ),
            "Measured physical " + platform + " browser evidence is required.",
        )
    if errors:
        raise SystemExit("NOT APPROVED:\n- " + "\n- ".join(errors))
    manifest.update(
        approved=True,
        approval={
            "reviewer": attestation["reviewer"],
            "artifact_fingerprint": fingerprint,
            "evaluation_sha256": hashlib.sha256(a.evaluation.read_bytes()).hexdigest(),
            "browser_report_sha256": hashlib.sha256(
                a.browser_report.read_bytes()
            ).hexdigest(),
            "attestation_sha256": hashlib.sha256(
                a.attestation.read_bytes()
            ).hexdigest(),
        },
    )
    (a.artifact / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("Approved this immutable artifact only. Changes require re-evaluation.")


if __name__ == "__main__":
    main()
