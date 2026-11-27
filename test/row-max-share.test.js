import assert from "node:assert/strict";
import { test } from "node:test";
import { Navigator } from "../src/navigation.js";
import { layoutOf, validateDeclarationSet, encodeLayoutHeader, parseLayoutHeader, LAYOUT_SCHEMA } from "../src/layout-declaration.js";
import { rowCeiling, variantProblems } from "../src/variants.js";
import { layoutWorkspace, withGrowth } from "../src/layout.js";

function destinations({ chart = {}, row = {} } = {}) {
	return {
		card: { title: "Card", rows: [
			{ destination: "chart", minHeight: 100, maxHeight: "50%", preferredHeight: 300, ...row },
			{ destination: "table", minHeight: 100, maxHeight: "*", preferredHeight: 300 },
		] },
		chart: { title: "Chart", min: 300, max: "*", preferred: 600, ...chart },
		table: { title: "Table", min: 300, max: "*", preferred: 600 },
	};
}

function card({ width = 1200, height = 800, ...declared } = {}) {
	const model = new Navigator({ root: "card", minViewportHeight: 300, destinations: destinations(declared) });
	model.resize({ width, height });
	return model;
}

const heights = (model) => model.layout().chain.cells[0].rows.rows.map((row) => row.height);
const chartRow = (model) => model.layout().rows.get("card/chart");
const declarationProblems = (row) => validateDeclarationSet({ schemaVersion: LAYOUT_SCHEMA, context: null, root: "card", destinations: Object.fromEntries(Object.entries(destinations({ row })).map(([id, definition]) => [id, layoutOf(definition)])) });

test("a row with a percentage maxHeight is no taller than that share of its split, and the elastic row takes the rest", () => {
	const model = card({ height: 800 });
	assert.deepEqual(heights(model), [400, 400]);
	assert.equal(chartRow(model).maxHeight, 400, "the layout reports the ceiling in pixels");
	model.resize({ width: 1200, height: 1200 });
	assert.deepEqual(heights(model), [600, 600], "a taller split raises the ceiling with it");
	model.resize({ width: 1200, height: 400 });
	assert.equal(chartRow(model).maxHeight, 200, "a shorter split lowers it");
	assert.ok(heights(model)[0] <= 200);
});

test("the share never pushes a row below its minHeight", () => {
	const model = card({ height: 400, row: { maxHeight: "10%", preferredHeight: null } });
	assert.equal(heights(model)[0], 100);
	assert.equal(chartRow(model).maxHeight, 100);
});

test("a preferredHeight above the share yields to it instead of refusing the declaration", () => {
	const model = card({ height: 800, row: { maxHeight: "25%", preferredHeight: 300 } });
	assert.deepEqual(heights(model), [200, 600]);
});

test("an aspect ratio and a share are both ceilings, and the lower one holds", () => {
	const wide = card({ width: 1800, height: 800, chart: { aspectRatio: 3 } });
	assert.equal(chartRow(wide).fitHeight, 600);
	assert.equal(heights(wide)[0], 400, "the share holds where the drawing would ask more");
	const narrow = card({ width: 600, height: 800, chart: { aspectRatio: 3 } });
	assert.equal(heights(narrow)[0], 200, "the ratio holds where the cell is narrow");
});

test("a divider drags the row up to its share, and a size set above it stops there", () => {
	const model = card({ height: 800 });
	assert.equal(chartRow(model).resizeMax, 400);
	model.setSize("card/chart", 700, "height");
	assert.equal(heights(model)[0], 400);
	model.resize({ width: 1200, height: 1600 });
	assert.equal(heights(model)[0], 700, "the stored size returns once the split is tall enough");
});

test("only a percentage above 0 and up to 100 is a share", () => {
	for (const maxHeight of ["50%", "0.5%", "100%"]) assert.deepEqual(declarationProblems({ maxHeight }), [], maxHeight);
	for (const maxHeight of ["0%", "101%", "-5%", "50", "50 %", "half", "%", "49.99999%", "0050%", "50.%"]) assert.notDeepEqual(declarationProblems({ maxHeight, preferredHeight: null }), [], maxHeight);
	assert.throws(() => card({ row: { maxHeight: "0%" } }).layout());
});

