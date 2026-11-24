import { overflowMode, foldSize, overflowProblems } from "./overflow.js";
import { definitionFor, keepsVariants, pinVariants, resizeBounds, rowDefinitions, selectVariants } from "./variants.js";
import { CellCollection, DEFAULT_CURVE } from "./cell-collection.js";
import { aspectHeight } from "./aspect.js";

export const ELASTIC = "*";
export function isSplit(definition) {
	return Array.isArray(definition?.rows);
}

export function isBesideSplit(definition) {
	return definition?.placement === "beside-split";
}

// allow-comment: the split whose row holds an occurrence, or null for a cell in the root chain; a breakout and everything after it count as the root chain.
export function rowSplitOf(model, occurrence) {
	if (isBeside(model, occurrence)) return null;
	let current = occurrence;
	while (current.parent) {
		const parent = model.get(current.parent);
		if (isSplit(model.definitionOf(parent.destination))) return parent;
		if (isBeside(model, parent)) return null;
		current = parent;
	}
	return null;
}

// allow-comment: a full-height cell opened from a cell in a row stands beside that row's split, in the chain the split is in.
export function isBeside(model, occurrence) {
	if (!isBesideSplit(definitionFor(model, occurrence)) || !occurrence.parent) return false;
	return rowSplitOf(model, model.get(occurrence.parent)) !== null;
}

export function breakoutOf(model, split) {
	for (const occurrence of model.occurrences.values()) {
		if (isBeside(model, occurrence) && rowSplitOf(model, model.get(occurrence.parent)) === split) return occurrence;
	}
	return null;
}

export function widthBounds(definition) {
	const elastic = definition.max === ELASTIC;
	return { min: definition.min, max: elastic ? definition.preferred : definition.max, reach: elastic ? Infinity : definition.reach ?? definition.max, preferred: definition.preferred ?? null, ask: definition.preferred ?? definition.min, elastic };
}

function widthDefinition(model, occurrence, resizing) {
	if (!resizing) return definitionFor(model, occurrence);
	const owner = model.definitionOf(occurrence.destination);
	if (isSplit(owner)) return owner;
	const bounds = resizeBounds(owner);
	return { ...owner, min: bounds.min, max: bounds.max === Infinity ? ELASTIC : bounds.max, preferred: bounds.min };
}

// allow-comment: a split declares no width; its bounds are its widest row's. A row needs the sum of its cells' minima and gives that up one cell at a time from its left (steps), down to its newest cell with the kept cells (min); it asks for the sum of what its cells ask, preference or else minimum; it prefers the sum of its cells' preferences and reaches the sum of their maxima. Only what is open counts, never what is visible, so the demand cannot depend on its own outcome.
export function boundsOf(model, occurrence, resizing = false) {
	const definition = widthDefinition(model, occurrence, resizing);
	if (!isSplit(definition)) return { ...widthBounds(definition), steps: [definition.min] };
	const bounds = { min: 0, max: 0, reach: 0, preferred: 0, ask: 0, elastic: false };
	const rowSteps = [];
	rowDefinitions(model, occurrence).forEach((row, index) => {
		const root = occurrence.children?.[index] ? model.get(occurrence.children[index]) : null;
		const rowChain = root ? chainCells(model, root) : [{ destination: row.destination }];
		const cells = rowChain.map((cell) => widthDefinition(model, cell, resizing));
		const newest = cells[cells.length - 1];
		const modes = cells.map((cell, cellIndex) => pressureMode(model, root ? rowChain[cellIndex] : { parent: occurrence.id }, cell));
		const keptBefore = (count) => cells.slice(0, count).reduce((sum, cell, cellIndex) => sum + (modes[cellIndex] === "keep" ? cell.min : modes[cellIndex] === "hide" ? 0 : foldSize(cell)), 0);
		const active = root ? activeCell(model, root, rowChain) : rowChain.at(-1)?.id;
		const activeIndex = Math.max(0, rowChain.findIndex((cell) => cell.id === active));
		const protectedMin = cells.reduce((sum, cell, cellIndex) => {
			if (modes[cellIndex] === "keep" || cellIndex === activeIndex || (cellIndex > activeIndex && modes[cellIndex] === "hide")) return sum + cell.min;
			return sum + (modes[cellIndex] === "hide" && cellIndex < activeIndex ? 0 : foldSize(cell));
		}, 0);
		const steps = cells.map((cell, dropped) => Math.max(protectedMin, keptBefore(dropped) + cells.slice(dropped).reduce((sum, member) => sum + member.min, 0)));
		rowSteps.push(steps);
		const min = steps[steps.length - 1];
		const preferred = cells.reduce((sum, cell) => sum + (widthBounds(cell).preferred ?? widthBounds(cell).max), 0);
		const ask = cells.reduce((sum, cell) => sum + widthBounds(cell).ask, 0);
		const max = cells.reduce((sum, cell) => sum + widthBounds(cell).max, 0);
		const elastic = cells.some((cell) => cell.max === ELASTIC);
		bounds.min = Math.max(bounds.min, min);
		bounds.preferred = Math.max(bounds.preferred, preferred);
		bounds.ask = Math.max(bounds.ask, ask);
		bounds.max = Math.max(bounds.max, max);
		bounds.reach = Math.max(bounds.reach, cells.reduce((sum, cell) => sum + widthBounds(cell).reach, 0));
		bounds.elastic ||= elastic;
	});
	const length = Math.max(...rowSteps.map((steps) => steps.length));
	const steps = Array.from({ length }, (_, level) => Math.max(...rowSteps.map((row) => row[Math.min(level, row.length - 1)])));
	return { ...bounds, steps, max: bounds.elastic ? bounds.preferred : bounds.max };
}

