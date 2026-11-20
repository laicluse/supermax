import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Navigator } from "../src/navigation.js";
import { layoutOf, sameLayout, validateDeclarationSet } from "../src/layout-declaration.js";

const variants = [
	{ id: "labels", when: { minWidth: 161 } },
	{ id: "icons", min: 48, preferred: 48, max: 160 },
];
function menuModel() {
	const model = new Navigator({ root: "menu", minViewportHeight: 100, destinations: {
		menu: { title: "Albums", min: 48, preferred: 240, max: 320, overflow: { mode: "keep" }, variants },
		work: { title: "Work", min: 200, preferred: 500, max: "*" },
	} });
	model.open("work");
	return model;
}
const signature = (layout) => JSON.stringify([...layout.cells.values()].map(({ occurrence, width, height, full, folded, variant, rowVariant }) => ({ occurrence, width, height, full, folded, variant, rowVariant })));

const model = menuModel();
model.resize({ width: 479, height: 616 });
assert.equal(model.layout().cells.get("menu").variant, "icons");
assert.equal(model.layout().cells.get("menu").width, 48);
assert.equal(model.layout().cells.get("menu/work").width, 431);
const signatures = new Map();
const started = performance.now();
for (let width = 0; width <= 1000; width += 1) {
	model.resize({ width, height: 616 });
	signatures.set(width, signature(model.layout()));
}
let changes = 0;
let last;
for (let width = 1000; width >= 0; width -= 1) {
	model.resize({ width, height: 616 });
	const layout = model.layout();
	assert.equal(signature(layout), signatures.get(width), `history-independent at ${width}px`);
	assert.equal(signature(model.layout()), signatures.get(width), `idempotent at ${width}px`);
	const variant = layout.cells.get("menu").variant;
	if (last && variant !== last) changes += 1;
	last = variant;
	assert.equal(layout.access.size, model.occurrences.size);
}
assert.equal(changes, 1, "one precise crossover, no alternating intervals");
console.log(`Menu pixel sweep: ${Math.round(performance.now() - started)}ms`);
model.resize({ width: 479, height: 616 });
model.setVariants("menu", [{ id: "labels", when: { minWidth: 55 } }, variants[1]]);
assert.equal(model.layout().cells.get("menu").variant, "labels", "explicit content changes can replace a variant declaration");
assert.throws(() => model.setVariants("menu", [{ id: "invalid" }]), /variant/);
assert.equal(model.layout().cells.get("menu").variant, "labels", "invalid updates leave the declaration intact");

function rowsModel() {
	const model = new Navigator({ root: "home", minViewportHeight: 80, destinations: {
		home: { title: "Home", min: 20, max: 20, overflow: { mode: "keep" } },
		split: { title: "Split", header: "title", rows: [
			{ destination: "one", minHeight: 40, preferredHeight: 160, maxHeight: 160, variants: [
				{ id: "expanded", when: { minHeight: 100 } },
				{ id: "compact", minHeight: 40, preferredHeight: 40, maxHeight: 99 },
			] },
			{ destination: "two", minHeight: 40, preferredHeight: 160, maxHeight: "*" },
		] },
		one: { title: "One", min: 40, preferred: 300, max: 300, variants: [
			{ id: "wide", when: { minWidth: 180 } },
			{ id: "narrow", min: 40, preferred: 100, max: 179 },
		] },
		two: { title: "Two", min: 40, preferred: 300, max: "*", variants: [
			{ id: "wide", when: { minWidth: 180 } },
			{ id: "narrow", min: 40, preferred: 100, max: "*" },
		] },
	} });
	model.open("split");
	return model;
}
const rows = rowsModel();
const grid = new Map();
for (const width of [0, 39, 60, 119, 179, 199, 200, 320, 700]) for (const height of [0, 39, 40, 79, 80, 120, 199, 200, 400]) {
	rows.resize({ width, height });
	const layout = rows.layout();
	grid.set(`${width}:${height}`, signature(layout));
	assert.equal(layout.access.size, rows.occurrences.size);
	for (const cell of layout.cells.values()) assert.ok(Number.isFinite(cell.width));
}
for (const [key, expected] of [...grid].reverse()) {
	const [width, height] = key.split(":").map(Number);
	rows.resize({ width, height });
	assert.equal(signature(rows.layout()), expected);
}
rows.resize({ width: 200, height: 120 });
assert.equal(rows.layout().rows.get("home/split/one").variant, "compact");
rows.unfold("home/split/one", "vertical");
const focused = signature(rows.layout());
rows.resize({ width: 700, height: 400 }); rows.layout();
rows.resize({ width: 200, height: 120 });
assert.equal(signature(rows.layout()), focused, "fold history never supplies responsive bounds");
assert.throws(() => rows.setVariants("split", [{ id: "expanded", when: { minHeight: 100 } }, { id: "compact", minHeight: 150, preferredHeight: 150, maxHeight: 160 }], { row: "one" }), /supported-height/);
assert.throws(() => rows.setVariants("split", [{ id: "expanded", when: { minHeight: 100 } }, { id: "compact", minHeight: 40, preferredHeight: 40, maxHeight: 40 }], { row: "one" }), /variant-gap/, "forms that leave heights between them unserved are refused");

