import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openBrowser } from "./browser.js";
import { serveDocs } from "./serve-docs.js";

let server, browser, page;
before(async () => {
	server = await serveDocs();
	browser = await openBrowser();
	page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
	await page.goto(`${server.url}/blank`);
	await page.evaluate(async () => {
		const { Navigator, Workspace, TimeScale } = await import("/src/index.js");
		const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/src/workspace.css"; document.head.append(link);
		await new Promise((resolve) => { link.onload = resolve; });
		const host = document.createElement("div"); host.style.cssText = "width:1000px;height:400px"; window.host = host; document.body.append(host);
		const navigator = new Navigator({ root: "list", minViewportHeight: 100, destinations: {
			list: { title: "List", min: 240, preferred: 320, max: 400 },
			form: { title: "Form", min: 300, preferred: 560, max: 640, overflow: { mode: "keep" }, growOnFocus: true, zoomable: true },
			detail: { title: "Detail", min: 300, preferred: 500, max: "*" },
		} });
		navigator.open("form", { from: "list" });
		navigator.open("detail", { from: "list/form" });
		window.workspace = new Workspace(host, { navigator, time: new TimeScale(1), growOnFocus: true, content: (occurrence) => {
			const element = document.createElement("div");
			element.innerHTML = `<input aria-label="${occurrence.title} field"><button type="button">${occurrence.title} action</button>`;
			return { element };
		} });
		window.renders = 0;
		workspace.addEventListener("render", () => { window.renders += 1; });
		window.width = (id) => workspace.findCell(id)?.width;
		window.finish = async () => {
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			for (const animation of document.getAnimations()) animation.finish();
			await Promise.all([...workspace.chains.values()].map(({ strip }) => strip.finished));
		};
	});
});
after(async () => { await browser?.close(); await server?.close(); });

const widths = () => page.evaluate(() => [width("list/form"), width("list/form/detail")]);
// allow-comment: at 1000px the list leaves the window for the form with focus; the detail stays beside it.
const PLAIN = [353, 394];
const GROWN = [619, 381];
const resize = async (width) => {
	await page.evaluate((width) => { host.style.width = `${width}px`; }, width);
	await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await page.evaluate(() => finish());
};

test("focus inside an opt-in cell grows it with the presentation's motion and focus elsewhere returns it", async () => {
	assert.deepEqual(await widths(), PLAIN);
	await page.getByLabel("Form field").focus();
	await page.waitForFunction(() => document.getAnimations().length > 0 || window.width("list/form") === 619);
	assert.ok(await page.evaluate(() => document.getAnimations().length > 0), "the change animates");
	await page.evaluate(() => finish());
	assert.deepEqual(await widths(), GROWN);
	await page.getByLabel("Detail field").focus();
	await page.evaluate(() => finish());
	assert.deepEqual(await widths(), PLAIN, "a cell without growOnFocus takes nothing");
	await page.getByLabel("Form field").focus();
	await page.evaluate(() => finish());
	await page.evaluate(() => document.activeElement.blur());
	await page.evaluate(() => finish());
	assert.deepEqual(await widths(), PLAIN, "focus leaving the workspace returns the ordinary layout");
});

test("moving focus within the grown cell renders nothing", async () => {
	await page.getByLabel("Form field").focus();
	await page.evaluate(() => finish());
	const before = await page.evaluate(() => window.renders);
	await page.getByRole("button", { name: "Form action" }).focus();
	await page.evaluate(() => finish());
	assert.equal(await page.evaluate(() => window.renders), before);
	await page.evaluate(() => document.activeElement.blur());
	await page.evaluate(() => finish());
});

test("a press on a button in another cell moves nothing until its click has run", async () => {
	await page.getByLabel("Form field").focus();
	await page.evaluate(() => finish());
	assert.deepEqual(await widths(), GROWN);
	await page.evaluate(() => { window.clicked = 0; document.addEventListener("click", (event) => { if (event.target.textContent === "Detail action") window.clicked += 1; }, true); });
	const button = page.getByRole("button", { name: "Detail action" });
	const box = await button.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	assert.deepEqual(await widths(), GROWN, "the layout holds while the pointer is down");
	await page.mouse.up();
	assert.equal(await page.evaluate(() => window.clicked), 1, "the click reached the button it pressed");
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 20)));
	await page.evaluate(() => finish());
	assert.deepEqual(await widths(), PLAIN, "the focus change applies after the click");
});

