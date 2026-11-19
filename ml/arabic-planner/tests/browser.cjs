// Run against a local static server. Playwright is test tooling, never an app dependency.
const fs = require("node:fs"),
    assert = require("node:assert/strict"),
    { chromium } = require("playwright");
async function main() {
    const [harness, artifact, fixturePath, reportPath] = process.argv.slice(2);
    if (!reportPath)
        throw new Error(
            "Usage: node tests/browser.cjs HARNESS_URL ARTIFACT_URL PYTHON_FIXTURE REPORT",
        );
    const fixture = JSON.parse(fs.readFileSync(fixturePath));
    const browser = await chromium.launch({
        executablePath: process.env.CHROME_BIN || "/usr/bin/chromium",
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
        const page = await browser.newPage({
                viewport: { width: 390, height: 844 },
            }),
            remote = [];
        page.on("request", (request) => {
            if (new URL(request.url()).origin !== new URL(harness).origin)
                remote.push(request.url());
        });
        await page.goto(harness);
        await page.waitForFunction(() => window.plannerHarness);
        const result = await page.evaluate(
            async ({ artifact, fixture }) => {
                let normalRejected = false,
                    workerRejected = false;
                try {
                    const p = await plannerHarness.loadPlanner(
                        artifact,
                        QuranQueryBuilder,
                    );
                    await p.dispose();
                } catch (error) {
                    normalRejected = /No approved/.test(error.message);
                }
                if (fixture.smoke_only && !normalRejected)
                    throw new Error(
                        "Unapproved smoke model loaded in normal mode",
                    );
                const { createPlanner } = await import("./client.js");
                if (normalRejected) {
                    try {
                        const p = await createPlanner(artifact);
                        p.dispose();
                    } catch (error) {
                        workerRejected = /No approved/.test(error.message);
                    }
                }
                const worker = new Worker(
                    new URL("../tests/inference-worker.js", location.href),
                    { type: "module" },
                );
                let next = 0;
                const pending = new Map();
                worker.onmessage = ({ data }) => {
                    const p = pending.get(data.id);
                    pending.delete(data.id);
                    data.error
                        ? p.reject(new Error(data.error))
                        : p.resolve(data.result);
                };
                const call = (payload) =>
                    new Promise((resolve, reject) => {
                        const id = ++next;
                        pending.set(id, { resolve, reject });
                        worker.postMessage({ id, ...payload });
                    });
                const start = performance.now();
                await call({ type: "load", base: artifact });
                const cold = performance.now() - start;
                const timings = [];
                let maxDifference = 0,
                    tokensEqual = true,
                    decisionsEqual = true,
                    compilerEqual = true,
                    compilerCases = 0;
                const canonical = (value) =>
                    Array.isArray(value)
                        ? value.map(canonical)
                        : value && typeof value === "object"
                          ? Object.fromEntries(
                                Object.keys(value)
                                    .sort()
                                    .map((k) => [k, canonical(value[k])]),
                            )
                          : value;
                for (const row of fixture.rows) {
                    const t = performance.now(),
                        actual = await call({
                            type: "infer",
                            text: row.model_input,
                            request: row.request,
                            intent: row.intent,
                            base: artifact,
                        });
                    timings.push(performance.now() - t);
                    tokensEqual &&=
                        JSON.stringify(actual.tokens) ===
                        JSON.stringify(row.tokens);
                    const scores = Object.fromEntries(
                        actual.scores.map((x) => [x.label, x.score]),
                    );
                    for (const expected of row.scores)
                        maxDifference = Math.max(
                            maxDifference,
                            Math.abs(scores[expected.label] - expected.score),
                        );
                    decisionsEqual &&=
                        JSON.stringify(canonical(actual.decision)) ===
                        JSON.stringify(canonical(row.decision));
                    if (row.expected.status === "suggestion") {
                        compilerCases++;
                        const expected = {
                            ...row.expected,
                            blocks: QuranQueryBuilder.normalise(
                                row.expected.blocks,
                            ),
                        };
                        compilerEqual &&=
                            JSON.stringify(canonical(actual.guided)) ===
                            JSON.stringify(canonical(expected));
                    }
                }
                worker.terminate();
                timings.sort((a, b) => a - b);
                return {
                    samples: fixture.rows.length,
                    tokenizer_exact: tokensEqual,
                    decision_exact: decisionsEqual,
                    compiler_exact: compilerEqual,
                    compiler_cases: compilerCases,
                    max_probability_difference: maxDifference,
                    cold_load_ms: cold,
                    warm_p95_ms: timings[Math.floor(timings.length * 0.95)],
                    normal_rejects_unapproved: normalRejected,
                    worker_rejects_unapproved: workerRejected,
                };
            },
            { artifact: new URL(artifact, harness).href, fixture },
        );
        await page.route("**/onnx/model_quantized.onnx", (route) =>
            route.fulfill({
                body: "corrupted",
                contentType: "application/octet-stream",
            }),
        );
        result.rejects_corrupt_weights = await page.evaluate(
            async (artifact) => {
                try {
                    await plannerHarness.loadPlanner(
                        artifact,
                        QuranQueryBuilder,
                        { testing: true },
                    );
                    return false;
                } catch (error) {
                    return /hash mismatch/.test(error.message);
                }
            },
            new URL(artifact, harness).href,
        );
        await page.unroute("**/onnx/model_quantized.onnx");
        result.same_origin_only = remote.length === 0;
        result.artifact_fingerprint = fixture.artifact_fingerprint;
        result.smoke_only = fixture.smoke_only;
        result.device =
            "Chromium headless, 390px viewport; desktop CPU (not a physical phone)";
        result.physical_mobile_verified = false;
        result.parity_pass =
            result.samples >= 100 &&
            result.tokenizer_exact &&
            result.decision_exact &&
            result.compiler_exact &&
            result.rejects_corrupt_weights &&
            result.max_probability_difference <= 0.001 &&
            result.same_origin_only;
        fs.writeFileSync(reportPath, JSON.stringify(result, null, 2) + "\n");
        assert.ok(result.parity_pass, JSON.stringify(result));
        console.log(JSON.stringify(result));
    } finally {
        await browser.close();
    }
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
