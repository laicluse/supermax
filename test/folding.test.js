import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { serveDocs } from "./serve-docs.js";
import { FoldController } from "../src/folding.js";

test("opposing fold handles do not compete for a small touch target", () => {
	for (const [axis, back, next] of [["horizontal", "right", "left"], ["vertical", "down", "up"]]) {
		const group = {};
		const earlier = { hidden: false, inert: false };
		const later = { hidden: false, inert: false };
		const rect = (coordinate) => axis === "horizontal" ? { left: coordinate, top: 0, width: 26, height: 44 } : { left: 0, top: coordinate, width: 44, height: 14 };
		const visible = new Map([
			[earlier, { group, axis, direction: back, order: 0, rect: rect(0) }],
			[later, { group, axis, direction: next, order: 2, rect: rect(20) }],
		]);
		FoldController.prototype.showNearestPages.call({ drag: null }, visible);
		assert.equal(earlier.hidden, true, `${axis}: the preceding page remains available through Back`);
		assert.equal(later.hidden, false, `${axis}: the following page keeps its fold handle`);
		assert.equal(visible.size, 1);
		earlier.hidden = false;
		const active = new Map([
			[earlier, { group, axis, direction: back, order: 0, rect: rect(0) }],
			[later, { group, axis, direction: next, order: 2, rect: rect(20) }],
		]);
		FoldController.prototype.showNearestPages.call({ drag: { cue: earlier } }, active);
		assert.equal(active.has(earlier), true, `${axis}: an active drag keeps its page handle`);
		assert.equal(active.has(later), false);
	}
});

for (const presentation of ["veil", "origami", "fold"]) test(`a row trade retains the preceding page handle and one gutter below the title (${presentation})`, async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
		await page.goto(`${server.url}/?delay=0&presentation=${presentation}`);
		await page.evaluate(async () => {
			await window.supermaxDemo.replay([
				{ type: "open", destination: "album:coast", from: "albums" },
				{ type: "open", destination: "coast:photo:a", from: "albums/album:coast/coast:people" },
				{ type: "open", destination: "coast:metadata:a", from: "albums/album:coast/coast:people/coast:photo:a" },
				{ type: "open", destination: "coast:history:a", from: "albums/album:coast/coast:people/coast:photo:a/coast:metadata:a" },
			]);
			window.supermaxDemo.resize([[296, 335], [700, 500]]);
		});
		await page.waitForFunction(() => window.supermaxDemo.frames[0].workspace.layout.height === 335 && window.supermaxDemo.pending === 0);
		const frame = page.locator('.frame[data-frame="a"]');
		await frame.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="albums/album:coast/coast:map"]').click();
		await page.evaluate(() => document.getAnimations().filter((animation) => animation.effect.getTiming().iterations !== Infinity).forEach((animation) => animation.finish()));
		await page.waitForTimeout(100);
		const handle = frame.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="albums/album:coast/coast:people"]');
		await handle.scrollIntoViewIfNeeded();
		const box = await handle.boundingBox();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		const samples = [];
		for (const distance of [20, 140, 240, 270, 290, 140]) {
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - distance, { steps: 3 });
			samples.push(await frame.evaluate((frame) => {
				const title = frame.querySelector('.supermax-cell.is-split > .supermax-cell-title');
				const rows = [...frame.querySelectorAll('.supermax-row')].filter((row) => row.getBoundingClientRect().height > 1);
				const previous = frame.querySelector('.supermax-fold-cue.is-vertical[data-fold-occurrence="albums/album:coast/coast:thumbnails"]');
				return { gap: rows[0].firstElementChild.getBoundingClientRect().top - title.getBoundingClientRect().bottom, previousVisible: !previous.hidden, previousInert: previous.inert, progress: window.supermaxDemo.frames[0].workspace.folds.drag.progress };
			}));
		}
		await page.mouse.up();
		assert.ok(samples.every((sample) => Math.abs(sample.gap - 1) < .1), `the title shares exactly one gutter with the first moving row: ${JSON.stringify(samples)}`);
		assert.ok(samples.every((sample) => sample.previousVisible && sample.previousInert), `the preceding page remains visible but inactive throughout the drag: ${JSON.stringify(samples)}`);
	} finally {
		await browser.close();
		await server.close();
	}
});

test("zoom retains an exit when its ancestors were already hidden", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		await page.addStyleTag({ url: `${server.url}/src/workspace.css` });
		await page.evaluate(async () => {
			const { Navigator, Workspace } = await import("/src/index.js");
			const host = document.createElement("div");
			host.style.cssText = "position:relative;width:100px;height:100px";
			document.body.append(host);
			const navigator = new Navigator({ root: "root", minViewportHeight: 100, destinations: {
				root: { title: "Root", min: 100, max: 100, overflow: { mode: "hide" } },
				parent: { title: "Parent", min: 100, max: 100, overflow: { mode: "hide" } },
				detail: { title: "Detail", min: 100, max: "*", preferred: 100, overflow: { mode: "hide" }, zoomable: true, header: "title" },
			} });
			navigator.resize({ width: 100, height: 100 });
			navigator.open("parent", { from: "root" });
			navigator.open("detail", { from: "root/parent" });
			window.zoomCase = new Workspace(host, { navigator, content: () => ({}) });
			window.zoomCase.zoom("root/parent/detail", { animate: false });
		});
		assert.equal(await page.locator(".supermax-up").isVisible(), true, "zoom cannot remove the only route to its ancestors");
		assert.equal(await page.locator(".supermax-up").getAttribute("aria-label"), "Zoom out");
		await page.locator(".supermax-up").click();
		assert.equal(await page.evaluate(() => window.zoomCase.navigator.zoomed), null);
		await page.locator(".supermax-up").click();
		assert.equal(await page.evaluate(() => window.zoomCase.layout.cells.get("root/parent").full), true);
	} finally {
		await browser.close();
		await server.close();
	}
});

test("adjacent folded cells can be dragged open one page at a time", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		await page.addStyleTag({ url: `${server.url}/src/workspace.css` });
		await page.evaluate(async () => {
			const { Navigator, Workspace } = await import("/src/index.js");
			const host = document.createElement("div");
			host.style.cssText = "position:relative;width:300px;height:300px";
			document.body.append(host);
			const navigator = new Navigator({ root: "mode", minViewportHeight: 300, destinations: {
				mode: { title: "Mode", min: 40, max: 40, overflow: { mode: "keep" } },
				a: { title: "A", min: 200, max: 200 },
				b: { title: "B", min: 200, max: 200 },
				c: { title: "C", min: 200, max: "*", preferred: 260 },
			} });
			navigator.resize({ width: 300, height: 300 });
			navigator.open("a", { from: "mode" });
			navigator.open("b", { from: "mode/a" });
			navigator.open("c", { from: "mode/a/b" });
			window.pages = new Workspace(host, { navigator, content: (occurrence) => {
				const element = document.createElement("button");
				element.textContent = occurrence.title;
				return { element };
			} });
		});
		const visible = () => page.locator(".supermax-fold-cue.is-horizontal:visible").evaluateAll((cues) => cues.map((cue) => cue.dataset.foldOccurrence));
		assert.deepEqual(await visible(), ["mode/a/b"], "the closest folded cell presents the only handle at the shared seam");
		for (const id of ["mode/a/b", "mode/a"]) {
			const handle = page.locator(`.supermax-fold-cue[data-fold-occurrence="${id}"]`);
			const box = await handle.boundingBox();
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2, { steps: 8 });
			await page.mouse.up();
			await page.waitForFunction((occurrence) => window.pages.findCell(occurrence)?.full && !window.pages.folds.drag, id);
			if (id === "mode/a/b") assert.ok((await visible()).includes("mode/a"), "the next page gets a handle after the drag completes");
		}
		assert.equal(await page.evaluate(() => window.pages.navigator.groups.length), 3, "turning pages preserves navigation groups");
	} finally {
		await browser.close();
		await server.close();
	}
});

