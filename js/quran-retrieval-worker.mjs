// Rank candidate ayat with the versioned E5 assets shared by the questions page.
import {
    env,
    pipeline,
} from "../models/runtime/04bc735bf80374db/vendor/transformers.js";

const directory = new URL("../models/quran-questions-e5-v1/", import.meta.url);
const verseReference = /^[1-9]\d{0,2}:[1-9]\d{0,2}$/;
const modelFiles = [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "onnx/model_quantized.onnx",
];
const indexFiles = ["refs.json", "vectors.i16"];
const decoder = new TextDecoder();

function normalize(text) {
    return text
        .normalize("NFKC")
        .replace(/ٱ/g, "ا")
        .replace(/[ـ\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu, "")
        .replace(/[٠-٩۰-۹]/gu, (digit) =>
            String(digit.charCodeAt(0) - (digit <= "٩" ? 0x660 : 0x6f0)),
        )
        .replace(
            /[^\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u06FA-\u06FF0-9]+/gu,
            " ",
        )
        .trim();
}

async function resource(name) {
    const response = await fetch(new URL(name, directory), {
        redirect: "error",
        mode: "same-origin",
    });
    if (!response.ok) throw new Error("Missing retrieval asset: " + name);
    return response;
}

async function verified(name, entry, onBytes) {
    if (
        !Number.isSafeInteger(entry?.bytes) ||
        entry.bytes < 1 ||
        entry.bytes > 40 * 1024 * 1024
    )
        throw new Error("Invalid retrieval asset size");
    if (!/^[0-9a-f]{64}$/.test(entry.sha256))
        throw new Error("Invalid retrieval asset hash");
    const response = await resource(name);
    const bytes = new Uint8Array(entry.bytes);
    const reader = response.body.getReader();
    let offset = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (offset + value.byteLength > bytes.length) {
            await reader.cancel();
            throw new Error("Retrieval asset exceeds expected size: " + name);
        }
        bytes.set(value, offset);
        offset += value.byteLength;
        onBytes(value.byteLength);
    }
    if (offset !== bytes.length)
        throw new Error("Unexpected retrieval asset size: " + name);
    const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    if (hash !== entry.sha256)
        throw new Error("Retrieval asset failed integrity check: " + name);
    return bytes;
}

async function initialize(id) {
    const manifest = await (await resource("manifest.json")).json();
    if (
        manifest.version !== 1 ||
        manifest.count !== 6236 ||
        manifest.dimensions !== 384
    )
        throw new Error("Unsupported Quran retrieval index");

    const required = [...modelFiles, ...indexFiles];
    const total = required.reduce(
        (sum, name) => sum + manifest.files[name].bytes,
        0,
    );
    let loaded = 0;
    let lastProgress = -1;
    function report(increment, stage) {
        loaded += increment;
        const percent = Math.floor((loaded / total) * 100);
        if (stage === "initialize" || percent !== lastProgress) {
            self.postMessage({ id, progress: { loaded, total, stage } });
            lastProgress = percent;
        }
    }
    const files = new Map();
    for (const name of required)
        files.set(
            name,
            await verified(name, manifest.files[name], (increment) =>
                report(increment, "download"),
            ),
        );

    const refs = JSON.parse(decoder.decode(files.get("refs.json")));
    const vectors = files.get("vectors.i16");
    if (
        refs.length !== manifest.count ||
        new Set(refs).size !== refs.length ||
        refs.some(
            (ref) => typeof ref !== "string" || !verseReference.test(ref),
        ) ||
        vectors.byteLength !== manifest.count * manifest.dimensions * 2
    )
        throw new Error("Corrupt Quran retrieval index");
    files.delete("refs.json");
    files.delete("vectors.i16");

    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    // Give Transformers.js only bytes fetched and verified against this release.
    env.customCache = {
        async match(path) {
            const name = new URL(path, directory).href.slice(
                directory.href.length,
            );
            if (files.has(name)) return new Response(files.get(name));
            return new Response(null, { status: 404 });
        },
        async put() {},
    };
    env.localModelPath = new URL("../", directory).pathname;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.wasmPaths = new URL(
        "../runtime/04bc735bf80374db/vendor/",
        directory,
    ).href;
    report(0, "initialize");
    const model = await pipeline(
        "feature-extraction",
        directory.pathname.split("/").at(-2),
        {
            dtype: "q8",
            device: "wasm",
            local_files_only: true,
        },
    );
    files.clear();
    return {
        model,
        refs,
        positions: new Map(refs.map((ref, index) => [ref, index])),
        vectors: new Int16Array(vectors.buffer),
        dimensions: manifest.dimensions,
    };
}

function rank(questionVector, { refs, vectors, dimensions }, candidates) {
    const results = [];
    const append = (index) => {
        let score = 0;
        for (let column = 0; column < dimensions; column++)
            score +=
                questionVector[column] * vectors[index * dimensions + column];
        results.push({ ref: refs[index], score: score / 32767 });
    };
    if (candidates) candidates.forEach(append);
    else for (let index = 0; index < refs.length; index++) append(index);
    return results.sort((a, b) => b.score - a.score).slice(0, 12);
}

let index;
let queue = Promise.resolve();
self.addEventListener("message", ({ data }) => {
    if (!Number.isSafeInteger(data?.id)) return;
    const { id, question, candidateRefs } = data;
    queue = queue.then(async () => {
        try {
            if (typeof question !== "string" || question.trim().length > 320)
                throw new Error("اكتب سؤالًا لا يتجاوز ٣٢٠ حرفًا.");
            const query = normalize(question);
            if (!/[\u0621-\u064A\u0671-\u06D3]/u.test(query))
                throw new Error("اكتب السؤال بالعربية.");
            if (
                candidateRefs !== undefined &&
                (!Array.isArray(candidateRefs) ||
                    candidateRefs.length > 6236 ||
                    candidateRefs.some(
                        (ref) =>
                            typeof ref !== "string" ||
                            !verseReference.test(ref),
                    ))
            )
                throw new Error("Invalid candidate ayah references");
            if (candidateRefs?.length === 0) {
                self.postMessage({ id, results: [] });
                return;
            }
            index ??= initialize(id).catch((error) => {
                index = null;
                throw error;
            });
            const ready = await index;
            const candidates = candidateRefs?.length
                ? Array.from(new Set(candidateRefs), (ref) =>
                      ready.positions.get(ref),
                  ).filter((position) => position !== undefined)
                : undefined;
            if (candidates?.length === 0) {
                self.postMessage({ id, results: [] });
                return;
            }
            const embedding = await ready.model("query: " + query, {
                pooling: "mean",
                normalize: true,
            });
            if (
                embedding.data.length !== ready.dimensions ||
                !embedding.data.every(Number.isFinite)
            )
                throw new Error("Invalid Quran query embedding");
            self.postMessage({
                id,
                results: rank(embedding.data, ready, candidates),
            });
        } catch (error) {
            self.postMessage({
                id,
                error:
                    error instanceof Error ? error.message : "Retrieval failed",
            });
        }
    });
});
