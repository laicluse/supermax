import assert from "node:assert/strict";
import { test } from "node:test";
import { Navigator } from "../src/navigation.js";

const names = ["a", "b", "c", "d", "e"];
const id = (name) => names.slice(0, names.indexOf(name) + 1).join("/");
const rail = { a: { min: 50, preferred: 50, max: 50, overflow: { mode: "keep" } } };

function chain(width, overrides = {}) {
	const destinations = Object.fromEntries(names.map((name) => [name, { title: name.toUpperCase(), min: 100, preferred: 200, max: "*", ...overrides[name] }]));
	const model = new Navigator({ root: "a", minViewportHeight: 200, destinations });
	model.resize({ width, height: 400 });
	for (const name of names.slice(1)) model.open(name, { from: id(names[names.indexOf(name) - 1]) });
	return model;
}

function picture(model) {
	return model.layout().chain.cells.map((cell) => cell.folded ? `[${cell.title}]` : cell.full ? cell.title : `(${cell.title})`).join(" ");
}

function stack(height) {
	const model = new Navigator({ root: "menu", minViewportHeight: 120, destinations: {
		menu: { title: "Menu", min: 50, max: 50, overflow: { mode: "keep" } },
		work: { title: "Work", rows: [
			{ destination: "one", minHeight: 100, maxHeight: "*", preferredHeight: 100 },
			{ destination: "two", minHeight: 100, maxHeight: 100 },
			{ destination: "three", minHeight: 100, maxHeight: 100 },
		] },
		one: { title: "One", min: 100, max: "*", preferred: 200 },
		two: { title: "Two", min: 100, max: 200 },
		three: { title: "Three", min: 100, max: 200 },
	} });
	model.resize({ width: 400, height });
	model.open("work", { from: "menu" });
	return model;
}

function rows(model) {
	return model.layout().cells.get("menu/work").rows.rows.map((row) => row.folded ? `[${row.title}]` : row.title).join(" ");
}

test("opening a fold takes its room from the trailing end and closes what no longer fits", () => {
	const model = chain(450, rail);
	assert.equal(picture(model), "A [B] [C] D E");
	const closed = model.unfold(id("b"), "horizontal");
	assert.equal(picture(model), "A B [C] D");
	assert.deepEqual(closed.map((cell) => cell.id), [id("e")]);
	assert.deepEqual(model.unfold(id("c"), "horizontal").map((cell) => cell.id), [id("d")]);
	assert.equal(picture(model), "A B C");
});

test("a cell the user opened folds last and gives way again when the leaf needs the room", () => {
	const model = chain(450, rail);
	model.unfold(id("b"), "horizontal");
	model.resize({ width: 300, height: 400 });
	assert.equal(picture(model), "A [B] [C] D");
	model.resize({ width: 450, height: 400 });
	assert.equal(picture(model), "A B [C] D");
});

test("an opened cell gives way only after a cell that can hide has done so", () => {
	const wide = { a: rail.a, d: { min: 100, preferred: 400, max: "*", overflow: { mode: "hide" } }, e: { min: 100, preferred: 600, max: "*" } };
	const model = chain(1000, wide);
	assert.equal(picture(model), "A [B] [C] (D) E");
	assert.deepEqual(model.unfold(id("b"), "horizontal"), [], "the cell fits beside the last one once the hidden cell is out of the count");
	assert.equal(picture(model), "A B [C] (D) E");
});

test("every folded cell is its own page that opens toward the trailing side", () => {
	const model = chain(450);
	assert.equal(picture(model), "[A] [B] [C] D E");
	for (const name of ["a", "b", "c"]) {
		const cell = model.layout().cells.get(id(name));
		assert.equal(cell.foldDirection, "right");
		assert.equal(cell.foldOpening, "right");
		assert.equal(model.layout().access.get(id(name)).kind, "back");
	}
});

test("a folded row opens by making the rows after it give way, and comes back the same way", () => {
	const model = stack(228);
	assert.equal(rows(model), "[One] Two Three");
	assert.deepEqual(model.unfold("menu/work/one", "vertical"), []);
	assert.equal(rows(model), "One Two [Three]");
	assert.equal(model.layout().rows.get("menu/work/three").foldDirection, "up");
	assert.deepEqual(model.layout().access.get("menu/work/three"), { kind: "fold", occurrence: "menu/work/three", axis: "vertical" });
	model.unfold("menu/work/three", "vertical");
	assert.equal(rows(model), "[One] Two Three");
	assert.equal(model.state().occurrences.length, 5);
});

test("Show and a fold handle reach the same layout", () => {
	const shown = chain(450, rail);
	const unfolded = chain(450, rail);
	const target = shown.upTarget().id;
	shown.showByClosing(target);
	unfolded.unfold(target, "horizontal");
	assert.equal(picture(shown), picture(unfolded));
	assert.equal(unfolded.layout().cells.get(target).full, true);
});

test("snapshots carry the opened folds and drop the ones whose cell has closed", () => {
	const model = chain(450, rail);
	model.unfold(id("b"), "horizontal");
	const copy = chain(450, rail);
	copy.restore(model.snapshot());
	assert.equal(picture(copy), "A B [C] D");
	copy.closeSubtree(copy.get(id("b")));
	assert.deepEqual(copy.unfolded, []);
});

test("a withheld cell leaves the layout while it stays open", () => {
	const model = chain(450, rail);
	const before = model.snapshot();
	const closed = model.unfold(id("b"), "horizontal");
	const after = picture(model);
	model.restore(before);
	model.unfolded = [{ occurrence: id("b"), scope: "a" }];
	model.withheld = new Set(closed.map((cell) => cell.id));
	assert.equal(picture(model), after);
	assert.ok(model.get(id("e")));
	model.withheld = null;
});
