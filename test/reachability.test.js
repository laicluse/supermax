import assert from "node:assert/strict";
import { Navigator } from "../src/navigation.js";

for (const min of [0, -1, NaN, Infinity]) {
	assert.throws(() => new Navigator({ root: "root", minViewportHeight: 100, destinations: {
		root: { title: "Root", min, max: 100 },
		child: { title: "Child", min: 20, max: "*", preferred: 40 },
	} }), /invalid/, "a configuration cannot declare a cell that has no finite positive minimum");
}

for (const bounds of [{ min: 100, max: 50 }, ...[NaN, Infinity, 20, 200].map((preferred) => ({ min: 50, max: 100, preferred })), { min: 50, max: "*", preferred: Infinity }]) {
	assert.throws(() => new Navigator({ root: "root", minViewportHeight: 100, destinations: {
		root: { title: "Root", ...bounds },
		child: { title: "Child", min: 20, max: "*", preferred: 40 },
	} }), /invalid/, "cell bounds must describe finite usable space");
}
assert.throws(() => new Navigator({ root: "split", minViewportHeight: 100, destinations: {
	split: { title: "Split", rows: [{ destination: "row", minHeight: 40, maxHeight: "*", preferredHeight: Infinity }] },
	row: { title: "Row", min: 20, max: "*", preferred: 40 },
} }), /invalid/, "elastic row preferences cannot make allocation non-finite");

function conversation() {
	const model = new Navigator({ root: "inbox", minViewportHeight: 360, destinations: {
		inbox: { title: "Inbox", min: 200, max: 300, overflow: { mode: "hide" } },
		conversation: { title: "Conversation", header: "title", rows: [
			{ destination: "messages", minHeight: 200, maxHeight: "*", preferredHeight: 201, overflow: { mode: "hide" } },
			{ destination: "attachments", minHeight: 200, maxHeight: 200, overflow: { mode: "hide" } },
		] },
		messages: { title: "Messages", min: 300, max: "*", preferred: 600, overflow: { mode: "hide" } },
		attachments: { title: "Attachments", min: 200, max: 400, overflow: { mode: "hide" } },
		attachment: { title: "Attachment", min: 300, max: 500, placement: "beside-split", overflow: { mode: "hide" } },
		note: { title: "Note", min: 150, max: 200, overflow: { mode: "hide" } },
	} });
	model.resize({ width: 500, height: 360 });
	model.open("conversation", { from: "inbox" });
	model.open("note", { from: "inbox/conversation/messages" });
	model.open("attachment", { from: "inbox/conversation/attachments" });
	return model;
}

{
	const model = conversation();
	const wanted = "inbox/conversation/messages/note";
	const visited = new Set();
	while (model.get(wanted) && !model.layout().cells.get(wanted)?.full) {
		const signature = JSON.stringify(model.snapshot());
		assert.equal(visited.has(signature), false, "Back makes progress toward hidden content");
		visited.add(signature);
		const target = model.upTarget();
		assert.ok(target, "hidden nonfoldable content retains a Back route");
		model.showByClosing(target.id);
	}
	assert.ok(model.get(wanted), "Back must reveal the hidden sibling before any action can close it");
}

{
	const model = conversation();
	model.bringIntoView("inbox/conversation/messages");
	assert.equal(model.layout().cells.get("inbox/conversation/messages")?.full, true, "inner demand is settled before allocating its outer split");
	assert.ok(model.get("inbox/conversation/messages/note"), "revealing a row preserves its child");
}

{
	const model = new Navigator({ root: "root", minViewportHeight: 100, destinations: {
		root: { title: "Root", min: 100, max: 100 },
		parent: { title: "Parent", min: 100, max: 100, overflow: { mode: "hide" } },
		detail: { title: "Detail", min: 100, max: "*", preferred: 100, zoomable: true },
	} });
	model.resize({ width: 100, height: 100 });
	model.open("parent", { from: "root" });
	model.open("detail", { from: "root/parent" });
	model.zoom("root/parent/detail");
	model.focusFold("root", "horizontal");
	assert.equal(model.zoomed, null, "fold focus leaves zoom before selecting its own active cell");
	assert.equal(model.layout().cells.get("root").full, true);
	model.zoom("root/parent/detail");
	assert.deepEqual(model.foldFocuses, [], "zoom owns the active cell without an opposing fold focus");
	assert.equal(model.layout().cells.get("root/parent/detail").full, true);
	model.zoom(null);
	model.startWindow("root", "root/parent");
	model.zoom("root/parent/detail");
	assert.equal(model.layout().cells.get("root/parent/detail").full, true, "zoom takes precedence over a previous window anchor");
}