export function heightBounds(row) {
	const elastic = row.maxHeight === ELASTIC;
	return { min: row.minHeight, max: elastic ? row.preferredHeight : row.maxHeight, reach: elastic ? Infinity : row.reach ?? row.maxHeight, preferred: row.preferredHeight ?? null, elastic };
}

function snapAllocation(allocation) {
	if (allocation.cells.some((cell) => cell.actual > 0 && cell.actual < 1)) return allocation;
	let edge = 0;
	for (const cell of allocation.cells) {
		const actual = cell.actual;
		const next = Math.round(edge + actual);
		cell.actual = next - Math.round(edge);
		edge += actual;
	}
	return allocation;
}

export function validateSplit(model, definitionId, parentOccurrence) {
	const definition = model.definitionOf(definitionId);
	const { maxRows } = model.chrome;
	const rows = definition.rows;
	const chrome = headerOf(model, definition);
	const base = { ok: false, rows: [], chrome: null, supported: model.minViewportHeight };
	if (parentOccurrence && chainRootOf(model, parentOccurrence).parent) return { ...base, reason: "nested-split" };
	if (rows.length === 0) return { ...base, reason: "no-rows" };
	if (rows.length > maxRows) return { ...base, reason: "too-many-rows", count: rows.length, maxRows };
	const seen = new Set();
	const results = rows.map((row, index) => {
		const rowDefinition = model.definitionOf(row.destination);
		const problems = [];
		if (!(Number.isFinite(row.minHeight) && row.minHeight > 0) || (row.maxHeight !== ELASTIC && !(Number.isFinite(row.maxHeight) && row.maxHeight > 0))) problems.push("invalid-row-size");
		if (!rowDefinition) problems.push("unknown-row-destination");
		if (rowDefinition && isSplit(rowDefinition)) problems.push("split-row");
		if (rowDefinition && isBesideSplit(rowDefinition)) problems.push("beside-split-on-row");
		if (rowDefinition?.aspectRatio != null && row.maxHeight === ELASTIC) problems.push("aspect-ratio-on-elastic-row");
		if (seen.has(row.destination)) problems.push("duplicate-row-destination");
		seen.add(row.destination);
		if (row.minHeight > heightBounds(row).reach) problems.push("row-min-exceeds-max");
		if (row.maxHeight === ELASTIC && !(Number.isFinite(row.preferredHeight) && row.preferredHeight >= row.minHeight)) problems.push("elastic-without-preferred");
		if (row.maxHeight !== ELASTIC && row.preferredHeight != null && (!Number.isFinite(row.preferredHeight) || row.preferredHeight < row.minHeight || row.preferredHeight > row.maxHeight)) problems.push("invalid-preferred");
		problems.push(...overflowProblems(row, row.minHeight));
		if (rowDefinition && rowDefinition.min > widthBounds(rowDefinition).reach) problems.push("cell-min-exceeds-max");
		const required = chrome + Math.max(row.minHeight, row.variants?.at(-1)?.minHeight ?? row.minHeight);
		if (required > model.minViewportHeight) problems.push("exceeds-supported-height");
		return {
			row: index,
			title: rowDefinition?.title ?? row.destination,
			required,
			chrome,
			supported: model.minViewportHeight,
			ok: problems.length === 0,
			problems,
		};
	});
	const elastic = rows.filter((row) => row.maxHeight === ELASTIC).length;
	const rowsOk = results.every((row) => row.ok);
	const reason = !rowsOk ? "invalid-rows" : elastic === 0 ? "no-elastic-row" : elastic > 1 ? "several-elastic-rows" : null;
	return { ok: reason === null, reason, rows: results, chrome, supported: model.minViewportHeight };
}

// allow-comment: a split that declares header: "title" draws it above its rows; that bar is chrome the rows do not get.
export function headerOf(model, definition) {
	return definition.header === "title" ? model.chrome.header : 0;
}

export function chainRootOf(model, occurrence) {
	let current = occurrence;
	for (;;) {
		if (isBeside(model, current)) current = rowSplitOf(model, model.get(current.parent));
		const parent = current.parent ? model.get(current.parent) : null;
		if (!parent || isSplit(model.definitionOf(parent.destination))) return current;
		current = parent;
	}
}

export function chainCells(model, chainRoot) {
	const cells = [chainRoot];
	let current = chainRoot;
	for (;;) {
		let next = null;
		if (isSplit(model.definitionOf(current.destination))) next = breakoutOf(model, current);
		else if (current.children[0]) {
			const child = model.get(current.children[0]);
			next = child && !isBeside(model, child) ? child : null;
		}
		if (!next || model.withheld?.has(next.id)) return cells;
		cells.push(next);
		current = next;
	}
}

