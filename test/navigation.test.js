import assert from "node:assert/strict";
import { Navigator, SupermaxConfigurationError, validateDestinations } from "../src/navigation.js";
import { validateSplit } from "../src/layout.js";
import { GALLERY, chrome, destinations, detail, invalidSplits, item, minViewportHeight, row } from "./fixtures/gallery.js";
import { scenario } from "./scenario.js";

function model(width = 1000, height = 500) {
	const instance = new Navigator({ destinations, root: "root", minViewportHeight, chrome });
	instance.resize({ width, height });
	return instance;
}

const titles = (instance) => instance.groups.map((group) => group.title);
const closedTitles = (result) => result.closed.map((entry) => entry.title);

function openGallery(instance) {
	const result = instance.open("gallery", { from: "root" });
	assert.equal(result.ok, true);
	return result;
}

scenario("a wide workspace opens the gallery with its defaults as one group", () => {
	const wide = model(1000);
	openGallery(wide);
	assert.ok(wide.get(detail("list", "a")), "item and detail auto-open in a row with room");
	assert.ok(wide.get(`${detail("list", "a")}/notes:a`), "defaults chain over three levels");
	assert.deepEqual(titles(wide), ["Gallery"]);
	assert.deepEqual(closedTitles(wide.back()).slice(0, 2), ["Gallery", "List"], "Back reports every closed occurrence, root first");
	assert.deepEqual(wide.state().occurrences, ["root"]);
	assert.equal(wide.nextBack(), null);
	assert.equal(wide.back().ok, false, "the end of history is a result, not an exception");
});

scenario("a default opens only when the row has room, to the pixel", () => {
	const exact = model(450);
	openGallery(exact);
	assert.ok(exact.get(detail("list", "a")), "row width 350 fits 100 + 100 + 150");
	const under = model(449);
	openGallery(under);
	assert.ok(under.get(item("list", "a")));
	assert.ok(!under.get(detail("list", "a")), "one pixel short leaves the detail as a manual choice");
});

scenario("a narrow workspace reaches the same content through more groups", () => {
	const narrow = model(150);
	openGallery(narrow);
	assert.ok(!narrow.get(item("list", "a")), "no room for the item next to the list");
	assert.equal(narrow.open("item:a", { from: row("list") }).ok, true);
	assert.deepEqual(titles(narrow), ["Gallery", "Item A"]);
	assert.equal(narrow.open("detail:a", { from: item("list", "a") }).ok, true);
	assert.deepEqual(titles(narrow), ["Gallery", "Item A", "Detail A"]);
	assert.deepEqual(closedTitles(narrow.back()), ["Detail A"]);
	assert.deepEqual(closedTitles(narrow.back()), ["Item A"]);
	assert.deepEqual(titles(narrow), ["Gallery"]);
});

scenario("Back closes groups in reverse opening order across rows", () => {
	for (const [order, expected] of [[["a", "b", "c"], ["Item C", "Item B", "Item A"]], [["a", "c", "b"], ["Item B", "Item C", "Item A"]]]) {
		const instance = model(150);
		openGallery(instance);
		const keys = ["list", "grid", "tags"];
		order.forEach((id, index) => assert.equal(instance.open(`item:${id}`, { from: row(keys[index]) }).ok, true));
		for (const title of expected) assert.deepEqual(closedTitles(instance.back()), [title]);
		for (const key of keys) assert.ok(instance.get(row(key)), `${key} survives`);
		assert.deepEqual(titles(instance), ["Gallery"]);
		assert.equal(instance.focused, row(keys[0]), "focus returns to the selector of the last closed group, which opened first");
	}
});

