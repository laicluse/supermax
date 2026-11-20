import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { serveDocs } from "./serve-docs.js";

const COLOURS = { albums: [255, 255, 0], "albums/album": [255, 0, 255], "albums/album/thumbs": [255, 0, 0], "albums/album/thumbs/photo": [0, 0, 255], "albums/album/map": [0, 255, 0], "albums/album/map/photo": [0, 255, 255] };

async function mount(page, presentation = null) {
	await page.evaluate(async ({ colours, presentation }) => {
		const { Navigator, Workspace, DEFAULT_RENDERER } = await import("/src/index.js");
		const sheet = document.createElement("link");
		sheet.rel = "stylesheet";
		sheet.href = "/src/workspace.css";
		document.head.append(sheet);
		await new Promise((resolve) => (sheet.onload = resolve));
		document.body.style.cssText = "margin:0;background:#101010";
		const host = document.createElement("div");
		host.style.cssText = "width:900px;height:500px;--supermax-gutter:4px;--supermax-default-canvas:#808080;--supermax-default-surface:#202020";
		document.body.append(host);
		const paint = (root, occurrence) => {
			root.style.borderColor = `rgb(${colours[occurrence].join(" ")})`;
		};
		window.parts = { updates: [], raise: {}, defaults: {} };
		const renderer = {
			cell(context) {
				const handle = DEFAULT_RENDERER.cell(context);
				paint(context.root, context.state.occurrence);
				window.parts.raise[context.state.occurrence] = context.raise;
				return {
					update(next) {
						handle?.update?.(next);
						window.parts.updates.push(["cell", next.occurrence, next.gutter]);
					}
				};
			},
			header(context) {
				const handle = DEFAULT_RENDERER.header(context);
				paint(context.root, context.state.occurrence);
				window.parts.defaults[context.state.occurrence] = handle;
				return {
					update(next) {
						handle.update(next);
						window.parts.updates.push(["header", next.occurrence, next.gutter]);
					},
					dispose() {
						handle.dispose?.();
					}
				};
			}
		};
		const navigator = new Navigator({
			root: "albums",
			minViewportHeight: 300,
			destinations: {
				albums: { title: "Albums", min: 200, max: 200, header: "title" },
				album: {
					title: "Album", header: "title",
					rows: [
						{ destination: "thumbs", minHeight: 120, maxHeight: "*", preferredHeight: 200 },
						{ destination: "map", minHeight: 120, maxHeight: 200 }
					]
				},
				thumbs: { title: "Thumbs", min: 200, max: 240 },
				map: { title: "Map", min: 200, max: 240 },
				photo: { title: "Photo", min: 240, max: "*", preferred: 360 }
			}
		});
		window.workspace = new Workspace(host, { navigator, renderer, content: () => ({ element: document.createElement("div") }) });
		if (presentation) workspace.setPresentation(presentation);
		workspace.navigate("album", { from: "albums", animate: false, origin: null });
		workspace.navigate("photo", { from: "albums/album/thumbs", animate: false, origin: null });
		workspace.render({ animate: false });
		await Promise.all([...workspace.chains.values()].map(({ strip }) => strip.finished));
	}, { colours: COLOURS, presentation });
}

async function colourAt(page, points) {
	const screenshot = (await page.screenshot()).toString("base64");
	return page.evaluate(async ({ screenshot, points }) => {
		const image = new Image();
		image.src = `data:image/png;base64,${screenshot}`;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = image.width;
		canvas.height = image.height;
		const context = canvas.getContext("2d");
		context.drawImage(image, 0, 0);
		return Object.fromEntries(Object.entries(points).map(([name, [x, y]]) => [name, [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3)]));
	}, { screenshot, points });
}

const strips = () => {
	const box = (id) => workspace.cells.get(id).element.getBoundingClientRect();
	const albums = box("albums"), thumbs = box("albums/album/thumbs"), photo = box("albums/album/thumbs/photo"), map = box("albums/album/map");
	const header = workspace.cells.get("albums/album").header.getBoundingClientRect();
	const albumsHeader = workspace.cells.get("albums").header.getBoundingClientRect();
	const middle = (rectangle) => [rectangle.left + rectangle.width / 2, rectangle.top + rectangle.height / 2];
	return {
		albumsSurface: middle(albums),
		albumsSeam: [albums.left + 100, albumsHeader.bottom - 2],
		thumbsSurface: middle(thumbs),
		splitGutterBesideHeader: [header.left + 2, header.top + 10],
		splitGutterBesideThumbs: [thumbs.left + 2, thumbs.top + thumbs.height / 2],
		betweenThumbsAndPhoto: [thumbs.right + 2, thumbs.top + thumbs.height / 2],
		belowThumbs: [thumbs.left + 100, thumbs.bottom + 2],
		belowPhoto: [photo.right - 20, photo.bottom + 2],
		aboveMap: [map.left + 100, map.top - 2],
		besideMap: [map.left + 2, map.top + map.height / 2]
	};
};

