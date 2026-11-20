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

scenario("a split reached through a default is validated with its ancestors' chrome", () => {
	const instance = model(1000, 300);
	openGallery(instance);
	assert.equal(instance.open("item:nested", { from: row("list") }).ok, true);
	assert.ok(!instance.get(`${item("list", "nested")}/inner`), "40 + 20 x 3 + 201 exceeds 300, so the inner split stays closed");
	assert.equal(instance.open("item:deep", { from: row("grid") }).ok, true);
	assert.ok(instance.get(`${item("grid", "deep")}/innerfit`), "40 + 20 x 3 + 200 fits exactly");
	assert.equal(instance.open("inner", { from: item("list", "nested") }).reason, "invalid-rows", "the manual click gets the same verdict");
});

scenario("a split whose row is itself a split is validated through that row", () => {
	const instance = model(1000, 300);
	assert.equal(instance.open("outer", { from: "root" }).reason, "invalid-rows");
	assert.deepEqual(instance.state().occurrences, ["root"], "nothing opened");
	assert.ok(validateSplit(instance, "outer", instance.root).rows[0].problems.includes("invalid-nested-split"));
	assert.equal(validateSplit(instance, "outerfit", instance.root).ok, true, "a nested split that fits with the outer tabs counted passes");
	assert.equal(instance.open("outerfit", { from: "root" }).ok, true);
	assert.ok(instance.get("root/outerfit/innerfit/list"), "the nested rows exist");
	assert.equal(validateSplit(instance, "loop", instance.root).rows[0].nested.rows[0].nested.reason, "cycle", "a split that contains itself is reported, not recursed forever");
	assert.equal(instance.open("loop", { from: "root" }).reason, "invalid-rows");
	openGallery(instance);
	const wrapper = validateSplit(instance, "wrapper", instance.get(row("grid")));
	assert.deepEqual({ title: wrapper.rows[0].title, problems: wrapper.rows[0].problems }, { title: "Inner", problems: ["invalid-nested-split"] });
	assert.equal(wrapper.rows[0].nested.rows[0].required, 40 + 20 * 3 + 201, "the nested result names the row that fails and its real requirement");
});

scenario("a nested chain that needs more height than its row gets grows the row and marks overflow", () => {
	const instance = model(1000, 300);
	openGallery(instance);
	instance.open("item:deep", { from: row("grid") });
	instance.focus(`${item("grid", "deep")}/innerfit/list`);
	const layout = instance.layout();
	const gridRow = layout.chain.cells[1].rows.rows[1];
	assert.deepEqual(layout.chain.cells[1].rows.rows.map((candidate) => candidate.height), [20, 220, 20], "the siblings collapse so the grown row fits the supported height");
	assert.equal(layout.overflow, false, "within the supported range nothing overflows");
	assert.equal(gridRow.height, gridRow.chain.contentHeight, "the row takes the height its nested rows need");
	instance.resize({ width: 1000, height: 200 });
	const short = instance.layout();
	assert.equal(short.overflow, true, "below the room for the grown row the workspace scrolls");
	assert.equal(short.chain.cells[1].rows.rows[1].height, 220, "the grown row keeps its content height");
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
	const narrow = model(150, 500);
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