test("a reverse vertical page drag keeps a canvas gutter under its handle", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
		await page.goto(`${server.url}/?delay=0`);
		await page.getByRole("button", { name: "Open the Coast album" }).click();
		await page.waitForFunction(() => window.supermaxDemo.pending === 0);
		await page.evaluate(() => window.supermaxDemo.resize([[700, 500], [329, 323]]));
		await page.waitForFunction(() => window.supermaxDemo.frames[1].workspace.layout.height === 323);
		const frame = '.frame[data-frame="b"]';
		const titleSeam = await page.evaluate(() => {
			const frame = document.querySelector('.frame[data-frame="b"]');
			const cue = frame.querySelector('.supermax-fold-cue.is-vertical[data-direction="down"]:not([hidden])');
			const row = frame.querySelector('.supermax-row[data-row="albums/album:coast/coast:map"]');
			const title = row.closest('.supermax-cell').querySelector(':scope > .supermax-cell-title');
			return { cue: cue?.querySelector('.supermax-fold-mark').getBoundingClientRect().top, title: title.getBoundingClientRect().bottom, row: row.getBoundingClientRect().top };
		});
		assert.ok(Math.abs(titleSeam.cue - titleSeam.title) < .5, `the first page handle outlines the title's canvas gutter: ${JSON.stringify(titleSeam)}`);
		for (let step = 0; step < 2; step += 1) await page.locator(`${frame} .supermax-up`).click();
		await page.waitForTimeout(400);
		const handle = page.locator(`${frame} .supermax-fold-cue.is-vertical[data-fold-occurrence="albums/album:coast/coast:map"]`);
		await handle.scrollIntoViewIfNeeded();
		const box = await handle.boundingBox();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		const pressed = await page.evaluate((selector) => {
			const cue = document.querySelector(selector);
			const rect = cue.getBoundingClientRect();
			return { drag: !!window.supermaxDemo.frames[1].workspace.folds.drag, inert: cue.inert, hit: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.className, rect: [rect.x, rect.y, rect.width, rect.height] };
		}, `${frame} .supermax-fold-cue.is-vertical[data-fold-occurrence="albums/album:coast/coast:map"]`);
		assert.equal(pressed.drag, true, `pointer capture starts on the fold handle: ${JSON.stringify(pressed)}`);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 100, { steps: 5 });
		const seam = await page.evaluate((selector) => {
			const cue = document.querySelector(selector);
			const mark = cue.querySelector(".supermax-fold-mark");
			const row = document.querySelector('.frame[data-frame="b"] .supermax-row[data-row="albums/album:coast/coast:thumbnails"]');
			const next = document.querySelector('.frame[data-frame="b"] .supermax-row[data-row="albums/album:coast/coast:map"]');
			return { mark: mark.getBoundingClientRect().bottom, row: row.getBoundingClientRect().bottom, gutter: next.getBoundingClientRect().top, stroke: getComputedStyle(next).borderTopWidth, rowClass: row.className, nextClass: next.className, dragging: row.closest(".supermax-workspace").className, direction: cue.dataset.direction, dragActive: !!window.supermaxDemo.frames[1].workspace.folds.drag?.active };
		}, `${frame} .supermax-fold-cue.is-vertical[data-fold-occurrence="albums/album:coast/coast:map"]`);
		await page.mouse.up();
		assert.equal(seam.stroke, "1px", `the moving row boundary exposes the canvas gutter: ${JSON.stringify(seam)}`);
		assert.ok(Math.abs(seam.mark - seam.gutter - 1) <= 1 && Math.abs(seam.row - seam.gutter) <= 1, `the handle stays attached to that boundary: ${JSON.stringify(seam)}`);
	} finally {
		await browser.close();
		await server.close();
	}
});

test("nonfoldable content after the active cell remains scrollable in a split", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		await page.addStyleTag({ url: `${server.url}/src/workspace.css` });
		const result = await page.evaluate(async () => {
			const { Navigator, Workspace } = await import("/src/index.js");
			const host = document.createElement("div");
			host.style.cssText = "position:relative;width:300px;height:300px";
			document.body.append(host);
			const navigator = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
				menu: { title: "Menu", min: 40, max: 40, overflow: { mode: "keep" } },
				split: { title: "Split", rows: [{ destination: "list", minHeight: 200, maxHeight: "*", preferredHeight: 250 }] },
				list: { title: "List", min: 200, max: 200, overflow: { mode: "hide" } },
				item: { title: "Item", min: 200, max: "*", preferred: 200, overflow: { mode: "hide" } },
			} });
			navigator.resize({ width: 300, height: 300 });
			navigator.open("split", { from: "menu" });
			navigator.open("item", { from: "menu/split/list" });
			navigator.startWindow("menu/split/list", "menu/split/list");
			const workspace = new Workspace(host, { navigator, content: (occurrence) => {
				const element = document.createElement("button");
				element.textContent = occurrence.title;
				return { element };
			} });
			const body = host.querySelector(".supermax-body");
			const item = host.querySelector('[data-occurrence="menu/split/list/item"] button');
			const before = item.getBoundingClientRect();
			body.scrollLeft = body.scrollWidth;
			const after = item.getBoundingClientRect();
			const report = { scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, before: before.left, after: after.left, viewportRight: body.getBoundingClientRect().right, visible: item.checkVisibility() };
			workspace.destroy();
			return report;
		});
		assert.ok(result.scrollWidth >= 440, "the scroll range includes the nested row");
		assert.ok(result.scrollWidth > result.clientWidth, "horizontal scrolling is enabled");
		assert.ok(result.after < result.before && result.after < result.viewportRight, "the trailing cell can be brought into the viewport");
		assert.equal(result.visible, true);
	} finally {
		await browser.close();
		await server.close();
	}
});

test("allocated rows and cells remain physically reachable with overflow on both axes", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		await page.addStyleTag({ url: `${server.url}/src/workspace.css` });
		await page.evaluate(async () => {
			const { Navigator, Workspace } = await import("/src/index.js");
			const host = document.createElement("div");
			host.style.cssText = "position:relative;width:120px;height:100px";
			document.body.append(host);
			const navigator = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
				menu: { title: "Menu", min: 40, max: 40, overflow: { mode: "keep" } },
				split: { title: "Split", header: "title", rows: [
					{ destination: "first", minHeight: 180, maxHeight: "*", preferredHeight: 200, overflow: { mode: "hide" } },
					{ destination: "second", minHeight: 180, maxHeight: 200, overflow: { mode: "hide" } },
				] },
				first: { title: "First", min: 200, max: 200, overflow: { mode: "hide" } },
				second: { title: "Second", min: 200, max: 200, overflow: { mode: "hide" } },
				item: { title: "Item", min: 200, max: "*", preferred: 200, overflow: { mode: "hide" } },
			} });
			navigator.resize({ width: 120, height: 100 });
			navigator.open("split", { from: "menu" });
			navigator.open("item", { from: "menu/split/first" });
			navigator.bringIntoView("menu/split/first");
			window.overflowCase = new Workspace(host, { navigator, content: (occurrence) => {
				const element = document.createElement("button");
				element.textContent = occurrence.title;
				element.onclick = () => { window.clickedCell = occurrence.id; };
				return { element };
			} });
		});
		for (const id of ["menu/split/first/item", "menu/split/second"]) {
			const button = page.locator(`[data-occurrence="${id}"] .supermax-cell-body > button`);
			await button.click();
			assert.equal(await page.evaluate(() => window.clickedCell), id, "scrolling brings the allocated cell into the actual hit-test area");
		}
		const scroll = await page.locator(".supermax-body").evaluate((body) => ({ width: body.scrollWidth, height: body.scrollHeight, viewportWidth: body.clientWidth, viewportHeight: body.clientHeight }));
		assert.ok(scroll.width > scroll.viewportWidth && scroll.height > scroll.viewportHeight, JSON.stringify(scroll));
	} finally {
		await browser.close();
		await server.close();
	}
});