for (const broken of [
	[{ id: "one" }, { id: "two" }],
	[{ id: "one", when: { minWidth: 100 } }, { id: "one" }],
	[{ id: "one", when: { minWidth: NaN } }, { id: "two" }],
	[{ id: "one", when: { minWidth: 100 } }, { id: "two", when: { minWidth: 50 } }],
	[{ id: "one", when: { minWidth: 100 } }, { id: "two", preferred: 20 }],
	[{ id: "one", when: () => true }, { id: "two" }],
]) assert.throws(() => new Navigator({ root: "menu", minViewportHeight: 100, destinations: {
	menu: { title: "Menu", min: 48, max: "*", preferred: 240, variants: broken },
} }), /variant/);

const gapped = { title: "Menu", min: 48, max: 320, preferred: 240, variants: [{ id: "labels", when: { minWidth: 161 } }, { id: "icons", min: 48, preferred: 48, max: 48 }] };
assert.deepEqual(validateDeclarationSet({ schemaVersion: 2, root: "menu", destinations: { menu: layoutOf(gapped) } }), [{ destination: "menu", reason: "variant-gap" }], "a width between two forms that neither admits is a declaration error");
assert.throws(() => new Navigator({ root: "menu", minViewportHeight: 100, destinations: { menu: gapped } }), /variant-gap/);
const reasons = (forms) => validateDeclarationSet({ schemaVersion: 2, root: "menu", destinations: { menu: layoutOf({ ...gapped, variants: forms }) } }).map((problem) => problem.reason);
assert.deepEqual(reasons([{ id: "labels", when: { minWidth: 161.2 } }, { id: "icons", min: 48, preferred: 48, max: 160.2 }]), ["variant-gap"], "fractional bounds may not skip a whole pixel");
assert.deepEqual(reasons([{ id: "large", when: { minWidth: 180 } }, { id: "medium", min: 100, preferred: 100, max: 179, when: { minWidth: 100, minHeight: 500 } }, { id: "small", min: 48, preferred: 48, max: 99 }]), ["variant-gap"], "a form that waits for height cannot be the only one to cover a width");
assert.deepEqual(reasons([{ id: "large", when: { minWidth: 180 } }, { id: "medium", min: 100, preferred: 100, max: 179, when: { minWidth: 100, minHeight: 500 } }, { id: "small", min: 48, preferred: 48, max: 179 }]), []);
const dragged = menuModel();
dragged.resize({ width: 479, height: 616 });
dragged.setSize("menu", 120);
assert.deepEqual([dragged.layout().cells.get("menu").variant, dragged.layout().cells.get("menu").width], ["icons", 120], "a divider stops at a width between the forms, in the smaller form");
const declaration = { title: "Menu", min: 48, max: 320, preferred: 240, variants };
assert.ok(sameLayout(declaration, structuredClone(declaration)));
assert.ok(!sameLayout(declaration, { ...declaration, variants: variants.map((variant) => variant.id === "icons" ? { ...variant, max: 50 } : variant) }));
assert.deepEqual(validateDeclarationSet({ schemaVersion: 2, root: "menu", destinations: { menu: layoutOf(declaration) } }), []);

const crowded = new Navigator({ root: "item-0", minViewportHeight: 100, destinations: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`item-${index}`, {
	title: `Item ${index}`, min: 20, preferred: 120, max: index === 19 ? "*" : 220, overflow: index === 0 ? { mode: "keep" } : undefined,
	variants: [{ id: "expanded", when: { minWidth: 120 } }, { id: "compact", preferred: 20, max: index === 19 ? "*" : 119 }],
}])) });
crowded.resize({ width: 200, height: 300 });
let parent = "item-0";
for (let index = 1; index < 20; index += 1) parent = crowded.open(`item-${index}`, { from: parent }).occurrence.id;
const crowdedStarted = performance.now();
const crowdedLayout = crowded.layout();
assert.equal([...crowdedLayout.cells.values()].filter((cell) => cell.full).length, 10);
assert.equal(crowdedLayout.access.size, 20);
console.log(`Twenty cells with folds: ${Math.round(performance.now() - crowdedStarted)}ms`);

