import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { serveDocs } from "../test/serve-docs.js";

const server = process.env.SUPERMAX_DEMO_URL ? { url: process.env.SUPERMAX_DEMO_URL, close: async () => {} } : await serveDocs();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const captures = new Map();
const capture = async (locator, path) => captures.set(path, await locator.screenshot());

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
	await capture(page.locator(".frames"), "docs/assets/captures/coast-default-folding.png");

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
	await capture(page.locator(".frames"), "docs/assets/captures/coast-reachable-after-show.png");
	await page.evaluate(() => window.supermaxDemo.resize([[700, 500], [329, 323]]));
	await page.waitForFunction(() => window.supermaxDemo.frames[1].workspace.layout.height === 323);
	await settle(page);
	const pageHandle = page.locator('.frame[data-frame="b"] .supermax-fold-cue.is-vertical:visible');
	await pageHandle.scrollIntoViewIfNeeded();
	const box = await pageHandle.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 100, { steps: 5 });
	await capture(page.locator(".frames"), "docs/assets/captures/coast-fold-gutter-drag.png");
	await page.mouse.up();
	await page.evaluate(async () => {
		await window.supermaxDemo.replay([
			{ type: "open", destination: "album:coast", from: "albums" },
			{ type: "open", destination: "coast:photo:a", from: "albums/album:coast/coast:people" },
			{ type: "open", destination: "coast:metadata:a", from: "albums/album:coast/coast:people/coast:photo:a" },
			{ type: "open", destination: "coast:history:a", from: "albums/album:coast/coast:people/coast:photo:a/coast:metadata:a" },
		]);
		window.supermaxDemo.resize([[296, 335], [700, 500]]);
	});
	await page.waitForFunction(() => window.supermaxDemo.frames[0].workspace.layout.height === 335);
	await settle(page);
	const frame = page.locator('.frame[data-frame="a"]');
	await frame.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="albums/album:coast/coast:map"]').click();
	await settle(page);
	const nextPage = frame.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="albums/album:coast/coast:people"]');
	await nextPage.scrollIntoViewIfNeeded();
	const start = await nextPage.boundingBox();
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	for (const [distance, capture] of [[240, "coast-drag-title-gutter"], [270, "coast-drag-page-retained"]]) {
		await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 - distance, { steps: 5 });
		captures.set(`docs/assets/captures/${capture}.png`, await page.locator('.frame-wrapper:has(.frame[data-frame="a"])').screenshot());
	}
	await page.mouse.up();
} finally {
	await browser.close();
	await server.close();
}

for (const [path, bytes] of captures) await writeFile(path, bytes);
