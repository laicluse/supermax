import { chromium } from "playwright";
import { serveDocs } from "../test/serve-docs.js";

const server = await serveDocs();
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function settle(page) {
	await page.waitForFunction(() => window.supermaxDemo.pending === 0);
	await page.evaluate(() => document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).forEach((animation) => animation.finish()));
	await page.waitForTimeout(100);
}

try {
	const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
	await page.goto(`${server.url}/?delay=0&presentation=veil`);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	await page.getByRole("button", { name: "Three rows: A, B, C" }).click();
	await settle(page);
	await page.evaluate(() => window.supermaxDemo.resize([[700, 500], [415, 332]]));
	await page.waitForFunction(() => window.supermaxDemo.frames[1].workspace.layout.height === 332);
	await settle(page);
	await page.locator(".frames").screenshot({ path: "docs/assets/captures/coast-default-folding.png" });

	await page.getByRole("button", { name: "Open the Coast album" }).click();
	await settle(page);
	await page.evaluate(() => window.supermaxDemo.resize([[700, 500], [401, 292]]));
	await page.waitForFunction(() => window.supermaxDemo.frames[1].workspace.layout.height === 292);
	for (let step = 0; step < 2; step += 1) {
		await page.locator('.frame[data-frame="b"] .supermax-up').click();
		await settle(page);
	}
	const visiblePages = await page.locator('.frame[data-frame="b"] .supermax-fold-cue.is-vertical:visible').count();
	if (visiblePages !== 1) throw new Error(`Expected one adjacent fold handle, found ${visiblePages}`);
	await page.locator(".frames").screenshot({ path: "docs/assets/captures/coast-reachable-after-show.png" });
	await page.evaluate(() => window.supermaxDemo.resize([[700, 500], [329, 323]]));
	await page.waitForFunction(() => window.supermaxDemo.frames[1].workspace.layout.height === 323);
	await settle(page);
	const pageHandle = page.locator('.frame[data-frame="b"] .supermax-fold-cue.is-vertical:visible');
	await pageHandle.scrollIntoViewIfNeeded();
	const box = await pageHandle.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 100, { steps: 5 });
	await page.locator(".frames").screenshot({ path: "docs/assets/captures/coast-fold-gutter-drag.png" });
	await page.mouse.up();
} finally {
	await browser.close();
	await server.close();
}
