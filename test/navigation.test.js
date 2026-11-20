import assert from "node:assert/strict";
import { Navigator } from "../src/navigation.js";
import { validateSplit } from "../src/layout.js";
import { GALLERY, chrome, destinations, detail, item, minViewportHeight, row } from "./fixtures/gallery.js";
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

scenario("a split is validated against the declared minimum height before it opens", () => {
	const instance = model(1000, 300);
	assert.equal(validateSplit(instance, "fit", instance.root).ok, true, "40 + 20 + 240 = 300 passes");
	const rejected = instance.open("over", { from: "root" });
	assert.equal(rejected.reason, "invalid-rows");
	const failing = rejected.validation.rows.find((candidate) => !candidate.ok);
	assert.deepEqual({ title: failing.title, required: failing.required, chrome: failing.chrome, supported: failing.supported }, { title: "List", required: 301, chrome: 60, supported: 300 });
	assert.deepEqual(instance.state().occurrences, ["root"]);
	openGallery(instance);
	const before = instance.state();
	assert.equal(instance.open("over", { from: "root" }).ok, false);
	assert.deepEqual(instance.state(), before, "no branch loss after a rejection");
	assert.deepEqual(validateSplit(instance, "conflict", instance.root).rows[0].problems, ["row-min-exceeds-max", "cell-min-exceeds-max"]);
	assert.equal(validateSplit(instance, "empty", instance.root).reason, "no-rows");
	assert.deepEqual(validateSplit(instance, "crowd", instance.root).rows, [], "a split beyond maxRows reports an empty row list");
	assert.equal(validateSplit(instance, "crowd", instance.root).reason, "too-many-rows");
	assert.ok(validateSplit(instance, "twins", instance.root).rows[1].problems.includes("duplicate-row-destination"));
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
	assert.ok(validateSplit(instance, "outer", instance.root).rows[0].problems.includes("split-row"));
	assert.equal(instance.open("outer", { from: "root" }).reason, "invalid-rows");
});

scenario("rows collapse from the top and the focused row keeps its minimum below the supported height", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	let split = instance.layout().chain.cells[1];
	assert.deepEqual(split.rows.rows.map((candidate) => candidate.collapsed), [false, false, false]);
	assert.equal(split.rows.rows.reduce((sum, candidate) => sum + candidate.height, 0), 500 - chrome.navbar);
	assert.ok(split.rows.rows.every((candidate) => candidate.chain.width === split.width), "rows span the split width");

	instance.resize({ width: 1000, height: 300 });
	const before = instance.state();
	split = instance.layout().chain.cells[1];
	assert.deepEqual(split.rows.rows.map((candidate) => candidate.collapsed), [true, false, false], "the top row collapses first");
	assert.deepEqual(split.rows.rows.map((candidate) => candidate.height), [20, 120, 120]);
	assert.deepEqual(instance.state(), before, "resize rewrites nothing");

	instance.focus(row("list"));
	split = instance.layout().chain.cells[1];
	assert.deepEqual(split.rows.rows.map((candidate) => candidate.collapsed), [false, true, false], "the focused row stays open and the next one gives way");

	instance.resize({ width: 1000, height: 100 });
	const layout = instance.layout();
	split = layout.chain.cells[1];
	assert.equal(layout.belowMinimum, true);
	assert.equal(layout.overflow, true);
	assert.deepEqual(split.rows.rows.map((candidate) => candidate.collapsed), [false, true, true], "even at a zero budget the focused row stays open");
	assert.equal(split.rows.rows[0].height, 100, "at its declared minimum");
	assert.equal(layout.contentHeight, 140, "the content height counts the open row and two tabs");
});

scenario("reveal shifts the row window and never changes what is open", () => {
	const narrow = model(110, 500);
	openGallery(narrow);
	narrow.open("item:a", { from: row("list") });
	let chain = narrow.layout().chain.cells[1].rows.rows[0].chain;
	assert.deepEqual(chain.cells.map((cell) => cell.visible), [false, true]);
	assert.equal(chain.hiddenLeft, "List");
	narrow.reveal(row("list"), 1);
	chain = narrow.layout().chain.cells[1].rows.rows[0].chain;
	assert.deepEqual(chain.cells.map((cell) => cell.visible), [true, false]);
	assert.equal(chain.hiddenRight, "Item A");
	assert.deepEqual(titles(narrow), ["Gallery", "Item A"]);
	narrow.focus(row("list"), { resetReveal: false });
	assert.equal(narrow.layout().chain.cells[1].rows.rows[0].chain.revealOffset, 1, "a row focus keeps the window");
	narrow.open("detail:a", { from: item("list", "a") });
	assert.equal(narrow.layout().chain.cells[1].rows.rows[0].chain.revealOffset, 0, "an opening in the row resets the window");
});

scenario("a revealed outer chain does not change which defaults open", () => {
	const instance = model(450, 500);
	openGallery(instance);
	instance.reveal("root", 1);
	assert.equal(instance.layout().chain.cells[1].visible, false, "the gallery is hidden behind the revealed root");
	assert.equal(instance.open("item:b", { from: row("grid") }).ok, true);
	assert.ok(instance.get(detail("grid", "b")), "the row width ignores the reveal, so the detail still fits");
	assert.equal(instance.layout().chain.revealOffset, 0, "an opening resets the reveal of every chain above it");
});

