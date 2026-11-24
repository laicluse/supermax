import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openBrowser } from "./browser.js";
import { serveDocs } from "./serve-docs.js";

let server;
let browser;
let page;
let cdp;

before(async () => {
	server = await serveDocs();
	browser = await openBrowser();
	page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
	await page.goto(`${server.url}/blank`);
	await page.addStyleTag({ url: "/src/workspace.css" });
	cdp = await page.context().newCDPSession(page);
});

async function documentListeners() {
	const { result } = await cdp.send("Runtime.evaluate", { expression: "document" });
	const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
	return listeners.filter((listener) => listener.type.startsWith("pointer")).length;
}

async function press(selector) {
	const box = await page.locator(selector).first().boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2 + 10, { steps: 2 });
}

after(async () => {
	await browser?.close();
	await server?.close();
});

async function mount(presentation) {
	await page.evaluate(async (presentation) => {
		window.retention?.workspace.destroy();
		document.body.replaceChildren();
		const supermax = await import("/src/index.js");
		const { destinations, minViewportHeight } = await import("/assets/album.js");
		const host = document.createElement("div");
		host.style.cssText = "position:fixed;inset:0;";
		document.body.append(host);
		const base = { origami: supermax.ORIGAMI_PRESENTATION, veil: supermax.VEIL_PRESENTATION }[presentation];
		const live = new Set();
		const counted = { ...base, name: `${base.name}-counted`, createStrip: (viewport, workspace) => {
			const strip = new supermax.CellStrip(viewport, { motion: base.motion, time: workspace.time, horizon: () => workspace.horizon(), toward: (leaving, arriving) => workspace.towardOf(leaving, arriving) });
			const destroy = strip.destroy.bind(strip);
			live.add(strip);
			strip.destroy = () => { live.delete(strip); destroy(); };
			return strip;
		} };
		const navigator = new supermax.Navigator({ destinations: destinations("ana"), root: "albums", minViewportHeight });
		const content = (occurrence) => ({ element: Object.assign(document.createElement("div"), { textContent: occurrence.title }) });
		const workspace = new supermax.Workspace(host, { navigator, content, presentation: counted, time: new supermax.TimeScale(0.05) });
		window.retention = { workspace, live };
	}, presentation);
}

async function settled() {
	await page.evaluate(() => new Promise((resolve) => {
		const check = () => document.getAnimations().some((animation) => animation.playState === "running") ? requestAnimationFrame(check) : setTimeout(resolve, 50);
		requestAnimationFrame(check);
	}));
}

for (const presentation of ["origami", "veil"]) {
	test(`closing a split under ${presentation} destroys the strips of its rows`, async () => {
		await mount(presentation);
		await settled();
		const idle = await page.evaluate(() => window.retention.live.size);
		await page.evaluate(() => window.retention.workspace.navigate("album:coast", { from: "albums", origin: null }));
		await settled();
		assert.ok(await page.evaluate(() => window.retention.live.size) > idle, "the split's rows have strips of their own");
		await page.evaluate(() => window.retention.workspace.sync(["albums", "depth:1"], { origin: null }));
		await settled();
		await page.evaluate(() => window.retention.workspace.sync(["albums"], { origin: null }));
		await settled();
		assert.equal(await page.evaluate(() => window.retention.live.size), idle, "no strip outlives its closed cell");
	});
}

test("a divider drag cut short by navigation lets go of the document", async () => {
	await mount("veil");
	await page.evaluate(() => window.retention.workspace.navigate("album:coast", { from: "albums", origin: null }));
	await settled();
	const idle = await documentListeners();
	await press(".supermax-divider.is-vertical .supermax-divider-handle");
	assert.ok(await documentListeners() > idle, "the drag listens on the document");
	await page.evaluate(() => window.retention.workspace.sync(["albums"], { origin: null }));
	await settled();
	assert.equal(await documentListeners(), idle, "closing the divider ends its drag");
	await page.mouse.up();
});

test("a modal drag cut short by closing the modal lets go of the document", async () => {
	await mount("veil");
	const idle = await documentListeners();
	await page.evaluate(() => window.retention.workspace.openModal({ title: "Edit", content: () => ({ element: document.createElement("p") }) }, { from: null }));
	await settled();
	await press(".supermax-modal-header");
	assert.ok(await documentListeners() > idle, "the drag listens on the document");
	await page.evaluate(() => window.retention.workspace.closeModal("close"));
	await settled();
	assert.equal(await documentListeners(), idle, "closing the modal ends its drag");
	await page.mouse.up();
});

test("only a primary click on the backdrop closes a modal", async () => {
	await mount("veil");
	const open = () => page.evaluate(() => window.retention.workspace.modal !== null);
	await page.evaluate(() => window.retention.workspace.openModal({ title: "Edit", content: () => ({ element: document.createElement("p") }) }, { from: null }));
	await settled();
	await page.mouse.click(5, 5, { button: "right" });
	await settled();
	assert.equal(await open(), true, "a right click beside the modal leaves it open");
	await page.evaluate(() => {
		const layer = document.querySelector(".supermax-modal-layer");
		layer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 7 }));
		layer.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 7 }));
		layer.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 7 }));
	});
	await settled();
	assert.equal(await open(), true, "a press the browser cancelled leaves it open");
	const box = await page.locator(".supermax-modal").boundingBox();
	await page.mouse.move(5, 5);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
	await page.mouse.up();
	await settled();
	assert.equal(await open(), true, "a press that ends on the modal leaves it open");
	await page.mouse.click(5, 5);
	await settled();
	assert.equal(await open(), false, "a primary click on the backdrop closes it");
});

