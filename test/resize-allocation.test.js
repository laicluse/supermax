import assert from "node:assert/strict";
import { test } from "node:test";
import { Navigator } from "../src/index.js";

function chain() {
	const navigator = new Navigator({ root: "first", minViewportHeight: 100, destinations: {
		first: { title: "First", min: 100, max: 500, preferred: 100, overflow: { mode: "keep" } },
		second: { title: "Second", min: 100, max: 500, preferred: 100, zoomable: true },
		third: { title: "Third", min: 100, max: "*", preferred: 100 },
	} });
	navigator.resize({ width: 900, height: 400 });
	navigator.open("second"); navigator.open("third", { from: "first/second" });
	return navigator;
}

test("session sizes use the available room in reading order after a viewport shrinks", () => {
	const navigator = chain();
	const widths = () => navigator.layout().chain.cells.map((cell) => cell.width);
	navigator.setSize("first", 300); navigator.setSize("first/second", 500);
	assert.deepEqual(widths(), [300, 500, 100]);
	navigator.resize({ width: 600, height: 400 });
	assert.deepEqual(widths(), [300, 200, 100]);
	navigator.setSize("first/second", 180);
	assert.deepEqual(widths(), [300, 180, 120], "a later resize never reclaims room from an earlier cell");
	navigator.resize({ width: 900, height: 400 });
	assert.deepEqual(widths(), [300, 180, 420]);
});

test("zoom fills the available room while retaining the cell's unzoomed session size", () => {
	const navigator = chain();
	navigator.closeNewestGroup(); navigator.setSize("first/second", 200);
	navigator.zoom("first/second");
	assert.equal(navigator.layout().cells.get("first/second").width, 900);
	navigator.zoom(null);
	assert.equal(navigator.layout().cells.get("first/second").width, 200);
});

test("a resized list can take room from the preferred width of a following split", () => {
	const navigator = new Navigator({ root: "list", minViewportHeight: 100, destinations: {
		list: { title: "Conversations", min: 320, max: "*", preferred: 400, overflow: { mode: "keep" } },
		split: { title: "Conversation", rows: [{ destination: "metadata", minHeight: 100, maxHeight: "*", preferredHeight: 400 }] },
		metadata: { title: "Metadata", min: 320, max: 640, preferred: 320, defaultChild: "messages" },
		messages: { title: "Messages", min: 320, max: "*", preferred: 800 },
	} });
	navigator.resize({ width: 1588, height: 600 }); navigator.open("split");
	navigator.setSize("list", 800);
	const layout = navigator.layout();
	assert.equal(layout.cells.get("list").width, 800);
	assert.equal(layout.cells.get("list/split").width, 788);
	assert.equal(layout.cells.get("list/split/metadata").full, true);
	assert.equal(layout.cells.get("list/split/metadata/messages").full, true);
});

test("a following split yielding preferred room does not change an earlier flexible column", () => {
	const navigator = new Navigator({ root: "mode", minViewportHeight: 100, destinations: {
		mode: { title: "Mode", min: 1000, max: 2000, preferred: 1000, overflow: { mode: "keep" } },
		list: { title: "Conversations", min: 100, max: 500, preferred: 100 },
		split: { title: "Conversation", rows: [{ destination: "messages", minHeight: 100, maxHeight: "*", preferredHeight: 400 }] },
		messages: { title: "Messages", min: 400, max: "*", preferred: 1000 },
	} });
	navigator.resize({ width: 2200, height: 600 }); navigator.open("list"); navigator.open("split", { from: "mode/list" });
	const before = navigator.layout();
	const requested = before.cells.get("mode/list").width + 100;
	navigator.setSize("mode/list", requested);
	const after = navigator.layout();
	assert.equal(after.cells.get("mode").width, before.cells.get("mode").width);
	assert.equal(after.cells.get("mode/list").width, requested);
});
