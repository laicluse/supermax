import assert from "node:assert/strict";
import { Navigator as BaseNavigator, SupermaxConfigurationError, validateDestinations } from "../src/navigation.js";
import { validateSplit } from "../src/layout.js";
import { GALLERY, chrome, destinations, detail, invalidSplits, item, minViewportHeight, row } from "./fixtures/gallery.js";
import { scenario } from "./scenario.js";

class Navigator extends BaseNavigator {
	constructor(options) {
		super(options);
	}
}

scenario("a cell or row folds below a kept cell and leaves the window where none is kept above it", () => {
	const chain = (kept) => {
		const model = new BaseNavigator({ root: "first", minViewportHeight: 300, destinations: {
			first: { title: "First", min: 48, max: 48, ...(kept ? { overflow: { mode: "keep" } } : {}) },
			selector: { title: "Selector", min: 180, max: 180 },
			content: { title: "Content", min: 270, max: "*", preferred: 320 },
		} });
		model.resize({ width: 340, height: 300 });
		model.open("selector", { from: "first" });
		model.open("content", { from: "first/selector" });
		return model.layout().chain.cells;
	};
	assert.deepEqual(chain(true).map((cell) => cell.folded), [false, true, false], "below a kept cell, the cell that gives way folds");
	assert.equal(chain(true)[1].width, 0);
	assert.deepEqual(chain(false).map((cell) => cell.folded), [false, false, false], "with no kept cell above, nothing folds");
	assert.deepEqual(chain(false).map((cell) => cell.inView), [false, false, true], "the cells that give way leave the window instead");
	const rows = (kept) => {
		const model = new BaseNavigator({ root: "home", minViewportHeight: 300, destinations: {
			home: { title: "Home", min: 40, max: 40, ...(kept ? { overflow: { mode: "keep" } } : {}) },
			split: { title: "Split", rows: [
				{ destination: "summary", minHeight: 170, maxHeight: 170 },
				{ destination: "detail", minHeight: 250, maxHeight: "*", preferredHeight: 280 },
			] },
			summary: { title: "Summary", min: 280, max: 280 },
			detail: { title: "Detail", min: 280, max: "*", preferred: 320 },
		} });
		model.resize({ width: 360, height: 300 });
		model.open("split", { from: "home" });
		return model.layout().chain.cells[1].rows.rows[0];
	};
	assert.equal(rows(true).folded, true, "below a kept cell, the row that gives way folds");
	assert.equal(rows(true).height, 0);
	assert.equal(rows(false).folded, false, "with no kept cell above, the row does not fold");
	const inRow = (kept) => {
		const model = new BaseNavigator({ root: "home", minViewportHeight: 300, destinations: {
			home: { title: "Home", min: 40, max: 40 },
			split: { title: "Split", rows: [
				{ destination: "a", minHeight: 150, maxHeight: "*", preferredHeight: 150, ...(kept ? { overflow: { mode: "keep" } } : {}) },
				{ destination: "b", minHeight: 150, maxHeight: 150 },
			] },
			a: { title: "A", min: 100, max: 100 },
			b: { title: "B", min: 100, max: 100 },
			x: { title: "X", min: 100, max: 100 },
			y: { title: "Y", min: 100, max: "*", preferred: 100 },
		} });
		model.resize({ width: 100, height: 300 });
		model.open("split", { from: "home" });
		for (const row of ["a", "b"]) {
			model.open("x", { from: `home/split/${row}` });
			model.open("y", { from: `home/split/${row}/x` });
		}
		return ["a", "b"].map((row) => model.layout().chains.get(`home/split/${row}`).cells.map((cell) => cell.folded));
	};
	assert.deepEqual(inRow(true), [[true, true, false], [true, true, false]], "inside a kept row and in the rows below it, the cells that give way fold");
	assert.deepEqual(inRow(false), [[false, false, false], [false, false, false]], "with no kept row, the cells of a row leave its window");
});

scenario("a destination cannot ask to leave the window without a fold", () => {
	assert.throws(() => new BaseNavigator({ root: "list", minViewportHeight: 300, destinations: { list: { title: "List", min: 200, max: "*", preferred: 200, overflow: { mode: "hide" } } } }), /invalid-overflow/);
});

function model(width = 1000, height = 500) {
	const instance = new Navigator({ destinations, root: "root", minViewportHeight, chrome });
	instance.resize({ width, height });
	return instance;
}

const titles = (instance) => instance.groups.map((group) => group.title);
const elsewhere = { title: "Elsewhere", min: 100, max: "*", preferred: 100 };
const closedTitles = (result) => result.closed.map((entry) => entry.title);

function openGallery(instance) {
	const result = instance.open("gallery", { from: "root" });
	assert.equal(result.ok, true);
	return result;
}

scenario("a wide workspace opens the gallery with its defaults as one group", () => {
	const wide = model(1000);
	openGallery(wide);
	assert.ok(wide.get(detail("list", "a")), "item and detail auto-open in a row with room");
	assert.ok(wide.get(`${detail("list", "a")}/notes:a`), "defaults chain over three levels");
	assert.deepEqual(titles(wide), ["Gallery"]);
	assert.deepEqual(closedTitles(wide.closeNewestGroup()).slice(0, 2), ["Gallery", "List"], "Back reports every closed occurrence, root first");
	assert.deepEqual(wide.state().occurrences, ["root"]);
	assert.equal(wide.newestGroup(), null);
	assert.equal(wide.closeNewestGroup().ok, false, "the end of history is a result, not an exception");
});

scenario("a default opens only when the row has room, to the pixel", () => {
	const exact = model(450);
	openGallery(exact);
	assert.ok(exact.get(detail("list", "a")), "row width 350 fits 100 + 100 + 150");
	const under = model(449);
	openGallery(under);
	assert.ok(under.get(item("list", "a")));
	assert.ok(!under.get(detail("list", "a")), "one pixel short leaves the detail as a manual choice");
});

scenario("a narrow workspace reaches the same content through more groups", () => {
	const narrow = model(150);
	openGallery(narrow);
	assert.ok(!narrow.get(item("list", "a")), "no room for the item next to the list");
	assert.equal(narrow.open("item:a", { from: row("list") }).ok, true);
	assert.deepEqual(titles(narrow), ["Gallery", "Item A"]);
	assert.equal(narrow.open("detail:a", { from: item("list", "a") }).ok, true);
	assert.deepEqual(titles(narrow), ["Gallery", "Item A", "Detail A"]);
	assert.deepEqual(closedTitles(narrow.closeNewestGroup()), ["Detail A"]);
	assert.deepEqual(closedTitles(narrow.closeNewestGroup()), ["Item A"]);
	assert.deepEqual(titles(narrow), ["Gallery"]);
});

scenario("Back closes groups in reverse opening order across rows", () => {
	for (const [order, expected] of [[["a", "b", "c"], ["Item C", "Item B", "Item A"]], [["a", "c", "b"], ["Item B", "Item C", "Item A"]]]) {
		const instance = model(150);
		openGallery(instance);
		const keys = ["list", "grid", "tags"];
		order.forEach((id, index) => assert.equal(instance.open(`item:${id}`, { from: row(keys[index]) }).ok, true));
		for (const title of expected) assert.deepEqual(closedTitles(instance.closeNewestGroup()), [title]);
		for (const key of keys) assert.ok(instance.get(row(key)), `${key} survives`);
		assert.deepEqual(titles(instance), ["Gallery"]);
	}
});

scenario("an explicit click on auto-opened content promotes it, and its own children stay promotable", () => {
	const wide = model(1000);
	openGallery(wide);
	const promoted = wide.open("item:a", { from: row("list") });
	assert.equal(promoted.promoted, true);
	assert.deepEqual(titles(wide), ["Gallery", "Item A"]);
	assert.equal(wide.isAuto(wide.get(detail("list", "a"))), true, "the detail moved with the item but stays automatic");
	const child = wide.open("detail:a", { from: item("list", "a") });
	assert.equal(child.promoted, true, "a later click on the moved detail promotes it again");
	assert.deepEqual(titles(wide), ["Gallery", "Item A", "Detail A"]);
	assert.deepEqual(closedTitles(wide.closeNewestGroup()), ["Detail A", "Notes A"], "Back closes the detail with its own automatic notes");
	assert.deepEqual(closedTitles(wide.closeNewestGroup()), ["Item A"]);
	assert.ok(wide.get(row("list")));
	assert.equal(wide.open("item:a", { from: row("list") }).ok, true);
	assert.equal(wide.open("item:a", { from: row("list") }).noop, true, "clicking manual content again changes nothing");
});

scenario("promoting a parent after its child was promoted closes both on one Back", () => {
	const wide = model(1000);
	openGallery(wide);
	wide.open("detail:a", { from: item("list", "a") });
	wide.open("item:a", { from: row("list") });
	assert.deepEqual(titles(wide), ["Gallery", "Detail A", "Item A"]);
	const closed = wide.closeNewestGroup();
	assert.deepEqual(closedTitles(closed), ["Item A", "Detail A", "Notes A"], "the subtree closes and is reported in full");
	assert.deepEqual(titles(wide), ["Gallery"], "the orphaned detail group disappears");
});

scenario("replacing content on a slot drops the old subtree without restore", () => {
	const wide = model(1000);
	openGallery(wide);
	assert.equal(wide.open("item:b", { from: row("list") }).ok, true);
	assert.ok(!wide.get(item("list", "a")));
	assert.ok(wide.get(detail("list", "b")), "the replacement opens its own default");
	assert.deepEqual(titles(wide), ["Gallery", "Item B"]);
	assert.deepEqual(closedTitles(wide.closeNewestGroup()), ["Item B", "Detail B"]);
	assert.ok(!wide.get(item("list", "a")), "Back returns to the selector, nothing is restored");
});

scenario("rejections leave the model untouched and name their reason", () => {
	const instance = model(150);
	openGallery(instance);
	instance.open("item:a", { from: row("list") });
	const before = instance.state();
	assert.deepEqual(instance.open("detail:c", { from: item("tags", "c") }), { ok: false, reason: "source-closed", source: item("tags", "c") });
	assert.equal(instance.open("item:a", { from: GALLERY }).reason, "split-source", "rows are owned by their split");
	assert.equal(instance.open("list", { from: GALLERY }).reason, "split-source", "a row root cannot be promoted or replaced");
	assert.equal(instance.open("constructor", { from: "root" }).reason, "unknown-destination");
	assert.deepEqual(instance.state(), before);
	assert.deepEqual(instance.layout().chain.cells.map((cell) => cell.occurrence), ["root", GALLERY], "the layout still renders the same chain");
});

