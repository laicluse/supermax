import assert from "node:assert/strict";
import { test } from "node:test";
import { Navigator } from "../src/navigation.js";
import { layoutWorkspace, withGrowth } from "../src/layout.js";
import { LAYOUT_SCHEMA, layoutOf, validateDeclarationSet } from "../src/layout-declaration.js";

function chain({ width = 1000, height = 700, list = {}, form = {}, detail = {} } = {}) {
	const model = new Navigator({ root: "list", minViewportHeight: 300, destinations: {
		list: { title: "List", min: 240, preferred: 320, max: 400, ...list },
		form: { title: "Form", min: 300, preferred: 560, max: 640, overflow: { mode: "keep" }, growOnFocus: true, ...form },
		detail: { title: "Detail", min: 300, preferred: 500, max: "*", ...detail },
	} });
	model.resize({ width, height });
	model.open("form", { from: "list" });
	model.open("detail", { from: "list/form" });
	return model;
}

const widths = (layout, ids) => ids.map((id) => layout.cells.get(id).visible ? layout.cells.get(id).width : null);
const shown = (layout, id) => { const cell = layout.cells.get(id); return cell.visible && !cell.folded; };
// allow-comment: growth only takes room: a cell or row the ordinary layout holds back never appears or unfolds for it, and every open cell keeps a route.
function assertOnlyGivesWay(model, grown, plain, label) {
	for (const [id, cell] of grown.cells) assert.ok(!(cell.visible && !cell.folded) || shown(plain, id), `${id} shows only where the ordinary layout shows it, ${label}`);
	for (const [id, row] of grown.rows) assert.ok(!(row.visible && !row.folded) || (plain.rows.get(id).visible && !plain.rows.get(id).folded), `row ${id} shows only where the ordinary layout shows it, ${label}`);
	for (const occurrence of model.occurrences.values()) assert.ok(grown.access.get(occurrence.id), `${occurrence.id} keeps a route, ${label}`);
}
const CHAIN = ["list", "list/form", "list/form/detail"];

test("the cell after the one with focus folds when its minimum still leaves the preference out of reach", () => {
	const model = chain({ width: 800 });
	assert.deepEqual(widths(model.layout(), CHAIN), [null, 350, 450], "a kept form stands under its preference in a small window");
	const grown = layoutWorkspace(withGrowth(model, "list/form"));
	assert.ok(grown.cells.get("list/form").width >= 560, `the form reaches its preference (${grown.cells.get("list/form").width})`);
	assert.equal(grown.cells.get("list/form/detail").folded, true, "the detail folds for it");
	assert.equal(grown.access.get("list/form/detail").kind, "fold", "and stays reachable by its fold");
	assert.deepEqual(widths(layoutWorkspace(withGrowth(model, null)), CHAIN), [null, 350, 450], "the ordinary layout returns when focus leaves");
});

test("a cell before the one with focus leaves the window when the minima do not leave the preference", () => {
	const model = chain({ width: 1000 });
	assert.deepEqual(widths(model.layout(), CHAIN), [253, 353, 394]);
	const [list, form, detail] = widths(layoutWorkspace(withGrowth(model, "list/form")), CHAIN);
	assert.equal(list, null, "the list gives way first, by its overflow mode");
	assert.ok(form >= 560 && detail >= 300 && form + detail === 1000, `the form reaches its preference beside the detail (${form}, ${detail})`);
	assert.deepEqual(widths(layoutWorkspace(withGrowth(model, null)), CHAIN), [253, 353, 394], "the list returns when focus leaves");
});

test("kept cells on either side stay and growth takes what they leave above their minima", () => {
	const model = chain({ width: 1000, list: { overflow: { mode: "keep" } }, detail: { overflow: { mode: "keep" } } });
	assert.deepEqual(widths(layoutWorkspace(withGrowth(model, "list/form")), CHAIN), [240, 460, 300]);
});

test("nothing closes for growth", () => {
	const model = chain({ width: 800 });
	const before = model.snapshot();
	layoutWorkspace(withGrowth(model, "list/form"));
	assert.deepEqual(model.snapshot(), before);
});

test("growth asks for the preference and no more: the room above it is shared as usual", () => {
	const model = chain({ width: 760, form: { preferred: 400 } });
	assert.ok(widths(model.layout(), CHAIN)[1] < 400, "the form starts under its preference");
	const [, form, detail] = widths(layoutWorkspace(withGrowth(model, "list/form")), CHAIN);
	assert.ok(form >= 400 && detail > 300, `the form reaches its preference and the detail keeps more than its minimum (${form}, ${detail})`);
});

