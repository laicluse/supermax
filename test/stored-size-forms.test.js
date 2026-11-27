import assert from "node:assert/strict";
import { test } from "node:test";
import { Navigator } from "../src/navigation.js";

function card(row) {
	const model = new Navigator({ root: "card", minViewportHeight: 300, destinations: {
		card: { title: "Card", rows: [
			{ destination: "chart", ...row },
			{ destination: "table", minHeight: 100, maxHeight: "*", preferredHeight: 300 },
		] },
		chart: { title: "Chart", min: 300, max: "*", preferred: 600 },
		table: { title: "Table", min: 300, max: "*", preferred: 600 },
	} });
	model.resize({ width: 1200, height: 800 });
	return model;
}

const ROW = { minHeight: 40, maxHeight: 320, preferredHeight: 100, variants: [{ id: "expanded", minHeight: 160, preferredHeight: 200, when: { minHeight: 160 } }, { id: "compact", minHeight: 40, preferredHeight: 40, maxHeight: 159 }] };

test("a row size stored below a larger form's own minimum keeps the smaller form at that size", () => {
	const model = card(ROW);
	model.setSize("card/chart", 40, "height");
	assert.equal(model.layout().rows.get("card/chart").height, 40);
	assert.equal(model.layout().cells.get("card/chart").rowVariant, "compact");
});

test("a divider finds every size between a row's forms when the larger form has a minimum of its own", () => {
	const model = card(ROW);
	const { resizeMin, resizeMax } = model.layout().rows.get("card/chart");
	assert.deepEqual([resizeMin, resizeMax], [40, 320]);
	for (let size = resizeMin; size <= resizeMax; size += 1) {
		model.setSize("card/chart", size, "height");
		assert.equal(model.layout().rows.get("card/chart").height, size, `size ${size}`);
	}
	model.setSize("card/chart", null, "height");
	assert.equal(model.layout().cells.get("card/chart").rowVariant, "expanded", "without a stored size the larger form still stands where it fits");
});

test("a cell width stored below a larger form's own minimum keeps the smaller form at that width", () => {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 56, max: 240, preferred: 200, variants: [{ id: "labels", min: 168, preferred: 200, when: { minWidth: 168 } }, { id: "icons", min: 56, preferred: 56, max: 167 }] },
		work: { title: "Work", min: 300, max: "*", preferred: 600 },
	} });
	model.resize({ width: 1200, height: 800 });
	model.open("work", { from: "menu" });
	assert.equal(model.layout().cells.get("menu").variant, "labels");
	model.setSize("menu", 60, "width");
	assert.equal(model.layout().cells.get("menu").width, 60);
	assert.equal(model.layout().cells.get("menu").variant, "icons");
});

for (const [max, preferred] of [[240, 200], [168, 168]]) test(`a zoom sets the width, so a stored width does not hold the larger form back (max ${max}), and zooming out returns the stored width`, () => {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 56, max, preferred, zoomable: true, variants: [{ id: "labels", when: { minWidth: 168 } }, { id: "icons", preferred: 56, max: 167 }] },
		work: { title: "Work", min: 300, max: "*", preferred: 600 },
	} });
	model.resize({ width: 1200, height: 800 });
	model.open("work", { from: "menu" });
	model.setSize("menu", 60, "width");
	const state = () => [model.layout().cells.get("menu").width, model.layout().cells.get("menu").variant];
	assert.deepEqual(state(), [60, "icons"]);
	const zoomedOut = state();
	model.zoom("menu");
	const zoomedIn = state();
	model.zoom(null);
	assert.deepEqual(state(), zoomedOut, "zooming out returns the stored width and its form");
	assert.equal(zoomedIn[1], "labels", "zoomed, the menu shows its larger form");
	assert.ok(zoomedIn[0] >= 168);
});
