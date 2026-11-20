import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = resolve(fileURLToPath(new URL("..", import.meta.url)));
const { chromium } = createRequire(resolve(here, "package.json"))("playwright");

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? fallback : args[index + 1];
};
const runs = Number(option("runs", "5"));
const trees = option("trees", here).split(",").map((tree) => resolve(tree));
const throttle = Number(option("throttle", "4"));
const content = option("content", "demo");
const RENDERING = new Set(["UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize"]);

const steps = [
	{ name: "back", act: (page) => page.evaluate(() => window.supermaxDemo.dispatch({ type: "close" }, window.supermaxDemo.frames[0].workspace)) },
	{ name: "open", act: (page) => page.evaluate(() => document.querySelector('.frame[data-frame="a"] [data-occurrence="albums/album:coast/coast:thumbnails"] .thumb[data-destination="coast:photo:c"]').click()) },
	{ name: "replace", act: (page) => page.evaluate(() => document.querySelector('.frame[data-frame="a"] [data-occurrence="albums/album:coast/coast:thumbnails"] .thumb[data-destination="coast:photo:b"]').click()) },
	{ name: "close", act: (page) => page.evaluate(() => window.supermaxDemo.dispatch({ type: "close" }, window.supermaxDemo.frames[0].workspace)) },
];

function rendering(trace) {
	const events = JSON.parse(trace.toString()).traceEvents;
	const main = new Set(events.filter((event) => event.name === "thread_name" && event.args?.name === "CrRendererMain").map((event) => `${event.pid}:${event.tid}`));
	const totals = {};
	for (const event of events) {
		if (!RENDERING.has(event.name) || event.ph !== "X" || !main.has(`${event.pid}:${event.tid}`)) continue;
		totals[event.name] = (totals[event.name] ?? 0) + event.dur / 1000;
	}
	return totals;
}

async function measure(tree) {
	const { serveDocs } = await import(pathToFileURL(resolve(tree, "test/serve-docs.js")).href);
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome" });
	try {
		const page = await browser.newPage({ viewport: { width: 1720, height: 900 } });
		const cdp = await page.context().newCDPSession(page);
		const log = "o:album:coast@albums;o:coast:photo:c@albums/album:coast/coast:thumbnails";
		if (content === "heavy") await page.addInitScript(() => {
			const fill = (body) => {
				if (body.dataset.benchFilled) return;
				body.dataset.benchFilled = "true";
				const list = document.createElement("div");
				for (let row = 0; row < 300; row += 1) {
					const item = document.createElement("div");
					item.style.cssText = "display:flex;gap:8px;padding:6px 10px;border-bottom:1px solid #e5e5e5;box-shadow:inset 0 -1px 0 #f4f4f4;border-radius:4px;background:linear-gradient(#fff,#fafafa)";
					item.innerHTML = `<span style="width:28px;height:28px;border-radius:50%;background:hsl(${row * 37 % 360} 60% 70%)"></span><span><b>Sender ${row}</b><br><small>Subject line number ${row} with some preview text that wraps</small></span>`;
					list.append(item);
				}
				body.append(list);
			};
			new MutationObserver(() => document.querySelectorAll(".supermax-cell-body").forEach(fill)).observe(document, { childList: true, subtree: true });
		});
		await page.goto(`${server.url}/?delay=0#${log}`);
		await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2 && window.supermaxDemo.pending === 0);
		await page.evaluate(() => window.supermaxDemo.resize([[1440, 800], [260, 800]]));
		await page.evaluate(() => Promise.all(["coast:photo:b", "coast:photo:c"].map((id) => window.supermaxDemo.prepare(id))));
		await page.waitForTimeout(600);
		await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
		const result = {};
		for (const step of steps) {
			await page.evaluate(() => {
				window.benchFrames = [];
				let last = performance.now();
				const tick = (now) => { window.benchFrames.push(now - last); last = now; window.benchFrame = requestAnimationFrame(tick); };
				window.benchFrame = requestAnimationFrame(tick);
			});
			await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline"] });
			await step.act(page);
			await page.waitForTimeout(1200);
			const trace = await browser.stopTracing();
			const frames = await page.evaluate(() => { cancelAnimationFrame(window.benchFrame); return window.benchFrames; });
			const totals = rendering(trace);
			result[step.name] = { rendering: Object.values(totals).reduce((sum, value) => sum + value, 0), totals, missed: frames.filter((frame) => frame > 16.7 * 1.5).length };
		}
		return result;
	} finally {
		await browser.close();
		await server.close();
	}
}

const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const samples = new Map(trees.map((tree) => [tree, []]));
for (let run = 0; run < runs; run += 1) {
	for (const tree of run % 2 ? [...trees].reverse() : trees) samples.get(tree).push(await measure(tree));
}

const report = trees.map((tree) => {
	const runsOf = samples.get(tree);
	const perStep = Object.fromEntries(steps.map((step) => [step.name, {
		rendering: Math.round(median(runsOf.map((sample) => sample[step.name].rendering))),
		missed: median(runsOf.map((sample) => sample[step.name].missed)),
		...Object.fromEntries([...RENDERING].map((name) => [name, Math.round(median(runsOf.map((sample) => sample[step.name].totals[name] ?? 0)))])),
	}]));
	const total = Math.round(median(runsOf.map((sample) => steps.reduce((sum, step) => sum + sample[step.name].rendering, 0))));
	return { tree, total, missed: median(runsOf.map((sample) => steps.reduce((sum, step) => sum + sample[step.name].missed, 0))), perStep };
});
console.log(JSON.stringify({ runs, throttle, content, report }, null, 2));