const minDemand = (model, occurrence) => boundsOf(model, occurrence).steps[0];
const askDemand = (model, occurrence) => boundsOf(model, occurrence).ask;

function unfoldedIn(model, cells) {
	const root = chainRootOf(model, cells[0]);
	return new Set((model.unfolded ?? []).filter((entry) => entry.scope === root.id).map((entry) => entry.occurrence));
}

function belowKept(model, occurrence) {
	let below = occurrence;
	for (let above = occurrence.parent ? model.get(occurrence.parent) : null; above; below = above, above = above.parent ? model.get(above.parent) : null) {
		const definition = definitionFor(model, above);
		if (overflowMode(definition) === "keep") return true;
		const row = isSplit(definition) ? above.children?.indexOf(below.id) ?? -1 : -1;
		if (row >= 0 && rowDefinitions(model, above).slice(0, row + 1).some((candidate) => overflowMode(candidate) === "keep")) return true;
	}
	return false;
}

function pressureMode(model, occurrence, definition) {
	if (overflowMode(definition) === "keep") return "keep";
	return belowKept(model, occurrence) ? "fold" : "hide";
}

function foldPass(model, cells, width, demandOf, held) {
	const root = chainRootOf(model, cells[0]);
	const active = activeCell(model, root, cells);
	const unfolded = unfoldedIn(model, cells);
	const required = cells.reduce((sum, occurrence) => sum + demandOf(model, occurrence), 0);
	const chosen = chooseFolds(cells.length, cells.findIndex((cell) => cell.id === active), (index) => unfolded.has(cells[index].id), required, width, (index) => {
		const definition = definitionFor(model, cells[index]);
		if (held.has(cells[index].id)) return null;
		return isSplit(definition) || pressureMode(model, cells[index], definition) !== "fold" ? null : demandOf(model, cells[index]) - foldSize(definition);
	});
	return new Map(chosen.map((index) => [cells[index].id, foldSize(definitionFor(model, cells[index]))]));
}

// allow-comment: folds go farthest from the active member first, the earlier before the later on a tie; a member the user unfolded goes after every other.
function chooseFolds(count, activeIndex, unfolded, required, budget, saving) {
	const chosen = [];
	const candidates = [...Array(count).keys()].filter((index) => index !== activeIndex).sort((a, b) => unfolded(a) - unfolded(b) || Math.abs(b - activeIndex) - Math.abs(a - activeIndex) || a - b);
	for (const index of candidates) {
		if (required <= budget) break;
		const saved = saving(index);
		if (saved === null) continue;
		chosen.push(index);
		required -= saved;
	}
	return chosen;
}

export function chainFits(model, cells, width) {
	return cells.reduce((sum, occurrence) => sum + boundsOf(model, occurrence).min, 0) <= width;
}

function sessionBounds(base, session, hard) {
	if (session === null) return { min: base.min, max: base.max, preferred: base.preferred ?? null, ask: base.ask ?? base.preferred ?? base.min, elastic: !!base.elastic };
	const size = Math.min(base.reach ?? base.max, Math.max(base.min, session));
	return { min: hard ? size : base.min, max: size, preferred: size, ask: hard ? size : base.ask ?? base.min, elastic: !!base.elastic };
}

function distributeSessions(configs, bounds, budget, anchor, curve) {
	const distribute = (members) => snapAllocation(new CellCollection(members, curve, "min").distribute(budget, anchor));
	const minimum = (bound) => Math.min(bound.min, bound.steps?.[0] ?? bound.min);
	if (bounds.reduce((sum, bound) => sum + bound.min, 0) > budget) return distribute(configs.map((config, index) => ({ ...config, ...sessionBounds(bounds[index], bounds[index].session, false) })));
	let allocation = distribute(configs);
	const sized = [...configs];
	for (const [index, bound] of bounds.entries()) {
		if (bound.session === null || configs[index].id === anchor) continue;
		let before = 0;
		for (let prefix = 0; prefix < index; prefix += 1) {
			const size = allocation.cells[prefix].actual;
			before += size;
			sized[prefix] = { ...sized[prefix], min: size, max: size, elastic: false };
		}
		const after = bounds.slice(index + 1).reduce((sum, next) => sum + minimum(next), 0);
		const maximum = Math.max(minimum(bound), Math.min(bound.reach ?? bound.max, budget - before - after));
		const size = Math.min(maximum, Math.max(minimum(bound), bound.session));
		sized[index] = { ...configs[index], min: size, max: size, elastic: false };
		for (let suffix = index + 1; suffix < sized.length; suffix += 1) sized[suffix] = { ...sized[suffix], min: minimum(bounds[suffix]) };
		allocation = distribute(sized);
	}
	return allocation;
}

function zoomAnchors(model) {
	const anchors = new Set();
	let current = model.zoomed ? model.get(model.zoomed) : null;
	while (current) {
		anchors.add(current.id);
		const root = chainRootOf(model, current);
		current = root.parent ? model.get(root.parent) : null;
	}
	return anchors;
}

