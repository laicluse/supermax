import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("./fold-label-tiny5-actual-size.png", import.meta.url));
const browser = await chromium.launch({ headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 420, height: 320 }, deviceScaleFactor: 2 });
	await page.goto(new URL("./fold-label-microfonts.html", import.meta.url).href);
	await page.waitForFunction(() => window.ready);
	await page.evaluate(() => {
		const tiny = document.querySelectorAll("article")[3];
		for (const article of [...document.querySelectorAll("article")]) if (article !== tiny) article.remove();
		for (const element of document.querySelectorAll("header,.baseline,footer,.detail,.examples,.notes")) element.remove();
		tiny.querySelector("h2").textContent = "Tiny5 · actual size";
		tiny.querySelector(".meta").textContent = "14 px handle · 5 px letters";
		const style = document.createElement("style");
		style.textContent = "body{padding:24px}main{grid-template-columns:1fr}article{padding:16px}.meta{min-height:0;margin:6px 0 16px}.context{height:180px}";
		document.head.append(style);
	});
	const thicknesses = await page.locator(".context .micro-mark").evaluateAll((marks) => marks.map((mark) => {
		const box = mark.getBoundingClientRect(); return Math.min(box.width, box.height);
	}));
	if (thicknesses.length !== 2 || thicknesses.some((size) => size !== 14)) throw new Error("Actual-size handles changed thickness");
	await page.screenshot({ path });
	execFileSync("sips", ["-s", "dpiWidth", "144", "-s", "dpiHeight", "144", path], { stdio: "pipe" });
	console.log("Tiny5 actual-size PNG: 420×320 logical pixels, 840×640 image pixels, 144 dpi; both handles 14 CSS px.");
} finally {
	await browser.close();
}
