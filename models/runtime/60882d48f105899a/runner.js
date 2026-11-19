// Optional inference runtime. Experimental candidates require an explicit opt-in.
import { pipeline, env } from "./vendor/transformers.js";
import "./planner-core.js";
const core = globalThis.QuranArabicPlannerCore;
async function json(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Missing planner artifact: " + url);
    return response.json();
}
async function sha(value) {
    return Array.from(
        new Uint8Array(
            await crypto.subtle.digest(
                "SHA-256",
                typeof value === "string"
                    ? new TextEncoder().encode(value)
                    : value,
            ),
        ),
    )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
}
async function readBytes(response, budget, onBytes) {
    if (!response.body?.getReader) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > budget)
            throw new Error("Artifact exceeds the download budget.");
        onBytes(buffer.byteLength);
        return buffer;
    }
    const reader = response.body.getReader(),
        chunks = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > budget) {
            await reader.cancel();
            throw new Error("Artifact exceeds the download budget.");
        }
        chunks.push(value);
        onBytes(size);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes.buffer;
}
export async function loadPlanner(
    base,
    builder,
    {
        testing = false,
        experimental = false,
        onProgress = () => {},
        builderSourceURL = "../../../js/query-builder.js",
    } = {},
) {
    const url = new URL(base, location.href);
    if (url.origin !== location.origin)
        throw new Error("Planner artifacts must be hosted on the same origin.");
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    const manifest = await json(new URL("manifest.json", url));
    const approved =
        manifest.approved === true &&
        manifest.smoke_only === false &&
        manifest.approval?.reviewer &&
        manifest.approval.artifact_fingerprint ===
            manifest.artifact_fingerprint;
    const candidate =
        experimental === true &&
        manifest.release_channel === "experimental" &&
        manifest.smoke_only === false;
    if (
        manifest.format !== "quran-arabic-planner" ||
        manifest.version !== 1 ||
        manifest.max_tokens !== 128 ||
        manifest.max_characters !== 640 ||
        (!testing && !approved && !candidate)
    )
        throw new Error("No approved Arabic planner is available.");
    if (
        !Number.isSafeInteger(manifest.total_bytes) ||
        manifest.total_bytes <= 0 ||
        manifest.total_bytes > 80 * 1024 * 1024
    )
        throw new Error("Model exceeds the browser download budget.");
    const files = {};
    let lastProgress = "";
    function progress(stage, percent) {
        const key = stage + ":" + percent;
        if (key === lastProgress) return;
        lastProgress = key;
        onProgress({ stage, percent });
    }
    if (!manifest.files || Object.keys(manifest.files).length > 50)
        throw new Error("Invalid artifact file list.");
    let downloaded = 0;
    for (const [file, digest] of Object.entries(manifest.files)) {
        if (
            !/^[a-zA-Z0-9_./-]+$/.test(file) ||
            file.startsWith("/") ||
            file.includes("..") ||
            !/^[0-9a-f]{64}$/.test(digest)
        )
            throw new Error("Invalid artifact path/hash.");
        const response = await fetch(new URL(file, url));
        if (!response.ok) throw new Error("Missing " + file);
        const bytes = await readBytes(
            response,
            80 * 1024 * 1024 - downloaded,
            (size) =>
                progress(
                    "verify",
                    Math.min(
                        100,
                        Math.round(
                            ((downloaded + size) / manifest.total_bytes) * 100,
                        ),
                    ),
                ),
        );
        downloaded += bytes.byteLength;
        if (downloaded > 80 * 1024 * 1024 || (await sha(bytes)) !== digest)
            throw new Error("Artifact size/hash mismatch: " + file);
        if (
            [
                "catalog.json",
                "references.json",
                "policy.json",
                "builder-contract.json",
                "runtime-contract.json",
                "training-report.json",
            ].includes(file)
        )
            files[file] = JSON.parse(new TextDecoder().decode(bytes));
        progress(
            "verify",
            Math.min(
                100,
                Math.round((downloaded / manifest.total_bytes) * 100),
            ),
        );
    }
    if (
        downloaded !== manifest.total_bytes ||
        [
            "catalog.json",
            "references.json",
            "policy.json",
            "builder-contract.json",
            "runtime-contract.json",
            "onnx/model_quantized.onnx",
            "tokenizer.json",
            "config.json",
            "tokenizer_config.json",
        ].some((file) => !manifest.files[file])
    )
        throw new Error("Incomplete artifact manifest.");
    if (
        candidate &&
        (files["training-report.json"]?.smoke_only !== false ||
            files["training-report.json"]?.training_steps < 100 ||
            files["training-report.json"]?.backbone !==
                "CAMeL-Lab/bert-base-arabic-camelbert-mix" ||
            !Array.isArray(files["training-report.json"]?.retained_layers))
    )
        throw new Error("A genuinely fine-tuned Arabic candidate is required.");
    for (const file of [
        "planner-core.js",
        "runner.js",
        "client.js",
        "planner-worker.js",
    ]) {
        const response = await fetch(new URL(file, import.meta.url), {
            cache: "no-store",
        });
        if (
            !response.ok ||
            (await sha(await response.text())) !==
                files["runtime-contract.json"]["browser/" + file]
        )
            throw new Error("Planner runtime changed. Revalidate the model.");
    }
    const builderResponse = await fetch(
        new URL(builderSourceURL, import.meta.url),
        { cache: "no-store" },
    );
    if (
        !builderResponse.ok ||
        (await sha(await builderResponse.text())) !==
            files["builder-contract.json"].sha256
    )
        throw new Error(
            "The query-builder version changed. Revalidate the model.",
        );
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.localModelPath = new URL("../", url).href;
    env.backends.onnx.wasm.numThreads = 1; // GitHub Pages has no COOP/COEP isolation.
    env.backends.onnx.wasm.wasmPaths = new URL(
        "./vendor/",
        import.meta.url,
    ).href;
    const name = url.pathname.split("/").filter(Boolean).pop();
    const classifier = await pipeline("text-classification", name, {
        dtype: "q8",
        device: "wasm",
        local_files_only: true,
        progress_callback: () => progress("initialize", null),
    });
    const expected = files["catalog.json"].intents.map((row) => row.id);
    if (JSON.stringify(manifest.labels) !== JSON.stringify(expected))
        throw new Error("Intent catalog/model mismatch.");
    for (let i = 0; i < expected.length; i++)
        if (classifier.model.config.id2label[i] !== expected[i])
            throw new Error("Classifier label order mismatch.");
    function tokenize(text) {
        const encoded = classifier.tokenizer(text, { truncation: false });
        return Array.from(
            encoded.input_ids.data || encoded.input_ids.flat(Infinity),
            Number,
        );
    }
    return {
        async propose(request) {
            let prepared;
            try {
                prepared = core.extract(request);
            } catch (error) {
                return { status: "clarify", reason: error.message };
            }
            if (tokenize(prepared.modelInput).length > manifest.max_tokens)
                return {
                    status: "clarify",
                    reason: "الطلب طويل؛ قسّمه إلى طلبات أقصر.",
                };
            const prediction = await classifier(prepared.modelInput, {
                top_k: expected.length,
                truncation: false,
            });
            const scores = Array.isArray(prediction[0])
                ? prediction[0]
                : prediction;
            return core.decide(
                request,
                scores,
                files["policy.json"],
                files["catalog.json"],
                files["references.json"],
                builder,
            );
        },
        // Testing methods support Python/browser tokenizer and q8 parity checks; no telemetry.
        async scores(text) {
            const result = await classifier(text, {
                top_k: expected.length,
                truncation: false,
            });
            return Array.isArray(result[0]) ? result[0] : result;
        },
        tokenize,
        async dispose() {
            await classifier.dispose();
        },
    };
}