test("folded cells and rows trade space when their cues are clicked", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		await page.addStyleTag({ url: `${server.url}/src/workspace.css` });
		await page.evaluate(async () => {
			const { Navigator, Workspace } = await import("/src/index.js");
			const host = document.createElement("div");
			host.style.cssText = "position:relative;width:360px;height:420px";
			document.body.append(host);
			const navigator = new Navigator({ root: "mode", minViewportHeight: 300, destinations: {
				mode: { title: "Mode", min: 48, max: 48, overflow: { mode: "keep" } },
				mail: { title: "Mailboxes", min: 180, max: 180, overflow: { mode: "fold", size: 16 } },
				work: { title: "Messages", min: 280, max: "*", preferred: 320 },
			} });
			navigator.open("mail", { from: "mode" });
			navigator.open("work", { from: "mode/mail" });
			window.horizontal = new Workspace(host, { navigator, foldContent: (occurrence) => {
				const label = document.createElement("span");
				label.textContent = occurrence.title.slice(0, 1);
				return label;
			}, content: (occurrence) => {
				const element = document.createElement("button");
				element.textContent = occurrence.title;
				if (occurrence.destination !== "mail") return { element };
				const input = document.createElement("input");
				input.value = "unsent draft";
				const container = document.createElement("div");
				container.append(element, input);
				return { element: container };
			} });
		});
		assert.equal(await page.locator('.supermax-fold-cue[data-fold-occurrence="mode/mail"]').isVisible(), true);
		assert.equal(await page.locator('.supermax-fold-cue[data-fold-occurrence="mode/mail"]').textContent(), "M");
		assert.equal(await page.locator('.supermax-fold-cue[data-fold-occurrence="mode/mail"]').getAttribute("data-direction"), "right");
		assert.equal(await page.locator('.supermax-up-label svg path').count(), 1, "navigation uses the single SVG chevron");
		assert.equal(await page.evaluate(() => window.horizontal.presentation.name), "veil");
		const groups = await page.evaluate(() => window.horizontal.navigator.groups.length);
		const horizontalTarget = await page.locator('.supermax-fold-cue[data-fold-occurrence="mode/mail"]').boundingBox();
		assert.ok(horizontalTarget.width > 0);
		await page.mouse.click(horizontalTarget.x - 3, horizontalTarget.y + horizontalTarget.height / 2);
		assert.equal(await page.evaluate(() => window.horizontal.findCell("mode/mail").full), false, "clicking beside the handle does not unfold");
		await page.locator('.supermax-fold-cue[data-fold-occurrence="mode/mail"] > span').click();
		assert.equal(await page.evaluate(() => window.horizontal.findCell("mode/mail").full), true);
		assert.equal(await page.locator('.supermax-fold-cue[data-fold-occurrence="mode/mail/work"]').isVisible(), true);
		assert.equal(await page.locator('.supermax-fold-cue[data-fold-occurrence="mode/mail/work"]').getAttribute("data-direction"), "left");
		await page.locator('.supermax-fold-cue[data-fold-occurrence="mode/mail/work"]').click();
		assert.equal(await page.evaluate(() => window.horizontal.findCell("mode/mail/work").full), true);
		assert.equal(await page.locator('.supermax-fold-cue[data-fold-occurrence="mode/mail"]').isVisible(), true);
		assert.equal(await page.locator('[data-occurrence="mode/mail"] input').inputValue(), "unsent draft");
		assert.equal(await page.evaluate(() => window.horizontal.navigator.groups.length), groups, "trading space does not add navigation history");
		assert.equal(await page.locator(".supermax-peek, .is-fold-displaced").count(), 0, "no detached or dimmed veil is created");
		assert.equal(await page.evaluate(() => window.horizontal.sync(["mode", "missing"], { origin: null }).ok), false);
		assert.equal(await page.evaluate(() => window.horizontal.findCell("mode/mail/work").full), true, "a rejected navigation leaves fold focus intact");
		await page.evaluate(() => {
			window.horizontal.apply({ type: "close" });
			window.horizontal.apply({ type: "open", destination: "work", from: "mode/mail", origin: null });
			window.horizontal.folds.focus("mode/mail", "horizontal");
		});
		await page.waitForTimeout(400);
		await page.locator('.supermax-fold-cue[data-fold-occurrence="mode/mail/work"]').click();
		assert.equal(await page.evaluate(() => window.horizontal.findCell("mode/mail/work").full), true, "a cell reopened during its exit still has a working fold handle");
		const narrow = await page.evaluate(() => {
			window.horizontal.navigator.resize({ width: 100, height: 420 });
			return window.horizontal.navigator.layout();
		});
		assert.equal(narrow.overflowX, true, "the focused cell and fold cues remain reachable by scrolling below their combined minimum");
		assert.equal(narrow.chain.cells.every((cell) => cell.visible), true);
		await page.evaluate(async () => {
			window.horizontal.destroy();
			document.body.replaceChildren();
			const { Navigator, Workspace } = await import("/src/index.js");
			const host = document.createElement("div");
			host.style.cssText = "position:relative;width:360px;height:300px";
			document.body.append(host);
			const navigator = new Navigator({ root: "root", minViewportHeight: 300, destinations: {
				root: { title: "Home", min: 48, max: 48, overflow: { mode: "keep" } },
				split: { title: "Work", rows: [
					{ destination: "overview", minHeight: 160, maxHeight: 160, overflow: { mode: "fold", size: 20 } },
					{ destination: "detail", minHeight: 250, maxHeight: "*", preferredHeight: 300 },
				] },
				overview: { title: "Overview", min: 280, max: 280 },
				detail: { title: "Detail", min: 280, max: "*", preferred: 320 },
			} });
			navigator.open("split", { from: "root" });
			window.vertical = new Workspace(host, { navigator, content: (occurrence) => {
				const element = document.createElement("button");
				element.textContent = occurrence.title;
				return { element };
			} });
		});
		assert.equal(await page.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="root/split/overview"]').isVisible(), true);
		assert.equal(await page.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="root/split/overview"]').getAttribute("data-direction"), "down");
		assert.equal(await page.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="root/split/overview"] svg path').count(), 1, "the default cue renders its seam motif as an SVG path");
		const verticalTarget = await page.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="root/split/overview"]').boundingBox();
		assert.ok(verticalTarget.height > 0);
		await page.mouse.click(verticalTarget.x + verticalTarget.width + 12, verticalTarget.y + verticalTarget.height / 2);
		assert.equal(await page.evaluate(() => window.vertical.findRow("root/split/overview").folded), true, "the bare row gutter does not unfold");
		await page.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="root/split/overview"] .supermax-fold-mark').click();
		assert.equal(await page.evaluate(() => window.vertical.findRow("root/split/overview").folded), false);
		assert.equal(await page.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="root/split/detail"]').isVisible(), true);
		assert.equal(await page.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="root/split/detail"]').getAttribute("data-direction"), "up");
		const closing = await page.evaluate(async () => {
			document.querySelector('.supermax-fold-cue.is-vertical[data-fold-occurrence="root/split/detail"]').click();
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const row = document.querySelector('[data-row="root/split/overview"]');
			const chain = row.querySelector(":scope > .supermax-row-chain");
			return { rowTop: row.getBoundingClientRect().top, chainTop: chain.getBoundingClientRect().top, overflow: getComputedStyle(row).overflow, background: getComputedStyle(row).backgroundColor };
		});
		assert.equal(closing.overflow, "hidden", "a closing row clips content that would cover its neighbour");
		assert.ok(closing.chainTop >= closing.rowTop - 8, "the closing content stays with its shrinking row");
		assert.equal(closing.background, "rgba(0, 0, 0, 0)", "row backgrounds leave canvas gutters visible");
		assert.equal(await page.evaluate(() => window.vertical.findRow("root/split/detail").folded), false);
		assert.equal(await page.locator('.supermax-fold-cue.is-vertical[data-fold-occurrence="root/split/overview"]').isVisible(), true);
		const short = await page.evaluate(() => {
			window.vertical.navigator.resize({ width: 360, height: 200 });
			return window.vertical.navigator.layout();
		});
		assert.equal(short.overflow, true, "the focused row and fold cue remain reachable by scrolling below their combined minimum");
	} finally {
		await browser.close();
		await server.close();
	}
});