test("a percentage is a row height only: a cell's width refuses it", () => {
	const set = { schemaVersion: LAYOUT_SCHEMA, context: null, root: "chart", destinations: { chart: layoutOf({ title: "Chart", min: 300, max: "50%", preferred: 300 }) } };
	assert.notDeepEqual(validateDeclarationSet(set), []);
});

test("a share travels in the layout header as declared", async () => {
	const set = { schemaVersion: LAYOUT_SCHEMA, context: null, root: "card", destinations: Object.fromEntries(Object.entries(destinations()).map(([id, definition]) => [id, layoutOf(definition)])) };
	const { inline } = parseLayoutHeader((await encodeLayoutHeader(set)).value);
	assert.equal(JSON.parse(Buffer.from(inline, "base64url").toString()).destinations.card.rows[0].maxHeight, "50%");
});

test("a row with forms keeps its share for the forms that inherit it", () => {
	const variants = [{ id: "expanded", when: { minHeight: 160 } }, { id: "summary", minHeight: 40, preferredHeight: 40, maxHeight: 159 }];
	const row = { minHeight: 40, maxHeight: "50%", preferredHeight: 300, variants };
	assert.deepEqual(variantProblems({ destination: "chart", ...row }, "height"), []);
	const tall = card({ height: 800, row });
	assert.equal(tall.layout().cells.get("card/chart").rowVariant, "expanded");
	assert.equal(heights(tall)[0], 400);
	assert.equal(chartRow(tall).resizeMax, 400, "the divider stops at the share, not at the summary's own ceiling");
	const short = card({ height: 300, row });
	assert.equal(short.layout().cells.get("card/chart").rowVariant, "summary", "a share below the expanded form's threshold leaves the summary");
	assert.equal(heights(short)[0], 40);
});

test("a share does not make a row elastic", () => {
	assert.throws(() => new Navigator({ root: "card", minViewportHeight: 300, destinations: { ...destinations(), card: { title: "Card", rows: [{ destination: "chart", minHeight: 100, maxHeight: "50%" }, { destination: "table", minHeight: 100, maxHeight: "50%" }] } } }), /no-elastic-row/);
});

test("a stored size above the share does not make the row fold when another row takes focus", () => {
	const model = card({ height: 800, row: { preferredHeight: null } });
	model.definitionOf("table").growOnFocus = true;
	model.setSize("card/chart", 700, "height");
	assert.deepEqual(heights(model), [400, 400]);
	const grown = layoutWorkspace(withGrowth(model, "card/table"));
	assert.equal(grown.rows.get("card/chart").folded, false, "the table already has what it prefers, so nothing gives way");
	assert.equal(grown.rows.get("card/chart").height, 400);
});

test("a share closes no range by itself: the form after it must start where it does", () => {
	const gapped = [{ id: "expanded", when: { minHeight: 160 } }, { id: "summary", minHeight: 40, preferredHeight: 40, maxHeight: "10%" }];
	assert.deepEqual(variantProblems({ destination: "chart", minHeight: 40, maxHeight: 320, preferredHeight: 300, variants: gapped }, "height"), ["variant-gap"]);
	const closed = [{ id: "expanded", when: { minHeight: 160 } }, { id: "summary", minHeight: 40, preferredHeight: 40, maxHeight: 159 }];
	assert.deepEqual(variantProblems({ destination: "chart", minHeight: 40, maxHeight: "50%", preferredHeight: 300, variants: closed }, "height"), []);
});

test("a share that lands on a whole pixel is that pixel", () => {
	assert.equal(rowCeiling("58%", 40, 400), 232, "binary arithmetic alone lands on 231.99999999999997");
	assert.equal(rowCeiling("58%", 40, 399), 231);
	assert.equal(rowCeiling("33.3%", 40, 1000), 333);
	const model = card({ height: 400, row: { maxHeight: "58%", preferredHeight: null } });
	assert.equal(chartRow(model).maxHeight, 232);
	assert.equal(chartRow(model).resizeMax, 232);
});

