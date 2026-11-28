import assert from "node:assert/strict";
import { test } from "node:test";
import { Navigator } from "../src/navigation.js";

const KEEP = { mode: "keep", when: { minWorkspaceWidth: 600 } };
const destinations = () => ({
	rail: { title: "Rail", min: 84, preferred: 84, max: 84, overflow: KEEP },
	menu: { title: "Menu", min: 48, preferred: 184, max: 240, overflow: KEEP },
	day: { title: "Day", min: 160, preferred: 184, max: 360 },
	record: { title: "Record", min: 264, preferred: 264, max: 264, overflow: KEEP, zoomable: true },
	card: { title: "Card", overflow: KEEP, rows: [{ destination: "chart", minHeight: 28, preferredHeight: 300, maxHeight: "50%" }, { destination: "work", minHeight: 200, preferredHeight: 520, maxHeight: "*" }] },
	chart: { title: "Chart", min: 380, preferred: 620, max: "*" },
	work: { title: "Work", min: 520, preferred: 860, max: "*" },
	picks: { title: "Picks", min: 132, preferred: 176, max: 220, placement: "beside-split" },
});

const PICKS = "rail/menu/day/record/card/work/picks";

function shell(width) {
	const model = new Navigator({ root: "rail", minViewportHeight: 300, destinations: destinations() });
	model.resize({ width, height: 900 });
	assert.equal(model.sync(["rail", "menu", "day", "record", "card", "work", "picks"]).ok, true);
	return model;
}

for (const width of [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]) {
	test(`zooming a cell at ${width}px keeps the cell after it that showed before`, () => {
		const model = shell(width);
		assert.equal(model.layout().cells.get(PICKS).full, true, "the trailing cell shows before the zoom");
		assert.equal(model.zoom("rail/menu/day/record"), true);
		const layout = model.layout();
		for (const hidden of ["rail", "rail/menu", "rail/menu/day"]) {
			assert.equal(layout.cells.get(hidden).full, false, `${hidden} is out of view`);
			assert.equal(layout.cells.get(hidden).folded, false, `${hidden} leaves no fold`);
		}
		assert.equal(layout.cells.get(PICKS).full, true, "the trailing cell still shows");
	});
}