test("the main demo exposes both fold axes and follows its Motion choice", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(server.url);
		await page.getByRole("button", { name: "Folding: cells and rows" }).click();
		const narrow = page.locator('[data-frame="b"]');
		const horizontal = narrow.locator('.supermax-fold-cue.is-horizontal:visible');
		const vertical = narrow.locator('.supermax-fold-cue.is-vertical:visible');
		assert.equal(await horizontal.count(), 1);
		assert.equal(await vertical.count(), 1);
		const seam = await vertical.evaluate((cue) => {
			const mark = cue.querySelector(".supermax-fold-mark").getBoundingClientRect();
			const svg = cue.querySelector("svg").getBoundingClientRect();
			return { offset: svg.y + svg.height / 2 - mark.y - mark.height / 2,
				stroke: getComputedStyle(cue.querySelector("svg")).strokeWidth,
				gutter: getComputedStyle(cue).getPropertyValue("--supermax-gutter").trim() };
		});
		assert.equal(seam.offset, 0, "the rotated crease stays on the seam centreline");
		assert.equal(seam.stroke, seam.gutter, "the crease uses the canvas gutter hairline");
		assert.equal(await narrow.locator('.supermax-cell.is-folded').first().evaluate((cell) => cell.getBoundingClientRect().width), 0);
		assert.equal(await narrow.locator('.supermax-row.is-folded').first().evaluate((row) => row.getBoundingClientRect().height), 0);
		const trade = async () => narrow.evaluate(async (frame) => {
			frame.querySelector('.supermax-fold-cue.is-horizontal:not([inert])').click();
			await new Promise((resolve) => {
				let frames = 0;
				const tick = () => { if (++frames === 6) resolve(); else requestAnimationFrame(tick); };
				requestAnimationFrame(tick);
			});
			return ["albums/album:folding/folding:thumbnails", "albums/album:folding/folding:thumbnails/folding:photo:x"].map((id) => {
				const cell = frame.querySelector(`[data-occurrence="${id}"]`);
				return { offset: Math.abs(cell.getBoundingClientRect().left - cell.parentElement.getBoundingClientRect().left), paper: cell.querySelector(":scope > .supermax-cell-body").getBoundingClientRect().width };
			});
		});
		assert.ok((await trade()).every(({ offset, paper }) => offset < 2 && paper >= 320), "opening left keeps content at full width inside moving rooms");
		await page.waitForTimeout(350);
		assert.ok((await trade()).every(({ offset, paper }) => offset < 2 && paper >= 320), "opening right keeps content at full width inside moving rooms");
		await page.waitForTimeout(350);
		const interrupted = await narrow.evaluate(async (frame) => {
			frame.querySelector('.supermax-fold-cue.is-horizontal:not([inert])').click();
			await new Promise((resolve, reject) => {
				const started = performance.now();
				const tick = () => {
					const width = frame.querySelector('[data-occurrence="albums/album:folding/folding:thumbnails"]').getBoundingClientRect().width;
					if (width > 20 && width < 350) resolve();
					else if (performance.now() - started > 500) reject(new Error("the first fold never reached an intermediate width"));
					else requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			});
			frame.querySelector('.supermax-fold-cue.is-horizontal:not([inert])').click();
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return ["albums/album:folding/folding:thumbnails", "albums/album:folding/folding:thumbnails/folding:photo:x"].map((id) => {
				const cell = frame.querySelector(`[data-occurrence="${id}"]`);
				return { offset: Math.abs(cell.getBoundingClientRect().left - cell.parentElement.getBoundingClientRect().left), paper: cell.querySelector(":scope > .supermax-cell-body").getBoundingClientRect().width };
			});
		});
		assert.ok(interrupted.every(({ offset, paper }) => offset < 2 && paper >= 320), "reversing mid-fold keeps fixed-size content in its room");
		await page.waitForTimeout(350);
		await page.locator('[data-presentation]').selectOption("origami");
		await page.waitForTimeout(250);
		assert.notEqual(await narrow.locator('.supermax-row.is-folded > .supermax-row-chain').evaluate((chain) => getComputedStyle(chain).transform), "none");
		await horizontal.locator(".supermax-fold-mark").click();
		assert.equal(await narrow.locator('.supermax-fold-cue.is-horizontal:visible').count(), 1, "a neighbour replaces the clicked horizontal cue");
		await vertical.locator(".supermax-fold-mark").click();
		assert.equal(await narrow.locator('.supermax-fold-cue.is-vertical:visible').count(), 1, "a neighbour replaces the clicked vertical cue");
		await page.locator('[data-presentation]').selectOption("veil");
		await page.waitForTimeout(250);
		assert.equal(await narrow.locator('.supermax-row.is-folded > .supermax-row-chain').evaluate((chain) => getComputedStyle(chain).transform), "none");
		assert.deepEqual(errors, []);
	} finally {
		await browser.close();
		await server.close();
	}
});

test("Show navigates backward through folds instead of toggling them", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
		await page.goto(server.url);
		await page.getByRole("button", { name: "Folding: cells and rows" }).click();
		const frame = page.locator('[data-frame="b"]');
		await page.waitForTimeout(400);
		assert.equal(await frame.locator('.supermax-up:visible').count(), 1, "folds remain discoverable through Show");
		const result = await page.evaluate(() => {
			const workspace = window.supermaxDemo.frames[1].workspace;
			const navigator = workspace.navigator;
			const before = [...navigator.occurrences.keys()];
			const seen = [];
			for (let step = 0; step < 8 && navigator.upTarget(); step++) {
				const target = navigator.upTarget();
				const axis = workspace.layout.rows.get(target.id)?.folded ? "vertical" : "horizontal";
				const refuse = (event) => event.preventDefault();
				const snapshot = JSON.stringify(navigator.snapshot());
				workspace.addEventListener("show", refuse);
				const cancelled = workspace.requestUp();
				workspace.removeEventListener("show", refuse);
				if (cancelled.ok || JSON.stringify(navigator.snapshot()) !== snapshot) throw new Error("cancelled Show changed navigation");
				const shown = workspace.requestUp();
				seen.push({ axis, closed: shown.closed.length, full: axis === "vertical" ? !workspace.layout.rows.get(target.id).folded : workspace.layout.cells.get(target.id).full });
			}
			return { before, after: [...navigator.occurrences.keys()], seen, target: navigator.upTarget() };
		});
		assert.ok(result.after.length < result.before.length, "back closes trailing cells to restore earlier context");
		assert.equal(result.target, null, "back stops rather than reopening a later fold");
		assert.ok(result.seen.every((step) => step.full));
		assert.deepEqual(new Set(result.seen.map((step) => step.axis)), new Set(["horizontal", "vertical"]));
	} finally {
		await browser.close();
		await server.close();
	}
});

