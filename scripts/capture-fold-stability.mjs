import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveDocs } from "../test/serve-docs.js";

const directory = await mkdtemp(join(tmpdir(), "supermax-fold-stability-"));
const server = await serveDocs(), browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 920, height: 790 }, recordVideo: { dir: directory, size: { width: 920, height: 790 } } });
const baseline = Object.fromEntries(["cell-strip.js", "navigation.js", "layout.js"].map((file) => [file, execFileSync("git", ["show", `b20b32a:src/${file}`], { encoding: "utf8" })]));
try {
	const page = await context.newPage();
	for (const [file, body] of Object.entries(baseline)) await page.route(`**/${file}`, (route) => route.request().frame().url().includes("variant=baseline") ? route.fulfill({ contentType: "text/javascript", body }) : route.continue());
	await page.goto(`${server.url}/blank`);
	await page.setContent(`<style>body{margin:0;padding:20px;background:#f4f6f9;color:#253344;font:16px system-ui}h1{margin:0 0 8px;font-size:22px}p{margin:0 0 14px;color:#536477}main{display:flex;gap:30px}h2{font-size:16px;margin:0 0 8px}iframe{width:420px;height:670px;border:0;background:white}</style><h1>Local fold · stable surrounding cells</h1><p>Identical gallery, 420 × 640 px, Origami, normal speed</p><main>${["baseline", "combined"].map((variant) => `<section><h2>${variant === "baseline" ? "Before" : "After: both corrections"}</h2><iframe src="${server.url}/?delay=0&presentation=origami&variant=${variant}"></iframe></section>`).join("")}</main>`);
	const frames = page.frames().filter((frame) => frame.parentFrame());
	for (const frame of frames) {
		await frame.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
		await frame.addStyleTag({ content: "body{margin:0;padding:0}.shell,.demo{display:block;max-width:none;margin:0;padding:0}.topbar,.controls{display:none}.stage{overflow:visible}.frames{gap:0}.frame-wrapper:first-child{display:none}" });
		await frame.evaluate(async () => {
			window.supermaxDemo.resize([[960, 640], [960, 640]]);
			await window.supermaxDemo.replay([
				{ type: "open", destination: "album:coast", from: "albums" },
				...["thumbnails", "map", "people"].map((row) => ({ type: "open", destination: "coast:photo:a", from: `albums/album:coast/coast:${row}` })),
				{ type: "open", destination: "coast:metadata:a", from: "albums/album:coast/coast:map/coast:photo:a" },
			]);
			window.supermaxDemo.resize([[420, 640], [420, 640]]);
		});
		await frame.waitForFunction(() => window.supermaxDemo.pending === 0);
		await frame.evaluate(async () => { await document.fonts.ready; document.getAnimations().forEach((animation) => animation.finish()); });
		for (const row of ["thumbnails", "people"]) {
			const cue = frame.locator(`.frame[data-frame="b"] .supermax-fold-cue.is-horizontal[data-fold-occurrence="albums/album:coast/coast:${row}"]:visible`);
			if (await cue.count()) { await cue.click(); await frame.evaluate(() => document.getAnimations().forEach((animation) => animation.finish())); }
		}
	}
	await page.waitForTimeout(300);
	await page.screenshot({ path: new URL("../docs/assets/captures/fold-stability.png", import.meta.url).pathname });
	for (const frame of frames) await frame.evaluate(() => {
		window.displayFrames = []; window.recording = true;
		const sample = (time) => { if (!window.recording) return; window.displayFrames.push(time); requestAnimationFrame(sample); };
		requestAnimationFrame(sample);
	});
	const started = Date.now();
	for (let click = 0; click < 14; click++) {
		for (const frame of frames) await frame.evaluate(() => document.querySelector('.frame[data-frame="b"] .supermax-fold-cue.is-horizontal[data-fold-occurrence^="albums/album:coast/coast:people"]:not([hidden])')?.click());
		await page.waitForTimeout(90);
	}
	await page.waitForTimeout(1200);
	const display = [];
	for (const frame of frames) display.push(await frame.evaluate(() => {
		window.recording = false;
		const times = window.displayFrames;
		const deltas = times.slice(1).map((time, index) => time - times[index]).sort((left, right) => left - right);
		return { variant: new URL(location.href).searchParams.get("variant"), frames: times.length, meanFps: 1000 * (times.length - 1) / (times.at(-1) - times[0]), medianFrameMs: deltas[Math.floor(deltas.length / 2)], p95FrameMs: deltas[Math.floor(deltas.length * .95)] };
	}));
	const seconds = (Date.now() - started) / 1000 + .2;
	const video = page.video();
	await context.close();
	const output = new URL("../docs/assets/captures/fold-stability.mp4", import.meta.url).pathname;
	execFileSync("ffmpeg", ["-y", "-v", "error", "-threads", "1", "-sseof", `-${seconds}`, "-i", await video.path(), "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output]);
	const encoded = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,pix_fmt,r_frame_rate,width,height:format=duration", "-of", "json", output], { encoding: "utf8" }));
	const variants = [];
	for (const variant of ["baseline", "anchor", "allocation", "combined"]) {
		const rows = JSON.parse(await readFile(new URL(`../docs/research/fold-stability-${variant}.json`, import.meta.url), "utf8"));
		variants.push({ variant, results: rows.filter((row) => row.action).map(({ samples, events, ...result }) => result) });
	}
	await writeFile(new URL("../docs/research/fold-stability-verification.json", import.meta.url), JSON.stringify({ display, encoded, variants }, null, 2) + "\n");
	console.log({ display, encoded });
} finally { await browser.close(); await server.close(); await rm(directory, { recursive: true }); }
