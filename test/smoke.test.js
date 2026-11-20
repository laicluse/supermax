import assert from "node:assert/strict";
import { CellCollection, CellProxy } from "../src/cell-collection.js";

const packageApi = await import("@laicluse/supermax");
assert.equal(packageApi.CellCollection, CellCollection);
assert.equal(packageApi.CellProxy, CellProxy);
assert.equal(typeof packageApi.CellStrip, "function");
assert.equal(typeof packageApi.Navigator, "function");
assert.equal(typeof packageApi.Workspace, "function");
assert.equal(typeof packageApi.validateSplit, "function");
assert.equal(globalThis.Supermax.CellStrip, packageApi.CellStrip);
assert.equal(globalThis.Supermax.CellCollection, CellCollection);
assert.equal(globalThis.Supermax.CellProxy, CellProxy);

const configs = [
	{ id: "vault", title: "Vault", min: 3, max: 4 },
	{ id: "epics", title: "Epics", min: 4, max: 6 },
	{ id: "world", title: "Board", min: 8, max: 64, zoomable: true },
	{ id: "idea", title: "Idea", min: 8, max: 64 },
];

let result = new CellCollection(configs).distribute(20);
assert.deepEqual(result.cells.map((cell) => cell.visible), [false, true, true, true]);
assert.equal(result.hiddenCount, 1);
assert.equal(result.rightmostHiddenTitle, "Vault");
assert.equal(result.cells.reduce((sum, cell) => sum + cell.actual, 0), 20);

result = new CellCollection(configs).distribute(20, "world");
assert.deepEqual(result.cells.map((cell) => cell.visible), [false, false, true, true]);
assert.equal(result.hiddenCount, 2);
assert.equal(result.rightmostHiddenTitle, "Epics");
assert.equal(result.cells[2].actual + result.cells[3].actual, 20);

result = new CellCollection(configs.slice(0, 2)).distribute(20);
assert.deepEqual(result.cells.map((cell) => cell.actual), [4, 6]);
assert.equal(result.spareColumns, 10);

result = new CellCollection(configs).distribute(14, null, { pinnedId: "epics" });
assert.deepEqual(result.cells.map((cell) => cell.visible), [false, true, false, true]);
assert.equal(result.hiddenCount, 2);

result = new CellCollection(configs).distribute(3, null, { pinnedId: "epics" });
assert.deepEqual(result.cells.map((cell) => cell.actual), [0, 3, 0, 0]);

const preferred = [
	{ id: "list", title: "List", min: 200, max: 600, preferred: 280 },
	{ id: "editor", title: "Editor", min: 200, max: 600, preferred: 500 },
];
const round = (cells) => cells.map((cell) => Math.round(cell.actual));
for (const configs of [preferred, [...preferred].reverse()]) {
	const byId = (budget) => Object.fromEntries(new CellCollection(configs).distribute(budget).cells.map((cell) => [cell.config.id, Math.round(cell.actual)]));
	assert.deepEqual(byId(600), { list: 242, editor: 358 }, "shortage: minimum plus the share of the deficit by preferred weight");
	assert.deepEqual(byId(780), { list: 280, editor: 500 }, "exact fit gives the preferred sizes");
	assert.deepEqual(byId(1000), { list: 448, editor: 552 }, "surplus: preferred plus the share by remaining room");
}
assert.deepEqual(round(new CellCollection(preferred).distribute(380).cells), [0, 380], "a budget under the minimums hides from the left as before");
assert.deepEqual(round(new CellCollection([{ id: "list", title: "List", min: 200, max: 600, preferred: 280 }, { id: "editor", title: "Editor", min: 200, max: 600 }]).distribute(780).cells), [263, 517], "a cell without a preference prefers its maximum and shares the shortage by that weight");
const anchored = new CellCollection([{ id: "menu", title: "Menu", min: 100, max: 200, preferred: 150 }, { id: "board", title: "Board", min: 300, max: 1000, preferred: 500, zoomable: true }, { id: "idea", title: "Idea", min: 200, max: 400, preferred: 300 }]).distribute(900, "board");
assert.deepEqual(anchored.cells.map((cell) => cell.visible), [false, true, true], "the zoom anchor still hides what lies left of it");
assert.deepEqual(round(anchored.cells), [0, 583, 317], "and the remaining budget follows the preferred rule");
