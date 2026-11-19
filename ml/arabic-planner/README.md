# Arabic → Quran search components

Status: **training and browser tooling, not an approved search assistant**. The live app does not import this code or download a model. No production Arabic accuracy has been measured. See [VALIDATION.md](VALIDATION.md) for the checks actually run.

## Model and architecture

Use [CAMeL-Lab/bert-base-arabic-camelbert-mix](https://huggingface.co/CAMeL-Lab/bert-base-arabic-camelbert-mix), an Arabic BERT pretrained on Classical Arabic, Modern Standard Arabic and dialects. Its model card declares Apache-2.0. [model.json](model.json) pins revision `9be352797bdf28a9ae21e2ae582aaaca7abdb22d`; retain the original model attribution/license when distributing derived weights.

For the browser candidate, retain pretrained embeddings and encoder layers **0, 2, 4, 7, 9, 11**, then fine-tune a 29-class classifier: 28 supported recipes and `clarify`. This is layer-pruned initialization, **not knowledge distillation**. Compare the smaller candidate with a full-size teacher during subsequent model research if it fails the release gates. Arabic pretraining alone does not establish suitability for this task.

The model chooses an intent only. Shared deterministic JavaScript extracts quoted strings and numeric counts, fills a closed recipe, and calls the actual `QuranQueryBuilder.compile`. It cannot generate regex, Quran text, arbitrary block types, or executable code. Unicode normalization applies to instruction matching; the quoted text is copied exactly, including hamza and harakat.

```text
اجمع ٣ كلمات بعد «ولكن»
  → model input: اجمع رقم كلمات بعد «عبارة»
  → context_after + exact quoted text + integer 3
  → validated context block, direction=after, count=3
  → show editable blocks for the user to review and apply
```

The browser runs int8 ONNX through Transformers.js/WASM in a Web Worker, with one thread so GitHub Pages does not need cross-origin isolation. All inference assets are self-hosted. Nothing sends requests or Quran queries to an inference service. A user must explicitly request the optional download; keep the existing manual builder immediately available.

## Supported first-version scope

See [catalog.json](catalog.json) for executable recipes and Arabic examples:

- Text matching: substring, complete word, starts with, ends with, complete phrase.
- Captures before/after text; adjacent phrases, exact/ranged word gaps, either order.
- Explicit next-ayah separator; alternatives; verse and word exclusions.
- Exact/ranged unknown letters; specific/unknown letter with harakah; shadda; optional specific letter.
- Eight named Quranic signs, with optional preceding/following word captures.
- Captured words between two texts; unknown word(s); a quoted text at an explicit surah/ayah reference.

This is a bounded recipe classifier, not unrestricted natural-language search. Text must be quoted using `«…»`, `"…"` or `“…”`; counts must be digits, including Arabic-Indic/Persian digits. The first version does not parse written number words, combine arbitrary recipes, or combine a cross-ayah query with reference constraints. Ask for clarification or offer manual editing for these cases. Semantic, root, tafsir and grammatical searches are unsupported.

The reference recipe returns `{surah, ayah}` separately from blocks. An eventual app adapter must map these to the app's existing filters. For cross-ayah searches the existing starting-ayah semantics still apply. The production engine remains responsible for consecutive-ayah matching and surah boundaries. Saved links must continue to use `QuranSearchLink`, with the resulting validated blocks, rather than raw model output.

## Data and review

`data/*.jsonl` contains **4,096 synthetic draft examples**: 2,291 training, 598 validation, 607 calibration, and 600 test. Every row is marked `reviewed:false`. No item is represented as a real user request or human-approved gold answer. Targets contain real builder settings, not free-form explanations. [prepare_data.py](prepare_data.py) generates targets independently in Python and checks each against the shared assembler and production compiler through Node.

Template families and quoted literal pools are separated between splits. The training set currently has one underlying template per recipe with polite-prefix variants. **This diversity is insufficient for a reliability claim.** The held-out synthetic templates are useful regression cases, not a substitute for independent evaluation. Fixed seeds, stable IDs and SHA-256 manifests make reproduction auditable.

Before full training, collect and independently annotate natural Arabic requests: formal Arabic, common Gulf/Egyptian phrasing, spelling variants, negation, reversed argument order, extra constraints, contradictory requests, mixed digits, quotations, harakat and ambiguous exclusions. Add multiple genuinely different training families for every recipe. Add unsupported requests that closely resemble valid ones. Keep paraphrases of the same request in one split; deduplicate exact and near-duplicate requests before freezing evaluation.

For human-reviewed rows, use the same schema plus `reviewed:true`, `reviewed_by`, and provenance/annotation notes. A fluent Arabic reviewer should assign the desired blocks **before seeing model predictions**, and a second reviewer should adjudicate disagreements. Expected plans must express the complete request; a missing exclusion, wrong scope, direction, order or ayah reference is incorrect. Unsupported requests use `expected:{"status":"clarify"}`. Do not simply flip the synthetic review flags.

Reserve a separate reviewed test set with at least **100 accepted examples per supported intent**, plus at least **1,000 unsupported/ambiguous examples**. In practice collect more to allow abstentions and tight confidence intervals. Never tune prompts, recipes, thresholds or weights on that test set; use a new test set after tuning to its failures. Calibration and reviewed test inputs are reprocessed through the shared JavaScript, not trusted precomputed `model_input` fields.

## Reproduce, train and export

Run from the repository root. Node 18+ and Python 3.11/3.12 are recommended. Keep checkpoints, environments and generated vendor binaries outside Git.

```bash
python3 -m venv /workspace/work/arabic-planner-venv
/workspace/work/arabic-planner-venv/bin/pip install -r ml/arabic-planner/requirements-cpu.txt
python3 ml/arabic-planner/prepare_data.py
node --test ml/arabic-planner/tests/core.test.cjs

# No native Node inference backend is needed; avoid its optional binary download.
npm ci --prefix ml/arabic-planner/browser --ignore-scripts --no-audit --no-fund
npm run --prefix ml/arabic-planner/browser build

# Full Arabic fine-tuning (GPU recommended; CPU package above also works).
HF_HOME=/workspace/work/arabic-planner-cache \
 /workspace/work/arabic-planner-venv/bin/python ml/arabic-planner/train.py \
 --data-dir ml/arabic-planner/data --epochs 8 \
 --output /workspace/work/arabic-planner-checkpoint

/workspace/work/arabic-planner-venv/bin/python ml/arabic-planner/export_onnx.py \
 --checkpoint /workspace/work/arabic-planner-checkpoint \
 --output /workspace/work/arabic-planner-model-v1

/workspace/work/arabic-planner-venv/bin/python ml/arabic-planner/evaluate.py \
 --artifact /workspace/work/arabic-planner-model-v1 --calibrate \
 --calibration-data ml/arabic-planner/data/calibration.jsonl \
 --data ml/arabic-planner/data/test.jsonl \
 --report /workspace/work/arabic-planner-draft-evaluation.json
```

Replace the data paths with curated split files for a real release. `--data-dir` needs `train.jsonl` and `validation.jsonl`. The training script chooses the best validation checkpoint; calibration fits temperature and per-intent confidence/margin thresholds on calibration only. A class without enough successful calibration examples remains disabled. The test split has no part in training or threshold selection.

Export quantizes both matrix multiplications **and embedding Gather weights**, so a float embedding table does not defeat the download budget. It checks dynamic-input float/int8 parity on three smoke inputs; subsequently assess the quantized model's end-to-end accuracy on the independent test set. Every export starts `approved:false` and with thresholds that reject everything until calibration.

Use `train.py --smoke --max-steps 2 --epochs 1 --output …` for a cheap tooling check. It uses the real pinned Arabic tokenizer with a **tiny, randomly initialized** BERT. It is never a pretrained Arabic model and can never pass release approval. Smoke mode still needs the tokenizer download on its first run.

The CPU requirements are pinned. For CUDA training, install the appropriate PyTorch 2.6 build for your hardware instead of the CPU wheel; GPU training has not been tested here. The full selected backbone/checkpoint is substantially larger than the browser export. Do not commit either set of weights to this Pages branch by accident.

## Browser verification

Generate a fixture from Python ONNX Runtime, serve the repository and artifact on the **same origin**, and compare real browser results. The test script uses Playwright (installed as separate development tooling), with `CHROME_BIN` optionally selecting Chromium. In this workspace Playwright is already installed; elsewhere install it in your tooling environment.

```bash
/workspace/work/arabic-planner-venv/bin/python ml/arabic-planner/parity_fixture.py \
 --artifact /workspace/work/arabic-planner-model-v1 \
 --output /workspace/work/arabic-planner-parity.json

# In another terminal; this workspace server exposes /quran/ and /work/.
python3 -m http.server 8780 --bind 127.0.0.1 --directory /workspace

node ml/arabic-planner/tests/browser.cjs \
 http://127.0.0.1:8780/quran/ml/arabic-planner/browser/harness.html \
 http://127.0.0.1:8780/work/arabic-planner-model-v1/ \
 /workspace/work/arabic-planner-parity.json \
 /workspace/work/arabic-planner-browser-report.json
```

The checks compare exact token IDs, all 29 probabilities, confidence decisions and compiler output. They also verify rejection of corrupted weights, refusal of unapproved smoke models, worker loading and same-origin-only requests. A narrow desktop viewport **is not a physical mobile performance test**. The fixture's positive guided plans test deterministic assembly separately from the model; they are not model accuracy measurements. Browser timing includes two classifier passes per request for parity and is a conservative development measurement.

## Release gates and eventual app integration

Proposed gates are deliberately strict targets, **not observed results**:

| Gate | Required |
| --- | --- |
| Exact accepted-plan precision | 95% Wilson lower bound ≥99%, ≥500 accepted reviewed requests |
| Every supported intent | ≥100 accepted, empirical precision ≥99%, Wilson lower bound ≥95% |
| Supported-request coverage | ≥60% (report abstentions, do not hide them) |
| Unsupported false acceptance | ≥1,000 reviewed cases; 95% Wilson upper bound ≤0.5% |
| Python/browser agreement | ≥100 cases; identical tokens/decisions; probability difference ≤0.001 |
| Model artifact | ≤80 MiB, including tokenizer and metadata; measure actual export |
| Browser performance | warmed p95 ≤2.5s; cold load ≤30s on the declared connection |
| Real devices | measured Android Chrome and iOS Safari; responsive UI, no remote inference requests |

Runtime JS/WASM is additional to the 80 MiB model budget (roughly 1 MiB JS plus 11–21 MiB selected WASM before transfer compression with the pinned build). Cold load depends on network and device; these budgets can fail. Measure the full first download, worker startup, memory and responsiveness on real devices before release. If too large/slow, train a smaller architecture with teacher distillation and repeat all gates; do not silently relax correctness thresholds or truncate requests.

Evaluate the frozen policy on independently reviewed data, then fill a copy of [reviewer-attestation.example.json](reviewer-attestation.example.json) with measured device evidence. Reports and attestation must share the exact artifact fingerprint. Keep reports outside the immutable model directory.

```bash
/workspace/work/arabic-planner-venv/bin/python ml/arabic-planner/evaluate.py \
 --artifact /workspace/work/arabic-planner-model-v1 \
 --data /workspace/work/reviewed-test.jsonl \
 --report /workspace/work/reviewed-evaluation.json

/workspace/work/arabic-planner-venv/bin/python ml/arabic-planner/approve_release.py \
 --artifact /workspace/work/arabic-planner-model-v1 \
 --evaluation /workspace/work/reviewed-evaluation.json \
 --browser-report /workspace/work/arabic-planner-browser-report.json \
 --attestation /workspace/work/reviewer-attestation.json
```

Approval fails for smoke models, synthetic-only evaluation, missing physical-device evidence, changed policies/weights/runtime/compiler, or unmet gates. This script checks supplied evidence; it cannot establish whether a human attestation is truthful. Calibration changes invalidate approval. The browser verifies artifact hashes and builder/runtime versions before loading.

After approval, publish the model to a versioned immutable same-origin directory and the built `browser/vendor` assets with license notices. An app adapter can call:

```js
import {createPlanner} from './ml/arabic-planner/browser/client.js';
const assistant = await createPlanner('./models/arabic-planner-v1/');
const proposal = await assistant.propose('اجمع ٣ كلمات بعد «ولكن»');
// suggestion: preview the editable blocks/reference, then apply only on user action.
// clarify / loading error: keep the existing manual query builder available.
assistant.dispose(); // terminates the worker and releases its resources
```

Do not automatically execute a proposed search or store raw requests as telemetry. Preserve the existing builder, saved-link serializer, filters, captures, exclusions and search engine. This change intentionally supplies the training path and optional adapter without activating an unevaluated model for app visitors.