test("fold handles attach in all four directions outside content clipping", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
		await page.goto(server.url);
		await page.getByRole("button", { name: "Folding: cells and rows", exact: true }).click();
		const directions = new Set();
		const check = async () => {
			await page.waitForTimeout(400);
			const marks = await page.locator('[data-frame="b"] .supermax-fold-cue:visible').evaluateAll((cues) => cues.map((cue) => {
				const mark = cue.firstElementChild;
				const box = mark.getBoundingClientRect();
				const style = getComputedStyle(mark);
				return { direction: cue.dataset.direction, layer: cue.parentElement.className, fill: mark.querySelector('.supermax-fold-outline') ? getComputedStyle(mark.querySelector('.supermax-fold-outline')).fill : style.backgroundColor, ink: style.color, corners: ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"].map((key) => parseFloat(style[key])), clickable: cue.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
			}));
			for (const mark of marks) {
				directions.add(mark.direction);
				assert.equal(mark.layer, 'supermax-fold-layer');
				assert.equal(mark.fill, 'rgb(255, 255, 255)');
				assert.equal(mark.ink, 'rgb(221, 221, 221)');
				assert.deepEqual(mark.corners, ({ right: [0, 2, 2, 0], left: [2, 0, 0, 2], down: [0, 0, 2, 2], up: [2, 2, 0, 0] })[mark.direction]);
				assert.equal(mark.clickable, true);
			}
		};
		await check();
		await page.locator('[data-frame="b"] .supermax-fold-cue.is-horizontal:visible').click();
		await check();
		await page.locator('[data-frame="b"] .supermax-fold-cue.is-vertical:visible').click();
		await check();
		assert.deepEqual(directions, new Set(['right', 'left', 'down', 'up']));
	} finally { await browser.close(); await server.close(); }
});

test("the reserved demo uses 8px on both axes and gutters can be disabled", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
		await page.goto(server.url);
		await page.getByRole("button", { name: "Folding: 8px reserved on both axes", exact: true }).click();
		await page.waitForTimeout(500);
		const frame = page.locator('[data-frame="b"]');
		assert.equal(await frame.locator('.supermax-cell.is-folded').first().evaluate((cell) => cell.getBoundingClientRect().width), 8);
		assert.equal(await frame.locator('.supermax-row.is-folded').first().evaluate((row) => row.getBoundingClientRect().height), 8);
		await frame.locator('.supermax-fold-cue.is-horizontal:visible .supermax-fold-mark').click();
		await frame.locator('.supermax-fold-cue.is-vertical:visible .supermax-fold-mark').click();
		await page.getByRole("button", { name: "Folding: cells and rows", exact: true }).click();
		await page.waitForTimeout(500);
		assert.equal(await frame.locator('.supermax-cell.is-folded').first().evaluate((cell) => cell.getBoundingClientRect().width), 0);
		assert.equal(await frame.locator('.supermax-row.is-folded').first().evaluate((row) => row.getBoundingClientRect().height), 0);
		await page.evaluate(() => {
			const workspace = window.supermaxDemo.frames[1].workspace;
			workspace.element.style.setProperty('--supermax-gutter', '0px');
			workspace.render({ animate: false });
		});
		for (const axis of ['horizontal', 'vertical']) {
			const cue = frame.locator(`.supermax-fold-cue.is-${axis}:visible`);
			const style = await cue.evaluate((element, axis) => ({
				gutter: getComputedStyle(element).getPropertyValue("--supermax-gutter"),
				stroke: getComputedStyle(element.querySelector('svg')).strokeWidth,
				outline: getComputedStyle(element.querySelector('.supermax-fold-outline')).strokeWidth,
			}), axis);
			assert.equal(style.gutter, '0px');
			assert.equal(style.stroke, '1px');
			assert.equal(style.outline, '1px');
			await cue.locator('.supermax-fold-mark').click();
		}
	} finally {
		await browser.close();
		await server.close();
	}
});

test("canvas gaps remain one pixel after fold trades, including split and viewport edges", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		for (const scale of [1, 2]) {
			const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: scale });
			await page.goto(server.url);
			await page.getByRole('button', { name: 'Folding: cells and rows', exact: true }).click();
			const checkPixels = async () => {
				await page.waitForTimeout(500);
				const points = await page.evaluate(() => {
					const points = [];
					for (const frame of document.querySelectorAll('.frame')) {
						const workspace = frame.querySelector('.supermax-workspace');
						const bounds = workspace.getBoundingClientRect();
						for (const row of workspace.querySelectorAll('.supermax-row:not(.is-folded):not(.is-hidden)')) {
							const box = row.getBoundingClientRect();
							if (!box.height) continue;
							const y = box.top + box.height * .8;
							points.push({ name: 'split left gutter', x: box.left + .5, y, colour: [221, 221, 221] });
							points.push({ name: 'split left surface', x: box.left + 1.5, y, colour: [255, 255, 255] });
							if (!row.classList.contains('is-leading') && !row.previousElementSibling?.classList.contains('is-unreserved')) points.push({ name: 'row gutter', x: box.left + box.width * .6, y: box.top + .5, colour: [221, 221, 221] });
							for (const cell of row.querySelectorAll('.supermax-cell:not(.is-leading):not(.is-folded)')) {
								const rect = cell.getBoundingClientRect();
								if (rect.width > 0 && rect.left >= bounds.left && rect.right <= bounds.right + .1) points.push({ name: 'cell gutter', x: rect.left + .5, y, colour: [221, 221, 221] });
							}
						}
						for (const cue of workspace.querySelectorAll('.supermax-fold-cue:not([hidden])')) {
							const mark = cue.firstElementChild.getBoundingClientRect();
							const horizontal = cue.classList.contains('is-horizontal');
							points.push({ name: 'handle top thickness', x: mark.left + mark.width / 2, y: mark.top + .5, colour: [221, 221, 221] });
							if (horizontal) {
								const right = cue.dataset.direction === 'right';
								points.push({ name: 'handle side thickness', x: right ? mark.right - .5 : mark.left + .5, y: mark.top + mark.height / 2, colour: [221, 221, 221] });
								points.push({ name: 'handle side inner surface', x: right ? mark.right - 1.5 : mark.left + 1.5, y: mark.top + mark.height / 2, colour: [255, 255, 255] });
							}
							if (cue.dataset.edge === 'right') points.push({ name: 'right viewport gutter', x: bounds.right - .5, y: mark.top - 30, colour: [221, 221, 221] });
							if (cue.dataset.edge === 'bottom') points.push({ name: 'bottom viewport gutter', x: mark.left - 30, y: bounds.bottom - .5, colour: [221, 221, 221] });
						}
					}
					return points;
				});
				const screenshot = (await page.screenshot()).toString('base64');
				const pixels = await page.evaluate(async ({ screenshot, points, scale }) => {
					const image = new Image(); image.src = `data:image/png;base64,${screenshot}`; await image.decode();
					const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
					const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
					return points.map((point) => ({ ...point, actual: [...context.getImageData(Math.floor(point.x * scale), Math.floor(point.y * scale), 1, 1).data].slice(0, 3) }));
				}, { screenshot, points, scale });
				assert.ok(pixels.length > 5);
				for (const point of pixels) assert.deepEqual(point.actual, point.colour, `${point.name} at ${point.x},${point.y}, DPR ${scale}`);
			};
			await checkPixels();
			await page.evaluate(() => window.supermaxDemo.resize([[960, 640], [420, 640]]));
			await checkPixels();
			await page.locator('[data-frame="b"] .supermax-fold-cue.is-horizontal[data-fold-occurrence="albums/album:folding/folding:thumbnails"]').click();
			await checkPixels();
			await page.evaluate(() => window.supermaxDemo.resize([[960, 640], [420, 360]]));
			await page.waitForTimeout(500);
			await page.locator('[data-frame="b"] .supermax-fold-cue.is-vertical:visible').click();
			await checkPixels();
			await page.close();
		}
	} finally { await browser.close(); await server.close(); }
});

