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
const elsewhere = { title: "Elsewhere", min: 100, max: "*", preferred: 100 };
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
	assert.deepEqual(closedTitles(wide.closeNewestGroup()).slice(0, 2), ["Gallery", "List"], "Back reports every closed occurrence, root first");
	assert.deepEqual(wide.state().occurrences, ["root"]);
	assert.equal(wide.newestGroup(), null);
	assert.equal(wide.closeNewestGroup().ok, false, "the end of history is a result, not an exception");
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
	assert.deepEqual(closedTitles(narrow.closeNewestGroup()), ["Detail A"]);
	assert.deepEqual(closedTitles(narrow.closeNewestGroup()), ["Item A"]);
	assert.deepEqual(titles(narrow), ["Gallery"]);
});

scenario("Back closes groups in reverse opening order across rows", () => {
	for (const [order, expected] of [[["a", "b", "c"], ["Item C", "Item B", "Item A"]], [["a", "c", "b"], ["Item B", "Item C", "Item A"]]]) {
		const instance = model(150);
		openGallery(instance);
		const keys = ["list", "grid", "tags"];
		order.forEach((id, index) => assert.equal(instance.open(`item:${id}`, { from: row(keys[index]) }).ok, true));
		for (const title of expected) assert.deepEqual(closedTitles(instance.closeNewestGroup()), [title]);
		for (const key of keys) assert.ok(instance.get(row(key)), `${key} survives`);
		assert.deepEqual(titles(instance), ["Gallery"]);
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
	assert.deepEqual(closedTitles(wide.closeNewestGroup()), ["Detail A", "Notes A"], "Back closes the detail with its own automatic notes");
	assert.deepEqual(closedTitles(wide.closeNewestGroup()), ["Item A"]);
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
	const closed = wide.closeNewestGroup();
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
	assert.deepEqual(closedTitles(wide.closeNewestGroup()), ["Item B", "Detail B"]);
	assert.ok(!wide.get(item("list", "a")), "Back returns to the selector, nothing is restored");
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
	assert.deepEqual(Object.keys(verdict).sort(), ["conflict", "crowd", "doubled", "empty", "outer", "over", "rigid", "twins", "unpreferred"]);
	assert.equal(verdict.rigid.reason, "no-elastic-row", "a split without a row whose maxHeight is \"*\" has nowhere to put spare height");
	assert.equal(verdict.doubled.reason, "several-elastic-rows", "and a split with two cannot say which one stretches");
	assert.ok(verdict.unpreferred.rows[0].problems.includes("elastic-without-preferred"), "an elastic row declares its preferred height");
	const cellProblems = (extra) => validateDestinations({ ...destinations, ...extra }, { minViewportHeight, chrome }).problems.map((problem) => [problem.destination, problem.reason]);
	assert.deepEqual(cellProblems({ loose: { title: "Loose", min: 100, max: "*" } }), [["loose", "elastic-without-preferred"]], "an elastic cell declares its preferred width");
	assert.deepEqual(validateDestinations({ root: { title: "Root", min: 100, max: 200 } }, { minViewportHeight, chrome }).problems.map((problem) => problem.reason), ["no-elastic-destination"], "a configuration without any elastic cell is refused");
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
	assert.throws(() => new Navigator({ destinations, root: "root", minViewportHeight, chrome, spareSpace: "middle" }), /spareSpace must be one of start, center, end/, "an unknown spare-space mode is a configuration error");
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
	assert.equal(narrow.layout().chain.cells[1].rows.rows[0].chain.revealOffset, 1, "the window holds until something changes");
	narrow.open("detail:a", { from: item("list", "a") });
	assert.equal(narrow.layout().chain.cells[1].rows.rows[0].chain.revealOffset, 0, "an opening in the row resets the window");
	narrow.startWindow(row("list"), row("list"));
	narrow.closeNewestGroup();
	assert.equal(narrow.layout().chain.cells[1].rows.rows[0].chain.revealOffset, 1, "closing a group keeps the window");
});

scenario("Up reaches every cell hidden above the window, newest branch first, never what lies after it", () => {
	const narrow = new Navigator({ destinations: { ...destinations, root: { ...destinations.root, keep: true } }, root: "root", minViewportHeight, chrome });
	narrow.resize({ width: 210, height: 500 });
	openGallery(narrow);
	assert.equal(narrow.upTarget(), null, "nothing is above the window, and the kept root never counts");
	narrow.open("item:a", { from: row("list") });
	narrow.bringIntoView(item("list", "a"));
	assert.deepEqual(narrow.upTarget(), { id: row("list"), title: "List" }, "the parent that hid above the item comes first");
	narrow.bringIntoView(row("list"));
	assert.equal(narrow.upTarget(), null, "the item now after the window is not a target");
	narrow.open("item:b", { from: row("grid") });
	narrow.bringIntoView(item("grid", "b"));
	assert.deepEqual(narrow.upTarget(), { id: row("grid"), title: "Grid" }, "the newest branch climbs first");
	assert.deepEqual(titles(narrow), ["Gallery", "Item A", "Item B"], "finding a target closes nothing");

	const chain = new Navigator({ destinations: { elsewhere, menu: { title: "Menu", min: 100, max: 100, keep: true, compact: { min: 20 } }, a: { title: "A", min: 100, max: 100, defaultChild: "b" }, b: { title: "B", min: 100, max: 100, defaultChild: "c" }, c: { title: "C", min: 100, max: 100 } }, root: "menu", minViewportHeight, chrome });
	chain.resize({ width: 400, height: 500 });
	chain.open("a", { from: "menu" });
	chain.resize({ width: 120, height: 500 });
	assert.deepEqual(chain.upTarget(), { id: "menu/a/b", title: "B" }, "cells hidden in the middle of a branch are reached from its tip");

	const rows = model(1000, 300);
	openGallery(rows);
	assert.ok(rows.upTarget()?.id.startsWith(row("list")), "a row hidden above is reached, the last row to appear climbing first");
});

scenario("showing a hidden parent closes as many cells from the end as it needs, and no more", () => {
	const set = {
		elsewhere,
		menu: { title: "Menu", min: 100, max: 100 },
		wide: { title: "Wide", min: 300, max: 300, defaultChild: "a" },
		a: { title: "A", min: 50, max: 50, defaultChild: "b" },
		b: { title: "B", min: 50, max: 50, defaultChild: "c" },
		c: { title: "C", min: 50, max: 50, defaultChild: "d" },
		d: { title: "D", min: 50, max: 50, defaultChild: "e" },
		e: { title: "E", min: 50, max: 50, defaultChild: "f" },
		f: { title: "F", min: 50, max: 50 },
	};
	const instance = new Navigator({ destinations: set, root: "menu", minViewportHeight, chrome });
	instance.resize({ width: 1000, height: 500 });
	instance.open("wide", { from: "menu" });
	instance.resize({ width: 300, height: 500 });
	const visible = () => instance.layout().chain.cells.filter((cell) => cell.visible).map((cell) => cell.title);
	assert.deepEqual(visible(), ["A", "B", "C", "D", "E", "F"], "the small cells fill the frame and Wide hides");
	assert.deepEqual(instance.upTarget(), { id: "menu/wide", title: "Wide" });
	const closed = instance.showByClosing("menu/wide");
	assert.deepEqual(closed.map((entry) => entry.title), ["F", "E", "D", "C", "B", "A"], "Wide needs all 300 pixels, so every small cell after it closes, deepest first");
	assert.deepEqual(visible(), ["Wide"]);

	instance.resize({ width: 1000, height: 500 });
	instance.open("a", { from: "menu/wide" });
	instance.resize({ width: 600, height: 500 });
	assert.deepEqual(visible(), ["Wide", "A", "B", "C", "D", "E", "F"], "only the menu hides");
	assert.deepEqual(instance.showByClosing("menu").map((entry) => entry.title), ["F", "E"], "showing the menu closes only the two cells it needs");
	assert.deepEqual(visible(), ["Menu", "Wide", "A", "B", "C", "D"]);
});

scenario("a revealed outer chain does not change which defaults open", () => {
	const plain = model(150, 500);
	openGallery(plain);
	plain.open("item:b", { from: row("grid") });
	const revealed = model(150, 500);
	openGallery(revealed);
	revealed.startWindow("root", "root");
	assert.equal(revealed.layout().chain.cells[1].visible, false, "the gallery is hidden behind the revealed root");
	assert.equal(revealed.open("item:b", { from: row("grid") }).ok, true);
	assert.deepEqual(revealed.state().occurrences, plain.state().occurrences, "the row width ignores the reveal, so the same defaults open");
	assert.equal(revealed.layout().chain.revealOffset, 0, "an opening resets the reveal of every chain above it");
});

scenario("only a kept cell stays, compact when space runs out; every other cell is in view or gone", () => {
	const set = {
		elsewhere,
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
	instance.startWindow("menu", null);
	instance.resize({ width: 110, height: 500 });
	assert.deepEqual([instance.layout().overflowX, Math.round(instance.layout().chain.contentWidth)], [true, 120], "when the kept rail and the newest cell's minimum exceed the width the newest keeps its minimum and the workspace scrolls sideways");
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
	instance.closeNewestGroup();
	instance.open("item:b", { from: row("list") });
	instance.setSize(item("list", "b"), 190);
	instance.closeNewestGroup();
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

scenario("a destination opens only from its registered declaration, and a second declaration may not differ", () => {
	const declared = (title, more = {}) => ({ title, min: 100, max: 200, preferred: null, defaultChild: null, ...more });
	const set = { schemaVersion: 1, context: null, root: "remote:a", destinations: { "remote:a": declared("Remote A", { min: 150, max: 260, defaultChild: "remote:b" }), "remote:b": declared("Remote B") } };
	const instance = model(1000, 500);
	openGallery(instance);
	assert.equal(instance.open("remote:a", { from: item("list", "a") }).reason, "unknown-destination", "an undeclared destination is refused");
	assert.throws(() => instance.open("remote:a", { from: item("list", "a"), hint: { title: "Remote A", min: 120, max: 240 } }), TypeError, "a link cannot carry layout of its own");
	assert.deepEqual(instance.register(set), ["remote:a", "remote:b"], "registering adds the destination and its whole default chain");
	assert.deepEqual(titles(instance), ["Gallery"], "and opens nothing by itself");
	assert.equal(instance.open("remote:a", { from: item("list", "a") }).ok, true);
	assert.ok(instance.get(`${item("list", "a")}/remote:a/remote:b`), "the default chain opens in the same navigation");
	assert.deepEqual(instance.register(set), [], "the same declaration again changes nothing");
	const differs = (problems, reason) => (error) => error instanceof SupermaxConfigurationError && error.problems.some((problem) => problem.reason === reason && problems.includes(problem.destination));
	assert.throws(() => instance.register({ ...set, destinations: { ...set.destinations, "remote:a": { ...set.destinations["remote:a"], min: 120 } } }), differs(["remote:a"], "declaration-mismatch"), "a different declaration for a known destination is a configuration error");
	assert.equal(instance.definitionOf("remote:a").min, 150, "and the known declaration stays");
	assert.throws(() => instance.register({ ...set, root: "remote:c", destinations: { "remote:c": declared("Remote C", { defaultChild: "remote:missing" }) } }), differs(["remote:c"], "missing-destination"), "a set must carry every default it names");
	assert.throws(() => instance.register({ ...set, root: "remote:d", destinations: { "remote:d": declared("Remote D", { defaultChild: "remote:e" }), "remote:e": declared("Remote E", { defaultChild: "remote:d" }) } }), differs(["remote:d", "remote:e"], "default-cycle"), "a cyclic default chain is refused");
	assert.throws(() => instance.register({ ...set, schemaVersion: 2 }), differs(["remote:a"], "schema-version"), "an unknown schema version is refused");
	assert.throws(() => instance.register({ ...set, root: "remote:f", destinations: { "remote:f": { ...declared("Remote F"), data: { kind: "photo" } } } }), differs(["remote:f"], "unknown-field"), "a declaration carries layout only");
	assert.throws(() => instance.register({ ...set, root: "remote:g", destinations: { "remote:g": declared("Remote G", { min: 300, max: 200 }) } }), differs(["remote:g"], "invalid-size"));
	assert.throws(() => instance.register({ ...set, root: "remote:h", destinations: { "remote:h": declared("Remote H", { max: "*" }) } }), differs(["remote:h"], "elastic-without-preferred"), "an elastic declaration names its preferred width");
	assert.deepEqual(instance.register({ ...set, root: "remote:i", destinations: { "remote:i": declared("Remote I", { max: "*", preferred: 180 }) } }), ["remote:i"], "and is accepted with it");
	assert.throws(() => instance.register({ ...set, root: "remote:t", destinations: { "remote:t": declared("Remote T", { min: 300, max: 600, rows: [{ destination: "list", minHeight: 400, maxHeight: 500 }] }) } }), differs(["remote:t"], "invalid-rows"), "a split is validated against the minimum height when it is registered");
	assert.equal(instance.definitionOf("remote:c"), null, "a refused set registers nothing");

	const viewer = new Navigator({ destinations, root: "root", minViewportHeight, chrome, context: "ana" });
	assert.throws(() => viewer.register({ ...set, context: "ben" }), differs(["remote:a"], "declaration-context"), "a set for another context is refused");
	assert.deepEqual(viewer.register({ ...set, context: "ana" }), ["remote:a", "remote:b"]);
});

scenario("default chains are finite and do not repeat a destination already in the chain", () => {
	const loopy = new Navigator({ destinations: { ...destinations, "loop:a": { title: "Loop A", min: 100, max: 200, defaultChild: "loop:b" }, "loop:b": { title: "Loop B", min: 100, max: 200, defaultChild: "loop:a" } }, root: "root", minViewportHeight, chrome });
	loopy.resize({ width: 2000, height: 500 });
	loopy.open("gallery", { from: "root" });
	loopy.open("loop:a", { from: item("list", "a") });
	const chain = loopy.layout().chain.cells[1].rows.rows[0].chain.cells.map((cell) => cell.title);
	assert.deepEqual(chain.slice(-2), ["Loop A", "Loop B"], "the chain stops where a destination would repeat");
});

scenario("the title names where the newest navigation went, with its ancestors as context", () => {
	const wide = model(1000);
	assert.deepEqual(wide.locationInfo(), { occurrence: "root", title: "Root", trail: [] });
	openGallery(wide);
	assert.deepEqual(wide.locationInfo(), { occurrence: GALLERY, title: "Gallery", trail: [{ occurrence: "root", title: "Root" }] }, "defaults that opened along do not move the title");
	wide.open("item:c", { from: row("tags") });
	assert.deepEqual(wide.locationInfo().trail.map((step) => step.title), ["Root", "Gallery", "Tags"]);
	assert.deepEqual(wide.child(wide.get(row("tags")))?.destination, "item:c");
	wide.closeNewestGroup();
	assert.equal(wide.locationInfo().title, "Gallery", "closing the newest group returns the title to the one before");
});

scenario("a snapshot restores the exact state, including groups and windows", () => {
	const instance = model(1000, 500);
	openGallery(instance);
	instance.open("item:b", { from: row("grid") });
	instance.resize({ width: 300, height: 500 });
	const snapshot = structuredClone(instance.snapshot());
	const expected = instance.state();
	instance.reset();
	assert.deepEqual(instance.state(), { occurrences: ["root"], groups: [] });
	assert.equal(instance.restore(snapshot), true);
	assert.deepEqual(instance.state(), expected);
	assert.deepEqual(closedTitles(instance.closeNewestGroup()), ["Item B", "Detail B"], "history continues from the restored state");
	const stale = structuredClone(snapshot);
	stale.occurrences[1].destination = "renamed";
	assert.equal(instance.restore(stale), false, "a snapshot naming an unknown destination is refused");
	assert.equal(instance.closeNewestGroup().title, "Gallery", "the model is unchanged by the refused restore");
	assert.deepEqual(instance.state().occurrences, ["root"]);
});

console.log("Navigation scenarios passed");

scenario("sync brings the open chain to a list of destinations in one transaction, keeping what both share", () => {
	const chain = new Navigator({
		destinations: {
			elsewhere,
			inbox: { title: "Inbox", min: 200, max: 300 },
			list: { title: "List", min: 200, max: "*", preferred: 300 },
			"conversation:1": { title: "Conversation 1", min: 200, max: 300, defaultChild: "messages:1" },
			"messages:1": { title: "Messages 1", min: 200, max: 300 },
			"conversation:2": { title: "Conversation 2", min: 200, max: 300 },
		},
		root: "inbox",
		minViewportHeight,
		chrome,
	});
	chain.resize({ width: 1400, height: 500 });
	const open = () => {
		const ids = [];
		for (let current = chain.root; current; current = chain.child(current)) ids.push(current.destination);
		return ids;
	};
	const first = chain.sync(["inbox", "list", "conversation:1"]);
	assert.equal(first.ok, true);
	assert.deepEqual(open(), ["inbox", "list", "conversation:1", "messages:1"], "it opens what is missing, defaults included");
	const list = chain.child(chain.root).id;
	assert.equal(chain.sync(["inbox", "list", "conversation:2"]).ok, true);
	assert.deepEqual(open(), ["inbox", "list", "conversation:2"], "it replaces the tail that differs");
	assert.equal(chain.child(chain.root).id, list, "and keeps the occurrence both chains share");
	assert.equal(chain.sync(["inbox", "list"]).ok, true);
	assert.deepEqual(open(), ["inbox", "list"], "it closes what the list no longer names");
	const before = JSON.stringify(chain.snapshot());
	assert.deepEqual(chain.sync(["inbox", "list", "conversation:9"]), { ok: false, reason: "unknown-destination", destination: "conversation:9" }, "an unknown destination refuses the whole sync");
	assert.deepEqual(chain.sync(["list"]), { ok: false, reason: "other-root", destination: "list" }, "and so does a list that starts elsewhere");
	assert.equal(JSON.stringify(chain.snapshot()), before, "leaving the model as it was");
	assert.equal(chain.sync(["inbox", "list"]).noop, true, "a list that is already open changes nothing");
});

scenario("sync opens the longest beginning of ifRoom that shows without hiding what is in view, as cells a later explicit sync promotes", () => {
	const chain = new Navigator({
		destinations: {
			elsewhere,
			inbox: { title: "Inbox", min: 200, max: 300 },
			list: { title: "List", min: 200, max: "*", preferred: 300 },
			"conversation:1": { title: "Conversation 1", min: 200, max: 300 },
			"messages:1": { title: "Messages 1", min: 300, max: 400 },
			"attachments:1": { title: "Attachments 1", min: 200, max: 300 },
		},
		root: "inbox",
		minViewportHeight,
		chrome,
	});
	chain.resize({ width: 1000, height: 500 });
	const open = () => {
		const ids = [];
		for (let current = chain.root; current; current = chain.child(current)) ids.push(current.destination);
		return ids;
	};
	const required = ["inbox", "list", "conversation:1"];
	const before = JSON.stringify(chain.snapshot());
	assert.deepEqual(chain.sync(required, { ifRoom: ["messages:1", "nowhere"] }), { ok: false, reason: "unknown-destination", destination: "nowhere" }, "an unknown optional destination refuses the whole sync");
	assert.equal(JSON.stringify(chain.snapshot()), before, "without touching the model");
	const result = chain.sync(required, { ifRoom: ["messages:1", "attachments:1"] });
	assert.equal(result.ok, true);
	assert.deepEqual(open(), [...required, "messages:1"], "Messages fits next to what is in view, Attachments would push Inbox out of it");
	assert.ok(chain.layout().chain.cells.every((cell) => cell.visible), "so everything stays in view");
	const messages = chain.child(chain.child(chain.child(chain.root)));
	assert.equal(chain.isAuto(messages), true, "an optional cell opens as an automatic one");
	chain.resize({ width: 1400, height: 500 });
	chain.layout();
	assert.deepEqual(open(), [...required, "messages:1"], "a resize opens nothing");
	assert.equal(chain.sync(required, { ifRoom: ["messages:1", "attachments:1"] }).ok, true);
	assert.deepEqual(open(), [...required, "messages:1", "attachments:1"], "the next sync decides again against the wider window");
	assert.equal(chain.sync([...required, "messages:1"]).ok, true);
	assert.equal(chain.isAuto(chain.get(messages.id)), false, "naming an automatic cell in the required list promotes it, as a click does");
	assert.deepEqual(chain.groups.map((group) => group.title).slice(-1), ["Messages 1"], "into a Back step of its own");
	assert.equal(chain.sync([...required, "messages:1"], { ifRoom: ["attachments:1"] }).noop, true, "and a sync that finds everything in place changes nothing");
});

scenario("a nested list in ifRoom opens whole or not at all, so a conversation never shows without its messages", () => {
	const chain = new Navigator({
		destinations: {
			elsewhere,
			inbox: { title: "Inbox", min: 200, max: 300 },
			list: { title: "List", min: 200, max: "*", preferred: 300 },
			"metadata:1": { title: "Metadata 1", min: 200, max: 300 },
			"messages:1": { title: "Messages 1", min: 300, max: 400 },
		},
		root: "inbox",
		minViewportHeight,
		chrome,
	});
	const open = () => {
		const ids = [];
		for (let current = chain.root; current; current = chain.child(current)) ids.push(current.destination);
		return ids;
	};
	chain.resize({ width: 800, height: 500 });
	assert.equal(chain.sync(["inbox", "list"], { ifRoom: [["metadata:1", "messages:1"]] }).ok, true);
	assert.deepEqual(open(), ["inbox", "list"], "Metadata alone would fit, Messages would not, so neither opens");
	chain.resize({ width: 1100, height: 500 });
	assert.equal(chain.sync(["inbox", "list"], { ifRoom: [["metadata:1", "messages:1"]] }).ok, true);
	assert.deepEqual(open(), ["inbox", "list", "metadata:1", "messages:1"], "with room for both, the pair opens together");
	assert.deepEqual(chain.sync(["inbox", "list"], { ifRoom: [["metadata:1", "nowhere"]] }), { ok: false, reason: "unknown-destination", destination: "nowhere" }, "an unknown destination inside a group refuses the whole sync");
});

scenario("a title can change after a cell opened, in its occurrence, its group and where the application is, without a new declaration", () => {
	const instance = model();
	openGallery(instance);
	const result = instance.open("item:c", { from: row("tags") });
	assert.equal(instance.setTitle(result.occurrence.id, "Item C, renamed"), true);
	assert.equal(instance.get(result.occurrence.id).title, "Item C, renamed");
	assert.equal(instance.locationInfo().title, "Item C, renamed", "the title follows the occurrence");
	assert.deepEqual(titles(instance), ["Gallery", "Item C, renamed"], "and so does its Back group");
	assert.equal(instance.definitionOf("item:c").title, "Item C", "while the declaration keeps its own title");
	assert.equal(JSON.parse(JSON.stringify(instance.snapshot())).occurrences.find((occurrence) => occurrence.id === result.occurrence.id).title, "Item C, renamed", "and a snapshot keeps the new one");
	assert.equal(instance.setTitle("nowhere", "x"), false);
});

scenario("zoom hides the cells before a zoomable cell, which shares the width with what follows it, like v1", () => {
	const chain = new Navigator({
		destinations: {
			elsewhere,
			inbox: { title: "Inbox", min: 200, max: 300 },
			list: { title: "List", min: 200, max: "*", preferred: 300, defaultChild: "messages" },
			messages: { title: "Messages", min: 300, max: 600, zoomable: true, defaultChild: "attachments" },
			attachments: { title: "Attachments", min: 150, max: 200 },
			plain: { title: "Plain", min: 200, max: 300 },
		},
		root: "inbox",
		minViewportHeight,
		chrome,
	});
	chain.resize({ width: 1400, height: 500 });
	chain.sync(["inbox", "list"]);
	const visible = () => chain.layout().chain.cells.filter((cell) => cell.visible).map((cell) => [cell.title, Math.round(cell.width)]);
	const messages = chain.child(chain.child(chain.root));
	assert.deepEqual(visible().map(([title]) => title), ["Inbox", "List", "Messages", "Attachments"], "everything fits before the zoom");
	assert.equal(chain.zoom(messages.id), true);
	const zoomed = visible();
	assert.deepEqual(zoomed.map(([title]) => title), ["Messages", "Attachments"], "the zoom hides the cells before Messages, and what follows it stays");
	assert.equal(zoomed.reduce((sum, [, width]) => sum + width, 0), 1400, "together they take the whole width");
	assert.ok(zoomed[0][1] > 600, "Messages grows past its own maximum, as the last cell did in v1, since no elastic cell follows it");
	assert.equal(JSON.parse(JSON.stringify(chain.snapshot())).zoomed, messages.id, "a snapshot keeps the zoom");
	assert.equal(chain.zoom(chain.root.id), false, "a cell that is not zoomable cannot zoom");
	assert.equal(chain.zoomed, messages.id);
	chain.sync(["inbox", "list"]);
	chain.closeSubtree(chain.child(chain.child(chain.root)));
	assert.equal(chain.zoomed, null, "the zoom ends when its cell closes");
	assert.deepEqual(visible().map(([title]) => title), ["Inbox", "List"]);
});
