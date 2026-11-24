import assert from "node:assert/strict";
import { test } from "node:test";
import { Navigator } from "../src/navigation.js";

function shell(width) {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 100, preferred: 100, max: 100, overflow: { mode: "keep" } },
		work: { title: "Work", min: 400, preferred: 600, max: "*" },
		picks: { title: "Picks", min: 150, preferred: 150, max: 150 },
	} });
	model.resize({ width, height: 600 });
	model.sync(["menu", "work"], { ifRoom: ["picks"] });
	return model;
}

const open = (model) => [...model.occurrences.keys()];
const full = (model, id) => model.layout().cells.get(id)?.full ?? false;

test("an optional cell that opened because there was room closes when a resize makes it hide the work", () => {
	const model = shell(1000);
	assert.deepEqual(open(model), ["menu", "menu/work", "menu/work/picks"], "the optional cell opened");
	model.resize({ width: 600, height: 600 });
	assert.deepEqual(open(model), ["menu", "menu/work"], "the optional cell closed");
	assert.equal(full(model, "menu/work"), true, "the work stays in view");
});

test("it stays while the resized workspace still shows everything beside it", () => {
	const model = shell(1000);
	model.resize({ width: 900, height: 600 });
	assert.deepEqual(open(model), ["menu", "menu/work", "menu/work/picks"]);
	assert.equal(full(model, "menu/work"), true);
});

test("a cell the user opened themselves is never closed by a resize", () => {
	const model = shell(1000);
	model.open("picks", { from: "menu/work" });
	model.resize({ width: 600, height: 600 });
	assert.deepEqual(open(model), ["menu", "menu/work", "menu/work/picks"]);
});

test("a cell the user opened from an optional cell keeps that whole branch", () => {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 100, preferred: 100, max: 100, overflow: { mode: "keep" } },
		work: { title: "Work", min: 400, preferred: 600, max: "*" },
		picks: { title: "Picks", min: 150, preferred: 150, max: 150 },
		detail: { title: "Detail", min: 150, preferred: 150, max: 150 },
	} });
	model.resize({ width: 1200, height: 600 });
	model.sync(["menu", "work"], { ifRoom: ["picks"] });
	model.open("detail", { from: "menu/work/picks" });
	model.resize({ width: 600, height: 600 });
	assert.deepEqual(open(model), ["menu", "menu/work", "menu/work/picks", "menu/work/picks/detail"]);
});

test("of two optional cells only the last one closes when that is enough", () => {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 100, preferred: 100, max: 100, overflow: { mode: "keep" } },
		work: { title: "Work", min: 400, preferred: 600, max: "*" },
		picks: { title: "Picks", min: 150, preferred: 150, max: 150 },
		notes: { title: "Notes", min: 150, preferred: 150, max: 150 },
	} });
	model.resize({ width: 1200, height: 600 });
	model.sync(["menu", "work"], { ifRoom: ["picks", "notes"] });
	assert.equal(open(model).length, 4, "both opened");
	model.resize({ width: 900, height: 600 });
	assert.deepEqual(open(model), ["menu", "menu/work", "menu/work/picks"], "the first optional cell stays");
	assert.equal(full(model, "menu/work"), true);
});

test("cells that opened together close together", () => {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 100, preferred: 100, max: 100, overflow: { mode: "keep" } },
		work: { title: "Work", min: 400, preferred: 600, max: "*" },
		picks: { title: "Picks", min: 150, preferred: 150, max: 150 },
		notes: { title: "Notes", min: 150, preferred: 150, max: 150 },
	} });
	model.resize({ width: 1200, height: 600 });
	model.sync(["menu", "work"], { ifRoom: [["picks", "notes"]] });
	model.resize({ width: 900, height: 600 });
	assert.deepEqual(open(model), ["menu", "menu/work"]);
});

test("a resize leaves a zoomed optional cell alone", () => {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 100, preferred: 100, max: 100, overflow: { mode: "keep" } },
		work: { title: "Work", min: 400, preferred: 600, max: "*" },
		picks: { title: "Picks", min: 150, preferred: 300, max: "*", zoomable: true },
	} });
	model.resize({ width: 1200, height: 600 });
	model.sync(["menu", "work"], { ifRoom: ["picks"] });
	assert.equal(model.zoom("menu/work/picks"), true);
	model.resize({ width: 1200, height: 599 });
	assert.deepEqual(open(model), ["menu", "menu/work", "menu/work/picks"]);
	assert.equal(model.zoomed, "menu/work/picks");
});

