import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { serveDocs } from "../test/serve-docs.js";

const V1 = "f2f4cc792021bac9a4f3db29d5392c29908249e6";
const earlier = execFileSync("git", ["show", `${V1}:src/cell-strip.js`], { encoding: "utf8" });
const current = execFileSync("git", ["show", "b20b32a:src/cell-strip.js"], { encoding: "utf8" });
const server = await serveDocs(), browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
	for (const viewportWidth of [420, 960]) for (const mode of ["v1.1", "v2", "v2-left-anchor"]) {
		const page = await browser.newPage({ viewport: { width: 1200, height: 300 } });
		await page.route("**/v1-strip.js", (route) => route.fulfill({ contentType: "text/javascript", body: earlier }));
		if (mode === "v2") await page.route("**/cell-strip.js", (route) => route.fulfill({ contentType: "text/javascript", body: current }));
		if (mode === "v2-left-anchor") await page.route("**/cell-strip.js", (route) => route.fulfill({ contentType: "text/javascript", body: current.replace("(to > from && old && !old.overlay &&", "(old && !old.overlay &&") }));
		await page.goto(`${server.url}/blank`);
		const samples = await page.evaluate(async ({ mode, viewportWidth }) => {
			const { CellStrip } = await import(mode === "v1.1" ? "/v1-strip.js" : "/src/cell-strip.js");
			const { VEIL_PRESENTATION } = await import("/src/veil.js");
			const host = document.createElement("div"); host.style.cssText = `position:relative;width:${viewportWidth}px;height:160px`; document.body.append(host);
			const menu = document.createElement("div"), work = document.createElement("div");
			menu.style.cssText = "display:flex;justify-content:center;background:#eef"; menu.textContent = "C";
			const strip = new CellStrip(host, { duration: 300, settle: 0, ...(mode === "v1.1" ? {} : { motion: { ...VEIL_PRESENTATION.motion, travel: () => 300 } }) });
			const entries = (width) => [{ id: "menu", element: menu, width, visible: true }, { id: "work", element: work, width: viewportWidth-width, visible: true }];
			strip.update(entries(72), { animate: false });
			const values = [], start = performance.now();
			const sample = () => { const box = menu.getBoundingClientRect(); values.push({ time: performance.now()-start, x: box.x, width: box.width, marginLeft: getComputedStyle(menu).marginLeft }); };
			sample(); strip.update(entries(67));
			await new Promise((resolve) => { const frame = () => { sample(); if (performance.now()-start < 700) requestAnimationFrame(frame); else resolve(); }; requestAnimationFrame(frame); });
			strip.destroy(); return values;
		}, { mode, viewportWidth });
		results.push({ mode, viewportWidth, leadingEdgeRange: Math.max(...samples.map((s) => s.x))-Math.min(...samples.map((s) => s.x)), samples });
		await page.close();
	}
	if (results.some((result) => result.mode === "v2" ? result.leadingEdgeRange < 1 : result.leadingEdgeRange > .01)) throw new Error("The controlled prefix-motion hypothesis was not reproduced");
	await writeFile(new URL("../docs/research/fold-prefix-motion.json", import.meta.url), JSON.stringify({ v1: V1, resize: [72, 67], results }, null, 2) + "\n");
	const page = await browser.newPage({ viewport: { width: 980, height: 650 }, deviceScaleFactor: 1 });
	await page.setContent('<body style="margin:0"><canvas width="980" height="650"></canvas></body>');
	await page.evaluate((results) => {
		const ctx = document.querySelector("canvas").getContext("2d"); ctx.fillStyle = "#f6f7f9"; ctx.fillRect(0, 0, 980, 650);
		const text = (value, x, y, size = 15) => { ctx.fillStyle = "#25282d"; ctx.font = `${size}px system-ui`; ctx.fillText(value, x, y); };
		text("Stable prefix · controlled V1 / V2 comparison", 30, 36, 25);
		text("Same widths: menu 72 → 67 px, neighbour 348 → 353 px. Same 300 ms duration.", 30, 66);
		text("Same outcome at 420 and 960 px. Plot: 420 px. This isolates rendering from allocation policy.", 30, 90);
		for (let index = 0; index < results.length; index++) {
			const result = results[index], top = 142 + index * 156, left = 220, width = 700;
			text(result.mode, 30, top + 16, 18); text(`x range: ${result.leadingEdgeRange.toFixed(2)} px`, 30, top + 42);
			for (const delta of [0, -2, -4, -6]) { const y = top + 12 - delta * 15; ctx.strokeStyle = "#d9dde2"; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + width, y); ctx.stroke(); text(`${delta} px`, left - 45, y + 5, 12); }
			ctx.strokeStyle = ["#30343b", "#bd303d", "#157b5b"][index]; ctx.lineWidth = 2;
			ctx.beginPath(); result.samples.forEach((sample, i) => { const x = left + Math.min(700, sample.time), y = top + 12 - (sample.x - result.samples[0].x) * 15; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
			for (const time of [0, 300, 700]) text(`${time} ms`, left + time - 12, top + 128, 12);
		}
		text("V2 shifts the surviving cell left while it shrinks, then resets it. Leading-edge anchoring removes that detour.", 30, 634, 14);
	}, results.filter((result) => result.viewportWidth === 420));
	await page.screenshot({ path: new URL("../docs/research/fold-prefix-motion.png", import.meta.url).pathname });
	console.log(results.map(({ samples, ...summary }) => summary));
} finally { await browser.close(); await server.close(); }