scenario("an explicit click on auto-opened content promotes it, and its own children stay promotable", () => {
	const wide = model(1000);
	openGallery(wide);
	const promoted = wide.open("item:a", { from: row("list") });
	assert.equal(promoted.promoted, true);
	assert.deepEqual(titles(wide), ["Gallery", "Item A"]);
	assert.equal(wide.isAuto(wide.get(detail("list", "a"))), true, "the detail moved with the item but stays automatic");
	const child = wide.open("detail:a", { from: item("list", "a") });
	assert.equal(child.promoted, true, "a later click on the moved detail promotes it again");
	assert.deepEqual(titles(wide), ["Gallery", "Item A", "Detail A"]);
	assert.deepEqual(closedTitles(wide.back()), ["Detail A", "Notes A"], "Back closes the detail with its own automatic notes");
	assert.deepEqual(closedTitles(wide.back()), ["Item A"]);
	assert.ok(wide.get(row("list")));
	assert.equal(wide.open("item:a", { from: row("list") }).ok, true);
	assert.equal(wide.open("item:a", { from: row("list") }).noop, true, "clicking manual content again changes nothing");
});

scenario("promoting a parent after its child was promoted closes both on one Back", () => {
	const wide = model(1000);
	openGallery(wide);
	wide.open("detail:a", { from: item("list", "a") });
	wide.open("item:a", { from: row("list") });
	assert.deepEqual(titles(wide), ["Gallery", "Detail A", "Item A"]);
	const closed = wide.back();
	assert.deepEqual(closedTitles(closed), ["Item A", "Detail A", "Notes A"], "the subtree closes and is reported in full");
	assert.deepEqual(titles(wide), ["Gallery"], "the orphaned detail group disappears");
});

scenario("replacing content on a slot drops the old subtree without restore", () => {
	const wide = model(1000);
	openGallery(wide);
	assert.equal(wide.open("item:b", { from: row("list") }).ok, true);
	assert.ok(!wide.get(item("list", "a")));
	assert.ok(wide.get(detail("list", "b")), "the replacement opens its own default");
	assert.deepEqual(titles(wide), ["Gallery", "Item B"]);
	assert.deepEqual(closedTitles(wide.back()), ["Item B", "Detail B"]);
	assert.ok(!wide.get(item("list", "a")), "Back returns to the selector, nothing is restored");
	assert.equal(wide.focused, row("list"));
});

scenario("rejections leave the model untouched and name their reason", () => {
	const instance = model(150);
	openGallery(instance);
	instance.open("item:a", { from: row("list") });
	const before = instance.state();
	assert.deepEqual(instance.open("detail:c", { from: item("tags", "c") }), { ok: false, reason: "source-closed", source: item("tags", "c") });
	assert.equal(instance.open("item:a", { from: GALLERY }).reason, "split-source", "rows are owned by their split");
	assert.equal(instance.open("list", { from: GALLERY }).reason, "split-source", "a row root cannot be promoted or replaced");
	assert.equal(instance.open("constructor", { from: "root" }).reason, "unknown-destination");
	assert.deepEqual(instance.state(), before);
	assert.deepEqual(instance.layout().chain.cells.map((cell) => cell.occurrence), ["root", GALLERY], "the layout still renders the same chain");
});

scenario("an impossible split is a configuration error for the developer before anything opens", () => {
	assert.equal(validateDestinations(destinations, { minViewportHeight, chrome }).ok, true, "the fixture is a possible configuration");
	const instance = model(1000, 300);
	assert.equal(validateSplit(instance, "fit", instance.root).ok, true, "40 + 260 = 300 passes");
	const report = validateDestinations({ ...destinations, ...invalidSplits }, { minViewportHeight, chrome });
	const verdict = Object.fromEntries(report.problems.map((problem) => [problem.destination, problem.validation]));
	assert.deepEqual(Object.keys(verdict).sort(), ["conflict", "crowd", "empty", "outer", "over", "twins"]);
	const failing = verdict.over.rows.find((candidate) => !candidate.ok);
	assert.deepEqual({ title: failing.title, required: failing.required, chrome: failing.chrome, supported: failing.supported }, { title: "List", required: 301, chrome: 40, supported: 300 }, "one pixel over fails");
	assert.deepEqual(verdict.conflict.rows[0].problems, ["row-min-exceeds-max", "cell-min-exceeds-max"]);
	assert.equal(verdict.empty.reason, "no-rows");
	assert.deepEqual(verdict.crowd.rows, [], "a split beyond maxRows reports an empty row list");
	assert.equal(verdict.crowd.reason, "too-many-rows");
	assert.ok(verdict.twins.rows[1].problems.includes("duplicate-row-destination"));
	assert.ok(verdict.outer.rows[0].problems.includes("split-row"));
	assert.throws(() => new Navigator({ destinations: { ...destinations, over: invalidSplits.over }, root: "root", minViewportHeight, chrome }), (error) => error instanceof SupermaxConfigurationError && /over, row 0 \(List\): exceeds-supported-height; needs 301px of 300px/.test(error.message), "the navigator refuses an impossible configuration when it is created and names the split, the row and the numbers");
	assert.throws(() => new Navigator({ destinations, root: "root" }), TypeError, "a missing minimum height is a configuration error");
});