test("a cell's renderer paints the gutters around its cell, and a raised cell wins a shared gutter", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 940, height: 540 } });
		await page.goto(`${server.url}/blank`);
		await mount(page);
		const rest = await colourAt(page, await page.evaluate(strips));
		const surface = [32, 32, 32];
		assert.deepEqual(rest.albumsSurface, surface, "the default surface stays inside the cell");
		assert.deepEqual(rest.thumbsSurface, surface);
		assert.deepEqual(rest.albumsSeam, COLOURS.albums, "a header paints its title seam");
		assert.deepEqual(rest.splitGutterBesideHeader, COLOURS["albums/album"], "a split's header paints the gutter before the split");
		assert.deepEqual(rest.splitGutterBesideThumbs, COLOURS["albums/album/thumbs"], "the leading cell of a row paints its split's gutter");
		assert.deepEqual(rest.betweenThumbsAndPhoto, COLOURS["albums/album/thumbs/photo"], "the later cell lies on top in a shared gutter");
		assert.deepEqual(rest.belowThumbs, COLOURS["albums/album/map"], "the lower row lies on top in a shared gutter");
		assert.deepEqual(rest.belowPhoto, COLOURS["albums/album/thumbs/photo"], "a cell paints the gutter below it where no cell stands under it");
		assert.deepEqual(rest.aboveMap, COLOURS["albums/album/map"]);
		assert.deepEqual(rest.besideMap, COLOURS["albums/album/map"]);

		const gutters = await page.evaluate(() => Object.fromEntries(["albums", "albums/album/thumbs", "albums/album/thumbs/photo", "albums/album/map"].map((id) => [id, parts.updates.findLast(([part, occurrence]) => part === "cell" && occurrence === id)[2]])));
		assert.deepEqual(gutters.albums, { size: 4, top: 0, right: 4, bottom: 0, left: 0 });
		assert.deepEqual(gutters["albums/album/thumbs"], { size: 4, top: 0, right: 4, bottom: 4, left: 4 });
		assert.deepEqual(gutters["albums/album/thumbs/photo"], { size: 4, top: 0, right: 0, bottom: 4, left: 4 });
		assert.deepEqual(gutters["albums/album/map"], { size: 4, top: 4, right: 0, bottom: 0, left: 4 });
		const header = await page.evaluate(() => ({ gutter: parts.updates.findLast(([part, occurrence]) => part === "header" && occurrence === "albums/album")[2], title: workspace.cells.get("albums/album").header.querySelector(".supermax-cell-title-text").textContent }));
		assert.deepEqual(header.gutter, { size: 4, top: 0, right: 0, bottom: 4, left: 4 });
		assert.equal(header.title, "Album", "the default header still draws the title after a renderer extends it");

		await page.evaluate(() => parts.raise.albums(true));
		const raisedRoot = await colourAt(page, await page.evaluate(strips));
		assert.deepEqual(raisedRoot.splitGutterBesideHeader, COLOURS.albums, "a raised cell wins the gutter it shares with the next cell");
		assert.deepEqual(raisedRoot.splitGutterBesideThumbs, COLOURS.albums);
		await page.evaluate(() => { parts.raise.albums(false); parts.raise["albums/album/thumbs"](true); });
		const raised = await colourAt(page, await page.evaluate(strips));
		assert.deepEqual(raised.splitGutterBesideThumbs, COLOURS["albums/album/thumbs"]);
		assert.deepEqual(raised.betweenThumbsAndPhoto, COLOURS["albums/album/thumbs"]);
		assert.deepEqual(raised.belowThumbs, COLOURS["albums/album/thumbs"], "a raised cell wins the gutter it shares with the row below");
		assert.deepEqual(raised.belowPhoto, [128, 128, 128], "and the other cells of its row leave the gutter under them alone");
		await page.evaluate(() => parts.raise["albums/album/thumbs"](false));
		const lowered = await colourAt(page, await page.evaluate(strips));
		assert.deepEqual(lowered.betweenThumbsAndPhoto, COLOURS["albums/album/thumbs/photo"]);
	} finally { await browser.close(); await server.close(); }
});

test("gutter paint outside a room waits until its chain rests", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 940, height: 540 } });
		await page.goto(`${server.url}/blank`);
		await mount(page);
		const moving = await page.evaluate(() => {
			workspace.navigate("photo", { from: "albums/album/map", origin: null });
			for (const animation of document.getAnimations()) { animation.pause(); const timing = animation.effect.getComputedTiming(); animation.currentTime = (timing.delay ?? 0) + timing.duration / 2; }
			for (const { strip } of workspace.chains.values()) strip.step();
			const chain = workspace.chains.get("albums/album/map");
			const room = chain.strip.boxOf(chain.strip.entries[0]);
			return { resting: chain.viewport.classList.contains("is-resting"), after: room.style.getPropertyValue("--supermax-cell-gutter-after"), lead: room.style.getPropertyValue("--supermax-cell-gutter-lead"), overflow: getComputedStyle(room).overflow, paint: getComputedStyle(workspace.cells.get("albums/album/map/photo").materialPart.root).borderLeftColor };
		});
		assert.deepEqual(moving, { resting: false, after: "0px", lead: "0px", overflow: "clip", paint: "rgba(0, 0, 0, 0)" });
		const settled = await page.evaluate(async () => {
			for (const animation of document.getAnimations()) animation.finish();
			await Promise.all([...workspace.chains.values()].map(({ strip }) => strip.finished));
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const chain = workspace.chains.get("albums/album/map");
			const room = chain.strip.boxOf(chain.strip.entries[0]);
			return { resting: chain.viewport.classList.contains("is-resting"), after: room.style.getPropertyValue("--supermax-cell-gutter-after"), lead: room.style.getPropertyValue("--supermax-cell-gutter-lead"), gutter: parts.updates.findLast(([part, occurrence]) => part === "cell" && occurrence === "albums/album/map")[2] };
		});
		assert.deepEqual(settled, { resting: true, after: "4px", lead: "4px", gutter: { size: 4, top: 4, right: 4, bottom: 0, left: 4 } });
	} finally { await browser.close(); await server.close(); }
});