scenario("an impossible split is a configuration error for the developer before anything opens", () => {
	assert.equal(validateDestinations(destinations, { minViewportHeight, chrome }).ok, true, "the fixture is a possible configuration");
	const instance = model(1000, 300);
	assert.equal(validateSplit(instance, "fit", instance.root).ok, true, "28 of the split's title bar and 272 of row = 300 passes");
	const report = validateDestinations({ ...destinations, upside: { title: "Upside", min: 300, max: 200 }, ...invalidSplits }, { minViewportHeight, chrome });
	assert.ok(report.problems.some((problem) => problem.destination === "upside" && problem.reason === "invalid-size"), "contradictory ordinary cell bounds are rejected too");
	const verdict = Object.fromEntries(report.problems.filter((problem) => problem.validation).map((problem) => [problem.destination, problem.validation]));
	assert.deepEqual(Object.keys(verdict).sort(), ["conflict", "crowd", "doubled", "empty", "outer", "over", "rigid", "twins", "unpreferred"]);
	assert.equal(verdict.rigid.reason, "no-elastic-row", "a split without a row whose maxHeight is \"*\" has nowhere to put spare height");
	assert.equal(verdict.doubled.reason, "several-elastic-rows", "and a split with two cannot say which one stretches");
	assert.ok(verdict.unpreferred.rows[0].problems.includes("elastic-without-preferred"), "an elastic row declares its preferred height");
	const cellProblems = (extra) => validateDestinations({ ...destinations, ...extra }, { minViewportHeight, chrome }).problems.map((problem) => [problem.destination, problem.reason]);
	assert.deepEqual(cellProblems({ loose: { title: "Loose", min: 100, max: "*" } }), [["loose", "elastic-without-preferred"]], "an elastic cell declares its preferred width");
	assert.deepEqual(cellProblems({ loose: { title: "Loose", min: 100, max: 200, compact: { min: 48 } } }), [["loose", "unsupported-compact"]], "the removed compact rail is rejected instead of being silently ignored");
	assert.deepEqual(validateDestinations({ root: { title: "Root", min: 100, max: 200 } }, { minViewportHeight, chrome }).problems.map((problem) => problem.reason), ["no-elastic-destination"], "a configuration without any elastic cell is refused");
	const failing = verdict.over.rows.find((candidate) => !candidate.ok);
	assert.deepEqual({ title: failing.title, required: failing.required, chrome: failing.chrome, supported: failing.supported }, { title: "List", required: 301, chrome: 28, supported: 300 }, "one pixel over fails: the split's title bar counts as chrome");
	assert.deepEqual(verdict.conflict.rows[0].problems, ["row-min-exceeds-max", "cell-min-exceeds-max"]);
	assert.equal(verdict.empty.reason, "no-rows");
	assert.deepEqual(verdict.crowd.rows, [], "a split beyond maxRows reports an empty row list");
	assert.equal(verdict.crowd.reason, "too-many-rows");
	assert.ok(verdict.twins.rows[1].problems.includes("duplicate-row-destination"));
	assert.ok(verdict.outer.rows[0].problems.includes("split-row"));
	assert.throws(() => new Navigator({ destinations: { ...destinations, over: invalidSplits.over }, root: "root", minViewportHeight, chrome }), (error) => error instanceof SupermaxConfigurationError && /over, row 0 \(List\): exceeds-supported-height; needs 301px of 300px/.test(error.message), "the navigator refuses an impossible configuration when it is created and names the split, the row and the numbers");
	assert.throws(() => new Navigator({ destinations, root: "root" }), TypeError, "a missing minimum height is a configuration error");
	assert.throws(() => new Navigator({ destinations, root: "root", minViewportHeight, chrome, spareSpace: "middle" }), /spareSpace must be one of start, center, end/, "an unknown spare-space mode is a configuration error");
});

scenario("a split cannot open inside a row, and a row cannot be a split", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	const nested = instance.open("fit", { from: row("list") });
	assert.deepEqual({ reason: nested.reason, detail: nested.validation.reason }, { reason: "invalid-rows", detail: "nested-split" });
	assert.equal(instance.open("item:nested", { from: row("list") }).ok, true, "the item opens");
	assert.ok(!instance.get(`${item("list", "nested")}/inner`), "its default split stays closed inside the row");
	assert.equal(instance.open("inner", { from: item("list", "nested") }).validation.reason, "nested-split", "the manual click gets the same verdict");
});

scenario("rows before the active row can hide, while later rows stay reachable through overflow", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	const rows = () => instance.layout().chain.cells[1].rows.rows;
	assert.deepEqual(rows().map((candidate) => candidate.visible), [true, true, true]);
	assert.equal(rows().reduce((sum, candidate) => sum + candidate.height, 0), 500 - instance.chrome.header, "the rows share what is left below the split's own title bar");
	assert.ok(rows().every((candidate) => candidate.chain.width === instance.layout().chain.cells[1].width), "rows span the split width");

	instance.resize({ width: 1000, height: 300 });
	const before = instance.state();
	assert.deepEqual(rows().map((candidate) => [candidate.visible, candidate.height]), [[false, 0], [true, 118], [true, 154]], "the top row hides entirely, no tab is left, and the lower row gets the larger share");
	assert.deepEqual(instance.state(), before, "resize rewrites nothing");

	instance.startRows(GALLERY, row("list"));
	assert.deepEqual(rows().map((candidate) => [candidate.visible, candidate.height]), [[true, 100], [true, 100], [true, 100]], "a window start cannot silently hide later nonfoldable rows");
	assert.equal(instance.layout().overflow, true, "the later rows remain reachable by scrolling");
	instance.resize({ width: 1000, height: 500 });
	assert.deepEqual(rows().map((candidate) => candidate.visible), [true, true, true], "with room again the window fills toward the end");

	instance.resize({ width: 1000, height: 100 });
	const layout = instance.layout();
	assert.equal(layout.overflow, true);
	assert.deepEqual(rows().map((candidate) => [candidate.visible, candidate.height]), [[true, 100], [true, 100], [true, 100]], "even at a short budget later nonfoldable rows stay reachable");
	assert.equal(layout.contentHeight, 300 + instance.chrome.header, "the content height counts all rows and the split's title bar");
});

scenario("a window start never strands later cells in a row", () => {
	const narrow = model(110, 500);
	openGallery(narrow);
	narrow.open("item:a", { from: row("list") });
	let chain = narrow.layout().chain.cells[1].rows.rows[0].chain;
	assert.deepEqual(chain.cells.map((cell) => cell.visible), [false, true]);
	narrow.startWindow(row("list"), row("list"));
	chain = narrow.layout().chain.cells[1].rows.rows[0].chain;
	assert.deepEqual(chain.cells.map((cell) => cell.visible), [true, true]);
	assert.deepEqual(titles(narrow), ["Gallery", "Item A"]);
	narrow.open("detail:a", { from: item("list", "a") });
	assert.equal(narrow.windowStarts.has(row("list")), false, "an opening resets the window anchor");
	narrow.startWindow(row("list"), row("list"));
	narrow.closeNewestGroup();
	assert.equal(narrow.windowStarts.get(row("list")), row("list"), "closing a group keeps the window anchor");
});

scenario("a split exposes the full width of a protected row that has no kept cell above it", () => {
	const instance = new BaseNavigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 40, max: 40 },
		split: { title: "Split", rows: [{ destination: "list", minHeight: 200, maxHeight: "*", preferredHeight: 250 }] },
		list: { title: "List", min: 200, max: 200 },
		item: { title: "Item", min: 200, max: "*", preferred: 200 },
	} });
	instance.resize({ width: 300, height: 300 });
	instance.open("split", { from: "menu" });
	instance.open("item", { from: "menu/split/list" });
	instance.startWindow("menu/split/list", "menu/split/list");
	const layout = instance.layout();
	assert.deepEqual(layout.chains.get("menu/split/list").cells.map((cell) => cell.visible), [true, true]);
	assert.ok(layout.chain.contentWidth >= 400, "the outer scroll range includes the complete nested row");
});

scenario("Up reaches every cell hidden above the window, newest branch first, never what lies after it", () => {
	const narrow = new Navigator({ destinations: { ...destinations, root: { ...destinations.root, overflow: { mode: "keep" } } }, root: "root", minViewportHeight, chrome });
	narrow.resize({ width: 210, height: 500 });
	openGallery(narrow);
	assert.equal(narrow.upTarget(), null, "nothing is above the window, and the kept root never counts");
	narrow.open("item:a", { from: row("list") });
	narrow.bringIntoView(item("list", "a"));
	assert.deepEqual(narrow.upTarget(), { id: row("list"), title: "List" }, "the parent that hid above the item comes first");
	narrow.bringIntoView(row("list"));
	assert.equal(narrow.upTarget(), null, "the item now after the window is not a target");
	narrow.open("item:b", { from: row("grid") });
	narrow.bringIntoView(item("grid", "b"));
	assert.deepEqual(narrow.upTarget(), { id: row("grid"), title: "Grid" }, "below the kept root, the row cell that folded beside its item is the next target");
	assert.deepEqual(titles(narrow), ["Gallery", "Item A", "Item B"], "finding a target closes nothing");

	const chain = new Navigator({ destinations: { elsewhere, menu: { title: "Menu", min: 100, max: 100, overflow: { mode: "keep" } }, a: { title: "A", min: 100, max: 100, defaultChild: "b" }, b: { title: "B", min: 100, max: 100, defaultChild: "c" }, c: { title: "C", min: 100, max: 100 } }, root: "menu", minViewportHeight, chrome });
	chain.resize({ width: 400, height: 500 });
	chain.open("a", { from: "menu" });
	chain.resize({ width: 120, height: 500 });
	assert.deepEqual(chain.upTarget(), { id: "menu/a/b", title: "B" }, "cells hidden in the middle of a branch are reached from its tip");

	const rows = model(1000, 300);
	openGallery(rows);
	assert.ok(rows.upTarget()?.id.startsWith(row("list")), "a row hidden above is reached, the last row to appear climbing first");
});

