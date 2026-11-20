import assert from "node:assert/strict";
import { test } from "node:test";
import { Navigator } from "../src/navigation.js";
import { layoutOf, validateDeclarationSet, encodeLayoutHeader, parseLayoutHeader, LAYOUT_SCHEMA } from "../src/layout-declaration.js";

function card({ width = 1200, height = 800, chart = {}, row = {} } = {}) {
	const model = new Navigator({ root: "card", minViewportHeight: 300, destinations: {
		card: { title: "Card", rows: [
			{ destination: "chart", minHeight: 100, maxHeight: 420, preferredHeight: 300, ...row },
			{ destination: "table", minHeight: 100, maxHeight: "*", preferredHeight: 300 },
		] },
		chart: { title: "Chart", min: 300, max: "*", preferred: 600, aspectRatio: 3, ...chart },
		detail: { title: "Detail", min: 300, max: 300, preferred: 300 },
		table: { title: "Table", min: 300, max: "*", preferred: 600 },
	} });
	model.resize({ width, height });
	return model;
}

const heights = (model) => model.layout().chain.cells[0].rows.rows.map((row) => row.height);
const chartRow = (model) => model.layout().rows.get("card/chart");

test("a row is no taller than its cell's aspect ratio asks at the cell's width, and the elastic row takes the rest", () => {
	const model = card({ width: 900 });
	assert.equal(model.layout().cells.get("card/chart").width, 900);
	assert.equal(chartRow(model).fitHeight, 300);
	assert.deepEqual(heights(model), [300, 500]);
	model.resize({ width: 600, height: 800 });
	assert.equal(chartRow(model).fitHeight, 200);
	assert.deepEqual(heights(model), [200, 600], "a narrower cell gives its row's height to the row below");
});

test("the declared maxHeight stays a ceiling of its own and minHeight stays the floor", () => {
	const wide = card({ width: 1800 });
	assert.equal(chartRow(wide).fitHeight, 600);
	assert.equal(chartRow(wide).maxHeight, 420);
	assert.equal(heights(wide)[0], 420);
	const narrow = card({ width: 300, chart: { aspectRatio: 4 } });
	assert.equal(chartRow(narrow).fitHeight, 75);
	assert.equal(heights(narrow)[0], 100);
});

test("a cell opened beside the chart narrows it and its row gives up height while the split keeps its width", () => {
	const model = card({ width: 900 });
	model.open("detail", { from: "card/chart" });
	const layout = model.layout();
	assert.equal(layout.cells.get("card").width, 900);
	assert.equal(layout.cells.get("card/chart").width, 600);
	assert.equal(chartRow(model).fitHeight, 200, "a cell without a ratio does not raise the row");
	assert.deepEqual(heights(model), [200, 600]);
	model.closeNewestGroup();
	assert.deepEqual(heights(model), [300, 500], "closing the sibling restores the row");
});

test("the title bar counts once on top of the ratio", () => {
	const model = card({ width: 900, chart: { header: "title" } });
	assert.equal(chartRow(model).fitHeight, 328);
	assert.equal(heights(model)[0], 328);
});

test("a dragged height above the fit stays stored and returns when the row widens", () => {
	const model = card({ width: 1200 });
	model.setSize("card/chart", 380, "height");
	assert.equal(heights(model)[0], 380);
	model.resize({ width: 900, height: 800 });
	assert.equal(heights(model)[0], 300);
	assert.equal(model.sizeOf("card/chart", "height"), 380);
	assert.equal(chartRow(model).resizeMax, 300, "the divider stops at the fit");
	model.resize({ width: 1200, height: 800 });
	assert.equal(heights(model)[0], 380);
});

test("a row without a ratio keeps its declared bounds", () => {
	const model = card({ width: 600, chart: { aspectRatio: undefined } });
	assert.equal(chartRow(model).fitHeight, null);
	assert.equal(chartRow(model).resizeMax, 420);
	assert.ok(heights(model)[0] > 200);
});

test("under height pressure the row still folds at its minimum like any row", () => {
	const model = new Navigator({ root: "card", minViewportHeight: 200, destinations: {
		card: { title: "Card", overflow: { mode: "keep" }, rows: [
			{ destination: "chart", minHeight: 100, maxHeight: 420 },
			{ destination: "table", minHeight: 150, maxHeight: "*", preferredHeight: 300 },
		] },
		chart: { title: "Chart", min: 300, max: "*", preferred: 600, aspectRatio: 3 },
		table: { title: "Table", min: 300, max: "*", preferred: 600 },
	} });
	model.resize({ width: 900, height: 200 });
	const row = chartRow(model);
	assert.equal(row.folded, true);
	assert.equal(model.layout().rows.get("card/table").height > 150, true);
});