test("a presentation without rooms keeps the same gutter rules", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 940, height: 540 } });
		await page.goto(`${server.url}/blank`);
		await mount(page, { name: "plain" });
		assert.equal(await page.evaluate(() => document.querySelectorAll(".supermax-room").length), 0);
		const rest = await colourAt(page, await page.evaluate(strips));
		assert.deepEqual(rest.splitGutterBesideThumbs, COLOURS["albums/album/thumbs"]);
		assert.deepEqual(rest.betweenThumbsAndPhoto, COLOURS["albums/album/thumbs/photo"]);
		assert.deepEqual(rest.belowPhoto, COLOURS["albums/album/thumbs/photo"]);
		await page.evaluate(() => parts.raise["albums/album/thumbs"](true));
		const raised = await colourAt(page, await page.evaluate(strips));
		assert.deepEqual(raised.betweenThumbsAndPhoto, COLOURS["albums/album/thumbs"], "a raised cell wins a shared gutter without a room around it");
		assert.deepEqual(raised.belowThumbs, COLOURS["albums/album/thumbs"]);
		assert.deepEqual(raised.belowPhoto, [128, 128, 128], "and the other cells of its row leave the gutter under them alone");
		assert.deepEqual(raised.splitGutterBesideHeader, COLOURS["albums/album"], "a raised cell that does not reach the split's trailing edge leaves the split in place");
		const moving = await page.evaluate(() => {
			parts.raise["albums/album/thumbs"](false);
			workspace.navigate("photo", { from: "albums/album/map", origin: null });
			for (const animation of document.getAnimations()) { animation.pause(); const timing = animation.effect.getComputedTiming(); animation.currentTime = (timing.delay ?? 0) + timing.duration / 2; }
			for (const { strip } of workspace.chains.values()) strip.step();
			return { resting: workspace.chains.get("albums/album/map").viewport.classList.contains("is-resting"), paint: getComputedStyle(workspace.cells.get("albums/album/map/photo").materialPart.root).borderLeftColor };
		});
		assert.deepEqual(moving, { resting: false, paint: "rgba(0, 0, 0, 0)" }, "a sliding cell shows no gutter paint");
	} finally { await browser.close(); await server.close(); }
});

test("a row that changes height shows no gutter paint between its cells", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 940, height: 540 } });
		await page.goto(`${server.url}/blank`);
		await mount(page);
		const moving = await page.evaluate(() => {
			const host = workspace.element;
			host.style.height = "420px";
			workspace.navigator.resize({ width: 900, height: 420 });
			workspace.render({ animate: true });
			for (const animation of document.getAnimations()) { animation.pause(); const timing = animation.effect.getComputedTiming(); animation.currentTime = (timing.delay ?? 0) + timing.duration / 2; }
			for (const { strip } of workspace.chains.values()) strip.step();
			const row = workspace.rows.get("albums/album/thumbs");
			return { row: row.element.parentElement.classList.contains("is-moving"), resting: workspace.chains.get("albums/album/thumbs").viewport.classList.contains("is-resting"), paint: getComputedStyle(workspace.cells.get("albums/album/thumbs/photo").materialPart.root).borderLeftColor, below: workspace.chains.get("albums/album/map").viewport.classList.contains("is-resting") };
		});
		assert.deepEqual(moving, { row: true, resting: false, paint: "rgba(0, 0, 0, 0)", below: false }, "the row that only moves along rests no more than the row that changes height");
		const settled = await page.evaluate(async () => {
			for (const animation of document.getAnimations()) animation.finish();
			await Promise.all([...workspace.chains.values()].map(({ strip }) => strip.finished));
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const row = workspace.rows.get("albums/album/thumbs");
			return { row: row.element.parentElement.classList.contains("is-moving"), resting: workspace.chains.get("albums/album/thumbs").viewport.classList.contains("is-resting"), paint: getComputedStyle(workspace.cells.get("albums/album/thumbs/photo").materialPart.root).borderLeftColor };
		});
		assert.deepEqual(settled, { row: false, resting: true, paint: "rgb(0, 0, 255)" });
	} finally { await browser.close(); await server.close(); }
});