test("the declaration set and the navigator refuse the same preferredHeight", () => {
	for (const preferredHeight of [50, "300", -1]) {
		assert.notDeepEqual(declarationProblems({ preferredHeight }), [], `declaration set, ${preferredHeight}`);
		assert.throws(() => card({ row: { preferredHeight } }), /invalid/, `navigator, ${preferredHeight}`);
	}
	assert.notDeepEqual(declarationProblems({ maxHeight: 200, preferredHeight: 300 }), [], "a preference above a pixel maximum");
});

test("the percentage is taken exactly, so a share just under a pixel stays under it", () => {
	assert.equal(rowCeiling("49.9999%", 40, 400), 199);
	assert.equal(rowCeiling("50%", 40, 401), 200);
	assert.equal(rowCeiling("100%", 40, 733), 733);
});

test("forms that end at a share use the same one", () => {
	const variants = [{ id: "expanded", when: { minHeight: 160 }, maxHeight: "60%" }, { id: "summary", minHeight: 40, preferredHeight: 40 }];
	assert.deepEqual(variantProblems({ destination: "chart", minHeight: 40, maxHeight: "50%", preferredHeight: 100, variants }, "height"), ["variant-shares-differ"]);
});

test("a shared form between two forms in pixels cannot bridge them", () => {
	const variants = [{ id: "large", when: { minHeight: 161 }, maxHeight: 400 }, { id: "middle", when: { minHeight: 160 }, maxHeight: "10%" }, { id: "summary", minHeight: 40, preferredHeight: 40, maxHeight: 159 }];
	assert.deepEqual(variantProblems({ destination: "chart", minHeight: 40, maxHeight: 400, preferredHeight: 100, variants }, "height"), ["variant-gap"]);
});

// allow-comment: the proof of the two rules: whatever the split's height, a divider finds every size between the row's smallest and largest form.
function assertEverySizeAdmitted(row, label) {
	for (const height of [300, 319, 320, 321, 400, 640, 800, 1400]) {
		const model = card({ height, row });
		const { resizeMin, resizeMax } = chartRow(model);
		const budget = height - 100;
		for (let size = resizeMin; size <= Math.min(resizeMax, budget); size += 1) {
			model.setSize("card/chart", size, "height");
			assert.equal(heights(model)[0], size, `${label}: a split of ${height} admits ${size}`);
		}
	}
}

test("a summary in pixels below an expanded form that ends at a share admits every size at every height", () => {
	assertEverySizeAdmitted({ minHeight: 40, maxHeight: "50%", preferredHeight: 300, variants: [{ id: "expanded", when: { minHeight: 160 } }, { id: "summary", minHeight: 40, preferredHeight: 40, maxHeight: 159 }] }, "summary in pixels");
});

test("two forms that inherit the same share admit every size at every height", () => {
	const row = { minHeight: 40, maxHeight: "50%", preferredHeight: 100, variants: [{ id: "expanded", when: { minHeight: 160 } }, { id: "compact", minHeight: 40, preferredHeight: 40 }] };
	assert.deepEqual(variantProblems({ destination: "chart", ...row }, "height"), []);
	assertEverySizeAdmitted(row, "shared by both");
});

test("forms with minima of their own still admit every size: a form its share cannot reach is not there", () => {
	const row = { minHeight: 40, maxHeight: "10%", preferredHeight: 40, variants: [{ id: "expanded", minHeight: 160, preferredHeight: 200, when: { minHeight: 160 } }, { id: "compact", minHeight: 40, preferredHeight: 40 }] };
	assert.deepEqual(variantProblems({ destination: "chart", ...row }, "height"), []);
	const model = card({ height: 800, row });
	assert.equal(chartRow(model).shareHeight, 80);
	assert.equal(chartRow(model).resizeMax, 80, "the expanded form starts above the share, so the divider ends at the compact form");
	model.setSize("card/chart", 81, "height");
	assert.equal(heights(model)[0], 80);
	assert.equal(model.layout().cells.get("card/chart").rowVariant, "compact");
	assertEverySizeAdmitted(row, "minima of their own");
	assertEverySizeAdmitted({ ...row, maxHeight: "50%" }, "minima of their own at half");
});

