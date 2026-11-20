import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ headless: true });
const results = [];
try {
	for (const dpr of [1, 1.5, 2]) {
		const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: dpr });
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(new URL("./fold-label-typography.html", import.meta.url).href);
		await page.waitForFunction(() => window.ready);
		const measurements = await page.evaluate(() => ({
			fonts: window.measurements,
			handles: [...document.querySelectorAll(".label-mark")].map((element) => {
				const rect = element.getBoundingClientRect();
				const ink = element.querySelector(".ink-drawing").getBoundingClientRect();
				return {
					width: rect.width, height: rect.height, padding: getComputedStyle(element).padding, detail: !!element.closest(".detail"),
					visibleMargins: { left: ink.left - rect.left, right: rect.right - ink.right, top: ink.top - rect.top, bottom: rect.bottom - ink.bottom },
				};
			}),
		}));
		if (errors.length) throw new Error(errors.join("\n"));
		if (measurements.handles.filter((handle) => !handle.detail).some((handle) => Math.min(handle.width, handle.height) !== 14 || handle.padding !== "3px")) throw new Error("Handle thickness or padding changed");
		if (measurements.handles.filter((handle) => !handle.detail).some((handle) => Object.values(handle.visibleMargins).some((margin) => Math.abs(margin - 3) > 0.02))) throw new Error("Visible glyph margins are unequal");
		if (measurements.fonts.some((font) => font.inkHeight > 8.01)) throw new Error("Glyph ink exceeds short-axis budget");
		if (measurements.fonts.some(({ raster, devicePixelRatio }) => raster.left !== 0 || raster.top !== 0 || raster.height !== Math.round(8 * devicePixelRatio))) throw new Error("Glyph raster retains font whitespace");
		results.push({ dpr, ...measurements });
		if (dpr === 2) await page.screenshot({ path: new URL("./fold-label-typography.png", import.meta.url).pathname, fullPage: true });
		await page.close();
	}
	await writeFile(new URL("./fold-label-fonts/measurements.json", import.meta.url), JSON.stringify(results, null, 2) + "\n");
	console.log("Fold-label specimens: 3 DPRs, both orientations, 14px thickness, 8px visible ink, four equal 3px optical margins.");
} finally {
	await browser.close();
}
