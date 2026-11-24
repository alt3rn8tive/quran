// Run with the repository served on localhost, and Playwright/Chromium installed.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const base = new URL(process.argv[2] ?? "http://127.0.0.1:8780/quran/");
const bench = JSON.parse(
    fs.readFileSync(__dirname + "/benchmark.json", "utf8"),
);
const worker = new URL("models/quran-questions-e5-v1/worker.js", base);

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
                const ask = (id, question) =>
                    new Promise((resolve, reject) => {
                        instance.onerror = (error) =>
                            reject(new Error(error.message));
                        instance.onmessage = ({ data }) => {
                            if (data.id !== id) return;
                            if (data.progress) {
                                progress.push(data.progress);
                                return;
                            }
                            resolve(data);
                        };
                        instance.postMessage({ id, question });
                    });
                try {
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
                    return { actual, progress, empty, overlong };
                } finally {
                    instance.terminate();
                }
            },
            { worker: worker.href, bench },
        );
        assert.deepEqual(externalRequests, []);
        assert.ok(outcome.empty.error);
        assert.ok(outcome.overlong.error);
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
        const report = {
            questions: outcome.actual.length,
            hitsAt12: outcome.actual.filter((r) => r.hit).length,
            firstRequestMs: outcome.actual[0].elapsedMs,
            allRequestsMs: outcome.actual.at(-1).elapsedMs,
            runtimeRequests: requests,
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