{
	const model = conversation();
	model.destinations.note.zoomable = true;
	model.zoom("inbox/conversation/messages/note");
	assert.equal(model.layout().cells.get("inbox/conversation/messages/note")?.full, true, "zoom in an earlier row preserves its containing row");
}

let checkedRoutes = 0;
function verifyRoutes(model, context) {
	const snapshot = model.snapshot();
	for (const id of model.occurrences.keys()) {
		model.restore(snapshot);
		const seen = new Set();
		const trace = [];
		for (;;) {
			assert.ok(model.get(id), `${context}: navigation cannot discard ${id} before revealing it: ${JSON.stringify(trace)}`);
			const layout = model.layout();
			assert.ok([...layout.cells.values()].some((cell) => cell.full), `${context}: every nonempty workspace retains an active cell`);
			assert.equal(layout.access.size, model.occurrences.size, `${context}: every open occurrence has a route`);
			const route = layout.access.get(id);
			trace.push(route);
			if (route.kind === "visible") {
				assert.equal(layout.cells.get(id).full, true);
				assert.ok(layout.cells.get(id).width > 0, `${context}: an allocated cell cannot round down to zero width`);
				checkedRoutes += 1;
				break;
			}
			const state = JSON.stringify(model.snapshot());
			assert.equal(seen.has(state), false, `${context}: route to ${id} must terminate (${JSON.stringify(route)})`);
			seen.add(state);
			if (route.kind === "zoom-out") model.zoom(null);
			else if (route.kind === "back") {
				assert.equal(model.upTarget(layout).id, route.occurrence, "the route uses the actual Back target");
				model.showByClosing(route.occurrence);
			} else {
				const placement = (route.axis === "horizontal" ? layout.cells : layout.rows).get(route.occurrence);
				assert.equal(placement.inView, true, "the route's page handle is in the visible scope");
				assert.equal(placement.foldPage, route.occurrence, "the route uses the nearest page handle actually rendered");
				model.focusFold(route.occurrence, route.axis);
			}
		}
	}
	model.restore(snapshot);
}

{
	const model = new Navigator({ root: "root", minViewportHeight: 100, destinations: {
		root: { title: "Root", min: 20, max: 40 },
		child: { title: "Child", min: 20, max: "*", preferred: 40 },
	} });
	model.resize({ width: 1, height: 100 });
	model.open("child", { from: "root" });
	model.focusFold("root/child", "horizontal");
	model.startWindow("root", "root/child");
	model.closeNewestGroup();
	assert.equal(model.layout().cells.get("root").full, true, "closing a focused child cannot leave a stale anchor that folds the sole surviving cell");
	assert.deepEqual(model.foldFocuses, []);
}

{
	const model = new Navigator({ root: "root", minViewportHeight: 100, destinations: {
		root: { title: "Root", min: .25, max: .5 },
		child: { title: "Child", min: .25, max: "*", preferred: .5 },
	} });
	model.resize({ width: .25, height: 100 });
	model.open("child", { from: "root" });
	verifyRoutes(model, "fractional cell bounds");
}

{
	const model = conversation();
	const snapshot = structuredClone(model.snapshot());
	snapshot.zoomed = "missing";
	snapshot.windowStarts = [["inbox", "missing"], ["inbox/conversation/messages", "inbox"]];
	snapshot.rowStarts = [["inbox/conversation", "inbox"]];
	snapshot.foldFocuses = [{ scope: "inbox", occurrence: "inbox/conversation/messages", axis: "horizontal" }];
	assert.equal(model.restore(snapshot), true);
	assert.equal(model.zoomed, null, "a stale zoom cannot replace the actual Back route");
	assert.equal(model.windowStarts.size, 0, "window selections must belong to their chain");
	assert.equal(model.rowStarts.size, 0, "row selections must belong to their split");
	assert.deepEqual(model.foldFocuses, [], "fold selections must belong to their scope");
	verifyRoutes(model, "restored stale selections");
}

for (const count of [2, 3, 6, 20]) for (const overflow of [undefined, { mode: "hide" }, { mode: "fold", size: 8 }]) for (const keep of [false, true]) {
	const destinations = Object.fromEntries(Array.from({ length: count }, (_, index) => [`cell${index}`, { title: `Cell ${index}`, min: 20 + index % 3 * 30, max: index === count - 1 ? "*" : 120, preferred: 100, overflow: keep && index === 0 ? { mode: "keep" } : overflow, zoomable: true }]));
	const model = new Navigator({ root: "cell0", minViewportHeight: 200, destinations });
	let from = "cell0";
	for (let index = 1; index < count; index += 1) { model.open(`cell${index}`, { from }); from += `/cell${index}`; }
	for (const width of [1, 19, 20, 43, 44, 79, 80, 99, 100, 101, 240, 1000]) {
		model.resize({ width, height: 200 });
		verifyRoutes(model, `chain ${count}, ${JSON.stringify(overflow)}, keep ${keep}, width ${width}`);
		model.zoom(from);
		verifyRoutes(model, `zoom chain ${count}, width ${width}`);
		model.zoom(null);
		const folded = model.layout().chain.cells.find((cell) => cell.folded);
		if (folded) {
			model.focusFold(folded.occurrence, "horizontal");
			verifyRoutes(model, `focus chain ${count}, width ${width}`);
			model.foldFocuses = [];
		}
	}
}