test("growth never shrinks a cell that already has its preference or more", () => {
	for (const width of [1100, 1400, 2400]) {
		const model = chain({ width });
		assert.deepEqual(widths(layoutWorkspace(withGrowth(model, "list/form")), CHAIN), widths(model.layout(), CHAIN), `at ${width}px`);
	}
});

test("growth only makes cells give way: none appears or unfolds for it and each keeps a route", () => {
	let gaveWay = 0;
	for (const width of [600, 700, 800, 900, 1000, 1100, 1400]) {
		const model = chain({ width });
		const grown = layoutWorkspace(withGrowth(model, "list/form"));
		assertOnlyGivesWay(model, grown, model.layout(), `at ${width}px`);
		gaveWay += CHAIN.some((id) => shown(model.layout(), id) && !shown(grown, id));
	}
	assert.ok(gaveWay >= 4, `a cell gives way at the narrow widths (${gaveWay})`);
});

test("a size the user set with a divider wins over growth", () => {
	const model = chain();
	model.setSize("list/form", 320, "width");
	assert.deepEqual(widths(layoutWorkspace(withGrowth(model, "list/form")), CHAIN), widths(model.layout(), CHAIN));
});

test("zoom suppresses growth", () => {
	const model = chain({ detail: { zoomable: true } });
	assert.equal(model.zoom("list/form/detail"), true);
	assert.deepEqual(widths(layoutWorkspace(withGrowth(model, "list/form")), CHAIN), widths(model.layout(), CHAIN));
});

test("without growth the layout is the navigator's own", () => {
	const model = chain();
	assert.equal(withGrowth(model, null), model);
	assert.deepEqual(layoutWorkspace(withGrowth(model, null)), model.layout());
	assert.equal(model.grown, undefined, "growth never sets a field on the navigator");
});

function card({ width = 1000, height = 600 } = {}) {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 200, preferred: 240, max: 280, defaultChild: null },
		card: { title: "Card", overflow: { mode: "keep" }, rows: [
			{ destination: "chart", minHeight: 120, maxHeight: 420, preferredHeight: 300 },
			{ destination: "table", minHeight: 120, maxHeight: "*", preferredHeight: 400 },
		] },
		chart: { title: "Chart", min: 300, max: 1200, preferred: 900, aspectRatio: 3, growOnFocus: true },
		table: { title: "Table", min: 300, max: "*", preferred: 600 },
		side: { title: "Side", min: 260, preferred: 400, max: "*", placement: "beside-split" },
	} });
	model.resize({ width, height });
	model.open("card", { from: "menu" });
	model.open("side", { from: "menu/card/chart" });
	return model;
}

test("a cell in a row grows through its split's width and its row's height, within the aspect ratio", () => {
	const model = card();
	const plain = model.layout();
	const grown = layoutWorkspace(withGrowth(model, "menu/card/chart"));
	assert.ok(grown.cells.get("menu/card/chart").width >= 900, `the chart reaches its preference (${grown.cells.get("menu/card/chart").width})`);
	assert.equal(grown.cells.get("menu").visible, false, "the menu before the split leaves the window");
	assert.equal(grown.cells.get("menu/card/chart/side").folded, true, "the cell beside the split folds");
	const row = grown.rows.get("menu/card/chart");
	assert.ok(row.height >= 300 && row.height >= plain.rows.get("menu/card/chart").height, `the row reaches its preferred height (${row.height})`);
	assert.ok(row.height <= Math.max(120, row.fitHeight), "the row stays within the chart's aspect ratio");
	assertOnlyGivesWay(model, grown, plain, "in the card");
});

test("the other row folds when the row with focus cannot reach its preferred height beside it", () => {
	const model = card({ width: 1800, height: 380 });
	const plain = model.layout();
	assert.ok(plain.rows.get("menu/card/chart").height < 300, "the chart row starts under its preferred height");
	const grown = layoutWorkspace(withGrowth(model, "menu/card/chart"));
	assert.ok(grown.rows.get("menu/card/chart").height >= 300);
	assert.equal(grown.rows.get("menu/card/table").folded, true);
	assert.equal(layoutWorkspace(withGrowth(model, null)).rows.get("menu/card/table").folded, false, "the table row returns when focus leaves");
});