test("dragging folds follows the pointer and settles beyond the directional golden ratio", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true });
		await page.goto(`${server.url}/blank`);
		await page.evaluate(() => {
			const viewport = document.createElement("meta");
			viewport.name = "viewport";
			viewport.content = "width=device-width, initial-scale=1";
			document.head.append(viewport);
		});
		await page.addStyleTag({ url: `${server.url}/src/workspace.css` });
		for (const { axis, presentation } of ["horizontal", "vertical"].flatMap((axis) => ["veil", "origami", "fold", "reduced"].map((presentation) => ({ axis, presentation })))) {
			await page.emulateMedia({ reducedMotion: presentation === "reduced" ? "reduce" : "no-preference" });
			await page.evaluate(async ({ axis, presentation }) => {
				window.workspace?.destroy();
				document.body.replaceChildren();
				const { Navigator, Workspace } = await import("/src/index.js");
				const host = document.createElement("div");
				host.style.cssText = "position:relative;width:320px;height:400px";
				document.body.append(host);
				const destinations = axis === "horizontal" ? {
					first: { title: "First", min: 280, max: "*", preferred: 320 }, second: { title: "Second", min: 280, max: "*", preferred: 320 },
				} : {
					mode: { title: "Mode", min: 32, max: 32, overflow: { mode: "keep" } },
					first: { title: "Rows", rows: [{ destination: "upper", minHeight: 300, maxHeight: 300 }, { destination: "lower", minHeight: 300, maxHeight: "*", preferredHeight: 400 }] },
					upper: { title: "Upper", min: 280, max: "*", preferred: 320 }, lower: { title: "Lower", min: 280, max: "*", preferred: 320 },
				};
				const navigator = new Navigator({ root: axis === "horizontal" ? "first" : "mode", destinations, minViewportHeight: 400 });
				if (axis === "horizontal") navigator.open("second", { from: "first" });
				else navigator.open("first", { from: "mode" });
				window.workspace = new Workspace(host, { navigator, content: () => {
					const element = document.createElement("textarea");
					element.value = "a draft that survives the trade";
					return { element };
				} });
				if (presentation === "origami") window.workspace.setPresentation((await import("/src/index.js")).ORIGAMI_PRESENTATION);
				if (presentation === "fold") window.workspace.setPresentation((await import("/assets/presentation-fold.js")).foldPresentation);
				window.committedFolds = 0;
				window.workspace.addEventListener("foldfocus", () => window.committedFolds++);
			}, { axis, presentation });
			for (const direction of axis === "horizontal" ? ["right", "left"] : ["down", "up"]) {
				const cue = page.locator(`.supermax-fold-cue.is-${axis}[data-direction="${direction}"]:visible`);
				for (const fraction of [0.61, 0.63]) {
					const box = await cue.boundingBox();
					const occurrence = await cue.getAttribute("data-fold-occurrence");
					const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
					const target = await page.evaluate(({ occurrence, axis }) => {
						const workspace = window.workspace;
						const previous = workspace.navigator.foldFocuses;
						workspace.navigator.focusFold(occurrence, axis);
						const layout = workspace.navigator.layout();
						workspace.navigator.foldFocuses = previous;
						return axis === "horizontal" ? layout.chain.cells.find((cell) => cell.occurrence === occurrence).width : layout.chain.cells.find((cell) => cell.rows).rows.rows.find((row) => row.occurrence === occurrence).height;
					}, { occurrence, axis });
					const sign = ["left", "up"].includes(direction) ? -1 : 1;
					await page.mouse.move(start.x, start.y);
					await page.mouse.down();
					await page.mouse.move(start.x + (axis === "horizontal" ? sign * target * fraction : 0), start.y + (axis === "vertical" ? sign * target * fraction : 0), { steps: 8 });
					const extent = await page.locator(`[${axis === "horizontal" ? "data-occurrence" : "data-row"}="${occurrence}"]`).evaluate((element, axis) => element.getBoundingClientRect()[axis === "horizontal" ? "width" : "height"], axis);
					assert.ok(Math.abs(extent - target * fraction) < 3, `${presentation} ${direction}: content follows the pointer, got ${extent} of ${target}`);
					const seam = await page.evaluate(({ occurrence, axis, direction }) => {
						const cue = document.querySelector(`.supermax-fold-cue.is-${axis}[data-fold-occurrence="${occurrence}"]`);
						const element = document.querySelector(`[${axis === "horizontal" ? "data-occurrence" : "data-row"}="${occurrence}"]`);
						const source = axis === "horizontal" && element.parentElement.matches(".supermax-room") ? element.parentElement : element;
						const rect = source.getBoundingClientRect();
						const handle = cue.getBoundingClientRect();
						const gutter = parseFloat(getComputedStyle(window.workspace.element).getPropertyValue("--supermax-gutter"));
						const actual = direction === "right" ? handle.left : direction === "left" ? handle.right : direction === "down" ? handle.top : handle.bottom;
						const expected = direction === "right" ? rect.right : direction === "left" ? rect.left + gutter : direction === "down" ? rect.bottom : rect.top + gutter;
						return { actual, expected, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, cell: element.getBoundingClientRect().toJSON(), edge: cue.dataset.edge };
					}, { occurrence, axis, direction });
					assert.ok(Math.abs(seam.actual - seam.expected) < 1, `${presentation} ${direction}: handle follows gutter owner ${JSON.stringify(seam)}`);
					await page.mouse.up();
					await page.waitForTimeout(400);
					assert.equal(await cue.isVisible(), fraction < 0.618, `${direction}: release at ${fraction}`);
				}
			}
			assert.equal(await page.evaluate(() => window.committedFolds), 2, "only completed trades announce focus");
			const touch = await page.context().newCDPSession(page);
			const touchId = await page.locator(`.supermax-fold-cue.is-${axis}:visible`).first().getAttribute("data-fold-occurrence");
			const touchCue = page.locator(`.supermax-fold-cue.is-${axis}[data-fold-occurrence="${touchId}"]`);
			const hit = await touchCue.evaluate((element) => {
				const style = getComputedStyle(element, "::before");
				return { width: parseFloat(style.width), height: parseFloat(style.height), left: style.left, top: style.top, transform: style.transform, visual: { width: element.offsetWidth, height: element.offsetHeight } };
			});
			assert.ok(Number.isFinite(hit.width), JSON.stringify({ axis, presentation, hit }));
			assert.equal(hit.width, Math.max(44, hit.visual.width));
			assert.equal(hit.height, Math.max(44, hit.visual.height));
			assert.equal(parseFloat(hit.left), hit.visual.width / 2);
			assert.equal(parseFloat(hit.top), hit.visual.height / 2);
			const tallHit = await touchCue.evaluate((element) => {
				element.style.height = "60px";
				const style = getComputedStyle(element, "::before");
				const result = { width: parseFloat(style.width), height: parseFloat(style.height), top: parseFloat(style.top) };
				element.style.removeProperty("height");
				return result;
			});
			assert.equal(tallHit.width, Math.max(44, hit.visual.width));
			assert.equal(tallHit.height, 60, "a tall handle gets no extra height");
			assert.equal(tallHit.top, 30);

			for (const ending of ["cancel", "return", "open"]) {
				const box = await touchCue.boundingBox();
				const start = { x: box.x + box.width / 2 + (axis === "vertical" ? 18 : 0), y: box.y + box.height / 2 + (axis === "horizontal" ? 18 : 0) };
				const extent = axis === "horizontal" ? 320 : 300;
				const point = (fraction) => ({ x: start.x + (axis === "horizontal" ? extent * fraction : 0), y: start.y + (axis === "vertical" ? extent * fraction : 0) });
				await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
				await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(.8)] });
				if (ending === "return") await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(.2)] });
				await touch.send("Input.dispatchTouchEvent", { type: ending === "cancel" ? "touchCancel" : "touchEnd", touchPoints: [] });
				await page.waitForTimeout(350);
				assert.equal(await touchCue.isVisible(), ending !== "open", `${axis}: touch ${ending} from the extended hit area`);
			}
			await touch.detach();
			assert.equal(await page.evaluate(() => window.committedFolds), 3, "cancelled and returned touches never commit");

			assert.equal(await page.locator("textarea").first().inputValue(), "a draft that survives the trade");
		}
	} finally {
		await browser.close();
		await server.close();
	}
});