scenario("showing a hidden parent closes as many cells from the end as it needs, and no more", () => {
	const set = {
		elsewhere,
		menu: { title: "Menu", min: 100, max: 100 },
		wide: { title: "Wide", min: 300, max: 300, defaultChild: "a" },
		a: { title: "A", min: 50, max: 50, defaultChild: "b" },
		b: { title: "B", min: 50, max: 50, defaultChild: "c" },
		c: { title: "C", min: 50, max: 50, defaultChild: "d" },
		d: { title: "D", min: 50, max: 50, defaultChild: "e" },
		e: { title: "E", min: 50, max: 50, defaultChild: "f" },
		f: { title: "F", min: 50, max: 50 },
	};
	const instance = new Navigator({ destinations: set, root: "menu", minViewportHeight, chrome });
	instance.resize({ width: 1000, height: 500 });
	instance.open("wide", { from: "menu" });
	instance.resize({ width: 300, height: 500 });
	const visible = () => instance.layout().chain.cells.filter((cell) => cell.visible).map((cell) => cell.title);
	assert.deepEqual(visible(), ["A", "B", "C", "D", "E", "F"], "the small cells fill the frame and Wide hides");
	assert.deepEqual(instance.upTarget(), { id: "menu/wide", title: "Wide" });
	const closed = instance.showByClosing("menu/wide");
	assert.deepEqual(closed.map((entry) => entry.title), ["F", "E", "D", "C", "B", "A"], "Wide needs all 300 pixels, so every small cell after it closes, deepest first");
	assert.deepEqual(visible(), ["Wide"]);

	instance.resize({ width: 1000, height: 500 });
	instance.open("a", { from: "menu/wide" });
	instance.resize({ width: 600, height: 500 });
	assert.deepEqual(visible(), ["Wide", "A", "B", "C", "D", "E", "F"], "only the menu hides");
	assert.deepEqual(instance.showByClosing("menu").map((entry) => entry.title), ["F", "E"], "showing the menu closes only the two cells it needs");
	assert.deepEqual(visible(), ["Menu", "Wide", "A", "B", "C", "D"]);
});

scenario("a revealed outer chain does not change which defaults open", () => {
	const plain = model(150, 500);
	openGallery(plain);
	plain.open("item:b", { from: row("grid") });
	const revealed = model(150, 500);
	openGallery(revealed);
	revealed.startWindow("root", "root");
	assert.equal(revealed.layout().chain.cells[1].visible, true, "the gallery after the revealed root remains reachable");
	assert.equal(revealed.open("item:b", { from: row("grid") }).ok, true);
	assert.deepEqual(revealed.state().occurrences, plain.state().occurrences, "the row width ignores the reveal, so the same defaults open");
	assert.equal(revealed.windowStarts.has("root"), false, "an opening resets the reveal anchor of every chain above it");
});

scenario("a kept cell stays at its declared minimum while the cells below it fold", () => {
	const set = {
		elsewhere,
		menu: { title: "Menu", min: 100, max: 100, overflow: { mode: "keep" }, defaultChild: "a" },
		a: { title: "A", min: 100, max: 100, defaultChild: "b" },
		b: { title: "B", min: 100, max: 100, defaultChild: "c" },
		c: { title: "C", min: 100, max: 100 },
	};
	const instance = new Navigator({ destinations: set, root: "menu", minViewportHeight, chrome });
	instance.resize({ width: 400, height: 500 });
	assert.equal(instance.open("a", { from: "menu" }).ok, true);
	const cells = () => instance.layout().chain.cells.map((cell) => (cell.folded ? "folded" : cell.visible ? "full" : "gone"));
	assert.deepEqual(cells(), ["full", "full", "full", "full"]);
	instance.resize({ width: 320, height: 500 });
	assert.deepEqual(cells(), ["full", "folded", "full", "full"], "the kept cell keeps its full minimum while a cell below it folds");
	instance.resize({ width: 220, height: 500 });
	assert.deepEqual(cells(), ["full", "folded", "folded", "full"]);
	instance.resize({ width: 120, height: 500 });
	assert.deepEqual(cells(), ["full", "folded", "folded", "full"], "the kept cell stays at its minimum even when the frame overflows");
	instance.startWindow("menu", "menu/a");
	assert.deepEqual(cells(), ["full", "full", "folded", "folded"], "a window start leaves every later cell reachable through its fold");
	instance.startWindow("menu", null);
	instance.resize({ width: 110, height: 500 });
	assert.deepEqual([instance.layout().overflowX, Math.round(instance.layout().chain.contentWidth)], [true, 200], "the kept cell and newest cell retain their minima when the frame cannot fit both");
});

scenario("a dragged size is a session preference inside min and max, and rows follow the same rule", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	const chain = () => instance.layout().chain.cells[1].rows.rows[0].chain;
	instance.setSize(item("list", "a"), 180);
	assert.equal(Math.round(chain().cells[1].width), 180, "the item keeps its session size");
	assert.equal(chain().cells[1].sized, true);
	instance.setSize(item("list", "a"), 999);
	assert.equal(Math.round(chain().cells[1].width), 200, "a session size is clamped to the maximum");
	instance.setSize(item("list", "a"), 1);
	assert.equal(Math.round(chain().cells[1].width), 100, "and to the minimum");
	instance.setSize(item("list", "a"), null);
	assert.equal(chain().cells[1].sized, false, "a reset returns to the app preference");
	instance.setSize(row("list"), 150, "height");
	assert.equal(instance.layout().chain.cells[1].rows.rows[0].height, 150, "a row keeps its session height");
	const rowChainBefore = Math.round(chain().cells[0].width);
	instance.setSize(row("list"), 120, "width");
	assert.equal(instance.layout().chain.cells[1].rows.rows[0].height, 150, "a row root's width and height are separate session sizes");
	assert.equal(Math.round(chain().cells[0].width), 120, "the width applies to the row root as the first cell of its chain");
	instance.setSize(row("list"), null, "width");
	assert.equal(Math.round(chain().cells[0].width), rowChainBefore);
	const snapshot = instance.snapshot();
	instance.setSize(row("list"), null, "height");
	instance.restore(snapshot);
	assert.equal(instance.layout().chain.cells[1].rows.rows[0].height, 150, "session sizes are part of the snapshot");
	instance.setSize(item("list", "a"), 150, "width");
	instance.open("item:b", { from: `${item("list", "a")}/detail:a` });
	instance.setSize(item("list", "a"), null, "width");
	instance.resize({ width: 1000, height: 500 });
	instance.closeNewestGroup();
	instance.open("item:b", { from: row("list") });
	instance.setSize(item("list", "b"), 190);
	instance.closeNewestGroup();
	assert.equal(instance.sizeOf(item("list", "b"), "width"), null, "closing drops the size of a closed cell");
	assert.throws(() => instance.setSize(item("list", "a"), "abc"), TypeError, "a size that is not a positive number is refused");
	instance.open("item:a", { from: row("list") });
	instance.setSize(item("list", "a"), 190, "width");
	instance.resize({ width: 1000, height: 500 });
	assert.equal(Math.round(chain().cells[1].width), 190, "while the chain has room for it a session size is exact");
	instance.resize({ width: 600, height: 500 });
	const squeezed = chain().cells.find((cell) => cell.occurrence === item("list", "a"));
	assert.equal(squeezed.visible, true, "when the frame shrinks the sized cell stays in view");
	assert.ok(squeezed.width < 190 && squeezed.width >= 100, "and gives up width like a preference instead of pushing others out");
	assert.equal(chain().cells.every((cell) => cell.visible), true, "nothing hides to honour a session size");
	instance.resize({ width: 1000, height: 500 });
	instance.setSize(item("list", "a"), null, "width");
});

scenario("a destination opens only from its registered declaration, and a second declaration may not differ", () => {
	const declared = (title, more = {}) => ({ title, min: 100, max: 200, preferred: null, defaultChild: null, ...more });
	const set = { schemaVersion: 2, context: null, root: "remote:a", destinations: { "remote:a": declared("Remote A", { min: 150, max: 260, defaultChild: "remote:b" }), "remote:b": declared("Remote B") } };
	const instance = model(1000, 500);
	openGallery(instance);
	assert.equal(instance.open("remote:a", { from: item("list", "a") }).reason, "unknown-destination", "an undeclared destination is refused");
	assert.throws(() => instance.open("remote:a", { from: item("list", "a"), hint: { title: "Remote A", min: 120, max: 240 } }), TypeError, "a link cannot carry layout of its own");
	assert.deepEqual(instance.register(set), ["remote:a", "remote:b"], "registering adds the destination and its whole default chain");
	assert.deepEqual(titles(instance), ["Gallery"], "and opens nothing by itself");
	assert.equal(instance.open("remote:a", { from: item("list", "a") }).ok, true);
	assert.ok(instance.get(`${item("list", "a")}/remote:a/remote:b`), "the default chain opens in the same navigation");
	assert.deepEqual(instance.register(set), [], "the same declaration again changes nothing");
	const differs = (problems, reason) => (error) => error instanceof SupermaxConfigurationError && error.problems.some((problem) => problem.reason === reason && problems.includes(problem.destination));
	assert.throws(() => instance.register({ ...set, destinations: { ...set.destinations, "remote:a": { ...set.destinations["remote:a"], min: 120 } } }), differs(["remote:a"], "declaration-mismatch"), "a different declaration for a known destination is a configuration error");
	assert.equal(instance.definitionOf("remote:a").min, 150, "and the known declaration stays");
	assert.throws(() => instance.register({ ...set, root: "remote:c", destinations: { "remote:c": declared("Remote C", { defaultChild: "remote:missing" }) } }), differs(["remote:c"], "missing-destination"), "a set must carry every default it names");
	assert.throws(() => instance.register({ ...set, root: "remote:d", destinations: { "remote:d": declared("Remote D", { defaultChild: "remote:e" }), "remote:e": declared("Remote E", { defaultChild: "remote:d" }) } }), differs(["remote:d", "remote:e"], "default-cycle"), "a cyclic default chain is refused");
	assert.throws(() => instance.register({ ...set, schemaVersion: 3 }), differs(["remote:a"], "schema-version"), "an unknown schema version is refused");
	assert.throws(() => instance.register({ ...set, root: "remote:f", destinations: { "remote:f": { ...declared("Remote F"), data: { kind: "photo" } } } }), differs(["remote:f"], "unknown-field"), "a declaration carries layout only");
	assert.throws(() => instance.register({ ...set, root: "remote:g", destinations: { "remote:g": declared("Remote G", { min: 300, max: 200 }) } }), differs(["remote:g"], "invalid-size"));
	assert.throws(() => instance.register({ ...set, root: "remote:h", destinations: { "remote:h": declared("Remote H", { max: "*" }) } }), differs(["remote:h"], "elastic-without-preferred"), "an elastic declaration names its preferred width");
	assert.deepEqual(instance.register({ ...set, root: "remote:i", destinations: { "remote:i": declared("Remote I", { max: "*", preferred: 180 }) } }), ["remote:i"], "and is accepted with it");
	assert.throws(() => instance.register({ ...set, root: "remote:t", destinations: { "remote:t": { title: "Remote T", rows: [{ destination: "list", minHeight: 400, maxHeight: 500 }] } } }), differs(["remote:t"], "invalid-rows"), "a split is validated against the minimum height when it is registered");
	assert.throws(() => instance.register({ ...set, root: "remote:w", destinations: { "remote:w": declared("Remote W", { rows: [{ destination: "list", minHeight: 100, maxHeight: "*", preferredHeight: 200 }] }) } }), differs(["remote:w"], "split-with-width"), "a split declares no width of its own; its rows decide");
	assert.equal(instance.definitionOf("remote:c"), null, "a refused set registers nothing");

	const viewer = new Navigator({ destinations, root: "root", minViewportHeight, chrome, context: "ana" });
	assert.throws(() => viewer.register({ ...set, context: "ben" }), differs(["remote:a"], "declaration-context"), "a set for another context is refused");
	assert.deepEqual(viewer.register({ ...set, context: "ana" }), ["remote:a", "remote:b"]);
});