function activeCell(model, root, cells) {
	const anchors = zoomAnchors(model);
	return cells.find((cell) => anchors.has(cell.id))?.id
		?? model.windowStarts.get(root.id)
		?? cells.at(-1)?.id;
}

function activeRow(model, split, roots) {
	const zoomed = model.zoomed && model.get(model.zoomed);
	const root = zoomed && chainRootOf(model, zoomed);
	return (root?.parent === split.id ? root.id : null)
		?? model.rowStarts.get(split.id)
		?? roots.at(-1)?.id;
}

// allow-comment: room gives way in reading order, in one walk from the left: a cell before a split hides first, then the split gives its widest row up one cell at a time from the row's left, then the split itself hides; the newest cell always stays. The walk first makes room for what every cell asks (its preference, or its minimum without one), folding and hiding by each cell's overflow mode; only when the cells that cannot give way ask more than there is does it settle for the minima instead. What is left shares the width with the demand that walk settled on.
function settleChain(model, cells, width, protectedIndex, demandOf, laddered, held = new Set()) {
	const fold = foldPass(model, cells, width, demandOf, held);
	const units = cells.map((occurrence, index) => {
		const definition = definitionFor(model, occurrence);
		const own = boundsOf(model, occurrence);
		const steps = fold.has(occurrence.id) ? [fold.get(occurrence.id)] : laddered ? own.steps : [demandOf(model, occurrence)];
		return { occurrence, definition, own, steps, level: 0, hidden: false, keep: overflowMode(definition) === "keep" || fold.has(occurrence.id) || held.has(occurrence.id) || index >= protectedIndex };
	});
	const demand = (unit) => unit.steps[unit.level];
	let total = units.reduce((sum, unit) => sum + demand(unit), 0);
	for (let index = 0; index < units.length && total > width; ) {
		const unit = units[index];
		if (unit.hidden) {
			index += 1;
			continue;
		}
		if (unit.level < unit.steps.length - 1) {
			total -= demand(unit);
			unit.level += 1;
			total += demand(unit);
			continue;
		}
		if (unit.keep || index === units.length - 1) {
			index += 1;
			continue;
		}
		unit.hidden = true;
		total -= demand(unit);
		index += 1;
	}
	// allow-comment: a cell stands on its minimum and the curve decides the rest, but a split stands on what it asked for when the walk made room for it: its rows were promised that room, and below it they would start hiding cells of their own.
	const floorOf = (unit) => fold.has(unit.occurrence.id) ? fold.get(unit.occurrence.id) : laddered ? unit.steps[unit.level] : isSplit(unit.definition) ? unit.steps[0] : unit.own.steps[0];
	return { fold, units, total, floorOf };
}

function grownOccurrence(model) {
	return model.grown && !model.zoomed ? model.get(model.grown) ?? null : null;
}

// allow-comment: the cell with focus asks its preference; a split asks what lets that cell reach it beside the minima of its row.
function growthIn(model, cells) {
	const grown = grownOccurrence(model);
	if (!grown || model.sizeOf(grown.id, "width") !== null) return null;
	const definition = definitionFor(model, grown);
	const preferred = typeof definition.growOnFocus === "number" ? definition.growOnFocus : widthBounds(definition).preferred;
	if (preferred === null) return null;
	const own = cells.findIndex((cell) => cell.id === grown.id);
	if (own >= 0) return { occurrence: cells[own], preferred };
	for (const cell of cells) {
		if (!isSplit(definitionFor(model, cell))) continue;
		const row = (cell.children ?? []).map((id) => model.get(id)).filter(Boolean).map((root) => chainCells(model, root)).find((chain) => chain.some((member) => member.id === grown.id));
		if (row) return { occurrence: cell, preferred: row.reduce((sum, member) => sum + (member.id === grown.id ? preferred : definitionFor(model, member).min), 0) };
	}
	return null;
}

// allow-comment: the member with focus asks its preference, and the others give way for it the way they give way to a narrow window: first the members before it from the leading end, hiding or folding by their overflow mode, then the members after it from the trailing end, which fold. A kept member and a split after it stay. Nothing closes, so the ordinary layout returns when focus leaves.
function giveWay(model, units, fold, target, preferred, width, floorOf) {
	const want = Math.min(preferred, target.own.reach ?? target.own.max);
	const standing = (unit) => {
		if (unit.hidden) return 0;
		if (fold.has(unit.occurrence.id)) return fold.get(unit.occurrence.id);
		if (unit === target) return want;
		const session = model.sizeOf(unit.occurrence.id, "width");
		return Math.max(floorOf(unit), session ?? 0, model.variantFloors?.width.get(unit.occurrence.id) ?? 0);
	};
	let over = units.reduce((sum, unit) => sum + standing(unit), 0) - width;
	const at = units.indexOf(target);
	const order = [...units.slice(0, at), ...units.slice(at + 1).reverse()];
	for (const unit of order) {
		if (over <= 0) break;
		if (unit.hidden || fold.has(unit.occurrence.id) || overflowMode(unit.definition) === "keep") continue;
		const before = units.indexOf(unit) < at;
		const mode = before ? pressureMode(model, unit.occurrence, unit.definition) : "fold";
		if (mode === "fold" && isSplit(unit.definition)) continue;
		const stood = standing(unit);
		if (mode === "hide") unit.hidden = true;
		else fold.set(unit.occurrence.id, foldSize(unit.definition));
		over -= stood - standing(unit);
	}
}