test("the host's switch turns growth off and on for the cell that has focus", async () => {
	await page.getByLabel("Form field").focus();
	await page.evaluate(() => finish());
	assert.deepEqual(await widths(), GROWN);
	await page.evaluate(() => workspace.setGrowOnFocus(false));
	await page.evaluate(() => finish());
	assert.deepEqual(await widths(), PLAIN);
	await page.evaluate(() => workspace.setGrowOnFocus(true));
	await page.evaluate(() => finish());
	assert.deepEqual(await widths(), GROWN);
	await page.evaluate(() => document.activeElement.blur());
	await page.evaluate(() => finish());
});

test("a zoom holds growth back and zooming out restores it while focus stayed in the cell", async () => {
	await page.getByLabel("Form field").focus();
	await page.evaluate(() => finish());
	assert.deepEqual(await widths(), GROWN);
	await page.evaluate(() => workspace.zoom("list/form"));
	await page.evaluate(() => finish());
	await page.evaluate(() => workspace.zoom(null));
	await page.evaluate(() => finish());
	assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Form field");
	assert.deepEqual(await widths(), GROWN);
	await page.evaluate(() => document.activeElement.blur());
	await page.evaluate(() => finish());
});

test("the cell after the grown one folds for it, and opening that fold ends the growth without closing anything", async () => {
	await resize(800);
	assert.deepEqual(await widths(), [350, 450]);
	await page.getByLabel("Form field").focus();
	await page.evaluate(() => finish());
	const grown = await page.evaluate(() => ({ form: width("list/form"), folded: workspace.layout.cells.get("list/form/detail").folded, open: workspace.navigator.occurrences.size }));
	assert.ok(grown.form >= 560, `the form reaches its preference (${grown.form})`);
	assert.equal(grown.folded, true, "the detail folds for it");
	await page.locator('.supermax-fold-cue[data-fold-occurrence="list/form/detail"]').click();
	await page.evaluate(() => finish());
	assert.deepEqual(await widths(), [350, 450], "the ordinary layout is back");
	assert.equal(await page.evaluate(() => workspace.navigator.occurrences.size), grown.open, "no cell closed");
	assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Form field", "focus stayed where it was");
	await page.getByRole("button", { name: "Form action" }).focus();
	await page.evaluate(() => finish());
	assert.ok(await page.evaluate(() => width("list/form")) >= 560, "growth starts again once focus moves");
	await page.evaluate(() => document.activeElement.blur());
	await page.evaluate(() => finish());
	assert.deepEqual(await widths(), [350, 450]);
	await resize(1000);
});

test("Show brings back a cell that left the window for growth, by ending the growth", async () => {
	await page.getByLabel("Form field").focus();
	await page.evaluate(() => finish());
	assert.equal(await page.evaluate(() => workspace.layout.cells.get("list").visible), false, "the list left the window for the form");
	const open = await page.evaluate(() => workspace.navigator.occurrences.size);
	const result = await page.evaluate(() => workspace.requestUp());
	await page.evaluate(() => finish());
	assert.deepEqual([result.ok, result.closed], [true, []]);
	assert.equal(await page.evaluate(() => workspace.layout.cells.get("list").visible), true, "the list is back");
	assert.deepEqual(await widths(), PLAIN);
	assert.equal(await page.evaluate(() => workspace.navigator.occurrences.size), open, "no cell closed");
	await page.evaluate(() => document.activeElement.blur());
	await page.evaluate(() => finish());
});

test("a workspace destroyed by the click that ends a press renders nothing afterwards", async () => {
	await page.getByLabel("Form field").focus();
	await page.evaluate(() => finish());
	await page.evaluate(() => {
		const outside = document.createElement("button");
		outside.textContent = "Close workspace";
		outside.style.cssText = "position:fixed;left:20px;top:520px";
		document.body.append(outside);
		window.rendersAfterDestroy = 0;
		outside.addEventListener("click", () => {
			workspace.destroy();
			workspace.addEventListener("render", () => { window.rendersAfterDestroy += 1; });
		});
	});
	await page.getByRole("button", { name: "Close workspace" }).click();
	await page.evaluate(() => new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 30)));
	assert.equal(await page.evaluate(() => window.rendersAfterDestroy), 0);
	assert.equal(await page.evaluate(() => document.querySelectorAll(".supermax-cell").length), 0, "no cell comes back");
});
