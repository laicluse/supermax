import assert from "node:assert/strict";
import { CellCollection, CellProxy } from "../src/cell-collection.js";

const packageApi = await import("@laicluse/supermax");
assert.equal(packageApi.CellCollection, CellCollection);
assert.equal(packageApi.CellProxy, CellProxy);
assert.equal(typeof packageApi.CellStrip, "function");
assert.equal(typeof packageApi.Navigator, "function");
assert.equal(typeof packageApi.Workspace, "function");
assert.equal(typeof packageApi.validateSplit, "function");
assert.equal(globalThis.Supermax.Navigator, packageApi.Navigator);
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