test("a strip taken out of the document leaves cells that moved to another strip where they are", async () => {
	const result = await page.evaluate(async () => {
		document.body.replaceChildren();
		const { CellStrip, VEIL_PRESENTATION } = await import("/src/index.js");
		const host = (width) => Object.assign(document.body.appendChild(document.createElement("div")), { style: `position:relative;width:${width}px;height:160px` });
		const leaving = host(600), arriving = host(600);
		const cell = document.createElement("section");
		const pane = cell.appendChild(document.createElement("div"));
		pane.style.cssText = "height:100px;overflow:auto";
		pane.appendChild(document.createElement("div")).style.height = "1000px";
		const other = document.createElement("section");
		const old = new CellStrip(leaving, { duration: 300, settle: 0, motion: { ...VEIL_PRESENTATION.motion, travel: () => 300 } });
		await old.update([{ id: "cell", element: cell, width: 600, visible: true }], { animate: false });
		old.update([{ id: "cell", element: cell, width: 300, visible: true }, { id: "other", element: other, width: 300, visible: true }]);
		const next = new CellStrip(arriving);
		await next.update([{ id: "cell", element: cell, width: 600, visible: true }], { animate: false });
		pane.scrollTop = 240;
		leaving.remove();
		for (let frame = 0; frame < 5; frame += 1) await new Promise(requestAnimationFrame);
		return { inArriving: arriving.contains(cell), scrollTop: pane.scrollTop };
	});
	assert.deepEqual(result, { inArriving: true, scrollTop: 240 }, "the detached strip leaves the moved cell and its scroll position alone");
});

test("a strip that keeps running leaves cells that moved to another strip where they are", async () => {
	const result = await page.evaluate(async () => {
		document.body.replaceChildren();
		const { CellStrip, VEIL_PRESENTATION } = await import("/src/index.js");
		const host = (width) => Object.assign(document.body.appendChild(document.createElement("div")), { style: `position:relative;width:${width}px;height:160px` });
		const leaving = host(600), arriving = host(600);
		const cell = document.createElement("section");
		const pane = cell.appendChild(document.createElement("div"));
		pane.style.cssText = "height:100px;overflow:auto";
		pane.appendChild(document.createElement("div")).style.height = "1000px";
		const other = document.createElement("section");
		const old = new CellStrip(leaving, { duration: 300, settle: 0, motion: { ...VEIL_PRESENTATION.motion, travel: () => 300 } });
		await old.update([{ id: "cell", element: cell, width: 600, visible: true }], { animate: false });
		const running = old.update([{ id: "cell", element: cell, width: 300, visible: true }, { id: "other", element: other, width: 300, visible: true }]);
		const next = new CellStrip(arriving);
		await next.update([{ id: "cell", element: cell, width: 600, visible: true }], { animate: false });
		pane.scrollTop = 240;
		await running;
		old.update([{ id: "other", element: other, width: 600, visible: true }]);
		await old.finished;
		const settled = { inArriving: arriving.contains(cell), scrollTop: pane.scrollTop };
		old.destroy();
		return { ...settled, afterDestroy: arriving.contains(cell) };
	});
	assert.deepEqual(result, { inArriving: true, scrollTop: 240, afterDestroy: true }, "the old strip leaves the moved cell and its scroll position alone, also when it closes it or is destroyed");
});

test("content inside a closing split stays in the document until the host has it back", async () => {
	const lost = await page.evaluate(async () => {
		window.retention?.workspace.destroy();
		document.body.replaceChildren();
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div");
		host.style.cssText = "position:relative;width:1200px;height:600px";
		document.body.append(host);
		const navigator = new Navigator({ root: "menu", minViewportHeight: 400, destinations: {
			menu: { title: "Menu", min: 200, max: 200, overflow: { mode: "keep" } },
			board: { title: "Board", header: "title", rows: [{ destination: "lanes", minHeight: 200, maxHeight: "*", preferredHeight: 400 }, { destination: "summary", minHeight: 80, maxHeight: 120 }] },
			lanes: { title: "Lanes", min: 300, max: "*", preferred: 600 },
			summary: { title: "Summary", min: 300, max: "*", preferred: 600 },
			editor: { title: "Editor", header: "title", min: 300, max: 600 },
		} });
		const elements = new Map();
		const returned = new Set();
		const workspace = new Workspace(host, { navigator, content: (occurrence) => {
			const element = document.createElement("div");
			elements.set(occurrence.id, element);
			return { element, dispose: () => returned.add(occurrence.id) };
		} });
		workspace.sync(["menu", "board"], { origin: null, animate: false });
		const lost = new Set();
		const watch = new MutationObserver(() => {
			for (const [id, element] of elements) if (id !== "menu/board" && !element.isConnected && !returned.has(id)) lost.add(id);
		});
		watch.observe(document, { childList: true, subtree: true });
		workspace.sync(["menu", "editor"], { origin: null });
		const until = performance.now() + 3000;
		while (performance.now() < until && !["menu/board/lanes", "menu/board/summary"].every((id) => returned.has(id))) await new Promise((resolve) => requestAnimationFrame(resolve));
		watch.disconnect();
		window.retention = { workspace };
		return { lost: [...lost], returned: [...returned].sort() };
	});
	assert.deepEqual(lost.returned.filter((id) => id !== "menu/board"), ["menu/board/lanes", "menu/board/summary"], "the host gets the content of both rows back");
	assert.deepEqual(lost.lost, [], "no content left the document before its dispose ran");
});
