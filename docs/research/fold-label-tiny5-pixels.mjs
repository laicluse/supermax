import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch({ headless: true });
const source = new URL("./fold-label-microfonts.html", import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const before = execFileSync("git", ["show", "b5bbee8:docs/research/fold-label-microfonts.html"], { cwd: root, encoding: "utf8" });
const samples = [
	["Horizontal · MESSAGES", ".h-slot .supermax-fold-mark"],
	["Vertical · DOCUMENTS", ".v-slot .supermax-fold-mark"],
	["2× detail · NOTES", ".detail .handle:not(.column) .supermax-fold-mark"],
	["2× detail · NOTES vertical", ".detail .column .supermax-fold-mark"],
];
const captures = [];
try {
	for (const [name, html] of [["Before", before], ["After", null]]) {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
		await page.goto(source.href);
		if (html) {
			await page.evaluate(() => { window.ready = false; });
			await page.setContent(html.replace("<head>", `<head><base href="${source.href}">`));
		}
		await page.waitForFunction(() => window.ready);
		const article = page.locator("article").nth(3);
		const boxes = [];
		for (const [title, selector] of samples) boxes.push({ title, rect: await article.locator(selector).boundingBox(), detail: selector.includes("detail") });
		const grey = await page.screenshot();
		await article.evaluate((element) => {
			for (const mark of element.querySelectorAll(".supermax-fold-mark")) {
				mark.style.setProperty("--supermax-canvas", "#0000ff");
				mark.style.color = "#0000ff";
				for (const glyph of mark.querySelectorAll(".micro-ink,.ink path")) glyph.style.fill = "#ff0000";
			}
		});
		const diagnostic = await page.screenshot();
		const measured = await page.evaluate(async ({ data, boxes }) => {
			const image = await createImageBitmap(await (await fetch(data)).blob());
			const canvas = document.createElement("canvas");
			canvas.width = image.width; canvas.height = image.height;
			const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
			const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			return boxes.map(({ title, rect, detail }) => {
				const outline = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }, ink = { ...outline };
				for (let y = Math.floor(rect.y * 2) - 4; y < Math.ceil((rect.y + rect.height) * 2) + 4; y++) {
					for (let x = Math.floor(rect.x * 2) - 4; x < Math.ceil((rect.x + rect.width) * 2) + 4; x++) {
						const k = (y * canvas.width + x) * 4;
						const box = pixels[k] > 200 && pixels[k + 1] < 100 && pixels[k + 2] < 100 ? ink : pixels[k + 2] > 200 && pixels[k] < 100 && pixels[k + 1] < 100 ? outline : null;
						if (box) { box.left = Math.min(box.left, x); box.right = Math.max(box.right, x); box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y); }
					}
				}
				if (!Number.isFinite(ink.left) || !Number.isFinite(outline.left)) throw new Error("Missing rendered ink or outline");
				const stroke = detail ? 4 : 2;
				return { title, detail, outline, ink, white: { left: ink.left - outline.left - stroke, right: outline.right - ink.right - stroke, top: ink.top - outline.top - stroke, bottom: outline.bottom - ink.bottom - stroke } };
			});
		}, { data: `data:image/png;base64,${diagnostic.toString("base64")}`, boxes });
		captures.push({ name, image: `data:image/png;base64,${grey.toString("base64")}`, samples: measured });
		await page.close();
	}
	const previous = captures[0].samples, current = captures[1].samples;
	if (!previous.some(({ white }) => new Set(Object.values(white)).size > 1)) throw new Error("Prior unequal pixel margins were not reproduced");
	for (const sample of current) if (Object.values(sample.white).some((count) => count !== (sample.detail ? 14 : 7))) throw new Error(`Unequal painted margins: ${JSON.stringify(sample)}`);
	const page = await browser.newPage({ viewport: { width: 1240, height: 1700 }, deviceScaleFactor: 1 });
	await page.setContent('<body style="margin:0;background:#f3f4f5"><canvas id="proof" width="1240" height="1650"></canvas></body>');
	await page.evaluate(async (captures) => {
		const canvas = document.querySelector("canvas"), ctx = canvas.getContext("2d");
		ctx.fillStyle = "#f3f4f5"; ctx.fillRect(0, 0, canvas.width, canvas.height);
		const text = (value, x, y, size = 17, color = "#25282d") => { ctx.font = `${size}px system-ui`; ctx.fillStyle = color; ctx.fillText(value, x, y); };
		text("Tiny5 · counted screen pixels", 32, 42, 27);
		text("Actual 2× browser capture. Each source pixel is enlarged 4×, without interpolation.", 32, 73, 16);
		text("Counts measure pure whitespace between visible ink and the inside of the outline.", 32, 98, 16);
		for (let column = 0; column < captures.length; column++) {
			const capture = captures[column], image = await createImageBitmap(await (await fetch(capture.image)).blob());
			const x = 32 + column * 610;
			text(capture.name, x, 146, 23);
			const positions = [178, 390, 950, 1270];
			for (let row = 0; row < capture.samples.length; row++) {
				const sample = capture.samples[row], box = sample.outline, scale = row === 3 ? 2 : 4, y = positions[row];
				text(sample.title, x, y, 16);
				const { left, right, top, bottom } = sample.white;
				text(`White pixels: L ${left} · R ${right} · T ${top} · B ${bottom}`, x, y + 25, 15);
				const width = box.right - box.left + 1, height = box.bottom - box.top + 1;
				ctx.imageSmoothingEnabled = false;
				ctx.drawImage(image, box.left, box.top, width, height, x, y + 40, width * scale, height * scale);
				ctx.strokeStyle = "rgba(0,0,0,.12)"; ctx.lineWidth = 1;
				for (let u = 0; u <= width; u++) { ctx.beginPath(); ctx.moveTo(x + u * scale + .5, y + 40); ctx.lineTo(x + u * scale + .5, y + 40 + height * scale); ctx.stroke(); }
				for (let v = 0; v <= height; v++) { ctx.beginPath(); ctx.moveTo(x, y + 40 + v * scale + .5); ctx.lineTo(x + width * scale, y + 40 + v * scale + .5); ctx.stroke(); }
			}
		}
		text("Normal handles: 14 CSS px = 28 device px. Tiny5 ink: 5 CSS px = 10 device px.", 32, 1605, 15);
		text("The fourth row is enlarged 2× to keep the vertical sample on this sheet. Library defaults are unchanged.", 32, 1630, 14);
	}, captures);
	await page.screenshot({ path: new URL("./fold-label-tiny5-pixels.png", import.meta.url).pathname, clip: { x: 0, y: 0, width: 1240, height: 1650 } });
	await writeFile(new URL("./fold-label-fonts/tiny5-pixel-measurements.json", import.meta.url), JSON.stringify(captures.map(({ name, samples }) => ({ name, samples })), null, 2) + "\n");
	console.log("Tiny5: prior unequal margins reproduced; all four sides now contain 7 white device pixels (14 in the 2× detail).");
} finally {
	await browser.close();
}