scenario("a split cannot open inside a row, and a row cannot be a split", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	const nested = instance.open("fit", { from: row("list") });
	assert.deepEqual({ reason: nested.reason, detail: nested.validation.reason }, { reason: "invalid-rows", detail: "nested-split" });
	assert.equal(instance.open("item:nested", { from: row("list") }).ok, true, "the item opens");
	assert.ok(!instance.get(`${item("list", "nested")}/inner`), "its default split stays closed inside the row");
	assert.equal(instance.open("inner", { from: item("list", "nested") }).validation.reason, "nested-split", "the manual click gets the same verdict");
});

scenario("rows hide from the top, a window start keeps an earlier row, and the last row keeps its minimum below the supported height", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	const rows = () => instance.layout().chain.cells[1].rows.rows;
	assert.deepEqual(rows().map((candidate) => candidate.visible), [true, true, true]);
	assert.equal(rows().reduce((sum, candidate) => sum + candidate.height, 0), 500 - chrome.navbar);
	assert.ok(rows().every((candidate) => candidate.chain.width === instance.layout().chain.cells[1].width), "rows span the split width");

	instance.resize({ width: 1000, height: 300 });
	const before = instance.state();
	assert.deepEqual(rows().map((candidate) => [candidate.visible, candidate.height]), [[false, 0], [true, 130], [true, 130]], "the top row hides entirely, no tab is left");
	assert.deepEqual(instance.state(), before, "resize rewrites nothing");

	instance.focus(row("list"), { resetReveal: false });
	assert.deepEqual(rows().map((candidate) => candidate.visible), [false, true, true], "focus alone does not move the window");
	instance.startRows(GALLERY, row("list"));
	assert.deepEqual(rows().map((candidate) => [candidate.visible, candidate.height]), [[true, 130], [true, 130], [false, 0]], "a window start shows the earlier row and the last one gives way");
	instance.resize({ width: 1000, height: 500 });
	assert.deepEqual(rows().map((candidate) => candidate.visible), [true, true, true], "with room again the window fills toward the end");

	instance.resize({ width: 1000, height: 100 });
	const layout = instance.layout();
	assert.equal(layout.belowMinimum, true);
	assert.equal(layout.overflow, true);
	assert.deepEqual(rows().map((candidate) => [candidate.visible, candidate.height]), [[true, 100], [false, 0], [false, 0]], "even at a short budget the window start keeps its declared minimum");
	assert.equal(layout.contentHeight, 100);
});

scenario("a window start shifts the row window and never changes what is open", () => {
	const narrow = model(110, 500);
	openGallery(narrow);
	narrow.open("item:a", { from: row("list") });
	let chain = narrow.layout().chain.cells[1].rows.rows[0].chain;
	assert.deepEqual(chain.cells.map((cell) => cell.visible), [false, true]);
	narrow.startWindow(row("list"), row("list"));
	chain = narrow.layout().chain.cells[1].rows.rows[0].chain;
	assert.deepEqual(chain.cells.map((cell) => cell.visible), [true, false]);
	assert.deepEqual(titles(narrow), ["Gallery", "Item A"]);
	narrow.focus(row("list"), { resetReveal: false });
	assert.equal(narrow.layout().chain.cells[1].rows.rows[0].chain.revealOffset, 1, "a row focus keeps the window");
	narrow.open("detail:a", { from: item("list", "a") });
	assert.equal(narrow.layout().chain.cells[1].rows.rows[0].chain.revealOffset, 0, "an opening in the row resets the window");
	narrow.startWindow(row("list"), row("list"));
	narrow.back();
	assert.equal(narrow.layout().chain.cells[1].rows.rows[0].chain.revealOffset, 1, "closing a group keeps the window");
});

