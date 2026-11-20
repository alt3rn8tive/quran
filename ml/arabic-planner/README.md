# Arabic → Quran search components

Status: **opt-in experimental website integration; not production approved**. The search page offers an Arabic assistant after an explicit download and experimental-use acknowledgement. It previews editable blocks and never executes a search automatically. The approved-model path retains the production gates below. See [VALIDATION.md](VALIDATION.md) for the original tooling smoke checks and [WEBSITE-RELEASE.md](WEBSITE-RELEASE.md) for the website candidate's measured results.

## Model and architecture

Use [CAMeL-Lab/bert-base-arabic-camelbert-mix](https://huggingface.co/CAMeL-Lab/bert-base-arabic-camelbert-mix), an Arabic BERT pretrained on Classical Arabic, Modern Standard Arabic and dialects. Its model card declares Apache-2.0. [model.json](model.json) pins revision `9be352797bdf28a9ae21e2ae582aaaca7abdb22d`; retain the original model attribution/license when distributing derived weights.

For the browser candidate, retain pretrained embeddings and encoder layers **0, 2, 4, 7, 9, 11**, then fine-tune the version-2 **48-class** classifier: 47 bounded recipes and `clarify`. This is layer-pruned initialization, **not knowledge distillation**. Training can initialize from the previous Arabic checkpoint, reusing classifier rows by label name and recording the source weight/report hashes. Arabic pretraining alone does not establish suitability for this task.

The model chooses an intent only. Shared deterministic JavaScript extracts quoted strings and numeric counts, fills a closed recipe, and calls the actual `QuranQueryBuilder.compile`. It cannot generate regex, Quran text, arbitrary block types, or executable code. Unicode normalization applies to instruction matching; the quoted text is copied exactly, including hamza and harakat.

```text
اجمع ٣ كلمات بعد «ولكن»
  → model input: اجمع رقم كلمات بعد «عبارة»
  → context_after + exact quoted text + integer 3
  → validated context block, direction=after, count=3
  → show editable blocks for the user to review and apply
```

The browser runs int8 ONNX through Transformers.js/WASM in a Web Worker, with one thread so GitHub Pages does not need cross-origin isolation. All inference assets are self-hosted. Nothing sends requests or Quran queries to an inference service. A user must explicitly request the optional download; the existing manual builder stays immediately available.

## Version-2 scope and all requested options

See [catalog.json](catalog.json) for executable recipes and Arabic examples:

- Text matching: substring, complete word, starts with, ends with, complete phrase.
- Captures before/after text; adjacent phrases, exact/ranged word gaps, either order.
- Explicit next-ayah separator; alternatives; verse and word exclusions.
- Exact/ranged unknown letters; specific/unknown letter with harakah; shadda; optional specific letter.
- Eight named Quranic signs, with optional preceding/following word captures.
- Captured words between two texts; unknown word(s); a quoted text at an explicit surah/ayah reference.
- All three orthogonal settings, in every combination: **في بداية الآية فقط**, **في نهاية الآية فقط**, **جمع النتائج دون الحركة الأخيرة**. They are extracted outside quoted literals and returned as three booleans in `settings`, independently of intent classification.
- Standalone letter/unknown-letter/word/words/capture blocks, all five unknown-letter repetition modes, optional specific letters with any named harakah and shadda, lists of 2–10 alternatives, multiple exclusions with all four list matching modes, all gap/order variants, three consecutive ayat, cross-ayah starting references, and representative independent text-block modes.

This is a bounded recipe classifier, not unrestricted natural-language search. Text must be quoted using `«…»`, `"…"` or `“…”`; counts must be digits, including Arabic-Indic/Persian digits. Written number words and arbitrary unbounded compositions of blocks remain unsupported. An incomplete separator or exclusion without a positive search asks for clarification. Semantic, root, tafsir and grammatical searches are unsupported. Scope modifiers belong outside quoted text; a quoted phrase such as «في بداية الآية فقط» stays literal text.

Reference recipes return `{surah, ayah}` separately from blocks. The app adapter maps these to existing filters and maps `settings` to the existing beginning/end checkboxes and result-grouping switch. For cross-ayah searches the selected number is the starting ayah. The production engine remains responsible for consecutive-ayah matching and surah boundaries. Saved links use the existing `QuranSearchLink` keys; legacy saved links and older proposals without `settings` remain compatible.

## Data and review

The version-2 corpus contains **54,639 synthetic draft rows**: 29,335 training, 8,421 validation, 8,421 calibration, 8,424 test, plus 38 grounding-only adversarial fixtures. Fourteen separately authored demonstrations are not used for training, threshold fitting or test metrics. Every row is marked `reviewed:false`. No item is represented as a real user request or human-approved gold answer. Targets contain real builder settings and all three global options, not free-form explanations. [build_catalog.py](build_catalog.py) defines the Arabic template banks; [prepare_data.py](prepare_data.py) constructs gold targets independently in Python and validates them through the production compiler and shared assembler.

See [data/coverage.json](data/coverage.json) for the mapping of all **15 requested Arabic controls**, per-intent coverage and all eight global-option masks in every split. The corpus covers all 12 block types, named symbols, every selectable Arabic letter/harakah, shadda/optional combinations, numeric limits and reversed/invalid cases. Finite letter features use pairwise coverage; arbitrary infinite block compositions are not claimed.

Training uses four underlying authored templates per intent, with additional typed-component and request-frame variants. Each validation/calibration/test cohort has two new authored templates per intent. Prefix variants share their base family ID. Exact requests and normalized masked model inputs are disjoint across the four splits, and conflicting intent labels are rejected. Word/phrase literal pools are disjoint; finite letter/harakah/symbol enums intentionally recur across cohorts. These synthetic families still cannot replace independent human Arabic evaluation.

There are **2,938 unique masked training inputs**, rather than 29,335 distinct language patterns. `--deduplicate-inputs` avoids pretending that changing quoted words, numeric values or decoded global flags supplies new language evidence. Grounding-only invalid counts live in `adversarial.jsonl`: the model masks numbers, so training identical masked text as both a valid intent and `clarify` would be contradictory. Those cases test deterministic validation separately and do not inflate intent-generalization metrics.

The original one-template corpus and its limited website model are preserved in repository history; `fixtures/catalog-v1.json` is used to reconstruct the expanded catalog reproducibly. Fixed seeds, stable IDs and SHA-256 manifests make changes auditable. All performance claims must identify the dataset version, raw row count, unique model inputs and cohort provenance.

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
 --deduplicate-inputs \
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

Export quantizes both matrix multiplications **and embedding Gather weights**, so a float embedding table does not defeat the download budget. It uses unsigned 8-bit weights (U8/U8) to avoid the saturating U8/S8 CPU path and align Python evaluation with browser WASM. Transformers.js loads this as `dtype:'q8'`.

Export probes include one training template per intent and three development inputs, with duplicate masked inputs removed. They require finite scores, identical top-class decisions and a maximum softmax-probability difference of 0.02 for potentially usable suggestions. A `clarify` prediction must keep its top class; its score does not affect output because it always abstains. Both overall and suggestion probability differences are recorded, along with raw-logit differences. Raw logits are not a scale-independent accuracy measure. These probes check export plumbing, not generalization; subsequently assess the quantized model's end-to-end accuracy on the independent test set. Every export starts `approved:false` and with thresholds that reject everything until calibration. Confidence thresholds are calibrated against exact grounded plans, including the production compiler's validation.

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

The checks compare exact token IDs, all classifier probabilities, confidence decisions and compiler output. They also verify rejection of corrupted weights, refusal of unapproved smoke models, worker loading and same-origin-only requests. A narrow desktop viewport **is not a physical mobile performance test**. The fixture's positive guided plans test deterministic assembly separately from the model; they are not model accuracy measurements. Browser timing includes two classifier passes per request for parity and is a conservative development measurement.

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

Do not automatically execute a proposed search or store raw requests as telemetry. Preserve the existing builder, saved-link serializer, filters, captures, exclusions and search engine.

## Experimental website channel

The website can also offer an explicitly experimental candidate before independent review. This channel **does not grant production approval or claim the production accuracy targets**. It requires real pretrained Arabic fine-tuning (not random smoke weights), calibrated abstention, at least 30 accepted draft evaluation requests with ≥95% exact-plan precision, and the user's acknowledgement in the UI. Results remain proposals requiring a separate apply action and then a separate search action. The original production loader remains closed unless its original approval conditions pass; experimental loading requires `experimental:true` and `release_channel:'experimental'`.

The larger quantized candidate showed CPU/WASM probability differences even where decisions agreed. Website confidence is therefore calibrated and evaluated **on collected browser WASM scores**, rather than assuming CPU probabilities transfer unchanged. The stricter production probability-parity gate remains a separate unmet requirement; browser-native evaluation does not grant production approval.

After training, export and build, collect browser scores using the local server described above:

```bash
npm run --prefix ml/arabic-planner/browser build
/workspace/work/arabic-planner-venv/bin/python ml/arabic-planner/prepare_browser_evaluation.py \
 --artifact /workspace/work/arabic-planner-model-v1 \
 --output /workspace/work/browser-evaluation-input.json
node scripts/collect-planner-scores.cjs \
 http://127.0.0.1:8780/quran/ml/arabic-planner/browser/harness.html \
 http://127.0.0.1:8780/work/arabic-planner-model-v1/ \
 /workspace/work/browser-evaluation-input.json /workspace/work/browser-scores.json
/workspace/work/arabic-planner-venv/bin/python ml/arabic-planner/evaluate.py \
 --artifact /workspace/work/arabic-planner-model-v1 --calibrate \
 --browser-scores /workspace/work/browser-scores.json \
 --report /workspace/work/arabic-planner-browser-evaluation.json
/workspace/work/arabic-planner-venv/bin/python ml/arabic-planner/publish_candidate.py \
 --artifact /workspace/work/arabic-planner-model-v1 \
 --evaluation /workspace/work/arabic-planner-browser-evaluation.json \
 --experimental
npm run release
```

This copies model and runtime assets to immutable, content-addressed `models/` directories with license notices. It writes the small `models/planner.json` registry, which the website reads only when the assistant is opened. The model/WASM download starts only after the user chooses to enable it. Runtime files have versioned paths so a cached worker cannot mix with a newer model. Existing published assets are never overwritten with different bytes. Keep previous model directories for saved browser sessions; remove old versions only through a separate deliberate maintenance change.

Collected scores are tied to an inference fingerprint covering weights, tokenizer and runtime, excluding only the policy being fitted. The calibration split alone sets thresholds; test rows remain evaluation-only. The collector uses the frozen calibration/test splits, one training probe per class, and the separate demonstrations file. It deduplicates inference by canonical model input while preserving every row for complete-plan evaluation. Never put real user requests into a public score file without their authorization. The website publisher requires browser-native evaluation and refuses smoke models.

To reproduce the website flow with a simulated adapter (UI behavior only): `node scripts/check-assistant-ui.cjs`. Real model browser parity and full page inference must be checked separately. Applying a proposal preserves an undo snapshot, maps all three proposed global settings and reference filters, and uses the existing saved-link serializer when the user finally searches.