test("a fallback that ends at a share starts lowest among the shared forms", () => {
	const variants = [{ id: "expanded", when: { minHeight: 60 } }, { id: "compact", minHeight: 120, preferredHeight: 120 }];
	assert.deepEqual(variantProblems({ destination: "chart", minHeight: 40, maxHeight: "50%", preferredHeight: 100, variants }, "height"), ["variant-gap"]);
});

test("the divider ends where the forms that are there end: a form waiting for more width takes no part", () => {
	const row = { minHeight: 40, maxHeight: 400, preferredHeight: 100, variants: [{ id: "wide", when: { minWidth: 1500 } }, { id: "compact", minHeight: 40, preferredHeight: 40, maxHeight: "10%" }] };
	assert.equal(chartRow(card({ width: 1200, height: 800, row })).resizeMax, 80);
	assert.equal(chartRow(card({ width: 1600, height: 800, row })).resizeMax, 400);
});

test("a form that starts above the height its drawing fits is not chosen", () => {
	const row = { minHeight: 40, maxHeight: "50%", preferredHeight: 300, variants: [{ id: "expanded", minHeight: 160, preferredHeight: 200, when: { minHeight: 160 } }, { id: "compact", minHeight: 40, preferredHeight: 40 }] };
	const model = card({ width: 480, height: 800, row, chart: { aspectRatio: 6 } });
	assert.equal(chartRow(model).fitHeight, 80);
	assert.equal(model.layout().cells.get("card/chart").rowVariant, "compact");
	assert.ok(heights(model)[0] <= chartRow(model).resizeMax, "the row stands within what its divider reports");
});

test("forms that all declare their own maxHeight leave the row's own out of it", () => {
	const row = { minHeight: 40, maxHeight: "10%", preferredHeight: 40, variants: [{ id: "expanded", when: { minHeight: 160 }, maxHeight: "50%", preferredHeight: 200 }, { id: "compact", minHeight: 40, preferredHeight: 40, maxHeight: 159 }] };
	const model = card({ height: 800, row });
	assert.equal(chartRow(model).shareHeight, 400);
	assert.equal(chartRow(model).resizeMax, 400);
	model.setSize("card/chart", 200, "height");
	assert.equal(heights(model)[0], 200);
});

test("the forms that are there at each width close the range, not only the narrowest and the widest set", () => {
	const variants = [{ id: "bridge", when: { minWidth: 1500 }, maxHeight: 159 }, { id: "tall", when: { minWidth: 1000, minHeight: 160 }, maxHeight: 400 }, { id: "compact", minHeight: 40, preferredHeight: 40, maxHeight: "10%" }];
	assert.deepEqual(variantProblems({ destination: "chart", minHeight: 40, maxHeight: 400, preferredHeight: 100, variants }, "height"), ["variant-gap"]);
});

test("both ends of the divider come from the forms that are there", () => {
	const shared = { minHeight: 40, maxHeight: 200, preferredHeight: 100, variants: [{ id: "expanded", minHeight: 40, maxHeight: "10%", preferredHeight: 40, when: { minHeight: 160 } }, { id: "plain", minHeight: 100, preferredHeight: 100, maxHeight: 200 }] };
	const short = chartRow(card({ height: 800, row: shared }));
	assert.deepEqual([short.resizeMin, short.resizeMax], [100, 200], "the expanded form is out of reach, so its lower minimum does not count");
	const fitted = { minHeight: 80, maxHeight: 200, preferredHeight: 100, variants: [{ id: "expanded", minHeight: 80, maxHeight: 120, preferredHeight: 100, when: { minHeight: 80 } }, { id: "plain", minHeight: 100, preferredHeight: 100, maxHeight: 200 }] };
	const model = card({ width: 1200, height: 800, row: fitted, chart: { aspectRatio: 20 } });
	assert.equal(chartRow(model).fitHeight, 60);
	model.setSize("card/chart", 40, "height");
	assert.equal(model.layout().cells.get("card/chart").rowVariant, "plain");
	assert.ok(chartRow(model).resizeMax >= heights(model)[0], "the divider reaches the height the row stands at");
	assert.equal(chartRow(model).resizeMin, 100);
});
