// Real, published candidate through the website. Run after local candidate publication.
const fs = require("node:fs"),
    assert = require("node:assert/strict"),
    { chromium } = require("playwright");
const base = process.argv[2] || "http://127.0.0.1:8780/quran/";
(async () => {
    const info = JSON.parse(fs.readFileSync("models/planner.json"));
    assert.ok(
        info.examples.length,
        "At least one usable demonstration is required",
    );
    const training = fs
        .readFileSync("ml/arabic-planner/data/train.jsonl", "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
    const demonstrations = fs.existsSync(
        "ml/arabic-planner/data/demonstrations.jsonl",
    )
        ? fs
              .readFileSync(
                  "ml/arabic-planner/data/demonstrations.jsonl",
                  "utf8",
              )
              .trim()
              .split("\n")
              .map(JSON.parse)
        : [];
    const gold = [...training, ...demonstrations].find(
        (row) => row.request === info.examples[0],
    ).expected;
    const browser = await chromium.launch({
        executablePath: process.env.CHROME_BIN || "/usr/bin/chromium",
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
        const page = await browser.newPage({
                viewport: { width: 390, height: 844 },
            }),
            errors = [],
            requests = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (r) => {
            if (r.url().includes("/models/")) requests.push(r.url());
        });
        await page.goto(base + "#!/search");
        await page.waitForSelector(".query-block");
        assert.equal(
            requests.length,
            0,
            "No model download on initial page load",
        );
        await page.locator(".block-text").first().fill("علم");
        await page.locator("#arabic-search-assistant summary").click();
        await page.locator(".assistant-enable input[type=checkbox]").check();
        const start = Date.now();
        await page
            .getByRole("button", { name: "تنزيل وتشغيل المساعد", exact: true })
            .click();
        await page.waitForSelector("#assistant-request", { timeout: 300000 });
        const cold = Date.now() - start;
        await page.locator("#assistant-request").fill(info.examples[0]);
        await page
            .getByRole("button", { name: "اقترح أجزاء البحث", exact: true })
            .click();
        await page.waitForSelector(".assistant-proposal", { timeout: 60000 });
        const matchesGold = (gold) => {
            const proposed = angular
                .element(document.querySelector("quran-search-assistant"))
                .isolateScope().assistant.proposal;
            const canonical = (x) =>
                Array.isArray(x)
                    ? x.map(canonical)
                    : x && typeof x === "object"
                      ? Object.fromEntries(
                            Object.keys(x)
                                .sort()
                                .map((k) => [k, canonical(x[k])]),
                        )
                      : x;
            return (
                JSON.stringify(canonical(proposed.blocks)) ===
                    JSON.stringify(
                        canonical(QuranQueryBuilder.normalise(gold.blocks)),
                    ) &&
                JSON.stringify(canonical(proposed.reference)) ===
                    JSON.stringify(canonical(gold.reference)) &&
                JSON.stringify(canonical(proposed.settings || {})) ===
                    JSON.stringify(canonical(gold.settings || {}))
            );
        };
        const valid = await page.evaluate(matchesGold, gold);
        assert.ok(valid, "Real model proposes the exact intended settings");
        assert.equal(
            await page.locator(".assistant-examples button").count(),
            info.examples.length,
        );
        if (info.examples.length > 3)
            await page.locator(".assistant-more-examples summary").click();
        for (const request of info.examples.slice(1)) {
            const target = [...training, ...demonstrations].find(
                (row) => row.request === request,
            )?.expected;
            assert.ok(target, "Every public example has an independent target");
            await page
                .getByRole("button", { name: request, exact: true })
                .click();
            assert.equal(
                await page.locator("#assistant-request").inputValue(),
                request,
            );
            await page
                .getByRole("button", { name: "اقترح أجزاء البحث", exact: true })
                .click();
            await page.waitForSelector(".assistant-proposal", {
                timeout: 60000,
            });
            assert.ok(await page.evaluate(matchesGold, target), request);
        }
        await page.setViewportSize({ width: 320, height: 844 });
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
        );
        await page.setViewportSize({ width: 390, height: 844 });
        // Restore the first proposal for apply/search/reload checks below.
        await page.locator("#assistant-request").fill(info.examples[0]);
        await page
            .getByRole("button", { name: "اقترح أجزاء البحث", exact: true })
            .click();
        await page.waitForSelector(".assistant-proposal", { timeout: 60000 });
        if (process.env.ASSISTANT_SCREENSHOT)
            await page.screenshot({
                path: process.env.ASSISTANT_SCREENSHOT,
                fullPage: true,
            });
        assert.equal(
            await page.locator(".block-text").first().inputValue(),
            "علم",
            "A suggestion does not replace existing work",
        );
        const before = page.url();
        await page
            .getByRole("button", { name: "استخدم هذه الأجزاء", exact: true })
            .click();
        assert.equal(page.url(), before);
        await page.locator(".query-builder button[type=submit]").click();
        await page.waitForURL(/q=v1\./);
        const saved = page.url();
        await page.reload();
        await page.waitForSelector(".query-block");
        const restored = await page.evaluate(() =>
            JSON.parse(
                QuranSearchLink.parameters(
                    angular
                        .element(document.querySelector(".ng-view"))
                        .injector()
                        .get("$location")
                        .search(),
                ).qb,
            ),
        );
        assert.equal(restored[0].type, gold.blocks[0].type);
        assert.equal(restored[0].value, gold.blocks[0].value);
        if (gold.settings) {
            assert.equal(
                await page
                    .locator(
                        'input[ng-model="searchConfig.searchFromBeginning"]',
                    )
                    .isChecked(),
                gold.settings.searchFromBeginning,
            );
            assert.equal(
                await page
                    .locator('input[ng-model="searchConfig.searchOnEnd"]')
                    .isChecked(),
                gold.settings.searchOnEnd,
            );
            assert.equal(
                await page
                    .locator('input[ng-model="shouldRemoveLastHarakah"]')
                    .isChecked(),
                gold.settings.removeLastHarakah,
            );
        }
        const approvalRejected = await page.evaluate(async (info) => {
            const { createPlanner } = await import(
                new URL(info.client, document.baseURI).href
            );
            try {
                const model = await createPlanner(
                    new URL(info.model, document.baseURI).href,
                );
                model.dispose();
                return false;
            } catch (error) {
                return /No approved/.test(error.message);
            }
        }, info);
        assert.ok(
            approvalRejected,
            "The default production channel still refuses an unapproved candidate",
        );
        await page.route("**/models/arabic-*/manifest.json", async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 500));
            await route.continue().catch(() => {});
        });
        await page.locator("#arabic-search-assistant summary").click();
        await page.locator(".assistant-enable input[type=checkbox]").check();
        await page
            .getByRole("button", { name: "تنزيل وتشغيل المساعد", exact: true })
            .click();
        await page
            .getByRole("button", { name: "إلغاء التحميل", exact: true })
            .click();
        await page.waitForFunction(
            () =>
                angular
                    .element(document.querySelector("quran-search-assistant"))
                    .isolateScope().assistant.status === "idle",
        );
        assert.ok(
            !(await page.locator("#assistant-request").count()),
            "Cancellation leaves the manual builder available",
        );
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
        );
        assert.deepEqual(errors, []);
        assert.ok(
            requests.every(
                (url) => new URL(url).origin === new URL(base).origin,
            ),
        );
        const report = {
            real_pretrained_candidate: true,
            smoke_only: false,
            example: info.examples[0],
            exact_proposal: true,
            exact_public_examples: info.examples.length,
            responsive_widths: [320, 390],
            manual_draft_preserved: true,
            explicit_apply_and_search: true,
            saved_link_reload: true,
            default_production_gate_intact: true,
            cancellation: true,
            same_origin_model_requests: true,
            cold_load_ms: cold,
            viewport: 390,
            physical_mobile_verified: false,
            artifact_fingerprint: info.fingerprint,
            saved_link: saved,
        };
        if (process.argv[3])
            fs.writeFileSync(
                process.argv[3],
                JSON.stringify(report, null, 2) + "\n",
            );
        console.log(JSON.stringify(report));
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