// allow-comment: growth raises one member's floor after the ordinary distribution and never lowers it, toward its preference and within what the members still standing leave above their own floors.
function raisedFloor(bounds, sizes, index, preferred, budget, holds) {
	const others = bounds.reduce((sum, bound, position) => position === index ? sum : sum + holds[position].min, 0);
	const target = Math.min(preferred, bounds[index].reach ?? bounds[index].max, budget - others);
	return target > sizes[index] + 0.5 ? target : null;
}

// allow-comment: what a member keeps while another grows: a session size it was given, or its minimum, raised to where the form it shows still holds.
function heldBound(bound, size, admission) {
	const session = bound.session === null || bound.session === undefined ? bound.min : Math.min(bound.reach ?? bound.max, Math.max(bound.min, bound.session));
	return withFloor(bound, Math.max(session, Math.min(admission ?? 0, size)));
}

function withFloor(bound, floor) {
	return { ...bound, min: floor, max: Math.max(bound.max, floor) };
}

function growInto(bounds, sizes, index, preferred, budget, admissions) {
	const holds = bounds.map((bound, position) => position === index ? bound : admissions[position] ? heldBound(bound, sizes[position], admissions[position]) : bound);
	const floor = raisedFloor(bounds, sizes, index, preferred, budget, bounds.map((bound, position) => heldBound(bound, sizes[position], admissions[position])));
	return floor === null ? null : holds.map((bound, position) => position === index ? withFloor(bound, floor) : bound);
}

// allow-comment: a split that widens for a cell with focus hands its rows more room, but which of their cells show and fold stays what the split's ordinary width decided.
function visibilityWidth(model, cells, width) {
	const root = chainRootOf(model, cells[0]);
	return model.grown && root.parent ? Math.min(width, chainWidth(withGrowth(model, null), root)) : width;
}

function allocateChain(model, cells, width) {
	const shown = visibilityWidth(model, cells, width);
	const anchors = zoomAnchors(model);
	const anchor = cells.find((occurrence) => anchors.has(occurrence.id))?.id ?? null;
	const active = activeCell(model, chainRootOf(model, cells[0]), cells);
	const protectedIndex = Math.max(0, cells.findIndex((occurrence) => occurrence.id === active));
	// allow-comment: a cell the user unfolded stands while every other cell gives way by its overflow mode; only when that is not enough does it fold like the others.
	const unfolded = unfoldedIn(model, cells);
	let settled = unfolded.size ? settleChain(model, cells, shown, protectedIndex, askDemand, false, unfolded) : null;
	if (!settled || settled.total > shown) settled = settleChain(model, cells, shown, protectedIndex, askDemand, false);
	if (settled.total > shown) settled = settleChain(model, cells, shown, protectedIndex, minDemand, true);
	const { fold, units, floorOf } = settled;
	const split = chainRootOf(model, cells[0]).parent;
	const sizedRow = !!split && model.sizeOf(split, "width") !== null;
	const growth = growthIn(model, cells);
	const grownUnit = growth && !sizedRow ? units.find((unit) => unit.occurrence.id === growth.occurrence.id && !unit.hidden && !fold.has(unit.occurrence.id)) : null;
	if (grownUnit) giveWay(model, units, fold, grownUnit, growth.preferred, width, floorOf);
	const members = units.filter((unit) => !unit.hidden);
	// allow-comment: a split the user sized hands that width to its rows: the newest cell of a row takes what its row was given, up to where its next form takes over, as if the divider were its own.
	const bounds = members.map((unit, index) => {
		if (fold.has(unit.occurrence.id)) return { min: floorOf(unit), max: floorOf(unit), preferred: null, session: null };
		return { ...unit.own, min: Math.min(floorOf(unit), unit.own.max), session: model.sizeOf(unit.occurrence.id, "width") ?? (sizedRow && index === members.length - 1 ? width : null) };
	});
	const configs = members.map((unit, index) => {
		const config = { id: unit.occurrence.id, title: unit.occurrence.title, keep: unit.keep, ...sessionBounds(bounds[index], null, false) };
		return unit.occurrence.id === anchor ? { ...config, zoomable: true, elastic: true } : config;
	});
	let sharing = distributeSessions(configs, bounds, width, anchor, model.curve ?? DEFAULT_CURVE);
	const grownIndex = grownUnit ? members.indexOf(grownUnit) : -1;
	if (grownIndex >= 0) {
		const shared = new Map(sharing.cells.map((cell) => [cell.config.id, cell.actual]));
		const raised = growInto(bounds, members.map((unit) => shared.get(unit.occurrence.id) ?? 0), grownIndex, growth.preferred, width, members.map((unit) => model.variantFloors?.width.get(unit.occurrence.id)));
		if (raised) sharing = distributeSessions(configs.map((config, index) => raised[index] === bounds[index] ? config : { ...config, ...sessionBounds(raised[index], null, false) }), raised, width, anchor, model.curve ?? DEFAULT_CURVE);
	}
	const byId = new Map(sharing.cells.map((cell) => [cell.config.id, cell]));
	const allocation = { ...sharing, cells: cells.map((occurrence) => byId.get(occurrence.id) ?? { config: { id: occurrence.id, title: occurrence.title }, actual: 0, visible: false }) };
	return { allocation, fold };
}