test("growOnFocus is a boolean on a cell and travels with its layout declaration", () => {
	assert.deepEqual(layoutOf({ title: "Form", min: 300, preferred: 400, max: 500, growOnFocus: true }).growOnFocus, true);
	assert.equal(Object.hasOwn(layoutOf({ title: "Form", min: 300, preferred: 400, max: 500 }), "growOnFocus"), false);
	const problems = (declaration) => validateDeclarationSet({ schemaVersion: LAYOUT_SCHEMA, root: "form", destinations: { form: declaration } }).map((problem) => problem.reason);
	assert.ok(problems({ title: "Form", min: 300, preferred: 400, max: 500, defaultChild: null, growOnFocus: "yes" }).includes("invalid-grow-on-focus"));
	assert.throws(() => new Navigator({ root: "a", minViewportHeight: 300, destinations: { a: { title: "A", min: 200, preferred: 300, max: "*", growOnFocus: 1 } } }), /invalid-grow-on-focus/);
	assert.throws(() => new Navigator({ root: "s", minViewportHeight: 300, destinations: { s: { title: "S", growOnFocus: true, rows: [{ destination: "a", minHeight: 100, maxHeight: "*", preferredHeight: 200 }] }, a: { title: "A", min: 200, preferred: 300, max: "*" } } }), /split-with-width/);
});

function cardWithThumbnails(width) {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 200, preferred: 240, max: 280, defaultChild: null },
		card: { title: "Card", overflow: { mode: "keep" }, rows: [
			{ destination: "thumbnails", minHeight: 120, maxHeight: 420, preferredHeight: 300 },
			{ destination: "table", minHeight: 120, maxHeight: "*", preferredHeight: 400 },
		] },
		thumbnails: { title: "Thumbnails", min: 300, max: 400, preferred: 300 },
		chart: { title: "Chart", min: 300, max: 1200, preferred: 900, aspectRatio: 3, growOnFocus: true },
		table: { title: "Table", min: 300, max: "*", preferred: 600 },
		side: { title: "Side", min: 260, preferred: 400, max: "*", placement: "beside-split" },
	} });
	model.resize({ width, height: 600 });
	model.open("card", { from: "menu" });
	model.open("chart", { from: "menu/card/thumbnails" });
	model.open("side", { from: "menu/card/table" });
	return model;
}

test("a cell in a row never shrinks and no cell of its row appears when its split widens", () => {
	for (let width = 700; width <= 1800; width += 20) {
		const model = cardWithThumbnails(width);
		const plain = model.layout();
		const grown = layoutWorkspace(withGrowth(model, "menu/card/thumbnails/chart"));
		assertOnlyGivesWay(model, grown, plain, `at ${width}px`);
		const chart = (layout) => layout.cells.get("menu/card/thumbnails/chart");
		if (chart(plain).visible && !chart(plain).folded) assert.ok(chart(grown).width >= chart(plain).width, `the chart keeps at least ${chart(plain).width}px at ${width}px, got ${chart(grown).width}`);
		assert.ok(grown.rows.get("menu/card/thumbnails").height >= plain.rows.get("menu/card/thumbnails").height, `the chart row never shrinks at ${width}px`);
	}
});

test("a width the user set on a cell in a row keeps its split from widening for it", () => {
	const model = card();
	model.setSize("menu/card/chart", 320, "width");
	const plain = model.layout();
	const grown = layoutWorkspace(withGrowth(model, "menu/card/chart"));
	assert.deepEqual(widths(grown, ["menu", "menu/card", "menu/card/chart/side"]), widths(plain, ["menu", "menu/card", "menu/card/chart/side"]));
});

test("growth keeps the form each neighbour shows while that neighbour stands", () => {
	let grew = false;
	for (let width = 560; width <= 1400; width += 10) {
		const model = new Navigator({ root: "list", minViewportHeight: 300, destinations: {
			list: { title: "List", min: 150, preferred: 220, max: 300 },
			menu: { title: "Menu", min: 200, preferred: 260, max: 320, overflow: { mode: "keep" }, variants: [
				{ id: "wide", when: { minWidth: 240 } }, { id: "narrow", min: 200, preferred: 200, max: 239 },
			] },
			form: { title: "Form", min: 280, preferred: 500, max: "*", growOnFocus: true },
		} });
		model.resize({ width, height: 600 });
		model.open("menu", { from: "list" });
		model.open("form", { from: "list/menu" });
		const plain = model.layout();
		const grown = layoutWorkspace(withGrowth(model, "list/menu/form"));
		assertOnlyGivesWay(model, grown, plain, `at ${width}px`);
		if (shown(grown, "list/menu")) assert.equal(grown.cells.get("list/menu").variant, plain.cells.get("list/menu").variant, `the menu keeps its form at ${width}px`);
		assert.ok(grown.cells.get("list/menu/form").width >= plain.cells.get("list/menu/form").width, `the form never shrinks at ${width}px`);
		grew ||= grown.cells.get("list/menu/form").width > plain.cells.get("list/menu/form").width;
	}
	assert.ok(grew, "the form grows somewhere in the sweep");
});

