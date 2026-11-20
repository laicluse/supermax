import assert from "node:assert/strict";
import { chromium } from "playwright";
import { serveDocs } from "../test/serve-docs.js";

const server = await serveDocs();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`${server.url}/renderers.html`);
	await page.waitForFunction(() => window.rendererDemo?.instances.length === 2);
	await page.locator("textarea").first().fill("A draft survives a change of context.");
	await page.locator("textarea").last().fill("A draft survives a change of context.");
	await page.waitForTimeout(500);
	await page.screenshot({ path: "docs/assets/captures/renderers.png", fullPage: true });
	await page.locator('[data-action="source"]').click();
	await page.waitForTimeout(600);
	await page.locator('[data-action="back"]').click();
	await page.waitForTimeout(600);
	assert.deepEqual(await page.locator("textarea").evaluateAll((elements) => elements.map((element) => element.value)), ["A draft survives a change of context.", "A draft survives a change of context."]);
	await page.locator('[data-action="notice"]').click();
	await page.locator('[data-action="modal"]').click();
	await page.waitForTimeout(600);
	assert.equal(await page.getByRole("dialog").count(), 2);
	await page.screenshot({ path: "docs/assets/captures/renderer-overlays.png", fullPage: true });
	await page.evaluate(() => window.rendererDemo.instances.forEach(({ workspace }) => workspace.closeModal()));
	await page.waitForTimeout(500);
	await page.locator('[data-action="failure"]').click();
	await page.waitForTimeout(600);
	assert.equal(await page.locator('[data-supermax-part="error"]').count(), 2);
	while (await page.locator('[data-supermax-part="error"] button').count()) await page.locator('[data-supermax-part="error"] button').first().click();
	await page.waitForTimeout(600);
	assert.equal(await page.locator('[data-supermax-part="error"]').count(), 0);
	await page.setViewportSize({ width: 420, height: 950 });
	await page.locator('[data-action="back"]').click();
	await page.waitForTimeout(600);
	assert.deepEqual(await page.locator("textarea").evaluateAll((elements) => elements.map((element) => element.value)), ["A draft survives a change of context.", "A draft survives a change of context."]);
	assert.deepEqual(errors, []);
	console.log("Both renderers retain drafts through navigation, overlays, Retry and narrow layouts.");
} finally {
	await browser.close();
	await server.close();
}
