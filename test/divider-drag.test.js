import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { serveDocs } from "./serve-docs.js";

test("a compact column's gutter follows the pointer through the widths between its forms", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
		await page.goto(`${server.url}/blank`);
		await page.evaluate(async () => {
			const { Navigator, Workspace } = await import("/src/index.js");
			const stylesheet = document.createElement("link");
			stylesheet.rel = "stylesheet"; stylesheet.href = "/src/workspace.css";
			document.head.append(stylesheet);
			await new Promise((resolve) => { stylesheet.onload = resolve; });
			document.body.style.margin = "0";
			const host = document.createElement("div"); host.style.cssText = "width:1800px;height:800px";
			document.body.append(host);
			const menu = (title, min, max, preferred, compact) => ({ title, min, max, preferred, variants: [
				{ id: "labels", when: { minWidth: min } }, { id: "icons", min: compact, max: min - 1, preferred: compact },
			] });
			const navigator = new Navigator({ root: "mode", minViewportHeight: 100, destinations: {
				mode: { ...menu("Mode", 192, 256, 208, 52), overflow: { mode: "keep" } },
				mailboxes: menu("Mailboxes", 208, 320, 256, 88),
				views: menu("Views", 208, 320, 240, 72),
				list: { title: "Conversations", min: 320, max: "*", preferred: 400 },
				detail: { title: "Conversation", min: 640, max: "*", preferred: 1120 },
			} });
			let from = "mode";
			for (const destination of ["mailboxes", "views", "list", "detail"]) from = navigator.open(destination, { from }).occurrence.id;
			window.subject = new Workspace(host, { navigator, content: (occurrence) => {
				const element = document.createElement("div"); element.textContent = occurrence.title; return element;
			} });
			window.sizeEvents = [];
			subject.addEventListener("size", (event) => sizeEvents.push(event.detail));
		});
		await page.waitForFunction(() => document.querySelectorAll(".supermax-cell").length === 5);
		const geometry = () => page.locator(".supermax-cell").evaluateAll((elements) => elements.map((element) => {
			const rect = element.getBoundingClientRect(); return [rect.x, rect.width];
		}));
		const handle = page.locator('[data-divides="mode/mailboxes/views"] .supermax-divider-handle');
		const before = await geometry();
		assert.equal(before[2][1], 72, "the views column is in its compact form at the width it prefers");
		const edge = await handle.boundingBox();
		await page.mouse.move(edge.x + 4, edge.y + 40);
		await page.mouse.down();
		await page.mouse.move(edge.x + 34, edge.y + 40, { steps: 3 });
		const after = await geometry();
		assert.equal((await handle.boundingBox()).x, edge.x + 30, "the grabbed gutter follows the pointer");
		assert.equal(after[2][1], 102, "the column takes a width between its compact and its labelled form");
		assert.deepEqual(after.slice(0, 2), before.slice(0, 2), "the columns before the gutter keep their widths");
		assert.equal(await page.locator('.supermax-cell[data-occurrence="mode/mailboxes/views"]').getAttribute("data-variant"), "icons", "below the labelled form's threshold the column stays compact");
		await page.mouse.up();
	} finally {
		await browser.close(); await server.close();
	}
});

test("a horizontal divider sizes only its preceding row", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		await page.evaluate(async () => {
			const { Navigator, Workspace } = await import("/src/index.js");
			const stylesheet = document.createElement("link"); stylesheet.rel = "stylesheet"; stylesheet.href = "/src/workspace.css";
			document.head.append(stylesheet); await new Promise((resolve) => { stylesheet.onload = resolve; });
			const host = document.createElement("div"); host.style.cssText = "width:700px;height:400px"; document.body.append(host);
			const navigator = new Navigator({ root: "mode", minViewportHeight: 100, destinations: {
				mode: { title: "Mode", min: 48, max: 48, overflow: { mode: "keep" } },
				split: { title: "Rows", rows: ["first", "second", "third"].map((destination) => ({ destination, minHeight: 50, maxHeight: destination === "third" ? "*" : 180, preferredHeight: destination === "third" ? 200 : 50 })) },
				...Object.fromEntries(["first", "second", "third"].map((id) => [id, { title: id, min: 100, max: "*", preferred: 200 }])),
			} });
			navigator.open("split");
			window.subject = new Workspace(host, { navigator, content: (occurrence) => {
				const element = document.createElement("div"); element.textContent = occurrence.title; return element;
			} });
		});
		const handle = page.locator('[data-divides="mode/split/second"].is-horizontal .supermax-divider-handle');
		await handle.waitFor();
		const heights = () => page.evaluate(() => [...subject.layout.rows.values()].map((row) => row.height));
		const before = await heights();
		const edge = await handle.boundingBox();
		await page.mouse.move(edge.x + 50, edge.y + 4); await page.mouse.down();
		await page.mouse.move(edge.x + 50, edge.y + 24, { steps: 4 }); await page.mouse.up();
		assert.deepEqual(await heights(), [before[0], before[1] + 20, before[2] - 20]);
		assert.deepEqual(await page.evaluate(() => [...subject.navigator.sizes.height.keys()]), ["mode/split/second"]);
	} finally {
		await browser.close(); await server.close();
	}
});