export function chainWidth(model, chainRoot) {
	if (!chainRoot.parent) return model.size.width;
	const split = model.get(chainRoot.parent);
	const outerRoot = chainRootOf(model, split);
	const outerWidth = chainWidth(model, outerRoot);
	const { allocation } = allocateChain(model, chainCells(model, outerRoot), outerWidth);
	const index = allocation.cells.findIndex((candidate) => candidate.config.id === split.id);
	if (index < 0 || !allocation.cells[index].visible) return Math.min(boundsOf(model, split).min, outerWidth);
	const before = allocation.cells.slice(0, index).reduce((sum, candidate) => sum + candidate.actual, 0);
	return Math.min(allocation.cells[index].actual, Math.max(0, outerWidth - before));
}

// allow-comment: growth is a presentation input, so it rides on a view of the model and never reaches navigation, snapshots or the decisions they make.
export function withGrowth(model, grown) {
	if (!grown && !model.grown) return model;
	const view = Object.create(model);
	view.grown = grown ?? null;
	return view;
}

// allow-comment: growth lays out once more on top of the ordinary layout, with its forms pinned. Members may give way in that layout; when one would appear or unfold that the ordinary layout holds back, a form would no longer hold, or an open cell would lose its route, the ordinary layout stands.
export function layoutWorkspace(model) {
	const plain = selectVariants(withGrowth(model, null), layoutWorkspaceFor);
	if (!grownOccurrence(model)) return plain;
	let grown;
	try {
		grown = layoutWorkspaceFor(pinVariants(model, plain));
	} catch (error) {
		if (error instanceof LayoutRefusal) return plain;
		throw error;
	}
	return keepsVariants(model, grown, plain) && standsAsLarge(model, grown, plain) ? grown : plain;
}

// allow-comment: a layout the allocator refuses on purpose: no cell would stay active, or an open cell would lose its route.
class LayoutRefusal extends Error {}

// allow-comment: the cell with focus and every row around it end at least as large as in the ordinary layout, on both axes: what gives way for it can lower an aspect-ratio ceiling.
function standsAsLarge(model, grown, plain) {
	const occurrence = grownOccurrence(model);
	if (grown.cells.get(occurrence.id).width < plain.cells.get(occurrence.id).width - 0.5) return false;
	for (let root = chainRootOf(model, occurrence); root.parent; root = chainRootOf(model, model.get(root.parent))) {
		if ((grown.rows.get(root.id)?.height ?? 0) < (plain.rows.get(root.id)?.height ?? 0) - 0.5) return false;
	}
	return true;
}

function layoutWorkspaceFor(model) {
	const height = Math.max(0, model.size.height);
	const chain = layoutChain(model, model.root, model.size.width, height, true);
	const index = { cells: new Map(), rows: new Map(), chains: new Map() };
	indexChain(chain, index);
	const layout = {
		width: model.size.width,
		height: model.size.height,
		overflow: chain.overflow,
		overflowX: chain.contentWidth > model.size.width,
		contentHeight: Math.max(height, chain.contentHeight),
		chain,
		...index,
	};
	if (![...layout.cells.values()].some((cell) => cell.full && cell.width > 0)) throw new LayoutRefusal("A workspace layout must retain an active cell");
	layout.back = model.zoomed ? null : model.upTarget(layout);
	layout.access = accessRoutes(model, layout);
	return layout;
}

// allow-comment: a fold lies collapsed on its leading edge. Before the active member it opens toward the trailing side, where the members after it give way; after the active member nothing follows it to yield, so it opens toward the leading side. Adjacent folds share one handle, which names the fold nearest the active member; the others follow as that one opens.
function planFolds(members, focus, axis) {
	const focused = members.findIndex((member) => member.occurrence === focus && member.visible && !member.folded);
	const active = focused >= 0 ? focused : members.findLastIndex((member) => member.visible && !member.folded);
	const [backward, forward] = axis === "horizontal" ? ["left", "right"] : ["up", "down"];
	let run = [];
	const close = () => {
		const handle = run.length && (run[0].foldDirection === forward ? run.at(-1) : run[0]).occurrence;
		for (const member of run) member.foldHandle = handle;
		run = [];
	};
	for (const [index, member] of members.entries()) {
		if (member.folded) {
			member.foldDirection = index < active ? forward : backward;
			member.foldOpening = member.foldDirection;
			run.push(member);
		} else if (member.visible) close();
	}
	close();
}