test("a kept neighbour with a wide form keeps that form and the cells before it stay in view", () => {
	const model = new Navigator({ root: "list", minViewportHeight: 300, destinations: {
		list: { title: "List", min: 150, preferred: 250, max: 300 },
		menu: { title: "Menu", min: 200, preferred: 700, max: 1000, overflow: { mode: "keep" }, variants: [
			{ id: "wide", when: { minWidth: 250 } }, { id: "narrow", min: 100, preferred: 200, max: 249 },
		] },
		form: { title: "Form", min: 200, preferred: 300, max: "*", overflow: { mode: "keep" }, growOnFocus: true },
	} });
	model.resize({ width: 700, height: 600 });
	model.open("menu", { from: "list" });
	model.open("form", { from: "list/menu" });
	const plain = model.layout();
	const grown = layoutWorkspace(withGrowth(model, "list/menu/form"));
	assertOnlyGivesWay(model, grown, plain, "beside a kept menu");
	assert.equal(grown.cells.get("list/menu").variant, plain.cells.get("list/menu").variant);
	assert.ok(grown.cells.get("list/menu").width >= 250, "the wide menu keeps the width its form needs");
	assert.ok(grown.cells.get("list/menu/form").width >= plain.cells.get("list/menu/form").width);
});

test("a width in growOnFocus is the growth target for a cell whose preference is held low on purpose", () => {
	const held = chain({ width: 1000, form: { preferred: 320, max: "*", growOnFocus: 560 } });
	const [, plainForm] = widths(held.layout(), CHAIN);
	const [, form, detail] = widths(layoutWorkspace(withGrowth(held, "list/form")), CHAIN);
	assert.ok(form > plainForm && form >= 400, `the form grows past its preference toward 560 (${plainForm} → ${form})`);
	assert.ok(detail >= 300);
	assert.deepEqual(layoutOf({ title: "Form", min: 300, preferred: 320, max: "*", growOnFocus: 560 }).growOnFocus, 560);
	const problems = (growOnFocus) => validateDeclarationSet({ schemaVersion: LAYOUT_SCHEMA, root: "form", destinations: { form: { title: "Form", min: 300, preferred: 320, max: "*", defaultChild: null, growOnFocus } } }).map((problem) => problem.reason);
	assert.deepEqual(problems(560), []);
	assert.ok(problems(200).includes("invalid-grow-on-focus"), "a target under the minimum is refused");
	assert.ok(problems(-1).includes("invalid-grow-on-focus"));
});

test("what gives way never leaves the cell with focus smaller on the other axis", () => {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 200, preferred: 240, max: 280, defaultChild: null },
		card: { title: "Card", overflow: { mode: "keep" }, rows: [
			{ destination: "banner", minHeight: 60, maxHeight: 420, preferredHeight: 300 },
			{ destination: "table", minHeight: 120, maxHeight: "*", preferredHeight: 300 },
		] },
		banner: { title: "Banner", min: 200, preferred: 600, max: 1200, aspectRatio: 6, overflow: { mode: "keep" }, growOnFocus: true },
		poster: { title: "Poster", min: 200, preferred: 400, max: 600, aspectRatio: 1 },
		table: { title: "Table", min: 300, preferred: 600, max: "*" },
	} });
	model.resize({ width: 800, height: 600 });
	model.open("card", { from: "menu" });
	model.open("poster", { from: "menu/card/banner" });
	const plain = model.layout();
	assert.ok(plain.rows.get("menu/card/banner").height > 200, "the poster beside the banner sets a tall row");
	const grown = layoutWorkspace(withGrowth(model, "menu/card/banner"));
	assert.ok(grown.cells.get("menu/card/banner").width >= plain.cells.get("menu/card/banner").width);
	assert.ok(grown.rows.get("menu/card/banner").height >= plain.rows.get("menu/card/banner").height, `the banner row keeps its ${plain.rows.get("menu/card/banner").height}px, got ${grown.rows.get("menu/card/banner").height}`);
});