scenario("default chains are finite and do not repeat a destination already in the chain", () => {
	const loopy = new Navigator({ destinations: { ...destinations, "loop:a": { title: "Loop A", min: 100, max: 200, defaultChild: "loop:b" }, "loop:b": { title: "Loop B", min: 100, max: 200, defaultChild: "loop:a" } }, root: "root", minViewportHeight, chrome });
	loopy.resize({ width: 2000, height: 500 });
	loopy.open("gallery", { from: "root" });
	loopy.open("loop:a", { from: item("list", "a") });
	const chain = loopy.layout().chain.cells[1].rows.rows[0].chain.cells.map((cell) => cell.title);
	assert.deepEqual(chain.slice(-2), ["Loop A", "Loop B"], "the chain stops where a destination would repeat");
});

scenario("the title names where the newest navigation went", () => {
	const wide = model(1000);
	assert.deepEqual(wide.locationInfo(), { occurrence: "root", title: "Root" });
	openGallery(wide);
	assert.deepEqual(wide.locationInfo(), { occurrence: GALLERY, title: "Gallery" }, "defaults that opened along do not move the title");
	wide.open("item:c", { from: row("tags") });
	assert.equal(wide.locationInfo().title, "Item C", "the title names what the newest navigation opened");
	assert.deepEqual(wide.child(wide.get(row("tags")))?.destination, "item:c");
	wide.closeNewestGroup();
	assert.equal(wide.locationInfo().title, "Gallery", "closing the newest group returns the title to the one before");
});

scenario("a snapshot restores the exact state, including groups and windows", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	instance.open("item:b", { from: row("grid") });
	instance.resize({ width: 300, height: 500 });
	const snapshot = structuredClone(instance.snapshot());
	const expected = instance.state();
	instance.reset();
	assert.deepEqual(instance.state(), { occurrences: ["root"], groups: [] });
	assert.equal(instance.restore(snapshot), true);
	assert.deepEqual(instance.state(), expected);
	assert.deepEqual(closedTitles(instance.closeNewestGroup()), ["Item B", "Detail B"], "history continues from the restored state");
	const stale = structuredClone(snapshot);
	stale.occurrences[1].destination = "renamed";
	assert.equal(instance.restore(stale), false, "a snapshot naming an unknown destination is refused");
	assert.equal(instance.closeNewestGroup().title, "Gallery", "the model is unchanged by the refused restore");
	assert.deepEqual(instance.state().occurrences, ["root"]);
});

console.log("Navigation scenarios passed");

scenario("sync brings the open chain to a list of destinations in one transaction, keeping what both share", () => {
	const chain = new Navigator({
		destinations: {
			elsewhere,
			inbox: { title: "Inbox", min: 200, max: 300 },
			list: { title: "List", min: 200, max: "*", preferred: 300 },
			"conversation:1": { title: "Conversation 1", min: 200, max: 300, defaultChild: "messages:1" },
			"messages:1": { title: "Messages 1", min: 200, max: 300 },
			"conversation:2": { title: "Conversation 2", min: 200, max: 300 },
		},
		root: "inbox",
		minViewportHeight,
		chrome,
	});
	chain.resize({ width: 1400, height: 500 });
	const open = () => {
		const ids = [];
		for (let current = chain.root; current; current = chain.child(current)) ids.push(current.destination);
		return ids;
	};
	const first = chain.sync(["inbox", "list", "conversation:1"]);
	assert.equal(first.ok, true);
	assert.deepEqual(open(), ["inbox", "list", "conversation:1", "messages:1"], "it opens what is missing, defaults included");
	const list = chain.child(chain.root).id;
	assert.equal(chain.sync(["inbox", "list", "conversation:2"]).ok, true);
	assert.deepEqual(open(), ["inbox", "list", "conversation:2"], "it replaces the tail that differs");
	assert.equal(chain.child(chain.root).id, list, "and keeps the occurrence both chains share");
	assert.equal(chain.sync(["inbox", "list"]).ok, true);
	assert.deepEqual(open(), ["inbox", "list"], "it closes what the list no longer names");
	const before = JSON.stringify(chain.snapshot());
	assert.deepEqual(chain.sync(["inbox", "list", "conversation:9"]), { ok: false, reason: "unknown-destination", destination: "conversation:9" }, "an unknown destination refuses the whole sync");
	assert.deepEqual(chain.sync(["list"]), { ok: false, reason: "other-root", destination: "list" }, "and so does a list that starts elsewhere");
	assert.equal(JSON.stringify(chain.snapshot()), before, "leaving the model as it was");
	assert.equal(chain.sync(["inbox", "list"]).noop, true, "a list that is already open changes nothing");
});

scenario("sync opens the longest beginning of ifRoom that shows without hiding what is in view, as cells a later explicit sync promotes", () => {
	const chain = new Navigator({
		destinations: {
			elsewhere,
			inbox: { title: "Inbox", min: 200, max: 300 },
			list: { title: "List", min: 200, max: "*", preferred: 300 },
			"conversation:1": { title: "Conversation 1", min: 200, max: 300 },
			"messages:1": { title: "Messages 1", min: 300, max: 400 },
			"attachments:1": { title: "Attachments 1", min: 200, max: 300 },
		},
		root: "inbox",
		minViewportHeight,
		chrome,
	});
	chain.resize({ width: 1000, height: 500 });
	const open = () => {
		const ids = [];
		for (let current = chain.root; current; current = chain.child(current)) ids.push(current.destination);
		return ids;
	};
	const required = ["inbox", "list", "conversation:1"];
	const before = JSON.stringify(chain.snapshot());
	assert.deepEqual(chain.sync(required, { ifRoom: ["messages:1", "nowhere"] }), { ok: false, reason: "unknown-destination", destination: "nowhere" }, "an unknown optional destination refuses the whole sync");
	assert.equal(JSON.stringify(chain.snapshot()), before, "without touching the model");
	const result = chain.sync(required, { ifRoom: ["messages:1", "attachments:1"] });
	assert.equal(result.ok, true);
	assert.deepEqual(open(), [...required, "messages:1"], "Messages fits next to what is in view, Attachments would push Inbox out of it");
	assert.ok(chain.layout().chain.cells.every((cell) => cell.visible), "so everything stays in view");
	const messages = chain.child(chain.child(chain.child(chain.root)));
	assert.equal(chain.isAuto(messages), true, "an optional cell opens as an automatic one");
	chain.resize({ width: 1400, height: 500 });
	chain.layout();
	assert.deepEqual(open(), [...required, "messages:1"], "a resize opens nothing");
	assert.equal(chain.sync(required, { ifRoom: ["messages:1", "attachments:1"] }).ok, true);
	assert.deepEqual(open(), [...required, "messages:1", "attachments:1"], "the next sync decides again against the wider window");
	assert.equal(chain.sync([...required, "messages:1"]).ok, true);
	assert.equal(chain.isAuto(chain.get(messages.id)), false, "naming an automatic cell in the required list promotes it, as a click does");
	assert.deepEqual(chain.groups.map((group) => group.title).slice(-1), ["Messages 1"], "into a Back step of its own");
	assert.deepEqual(open(), [...required, "messages:1"], "and the optional Attachments it no longer offers closes");
	assert.equal(chain.sync([...required, "messages:1"], { ifRoom: ["attachments:1"] }).ok, true);
	assert.equal(chain.sync([...required, "messages:1"], { ifRoom: ["attachments:1"] }).noop, true, "and a sync that finds everything in place changes nothing");
});

scenario("a nested list in ifRoom opens whole or not at all, so a conversation never shows without its messages", () => {
	const chain = new Navigator({
		destinations: {
			elsewhere,
			inbox: { title: "Inbox", min: 200, max: 300 },
			list: { title: "List", min: 200, max: "*", preferred: 300 },
			"metadata:1": { title: "Metadata 1", min: 200, max: 300 },
			"messages:1": { title: "Messages 1", min: 300, max: 400 },
		},
		root: "inbox",
		minViewportHeight,
		chrome,
	});
	const open = () => {
		const ids = [];
		for (let current = chain.root; current; current = chain.child(current)) ids.push(current.destination);
		return ids;
	};
	chain.resize({ width: 800, height: 500 });
	assert.equal(chain.sync(["inbox", "list"], { ifRoom: [["metadata:1", "messages:1"]] }).ok, true);
	assert.deepEqual(open(), ["inbox", "list"], "Metadata alone would fit, Messages would not, so neither opens");
	chain.resize({ width: 1100, height: 500 });
	assert.equal(chain.sync(["inbox", "list"], { ifRoom: [["metadata:1", "messages:1"]] }).ok, true);
	assert.deepEqual(open(), ["inbox", "list", "metadata:1", "messages:1"], "with room for both, the pair opens together");
	assert.deepEqual(chain.sync(["inbox", "list"], { ifRoom: [["metadata:1", "nowhere"]] }), { ok: false, reason: "unknown-destination", destination: "nowhere" }, "an unknown destination inside a group refuses the whole sync");
});

