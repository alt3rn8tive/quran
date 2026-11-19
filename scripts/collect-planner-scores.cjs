// Collect actual browser/WASM probabilities. No user queries or remote inference service.
const fs = require("node:fs"),
    { chromium } = require("playwright");
(async () => {
    const [harness, artifact, inputPath, outputPath] = process.argv.slice(2);
    if (!outputPath)
        throw new Error("Usage: HARNESS_URL ARTIFACT_URL INPUT OUTPUT");
    const input = JSON.parse(fs.readFileSync(inputPath));
    const browser = await chromium.launch({
        executablePath: process.env.CHROME_BIN || "/usr/bin/chromium",
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
        const page = await browser.newPage();
        await page.goto(harness);
        await page.waitForFunction(() => window.plannerHarness);
        const rows = await page.evaluate(
            async ({ input, artifact }) => {
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
                await call({ type: "load", base: artifact });
                const rows = [];
                for (const row of input.rows) {
                    if (!row.model_input) {
                        rows.push({ ...row, scores: null });
                        continue;
                    }
                    const actual = await call({
                        type: "scores",
                        text: row.model_input,
                    });
                    rows.push({ ...row, scores: actual.scores });
                }
                worker.terminate();
                return rows;
            },
            { input, artifact: new URL(artifact, harness).href },
        );
        const output = {
            engine: "onnxruntime-web-wasm",
            inference_fingerprint: input.inference_fingerprint,
            rows,
        };
        fs.writeFileSync(outputPath, JSON.stringify(output) + "\n");
        console.log(
            JSON.stringify({ engine: output.engine, rows: rows.length }),
        );
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