scenario("the Back target climbs the focused branch first, then earlier branches, never down", () => {
	const narrow = new Navigator({ destinations: { ...destinations, root: { ...destinations.root, keep: true } }, root: "root", minViewportHeight, chrome });
	narrow.resize({ width: 210, height: 500 });
	openGallery(narrow);
	assert.equal(narrow.backTarget(), null, "nothing above the focus is out of view, and the kept root never counts");
	narrow.open("item:a", { from: row("list") });
	narrow.bringIntoView(item("list", "a"));
	assert.deepEqual(narrow.backTarget(), { id: row("list"), title: "List" }, "the hidden parent of the focus comes first");
	narrow.bringIntoView(row("list"));
	narrow.focus(row("list"), { resetReveal: false });
	assert.equal(narrow.backTarget(), null, "the item now hidden to the right is below the focus, so Back does not go there");
	narrow.open("item:b", { from: row("grid") });
	narrow.bringIntoView(item("grid", "b"));
	narrow.focus(row("list"), { resetReveal: false });
	assert.deepEqual(narrow.backTarget(), { id: row("grid"), title: "Grid" }, "with nothing hidden above the focus the newest other branch climbs next");
	assert.deepEqual(titles(narrow), ["Gallery", "Item A", "Item B"], "finding a target closes nothing");
});

scenario("a revealed outer chain does not change which defaults open", () => {
	const instance = model(350, 500);
	openGallery(instance);
	instance.startWindow("root", "root");
	assert.equal(instance.layout().chain.cells[1].visible, false, "the gallery is hidden behind the revealed root");
	assert.equal(instance.open("item:b", { from: row("grid") }).ok, true);
	assert.ok(instance.get(detail("grid", "b")), "the row width ignores the reveal, so the detail still fits");
	assert.equal(instance.layout().chain.revealOffset, 0, "an opening resets the reveal of every chain above it");
});

scenario("only a kept cell stays, compact when space runs out; every other cell is in view or gone", () => {
	const set = {
		menu: { title: "Menu", min: 100, max: 100, keep: true, compact: { min: 20 }, defaultChild: "a" },
		a: { title: "A", min: 100, max: 100, compact: { min: 20 }, defaultChild: "b" },
		b: { title: "B", min: 100, max: 100, defaultChild: "c" },
		c: { title: "C", min: 100, max: 100 },
	};
	const instance = new Navigator({ destinations: set, root: "menu", minViewportHeight, chrome });
	instance.resize({ width: 400, height: 500 });
	assert.equal(instance.open("a", { from: "menu" }).ok, true);
	const cells = () => instance.layout().chain.cells.map((cell) => (cell.compact ? "compact" : cell.visible ? "full" : "gone"));
	assert.deepEqual(cells(), ["full", "full", "full", "full"]);
	instance.resize({ width: 320, height: 500 });
	assert.deepEqual(cells(), ["compact", "full", "full", "full"], "the kept cell takes its compact form before anything hides");
	instance.resize({ width: 220, height: 500 });
	assert.deepEqual(cells(), ["compact", "gone", "full", "full"], "a compact form without keep is never used");
	instance.resize({ width: 120, height: 500 });
	assert.deepEqual(cells(), ["compact", "gone", "gone", "full"], "the kept cell outlasts every other cell");
	instance.startWindow("menu", "menu/a");
	assert.deepEqual(cells(), ["compact", "full", "gone", "gone"], "a window start shows an earlier cell next to the kept one");
});