test("an aspect ratio is refused on an elastic row, on a split and when it is not a positive number", () => {
	const build = (destinations) => () => new Navigator({ root: "card", minViewportHeight: 300, destinations });
	assert.throws(build({
		card: { title: "Card", rows: [{ destination: "chart", minHeight: 100, maxHeight: "*", preferredHeight: 300 }] },
		chart: { title: "Chart", min: 300, max: "*", preferred: 600, aspectRatio: 3 },
	}), (error) => JSON.stringify(error.problems).includes("aspect-ratio-on-elastic-row"));
	for (const aspectRatio of [0, -2, Infinity, "3"]) {
		assert.throws(build({
			card: { title: "Card", rows: [{ destination: "chart", minHeight: 100, maxHeight: "*", preferredHeight: 300 }] },
			chart: { title: "Chart", min: 300, max: "*", preferred: 600, aspectRatio },
		}), (error) => error.problems.some((problem) => problem.reason === "invalid-aspect-ratio"));
	}
	assert.throws(build({
		card: { title: "Card", aspectRatio: 2, rows: [{ destination: "chart", minHeight: 100, maxHeight: "*", preferredHeight: 300 }] },
		chart: { title: "Chart", min: 300, max: "*", preferred: 600 },
	}), (error) => error.problems.some((problem) => problem.reason === "invalid-aspect-ratio"));
});

test("a server declaration carries the aspect ratio and refuses a bad one", () => {
	const chart = { title: "Chart", min: 300, max: "*", preferred: 600, defaultChild: null, aspectRatio: 3 };
	assert.equal(layoutOf(chart).aspectRatio, 3);
	assert.equal(layoutOf({ ...chart, aspectRatio: undefined }).aspectRatio, undefined);
	const set = (declaration) => ({ schemaVersion: LAYOUT_SCHEMA, root: "chart", destinations: { chart: declaration } });
	assert.deepEqual(validateDeclarationSet(set(chart)), []);
	assert.deepEqual(validateDeclarationSet(set({ ...chart, aspectRatio: 0 })).map((problem) => problem.reason), ["invalid-aspect-ratio"]);
});

test("height variants choose their form within the fit", () => {
	const model = card({ width: 900, row: { minHeight: 28, variants: [
		{ id: "expanded", when: { minHeight: 150 } },
		{ id: "summary", minHeight: 28, preferredHeight: 28, maxHeight: 149 },
	] } });
	assert.equal(chartRow(model).variant, "expanded");
	assert.equal(heights(model)[0], 300);
	model.resize({ width: 400, height: 800 });
	assert.equal(chartRow(model).fitHeight, 134);
	assert.equal(chartRow(model).variant, "summary", "a fit below the expanded form's threshold leaves the summary");
	assert.equal(heights(model)[0], 28);
});

test("an inset keeps a fixed toolbar and padding out of the ratio", () => {
	const model = card({ width: 900, chart: { aspectInset: { width: 12, height: 54 } } });
	assert.equal(chartRow(model).fitHeight, 54 + Math.ceil(888 / 3));
	assert.deepEqual(heights(model), [350, 450]);
});

test("a host switches the ratio and inset when its content changes form, and the row follows", () => {
	const model = card({ width: 900 });
	assert.equal(chartRow(model).fitHeight, 300);
	model.setAspectRatio("chart", 2, { inset: { height: 40 } });
	assert.equal(chartRow(model).fitHeight, 490);
	assert.equal(heights(model)[0], 420, "the declared maxHeight still caps it");
	model.setAspectRatio("chart", null);
	assert.equal(chartRow(model).fitHeight, null);
	assert.equal(model.definitionOf("chart").aspectInset, undefined, "removing the ratio removes its inset");
	assert.throws(() => model.setAspectRatio("chart", 3, { inset: { width: -1 } }), (error) => error.problems.some((problem) => problem.reason === "invalid-aspect-inset"));
	assert.throws(() => model.setAspectRatio("table", 3), (error) => error.problems.some((problem) => problem.validation?.rows.some((row) => row.problems.includes("aspect-ratio-on-elastic-row"))));
	assert.equal(model.definitionOf("table").aspectRatio, undefined, "a refused update changes nothing");
});

test("an inset without a ratio, or with unknown fields, is refused", () => {
	const build = (chart) => () => new Navigator({ root: "chart", minViewportHeight: 300, destinations: { chart: { title: "Chart", min: 300, max: "*", preferred: 600, ...chart } } });
	assert.throws(build({ aspectInset: { height: 10 } }), (error) => error.problems.some((problem) => problem.reason === "invalid-aspect-ratio"));
	assert.throws(build({ aspectRatio: 2, aspectInset: { top: 10 } }), (error) => error.problems.some((problem) => problem.reason === "invalid-aspect-inset"));
	const declaration = { title: "Chart", min: 300, max: "*", preferred: 600, defaultChild: null, aspectRatio: 3, aspectInset: { height: 54 } };
	assert.deepEqual(layoutOf(declaration).aspectInset, { height: 54 });
});

