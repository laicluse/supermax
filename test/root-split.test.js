import assert from "node:assert/strict";
import { test } from "node:test";
import { Navigator } from "../src/navigation.js";

function workspace(width) {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", rows: [
			{ destination: "modes", minHeight: 120, maxHeight: "*", preferredHeight: 300 },
			{ destination: "status", minHeight: 100, maxHeight: 200, preferredHeight: 200 },
		] },
		modes: { title: "Modes", min: 50, max: 200, preferred: 150 },
		boxes: { title: "Boxes", min: 150, max: 300, preferred: 200 },
		status: { title: "Status", min: 100, max: 500, preferred: 350 },
		views: { title: "Views", min: 150, max: 300, preferred: 200, placement: "beside-split" },
		list: { title: "List", min: 300, max: "*", preferred: 400 },
		detail: { title: "Detail", min: 300, max: "*", preferred: 800 },
	} });
	model.resize({ width, height: 600 });
	return model;
}

const path = ["menu", "modes", "boxes", "views", "list"];
const shown = (model) => [...model.layout().cells.values()].filter((cell) => cell.full).map((cell) => cell.title);

test("a split that is the workspace root opens with its rows", () => {
	const model = workspace(1400);
	assert.deepEqual(model.state().occurrences, ["menu", "menu/modes", "menu/status"]);
	assert.deepEqual(shown(model), ["Menu", "Modes", "Status"]);
	assert.equal(model.layout().cells.get("menu/status").width, model.layout().cells.get("menu").width, "a row with one cell spans the split");
});

test("a path leads through a row of the root split to the cells beside it", () => {
	const model = workspace(1400);
	assert.equal(model.sync(path).ok, true);
	assert.deepEqual(shown(model), ["Menu", "Modes", "Boxes", "Status", "Views", "List"]);
	const { cells } = model.layout();
	assert.equal(cells.get("menu/status").width, cells.get("menu/modes").width + cells.get("menu/modes/boxes").width, "the lower row runs below both cells of the upper row");
	assert.equal(model.sync(path).noop, true);
	model.reset();
	assert.deepEqual(model.state().occurrences, ["menu", "menu/modes", "menu/status"], "a reset leaves the rows open");
});

test("the root split leaves behind Show when the path needs its room, and comes back whole", () => {
	const model = workspace(1250);
	model.sync([...path, "detail"]);
	assert.deepEqual(shown(model), ["List", "Detail"]);
	const before = model.snapshot();
	while (!shown(model).includes("Menu")) {
		const target = model.upTarget();
		assert.ok(target, "Show reaches the root split");
		model.showByClosing(target.id);
	}
	assert.ok(["Modes", "Status"].every((title) => shown(model).includes(title)), "its rows come back with it");
	assert.equal(model.restore(before), true);
	assert.deepEqual(shown(model), ["List", "Detail"]);
});