scenario("cells with a compact form go compact from the left before anything hides, up to the cap", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	const chain = () => instance.layout().chain.cells[1].rows.rows[0].chain;
	instance.resize({ width: 520, height: 500 });
	let cells = chain().cells;
	assert.deepEqual(cells.map((cell) => [cell.compact, cell.visible]), [[true, true], [false, true], [false, true], [false, true]], "one compact cell is enough in a 420 row");
	assert.deepEqual(cells.map((cell) => cell.collapsible), [true, true, true, false], "the last cell is never collapsible");
	instance.resize({ width: 440, height: 500 });
	cells = chain().cells;
	assert.deepEqual(cells.map((cell) => [cell.compact, cell.visible, Math.round(cell.width)]), [[true, true, 20], [true, true, 20], [false, true, 150], [false, true, 150]], "list and item go compact so detail and notes keep their room in a 340 row");
	instance.resize({ width: 280, height: 500 });
	cells = chain().cells;
	assert.deepEqual(cells.map((cell) => [cell.compact, cell.visible]), [[false, false], [true, true], [false, true], [false, true]], "beyond the cap of two the oldest cell hides instead of a third compact");
	assert.equal(chain().hiddenLeft, "List");
	instance.resize({ width: 1000, height: 500 });
	assert.ok(chain().cells.every((cell) => !cell.compact), "with room nothing is compact");
	instance.collapse(item("list", "a"), true);
	cells = chain().cells;
	assert.deepEqual(cells.map((cell) => cell.compact), [false, true, false, false], "a user collapse goes compact regardless of room");
	assert.deepEqual(titles(instance), ["Gallery"], "collapsing is not a navigation group");
	const snapshot = instance.snapshot();
	instance.collapse(item("list", "a"), false);
	assert.ok(chain().cells.every((cell) => !cell.compact));
	instance.restore(snapshot);
	assert.equal(chain().cells[1].compact, true, "the collapse is part of the snapshot");
	instance.collapse(detail("list", "a"), true);
	instance.collapse(row("list"), true);
	assert.equal(chain().cells.filter((cell) => cell.compact).length, 2, "user collapses beyond the cap are ignored, oldest first");
	assert.equal(instance.back().ok, true);
	assert.equal(instance.collapsed.size, 0, "closing removes the collapse state of closed cells");
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
	instance.setSize(row("list"), 150);
	assert.equal(instance.layout().chain.cells[1].rows.rows[0].height, 150, "a row keeps its session height");
	const snapshot = instance.snapshot();
	instance.setSize(row("list"), null);
	instance.restore(snapshot);
	assert.equal(instance.layout().chain.cells[1].rows.rows[0].height, 150, "session sizes are part of the snapshot");
	instance.open("item:b", { from: row("list") });
	instance.setSize(item("list", "b"), 190);
	instance.back();
	assert.equal(instance.sizes.has(item("list", "b")), false, "closing drops the size of a closed cell");
	assert.deepEqual(instance.layout(), instance.layout(), "the layout stays a pure function with sizes applied");
});

scenario("a hinted or lazy destination opens provisionally and completes when its definition arrives", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	assert.equal(instance.open("remote:a", { from: item("list", "a") }).reason, "unknown-destination", "without a hint and without lazy mode an unknown id is refused");
	const hinted = instance.open("remote:a", { from: item("list", "a"), hint: { title: "Remote A", min: 120, max: 240 } });
	assert.equal(hinted.ok, true);
	assert.equal(instance.destination("remote:a").provisional, true);
	assert.equal(instance.get(`${item("list", "a")}/remote:a`).title, "Remote A");
	assert.deepEqual(titles(instance), ["Gallery", "Remote A"]);
	assert.deepEqual([instance.layout().chain.cells[1].rows.rows[0].chain.cells[2].min, instance.layout().chain.cells[1].rows.rows[0].chain.cells[2].max], [120, 240], "the hint sizes the placeholder cell");
	const group = instance.groupOf(instance.get(`${item("list", "a")}/remote:a`)).id;
	instance.open("item:b", { from: row("grid") });
	const result = instance.define("remote:a", { title: "Remote A!", min: 150, max: 260, defaultChild: "detail:b" });
	assert.deepEqual(result.completed, [`${item("list", "a")}/remote:a`]);
	assert.equal(instance.get(`${item("list", "a")}/remote:a`).title, "Remote A!", "the definition updates the open occurrence in place");
	assert.equal(instance.occurrences.size, [...instance.occurrences.keys()].length, "no second occurrence for the same opening");
	const late = instance.get(`${item("list", "a")}/remote:a/detail:b`);
	assert.ok(late, "the late default opened");
	assert.equal(late.group, group, "and joined the group that started the navigation, not the newer one");
	assert.deepEqual(titles(instance), ["Gallery", "Remote A!", "Item B"], "Back order is unchanged by the late arrival");
	assert.equal(instance.layout().chain.cells[1].rows.rows[0].chain.cells[2].min, 150, "a hint mismatch is repaired in place");

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

	const lazy = new Navigator({ destinations: { ...destinations }, root: "root", minViewportHeight, chrome, lazy: true });
	lazy.resize({ width: 1000, height: 500 });
	lazy.open("gallery", { from: "root" });
	const generic = lazy.open("remote:d", { from: item("list", "a") });
	assert.equal(generic.ok, true, "in lazy mode an unknown id opens a generic loading cell");
	assert.equal(lazy.destination("remote:d").min, 200);
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
	assert.deepEqual(wide.focusInfo(), { occurrence: GALLERY, title: "Gallery", context: ["Root"] });
	wide.open("item:c", { from: row("tags") });
	assert.deepEqual(wide.focusInfo().context, ["Root", "Gallery", "Tags"]);
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