const repeated = new Navigator({ root: "home", minViewportHeight: 150, destinations: {
	home: { title: "Home", min: 20, max: 20, overflow: { mode: "keep" } },
	split: { title: "Split", rows: [{ destination: "one", minHeight: 100, maxHeight: 100 }, { destination: "two", minHeight: 100, preferredHeight: 100, maxHeight: "*" }] },
	one: { title: "One", min: 20, max: 20, overflow: { mode: "keep" } },
	two: { title: "Two", min: 100, max: 100, overflow: { mode: "keep" } },
	common: { title: "Common", min: 30, preferred: 200, max: "*", variants: [{ id: "expanded", when: { minWidth: 180 } }, { id: "compact", preferred: 30, max: 179 }] },
} });
repeated.resize({ width: 280, height: 400 }); repeated.open("split");
repeated.open("common", { from: "home/split/one" }); repeated.open("common", { from: "home/split/two" });
const independent = repeated.layout();
assert.equal(independent.cells.get("home/split/one/common").variant, "expanded");
assert.equal(independent.cells.get("home/split/two/common").variant, "compact", "the same destination resolves independently at each occurrence");

const branchingDefinitions = structuredClone(rowsModel().destinations);
branchingDefinitions.one = { title: "One", min: 100, preferred: 100, max: 100 };
branchingDefinitions.large = { title: "Large", min: 200, preferred: 300, max: "*" };
branchingDefinitions.split.rows[0].variants[0].when.minWidth = 200;
const branching = new Navigator({ root: "home", minViewportHeight: 80, destinations: branchingDefinitions });
branching.resize({ width: 280, height: 120 }); branching.open("split"); branching.open("large", { from: "home/split/one" });
assert.equal(branching.layout().cells.get("home/split/one").folded, true);
assert.equal(branching.layout().rows.get("home/split/one").variant, "compact", "row admission applies when its root cell is folded");
assert.equal(branching.layout().cells.get("home/split/one/large").rowVariant, "compact", "visible row content receives the row's form");
branching.resize({ width: 280, height: 400 });
assert.equal(branching.layout().rows.get("home/split/one").variant, "expanded", "row width admission uses the whole row rather than the folded root");

const boundedDefinitions = structuredClone(rowsModel().destinations);
boundedDefinitions.two.max = 300;
boundedDefinitions.two.variants[1].max = 179;
boundedDefinitions.extra = { title: "Extra", min: 20, max: "*", preferred: 20 };
const bounded = new Navigator({ root: "home", minViewportHeight: 80, destinations: boundedDefinitions });
bounded.resize({ width: 140, height: 400 }); bounded.open("split");
assert.equal(bounded.layout().cells.get("home/split").resizeMax, 300, "a split divider can reach richer forms inside its rows");

const between = new Navigator({ root: "home", minViewportHeight: 80, destinations: {
	home: { title: "Home", min: 20, max: 20 },
	tail: { title: "Tail", min: 200, preferred: 200, max: "*" },
	split: { title: "Split", rows: [{ destination: "one", minHeight: 40, maxHeight: 100 }, { destination: "two", minHeight: 40, preferredHeight: 100, maxHeight: "*" }] },
	one: { title: "One", min: 40, preferred: 300, max: 300, variants: [{ id: "wide", when: { minWidth: 180 } }, { id: "narrow", min: 40, preferred: 100, max: 179 }] },
	two: { title: "Two", min: 40, preferred: 300, max: 300, variants: [{ id: "wide", when: { minWidth: 180 } }, { id: "narrow", min: 40, preferred: 100, max: 179 }] },
} });
between.resize({ width: 420, height: 400 }); between.open("split");
for (const size of [120, 150, 179]) {
	between.setSize("home/split", size);
	assert.deepEqual(["home/split", "home/split/one", "home/split/two"].map((id) => between.layout().cells.get(id).width), [size, size, size], `a dragged split holds ${size}px between the forms of its row cells`);
}

