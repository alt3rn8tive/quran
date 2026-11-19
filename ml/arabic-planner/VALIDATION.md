# What has actually been verified

Date: 19 November 2026. This is tooling validation, **not production Arabic accuracy or physical-mobile certification**.

| Check | Observed result |
| --- | --- |
| Reproducible synthetic data | 4,096 rows; split checksums match |
| Node unit/regression tests | 11 passed, including all 4,096 expected plans against the production compiler |
| Existing AngularJS suite | 112/112 passed in Chromium Headless |
| Existing app release check | Passed; app runtime release remains `f9207c695f90` |
| Pinned Arabic tokenizer | Loaded from CAMeLBERT-Mix revision `9be352797bdf28a9ae21e2ae582aaaca7abdb22d`, 30,000 tokens |
| Smoke training | 2 optimizer steps; random two-layer BERT, hidden size 32; 32 training / 16 validation examples |
| ONNX export + embedding quantization | Successful; maximum float/int8 logit difference 0.000416 on 3 inputs |
| Browser parity | 115 requests, exact token IDs and confidence decisions; maximum probability difference 7.45e-9 |
| Browser compiler parity | 111 positive guided plans matched expected builder settings |
| Failure handling | Refused unapproved model in loader and production worker; rejected corrupted weights |
| Network | Only local same-origin requests during browser checks |
| Release approval gate | Correctly refused the smoke model and missing reviewed/device evidence |

The browser check used Chromium Headless 156 on a desktop CPU with a 390px viewport. The smoke model loaded in about 1.65s and its parity loop had a warmed p95 of about 38ms, including two classifier passes per request. **These timings and the 2.23MB smoke artifact say nothing about the full six-layer Arabic candidate's size, speed or memory.** A desktop viewport does not establish Android/iOS compatibility.

The real Arabic tokenizer was used, but the smoke classifier had randomly initialized weights. Its calibrated policy abstained on all 600 draft test requests. There are zero accepted predictions from which to estimate precision. It is deliberately ineligible for approval. No full pretrained-model fine-tuning, human-reviewed gold evaluation, physical-phone benchmark, or live AI feature activation was performed.

Machine-readable smoke evidence: [export](validation/smoke-export.json), [browser](validation/smoke-browser.json), [evaluation](validation/smoke-evaluation.json). The tested artifact fingerprint ties these reports to one local smoke artifact; weights are intentionally not committed or deployed. See [README.md](README.md) for the full training path, data-review procedure and release gates.
