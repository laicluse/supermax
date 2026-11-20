import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveDocs } from "../test/serve-docs.js";

const temporary = await mkdtemp(join(tmpdir(), "supermax-variants-"));
const server = await serveDocs();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
	const context = await browser.newContext({ viewport: { width: 1100, height: 710 }, deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce", recordVideo: { dir: temporary, size: { width: 1100, height: 710 } } });
	const page = await context.newPage();
	await page.goto(`${server.url}/?delay=0&presentation=veil`);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	await page.addStyleTag({ content: ".topbar,.controls{display:none}.demo{display:block;padding:16px}.frames{flex-wrap:nowrap;gap:24px}.frame{resize:none}" });
	await page.evaluate(() => window.supermaxDemo.resize([[255, 624], [255, 616]]));
	await page.waitForFunction(() => window.supermaxDemo.frames.every(({ workspace }) => workspace.layout.width === 255));
	await page.evaluate(async () => {
		await window.supermaxDemo.replay([{ type: "open", destination: "album:coast", from: "albums" }]);
		window.supermaxDemo.resize([[549, 624], [479, 616]]);
	});
	await page.waitForFunction(() => window.supermaxDemo.pending === 0 && window.supermaxDemo.frames[1].workspace.layout.width === 479);
	await page.evaluate(async () => {
		await document.fonts.ready;
		for (const animation of document.getAnimations()) animation.finish();
		await Promise.all(window.supermaxDemo.frames.flatMap(({ workspace }) => [...workspace.chains.values()].map(({ strip }) => strip.finished)));
	});
	await page.locator(".frames").screenshot({ path: new URL("../docs/assets/captures/responsive-variants.png", import.meta.url).pathname });
	const allocations = await page.evaluate(() => window.supermaxDemo.frames.map(({ workspace }) => {
		const menu = workspace.layout.cells.get("albums");
		return { viewport: workspace.layout.width, variant: menu.variant, menu: menu.width, content: workspace.layout.chain.cells[1].width };
	}));
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.evaluate(() => {
		window.displayFrames = []; window.recording = true;
		const sample = (time) => { if (!window.recording) return; window.displayFrames.push(time); requestAnimationFrame(sample); };
		requestAnimationFrame(sample);
	});
	const started = Date.now();
	for (let index = 0; index < 6; index += 1) {
		await page.evaluate((width) => window.supermaxDemo.resize([[549, 624], [width, 616]]), index % 2 ? 479 : 549);
		await page.waitForTimeout(index === 2 ? 80 : 500);
	}
	await page.waitForTimeout(400);
	const display = await page.evaluate(() => {
		window.recording = false;
		const frames = window.displayFrames;
		const deltas = frames.slice(1).map((time, index) => time - frames[index]).sort((first, second) => first - second);
		return { frames: frames.length, meanFps: 1000 * (frames.length - 1) / (frames.at(-1) - frames[0]), p95FrameMs: deltas[Math.floor(deltas.length * .95)] };
	});
	const seconds = (Date.now() - started) / 1000;
	const video = page.video();
	await context.close();
	const output = new URL("../docs/assets/captures/responsive-variants.mp4", import.meta.url).pathname;
	execFileSync("ffmpeg", ["-y", "-v", "error", "-threads", "1", "-sseof", `-${seconds}`, "-i", await video.path(), "-c:v", "libx264", "-crf", "18", "-threads", "1", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output]);
	const encoded = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,pix_fmt,width,height:format=duration", "-of", "json", output], { encoding: "utf8" }));
	const result = { capturedAt: new Date().toISOString(), allocations, display, encoded };
	await writeFile(new URL("../docs/assets/captures/responsive-variants.json", import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify(result, null, 2));
} finally {
	await browser.close();
	await server.close();
	await rm(temporary, { recursive: true, force: true });
}
