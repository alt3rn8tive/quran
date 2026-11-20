# Historical version-1 website release

19 November 2026. The search page now offers an optional Arabic planner. It previews editable blocks; applying a proposal and running the search are separate user actions. Download progress, cancellation, retry, manual editing and undo remain available.

## Actual model and evidence

- Pretrained backbone: CAMeLBERT-Mix, pinned revision in `model.json`; retained encoder layers 0, 2, 4, 7, 9, 11.
- Parameters: 66,576,413; 8 training epochs, 1,144 optimizer steps, selected best validation checkpoint at epoch 4 (macro accuracy 0.508).
- Usable training/validation rows: 2,274/583; preflight-invalid or overlong rows were skipped. All source examples are synthetic drafts, not human-reviewed requests.
- Unsigned 8-bit ONNX model package: 68,605,434 bytes (65.43 MiB). Runtime assets: 21.85 MiB. The UI conservatively displays about 88 MiB for the first download.
- Export probes: 31/31 top-class agreements; maximum probability difference for potentially usable suggestions 0.000593. These are training-template/development probes, not generalization evidence.
- Authoritative calibration/evaluation engine: **browser ONNX Runtime WASM**, using 1,236 collected calibration, held-out test and training-demo inputs. Only calibration rows fit thresholds; demonstrations do not affect test metrics.
- Held-out draft test: 600 requests; 226 accepted, all exact plans in this limited dataset; supported-request coverage 41.0%. The remainder abstained. There were 0 false acceptances among only 49 unsupported cases.
- Existing AngularJS tests: **128/128 passed**. Planner tests: **11 passed**, including all 4,096 draft target plans. UI behavior passed at 320px and 390px using a simulated adapter; the real trained candidate passed the website flow at 390px.
- Real website flow: exact proposal, previous draft preserved until apply, explicit search, saved-link reload, cancellation, same-origin model requests, default production loader still refusing the unapproved candidate. Local desktop Chromium cold load was 6.08s; this is not a phone/network benchmark.

## Limits and production status

**This is experimental, not production approved.** The 226 accepted draft examples are not proof of 100% real-user accuracy. Their 95% Wilson precision lower bound is 98.33%, below the production 99% target; supported-request coverage is also below the 60% target. Human-reviewed Arabic evaluation, larger unsupported cohorts, per-intent evidence and physical Android/iOS testing remain outstanding.

CPU and browser quantized probabilities differ (up to about 0.036 in the diagnostic sample), although token IDs and final guarded decisions agreed on 115 diagnostic requests. The strict production probability-parity check **does not pass**. Website confidence was therefore fitted and evaluated directly on WASM scores. The experimental publisher requires browser-native evidence; the production approval path and loader retain their stricter gates.

Some intents remain disabled for insufficient calibration evidence. The website shows verified working demonstrations and recommends the manual editor for other components. It does not claim unrestricted Arabic understanding, tafsir, semantic search or independent accuracy certification. Requests are processed on-device and are not sent to an inference service.

Evidence: [browser-native evaluation](validation/v1-website-evaluation.json), [real website flow](validation/v1-website-browser.json), and [CPU/browser diagnostic](validation/v1-website-parity-diagnostic.json). The deployed model's full training report and hashes are included in its versioned package, selected by [the registry](../../models/planner.json).
