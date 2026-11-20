import assert from "node:assert/strict";
import { followEdge } from "../src/edge-drag.js";
import { scenario } from "./scenario.js";

const part = (id, size, min, max) => ({ id, size, min, max });
const sizes = (parts, changed) => parts.map((entry) => changed.get(entry.id) ?? entry.size);

scenario("a dragged edge takes the cells beside it first, then the ones further out", () => {
	const parts = [part("a", 200, 150, 300), part("b", 200, 150, 300), part("c", 200, 150, 300), part("d", 200, 150, 300)];
	assert.deepEqual(sizes(parts, followEdge(parts, 1, 480, 800)), [200, 280, 150, 170], "the left neighbour grows, and the right side gives way nearest first");
	assert.deepEqual(sizes(parts, followEdge(parts, 1, 560, 800)), [200, 300, 150, 150], "past its maximum the neighbour stops, and the edge stops where the far side reached its minimums");
	const wide = [part("a", 200, 150, 300), part("b", 280, 150, 300), part("c", 200, 150, 300), part("d", 120, 100, 300)];
	assert.deepEqual(sizes(wide, followEdge(wide, 1, 530, 800)), [230, 300, 150, 120], "once the neighbour reached its maximum, the next cell out grows");
});

scenario("dragging an edge back gives the room to the cell beside it on the far side", () => {
	const parts = [part("a", 200, 150, 300), part("b", 200, 150, 300), part("c", 200, 150, 300), part("d", 200, 150, 300)];
	assert.deepEqual(sizes(parts, followEdge(parts, 1, 340, 800)), [190, 150, 260, 200], "the left side shrinks nearest first and the right side grows nearest first");
	assert.deepEqual(sizes(parts, followEdge(parts, 1, 100, 800)), [150, 150, 300, 200], "the edge stops where every cell before it reached its minimum");
});

scenario("an elastic cell has no upper bound and canvas at the end is used before a cell shrinks", () => {
	const parts = [part("list", 300, 200, Infinity), part("detail", 300, 200, 400)];
	assert.deepEqual(sizes(parts, followEdge(parts, 0, 450, 700)), [450, 250], "the spare canvas goes first, then the neighbour shrinks");
	assert.deepEqual(sizes(parts, followEdge(parts, 0, 650, 700)), [500, 200], "an elastic cell grows as far as the others' minimums allow");
});

scenario("a part that cannot change size stays as it is", () => {
	const parts = [part("rail", 48, 48, 48), part("a", 200, 150, 300), part("b", 200, 150, 300)];
	assert.deepEqual(sizes(parts, followEdge(parts, 1, 298, 448)), [48, 250, 150]);
	assert.deepEqual([...followEdge(parts, 1, 248, 448).keys()], [], "an edge at its own place changes nothing");
});

console.log("Edge drag scenarios passed");