scenario("a sync closes the optional cells it no longer offers, and keeps the ones it still offers", () => {
	const chain = new Navigator({
		destinations: {
			elsewhere,
			inbox: { title: "Inbox", min: 200, max: 300 },
			list: { title: "List", min: 200, max: "*", preferred: 300 },
			"metadata:1": { title: "Metadata 1", min: 200, max: 300 },
			"messages:1": { title: "Messages 1", min: 200, max: 300 },
			"metadata:2": { title: "Metadata 2", min: 200, max: 300 },
		},
		root: "inbox",
		minViewportHeight,
		chrome,
	});
	const open = () => {
		const ids = [];
		for (let current = chain.root; current; current = chain.child(current)) ids.push(current.destination);
		return ids;
	};
	chain.resize({ width: 1200, height: 500 });
	chain.sync(["inbox", "list"], { ifRoom: [["metadata:1", "messages:1"]] });
	assert.deepEqual(open(), ["inbox", "list", "metadata:1", "messages:1"]);
	assert.equal(chain.sync(["inbox", "list"], { ifRoom: [["metadata:1", "messages:1"]] }).noop, true, "offering the same cells again changes nothing");
	assert.equal(chain.sync(["inbox", "list"], { ifRoom: [] }).ok, true);
	assert.deepEqual(open(), ["inbox", "list"], "a sync that no longer offers them closes them");
	chain.sync(["inbox", "list"], { ifRoom: [["metadata:1", "messages:1"]] });
	chain.sync(["inbox", "list"], { ifRoom: ["metadata:2"] });
	assert.deepEqual(open(), ["inbox", "list", "metadata:2"], "and one that offers other cells replaces them");
});

scenario("a sync can carry the zoom, so the next chain opens zoomed in the same step", () => {
	const chain = new Navigator({
		destinations: {
			elsewhere,
			inbox: { title: "Inbox", min: 200, max: 300 },
			list: { title: "List", min: 200, max: "*", preferred: 300 },
			"messages:1": { title: "Messages 1", min: 300, max: 600, zoomable: true },
			"messages:2": { title: "Messages 2", min: 300, max: 600, zoomable: true },
		},
		root: "inbox",
		minViewportHeight,
		chrome,
	});
	chain.resize({ width: 1200, height: 500 });
	chain.sync(["inbox", "list", "messages:1"], { zoom: "messages:1" });
	assert.equal(chain.zoomed, "inbox/list/messages:1", "the sync zooms the cell it names");
	const result = chain.sync(["inbox", "list", "messages:2"], { zoom: "messages:2" });
	assert.equal(result.ok, true);
	assert.equal(chain.zoomed, "inbox/list/messages:2", "replacing the zoomed cell keeps the zoom on its successor");
	assert.equal(chain.sync(["inbox", "list", "messages:2"], { zoom: "messages:2" }).noop, true, "the same chain and zoom change nothing");
	chain.sync(["inbox", "list", "messages:2"], { zoom: null });
	assert.equal(chain.zoomed, null, "zoom: null zooms out");
	const before = JSON.stringify(chain.snapshot());
	assert.deepEqual(chain.sync(["inbox", "list", "messages:2"], { zoom: "list" }), { ok: false, reason: "not-zoomable", destination: "list" }, "a zoom that is not zoomable refuses the whole sync");
	assert.equal(JSON.stringify(chain.snapshot()), before, "without touching the model");
});

scenario("a title can change after a cell opened, in its occurrence, its group and where the application is, without a new declaration", () => {
	const instance = model();
	openGallery(instance);
	const result = instance.open("item:c", { from: row("tags") });
	assert.equal(instance.setTitle(result.occurrence.id, "Item C, renamed"), true);
	assert.equal(instance.get(result.occurrence.id).title, "Item C, renamed");
	assert.equal(instance.locationInfo().title, "Item C, renamed", "the title follows the occurrence");
	assert.deepEqual(titles(instance), ["Gallery", "Item C, renamed"], "and so does its Back group");
	assert.equal(instance.definitionOf("item:c").title, "Item C", "while the declaration keeps its own title");
	assert.equal(JSON.parse(JSON.stringify(instance.snapshot())).occurrences.find((occurrence) => occurrence.id === result.occurrence.id).title, "Item C, renamed", "and a snapshot keeps the new one");
	assert.equal(instance.setTitle("nowhere", "x"), false);
});

scenario("zoom hides the cells before a zoomable cell, which shares the width with what follows it, like v1", () => {
	const chain = new Navigator({
		destinations: {
			elsewhere,
			inbox: { title: "Inbox", min: 200, max: 300 },
			list: { title: "List", min: 200, max: "*", preferred: 300, defaultChild: "messages" },
			messages: { title: "Messages", min: 300, max: 600, zoomable: true, defaultChild: "attachments" },
			attachments: { title: "Attachments", min: 150, max: 200 },
			plain: { title: "Plain", min: 200, max: 300 },
		},
		root: "inbox",
		minViewportHeight,
		chrome,
	});
	chain.resize({ width: 1400, height: 500 });
	chain.sync(["inbox", "list"]);
	const visible = () => chain.layout().chain.cells.filter((cell) => cell.visible).map((cell) => [cell.title, Math.round(cell.width)]);
	const messages = chain.child(chain.child(chain.root));
	assert.deepEqual(visible().map(([title]) => title), ["Inbox", "List", "Messages", "Attachments"], "everything fits before the zoom");
	assert.equal(chain.zoom(messages.id), true);
	const zoomed = visible();
	assert.deepEqual(zoomed.map(([title]) => title), ["Messages", "Attachments"], "the zoom hides the cells before Messages, and what follows it stays");
	assert.equal(zoomed.reduce((sum, [, width]) => sum + width, 0), 1400, "together they take the whole width");
	assert.ok(zoomed[0][1] > 600, "Messages grows past its own maximum, as the last cell did in v1, since no elastic cell follows it");
	assert.equal(JSON.parse(JSON.stringify(chain.snapshot())).zoomed, messages.id, "a snapshot keeps the zoom");
	assert.equal(chain.zoom(chain.root.id), false, "a cell that is not zoomable cannot zoom");
	assert.equal(chain.zoomed, messages.id);
	chain.sync(["inbox", "list"]);
	chain.closeSubtree(chain.child(chain.child(chain.root)));
	assert.equal(chain.zoomed, null, "the zoom ends when its cell closes");
	assert.deepEqual(visible().map(([title]) => title), ["Inbox", "List"]);
});

const mail = ({ defaults = false, width = 1600 } = {}) => {
	const instance = new Navigator({
		destinations: {
			inbox: { title: "Inbox", min: 200, max: 300 },
			conversation: {
				title: "Conversation",
				header: "title",
				rows: [
					{ destination: "messages", minHeight: 120, maxHeight: "*", preferredHeight: 300 },
					{ destination: "attachments", minHeight: 100, maxHeight: 160 },
				],
			},
			messages: { title: "Messages", min: 300, max: "*", preferred: 600, zoomable: true },
			attachments: { title: "Attachments", min: 200, max: 400, ...(defaults ? { defaultChild: "attachment:1" } : {}) },
			"attachment:1": { title: "Attachment 1", min: 300, max: 500, placement: "beside-split", defaultChild: "info:1" },
			"attachment:2": { title: "Attachment 2", min: 300, max: 500, placement: "beside-split" },
			"info:1": { title: "Info 1", min: 150, max: 200 },
			note: { title: "Note", min: 150, max: 200, zoomable: true },
			"second:conversation": { title: "Second", rows: [{ destination: "note", minHeight: 100, maxHeight: "*", preferredHeight: 200 }] },
		},
		root: "inbox",
		minViewportHeight,
		chrome,
	});
	instance.resize({ width, height: 500 });
	instance.open("conversation", { from: "inbox" });
	return instance;
};
const CONVERSATION = "inbox/conversation";
const ATTACHMENTS = `${CONVERSATION}/attachments`;
const MESSAGES = `${CONVERSATION}/messages`;
const rootTitles = (instance) => instance.layout().chain.cells.map((cell) => [cell.title, cell.visible]);
const rowTitles = (instance, row) => instance.layout().chains.get(row).cells.map((cell) => cell.title);

scenario("a full-height cell opened from a row stands beside the split, at the workspace height, and the row ends at its origin", () => {
	const instance = mail();
	assert.deepEqual(rootTitles(instance), [["Inbox", true], ["Conversation", true]]);
	const opened = instance.open("attachment:2", { from: ATTACHMENTS, origin: null });
	assert.equal(opened.ok, true);
	assert.equal(opened.occurrence.id, `${ATTACHMENTS}/attachment:2`, "the breakout keeps the path of the cell that opened it");
	assert.deepEqual(rootTitles(instance), [["Inbox", true], ["Conversation", true], ["Attachment 2", true]], "it joins the root chain after the split");
	assert.deepEqual(rowTitles(instance, ATTACHMENTS), ["Attachments"], "the attachments row holds only its origin");
	const layout = instance.layout();
	assert.equal(layout.cells.get(`${ATTACHMENTS}/attachment:2`).width, 500, "it takes its own width in the root chain");
	assert.equal(layout.chain.cells[2].rows, undefined, "a breakout is an ordinary cell, not a split");
	assert.ok(layout.chain.cells[1].width >= 300, "the split keeps at least its minimum beside it, the newest cell of its widest row");
	assert.equal(instance.child(instance.get(ATTACHMENTS)).id, `${ATTACHMENTS}/attachment:2`, "child() still answers what the origin opened");
	assert.deepEqual(titles(instance), ["Conversation", "Attachment 2"], "the breakout is a group of its own");
	assert.deepEqual(closedTitles(instance.closeNewestGroup()), ["Attachment 2"], "Back closes the breakout and leaves its origin");
	assert.ok(instance.get(ATTACHMENTS));
	assert.deepEqual(rootTitles(instance), [["Inbox", true], ["Conversation", true]]);
});

