// Run with the repository served on localhost, and Playwright/Chromium installed.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const base = new URL(process.argv[2] ?? "http://127.0.0.1:8780/quran/");
const bench = JSON.parse(
    fs.readFileSync(__dirname + "/benchmark.json", "utf8"),
);
const worker = new URL("js/quran-retrieval-worker.mjs", base);

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROME_BIN || "/usr/bin/chromium",
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
        const page = await browser.newPage();
        const requests = [];
        const externalRequests = [];
        await page.route("**/*", (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== base.origin) {
                externalRequests.push(url.href);
                return route.abort();
            }
            requests.push(url.href);
            return route.continue();
        });
        await page.goto(new URL("version.json", base).href);
        const outcome = await page.evaluate(
            async ({ worker, bench }) => {
                const instance = new Worker(worker, { type: "module" });
                const progress = [];
                const ask = (id, question, candidateRefs) =>
                    new Promise((resolve, reject) => {
                        instance.onerror = (error) =>
                            reject(new Error(error.message));
                        instance.onmessage = ({ data }) => {
                            if (data.id !== id) return;
                            if (data.progress) {
                                progress.push({
                                    ...data.progress,
                                    id: data.id,
                                });
                                return;
                            }
                            resolve(data);
                        };
                        instance.postMessage({ id, question, candidateRefs });
                    });
                try {
                    const emptyScope = await ask(-1, bench[0].question, []);
                    const start = performance.now();
                    const actual = [];
                    for (const [index, { question, refs }] of bench.entries()) {
                        const { results, error } = await ask(index, question);
                        if (error) throw new Error(error);
                        actual.push({
                            question,
                            results,
                            hit: results.some(({ ref }) => refs.includes(ref)),
                            elapsedMs: Math.round(performance.now() - start),
                        });
                    }
                    const empty = await ask(bench.length, "123");
                    const overlong = await ask(
                        bench.length + 1,
                        "س".repeat(321),
                    );
                    const scoped = await ask(
                        bench.length + 2,
                        bench[0].question,
                        ["114:1", "114:1", "1:1", "114:999"],
                    );
                    const unknown = await ask(
                        bench.length + 3,
                        bench[0].question,
                        ["114:999"],
                    );
                    const malformed = await ask(
                        bench.length + 4,
                        bench[0].question,
                        ["114:1", null],
                    );
                    return {
                        actual,
                        progress,
                        empty,
                        overlong,
                        emptyScope,
                        scoped,
                        unknown,
                        malformed,
                    };
                } finally {
                    instance.terminate();
                }
            },
            { worker: worker.href, bench },
        );
        assert.deepEqual(externalRequests, []);
        assert.ok(outcome.empty.error);
        assert.ok(outcome.overlong.error);
        assert.deepEqual(outcome.emptyScope.results, []);
        assert.equal(outcome.progress.filter((p) => p.id === -1).length, 0);
        assert.deepEqual(
            outcome.scoped.results.map((result) => result.ref).sort(),
            ["114:1", "1:1"],
        );
        assert.deepEqual(outcome.unknown.results, []);
        assert.match(outcome.malformed.error, /candidate ayah references/);
        assert.ok(
            outcome.progress.some(
                (p) => p.stage === "initialize" && p.loaded === p.total,
            ),
        );
        for (const { results } of outcome.actual) {
            assert.equal(results.length, 12);
            assert.equal(new Set(results.map(({ ref }) => ref)).size, 12);
            results.forEach(({ ref, score }, i) => {
                assert.match(ref, /^\d+:\d+$/);
                assert.ok(Number.isFinite(score));
                if (i) assert.ok(score <= results[i - 1].score);
            });
        }
        // The browser scores all questions locally after one model/index load.
        assert.equal(
            requests.filter((url) => url.endsWith("/onnx/model_quantized.onnx"))
                .length,
            1,
        );
        assert.ok(requests.every((url) => !new URL(url).search));
        const modelRequests = [...requests];
        const malformedRefs = fs
            .readFileSync(
                __dirname + "/../../models/quran-questions-e5-v1/refs.json",
                "utf8",
            )
            .replace('"1:1"', '"1:2"');
        await page.route("**/models/quran-questions-e5-v1/refs.json", (route) =>
            route.fulfill({
                contentType: "application/json",
                body: malformedRefs,
            }),
        );
        const corruptError = await page.evaluate(async (worker) => {
            const instance = new Worker(worker, { type: "module" });
            try {
                return await new Promise((resolve, reject) => {
                    instance.onerror = (error) =>
                        reject(new Error(error.message));
                    instance.onmessage = ({ data }) => {
                        if (!data.progress) resolve(data.error);
                    };
                    instance.postMessage({
                        id: 1,
                        question: "أين ذكر الصبر؟",
                        candidateRefs: ["2:153"],
                    });
                });
            } finally {
                instance.terminate();
            }
        }, worker.href);
        assert.match(corruptError, /failed integrity check: refs.json/);
        const report = {
            questions: outcome.actual.length,
            hitsAt12: outcome.actual.filter((r) => r.hit).length,
            firstRequestMs: outcome.actual[0].elapsedMs,
            allRequestsMs: outcome.actual.at(-1).elapsedMs,
            scopedReferences: outcome.scoped.results.map(({ ref }) => ref),
            rejectsCorruptIndex: true,
            runtimeRequests: modelRequests,
            cases: outcome.actual,
        };
        console.log(JSON.stringify(report, null, 2));
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
