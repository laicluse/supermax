import { chromium } from "playwright";
import { serveDocs } from "../test/serve-docs.js";

const server = await serveDocs();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
	await page.goto(server.url);
	await page.getByRole("button", { name: "Folding: cells and rows", exact: true }).click();
	await page.waitForFunction(() => window.supermaxDemo.pending === 0);
	await page.evaluate(async () => { await document.fonts.ready; document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).forEach((animation) => animation.finish()); });
	await page.locator(".frames").screenshot({ path: new URL("../docs/assets/captures/folding.png", import.meta.url).pathname });
} finally {
	await browser.close();
	await server.close();
}