function accessRoutes(model, layout) {
	const back = layout.back;
	const routes = new Map();
	for (const occurrence of model.occurrences.values()) {
		if (model.withheld?.has(occurrence.id)) continue;
		let route = layout.cells.get(occurrence.id)?.full ? { kind: "visible", occurrence: occurrence.id } : model.zoomed ? { kind: "zoom-out" } : null;
		for (let member = occurrence; !route && member; member = model.get(member.parent)) {
			for (const [axis, placement] of [["vertical", layout.rows.get(member.id)], ["horizontal", layout.cells.get(member.id)]]) {
				if (!placement?.folded || !placement.inView) continue;
				if (["left", "up"].includes(placement.foldDirection)) route = { kind: "fold", occurrence: placement.foldHandle, axis };
				else if (back) route = { kind: "back", occurrence: back.id };
				break;
			}
		}
		if (!route && back && model.placeOf(occurrence, layout) === "above") route = { kind: "back", occurrence: back.id };
		if (!route) throw new LayoutRefusal(`No navigation route to open cell ${occurrence.id}`);
		routes.set(occurrence.id, route);
	}
	return routes;
}

function indexChain(chain, index) {
	index.chains.set(chain.root, chain);
	for (const cell of chain.cells) {
		index.cells.set(cell.occurrence, cell);
		if (!cell.rows) continue;
		for (const row of cell.rows.rows) {
			index.rows.set(row.occurrence, row);
			if (row.chain) indexChain(row.chain, index);
		}
	}
}

function layoutChain(model, chainRoot, width, height, containerInView) {
	const cells = chainCells(model, chainRoot);
	const { allocation, fold } = allocateChain(model, cells, width);
	const byId = new Map(allocation.cells.map((cell) => [cell.config.id, cell]));
	let overflow = false;
	let contentHeight = height;
	const layoutCells = cells.map((occurrence, index) => {
		const definition = definitionFor(model, occurrence);
		const allocated = byId.get(occurrence.id);
		const bounds = boundsOf(model, occurrence);
		const resize = boundsOf(model, occurrence, true);
		const visible = !!allocated && (allocated.visible || fold.has(occurrence.id));
		const cellWidth = visible ? allocated.actual : bounds.min;
		const isFolded = visible && fold.has(occurrence.id);
		const inView = containerInView && visible;
		const cell = { occurrence: occurrence.id, title: occurrence.title, width: cellWidth, height, visible, folded: isFolded, inView, full: inView && !isFolded, kept: overflowMode(definition) === "keep", sized: model.sizeOf(occurrence.id, "width") !== null, min: bounds.min, max: bounds.reach, resizeMin: resize.min, resizeMax: resize.reach };
		if (isSplit(definition)) {
			const bar = headerOf(model, definition);
			cell.rows = layoutRows(model, occurrence, cellWidth, Math.max(0, height - bar), inView);
			overflow = overflow || cell.rows.overflow;
			contentHeight = Math.max(contentHeight, cell.rows.contentHeight + bar);
		}
		return cell;
	});
	planFolds(layoutCells, activeCell(model, chainRoot, cells), "horizontal");
	const contentWidth = layoutCells.reduce((sum, cell) => sum + (cell.visible ? cell.width : 0), 0);
	return {
		root: chainRoot.id,
		width,
		height,
		contentWidth: Math.max(width, contentWidth),
		spare: Math.max(0, width - contentWidth),
		cells: layoutCells,
		revealOffset: 0,
		overflow,
		contentHeight,
	};
}

// allow-comment: the height at which the row's cells that declare an aspectRatio show their content whole at the widths they get, the tallest of them; cell widths never depend on the row's height, so this needs no second pass. Hidden and folded cells show nothing and ask nothing.
function fitHeightOf(model, root, width) {
	const cells = chainCells(model, root);
	if (!cells.some((occurrence) => definitionFor(model, occurrence).aspectRatio != null)) return null;
	const { allocation, fold } = allocateChain(model, cells, width);
	let fit = null;
	allocation.cells.forEach((cell, index) => {
		const definition = definitionFor(model, cells[index]);
		if (definition.aspectRatio == null || !cell.visible || fold.has(cell.config.id)) return;
		fit = Math.max(fit ?? 0, aspectHeight(definition, cell.actual, headerOf(model, definition)));
	});
	return fit === null ? null : Math.ceil(fit);
}

// allow-comment: a fit height is a second ceiling beside maxHeight, never below minHeight; a session size above it stays stored and returns when the row widens.
function fitBounds(bounds, fit) {
	if (fit === null || bounds.elastic) return bounds;
	const ceiling = Math.max(bounds.min, fit);
	return { ...bounds, max: Math.min(bounds.max, ceiling), reach: Math.min(bounds.reach, ceiling), preferred: bounds.preferred === null ? null : Math.min(bounds.preferred, ceiling) };
}

// allow-comment: the divider travels through every form of the row, so its fit ceiling caps the range of all forms together, never the selected form alone.
function resizeCeiling(range, fit) {
	return fit === null ? range.max : Math.max(range.min, Math.min(range.max, fit));
}