scenario("a split holds one breakout: another row replaces it, the same origin replaces it, and defaults never take it from each other", () => {
	const instance = mail();
	instance.open("attachment:1", { from: ATTACHMENTS, origin: null });
	assert.deepEqual(rootTitles(instance).map(([title]) => title), ["Inbox", "Conversation", "Attachment 1", "Info 1"], "a breakout brings its own defaults along in the root chain");
	instance.open("attachment:2", { from: MESSAGES, origin: null });
	assert.deepEqual(rootTitles(instance).map(([title]) => title), ["Inbox", "Conversation", "Attachment 2"], "a breakout from another row replaces the one beside the split");
	assert.equal(instance.get(`${ATTACHMENTS}/attachment:1`), null, "the replaced breakout is gone with its defaults");
	assert.equal(instance.get(`${MESSAGES}/attachment:2`).id, `${MESSAGES}/attachment:2`, "the same destination from another row is a new occurrence");
	instance.open("attachment:1", { from: MESSAGES, origin: null });
	assert.deepEqual(rootTitles(instance).map(([title]) => title), ["Inbox", "Conversation", "Attachment 1", "Info 1"], "the same origin replaces its own breakout");
	assert.deepEqual(closedTitles(instance.closeNewestGroup()), ["Attachment 1", "Info 1"]);
	assert.deepEqual(rootTitles(instance).map(([title]) => title), ["Inbox", "Conversation"], "Back closes the replacement and brings nothing back");
	const defaults = mail({ defaults: true, width: 750 });
	defaults.open("attachment:2", { from: MESSAGES, origin: null });
	const before = defaults.snapshot();
	defaults.closeSubtree(defaults.get(ATTACHMENTS));
	defaults.openDefaults(defaults.get(CONVERSATION), defaults.groupOf(defaults.get(CONVERSATION)));
	assert.equal(defaults.get(`${ATTACHMENTS}/attachment:1`), null, "a default full-height cell does not replace the breakout that is there");
	defaults.restore(before);
	const fresh = mail({ defaults: true, width: 750 });
	assert.equal(fresh.get(`${ATTACHMENTS}/attachment:1`), null, "a default breakout needs room beside the split before it opens by itself");
	fresh.resize({ width: 2400, height: 500 });
	fresh.closeSubtree(fresh.get(CONVERSATION));
	fresh.open("conversation", { from: "inbox" });
	assert.deepEqual(rootTitles(fresh).map(([title]) => title), ["Inbox", "Conversation", "Attachment 1", "Info 1"], "with room, the attachments row's default opens beside the split, with its own default after it");
	assert.equal(fresh.isAuto(fresh.get(`${ATTACHMENTS}/attachment:1`)), true, "as an automatic cell of the conversation's group");
});

scenario("a breakout survives a snapshot, follows the window and zoom rules of the root chain, and Show brings its split back first", () => {
	const instance = mail();
	instance.open("attachment:2", { from: ATTACHMENTS, origin: null });
	const restored = mail();
	assert.equal(restored.restore(instance.snapshot()), true);
	assert.deepEqual(rootTitles(restored).map(([title]) => title), ["Inbox", "Conversation", "Attachment 2"], "a restored breakout stands beside its split again");
	instance.resize({ width: 1000, height: 500 });
	assert.deepEqual(rootTitles(instance), [["Inbox", false], ["Conversation", true], ["Attachment 2", true]], "ancestors hide from the left, the inbox first");
	instance.resize({ width: 800, height: 500 });
	assert.deepEqual(rootTitles(instance), [["Inbox", false], ["Conversation", false], ["Attachment 2", true]], "then the split itself, while the breakout survives");
	assert.equal(instance.upTarget().id, ATTACHMENTS, "Show names the origin of the breakout, hidden with its split");
	const closed = instance.showByClosing(ATTACHMENTS);
	assert.deepEqual(closed.map((entry) => entry.title), ["Attachment 2"], "Show closes the breakout in the root chain so the row's cell can come into view");
	assert.deepEqual(rootTitles(instance), [["Inbox", true], ["Conversation", true]], "and the chain fits again");
	const zoom = mail();
	zoom.open("attachment:2", { from: ATTACHMENTS, origin: null });
	zoom.zoom(MESSAGES);
	assert.deepEqual(rootTitles(zoom), [["Inbox", false], ["Conversation", true], ["Attachment 2", true]], "a zoom inside a row hides what is before the split and keeps the breakout beside it");
	zoom.zoom(null);
	zoom.destinations["attachment:2"] = { ...zoom.destinations["attachment:2"], zoomable: true };
	zoom.zoom(`${ATTACHMENTS}/attachment:2`);
	assert.deepEqual(rootTitles(zoom), [["Inbox", false], ["Conversation", false], ["Attachment 2", true]], "a zoom on the breakout hides the split");
});

scenario("beside-split placement excludes rows and splits while independent splits follow full-height cells", () => {
	const full = { title: "Full", min: 100, max: 200, placement: "beside-split" };
	assert.deepEqual(validateDestinations({ ...destinations, full, bad: { ...destinations.inner, placement: "beside-split" } }, { minViewportHeight, chrome }).problems, [{ destination: "bad", reason: "invalid-placement" }], "a split cannot declare beside-split placement");
	assert.deepEqual(validateDestinations({ ...destinations, full, tall: { ...destinations.gallery, rows: [{ destination: "full", minHeight: 100, maxHeight: "*", preferredHeight: 200 }] } }, { minViewportHeight, chrome }).problems[0].validation.rows[0].problems, ["beside-split-on-row"], "a full-height cell cannot be a row");
	assert.deepEqual(validateDestinations({ ...destinations, half: { ...full, placement: "inside-split" } }, { minViewportHeight, chrome }).problems, [{ destination: "half", reason: "invalid-placement" }]);
	const instance = mail();
	instance.open("attachment:2", { from: ATTACHMENTS, origin: null });
	const second = instance.open("second:conversation", { from: `${ATTACHMENTS}/attachment:2` });
	assert.equal(second.ok, true, "a second split opens after a full-height cell in the root chain");
	assert.deepEqual(rootTitles(instance).map(([title]) => title), ["Inbox", "Conversation", "Attachment 2", "Second"]);
	assert.deepEqual(rowTitles(instance, `${ATTACHMENTS}/attachment:2/second:conversation/note`), ["Note"]);
	const path = ["inbox", "conversation", "attachments", "attachment:2", "second:conversation", "note"];
	const synced = instance.sync(path, { zoom: "note" });
	assert.equal(synced.ok, true);
	assert.deepEqual(synced.opened, [], "sync keeps the breakout already on its path");
	assert.equal(instance.zoomed, `${ATTACHMENTS}/attachment:2/second:conversation/note`, "zoom reaches the second split's row root");
	assert.equal(instance.layout().cells.get(CONVERSATION).visible, false, "zoom hides earlier root-chain splits");
	instance.sync(path, { zoom: null });
	assert.equal(instance.open("second:conversation", { from: path.join("/") }).validation.reason, "nested-split", "a row in a later split still cannot contain a split");
	const inRow = instance.open("note", { from: ATTACHMENTS, origin: null });
	assert.equal(inRow.ok, true);
	assert.deepEqual(rowTitles(instance, ATTACHMENTS), ["Attachments", "Note"], "a cell without the declaration opens inside the row, closing the breakout the origin had");
	assert.deepEqual(rootTitles(instance).map(([title]) => title), ["Inbox", "Conversation"]);
	const plain = mail();
	plain.closeSubtree(plain.get(CONVERSATION));
	assert.equal(plain.open("attachment:2", { from: "inbox" }).ok, true);
	assert.deepEqual(rootTitles(plain).map(([title]) => title), ["Inbox", "Attachment 2"], "from the root chain a full-height cell is an ordinary cell");
});

scenario("sync follows the root chain past a split: a split opens from ifRoom with its rows, a breakout closes when the chain ends before it, and next() names what follows a cell", () => {
	const chain = new Navigator({
		destinations: {
			modes: { title: "Modes", min: 192, max: 256 },
			list: { title: "List", min: 320, max: "*", preferred: 640 },
			"metadata:1": { title: "Metadata", min: 320, max: 640 },
			"conversation:1": { title: "Conversation", rows: [{ destination: "messages:1", minHeight: 240, maxHeight: "*", preferredHeight: 560 }, { destination: "attachments:1", minHeight: 100, maxHeight: 200 }] },
			"messages:1": { title: "Messages", min: 320, max: "*", preferred: 960 },
			"attachments:1": { title: "Attachments", min: 200, max: 400 },
			"attachment:1": { title: "Attachment", min: 300, max: 500, placement: "beside-split" },
		},
		root: "modes",
		minViewportHeight: 320,
	});
	chain.resize({ width: 2200, height: 900 });
	const result = chain.sync(["modes", "list"], { ifRoom: [["metadata:1", "conversation:1"]] });
	assert.equal(result.ok, true, "a split in ifRoom opens like any optional cell");
	assert.deepEqual(result.optional, ["modes/list/metadata:1", "modes/list/metadata:1/conversation:1"]);
	const split = chain.get("modes/list/metadata:1/conversation:1");
	assert.deepEqual(split.children.map((id) => chain.get(id).title), ["Messages", "Attachments"], "with its rows, which share its group");
	assert.ok(chain.layout().cells.get(split.id).rows, "and the layout lays them out");
	const attachments = `${split.id}/attachments:1`;
	assert.equal(chain.open("attachment:1", { from: attachments, origin: null }).ok, true);
	assert.equal(chain.next(split).id, `${attachments}/attachment:1`, "next() names the breakout beside a split");
	assert.equal(chain.next(chain.get(attachments)), null, "and nothing after the cell the breakout left");
	assert.equal(chain.next(chain.root).id, "modes/list", "after an ordinary cell it is the child");
	assert.equal(chain.sync(["modes", "list", "metadata:1", "conversation:1"]).ok, true);
	assert.equal(chain.get(`${attachments}/attachment:1`), null, "a sync whose chain ends at the split closes the breakout beside it");
	assert.ok(chain.get(attachments), "and keeps the row's cell");
	assert.equal(chain.sync(["modes", "list", "metadata:1", "conversation:1"]).noop, true, "a sync that finds the chain in place changes nothing");
});

