import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { serveDocs } from "./serve-docs.js";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

let server, browser;
before(async () => { server = await serveDocs(); browser = await chromium.launch({ channel: "chrome", headless: true }); });
after(async () => { await browser?.close(); await server?.close(); });

async function example(title = "Photo view", options = {}) {
	const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
	await page.goto(`${server.url}/blank`);
	await page.addStyleTag({ url: `${server.url}/src/workspace.css` });
	await page.evaluate(async ({ title, custom }) => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div"); host.style.cssText = "width:300px;height:200px;--supermax-default-canvas:#999;--supermax-default-surface:white"; document.body.append(host);
		const navigator = new Navigator({ root: "menu", minViewportHeight: 160, destinations: {
			menu: { title: "Menu", min: 40, max: 40, overflow: { mode: "keep" } },
			photo: { title, min: 200, max: 200 },
			work: { title: "Work", min: 200, max: "*", preferred: 260 },
			split: { title: "Workspace", rows: [{ destination: "overview", minHeight: 120, maxHeight: 120 }, { destination: "details", minHeight: 120, maxHeight: "*", preferredHeight: 160 }] },
			overview: { title: "Overview", min: 200, max: "*", preferred: 260 },
			details: { title: "Details", min: 200, max: "*", preferred: 260 },
		} });
		navigator.resize({ width: 300, height: 200 }); navigator.open("photo", { from: "menu" }); navigator.open("work", { from: "menu/photo" });
		window.labels = new Workspace(host, { navigator, content: () => ({ element: document.createElement("input") }), ...(custom ? { renderer: { fold: ({ root }) => { root.textContent = "Custom fold"; } } } : {}) });
	}, { title, custom: !!options.custom });
	return page;
}

test("default folds name their content in Tiny5 without increasing thickness", async () => {
	const page = await example();
	try {
		const cue = page.locator('.supermax-fold-cue[data-fold-occurrence="menu/photo"]');
		await page.waitForFunction(() => document.querySelector('.supermax-fold-cue:not([hidden]) .supermax-fold-label')?.textContent === "PHOTO VIEW");
		await page.evaluate(() => document.fonts.ready);
		assert.equal(await page.evaluate(async () => (await document.fonts.load('8px "Supermax Tiny5"'))[0]?.weight), "400");
		assert.equal(await cue.getAttribute("aria-label"), "Unfold Photo view");
		const mark = await cue.locator(".supermax-fold-mark").boundingBox(); assert.equal(mark.width, 14);
		await page.evaluate(() => { window.beforeTitle = window.labels.navigator.snapshot(); });
		await page.evaluate(() => window.labels.setTitle("menu/photo", "Dolphins in blue water"));
		assert.match(await cue.locator(".supermax-fold-label").textContent(), /^DOLPHINS IN .+…$/);
		assert.equal(await cue.getAttribute("title"), "Unfold Dolphins in blue water");
		await page.evaluate(() => window.labels.restore(window.beforeTitle));
		assert.equal(await cue.locator(".supermax-fold-label").textContent(), "PHOTO VIEW");
		assert.equal(await cue.getAttribute("title"), "Unfold Photo view");
		await cue.click();
		assert.equal(await page.evaluate(() => window.labels.layout.cells.get("menu/photo").full), true);
		await page.evaluate(() => { window.labels.setTitle("menu/photo", ""); window.labels.render({ animate: false }); });
		assert.equal(await cue.locator(".supermax-fold-label").count(), 0);
		assert.ok(await cue.locator(".supermax-fold-mark svg path").count());
	} finally { await page.close(); }
});

test("the distributed font contains only Regular and includes its own license", async () => {
	const bytes = await readFile(new URL("../src/fonts/Tiny5-Regular.ttf", import.meta.url));
	const tables = new Map();
	for (let index = 0; index < bytes.readUInt16BE(4); index++) {
		const offset = 12 + index * 16;
		tables.set(bytes.toString("ascii", offset, offset + 4), bytes.readUInt32BE(offset + 8));
	}
	assert.equal(tables.has("fvar"), false); assert.equal(tables.has("gvar"), false);
	assert.equal(bytes.readUInt16BE(tables.get("OS/2") + 4), 400);
	assert.match(await readFile(new URL("../src/fonts/OFL.txt", import.meta.url), "utf8"), /Tiny5 Project Authors[\s\S]*SIL OPEN FONT LICENSE Version 1.1/);
	const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: new URL("../", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
	assert.deepEqual(pack.files.filter(({ path }) => path.startsWith("src/fonts/")).map(({ path }) => path).sort(), ["src/fonts/OFL.txt", "src/fonts/Tiny5-Regular.ttf"]);
});

test("folded rows also show their current title and cap long labels to their seam", async () => {
	const page = await example("A very long photo title ".repeat(30));
	try {
		await page.waitForFunction(() => !!document.querySelector(".supermax-fold-label"));
		const horizontal = page.locator('.supermax-fold-cue[data-fold-occurrence="menu/photo"]');
		assert.ok((await horizontal.boundingBox()).height <= 96);
		assert.ok((await horizontal.locator("text").textContent()).endsWith("…"));
		assert.equal(await page.evaluate(() => window.labels.sync(["menu", "split"], { animate: false, origin: null }).ok), true);
		const row = page.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="menu/split/overview"]');
		assert.equal(await row.locator(".supermax-fold-label").textContent(), "OVERVIEW");
		assert.equal((await row.locator(".supermax-fold-mark").boundingBox()).height, 14);
		await row.focus(); await page.keyboard.press("Enter");
		assert.equal(await page.evaluate(() => window.labels.layout.rows.get("menu/split/overview").folded), false);
	} finally { await page.close(); }
});

test("unknown titles keep hatching and custom fold content stays authoritative", async () => {
	for (const custom of [false, true]) {
		const page = await example("", { custom });
		try {
			const cue = page.locator('.supermax-fold-cue[data-fold-occurrence="menu/photo"]');
			assert.equal(await cue.locator(".supermax-fold-label").count(), 0);
			if (custom) assert.equal(await cue.textContent(), "Custom fold");
			else assert.equal(await cue.locator("svg").count(), 1);
		} finally { await page.close(); }
	}
});
