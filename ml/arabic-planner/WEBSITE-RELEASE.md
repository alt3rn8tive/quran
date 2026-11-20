# Experimental version-2 website release

20 November 2026. This extends the optional Arabic planner to all **15 requested controls**: the twelve builder block types and the three independent beginning/end/final-harakah settings. It still previews editable blocks; applying and searching remain separate explicit actions. Fourteen verified examples are available through buttons, with additional examples collapsed by default. Global settings appear in the proposal, apply to the actual search, survive saved links, and participate in undo.

## Model, data and measurement

- CAMeLBERT-Mix, pinned upstream revision in `model.json`, retained encoder layers 0, 2, 4, 7, 9, 11. The 48-class head covers 47 bounded recipes plus clarification.
- Initialized from the previous trained Arabic checkpoint, with source hashes and inherited request provenance in `training-report.json`; real pretrained Arabic weights, never the smoke model.
- **66,591,024 parameters**; four epochs, 736 optimizer steps. Best validation macro accuracy: **92.07%**, epoch 4. Classification accuracy is separate from complete-plan accuracy below.
- **54,639 synthetic draft rows**: 29,335 training, 8,421 validation, 8,421 calibration, 8,424 test and 38 separate grounding adversarial fixtures. Fourteen independent developer-authored demonstrations are additional and do not fit weights, thresholds or test metrics. Nothing is represented as human-reviewed Arabic data.
- **2,938 unique masked training inputs** were used after deduplication, with 741 unique validation inputs. Twenty-five training and twenty validation rows were rejected during preprocessing before deduplication. Replacing literals/counts/decoded flags does not create independent language evidence.
- Calibration and test each have **740 unique non-null masked inputs**. Exact requests and masked inputs are disjoint between all four cohorts; family frames remain related synthetic language and cannot substitute for real users.
- Every target is built independently in Python and checked using the real query compiler/shared assembler, including all global settings. [Coverage](data/coverage.json) maps every requested control, numeric limits, all eight symbols, selectable letters/marks, pairwise finite features, and all eight global-option combinations in every split.
- Unsigned 8-bit ONNX package: **69,718,517 bytes (66.49 MiB)**. Additional self-hosted runtime: **21.85 MiB**. The UI rounds the combined initial download upward; transfer compression/caching may differ.
- Export plumbing: 49/49 top-class agreements between the fine-tuned model and quantized CPU export; maximum probability difference 0.007166. These development/training probes are not generalization evidence.
- Authoritative confidence calibration and evaluation use **browser ONNX Runtime WASM**: 16,907 rows collected through 1,533 deduplicated inference calls. Only calibration rows fit temperature and thresholds. Tests and demonstrations do not select those thresholds.

## Browser-native draft evaluation

Of **8,424 held-out synthetic requests**, **7,133 produced exact complete plans**, with 1,291 abstentions and no accepted mismatches in this frozen cohort. Supported-request coverage is **85.45%**. There were 0 false acceptances among only 76 unsupported examples. All 38 separate invalid-count grounding fixtures were rejected; they are not included in classifier accuracy.

These row counts include repeated masked inputs with different literals, counts and global options. The nominal row-based Wilson bounds in the machine-readable report are **not independent real-user confidence guarantees**. Empirical performance on synthetic templates is not a claim of 100% Arabic understanding. Recipe coverage varies; two recipes have no accepted held-out requests despite all twelve block types having accepted plans.

| Block type | Accepted / supported requests containing type | Exact precision on accepted draft rows |
| --- | ---: | ---: |
| `alternatives` | 320 / 320 | 100% |
| `ayahBreak` | 320 / 384 | 100% |
| `between` | 800 / 1,024 | 100% |
| `capture` | 384 / 512 | 100% |
| `context` | 128 / 256 | 100% |
| `exclude` | 640 / 640 | 100% |
| `letter` | 1,824 / 1,824 | 100% |
| `letters` | 1,174 / 1,238 | 100% |
| `symbol` | 512 / 768 | 100% |
| `text` | 2,719 / 3,326 | 100% |
| `word` | 244 / 244 | 100% |
| `words` | 180 / 244 | 100% |

Requests can contain several block types, so the table rows overlap. All three global controls have more than 3,600 accepted test plans each, with exact settings. All eight setting combinations are separately reported. Confidence cannot authorize silently dropping an explicit capture, exclusion, direction, symbol, reference or ayah-separator constraint. In particular, `بعدد` is not parsed as a direction, and distance-only requests cannot acquire an unrequested capture.

## Website verification and limits

- **134/134 AngularJS tests** and **16 planner tests** passed. The planner test validates all 54,601 main-split targets, split separation, feature coverage and adversarial grounding.
- Simulated-adapter UI checks passed at 320px and 390px: preview/apply/undo, global settings, saved-link reload and no horizontal overflow.
- The actual trained browser model passed all **14 public examples**, exact blocks/reference/settings, preservation of the previous manual draft, explicit apply/search, saved-link reload with the beginning-of-ayah checkbox restored, cancellation, same-origin model requests, and the unchanged default production gate. Desktop Chromium cold load was 4.46 seconds in this local environment; this is not a physical-phone/network benchmark.
- CPU/browser diagnostic: **142 requests**, identical tokens, guarded decisions and compiler outputs; maximum probability difference **0.040184**. The strict production tolerance is 0.001, so **numeric parity still fails**. Confidence is fitted directly on WASM scores. This diagnostic is not hidden or treated as production approval.

**The model remains explicitly experimental (`approved:false`).** Independent human-reviewed Arabic evaluation, a much larger unsupported cohort, stronger per-recipe evidence and actual Android/iOS measurements remain outstanding. Some calibration thresholds have only one successful synthetic family; `calibration_families` exposes that limitation. Written-out number words, arbitrary compositions, tafsir and semantic/root search remain unsupported. Use the manual editor when a request is unclear.

Registry version 2 prevents an older cached app from loading a settings-capable model and silently losing its settings. The new app also accepts version-1 registries and older proposals without settings. Previous immutable model/runtime directories remain intact. Model and runtime hashes are checked by the loader; no inference service receives requests.

Evidence: [native evaluation](validation/website-evaluation.json), [real website flow](validation/website-browser.json), [CPU/browser diagnostic](validation/website-parity-diagnostic.json), [registry](../../models/planner.json). The full training report, policy, hashes and licenses ship in `models/arabic-9e1deb1209dedbc5/`. The [version-1 release record](WEBSITE-RELEASE-v1.md) and its evidence are archived separately.
