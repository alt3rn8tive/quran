# Quran verse retrieval

The questions page answers documented topics from `data/quran-questions.json` and extracts directly checkable facts from the bundled corpus. It supports locating a word or phrase, counting occurrences or matching ayat, counting the numbered ayat of a named surah, and identifying a speaker when the text names that speaker immediately before every matching quote. Unsupported or ambiguous requests show a clarification. The interface keeps verse suggestions in a separate disclosure.

Quoted text and counts match complete written Quran words in sequence within an ayah. Marks the reader supplies must match on their original letters. Unmarked letters may carry any mark. Unquoted, unmarked location questions allow common attached particles and the article. Explicit surah scopes stay within the selected surah. Arabic presentation forms and alif waṣl are normalized for comparison. Ayat are always displayed from the bundled source.

Optional retrieval combines E5 and keyword ranks. Explicit marks and quoted phrases constrain candidate references before ranking. The model receives a scope list for constrained searches, and the page checks that every answer card belongs to that scope. These ranks determine the order of reading suggestions. Direct answers use the catalog or the text rules above.

The embedding index contains all 6,236 numbered ayat from the site's `js/data.js`. It uses the query and passage prefixes from the multilingual E5 model card, then mean pools and normalizes the hidden states. Normalization removes vocalization and pause marks for ranking only. The index stores vectors as little-endian signed 16-bit integers. There are no tafsir inputs or runtime inference services.

The model retains the quantized encoder and 15,916 of the 250,037 token embedding rows. The subset preserves all Arabic token pieces, special tokens and the pieces used by the corpus and retrieval prefixes. The build checks exact tokenization parity with full E5 on 6,256 corpus and benchmark inputs, then checks embedding parity on 25 probes. The longest verse in this build uses 226 tokens. See the [model notice](MODEL-NOTICE.md) for the model and license.

The website loads `js/quran-retrieval-worker.mjs` after the user requests semantic retrieval. For a question constrained to particular verses, it passes the reference set and the worker ranks only those references. The worker verifies asset sizes and hashes before loading them and uses the site's existing Transformers.js/WASM runtime. The release's manifest records the corpus SHA-256 and first-load asset sizes.

## Build

Use Node.js and Python 3.12 with `numpy==2.2.6`, `onnx==1.17.0`, `onnxruntime==1.22.1`, `tokenizers==0.21.4` and `transformers==4.51.3`. The existing planner development environment also meets these requirements.

```sh
OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 TOKENIZERS_PARALLELISM=false \
python ml/quran-questions/build_index.py \
  --cache /workspace/work/quran-questions/upstream \
  --output /workspace/work/quran-questions/e5-v1
```

The build downloads a pinned ONNX conversion and verifies its input hashes. Before publishing an update, compare references against the current Quran corpus and use a new artifact directory for the release.

## Verification

The bundled `benchmark-report.json` records the CPU results of 20 development questions. Each case names one or more reference ayat that would support an answer. The test counts cases with any preselected ayah in the first 12 results. Human review of question coverage and judgment of other relevant ayat would require a separate evaluation.

Serve the repository locally and run the following with Playwright installed and Chromium available. The test downloads the deployed assets, verifies that all requests stay on the same origin, runs the production worker and checks ranked results, constrained verse sets, input validation, and rejection of a corrupted index.

```sh
node ml/quran-questions/check-browser.cjs http://127.0.0.1:8780/quran/
```

The development check found a preselected reference for 10 of 20 questions on the CPU and 11 of 20 in Chromium WASM. Both variants returned candidates for all questions. The metric measures retrieval coverage on this small sample. Coverage and relevance for new question phrasing will vary.
