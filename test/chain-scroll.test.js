import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { serveDocs } from "./serve-docs.js";

test("a chain holds no scroll offset when focus lands in a cell beside content that left the window", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
		await page.goto(`${server.url}/?delay=0`);
		await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
		const offsets = await page.evaluate(async () => {
			const chains = [...document.querySelectorAll(".supermax-chain")];
			const wide = chains.filter((chain) => { chain.firstElementChild.style.minWidth = `${chain.clientWidth + 400}px`; return chain.scrollWidth > chain.clientWidth; });
			const input = document.createElement("input");
			input.style.cssText = "position:absolute;left:100%;margin-left:300px";
			wide[0].firstElementChild.append(input);
			input.focus();
			for (const chain of wide) chain.scrollLeft = 120;
			await new Promise((resolve) => requestAnimationFrame(resolve));
			return { wide: wide.length, focused: document.activeElement === input, offsets: wide.map((chain) => chain.scrollLeft) };
		});
		assert.ok(offsets.wide > 0, "the fixture makes at least one chain wider than its viewport");
		assert.equal(offsets.focused, true);
		assert.deepEqual(offsets.offsets, offsets.offsets.map(() => 0), "focus and script leave every chain where layout put it");
	} finally {
		await browser.close();
		await server.close();
	}
});
