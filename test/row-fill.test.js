import assert from "node:assert/strict";
import { test } from "node:test";
import { Navigator } from "../src/navigation.js";

function card(width = 1200) {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 200, preferred: 240, max: 280, defaultChild: null },
		card: { title: "Card", rows: [
			{ destination: "chart", minHeight: 120, maxHeight: 300, preferredHeight: 200 },
			{ destination: "table", minHeight: 120, maxHeight: "*", preferredHeight: 400 },
		] },
		chart: { title: "Chart", min: 200, preferred: 300, max: 400 },
		table: { title: "Table", min: 300, preferred: 600, max: "*" },
		note: { title: "Note", min: 160, preferred: 200, max: 240 },
	} });
	model.resize({ width, height: 600 });
	model.open("card", { from: "menu" });
	return model;
}

test("the newest cell of a row fills what the row leaves after every cell reached its maximum", () => {
	const layout = card().layout();
	const split = layout.cells.get("menu/card");
	assert.ok(split.width > 400, `the split is wider than the chart's maximum (${split.width})`);
	assert.equal(layout.cells.get("menu/card/chart").width, split.width, "the chart reaches the row's edge");
	assert.equal(layout.chains.get("menu/card/chart").spare, 0);
});

test("an earlier cell of the row keeps its maximum and the newest takes the rest", () => {
	const model = card(1600);
	model.open("note", { from: "menu/card/chart" });
	const layout = model.layout();
	const chart = layout.cells.get("menu/card/chart");
	const note = layout.cells.get("menu/card/chart/note");
	assert.ok(chart.width <= 400, `the chart stays within its maximum (${chart.width})`);
	assert.ok(note.width > 240, `the note passes its maximum to reach the row's edge (${note.width})`);
	assert.equal(chart.width + note.width, layout.cells.get("menu/card").width);
});

test("the root chain keeps its spare room: only a row is as wide as its split", () => {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: { menu: { title: "Menu", min: 200, preferred: 240, max: 280, defaultChild: null }, detail: { title: "Detail", min: 300, preferred: 500, max: "*" } } });
	model.resize({ width: 1200, height: 600 });
	const layout = model.layout();
	assert.equal(layout.cells.get("menu").width, 280);
	assert.equal(layout.chain.spare, 920);
});

test("a cell the user gave a width keeps it, also as the newest of its row", () => {
	const model = card();
	model.setSize("menu/card/chart", 260, "width");
	assert.equal(model.layout().cells.get("menu/card/chart").width, 260);
});

test("a split the user sized keeps the maxima of its rows", () => {
	const model = card();
	model.setSize("menu/card", 700, "width");
	assert.ok(model.layout().cells.get("menu/card/chart").width <= 400);
});
