import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ headless: true });
const results = [];
try {
	for (const dpr of [1, 1.5, 2]) {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr });
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(new URL("./fold-label-microfonts.html", import.meta.url).href);
		await page.waitForFunction(() => window.ready);
		const result = await page.evaluate(() => ({
			fonts: window.measurements,
			handles: [...document.querySelectorAll("article .handle")].map((element) => {
				const mark = element.querySelector(".supermax-fold-mark").getBoundingClientRect();
				const drawing = element.querySelector(".micro-ink, svg").getBoundingClientRect();
				return { title: element.title, detail: !!element.closest(".detail"), thickness: Math.min(mark.width, mark.height), margins: [drawing.left - mark.left, mark.right - drawing.right, drawing.top - mark.top, mark.bottom - drawing.bottom] };
			}),
		}));
		if (errors.length) throw new Error(errors.join("\n"));
		for (const font of result.fonts.filter((font) => !font.fallback)) {
			if (!font.pixelCoordinatesInteger || font.height > 6 || font.padding < 4 || font.height + 2 * font.padding !== 14) throw new Error("Native pixel grid or whitespace target violated");
		}
		for (const handle of result.handles.filter((handle) => !handle.detail)) {
			if (handle.thickness !== 14) throw new Error("Handle thickness changed");
			if (Math.max(...handle.margins) - Math.min(...handle.margins) > 0.02) throw new Error("Optical margins are unequal");
		}
		if (result.fonts.filter((font) => font.title === "DOCUMENTS").length !== 4 || result.fonts.some((font) => font.title === "DOCUMENTS" && font.fallback)) throw new Error("Missing candidate");
		if (!result.fonts.some((font) => font.title === "ÉTÉ · CAFÉ" && font.fallback)) throw new Error("Unsupported accent recovery not exercised");
		results.push({ dpr, ...result });
		if (dpr === 2) await page.screenshot({ path: new URL("./fold-label-microfonts.png", import.meta.url).pathname, fullPage: true });
		await page.close();
	}
	await writeFile(new URL("./fold-label-fonts/micro-measurements.json", import.meta.url), JSON.stringify(results, null, 2) + "\n");
	console.log("Microfont specimens: 4 candidates, both axes, 3 DPRs; 14px thickness, equal margins, native 5px/6px ink.");
} finally {
	await browser.close();
}