scenario("a split declares no width: it asks for what its widest row holds, grows as the row opens cells, and keeps its newest row cell before its neighbours hide", () => {
	const instance = mail({ width: 1300 });
	const widths = () => instance.layout().chain.cells.map((cell) => [cell.title, Math.round(cell.width)]);
	instance.open("attachment:2", { from: ATTACHMENTS, origin: null });
	const before = widths();
	assert.equal(before[1][0], "Conversation");
	instance.open("note", { from: MESSAGES, origin: null });
	const after = widths();
	assert.ok(after[1][1] > before[1][1], `opening a cell in a row widens the split: ${JSON.stringify([before, after])}`);
	assert.ok(after[2][1] < before[2][1], "and the breakout beside it gives room up");
	assert.deepEqual(rowTitles(instance, MESSAGES), ["Messages", "Note"], "the row holds both cells");
	instance.resize({ width: 1100, height: 500 });
	const tight = instance.layout();
	assert.deepEqual(tight.chain.cells.map((cell) => [cell.title, cell.visible]), [["Inbox", false], ["Conversation", true], ["Attachment 2", true]], "when room for every preference runs out the inbox hides first");
	assert.ok(tight.chain.cells[1].width >= 200 && tight.chain.cells[2].width >= 300, "what shows stands on at least its minimum: the split its widest row's newest cell, the breakout its own");
	instance.resize({ width: 690, height: 500 });
	assert.deepEqual(instance.layout().chain.cells.map((cell) => [cell.title, cell.visible]), [["Inbox", false], ["Conversation", false], ["Attachment 2", true]], "then the split hides rather than squeezes below what it asks, while the breakout survives");
	const narrow = mail({ defaults: true, width: 1300 });
	assert.ok(narrow.get(`${ATTACHMENTS}/attachment:1`), "a default opens when the room its chain then asks for still shows every cell that showed");
	assert.deepEqual(narrow.layout().chain.cells.map((cell) => cell.visible), [true, true, true, true]);
});

scenario("sync names a path into a row: the next id after a split is one of its rows, the chain continues inside it, and an explicit cell there asks for room like any cell", () => {
	const E = "*";
	const chain = new Navigator({
		destinations: {
			modes: { title: "Modes", min: 192, max: 256, overflow: { mode: "keep" } },
			mailboxes: { title: "Mailboxes", min: 256, max: 320 },
			conversations: { title: "Conversations", min: 320, max: E, preferred: 600 },
			conversation: { title: "Subject", rows: [{ destination: "metadata", minHeight: 240, maxHeight: E, preferredHeight: 560 }, { destination: "attachments", minHeight: 96, maxHeight: 120 }] },
			metadata: { title: "Subject", min: 320, max: 640, defaultChild: "messages" },
			messages: { title: "Subject", min: 320, max: E, preferred: 960, zoomable: true },
			attachments: { title: "Attachments", min: 320, max: E, preferred: 400 },
			attachment: { title: "Attachment", min: 320, max: E, preferred: 400, placement: "beside-split" },
		},
		root: "modes",
		minViewportHeight: 320,
	});
	chain.resize({ width: 1500, height: 900 });
	const visible = () => chain.layout().chain.cells.map((cell) => [cell.title, cell.visible]);
	const root = ["modes", "mailboxes", "conversations", "conversation"];
	assert.equal(chain.sync(root).ok, true);
	const split = chain.get("modes/mailboxes/conversations/conversation");
	assert.equal(chain.get(`${split.id}/metadata/messages`), null, "the row's default does not open: it would hide the mailboxes");
	const into = chain.sync([...root, "metadata", "messages"]);
	assert.equal(into.ok, true, "a sync may name a row of the split and go on inside it");
	assert.deepEqual(into.opened, [`${split.id}/metadata/messages`], "and reports what it opened");
	assert.deepEqual(chain.layout().chain.cells.map((cell) => [cell.title, cell.folded]), [["Modes", false], ["Mailboxes", true], ["Conversations", true], ["Subject", false]], "named explicitly, the cell takes the room it asks for and the cells below the kept Modes fold");
	assert.equal(chain.isAuto(chain.get(`${split.id}/metadata/messages`)), false, "it is a manual cell");
	assert.equal(chain.sync([...root, "metadata", "messages"]).noop, true, "the same path again changes nothing");
	assert.equal(chain.sync(root).noop, true, "a sync that ends at the split leaves its rows as they are");
	assert.ok(chain.get(`${split.id}/metadata/messages`));
	assert.deepEqual(chain.sync([...root, "mailboxes"]), { ok: false, reason: "not-a-row", destination: "mailboxes", source: split.id }, "an id after a split must name one of its rows");
	assert.equal(chain.sync([...root, "attachments", "attachment"]).ok, true);
	assert.equal(chain.next(split)?.id, `${split.id}/attachments/attachment`, "a full-height cell named after a row cell opens beside the split");
	assert.ok(chain.get(`${split.id}/metadata/messages`), "and the other row keeps its cell");
	assert.equal(chain.sync([...root, "metadata"]).ok, true);
	assert.equal(chain.get(`${split.id}/metadata/messages`), null, "a sync that ends at a row root closes what the row had opened");
	assert.equal(chain.get(`${split.id}/attachments/attachment`), null, "and the breakout beside the split, since the path did not name it");
	assert.equal(chain.sync([...root, "attachments", "attachment"]).ok, true);
	assert.equal(chain.sync(root).ok, true);
	assert.equal(chain.get(`${split.id}/attachments/attachment`), null, "a sync that ends at the split closes the breakout");
	const fresh = new Navigator({ destinations: chain.destinations, root: "modes", minViewportHeight: 320 });
	fresh.resize({ width: 1200, height: 900 });
	const whole = fresh.sync([...root, "metadata", "messages"]);
	assert.equal(whole.ok, true, "a path into a row opens the split and steps into its row in one sync");
	assert.deepEqual(whole.opened.map((id) => id.split("/").pop()), ["mailboxes", "conversations", "conversation", "messages"], "the rows themselves are not opened, they come with the split");
	assert.ok(fresh.get("modes/mailboxes/conversations/conversation/metadata/messages"));
	assert.equal(chain.sync([...root, "metadata", "messages"], { zoom: "messages" }).ok, true);
	assert.equal(chain.zoomed, `${split.id}/metadata/messages`, "the zoom may name a cell inside the row");
	assert.equal(chain.groups.some((group) => group.root === `${split.id}/metadata`), false, "a row root is never promoted into a group of its own");
});

scenario("room gives way in reading order through a split: the cells before it first, then the row's older cells, the split last, and Show closes the newest row cell before the split", () => {
	const E = "*";
	const destinations = {
		modes: { title: "Modes", min: 192, max: 256, overflow: { mode: "keep" } },
		mailboxes: { title: "Mailboxes", min: 256, max: 320 },
		nav: { title: "Nav", min: 256, max: 320 },
		conversations: { title: "Conversations", min: 320, max: E, preferred: 400 },
		conversation: { title: "Subject", rows: [{ destination: "metadata", minHeight: 240, maxHeight: E, preferredHeight: 560 }, { destination: "attachments", minHeight: 96, maxHeight: 120 }] },
		metadata: { title: "Summary", min: 320, max: 640, defaultChild: "messages" },
		messages: { title: "Messages", min: 320, max: E, preferred: 480 },
		attachments: { title: "Attachments", min: 320, max: E, preferred: 400 },
		attachment: { title: "Attachment", min: 320, max: E, preferred: 400, placement: "beside-split" },
	};
	const at = (width) => {
		const chain = new Navigator({ destinations, root: "modes", minViewportHeight: 320 });
		chain.resize({ width, height: 900 });
		return chain;
	};
	const root = ["modes", "mailboxes", "nav", "conversations", "conversation"];
	const split = "modes/mailboxes/nav/conversations/conversation";
	const picture = (chain) => {
		const layout = chain.layout();
		return {
			root: layout.chain.cells.map((cell) => `${cell.title}:${cell.visible ? Math.round(cell.width) : "hidden"}`),
			row: layout.chains.get(`${split}/metadata`)?.cells.map((cell) => `${cell.title}:${cell.visible ? Math.round(cell.width) : "hidden"}`) ?? null,
		};
	};
	const wide = at(1920);
	wide.sync([...root, "metadata", "messages"]);
	wide.sync([...root, "attachments", "attachment"]);
	wide.open("messages", { from: `${split}/metadata`, origin: null });
	let shown = picture(wide);
	assert.ok(shown.row.length === 2 && shown.row.every((cell) => !cell.endsWith("hidden")), `at 1920 the summary and the messages stand side by side in the row: ${shown.row}`);
	assert.ok(Number(shown.root[0].split(":")[1]) >= 192, "the kept menu retains its declared minimum");
	const laptop = at(1440);
	laptop.sync([...root, "metadata", "messages"]);
	laptop.sync([...root, "attachments", "attachment"]);
	laptop.open("messages", { from: `${split}/metadata`, origin: null });
	shown = picture(laptop);
	assert.ok(Number(shown.root[0].split(":")[1]) >= 192);
	assert.deepEqual(shown.root.slice(1, 3), ["Mailboxes:0", "Nav:0"], "at 1440 the mailboxes and the nav fold first, below the kept menu");
	assert.ok(shown.row.length === 2 && shown.row.every((cell) => !cell.endsWith("hidden")), `so the summary keeps standing beside the messages, and the attachment beside the split: ${shown.row}`);
	assert.ok(shown.root[5].startsWith("Attachment:") && !shown.root[5].endsWith("hidden"));
	const show = at(1000);
	show.sync([...root, "metadata", "messages"]);
	assert.equal(show.layout().cells.get("modes/mailboxes/nav/conversations").folded, true, "at 1000 the list has folded for the split");
	const closed = show.showByClosing("modes/mailboxes/nav/conversations");
	assert.deepEqual(closed.map((entry) => entry.title), ["Messages"], "Show closes the newest cell inside the rows, not the split");
	assert.ok(show.get(split), "the split stays with its summary");
	assert.equal(show.layout().cells.get("modes/mailboxes/nav/conversations").folded, false, "and the list is back in view");
});