test("an optional split closes with the rows it opened", () => {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 100, preferred: 100, max: 100, overflow: { mode: "keep" } },
		work: { title: "Work", min: 400, preferred: 600, max: "*" },
		card: { title: "Card", rows: [
			{ destination: "top", minHeight: 100, maxHeight: 200, preferredHeight: 150 },
			{ destination: "bottom", minHeight: 100, maxHeight: "*", preferredHeight: 300 },
		] },
		top: { title: "Top", min: 200, preferred: 200, max: 200 },
		bottom: { title: "Bottom", min: 200, preferred: 200, max: 200 },
	} });
	model.resize({ width: 1200, height: 600 });
	model.sync(["menu", "work"], { ifRoom: ["card"] });
	assert.ok(open(model).includes("menu/work/card"), "the split opened");
	model.resize({ width: 600, height: 600 });
	assert.deepEqual(open(model), ["menu", "menu/work"]);
});

test("the rest of an entry closes on its own once the user took over its first cell", () => {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 100, preferred: 100, max: 100, overflow: { mode: "keep" } },
		work: { title: "Work", min: 400, preferred: 600, max: "*" },
		picks: { title: "Picks", min: 150, preferred: 150, max: 150 },
		notes: { title: "Notes", min: 150, preferred: 150, max: 150 },
	} });
	model.resize({ width: 1200, height: 600 });
	model.sync(["menu", "work"], { ifRoom: [["picks", "notes"]] });
	model.sync(["menu", "work", "picks"], { ifRoom: ["notes"] });
	model.resize({ width: 900, height: 600 });
	assert.deepEqual(open(model), ["menu", "menu/work", "menu/work/picks"]);
});

test("an optional cell beside the root gives its room back too", () => {
	const model = new Navigator({ root: "work", minViewportHeight: 300, destinations: {
		work: { title: "Work", min: 400, preferred: 600, max: "*" },
		picks: { title: "Picks", min: 150, preferred: 150, max: 150 },
	} });
	model.resize({ width: 1000, height: 600 });
	model.sync(["work"], { ifRoom: ["picks"] });
	assert.deepEqual(open(model), ["work", "work/picks"]);
	model.resize({ width: 500, height: 600 });
	assert.deepEqual(open(model), ["work"]);
});

test("an optional split and the detail of its row close as the one entry they opened as", () => {
	const model = new Navigator({ root: "menu", minViewportHeight: 300, destinations: {
		menu: { title: "Menu", min: 100, preferred: 100, max: 100, overflow: { mode: "keep" } },
		work: { title: "Work", min: 400, preferred: 600, max: "*" },
		card: { title: "Card", rows: [
			{ destination: "top", minHeight: 100, maxHeight: 200, preferredHeight: 150 },
			{ destination: "bottom", minHeight: 100, maxHeight: "*", preferredHeight: 300 },
		] },
		top: { title: "Top", min: 150, preferred: 150, max: 150 },
		bottom: { title: "Bottom", min: 150, preferred: 150, max: 150 },
		detail: { title: "Detail", min: 150, preferred: 150, max: 150 },
	} });
	model.resize({ width: 1400, height: 600 });
	model.sync(["menu", "work"], { ifRoom: [["card", "top", "detail"]] });
	assert.ok(open(model).includes("menu/work/card/top/detail"), "the entry opened whole");
	model.resize({ width: 1000, height: 600 });
	assert.ok(!open(model).includes("menu/work/card") || open(model).includes("menu/work/card/top/detail"), "the split does not stay behind without its detail");
});

test("a resize that closes nothing leaves the open occurrences as they were", () => {
	const model = shell(1000);
	const work = model.get("menu/work");
	const picks = model.get("menu/work/picks");
	model.resize({ width: 900, height: 600 });
	assert.equal(model.get("menu/work"), work);
	assert.equal(model.get("menu/work/picks"), picks);
	assert.deepEqual(work.children.filter(Boolean), ["menu/work/picks"]);
});

test("an optional cell the user then chose stays through a resize, also beside a root split", () => {
	const model = new Navigator({ root: "card", minViewportHeight: 300, destinations: {
		card: { title: "Card", rows: [
			{ destination: "top", minHeight: 100, maxHeight: 200, preferredHeight: 150 },
			{ destination: "bottom", minHeight: 100, maxHeight: "*", preferredHeight: 300 },
		] },
		top: { title: "Top", min: 400, preferred: 600, max: "*" },
		bottom: { title: "Bottom", min: 400, preferred: 600, max: "*" },
		picks: { title: "Picks", min: 150, preferred: 150, max: 150 },
	} });
	model.resize({ width: 1000, height: 600 });
	model.sync(["card", "top"], { ifRoom: ["picks"] });
	assert.ok(open(model).includes("card/top/picks"), "the optional cell opened");
	model.open("picks", { from: "card/top" });
	model.resize({ width: 500, height: 600 });
	assert.ok(open(model).includes("card/top/picks"), "the cell the user chose stays");
});
