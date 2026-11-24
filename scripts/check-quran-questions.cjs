// Run against a local or published copy using Chrome/Chromium with Playwright installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://127.0.0.1:8780/quran/';
const catalog = JSON.parse(
    fs.readFileSync('data/quran-questions.json', 'utf8'),
);
const runSemantic = process.argv.includes('--semantic');

(async function () {
    const browser = await chromium.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const errors = [];
    const modelRequests = [];
    try {
        const page = await browser.newPage({
            viewport: { width: 390, height: 844 },
        });
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
            if (/\/(?:models|onnx)\//.test(request.url()))
                modelRequests.push(request.url());
        });
        await page.goto(base + '#!/search');
        await page
            .locator('#main-menu')
            .getByRole('link', { name: 'أسئلة من القرآن', exact: true })
            .click();
        await page.locator('.questions-examples button').first().waitFor();
        assert.equal(
            await page.locator('.questions-topic-list li').count(),
            catalog.topics.length,
        );
        assert.equal(
            modelRequests.filter((url) => !url.endsWith('/manifest.json'))
                .length,
            0,
        );
        const input = page.locator('#questions-input');
        async function ask(question) {
            await input.fill(question);
            await page
                .getByRole('button', { name: 'ابحث عن إجابة', exact: true })
                .click();
            await page.locator('.questions-response').waitFor();
        }
        await page
            .locator('.questions-examples')
            .getByRole('button', { name: 'كيف أدخل الجنة؟', exact: true })
            .click();
        assert.ok(
            await page
                .locator('.questions-answer a[href="#!/surah?id=4#ayah-124"]')
                .count(),
        );
        for (const width of [320, 390, 1280]) {
            await page.setViewportSize({ width, height: 844 });
            assert.equal(
                await page.evaluate(
                    () => document.documentElement.scrollWidth > innerWidth,
                ),
                false,
                width + 'px overflow',
            );
        }
        if (process.env.QUESTIONS_SCREENSHOT)
            await page.screenshot({
                path: process.env.QUESTIONS_SCREENSHOT,
                fullPage: true,
            });
        await ask('ما هي دلائل رحمة الله؟');
        assert.ok(
            await page
                .locator('#questions-answer-title')
                .getByText('ما هي دلائل رحمة الله؟', { exact: true })
                .count(),
        );
        await page.waitForURL(/#!\/questions\?q=v1\.[\w-]+$/);
        const saved = page.url();
        await page.reload();
        await page.locator('#questions-answer-title').waitFor();
        assert.equal(await input.inputValue(), 'ما هي دلائل رحمة الله؟');
        await page.locator('.questions-answer a').first().click();
        await page.waitForURL(/#!\/surah\?id=\d+#ayah-\d+/);
        await page.locator('#' + page.url().split('#').pop()).waitFor();
        await page.goBack();
        await page.waitForURL(saved);
        await page.locator('#questions-answer-title').waitFor();
        assert.equal(await input.inputValue(), 'ما هي دلائل رحمة الله؟');
        await page
            .locator('#main-menu')
            .getByRole('link', { name: 'أسئلة من القرآن', exact: true })
            .click();
        await page.locator('.questions-examples button').first().waitFor();
        await page.locator('#questions-topic-filter').fill('بَدْر');
        assert.equal(await page.locator('.questions-topic-list li').count(), 1);

        await ask('أين ذكرت البعوضة؟');
        assert.equal(await page.locator('.questions-answer').count(), 0);
        assert.equal(
            await page.locator('.questions-related figure').count(),
            1,
        );
        assert.equal(
            await page.locator('.questions-related a').getAttribute('href'),
            '#!/surah?id=2#ayah-26',
        );
        await ask('١١٢:١–٤');
        assert.equal(
            await page.locator('.questions-related figure').count(),
            4,
        );
        await ask('ما سعر الدولار اليوم؟');
        assert.equal(
            await page.locator('.questions-related figure').count(),
            0,
        );
        assert.equal(
            modelRequests.filter((url) => !url.endsWith('/manifest.json'))
                .length,
            0,
        );

        if (runSemantic) {
            await ask('أين أجد آيات عن أطوار خلق الإنسان؟');
            await page
                .getByRole('button', {
                    name: 'نزّل النموذج وابحث',
                    exact: true,
                })
                .click();
            await page
                .getByRole('heading', {
                    name: 'آيات مقترحة للقراءة',
                    exact: true,
                })
                .waitFor({ timeout: 125000 });
            assert.ok(
                (await page.locator('.questions-related figure').count()) > 0,
            );
            assert.equal(await page.locator('.questions-answer').count(), 0);
            assert.ok(
                modelRequests.every(
                    (url) => new URL(url).origin === new URL(base).origin,
                ),
            );
        }
        assert.deepEqual(errors, []);
        console.log(
            JSON.stringify({
                topics: catalog.topics.length,
                desktop: true,
                mobileWidths: [320, 390],
                exactVerseLinks: true,
                savedQuestionReload: true,
                relatedVerses: true,
                noAutomaticModelDownload: true,
                semanticWorker: runSemantic,
                modelRequests: modelRequests.length,
            }),
        );
    } finally {
        await browser.close();
    }
})().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