scenario("a dragged size is a session preference inside min and max, and rows follow the same rule", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	const chain = () => instance.layout().chain.cells[1].rows.rows[0].chain;
	instance.setSize(item("list", "a"), 180);
	assert.equal(Math.round(chain().cells[1].width), 180, "the item keeps its session size");
	assert.equal(chain().cells[1].sized, true);
	instance.setSize(item("list", "a"), 999);
	assert.equal(Math.round(chain().cells[1].width), 200, "a session size is clamped to the maximum");
	instance.setSize(item("list", "a"), 1);
	assert.equal(Math.round(chain().cells[1].width), 100, "and to the minimum");
	instance.setSize(item("list", "a"), null);
	assert.equal(chain().cells[1].sized, false, "a reset returns to the app preference");
	instance.setSize(row("list"), 150, "height");
	assert.equal(instance.layout().chain.cells[1].rows.rows[0].height, 150, "a row keeps its session height");
	const rowChainBefore = Math.round(chain().cells[0].width);
	instance.setSize(row("list"), 120, "width");
	assert.equal(instance.layout().chain.cells[1].rows.rows[0].height, 150, "a row root's width and height are separate session sizes");
	assert.equal(Math.round(chain().cells[0].width), 120, "the width applies to the row root as the first cell of its chain");
	instance.setSize(row("list"), null, "width");
	assert.equal(Math.round(chain().cells[0].width), rowChainBefore);
	const snapshot = instance.snapshot();
	instance.setSize(row("list"), null, "height");
	instance.restore(snapshot);
	assert.equal(instance.layout().chain.cells[1].rows.rows[0].height, 150, "session sizes are part of the snapshot");
	instance.setSize(item("list", "a"), 150, "width");
	instance.open("item:b", { from: `${item("list", "a")}/detail:a` });
	instance.setSize(item("list", "a"), null, "width");
	instance.resize({ width: 1000, height: 500 });
	instance.back();
	instance.open("item:b", { from: row("list") });
	instance.setSize(item("list", "b"), 190);
	instance.back();
	assert.equal(instance.sizeOf(item("list", "b"), "width"), null, "closing drops the size of a closed cell");
	assert.throws(() => instance.setSize(item("list", "a"), "abc"), TypeError, "a size that is not a positive number is refused");
	instance.open("item:a", { from: row("list") });
	instance.setSize(item("list", "a"), 190, "width");
	instance.resize({ width: 1000, height: 500 });
	assert.equal(Math.round(chain().cells[1].width), 190, "while the chain has room for it a session size is exact");
	instance.resize({ width: 600, height: 500 });
	const squeezed = chain().cells.find((cell) => cell.occurrence === item("list", "a"));
	assert.equal(squeezed.visible && !squeezed.compact, true, "when the frame shrinks the sized cell stays in view");
	assert.ok(squeezed.width < 190 && squeezed.width >= 100, "and gives up width like a preference instead of pushing others out");
	assert.equal(chain().cells.every((cell) => cell.visible), true, "nothing hides to honour a session size");
	instance.resize({ width: 1000, height: 500 });
	instance.setSize(item("list", "a"), null, "width");
});