function layoutRows(model, split, width, height, containerInView) {
	const definition = rowDefinitions(model, split);
	const owners = model.definitionOf(split.destination).rows;
	const roots = definition.map((row, index) => model.get(split.children[index]));
	const fits = roots.map((root, index) => root && definition[index].maxHeight !== ELASTIC ? fitHeightOf(model, root, width) : null);
	const boundsAt = (index) => fitBounds(heightBounds(definition[index]), fits[index]);
	const budget = Math.max(0, height);
	const required = definition.reduce((sum, row) => sum + row.minHeight, 0);
	const belowKeptRow = (index) => definition.slice(0, index).some((row) => overflowMode(row) === "keep");
	const rowFolds = (activeIndex) => chooseFolds(roots.length, activeIndex, () => false, required, budget, (index) => overflowMode(definition[index]) === "keep" || !(belowKeptRow(index) || belowKept(model, roots[index])) ? null : definition[index].minHeight - foldSize(definition[index]));
	// allow-comment: the other rows fold for the row with focus, the farthest from it first; a kept row stays.
	const rowsGiveWay = (folded, grownRow, preferred) => {
		const standing = (index) => folded.has(index) ? foldSize(definition[index]) : index === grownRow ? preferred : Math.max(definition[index].minHeight, model.sizeOf(roots[index].id, "height") ?? 0, model.variantFloors?.height.get(roots[index].id) ?? 0);
		let over = roots.reduce((sum, root, index) => sum + standing(index), 0) - budget;
		const order = roots.map((root, index) => index).filter((index) => index !== grownRow).sort((a, b) => Math.abs(b - grownRow) - Math.abs(a - grownRow) || a - b);
		for (const index of order) {
			if (over <= 0) break;
			if (folded.has(index) || overflowMode(definition[index]) === "keep") continue;
			const stood = standing(index);
			folded.add(index);
			over -= stood - standing(index);
		}
	};
	const allocate = () => {
		const shown = roots.map((root, index) => index);
		const active = activeRow(model, split, roots);
		const activeIndex = roots.findIndex((root) => root.id === active);
		const folded = new Set(rowFolds(activeIndex));
		const grown = grownOccurrence(model);
		const grownRow = grown ? roots.findIndex((root, index) => root && !folded.has(index) && model.sizeOf(root.id, "height") === null && boundsAt(index).preferred !== null && chainCells(model, root).some((member) => member.id === grown.id)) : -1;
		if (grownRow >= 0) rowsGiveWay(folded, grownRow, boundsAt(grownRow).preferred);
		const bounds = shown.map((index) => folded.has(index) ? { min: foldSize(definition[index]), max: foldSize(definition[index]), preferred: null, session: null } : { ...boundsAt(index), session: model.sizeOf(roots[index].id, "height") });
		const configs = shown.map((index, position) => ({ id: roots[index].id, title: roots[index].title, keep: overflowMode(definition[index]) === "keep" || folded.has(index) || index >= Math.max(0, activeIndex), ...sessionBounds(bounds[position], null, false) }));
		let allocation = distributeSessions(configs, bounds, budget, null, model.curve ?? DEFAULT_CURVE);
		if (grownRow >= 0) {
			const shared = new Map(allocation.cells.map((cell) => [cell.config.id, cell.actual]));
			const raised = growInto(bounds, roots.map((root) => shared.get(root.id) ?? 0), grownRow, bounds[grownRow].preferred, budget, roots.map((root, index) => folded.has(index) ? undefined : model.variantFloors?.height.get(root.id)));
			if (raised) allocation = distributeSessions(configs.map((config, index) => raised[index] === bounds[index] ? config : { ...config, ...sessionBounds(raised[index], null, false) }), raised, budget, null, model.curve ?? DEFAULT_CURVE);
		}
		return { byId: new Map(allocation.cells.map((cell) => [cell.config.id, cell])), folded };
	};
	const allocation = allocate();
	let overflow = false;
	const rows = roots.map((root, index) => {
		const allocated = allocation.byId.get(root.id);
		const visible = !!allocated && (allocated.visible || allocation.folded.has(index));
		const folded = visible && allocation.folded.has(index);
		let rowHeight = visible ? allocated.actual : 0;
		if (visible && !folded && rowHeight < definition[index].minHeight) {
			rowHeight = definition[index].minHeight;
			overflow = true;
		}
		return {
			occurrence: root.id,
			title: root.title,
			width,
			height: rowHeight,
			visible,
			folded,
			kept: overflowMode(definition[index]) === "keep",
			sized: model.sizeOf(root.id, "height") !== null,
			inView: containerInView && visible,
			minHeight: definition[index].minHeight,
			maxHeight: heightBounds(definition[index]).reach,
			fitHeight: fits[index],
			resizeMin: resizeBounds(owners[index], "height").min,
			resizeMax: resizeCeiling(resizeBounds(owners[index], "height"), fits[index]),
			chain: visible ? layoutChain(model, root, width, folded ? definition[index].minHeight : rowHeight, containerInView && !folded) : null,
		};
	});
	planFolds(rows, activeRow(model, split, roots), "vertical");
	const contentHeight = rows.reduce((sum, row) => sum + row.height, 0);
	return { rows, overflow: overflow || contentHeight > budget, contentHeight, spare: Math.max(0, budget - contentHeight) };
}
