import assert from "node:assert/strict";
import { CellCollection, CellProxy, DEFAULT_CURVE, linearCurve } from "../src/cell-collection.js";

const packageApi = await import("@laicluse/supermax");
assert.equal(packageApi.CellCollection, CellCollection);
assert.equal(packageApi.CellProxy, CellProxy);
assert.equal(packageApi.DEFAULT_CURVE, DEFAULT_CURVE);
assert.equal(packageApi.linearCurve, linearCurve);
assert.equal(typeof packageApi.CellStrip, "function");
assert.equal(typeof packageApi.Navigator, "function");
assert.equal(typeof packageApi.Workspace, "function");
assert.equal(typeof packageApi.validateSplit, "function");
assert.equal(typeof packageApi.validateDestinations, "function");
assert.equal(typeof packageApi.SupermaxConfigurationError, "function");
assert.equal(typeof packageApi.DEFAULT_STRINGS.up, "function");
assert.equal(typeof packageApi.DEFAULT_RENDERER.frustum, "function");
assert.equal(typeof packageApi.DEFAULT_RENDERER.notice, "function");
assert.equal(globalThis.Supermax, undefined, "the package leaves no global behind");

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

const roomy = [{ id: "list", title: "List", min: 4, max: 10 }, { id: "detail", title: "Detail", min: 4, max: 5 }];
assert.deepEqual(new CellCollection(roomy).distribute(20).cells.map((cell) => cell.actual), [10, 5], "without an elastic cell every cell stays at its max and the canvas shows");
const elastic = [{ ...roomy[0], elastic: true }, { ...roomy[1], elastic: true }];
assert.deepEqual(new CellCollection([roomy[0], elastic[1]]).distribute(20).cells.map((cell) => cell.actual), [10, 10], "an elastic cell takes what is left, also when it is the smaller one");
assert.deepEqual(new CellCollection(elastic).distribute(20).cells.map((cell) => cell.actual), [10, 10], "of two elastic cells the newest in view takes it");
assert.deepEqual(new CellCollection([elastic[0], roomy[1]]).distribute(12).cells.map((cell) => cell.actual), [7, 5], "below every max an elastic cell shares like any other, its max being its preference");

const kept = configs.map((config) => (config.id === "vault" ? { ...config, keep: true } : config));
result = new CellCollection(kept).distribute(19);
assert.deepEqual(result.cells.map((cell) => cell.visible), [true, false, true, true], "a kept cell stays while its right neighbour hides");
assert.equal(result.hiddenCount, 1);
result = new CellCollection(kept).distribute(9);
assert.deepEqual(result.cells.map((cell) => Math.round(cell.actual)), [3, 0, 0, 8], "when the kept cell and the newest cell exceed the space the newest keeps its minimum, as a row does below the supported height");

const preferred = [
	{ id: "list", title: "List", min: 200, max: 600, preferred: 280 },
	{ id: "editor", title: "Editor", min: 200, max: 600, preferred: 500 },
];
const round = (cells) => cells.map((cell) => Math.round(cell.actual));
const byId = (configs, budget, curve = DEFAULT_CURVE, fit = "preferred") => Object.fromEntries(new CellCollection(configs, curve, fit).distribute(budget).cells.map((cell) => [cell.config.id, Math.round(cell.actual)]));
assert.deepEqual(byId(preferred, 600), { list: 0, editor: 600 }, "a budget under the sum of the preferences hides from the left: a preference is the room a cell wants to be worth showing");
const held = [{ ...preferred[0], keep: true }, preferred[1]];
assert.deepEqual(byId(held, 600), { list: 250, editor: 350 }, "a cell that must stay shares the room above the minima by place, under its preference if the curve says so");
assert.deepEqual(byId(preferred, 780), { list: 295, editor: 485 }, "the preferences fit, yet the room goes out by place, not by preference");
assert.deepEqual(byId(preferred, 1000), { list: 400, editor: 600 }, "a cell that reaches its max stops there and the other takes what it left");
assert.deepEqual(byId([{ ...preferred[1], keep: true }, preferred[0]], 600), { editor: 250, list: 350 }, "the later cell gets the larger share, whichever it is");
assert.deepEqual(round(new CellCollection(preferred).distribute(380).cells), [0, 380], "a budget under the minimums hides from the left as well");
assert.deepEqual(byId(preferred, 600, DEFAULT_CURVE, "min"), { list: 250, editor: 350 }, "fitting by minimum keeps every cell whose minimum fits, as split rows do");
assert.deepEqual(byId([preferred[0], { id: "editor", title: "Editor", min: 200, max: 600 }], 780), { list: 295, editor: 485 }, "a cell without a preference asks for its minimum and shares like any other");
assert.deepEqual(byId([{ id: "a", title: "A", min: 100, max: 400 }, { id: "b", title: "B", min: 100, max: 400, preferred: 300 }, { id: "c", title: "C", min: 100, max: 400, ask: 350 }], 700), { a: 0, b: 300, c: 400 }, "a split asks what its widest row asks, and hides for it like any cell");
assert.throws(() => new CellCollection(preferred, DEFAULT_CURVE, "preferred-or-else"), TypeError);
assert.deepEqual(byId([{ id: "a", title: "A", min: 100, max: 200 }, { id: "b", title: "B", min: 100, max: 1000, preferred: 900 }], 500), { a: 175, b: 325 }, "when what cannot hide asks more than there is, hiding for preferences gains nothing and only the minima decide");

const stretch = [{ id: "a", title: "A", min: 120, max: 2000 }, { id: "b", title: "B", min: 40, max: 2000 }, { id: "c", title: "C", min: 340, max: 2000 }];
const along = (curve) => new CellCollection(stretch, curve).distribute(800).cells.map((cell) => Math.round(cell.actual * 10) / 10);
assert.deepEqual(along(linearCurve(0)), [192, 64, 544], "a flat curve shares by width alone");
assert.deepEqual(along(linearCurve(1)), [137.3, 53.4, 609.3], "a full linear curve weighs each pixel by its place, the first pixel getting nothing");
assert.deepEqual(along(linearCurve(-1)), [246.7, 74.6, 478.7], "a negative steepness favours the start of the chain");
assert.deepEqual(along(DEFAULT_CURVE), along(linearCurve(1)), "the default is a linear curve of steepness 1");
assert.deepEqual(along(DEFAULT_CURVE), along(DEFAULT_CURVE), "the same bounds and budget give the same widths every time");
assert.throws(() => linearCurve(1.5), TypeError);
assert.throws(() => new CellCollection(stretch, "linear"), TypeError);
const anchored = new CellCollection([{ id: "menu", title: "Menu", min: 100, max: 200, preferred: 150 }, { id: "board", title: "Board", min: 300, max: 1000, preferred: 500, zoomable: true }, { id: "idea", title: "Idea", min: 200, max: 400, preferred: 300 }]).distribute(900, "board");
assert.deepEqual(anchored.cells.map((cell) => cell.visible), [false, true, true], "the zoom anchor still hides what lies left of it");
assert.deepEqual(round(anchored.cells), [0, 500, 400], "and the remaining room follows the curve, the idea stopping at its max");
