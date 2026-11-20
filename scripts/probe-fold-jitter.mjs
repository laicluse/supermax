import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { serveDocs } from "../test/serve-docs.js";

const server = await serveDocs();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const variant = process.argv.find((argument) => argument.startsWith("--variant="))?.split("=")[1] ?? "combined";
if (!["baseline", "anchor", "allocation", "combined"].includes(variant)) throw new Error(`Unknown variant: ${variant}`);
const baseline = (file) => execFileSync("git", ["show", `b20b32a:src/${file}`], { encoding: "utf8" });
try {
	const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 2 });
	const files = variant === "baseline" ? ["cell-strip.js", "layout.js", "navigation.js"] : variant === "anchor" ? ["layout.js", "navigation.js"] : variant === "allocation" ? ["cell-strip.js"] : [];
	for (const file of files) await page.route(`**/${file}`, (route) => route.fulfill({ contentType: "text/javascript", body: baseline(file) }));
	await page.goto(`${server.url}/?delay=0&presentation=veil`);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	const settle = async () => {
		await page.waitForFunction(() => window.supermaxDemo.pending === 0);
		await page.evaluate(async () => { await document.fonts.ready; document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).forEach((a) => a.finish()); });
		await page.waitForTimeout(80);
	};
	for (const presentation of ["veil", "origami", "fold"]) {
	await page.evaluate((presentation) => window.supermaxDemo.setPresentation(presentation), presentation);
	for (const [width, height] of [[420, 640], [960, 640]]) {
		await page.evaluate(async ({ width, height }) => {
			window.supermaxDemo.resize([[960, height], [960, height]]);
			const actions = [
				{ type: "open", destination: "album:coast", from: "albums" },
				{ type: "open", destination: "coast:photo:a", from: "albums/album:coast/coast:thumbnails" },
				{ type: "open", destination: "coast:photo:a", from: "albums/album:coast/coast:map" },
				{ type: "open", destination: "coast:metadata:a", from: "albums/album:coast/coast:map/coast:photo:a" },
				{ type: "open", destination: "coast:photo:a", from: "albums/album:coast/coast:people" },
			];
			if (width > 700) actions.push(
				{ type: "open", destination: "coast:metadata:a", from: "albums/album:coast/coast:people/coast:photo:a" },
				{ type: "open", destination: "coast:history:a", from: "albums/album:coast/coast:people/coast:photo:a/coast:metadata:a" },
				{ type: "open", destination: "coast:edit:a:1", from: "albums/album:coast/coast:people/coast:photo:a/coast:metadata:a/coast:history:a" },
			);
			await window.supermaxDemo.replay(actions);
			window.supermaxDemo.resize([[width, height], [width, height]]);
		}, { width, height });
		await settle();
		const frame = page.locator('.frame[data-frame="b"]');
		for (const row of ["thumbnails", "people"]) {
			const rootCue = frame.locator(`.supermax-fold-cue.is-horizontal[data-fold-occurrence="albums/album:coast/coast:${row}"]:visible`);
			if (await rootCue.count()) { await rootCue.click(); await settle(); }
		}
		for (let trade = 0; trade < 3; trade++) {
			const cue = frame.locator('.supermax-fold-cue.is-horizontal[data-fold-occurrence^="albums/album:coast/coast:people"]:visible').first();
			if (!await cue.count()) { results.push({ presentation, width, height, trade, missing: true }); break; }
			await cue.scrollIntoViewIfNeeded();
			const direction = await cue.getAttribute("data-direction"), box = await cue.boundingBox();
			const x = box.x + box.width / 2, y = box.y + box.height / 2, sign = direction === "left" ? -1 : 1;
			await page.mouse.move(x, y); await page.mouse.down();
			const samples = [];
			for (const distance of [0, 5, 12, 25, 40, 70, 100, 140, 180, 230, 280, 230, 180, 140, 100, 70, 40, 25, 12, 5, 0]) {
				await page.mouse.move(x + sign * distance, y, { steps: 2 });
				samples.push(await frame.evaluate((element) => {
					const workspace = window.supermaxDemo.frames[1].workspace;
					const menu = workspace.cells.get("albums").element, room = menu.parentElement;
					const root = workspace.chains.get("albums").strip;
					const button = menu.querySelector(".album-list button");
					return { progress: workspace.folds.drag?.progress, menu: menu.getBoundingClientRect().toJSON(), button: button?.getBoundingClientRect().toJSON(), room: room.getBoundingClientRect().toJSON(), target: workspace.layout.cells.get("albums").width, strip: getComputedStyle(root.strip).transform, rootRooms: root.entries.map((entry) => ({ id: entry.id, target: entry.width, width: root.boxOf(entry).getBoundingClientRect().width, margin: getComputedStyle(root.boxOf(entry)).marginRight })) };
				}));
			}
			await page.mouse.up(); await settle();
			const range = (read) => Math.max(...samples.map(read)) - Math.min(...samples.map(read));
			results.push({ presentation, width, height, trade, direction, menuX: range((s) => s.menu.x), menuWidth: range((s) => s.menu.width), buttonX: range((s) => s.button?.x ?? 0), targetWidth: range((s) => s.target), samples });
		}
		await page.evaluate(() => {
			window.clickSamples = []; window.clickEvents = []; window.clickSampling = true;
			const workspace = window.supermaxDemo.frames[1].workspace;
			const listeners = ["change", "foldfocus"].map((type) => {
				const handler = (event) => window.clickEvents.push({ type, time: performance.now(), detail: event.detail });
				workspace.addEventListener(type, handler); return [type, handler];
			});
			window.stopClickProbe = () => listeners.forEach(([type, handler]) => workspace.removeEventListener(type, handler));
			const sample = () => {
				if (!window.clickSampling) return;
				const w = window.supermaxDemo.frames[1].workspace, m = w.cells.get("albums").element;
				window.clickSamples.push({ time: performance.now(), x: m.getBoundingClientRect().x, width: m.getBoundingClientRect().width, button: m.querySelector(".album-list button")?.getBoundingClientRect().x, target: w.layout.cells.get("albums").width, strip: getComputedStyle(w.chains.get("albums").strip.strip).transform });
				requestAnimationFrame(sample);
			}; sample();
		});
		for (let click = 0; click < 8; click++) {
			const cue = frame.locator('.supermax-fold-cue.is-horizontal[data-fold-occurrence^="albums/album:coast/coast:people"]:visible').first();
			if (!await cue.count()) break;
			await cue.evaluate((element) => element.click());
			await page.waitForTimeout(60);
		}
		await page.waitForTimeout(700);
		const clicks = await page.evaluate(() => { window.clickSampling = false; window.stopClickProbe(); return window.clickSamples; });
		const span = (key) => Math.max(...clicks.map((s) => s[key])) - Math.min(...clicks.map((s) => s[key]));
		results.push({ presentation, width, height, action: "rapid clicks", variant, events: await page.evaluate(() => window.clickEvents), menuX: span("x"), menuWidth: span("width"), buttonX: span("button"), targetWidth: span("target"), samples: clicks });
	}
	}
	await writeFile(new URL(`../docs/research/fold-stability-${variant}.json`, import.meta.url), JSON.stringify(results) + "\n");
	console.log(results.filter((result) => result.action).map(({ samples, events, ...summary }) => ({ ...summary, events: events.length })));
} finally { await browser.close(); await server.close(); }
