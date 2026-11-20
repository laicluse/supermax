import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { serveDocs } from "./serve-docs.js";

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
				mode: { title: "Mode", min: 48, max: 48, keep: true },
				mail: { title: "Mailboxes", min: 180, max: 180, fold: { size: 16 } },
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
		assert.equal(await page.locator('[data-occurrence="mode/mail"] .supermax-fold-cue').isVisible(), true);
		assert.equal(await page.locator('[data-occurrence="mode/mail"] > .supermax-fold-cue').textContent(), "M");
		assert.equal(await page.locator('[data-occurrence="mode/mail"] > .supermax-fold-cue').getAttribute("data-direction"), "right");
		assert.equal(await page.locator('.supermax-up-label svg path').count(), 1, "navigation uses the single SVG chevron");
		assert.equal(await page.evaluate(() => window.horizontal.presentation.name), "veil");
		const groups = await page.evaluate(() => window.horizontal.navigator.groups.length);
		const horizontalTarget = await page.locator('[data-occurrence="mode/mail"] .supermax-fold-cue').boundingBox();
		assert.equal(horizontalTarget.width, 28, "a thin horizontal fold has a wider tap target");
		await page.mouse.click(horizontalTarget.x + 2, horizontalTarget.y + horizontalTarget.height / 2);
		assert.equal(await page.evaluate(() => window.horizontal.findCell("mode/mail").full), true);
		assert.equal(await page.locator('[data-occurrence="mode/mail/work"] .supermax-fold-cue').isVisible(), true);
		assert.equal(await page.locator('[data-occurrence="mode/mail/work"] .supermax-fold-cue').getAttribute("data-direction"), "left");
		await page.locator('[data-occurrence="mode/mail/work"] .supermax-fold-cue').click();
		assert.equal(await page.evaluate(() => window.horizontal.findCell("mode/mail/work").full), true);
		assert.equal(await page.locator('[data-occurrence="mode/mail"] .supermax-fold-cue').isVisible(), true);
		assert.equal(await page.locator('[data-occurrence="mode/mail"] input').inputValue(), "unsent draft");
		assert.equal(await page.evaluate(() => window.horizontal.navigator.groups.length), groups, "trading space does not add navigation history");
		assert.equal(await page.locator(".supermax-peek, .is-fold-displaced").count(), 0, "no detached or dimmed veil is created");
		assert.equal(await page.evaluate(() => window.horizontal.sync(["mode", "missing"], { origin: null }).ok), false);
		assert.equal(await page.evaluate(() => window.horizontal.findCell("mode/mail/work").full), true, "a rejected navigation leaves fold focus intact");
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
				root: { title: "Home", min: 48, max: 48, keep: true },
				split: { title: "Work", rows: [
					{ destination: "overview", minHeight: 160, maxHeight: 160, fold: { size: 20 } },
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
		assert.equal(await page.locator('[data-row="root/split/overview"] > .supermax-fold-cue').isVisible(), true);
		assert.equal(await page.locator('[data-row="root/split/overview"] > .supermax-fold-cue').getAttribute("data-direction"), "down");
		assert.equal(await page.locator('[data-row="root/split/overview"] > .supermax-fold-cue svg path').count(), 1, "the default cue renders its seam motif as an SVG path");
		const verticalTarget = await page.locator('[data-row="root/split/overview"] > .supermax-fold-cue').boundingBox();
		assert.equal(verticalTarget.height, 28, "a thin vertical fold has a taller tap target");
		await page.mouse.click(verticalTarget.x + verticalTarget.width / 2, verticalTarget.y + 2);
		assert.equal(await page.evaluate(() => window.vertical.findRow("root/split/overview").folded), false);
		assert.equal(await page.locator('[data-row="root/split/detail"] > .supermax-fold-cue').isVisible(), true);
		assert.equal(await page.locator('[data-row="root/split/detail"] > .supermax-fold-cue').getAttribute("data-direction"), "up");
		const closing = await page.evaluate(async () => {
			document.querySelector('[data-row="root/split/detail"] > .supermax-fold-cue').click();
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const row = document.querySelector('[data-row="root/split/overview"]');
			const chain = row.querySelector(":scope > .supermax-row-chain");
			return { rowTop: row.getBoundingClientRect().top, chainTop: chain.getBoundingClientRect().top, overflow: getComputedStyle(row).overflow, background: getComputedStyle(row).backgroundColor };
		});
		assert.equal(closing.overflow, "clip", "a closing row clips content that would cover its neighbour");
		assert.ok(closing.chainTop >= closing.rowTop - 8, "the closing content stays with its shrinking row");
		assert.equal(closing.background, "rgb(255, 255, 255)", "a row keeps a surface behind its fading content");
		assert.equal(await page.evaluate(() => window.vertical.findRow("root/split/detail").folded), false);
		assert.equal(await page.locator('[data-row="root/split/overview"] > .supermax-fold-cue').isVisible(), true);
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
		assert.equal(await narrow.locator('.supermax-cell.is-folded').first().evaluate((cell) => cell.getBoundingClientRect().width), 12);
		assert.equal(await narrow.locator('.supermax-row.is-folded').first().evaluate((row) => row.getBoundingClientRect().height), 12);
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
		assert.ok((await trade()).every(({ offset, paper }) => offset < 2 && paper >= 360), "opening left keeps content at full width inside moving rooms");
		await page.waitForTimeout(350);
		assert.ok((await trade()).every(({ offset, paper }) => offset < 2 && paper >= 360), "opening right keeps content at full width inside moving rooms");
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
		assert.ok(interrupted.every(({ offset, paper }) => offset < 2 && paper >= 360), "reversing mid-fold keeps fixed-size content in its room");
		await page.waitForTimeout(350);
		await page.locator('[data-presentation]').selectOption("origami");
		await page.waitForTimeout(250);
		assert.notEqual(await narrow.locator('.supermax-row.is-folded > .supermax-row-chain').evaluate((chain) => getComputedStyle(chain).transform), "none");
		await horizontal.click();
		assert.equal(await narrow.locator('.supermax-fold-cue.is-horizontal:visible').count(), 1, "a neighbour replaces the clicked horizontal cue");
		await vertical.click();
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
