#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const USAGE = `Usage: cell-sweep.mjs <url> --out <directory> [--height 860] [--format mp4|gif] [--step 8] [--elastic-max 1440] [--only <text>]

Records one clip per cell of the route at <url>, cropped to that cell, growing from its declared minimum width to its maximum.`;

function options(argv) {
	const result = { height: 860, format: "mp4", step: 8, "elastic-max": 1440, only: null, out: null, url: null };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (!argument.startsWith("--")) { result.url = argument; continue; }
		const key = argument.slice(2);
		if (!(key in result) || key === "url") fail(`Unknown option ${argument}\n\n${USAGE}`);
		const value = argv[index += 1];
		if (value === undefined) fail(`${argument} needs a value\n\n${USAGE}`);
		result[key] = ["height", "step", "elastic-max"].includes(key) ? Number(value) : value;
	}
	if (!result.url || !result.out) fail(USAGE);
	if (!["mp4", "gif"].includes(result.format)) fail("--format is mp4 or gif");
	if (![result.height, result.step, result["elastic-max"]].every((number) => Number.isFinite(number) && number > 0)) fail("--height, --step and --elastic-max are positive numbers");
	return result;
}

class Abort extends Error {}

function fail(message) {
	throw new Abort(message);
}

function chromePath() {
	const candidates = [
		process.env.CHROME_PATH,
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		...["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].map((name) => spawnSync("which", [name], { encoding: "utf8" }).stdout.trim()),
	].filter(Boolean);
	return candidates.find((candidate) => existsSync(candidate)) ?? fail("No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.");
}

function launch(profile) {
	const chrome = spawn(chromePath(), ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
	const endpoint = new Promise((found, failed) => {
		let log = "";
		const timer = setTimeout(() => failed(new Abort("Chrome did not start within 20 seconds")), 20000);
		chrome.stderr.on("data", (chunk) => {
			log += chunk;
			const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
			if (!match) return;
			clearTimeout(timer);
			found(match[1]);
		});
		chrome.on("error", (error) => {
			clearTimeout(timer);
			failed(new Abort(`Chrome could not start: ${error.message}`));
		});
		chrome.on("exit", () => {
			clearTimeout(timer);
			failed(new Abort(`Chrome exited before it listened:\n${log}`));
		});
	});
	return { chrome, endpoint };
}

function connect(endpoint) {
	const socket = new WebSocket(endpoint);
	const waiting = new Map();
	let sequence = 0;
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		const pending = waiting.get(message.id);
		if (!pending) return;
		waiting.delete(message.id);
		if (message.error) pending.failed(new Error(`${pending.method}: ${message.error.message}`));
		else pending.done(message.result);
	});
	socket.addEventListener("close", () => {
		for (const pending of waiting.values()) pending.failed(new Abort(`Chrome closed the connection during ${pending.method}`));
		waiting.clear();
	});
	const send = (method, params = {}, sessionId) => new Promise((done, failed) => {
		if (socket.readyState !== WebSocket.OPEN) return failed(new Abort(`Chrome closed the connection before ${method}`));
		const id = sequence += 1;
		waiting.set(id, { done, failed, method });
		socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
	});
	return new Promise((opened, failed) => {
		socket.addEventListener("open", () => opened({ send, close: () => socket.close() }));
		socket.addEventListener("error", () => failed(new Abort("Could not reach Chrome's DevTools endpoint")));
	});
}

const SETTLED = `new Promise((done) => {
	const deadline = performance.now() + 15000;
	let previous = null, stable = 0;
	(function sample() {
		const cells = [...document.querySelectorAll(".supermax-cell")];
		const moving = document.getAnimations().some((animation) => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity);
		const geometry = JSON.stringify(cells.map((cell) => { const box = cell.getBoundingClientRect(); return [box.x, box.y, box.width, box.height]; }));
		stable = cells.length > 0 && !moving && geometry === previous ? stable + 1 : 0;
		previous = geometry;
		if (stable >= 4) return done(true);
		if (performance.now() > deadline) return done(cells.length > 0);
		setTimeout(sample, 80);
	})();
})`;

const slug = (text) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "cell";

function encode(frames, target, format) {
	const input = ["-y", "-loglevel", "error", "-framerate", "30", "-i", join(frames, "%05d.png")];
	const even = "pad=ceil(iw/2)*2:ceil(ih/2)*2";
	const args = format === "gif"
		? [...input, "-vf", "fps=15,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", target]
		: [...input, "-vf", even, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", target];
	const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
	if (result.error) fail("ffmpeg is not installed; it turns the captured frames into a clip.");
	if (result.status !== 0) fail(`ffmpeg failed for ${target}:\n${result.stderr}`);
}

const LOADED = `new Promise((done) => {
	const deadline = performance.now() + 10000;
	let previous = null, since = performance.now();
	(function sample() {
		const content = document.body.innerText.length + ":" + document.images.length + ":" + [...document.images].filter((image) => image.complete).length;
		if (content !== previous) since = performance.now();
		previous = content;
		if (performance.now() - since > 700 || performance.now() > deadline) return done(true);
		setTimeout(sample, 100);
	})();
})`;

const WORKSPACE = `(() => {
	for (let node = document.querySelector(".supermax-body"); node; node = node.parentElement) if (node.supermaxWorkspace) return node.supermaxWorkspace;
	return null;
})()`;

const CELLS = `(() => {
	const workspace = ${WORKSPACE};
	if (!workspace) return null;
	const navigator = workspace.navigator;
	return [...navigator.occurrences.values()].map((occurrence) => {
		const definition = navigator.definitionOf(occurrence.destination) ?? {};
		const forms = [definition, ...(definition.variants ?? [])].filter((form) => Number.isFinite(form.min));
		const tops = [definition, ...(definition.variants ?? [])].map((form) => form.max).filter((top) => top != null);
		return {
			id: occurrence.id,
			name: occurrence.destination.split("?")[0],
			title: occurrence.title || occurrence.destination,
			split: Array.isArray(definition.rows),
			min: forms.length ? Math.min(...forms.map((form) => form.min)) : null,
			max: tops.includes("*") || tops.length === 0 ? null : Math.max(...tops),
			preferred: definition.preferred ?? null,
		};
	});
})()`;

const boxOf = (id) => `(() => {
	const cell = document.querySelector('.supermax-cell[data-occurrence="' + CSS.escape(${JSON.stringify(id)}) + '"]');
	if (!cell || cell.matches(".is-folded") || cell.closest("[inert]")) return null;
	const box = cell.getBoundingClientRect();
	return box.width > 1 && box.height > 1 ? { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } : null;
})()`;

// allow-comment: the allocator shows a smaller form only when room is scarce, and a set width never goes below the bounds of the form it prefers. For a width inside a smaller form the helper therefore declares that form's bounds on the destination for as long as the page lives.
const sizeTo = (id, size) => `(async () => {
	const workspace = ${WORKSPACE};
	const navigator = workspace.navigator;
	const destination = navigator.get(${JSON.stringify(id)})?.destination;
	const kept = window.cellSweepDeclared ??= new Map();
	if (destination && !kept.has(destination)) kept.set(destination, navigator.destinations[destination]);
	const declared = kept.get(destination);
	const form = declared && ${size} < declared.min ? (declared.variants ?? []).find((variant) => Number.isFinite(variant.min) && ${size} >= variant.min && ${size} <= (Number.isFinite(variant.max) ? variant.max : declared.min - 1)) : null;
	if (declared) navigator.destinations[destination] = form ? { ...declared, min: form.min, max: Number.isFinite(form.max) ? form.max : declared.min - 1, preferred: form.preferred ?? form.min } : declared;
	workspace.setSizes(new Map([[${JSON.stringify(id)}, ${size}]]), "width");
	await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
	return ${boxOf(id)};
})()`;

const mask = (box) => `(() => {
	const cover = document.getElementById("cell-sweep-mask") ?? document.body.appendChild(Object.assign(document.createElement("div"), { id: "cell-sweep-mask" }));
	const [red, green, blue] = (getComputedStyle(document.body).backgroundColor.match(/[\\d.]+/g) ?? []).map(Number);
	const paper = getComputedStyle(document.body).backgroundColor.startsWith("rgb(") ? \`rgb(\${red}, \${green}, \${blue})\` : "#fff";
	cover.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;background:transparent;box-shadow:0 0 0 20000px " + paper + ";left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px";
})()`;

async function run(config) {
	if (spawnSync("ffmpeg", ["-version"]).error) fail("ffmpeg is not installed; it turns the captured frames into a clip.");
	const out = resolve(config.out);
	mkdirSync(out, { recursive: true });
	const scratch = mkdtempSync(join(tmpdir(), "cell-sweep-"));
	const report = { clips: [], splits: [], missed: [] };
	let chrome = null;
	try {
		const started = launch(join(scratch, "profile"));
		chrome = started.chrome;
		await record(config, await started.endpoint, out, scratch, report);
		if (report.missed.length > 0) fail(`No clip for ${report.missed.map((cell) => `${cell.title} (${cell.reason})`).join(", ")}`);
		if (report.clips.length === 0) fail("Nothing was recorded: the route has no cell with a width of its own.");
	} finally {
		if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
			chrome.kill();
			await new Promise((done) => chrome.once("exit", done));
		}
		rmSync(scratch, { recursive: true, force: true });
		writeFileSync(join(out, "sweeps.json"), `${JSON.stringify({ url: config.url, ...report }, null, "\t")}\n`);
	}
}

async function record(config, endpoint, out, scratch, report) {
	const browser = await connect(endpoint);
	const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
	const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
	const page = (method, params) => browser.send(method, params, sessionId);
	const evaluate = async (expression) => {
		const { result, exceptionDetails } = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
		return result.value;
	};
	const window = (width) => page("Emulation.setDeviceMetricsOverride", { width, height: config.height, deviceScaleFactor: 1, mobile: false });
	const open = async () => {
		const { errorText } = await page("Page.navigate", { url: config.url });
		if (errorText) fail(`${config.url} did not load: ${errorText}`);
		if (!await evaluate(SETTLED)) fail(`No Supermax workspace appeared at ${config.url}`);
		await evaluate(LOADED);
	};
	await page("Page.enable");
	const cap = config["elastic-max"];
	const target = (cell) => cell.max ?? Math.max(cap, cell.min);
	let route = null, room = 1512;
	for (let pass = 0; pass < 3; pass += 1) {
		await window(room);
		await open();
		route = await evaluate(CELLS);
		if (!route) fail(`The Supermax at ${config.url} does not hand out its workspace; it needs a version that sets supermaxWorkspace on the host element.`);
		const cells = route.filter((cell) => !cell.split);
		const needed = cells.reduce((sum, cell) => sum + (cell.preferred ?? cell.min ?? 0), 0) + Math.max(0, ...cells.map(target)) + 400;
		if (needed <= room) break;
		room = Math.min(16000, needed);
	}
	const wanted = route.filter((cell) => !config.only || `${cell.name} ${cell.title}`.toLowerCase().includes(config.only.toLowerCase()));
	if (wanted.length === 0) fail(`No cell of the route at ${config.url} matches "${config.only}"`);

	const pending = wanted.filter((cell) => !cell.split);
	for (const cell of wanted) if (cell.split) report.splits.push({ title: cell.title, occurrence: cell.id });
	try {
		await sweep(pending);
	} catch (error) {
		for (const cell of pending) if (![...report.clips, ...report.missed].some((done) => done.occurrence === cell.id)) report.missed.push({ title: cell.title, occurrence: cell.id, reason: "the run stopped before it" });
		throw error;
	}
	browser.close();

	async function sweep(cells) {
	for (const [index, cell] of cells.entries()) {
		const miss = (reason) => report.missed.push({ title: cell.title, occurrence: cell.id, reason });
		await open();
		const from = cell.min, to = target(cell);
		const smallest = await evaluate(sizeTo(cell.id, from)), largest = await evaluate(sizeTo(cell.id, to));
		if (!smallest || !largest) { miss(`not on screen in a window of ${room}px`); continue; }
		if (smallest.width === largest.width) { miss(`stays ${largest.width}px whatever width is set`); continue; }
		const high = Math.max(smallest.height, largest.height);
		const frames = join(scratch, `frames-${index}`);
		mkdirSync(frames);
		let count = 0, width = null;
		const frame = async (box, times = 1) => {
			await evaluate(mask(box));
			const { data } = await page("Page.captureScreenshot", { format: "png", clip: { x: box.x, y: box.y, width: largest.width, height: high, scale: 1 } });
			for (let copy = 0; copy < times; copy += 1) writeFileSync(join(frames, `${String(count += 1).padStart(5, "0")}.png`), Buffer.from(data, "base64"));
		};
		let finished = false;
		for (let size = from; ; size = Math.min(to, size + config.step)) {
			const box = await evaluate(sizeTo(cell.id, size));
			if (!box) break;
			if (box.width !== width) await frame(box, width === null ? 20 : 1);
			width = box.width;
			if (size === to) { await frame(box, 25); finished = true; break; }
		}
		if (!finished) { miss("left the screen while it was being sized"); continue; }
		const file = `${String(report.clips.length + 1).padStart(2, "0")}-${slug(cell.name)}.${config.format}`;
		encode(frames, join(out, file), config.format);
		const reached = { min: smallest.width, max: largest.width };
		report.clips.push({ file, title: cell.title, occurrence: cell.id, declared: { min: cell.min, max: cell.max ?? "*" }, reached, height: high });
		console.log(`${file}  ${cell.title}: ${reached.min} to ${reached.max}px${cell.max === null ? " (no maximum declared)" : ""}`);
		if (reached.min !== from || (cell.max !== null && reached.max !== to)) console.error(`${cell.title} declares ${from} to ${cell.max ?? "*"} and reached ${reached.min} to ${reached.max}${room === 16000 ? " in the widest window the helper opens, 16000px" : ""}`);
	}
	}
}

try {
	await run(options(process.argv.slice(2)));
} catch (error) {
	if (!(error instanceof Abort)) throw error;
	console.error(error.message);
	process.exitCode = 1;
}
