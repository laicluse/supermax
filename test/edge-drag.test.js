import assert from "node:assert/strict";
import { followEdge } from "../src/edge-drag.js";
import { scenario } from "./scenario.js";

const part = (id, size, min, max) => ({ id, size, min, max });
const sizes = (parts, changed) => parts.map((entry) => changed.get(entry.id) ?? entry.size);

scenario("a dragged edge defines only the cell directly before it", () => {
	const parts = [part("a", 200, 150, 300), part("b", 200, 150, 300), part("c", 200, 150, 300), part("d", 200, 150, 300)];
	assert.deepEqual(sizes(parts, followEdge(parts, 1, 480, 800)), [200, 280, 200, 200], "only the preceding column receives a session size");
	assert.deepEqual([...followEdge(parts, 1, 480, 800).keys()], ["b"]);
	assert.deepEqual(sizes(parts, followEdge(parts, 1, 560, 800)), [200, 300, 200, 200], "the gutter stops at its own column's maximum");
	const wide = [part("a", 200, 150, 300), part("b", 280, 150, 300), part("c", 200, 150, 300), part("d", 120, 100, 300)];
	assert.deepEqual(sizes(wide, followEdge(wide, 1, 530, 800)), [200, 300, 200, 120], "an earlier column never takes over the drag");
});

scenario("dragging an edge back stops at its preceding cell's minimum", () => {
	const parts = [part("a", 200, 150, 300), part("b", 200, 150, 300), part("c", 200, 150, 300), part("d", 200, 150, 300)];
	assert.deepEqual(sizes(parts, followEdge(parts, 1, 340, 800)), [200, 150, 200, 200]);
	assert.deepEqual(sizes(parts, followEdge(parts, 1, 100, 800)), [200, 150, 200, 200]);
});

scenario("an elastic cell has no upper bound and canvas at the end is used before a cell shrinks", () => {
	const parts = [part("list", 300, 200, Infinity), part("detail", 300, 200, 400)];
	assert.deepEqual(sizes(parts, followEdge(parts, 0, 450, 700)), [450, 300], "the allocator owns the remaining room");
	assert.deepEqual(sizes(parts, followEdge(parts, 0, 650, 700)), [500, 300], "the requested width reserves the following minimums");
});

scenario("a part that cannot change size stays as it is", () => {
	const parts = [part("rail", 48, 48, 48), part("a", 200, 150, 300), part("b", 200, 150, 300)];
	assert.deepEqual(sizes(parts, followEdge(parts, 1, 298, 448)), [48, 250, 200]);
	assert.deepEqual([...followEdge(parts, 1, 248, 448).keys()], [], "an edge at its own place changes nothing");
	assert.equal(followEdge(parts, 0, 100, 600).size, 0, "a fixed cell cannot redirect the drag into the spare room");
});

console.log("Edge drag scenarios passed");