test("a vertical fold drag preserves horizontal fold choices and carries its canvas gutter", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
		await page.goto(server.url);
		await page.getByRole("button", { name: "Folding: cells and rows", exact: true }).click();
		await page.waitForTimeout(500);
		const frame = page.locator('[data-frame="b"]');
		await frame.locator('.supermax-fold-cue.is-horizontal:visible').click();
		await page.waitForTimeout(400);
		const before = await page.evaluate(() => {
			const workspace = window.supermaxDemo.frames[1].workspace;
			window.hostAnimation = workspace.cells.get("albums/album:folding/folding:thumbnails").body.animate([{ outlineOffset: "0px" }, { outlineOffset: "1px" }], { duration: 60000 });
			return [...workspace.layout.cells.values()].filter((cell) => cell.occurrence.includes("folding:thumbnails")).map(({ occurrence, width, folded }) => ({ occurrence, width, folded }));
		});
		const cue = frame.locator('.supermax-fold-cue.is-vertical[data-direction="down"]:visible');
		const box = await cue.boundingBox();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 12 });
		const during = await page.evaluate(() => {
			const workspace = window.supermaxDemo.frames[1].workspace;
			return [...workspace.layout.cells.values()].filter((cell) => cell.occurrence.includes("folding:thumbnails")).map(({ occurrence, width, folded }) => ({ occurrence, width, folded }));
		});
		assert.deepEqual(during, before, "a row trade must not change any horizontal fold choice");
		assert.equal(await page.evaluate(() => window.hostAnimation.playState), "running", "the host's own cell-body animation keeps running");
		const seam = await frame.locator('[data-row="albums/album:folding/folding:thumbnails"]').evaluate((row) => {
			const rect = row.getBoundingClientRect();
			return { x: rect.left + 20, y: rect.top + .5 };
		});
		const png = await page.screenshot();
		const color = await page.evaluate(async ({ png, seam }) => {
			const image = new Image();
			image.src = `data:image/png;base64,${png}`;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.width;
			canvas.height = image.height;
			const context = canvas.getContext("2d");
			context.drawImage(image, 0, 0);
			return [...context.getImageData(Math.floor(seam.x * 2), Math.floor(seam.y * 2), 1, 1).data];
		}, { png: png.toString("base64"), seam });
		assert.deepEqual(color, [221, 221, 221, 255], "the moving row boundary reveals the canvas gutter");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 260, { steps: 10 });
		await page.mouse.up();
		await page.waitForTimeout(350);
		const persisted = await page.evaluate(() => {
			const workspace = window.supermaxDemo.frames[1].workspace;
			const snapshot = workspace.navigator.snapshot();
			workspace.restore(snapshot);
			return [...workspace.layout.cells.values()].filter((cell) => cell.occurrence.includes("folding:thumbnails")).map(({ occurrence, width, folded }) => ({ occurrence, width, folded }));
		});
		assert.deepEqual(persisted, before, "completed row trades and snapshot restore preserve the horizontal choice");
	} finally {
		await browser.close();
		await server.close();
	}
});

test("a released fold finishes visibly and keeps its handle on the moving gutter", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
		await page.goto(server.url);
		await page.getByRole("button", { name: "Folding: cells and rows", exact: true }).click();
		await page.evaluate(() => window.supermaxDemo.resize([[960, 640], [414, 334]]));
		await page.waitForTimeout(400);
		const cue = page.locator('[data-frame="b"] .supermax-fold-cue.is-vertical[data-direction="down"]:visible');
		const occurrence = await cue.getAttribute("data-fold-occurrence");
		const distance = await page.evaluate((id) => {
			const workspace = window.supermaxDemo.frames[1].workspace;
			const previous = workspace.navigator.foldFocuses;
			workspace.navigator.focusFold(id, "vertical");
			const height = workspace.navigator.layout().rows.get(id).height;
			workspace.navigator.foldFocuses = previous;
			return height;
		}, occurrence);
		for (const [fraction, open] of [[0.4, false], [0.75, true]]) {
			const box = await cue.boundingBox();
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + distance * fraction, { steps: 10 });
			const atRelease = await page.evaluate((id) => {
				const row = document.querySelector(`[data-frame="b"] [data-row="${id}"]`);
				const handle = document.querySelector(`[data-frame="b"] .supermax-fold-cue.is-vertical[data-fold-occurrence="${id}"]`);
				return { rowBottom: row.getBoundingClientRect().bottom, handleTop: handle.getBoundingClientRect().top };
			}, occurrence);
			assert.ok(Math.abs(atRelease.rowBottom - atRelease.handleTop) < 0.1, `the handle outline begins at the moving gutter: ${JSON.stringify(atRelease)}`);
			await page.evaluate((id) => {
				window.releaseHeights = [];
				const row = document.querySelector(`[data-frame="b"] [data-row="${id}"]`);
				document.addEventListener("pointerup", () => {
					const started = performance.now();
					const sample = () => {
						window.releaseHeights.push({ elapsed: performance.now() - started, height: row.getBoundingClientRect().height });
						if (performance.now() - started < 260) requestAnimationFrame(sample);
					};
					sample();
				}, { capture: true, once: true });
			}, occurrence);
			await page.mouse.up();
			await page.waitForTimeout(280);
			const heights = await page.evaluate(() => window.releaseHeights.map((sample) => sample.height));
			const start = heights[0];
			const finish = heights.at(-1);
			const between = heights.filter((height) => open ? height > start + 1 && height < finish - 1 : height < start - 1 && height > finish + 1);
			assert.ok(between.length >= 3, `${open ? "opening" : "returning"} has visible intermediate frames: ${heights.join(", ")}`);
			assert.ok(open ? finish > start : finish < start);
		}
	} finally {
		await browser.close();
		await server.close();
	}
});

test("folds opening left or up keep their handles on the interior gutter", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
		await page.goto(server.url);
		await page.getByRole("button", { name: "Folding: cells and rows", exact: true }).click();
		await page.evaluate(() => window.supermaxDemo.resize([[960, 640], [414, 334]]));
		await page.waitForTimeout(400);
		const frame = page.locator('[data-frame="b"]');
		await frame.locator('.supermax-fold-cue.is-horizontal:visible').click();
		await page.waitForTimeout(400);
		const cue = frame.locator('.supermax-fold-cue.is-horizontal[data-direction="left"]:visible');
		const id = await cue.getAttribute("data-fold-occurrence");
		const box = await cue.boundingBox();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 10 });
		const geometry = await page.evaluate((occurrence) => {
			const frame = document.querySelector('[data-frame="b"]');
			const cue = frame.querySelector(`.supermax-fold-cue.is-horizontal[data-fold-occurrence="${occurrence}"]`);
			const cell = frame.querySelector(`[data-occurrence="${occurrence}"]`);
			const viewport = frame.querySelector('.supermax-workspace').getBoundingClientRect();
			const gutter = parseFloat(getComputedStyle(frame.querySelector('.supermax-workspace')).getPropertyValue('--supermax-gutter'));
			return { handleRight: cue.getBoundingClientRect().right, cellLeft: cell.getBoundingClientRect().left, cellRight: cell.getBoundingClientRect().right, viewportRight: viewport.right, gutter };
		}, id);
		assert.ok(Math.abs(geometry.cellRight - geometry.viewportRight) < 2, "the dragged cell still meets the viewport edge");
		assert.ok(Math.abs(geometry.handleRight - geometry.cellLeft - geometry.gutter) < 0.1, `the handle follows the interior gutter: ${JSON.stringify(geometry)}`);
		await page.mouse.up();
		await page.waitForTimeout(250);
		await frame.locator('.supermax-fold-cue.is-vertical[data-direction="down"]:visible').click();
		await page.waitForTimeout(400);
		const upward = frame.locator('.supermax-fold-cue.is-vertical[data-direction="up"]:visible');
		const rowId = await upward.getAttribute("data-fold-occurrence");
		const upwardBox = await upward.boundingBox();
		await page.mouse.move(upwardBox.x + upwardBox.width / 2, upwardBox.y + upwardBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(upwardBox.x + upwardBox.width / 2, upwardBox.y + upwardBox.height / 2 - 100, { steps: 10 });
		const vertical = await page.evaluate((occurrence) => {
			const frame = document.querySelector('[data-frame="b"]');
			const cue = frame.querySelector(`.supermax-fold-cue.is-vertical[data-fold-occurrence="${occurrence}"]`);
			const row = frame.querySelector(`[data-row="${occurrence}"]`);
			const viewport = frame.querySelector('.supermax-workspace').getBoundingClientRect();
			const gutter = parseFloat(getComputedStyle(frame.querySelector('.supermax-workspace')).getPropertyValue('--supermax-gutter'));
			return { handleBottom: cue.getBoundingClientRect().bottom, rowTop: row.getBoundingClientRect().top, rowBottom: row.getBoundingClientRect().bottom, viewportBottom: viewport.bottom, gutter };
		}, rowId);
		assert.ok(Math.abs(vertical.rowBottom - vertical.viewportBottom) < 2, "the dragged row still meets the viewport bottom");
		assert.ok(Math.abs(vertical.handleBottom - vertical.rowTop - vertical.gutter) < 0.1, `the upward handle follows its interior gutter: ${JSON.stringify(vertical)}`);
		await page.mouse.up();
	} finally {
		await browser.close();
		await server.close();
	}
});