scenario("a hinted destination opens provisionally and completes when its definition arrives", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	assert.equal(instance.open("remote:a", { from: item("list", "a") }).reason, "unknown-destination", "without a hint an unknown id is refused");
	const hinted = instance.open("remote:a", { from: item("list", "a"), hint: { title: "Remote A", min: 120, max: 240 } });
	assert.equal(hinted.ok, true);
	assert.equal(instance.definitionOf("remote:a").provisional, true);
	assert.equal(instance.get(`${item("list", "a")}/remote:a`).title, "Remote A");
	assert.deepEqual(titles(instance), ["Gallery", "Remote A"]);
	assert.deepEqual([instance.layout().chain.cells[1].rows.rows[0].chain.cells[2].min, instance.layout().chain.cells[1].rows.rows[0].chain.cells[2].max], [120, 240], "the hint sizes the placeholder cell");
	const group = instance.groupOf(instance.get(`${item("list", "a")}/remote:a`)).id;
	instance.open("item:b", { from: row("grid") });
	const result = instance.define("remote:a", { title: "Remote A!", min: 150, max: 260, defaultChild: "detail:b" });
	assert.deepEqual(result.completed, [`${item("list", "a")}/remote:a`]);
	assert.equal(instance.get(`${item("list", "a")}/remote:a`).title, "Remote A!", "the definition updates the open occurrence in place");
	assert.equal([...instance.occurrences.values()].filter((occurrence) => occurrence.destination === "remote:a").length, 1, "no second occurrence for the same opening");
	const late = instance.get(`${item("list", "a")}/remote:a/detail:b`);
	assert.ok(late, "the late default opened");
	assert.equal(late.group, group, "and joined the group that started the navigation, not the newer one");
	assert.deepEqual(titles(instance), ["Gallery", "Remote A!", "Item B"], "Back order is unchanged by the late arrival");
	assert.equal(instance.layout().chain.cells[1].rows.rows[0].chain.cells[2].min, 150, "a hint mismatch is repaired in place");

	const closedByUser = model(1000, 500);
	openGallery(closedByUser);
	closedByUser.open("remote:p", { from: item("list", "a"), hint: { title: "Remote P", min: 100, max: 200, defaultChild: "remote:q" } });
	closedByUser.define("remote:p", { title: "Remote P", min: 100, max: 200, defaultChild: "remote:q" });
	assert.equal(closedByUser.get(`${item("list", "a")}/remote:p`).awaiting, "remote:q", "a parent remembers the default it could not open yet");
	closedByUser.open("detail:b", { from: `${item("list", "a")}/remote:p` });
	closedByUser.back();
	assert.equal(closedByUser.get(`${item("list", "a")}/remote:p`).children[0], undefined, "the user closed what was open under the parent");
	closedByUser.define("remote:q", { title: "Remote Q", min: 100, max: 200 });
	assert.equal(closedByUser.get(`${item("list", "a")}/remote:p`).children[0], undefined, "a definition arriving after the user chose and closed opens nothing");

	const lateSplit = model(1000, 500);
	openGallery(lateSplit);
	lateSplit.open("remote:s", { from: item("list", "a"), hint: { title: "Remote S", min: 100, max: 200 } });
	const invalid = lateSplit.define("remote:s", { title: "Remote S", min: 100, max: 200, rows: [{ destination: "detail:b", minHeight: 400, maxHeight: 500 }] });
	assert.deepEqual([invalid.rejected[0]?.result.reason, invalid.rejected[0]?.result.validation.reason], ["invalid-rows", "nested-split"], "a definition with rows is validated when it completes a cell, here inside a row, with the same verdict shape as a refused open");
	assert.ok(!lateSplit.get(`${item("list", "a")}/remote:s`), "and a refused split closes the cell it was meant to complete");
	assert.deepEqual(titles(lateSplit), ["Gallery"], "leaving the earlier history intact");
	lateSplit.open("remote:t", { from: "root", hint: { title: "Remote T", min: 300, max: 600 } });
	const tooTall = lateSplit.define("remote:t", { title: "Remote T", min: 300, max: 600, rows: [{ destination: "list", minHeight: 400, maxHeight: 500 }] });
	assert.equal(tooTall.rejected[0]?.result.validation.reason, "invalid-rows", "a split at the root chain is validated against the minimum height");
	assert.ok(!lateSplit.get("root/remote:t"));
	lateSplit.open("remote:u", { from: "root", hint: { title: "Remote U", min: 300, max: 600 } });
	const valid = lateSplit.define("remote:u", { title: "Remote U", min: 300, max: 600, rows: [{ destination: "list", minHeight: 100, maxHeight: 300 }, { destination: "tags", minHeight: 100, maxHeight: 300 }] });
	assert.deepEqual(valid.rejected, []);
	assert.deepEqual(lateSplit.get("root/remote:u").children, ["root/remote:u/list", "root/remote:u/tags"], "a valid late split opens its rows in place");

	const gone = model(1000, 500);
	openGallery(gone);
	gone.open("remote:b", { from: item("tags", "a"), hint: { title: "Remote B", min: 100, max: 200 } });
	gone.back();
	const after = gone.define("remote:b", { title: "Remote B", min: 100, max: 200, defaultChild: "detail:c" });
	assert.deepEqual(after.completed, [], "a definition arriving after Back opens nothing");
	assert.ok(!gone.get(`${item("tags", "a")}/remote:b`), "the closed group does not return");

	const twoRows = model(1000, 500);
	openGallery(twoRows);
	twoRows.open("remote:e", { from: item("list", "a"), hint: { title: "Remote E", min: 100, max: 200 } });
	twoRows.open("remote:e", { from: item("tags", "a"), hint: { title: "Remote E", min: 100, max: 200 } });
	const both = twoRows.define("remote:e", { title: "Remote E", min: 100, max: 200 });
	assert.deepEqual(both.completed.sort(), [`${item("list", "a")}/remote:e`, `${item("tags", "a")}/remote:e`].sort(), "one definition completes the same destination in every row");

	const chosen = model(1000, 500);
	openGallery(chosen);
	chosen.open("remote:c", { from: item("tags", "a"), hint: { title: "Remote C", min: 100, max: 200 } });
	chosen.open("detail:b", { from: `${item("tags", "a")}/remote:c` });
	chosen.define("remote:c", { title: "Remote C", min: 100, max: 200, defaultChild: "detail:c" });
	assert.equal(chosen.child(chosen.get(`${item("tags", "a")}/remote:c`)).destination, "detail:b", "an explicit selection beats a late default");

	const garbage = model(1000, 500);
	openGallery(garbage);
	assert.equal(garbage.open("remote:g", { from: item("list", "a"), hint: { title: "", min: Number.NaN, max: 0, preferred: -5 } }).ok, true, "a hint with unusable numbers still opens");
	assert.deepEqual([garbage.definitionOf("remote:g").title, garbage.definitionOf("remote:g").min, garbage.definitionOf("remote:g").max, garbage.definitionOf("remote:g").preferred], ["remote:g", 200, 320, undefined], "with the generic cell in place of the garbage");
	assert.equal(garbage.open("__proto__", { from: item("list", "a"), hint: { title: "Proto" } }).ok, true);
	assert.equal(garbage.definitionOf("constructor"), null, "a registry entry never comes from the prototype");
	assert.equal(garbage.open("remote:h", { from: "root/gallery", hint: { title: "Nope" } }).reason, "split-source", "a refused opening registers nothing");
	assert.equal(garbage.definitionOf("remote:h"), null);

});