test("the divider of a row with height variants can reach every form, with and without a ratio", () => {
	const variants = [
		{ id: "expanded", when: { minHeight: 150 } },
		{ id: "summary", minHeight: 28, preferredHeight: 28, maxHeight: 149 },
	];
	for (const [chart, reach] of [[{}, 300], [{ aspectRatio: undefined }, 420]]) {
		const model = card({ width: 900, chart, row: { minHeight: 28, variants } });
		model.setSize("card/chart", 120, "height");
		assert.equal(chartRow(model).variant, "summary");
		assert.equal(chartRow(model).resizeMax, reach, "the divider can be dragged back into the expanded form");
	}
});

test("the tallest visible ratio counts, and a hidden one stops counting", () => {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 200, max: 200, preferred: 200 },
		card: { title: "Card", rows: [
			{ destination: "wide", minHeight: 50, maxHeight: 600, preferredHeight: 600 },
			{ destination: "table", minHeight: 100, maxHeight: "*", preferredHeight: 300 },
		] },
		wide: { title: "Wide", min: 300, max: 300, preferred: 300, aspectRatio: 2 },
		tall: { title: "Tall", min: 300, max: 300, preferred: 300, aspectRatio: 6 },
		table: { title: "Table", min: 300, max: "*", preferred: 600 },
	} });
	model.resize({ width: 800, height: 800 });
	model.open("card");
	model.open("tall", { from: "menu/card/wide" });
	assert.equal(model.layout().rows.get("menu/card/wide").fitHeight, 150, "the taller of 300/2 and 300/6");
	model.resize({ width: 400, height: 800 });
	assert.equal(model.layout().cells.get("menu/card/wide/tall").full, true);
	assert.equal(model.layout().cells.get("menu/card/wide").full, false);
	assert.equal(model.layout().rows.get("menu/card/wide").fitHeight, 50, "the hidden cell no longer counts");
});

test("removing a ratio while naming an inset is refused", () => {
	const model = card({ width: 900 });
	assert.throws(() => model.setAspectRatio("chart", null, { inset: { height: 54 } }), (error) => error.problems.some((problem) => problem.reason === "invalid-aspect-ratio"));
	assert.equal(model.definitionOf("chart").aspectRatio, 3);
});

test("a server repeating its declaration after a runtime switch is no mismatch", () => {
	const declaration = { title: "Remote chart", min: 300, max: "*", preferred: 600, defaultChild: null, aspectRatio: 3, aspectInset: { height: 20 } };
	const set = { schemaVersion: LAYOUT_SCHEMA, context: null, root: "remote", destinations: { remote: declaration } };
	const model = card({ width: 900 });
	model.register(set);
	model.setAspectRatio("remote", 2);
	assert.deepEqual(model.register(set), []);
	assert.equal(model.definitionOf("remote").aspectRatio, 2, "the runtime value stays");
});

test("an inset survives the layout header round trip", async () => {
	const declaration = { title: "Chart", min: 300, max: "*", preferred: 600, defaultChild: null, aspectRatio: 3, aspectInset: { width: 12, height: 54 } };
	const set = { schemaVersion: LAYOUT_SCHEMA, root: "chart", destinations: { chart: declaration } };
	const { value } = await encodeLayoutHeader(set);
	const { inline } = parseLayoutHeader(value);
	const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(inline.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
	assert.deepEqual(decoded.destinations.chart.aspectInset, { width: 12, height: 54 });
	assert.deepEqual(validateDeclarationSet(decoded), []);
});

test("a new split arriving with a repeated declaration is checked against the runtime value", () => {
	const chart = { title: "Remote chart", min: 300, max: "*", preferred: 600, defaultChild: null };
	const model = card({ width: 900 });
	model.register({ schemaVersion: LAYOUT_SCHEMA, context: null, root: "remote", destinations: { remote: chart } });
	model.setAspectRatio("remote", 2);
	const split = { title: "Remote card", rows: [{ destination: "remote", minHeight: 100, maxHeight: "*", preferredHeight: 300 }] };
	assert.throws(() => model.register({ schemaVersion: LAYOUT_SCHEMA, context: null, root: "remotecard", destinations: { remotecard: split, remote: chart } }), (error) => error.problems.some((problem) => problem.validation?.rows.some((row) => row.problems.includes("aspect-ratio-on-elastic-row"))));
});

test("a server repeating its declaration after setVariants is no mismatch either", () => {
	const declaration = { title: "Remote menu", min: 48, max: 320, preferred: 240, defaultChild: null };
	const set = { schemaVersion: LAYOUT_SCHEMA, context: null, root: "remote", destinations: { remote: declaration } };
	const model = card({ width: 900 });
	model.register(set);
	model.setVariants("remote", [{ id: "labels", when: { minWidth: 161 } }, { id: "icons", min: 48, preferred: 48, max: 160 }]);
	assert.deepEqual(model.register(set), []);
});
