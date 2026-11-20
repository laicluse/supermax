import assert from "node:assert/strict";
import { test } from "node:test";
import { Navigator } from "../src/navigation.js";
import { layoutWorkspace, withGrowth } from "../src/layout.js";
import { LAYOUT_SCHEMA, layoutOf, validateDeclarationSet } from "../src/layout-declaration.js";

function chain({ width = 1000, height = 700, form = {}, detail = {} } = {}) {
	const model = new Navigator({ root: "list", minViewportHeight: 300, destinations: {
		list: { title: "List", min: 240, preferred: 320, max: 400 },
		form: { title: "Form", min: 300, preferred: 560, max: 640, overflow: { mode: "keep" }, growOnFocus: true, ...form },
		detail: { title: "Detail", min: 300, preferred: 500, max: "*", ...detail },
	} });
	model.resize({ width, height });
	model.open("form", { from: "list" });
	model.open("detail", { from: "list/form" });
	return model;
}

const widths = (layout, ids) => ids.map((id) => layout.cells.get(id).visible ? layout.cells.get(id).width : null);
const visible = (layout) => [...layout.cells].filter(([, cell]) => cell.visible).map(([id, cell]) => [id, cell.folded]);
const CHAIN = ["list", "list/form", "list/form/detail"];

test("a kept cell with focus grows toward its preference while the cell after it gives way to its minimum", () => {
	const model = chain({ width: 800 });
	assert.deepEqual(widths(model.layout(), CHAIN), [null, 350, 450], "a kept form stands under its preference in a small window");
	assert.deepEqual(widths(layoutWorkspace(withGrowth(model, "list/form")), CHAIN), [null, 500, 300]);
});

test("growth stops at what the neighbours leave above their minima, on either side", () => {
	const model = chain({ width: 1000 });
	assert.deepEqual(widths(model.layout(), CHAIN), [253, 353, 394]);
	assert.deepEqual(widths(layoutWorkspace(withGrowth(model, "list/form")), CHAIN), [240, 460, 300]);
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

test("growth shows and folds the same cells as the ordinary layout", () => {
	for (const width of [600, 700, 800, 900, 1000, 1100, 1400]) {
		const model = chain({ width });
		assert.deepEqual(visible(layoutWorkspace(withGrowth(model, "list/form"))), visible(model.layout()), `at ${width}px`);
	}
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
	assert.ok(grown.cells.get("menu/card").width > plain.cells.get("menu/card").width, "the split widens for the cell in its row");
	assert.ok(grown.cells.get("menu/card/chart").width > plain.cells.get("menu/card/chart").width);
	const row = grown.rows.get("menu/card/chart");
	assert.ok(row.height >= plain.rows.get("menu/card/chart").height, "the row never shrinks");
	assert.ok(row.height <= Math.max(120, row.fitHeight), "the row stays within the chart's aspect ratio");
	assert.equal(grown.cells.get("menu/card").width + grown.cells.get("menu").width + grown.cells.get("menu/card/chart/side").width, 1000);
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

test("a cell in a row never shrinks and its row shows and folds the same cells when its split widens", () => {
	for (let width = 700; width <= 1800; width += 20) {
		const model = cardWithThumbnails(width);
		const plain = model.layout();
		const grown = layoutWorkspace(withGrowth(model, "menu/card/thumbnails/chart"));
		assert.deepEqual(visible(grown), visible(plain), `the same cells show and fold at ${width}px`);
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

test("growth keeps the form each neighbour shows and gives way in it only down to where that form holds", () => {
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
		assert.deepEqual(visible(grown), visible(plain), `the same cells show at ${width}px`);
		assert.equal(grown.cells.get("list/menu").variant, plain.cells.get("list/menu").variant, `the menu keeps its form at ${width}px`);
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
	assert.deepEqual(visible(grown), visible(plain));
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
