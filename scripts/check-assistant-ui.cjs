// Deterministic UI checks using a simulated inference adapter; never an accuracy claim.
const assert = require("node:assert/strict"),
    { chromium } = require("playwright");
const base = process.argv[2] || "http://127.0.0.1:8780/quran/";
(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROME_BIN || "/usr/bin/chromium",
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
        for (const width of [320, 390]) {
            const page = await browser.newPage({
                    viewport: { width, height: 844 },
                }),
                assets = [];
            page.on("request", (r) => {
                if (/models\//.test(r.url())) assets.push(r.url());
            });
            await page.route("**/models/planner.json*", (r) =>
                r.fulfill({
                    json: {
                        version: 1,
                        channel: "experimental",
                        model: "models/ui-test/",
                        client: "models/runtime/ui-test/client.js",
                        bytes: 1024,
                        runtime_bytes: 1024,
                    },
                }),
            );
            await page.route("**/models/runtime/ui-test/client.js", (r) =>
                r.fulfill({
                    contentType: "application/javascript",
                    body: `export async function createPlanner(){return {async propose(){return {status:'suggestion',intent:'context_after',blocks:[{type:'context',value:'ولكن',count:3,direction:'after'}],reference:{surah:null,ayah:null}}},dispose(){}}}`,
                }),
            );
            await page.goto(base + "#!/search");
            await page.waitForSelector(".query-block");
            assert.equal(
                assets.length,
                0,
                "No model requests before opening the assistant",
            );
            const initial = page.locator(".block-text").first();
            await initial.fill("علم");
            await page.locator("#arabic-search-assistant summary").click();
            const enable = page.getByRole("button", {
                name: "تنزيل وتشغيل المساعد",
            });
            await enable.waitFor();
            assert.ok(await enable.isDisabled());
            assert.equal(
                assets.length,
                1,
                "Opening only requests the small registry",
            );
            await page
                .locator(".assistant-enable input[type=checkbox]")
                .check();
            await enable.click();
            await page
                .locator("#assistant-request")
                .fill("اجمع ٣ كلمات بعد «ولكن»");
            await page
                .getByRole("button", { name: "اقترح أجزاء البحث", exact: true })
                .click();
            await page.locator(".assistant-proposal").waitFor();
            assert.equal(await initial.inputValue(), "علم");
            const urlBefore = page.url();
            await page
                .getByRole("button", {
                    name: "استخدم هذه الأجزاء",
                    exact: true,
                })
                .click();
            assert.equal(
                page.url(),
                urlBefore,
                "Applying does not execute or change the saved link",
            );
            await page
                .getByRole("button", {
                    name: "التراجع إلى الأجزاء السابقة",
                    exact: true,
                })
                .click();
            assert.equal(await initial.inputValue(), "علم");
            await page
                .getByRole("button", { name: "اقترح أجزاء البحث", exact: true })
                .click();
            await page
                .getByRole("button", {
                    name: "استخدم هذه الأجزاء",
                    exact: true,
                })
                .click();
            await page.locator(".query-builder button[type=submit]").click();
            await page.waitForURL(/q=v1\./);
            const saved = page.url();
            await page.reload();
            await page.waitForSelector(".surrounding-controls");
            assert.equal(
                await page
                    .locator(".surrounding-controls input[type=text]")
                    .inputValue(),
                "ولكن",
            );
            assert.equal(
                await page
                    .locator(".surrounding-controls input[type=number]")
                    .inputValue(),
                "3",
            );
            assert.ok(
                !saved.includes("qb=["),
                "Saved link remains escaped and compact",
            );
            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            );
            assert.equal(overflow, false, "No horizontal overflow at " + width);
            console.log(
                JSON.stringify({
                    width,
                    preview_apply_undo: true,
                    saved_link_reload: true,
                    automatic_model_download: false,
                    overflow: false,
                    adapter: "simulated UI test only",
                }),
            );
            await page.close();
        }
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