scenario("default chains are finite and do not repeat a destination already in the chain", () => {
	const loopy = new Navigator({ destinations: { ...destinations, "loop:a": { title: "Loop A", min: 100, max: 200, defaultChild: "loop:b" }, "loop:b": { title: "Loop B", min: 100, max: 200, defaultChild: "loop:a" } }, root: "root", minViewportHeight, chrome });
	loopy.resize({ width: 2000, height: 500 });
	loopy.open("gallery", { from: "root" });
	loopy.open("loop:a", { from: item("list", "a") });
	const chain = loopy.layout().chain.cells[1].rows.rows[0].chain.cells.map((cell) => cell.title);
	assert.deepEqual(chain.slice(-2), ["Loop A", "Loop B"], "the chain stops where a destination would repeat");
});

scenario("the focus title carries its ancestors as context", () => {
	const wide = model(1000);
	openGallery(wide);
	assert.deepEqual(wide.focusInfo(), { occurrence: GALLERY, title: "Gallery", trail: [{ occurrence: "root", title: "Root" }] });
	wide.open("item:c", { from: row("tags") });
	assert.deepEqual(wide.focusInfo().trail.map((step) => step.title), ["Root", "Gallery", "Tags"]);
	assert.deepEqual(wide.child(wide.get(row("tags")))?.destination, "item:c");
});

scenario("a snapshot restores the exact state, including groups and focus", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	instance.open("item:b", { from: row("grid") });
	instance.resize({ width: 300, height: 500 });
	const snapshot = structuredClone(instance.snapshot());
	const expected = instance.state();
	instance.reset();
	assert.deepEqual(instance.state(), { occurrences: ["root"], groups: [], focused: "root" });
	assert.equal(instance.restore(snapshot), true);
	assert.deepEqual(instance.state(), expected);
	assert.deepEqual(closedTitles(instance.back()), ["Item B", "Detail B"], "history continues from the restored state");
	const stale = structuredClone(snapshot);
	stale.occurrences[1].destination = "renamed";
	assert.equal(instance.restore(stale), false, "a snapshot naming an unknown destination is refused");
	assert.equal(instance.back().title, "Gallery", "the model is unchanged by the refused restore");
	assert.deepEqual(instance.state().occurrences, ["root"]);
});

console.log("Navigation scenarios passed");