for (let mask = 0; mask < 8; mask += 1) for (const rowCount of [2, 3, 4]) {
	const destinations = {
		menu: { title: "Menu", min: 40, max: 40, overflow: { mode: "keep" } },
		split: { title: "Split", header: "title", rows: Array.from({ length: rowCount }, (_, index) => ({ destination: `row${index}`, minHeight: 80, maxHeight: index === 0 ? "*" : 180, preferredHeight: index === 0 ? 180 : undefined, overflow: mask & 1 ? { mode: "hide" } : undefined })) },
		item: { title: "Item", min: 80, max: "*", preferred: 160, overflow: mask & 2 ? { mode: "hide" } : undefined, zoomable: true },
		breakout: { title: "Breakout", min: 100, max: 200, placement: "beside-split", overflow: mask & 4 ? { mode: "hide" } : undefined, zoomable: true },
	};
	for (let index = 0; index < rowCount; index += 1) destinations[`row${index}`] = { title: `Row ${index}`, min: 80, max: 160, overflow: mask & 2 ? { mode: "hide" } : undefined };
	const model = new Navigator({ root: "menu", minViewportHeight: 200, destinations });
	model.open("split", { from: "menu" });
	for (let index = 0; index < rowCount; index += 1) model.open("item", { from: `menu/split/row${index}` });
	model.open("breakout", { from: `menu/split/row${rowCount - 1}/item` });
	for (const width of [1, 44, 120, 200, 320, 500]) for (const height of [1, 27, 28, 29, 80, 180, 360, 600]) {
		model.resize({ width, height });
		verifyRoutes(model, `split mask ${mask}, rows ${rowCount}, ${width}x${height}`);
		for (const row of model.layout().rows.values()) if (row.folded && row.inView) {
			model.focusFold(row.occurrence, "vertical");
			verifyRoutes(model, `row focus mask ${mask}, ${width}x${height}`);
			model.foldFocuses = [];
		}
	}
}

for (let seed = 1; seed <= 24; seed += 1) {
	let state = seed;
	const random = (count) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % count; };
	const model = conversation();
	for (const definition of Object.values(model.destinations)) {
		if (definition.rows) definition.rows.forEach((row) => { row.overflow = random(2) ? { mode: "hide" } : undefined; });
		else { definition.overflow = random(2) ? { mode: "hide" } : undefined; definition.zoomable = true; }
	}
	const snapshots = [model.snapshot()];
	for (let step = 0; step < 60; step += 1) {
		const layout = model.layout();
		const cells = [...model.occurrences.values()];
		switch (random(8)) {
			case 0: model.resize({ width: [1, 44, 100, 295.5, 296, 500, 1000][random(7)], height: [1, 28, 100, 334.5, 335, 360, 700][random(7)] }); break;
			case 1: {
				const pages = [...layout.cells.values()].map((placement) => ({ placement, axis: "horizontal" })).concat([...layout.rows.values()].map((placement) => ({ placement, axis: "vertical" }))).filter(({ placement }) => placement.inView && placement.foldPage === placement.occurrence);
				if (pages.length) { const { placement, axis } = pages[random(pages.length)]; model.focusFold(placement.occurrence, axis); }
				break;
			}
			case 2: { const target = model.upTarget(layout); if (target) model.showByClosing(target.id); break; }
			case 3: model.zoom(model.zoomed ? null : cells[random(cells.length)].id); break;
			case 4: model.closeNewestGroup(); break;
			case 5: {
				if (!model.get("inbox/conversation")) model.open("conversation", { from: "inbox" });
				else if (random(2)) model.open("note", { from: "inbox/conversation/messages" });
				else model.open("attachment", { from: "inbox/conversation/attachments" });
				break;
			}
			case 6: model.setSize(cells[random(cells.length)].id, random(2) ? 100 + random(500) : null); break;
			case 7: model.restore(snapshots[random(snapshots.length)]); break;
		}
		verifyRoutes(model, `trace ${seed}, step ${step}`);
		if (step % 10 === 0) snapshots.push(model.snapshot());
	}
}

console.log(`Reachability scenarios passed (${checkedRoutes} complete navigation routes)`);