// allow-comment: a smaller form on its own is what allocation sees of it: its bounds up to its preference.
const materialized = (owner, form) => {
	const merged = { ...owner, ...form };
	delete merged.variants;
	if (form !== owner.variants[0]) for (const [maximum, preferred] of [["max", "preferred"], ["maxHeight", "preferredHeight"]]) if (Number.isFinite(merged[maximum]) && merged[preferred] != null) merged[maximum] = Math.min(merged[maximum], merged[preferred]);
	return merged;
};
for (const width of [60, 119, 179, 200, 320]) for (const height of [40, 80, 120, 200, 400]) {
	const source = rowsModel(); source.resize({ width, height });
	const actual = source.layout();
	let expected, expectedRank;
	for (let combination = 0; combination < 8; combination += 1) {
		const definitions = structuredClone(source.destinations);
		const owners = [definitions.split.rows[0], definitions.one, definitions.two];
		const forms = owners.map((owner, index) => owner.variants[combination >> (2 - index) & 1]);
		owners.forEach((owner, index) => { const merged = materialized(owner, forms[index]); delete owner.variants; Object.assign(owner, merged); });
		const candidate = new Navigator({ root: "home", minViewportHeight: 80, destinations: definitions });
		candidate.resize({ width, height }); candidate.open("split");
		const layout = candidate.layout();
		const one = layout.cells.get("home/split/one");
		const two = layout.cells.get("home/split/two");
		if (one?.full && layout.rows.get(one.occurrence).height < (forms[0].when?.minHeight ?? 0) || one?.full && one.width < (forms[1].when?.minWidth ?? 0) || two?.full && two.width < (forms[2].when?.minWidth ?? 0)) continue;
		const rank = [Number(layout.overflowX || layout.overflow), ...[...layout.cells.values()].reverse().map((cell) => cell.full ? 0 : cell.inView ? 1 : 2)];
		const differing = expectedRank ? rank.findIndex((value, index) => value !== expectedRank[index]) : -1;
		if (!expected || differing >= 0 && rank[differing] < expectedRank[differing]) { expected = layout; expectedRank = rank; }
	}
	assert.deepEqual([...actual.cells.values()].map((cell) => [cell.width, cell.height, cell.full, cell.folded]), [...expected.cells.values()].map((cell) => [cell.width, cell.height, cell.full, cell.folded]), `two-axis selection agrees with materialized candidates at ${width}x${height}`);
}

let seed = 173;
const random = (limit) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
for (let sample = 0; sample < 40; sample += 1) {
	const definitions = Object.fromEntries(Array.from({ length: 5 }, (_, index) => {
		const min = 20 + random(30);
		const expands = min + 50 + random(100);
		return [`cell-${index}`, { title: `Cell ${index}`, min, preferred: min + 100, max: index === 4 ? "*" : min + 200, overflow: index === 0 ? { mode: "keep" } : sample % 2 ? { mode: "hide" } : { mode: "fold", size: 4 }, variants: [
			{ id: "expanded", when: { minWidth: expands } },
			{ id: "compact", min, preferred: min, max: index === 4 ? "*" : expands - 1 },
		] }];
	}));
	const width = random(1000);
	const make = (destinations) => {
		const instance = new Navigator({ root: "cell-0", minViewportHeight: 100, destinations });
		instance.resize({ width, height: 300 });
		let from = "cell-0";
		for (let index = 1; index < 5; index += 1) { from = instance.open(`cell-${index}`, { from }).occurrence.id; }
		return instance;
	};
	const actualModel = make(definitions);
	const actual = actualModel.layout();
	let expected, expectedRank, expectedForms;
	for (let combination = 0; combination < 32; combination += 1) {
		const forms = Array.from({ length: 5 }, (_, index) => combination >> (4 - index) & 1);
		const candidateDefinitions = Object.fromEntries(Object.entries(definitions).map(([id, definition], index) => {
			const selected = definition.variants[forms[index]];
			return [id, materialized(definition, selected)];
		}));
		const candidate = make(candidateDefinitions).layout();
		const cells = [...candidate.cells.values()];
		if (cells.some((cell, index) => cell.full && !forms[index] && cell.width < definitions[`cell-${index}`].variants[0].when.minWidth)) continue;
		const rank = [Number(candidate.overflowX || candidate.overflow), ...cells.toReversed().map((cell) => cell.full ? 0 : cell.inView ? 1 : 2)];
		const firstDifferent = expectedRank ? rank.findIndex((value, index) => value !== expectedRank[index]) : -1;
		if (!expected || firstDifferent >= 0 && rank[firstDifferent] < expectedRank[firstDifferent]) { expected = candidate; expectedRank = rank; expectedForms = forms; }
	}
	assert.deepEqual([...actual.cells.values()].map((cell) => [cell.width, cell.full, cell.folded]), [...expected.cells.values()].map((cell) => [cell.width, cell.full, cell.folded]), `exact selection agrees with independent materialized candidates, sample ${sample}`);
	assert.deepEqual([...actual.cells.values()].map((cell) => cell.variant), expectedForms.map((form) => form ? "compact" : "expanded"));
	actualModel.occurrences = new Map([...actualModel.occurrences].reverse());
	assert.equal(signature(actualModel.layout()), signature(actual), "map insertion history is irrelevant");
}

console.log("Responsive variant scenarios passed");