scenario("ifRoom may name a path into a row, and opens it whole or not at all", () => {
	const E = "*";
	const make = (width) => {
		const chain = new Navigator({
			destinations: {
				modes: { title: "Modes", min: 192, max: 256, overflow: { mode: "keep" } },
				conversations: { title: "Conversations", min: 320, max: E, preferred: 400 },
				conversation: { title: "Subject", header: "title", rows: [{ destination: "metadata", minHeight: 240, maxHeight: E, preferredHeight: 560 }] },
				metadata: { title: "Summary", min: 320, max: 640 },
				messages: { title: "Messages", min: 320, max: E, preferred: 960 },
			},
			root: "modes",
			minViewportHeight: 320,
			});
		chain.resize({ width, height: 900 });
		return chain;
	};
	const wide = make(1400);
	const offered = wide.sync(["modes", "conversations"], { ifRoom: [["conversation", "metadata", "messages"]] });
	assert.deepEqual(offered.optional.map((id) => id.split("/").pop()), ["conversation", "messages"], "with room, the conversation opens with its messages inside its row, the row itself coming with the split");
	assert.equal(wide.isAuto(wide.get("modes/conversations/conversation/metadata/messages")), true, "as automatic cells");
	const tight = make(1000);
	const refused = tight.sync(["modes", "conversations"], { ifRoom: [["conversation", "metadata", "messages"]] });
	assert.deepEqual(refused.optional, [], "without room for the messages the conversation stays closed, whole or not at all");
	assert.equal(tight.get("modes/conversations/conversation"), null);
	const alone = tight.sync(["modes", "conversations"], { ifRoom: [["conversation"]] });
	assert.deepEqual(alone.optional.map((id) => id.split("/").pop()), ["conversation"], "offered on its own the summary alone fits");
});

scenario("Show navigates to folded ancestors by closing their trailing content", () => {
	const model = new BaseNavigator({ root: "root", minViewportHeight: 300, destinations: {
		root: { title: "Root", min: 40, max: 40, overflow: { mode: "keep" } },
		a: { title: "A", min: 100, max: 100 },
		b: { title: "B", min: 100, max: 100 },
		c: { title: "C", min: 100, max: "*", preferred: 140 },
	} });
	model.resize({ width: 180, height: 300 });
	model.open("a", { from: "root" });
	model.open("b", { from: "root/a" });
	model.open("c", { from: "root/a/b" });
	const shown = [];
	for (let step = 0; step < 2; step++) {
		const target = model.upTarget();
		assert.equal(model.showByClosing(target.id).length, 1);
		assert.equal(model.layout().cells.get(target.id).full, true);
		shown.push(target.title);
	}
	assert.deepEqual(shown, ["B", "A"]);
	assert.equal(model.upTarget(), null);
	assert.equal(model.occurrences.size, 2);
});

scenario("Show traverses folded vertical rows toward earlier context without toggling", () => {
	const model = new BaseNavigator({ root: "home", minViewportHeight: 300, destinations: {
		home: { title: "Home", min: 40, max: 40, overflow: { mode: "keep" } },
		split: { title: "Work", rows: [
			{ destination: "first", minHeight: 170, maxHeight: 170 },
			{ destination: "summary", minHeight: 170, maxHeight: 170 },
			{ destination: "detail", minHeight: 260, maxHeight: "*", preferredHeight: 300 },
		] },
		first: { title: "First", min: 200, max: 200 },
		summary: { title: "Summary", min: 200, max: 200 },
		detail: { title: "Detail", min: 200, max: "*", preferred: 300 },
	} });
	model.resize({ width: 340, height: 300 });
	model.open("split", { from: "home" });
	assert.equal(model.upTarget().id, "home/split/summary");
	assert.deepEqual(model.showByClosing(model.upTarget().id), []);
	assert.equal(model.layout().rows.get("home/split/summary").folded, false);
	assert.deepEqual(model.layout().chain.cells[1].rows.rows.map((row) => [row.visible, row.folded]), [[true, true], [true, false], [true, true]], "the later row remains accessible through its fold after Show");
	assert.equal(model.upTarget().id, "home/split/first", "the next click continues above the revealed fold");
	assert.deepEqual(model.showByClosing(model.upTarget().id), []);
	assert.equal(model.layout().rows.get("home/split/first").folded, false);
	assert.deepEqual(model.layout().chain.cells[1].rows.rows.map((row) => [row.visible, row.folded]), [[true, false], [true, true], [true, true]], "every later row remains accessible after Show reaches the first one");
	assert.equal(model.upTarget(), null, "later rows are not back targets");
	assert.equal(model.occurrences.size, 5, "rows remain owned by the split");
});

scenario("focus names where the user navigated last, with its path of destinations, for a menu to match", () => {
	const instance = new BaseNavigator({ root: "albums", minViewportHeight: 400, destinations: {
		albums: { title: "Albums", min: 200, max: 200 },
		"album:coast": { title: "Coast", min: 200, max: 300, defaultChild: "photo:a" },
		"photo:a": { title: "Photo A", min: 200, max: "*", preferred: 300 },
		"edit:1": { title: "Exposure", min: 200, max: 300 },
		info: { title: "Info", min: 200, max: 300 },
		split: { title: "Split", rows: [
			{ destination: "left", minHeight: 150, maxHeight: "*", preferredHeight: 200 },
			{ destination: "right", minHeight: 150, maxHeight: 200 },
		] },
		left: { title: "Left", min: 200, max: 300 },
		right: { title: "Right", min: 200, max: 300 },
		detail: { title: "Detail", min: 200, max: 300 },
	} });
	instance.resize({ width: 1600, height: 400 });
	assert.deepEqual(instance.focus(), { occurrence: "albums", destinations: ["albums"], title: "Albums", menu: null }, "before any navigation the root has the focus");
	instance.sync(["albums"], { ifRoom: ["info"] });
	assert.equal(instance.focus().occurrence, "albums", "a cell that opens only because there is room does not take the focus");
	instance.open("album:coast", { from: "albums" });
	assert.deepEqual(instance.focus(), { occurrence: "albums/album:coast", destinations: ["albums", "album:coast"], title: "Coast", menu: null }, "a navigation takes the focus; the default it opens does not");
	instance.open("edit:1", { from: "albums/album:coast/photo:a" });
	assert.equal(instance.focus().occurrence, "albums/album:coast/photo:a/edit:1");
	instance.closeNewestGroup();
	assert.equal(instance.focus().occurrence, "albums/album:coast/photo:a", "closing the focused cell hands the focus to the nearest cell on its path that is still open");
	instance.open("album:coast", { from: "albums" });
	assert.equal(instance.focus().occurrence, "albums/album:coast", "opening what is already open focuses it");
	instance.sync(["albums", "split", "left", "detail"]);
	instance.sync(["albums", "split", "right", "detail"]);
	assert.equal(instance.focus().occurrence, "albums/split/right/detail");
	instance.sync(["albums", "split", "left", "detail"]);
	assert.equal(instance.focus().occurrence, "albums/split/left/detail", "a sync to a branch that is already open focuses its tip, even when it changes nothing");
	instance.sync(["albums", "split", "right"]);
	assert.equal(instance.focus().occurrence, "albums/split/right", "a sync that ends at a row focuses that row");
	assert.equal(instance.sync(["albums", "split", "nowhere"]).ok, false);
	assert.equal(instance.focus().occurrence, "albums/split/right", "a refused sync leaves the focus where it was");
	const snapshot = instance.snapshot();
	instance.sync(["albums"]);
	assert.equal(instance.focus().occurrence, "albums");
	instance.restore(snapshot);
	assert.equal(instance.focus().occurrence, "albums/split/right", "a snapshot carries the focus");
});

scenario("focus names the menu item to mark: the first destination on the path whose menu rule matches", () => {
	const instance = new BaseNavigator({ root: "shell", minViewportHeight: 400, destinations: {
		shell: { title: "Shell", min: 200, max: 200 },
		day: { title: "My day", min: 200, max: 300, menu: "exact" },
		albums: { title: "Albums", min: 200, max: 300, menu: true },
		"album:coast": { title: "Coast", min: 200, max: "*", preferred: 300 },
		"photo:a": { title: "Photo A", min: 200, max: 300 },
	} });
	instance.resize({ width: 1600, height: 400 });
	assert.equal(instance.focus().menu, null, "before any navigation no item is active, because the root declares none");
	instance.open("day", { from: "shell" });
	assert.equal(instance.focus().menu, "day", "an exact item is active while the focus is on its own destination");
	instance.open("album:coast", { from: "shell/day" });
	assert.equal(instance.focus().menu, null, "an exact item goes dark when the user works in a cell it opened");
	instance.sync(["shell", "albums", "album:coast", "photo:a"]);
	assert.equal(instance.focus().menu, "albums", "a section item stays active for everything under it");
	instance.sync(["shell", "albums", "album:coast", "photo:a", "albums"]);
	assert.equal(instance.focus().menu, "albums", "when two items match, the one nearest the root wins");
	instance.sync(["shell", "day", "albums"]);
	assert.equal(instance.focus().menu, "albums", "past an exact item that does not match, the next item on the path decides");
	const snapshot = instance.snapshot();
	instance.sync(["shell"]);
	assert.equal(instance.focus().menu, null);
	instance.restore(snapshot);
	assert.equal(instance.focus().menu, "albums", "a snapshot carries the active item with the focus");
	assert.throws(() => new BaseNavigator({ root: "shell", minViewportHeight: 400, destinations: { shell: { title: "Shell", min: 200, max: "*", preferred: 200, menu: "always" } } }), /invalid-menu/, "menu is true or \"exact\"");
});

scenario("overflow declarations reject ambiguous policies on cells and rows", () => {
	for (const policy of [null, false, "keep", {}, { mode: "other" }, { mode: "keep", size: 0 }, { mode: "hide", size: 1 }, { mode: "fold", size: -1 }, { mode: "fold", size: 100 }, { mode: "fold", extra: true }]) {
		const definitions = { root: { title: "Root", min: 100, max: "*", preferred: 200, overflow: policy } };
		assert.equal(validateDestinations(definitions, { minViewportHeight: 200 }).ok, false);
		definitions.root = { title: "Root", rows: [{ destination: "body", minHeight: 100, maxHeight: "*", preferredHeight: 150, overflow: policy }] };
		definitions.body = { title: "Body", min: 100, max: "*", preferred: 200 };
		assert.equal(validateDestinations(definitions, { minViewportHeight: 200 }).ok, false);
	}
});
