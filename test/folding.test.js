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
		assert.equal(horizontalTarget.width, 28, "the cue positions the handle over the gutter");
		await page.mouse.click(horizontalTarget.x + 2, horizontalTarget.y + horizontalTarget.height / 2);
		assert.equal(await page.evaluate(() => window.horizontal.findCell("mode/mail").full), false, "clicking beside the handle does not unfold");
		await page.locator('[data-occurrence="mode/mail"] .supermax-fold-cue > span').click();
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
		assert.equal(verticalTarget.height, 28, "the cue positions the handle over the row gutter");
		await page.mouse.click(verticalTarget.x + 40, verticalTarget.y + verticalTarget.height / 2);
		assert.equal(await page.evaluate(() => window.vertical.findRow("root/split/overview").folded), true, "the bare row gutter does not unfold");
		await page.locator('[data-row="root/split/overview"] > .supermax-fold-cue .supermax-fold-mark').click();
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
		assert.equal(closing.background, "rgba(0, 0, 0, 0)", "row backgrounds leave canvas gutters visible");
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

test("fold handles use host colours, edge corners and exclusive hit targets", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
		await page.goto(server.url);
		await page.getByRole("button", { name: "Folding: cells and rows" }).click();
		await page.waitForTimeout(400);
		await page.evaluate(() => {
			const workspace = window.supermaxDemo.frames[1].workspace;
			for (const definition of Object.values(workspace.navigator.destinations)) {
				if (definition.rows) definition.rows.forEach((row) => { row.fold = { size: 0 }; });
				else if (!definition.keep && definition.fold !== false) definition.fold = { size: 0 };
			}
			workspace.element.style.setProperty("--supermax-surface", "rgb(255, 255, 255)");
			workspace.element.style.setProperty("--supermax-canvas", "rgb(221, 221, 221)");
			workspace.render({ animate: false });
		});
		const directions = new Set();
		let shifted = false;
		const check = async () => {
			await page.waitForTimeout(400);
			const marks = await page.evaluate(() => {
				const workspace = window.supermaxDemo.frames[1].workspace;
				const bounds = workspace.body.getBoundingClientRect();
				for (const body of workspace.element.querySelectorAll(".supermax-cell.is-split > .supermax-cell-body")) {
					if (body.scrollLeft || body.scrollTop) throw new Error("fold target scrolled its split container");
				}
				return [...workspace.element.querySelectorAll(".is-folded > .supermax-fold-cue")].filter((cue) => cue.getBoundingClientRect().width && cue.getBoundingClientRect().height).map((cue) => {
					const mark = cue.querySelector(".supermax-fold-mark");
					const box = mark.getBoundingClientRect();
					const area = cue.getBoundingClientRect();
					const parent = cue.parentElement.getBoundingClientRect();
					const direction = cue.dataset.direction;
					const horizontal = cue.classList.contains("is-horizontal");
					const centre = horizontal ? area.x + area.width / 2 : area.y + area.height / 2;
					const leadingFold = !horizontal && cue.parentElement.matches(".is-unreserved.is-leading");
					const expected = mark.dataset.edge === "right" ? parent.right - .5 : mark.dataset.edge === "bottom" ? parent.bottom - .5 : (direction === "right" ? parent.right : direction === "left" ? parent.left : direction === "down" ? parent.bottom : parent.top) + (leadingFold ? -.5 : .5);
					return { direction, offset: Math.abs(centre - expected), x: box.x + box.width / 2 - area.x - area.width / 2, y: box.y + box.height / 2 - area.y - area.height / 2, overflow: Math.max(box.right - bounds.right, box.bottom - bounds.bottom), edge: mark.dataset.edge, edgeGap: horizontal ? bounds.right - box.right : bounds.bottom - box.bottom, ink: getComputedStyle(mark).color, outline: getComputedStyle(mark).outlineColor, outlineWidth: getComputedStyle(mark).outlineWidth, attachment: direction === "right" ? box.left - (centre - .5) : direction === "left" ? box.right - (centre + .5) : direction === "down" ? box.top - (centre - .5) : box.bottom - (centre + .5), corners: ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"].map((key) => parseFloat(getComputedStyle(mark)[key])), gutterClickable: cue.contains(document.elementFromPoint(horizontal ? area.x + area.width / 2 : area.x + 40, horizontal ? area.y + 40 : area.y + area.height / 2)), handleClickable: cue.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), fill: getComputedStyle(mark).backgroundColor, padding: parseFloat(getComputedStyle(mark).paddingTop) };
				});
			});
			for (const mark of marks) {
				directions.add(mark.direction);
				assert.ok(mark.offset < .1, "the line lies on the cell or row gutter");
				assert.ok(mark.overflow <= .1, "the rounded surface stays inside the viewport");
				assert.equal(mark.fill, "rgb(255, 255, 255)");
				assert.equal(mark.ink, "rgb(221, 221, 221)");
				assert.equal(mark.outline, mark.ink);
				assert.equal(mark.outlineWidth, "1px");
				assert.deepEqual(mark.corners, ({ right: [0, 2, 2, 0], left: [2, 0, 0, 2], down: [0, 0, 2, 2], up: [2, 2, 0, 0] })[mark.direction]);
				if (mark.edge) assert.ok(Math.abs(mark.edgeGap) < .1, "handle meets the viewport edge");
				assert.ok(mark.padding > 0);
				assert.equal(mark.gutterClickable, false, "the bare gutter does not open the fold");
				assert.equal(mark.handleClickable, true, "only the handle opens the fold");
				shifted ||= mark.x < -1 || mark.y < -1;
				assert.ok(Math.abs(mark.attachment) < .1, "the straight handle side meets the gutter on the unfolding side");
			}
		};
		await check();
		await page.locator('[data-frame="b"] .supermax-fold-cue.is-horizontal:visible .supermax-fold-mark').click();
		await check();
		await page.locator('[data-frame="b"] .supermax-fold-cue.is-vertical:visible .supermax-fold-mark').click();
		await check();
		assert.deepEqual(directions, new Set(["right", "left", "down", "up"]));
		assert.ok(shifted, "the edge case actually exercises an inward shift");
	} finally {
		await browser.close();
		await server.close();
	}
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
				line: getComputedStyle(element, '::after')[axis === 'horizontal' ? 'width' : 'height'],
				stroke: getComputedStyle(element.querySelector('svg')).strokeWidth,
				outline: getComputedStyle(element.querySelector('.supermax-fold-mark')).outlineWidth,
			}), axis);
			assert.deepEqual(style, { line: '0px', stroke: '1px', outline: '1px' });
			await cue.locator('.supermax-fold-mark').click();
		}
	} finally {
		await browser.close();
		await server.close();
	}
});