test("a completed fold drag carries its handle into the next fold", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
		await page.goto(server.url);
		await page.getByRole("button", { name: "Folding: cells and rows", exact: true }).click();
		await page.evaluate(() => window.supermaxDemo.resize([[960, 640], [414, 334]]));
		await page.waitForTimeout(400);
		const frame = page.locator('[data-frame="b"]');
		await frame.locator('.supermax-fold-cue.is-horizontal:visible').click();
		await page.waitForTimeout(350);
		const cue = frame.locator('.supermax-fold-cue.is-horizontal[data-direction="left"]:visible');
		const box = await cue.boundingBox();
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x - 300, y, { steps: 12 });
		await page.evaluate(() => {
			const frame = document.querySelector('[data-frame="b"]');
			const oldCue = frame.querySelector('.supermax-fold-cue.is-horizontal[data-direction="left"]:not([hidden])');
			const nextCue = [...frame.querySelectorAll('.supermax-fold-cue.is-horizontal')].find((candidate) => candidate !== oldCue && candidate.dataset.foldOccurrence.endsWith("folding:thumbnails"));
			window.foldHandleFrames = [];
			const sample = (elapsed) => {
				const measure = (cue) => {
					const mark = cue.querySelector(".supermax-fold-mark");
					const style = getComputedStyle(mark);
					return { visible: !cue.hidden, x: cue.getBoundingClientRect().left, leftRadius: parseFloat(style.borderTopLeftRadius), rightRadius: parseFloat(style.borderTopRightRadius) };
				};
				window.foldHandleFrames.push({ elapsed, old: measure(oldCue), next: measure(nextCue) });
			};
			sample(-1);
			document.addEventListener("pointerup", () => {
				const start = performance.now();
				const tick = () => { sample(performance.now() - start); if (performance.now() - start < 300) requestAnimationFrame(tick); };
				requestAnimationFrame(tick);
			}, { capture: true, once: true });
		});
		await page.mouse.up();
		await page.waitForTimeout(330);
		const frames = await page.evaluate(() => window.foldHandleFrames);
		const first = frames.findIndex((frame) => frame.next.visible);
		assert.ok(first > 0, "the destination fold takes over after release");
		assert.ok(frames[first].elapsed < 40, "the handoff starts when the pointer is released");
		const before = frames[first - 1].old;
		const after = frames[first].next;
		const end = frames.at(-1).next;
		assert.ok(Math.abs(after.x - before.x) < 3, `the handle does not jump across its gutter: ${JSON.stringify({ before, after })}`);
		assert.ok(Math.abs(after.leftRadius - before.leftRadius) < 0.5 && Math.abs(after.rightRadius - before.rightRadius) < 0.5, "the handle corners start from the previous shape");
		assert.ok(Math.abs(end.x - after.x) > 5, "the handle moves to its new side after transfer");
		assert.ok(frames.slice(first + 1).some((frame) => frame.next.x > Math.min(after.x, end.x) + 1 && frame.next.x < Math.max(after.x, end.x) - 1), "the handle has intermediate positions");
		assert.ok(frames.slice(first + 1).some((frame) => frame.next.leftRadius > Math.min(after.leftRadius, end.leftRadius) + 0.1 && frame.next.leftRadius < Math.max(after.leftRadius, end.leftRadius) - 0.1), "the handle corners round through intermediate values");
	} finally {
		await browser.close();
		await server.close();
	}
});

test("clicking either fold axis animates the same handle handoff", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
		await page.goto(server.url);
		await page.getByRole("button", { name: "Folding: cells and rows", exact: true }).click();
		await page.evaluate(() => window.supermaxDemo.resize([[960, 640], [414, 334]]));
		await page.waitForTimeout(400);
		for (const axis of ["horizontal", "vertical"]) {
			const motion = await page.evaluate(async (axis) => {
				const frame = document.querySelector('[data-frame="b"]');
				const oldCue = frame.querySelector(`.supermax-fold-cue.is-${axis}:not([hidden])`);
				const oldRect = oldCue.getBoundingClientRect();
				const oldStyle = getComputedStyle(oldCue.querySelector(".supermax-fold-mark"));
				const before = { x: oldRect.x, y: oldRect.y, leftRadius: parseFloat(oldStyle.borderTopLeftRadius), rightRadius: parseFloat(oldStyle.borderTopRightRadius) };
				oldCue.click();
				const newCue = [...frame.querySelectorAll(`.supermax-fold-cue.is-${axis}:not([hidden])`)].find((cue) => cue !== oldCue);
				const sample = () => {
					const rect = newCue.getBoundingClientRect();
					const style = getComputedStyle(newCue.querySelector(".supermax-fold-mark"));
					return { x: rect.x, y: rect.y, leftRadius: parseFloat(style.borderTopLeftRadius), rightRadius: parseFloat(style.borderTopRightRadius) };
				};
				const start = sample();
				await new Promise((resolve) => setTimeout(resolve, 60));
				const middle = sample();
				await new Promise((resolve) => setTimeout(resolve, 270));
				return { before, start, middle, end: sample() };
			}, axis);
			const coordinate = axis === "horizontal" ? "x" : "y";
			assert.ok(Math.abs(motion.before[coordinate] - motion.start[coordinate]) < 3, `${axis}: no positional flip on click: ${JSON.stringify(motion)}`);
			assert.ok(Math.abs(motion.before.leftRadius - motion.start.leftRadius) < 0.5 && Math.abs(motion.before.rightRadius - motion.start.rightRadius) < 0.5, `${axis}: corners start from the old handle`);
			assert.ok(Math.abs(motion.middle[coordinate] - motion.start[coordinate]) > 2 && Math.abs(motion.end[coordinate] - motion.middle[coordinate]) > 2, `${axis}: handle moves in intermediate frames`);
			const changingCorners = ["leftRadius", "rightRadius"].filter((corner) => Math.abs(motion.start[corner] - motion.end[corner]) > 1);
			assert.ok(changingCorners.some((corner) => motion.middle[corner] > Math.min(motion.start[corner], motion.end[corner]) + 0.1 && motion.middle[corner] < Math.max(motion.start[corner], motion.end[corner]) - 0.1), `${axis}: corner radius has an intermediate shape: ${JSON.stringify(motion)}`);
		}
	} finally {
		await browser.close();
		await server.close();
	}
});
