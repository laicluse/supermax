import assert from "node:assert/strict";
import { test } from "node:test";
import { Navigator } from "../src/navigation.js";

const destinations = () => ({
	rail: { title: "Rail", min: 48, preferred: 84, max: 84, overflow: { mode: "keep", when: { minWorkspaceWidth: 600 } } },
	menu: { title: "Menu", min: 48, preferred: 180, max: 240, overflow: { mode: "keep", when: { minWorkspaceWidth: 600 } } },
	work: { title: "Work", min: 300, preferred: 360, max: "*" },
});

function shell(width) {
	const model = new Navigator({ root: "rail", minViewportHeight: 300, destinations: destinations() });
	model.resize({ width, height: 700 });
	model.open("menu", { from: "rail" });
	model.open("work", { from: "rail/menu" });
	return model;
}

test("above the declared workspace width the cells stay in view", () => {
	const layout = shell(700).layout();
	for (const id of ["rail", "rail/menu"]) {
		assert.equal(layout.cells.get(id).full, true, `${id} is in view`);
		assert.equal(layout.cells.get(id).kept, true, `${id} is kept`);
	}
	assert.equal(layout.cells.get("rail/menu/work").full, true);
});

test("below it they give way like any other cell and the work takes the whole width", () => {
	const model = shell(390);
	const layout = model.layout();
	assert.equal(layout.cells.get("rail").full, false, "the rail gives way");
	assert.equal(layout.cells.get("rail/menu").full, false, "the menu gives way");
	assert.equal(layout.cells.get("rail").kept, false);
	assert.equal(layout.cells.get("rail/menu/work").width, 390, "the work has the whole workspace");
	assert.equal(layout.overflowX, false);
	assert.equal(layout.access.get("rail").kind, "back", "Show brings the rail back");
	assert.equal(layout.access.get("rail/menu").kind, "back", "Show brings the menu back");
});

test("the same workspace keeps them again once it is wide enough", () => {
	const model = shell(390);
	model.resize({ width: 600, height: 700 });
	const layout = model.layout();
	assert.equal(layout.cells.get("rail").kept, true);
	assert.equal(layout.cells.get("rail/menu").full, true);
});

test("a row is kept on the same condition", () => {
	const model = new Navigator({ root: "split", minViewportHeight: 200, destinations: {
		split: { title: "Split", rows: [
			{ destination: "context", minHeight: 120, maxHeight: 200, overflow: { mode: "keep", when: { minWorkspaceWidth: 600 } } },
			{ destination: "detail", minHeight: 200, maxHeight: "*", preferredHeight: 300 },
		] },
		context: { title: "Context", min: 200, preferred: 300, max: "*" },
		detail: { title: "Detail", min: 200, preferred: 300, max: "*" },
	} });
	model.resize({ width: 700, height: 600 });
	assert.equal(model.layout().rows.get("split/context").kept, true);
	model.resize({ width: 390, height: 600 });
	assert.equal(model.layout().rows.get("split/context").kept, false);
});

test("the condition is a positive finite width on a keep policy and nothing else", () => {
	const declare = (overflow) => new Navigator({ root: "a", minViewportHeight: 200, destinations: { a: { title: "A", min: 100, preferred: 200, max: "*", overflow } } });
	assert.doesNotThrow(() => declare({ mode: "keep", when: { minWorkspaceWidth: 600 } }));
	for (const overflow of [{ mode: "keep", when: {} }, { mode: "keep", when: { minWorkspaceWidth: 0 } }, { mode: "keep", when: { minWorkspaceWidth: "600" } }, { mode: "keep", when: { minWidth: 600 } }, { mode: "fold", when: { minWorkspaceWidth: 600 } }]) {
		assert.throws(() => declare(overflow), JSON.stringify(overflow));
	}
});