test("a divider sizes only its preceding column while earlier columns stay put", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
		await page.goto(`${server.url}/blank`);
		await page.evaluate(async () => {
			const { Navigator, Workspace } = await import("/src/index.js");
			const stylesheet = document.createElement("link"); stylesheet.rel = "stylesheet"; stylesheet.href = "/src/workspace.css";
			document.head.append(stylesheet); await new Promise((resolve) => { stylesheet.onload = resolve; });
			const host = document.createElement("div"); host.style.cssText = "width:900px;height:500px"; document.body.append(host);
			const navigator = new Navigator({ root: "first", minViewportHeight: 100, destinations: Object.fromEntries(
				["first", "second", "third"].map((id) => [id, { title: id, min: 100, max: id === "third" ? "*" : 500, preferred: id === "third" ? 500 : 100, overflow: { mode: "keep" } }]),
			) });
			navigator.open("second"); navigator.open("third", { from: "first/second" });
			window.subject = new Workspace(host, { navigator, content: (occurrence) => {
				const element = document.createElement("div"); element.textContent = occurrence.title; return element;
			} });
		});
		await page.waitForSelector('[data-divides="first/second"]');
		const widths = () => page.evaluate(() => [...subject.layout.cells.values()].map((cell) => cell.width));
		const before = await widths();
		const handle = page.locator('[data-divides="first/second"] .supermax-divider-handle');
		const edge = await handle.boundingBox();
		await page.mouse.move(edge.x + 4, edge.y + 40); await page.mouse.down();
		await page.mouse.move(edge.x + 44, edge.y + 40, { steps: 4 }); await page.mouse.up();
		assert.deepEqual(await widths(), [before[0], before[1] + 40, before[2] - 40]);
		assert.deepEqual(await page.evaluate(() => [...subject.navigator.sizes.width.keys()]), ["first/second"], "the following column remains automatically allocated");
		await page.evaluate(() => subject.setSize("first", 200));
		await handle.hover();
		await page.locator('[data-divides="first/second"] .supermax-divider-reset').click();
		await page.waitForFunction(() => !document.querySelector(".supermax-divider.is-resetting"));
		assert.deepEqual(await page.evaluate(() => [...subject.navigator.sizes.width]), [["first", 200]], "reset removes only the preceding column's size");
		await page.evaluate(() => { subject.setSize("first", null); subject.element.style.width = "300px"; });
		await page.waitForFunction(() => [...subject.layout.cells.values()].every((cell) => cell.width === 100));
		const gutter = handle.locator("..");
		assert.equal(await gutter.evaluate((element) => element.classList.contains("is-fixed")), true, "available room can make a flexible gutter immovable");
		const blocked = await handle.boundingBox();
		await page.mouse.move(blocked.x + 4, blocked.y + 40);
		assert.equal(await gutter.evaluate((element) => element.matches(":hover")), false, "an immovable gutter has no hover state");
		await page.evaluate(() => { subject.element.style.width = "900px"; });
		await page.waitForFunction(() => [...subject.layout.cells.values()].reduce((sum, cell) => sum + cell.width, 0) === 900);
		await handle.hover();
		assert.equal(await gutter.evaluate((element) => element.classList.contains("is-fixed")), false, "resizing the viewport restores the available gutter");
		assert.equal(await handle.evaluate((element) => getComputedStyle(element).cursor), "col-resize");

	} finally {
		await browser.close(); await server.close();
	}
});
