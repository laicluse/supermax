import { CellCollection } from "./cell-collection.js";

export const ELASTIC = "*";
const TRANSIENT_FOLD = { horizontal: 0, vertical: 0 };

export function isSplit(definition) {
	return Array.isArray(definition?.rows);
}

export function isFull(definition) {
	return definition?.height === "full";
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
	if (!isFull(model.definitionOf(occurrence.destination)) || !occurrence.parent) return false;
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
	return { min: definition.min, max: elastic ? definition.preferred : definition.max, reach: elastic ? Infinity : definition.max, preferred: definition.preferred ?? null, elastic };
}

function compactWidth(definition) {
	return definition.compact ? definition.compact.min : null;
}

// allow-comment: a split declares no width; its bounds are its widest row's. A row asks for the sum of its cells' minima and gives that up one cell at a time from its left (steps), down to its newest cell with the kept cells (min); it prefers the sum of its cells' preferences and reaches the sum of their maxima. Only what is open counts, never what is visible, so the demand cannot depend on its own outcome.
export function boundsOf(model, occurrence) {
	const definition = model.definitionOf(occurrence.destination);
	if (!isSplit(definition)) return { ...widthBounds(definition), steps: [definition.min] };
	const bounds = { min: 0, max: 0, reach: 0, preferred: 0, elastic: false };
	const rowSteps = [];
	definition.rows.forEach((row, index) => {
		const root = occurrence.children?.[index] ? model.get(occurrence.children[index]) : null;
		const cells = (root ? chainCells(model, root) : [{ destination: row.destination }]).map((cell) => model.definitionOf(cell.destination));
		const newest = cells[cells.length - 1];
		const keptBefore = (count) => cells.slice(0, count).reduce((sum, cell) => sum + (cell.keep ? compactWidth(cell) ?? cell.min : cell.fold === false ? 0 : cell.fold?.size ?? TRANSIENT_FOLD.horizontal), 0);
		const steps = cells.map((cell, dropped) => keptBefore(dropped) + cells.slice(dropped).reduce((sum, member) => sum + member.min, 0));
		rowSteps.push(steps);
		const min = steps[steps.length - 1];
		const preferred = cells.reduce((sum, cell) => sum + (widthBounds(cell).preferred ?? widthBounds(cell).max), 0);
		const max = cells.reduce((sum, cell) => sum + widthBounds(cell).max, 0);
		const elastic = cells.some((cell) => cell.max === ELASTIC);
		bounds.min = Math.max(bounds.min, min);
		bounds.preferred = Math.max(bounds.preferred, preferred);
		bounds.max = Math.max(bounds.max, max);
		bounds.reach = Math.max(bounds.reach, elastic ? Infinity : max);
		bounds.elastic ||= elastic;
	});
	const length = Math.max(...rowSteps.map((steps) => steps.length));
	const steps = Array.from({ length }, (_, level) => Math.max(...rowSteps.map((row) => row[Math.min(level, row.length - 1)])));
	return { ...bounds, steps, max: bounds.elastic ? bounds.preferred : bounds.max };
}

export function heightBounds(row) {
	const elastic = row.maxHeight === ELASTIC;
	return { min: row.minHeight, max: elastic ? row.preferredHeight : row.maxHeight, reach: elastic ? Infinity : row.maxHeight, preferred: row.preferredHeight ?? null, elastic };
}

export function validateSplit(model, definitionId, parentOccurrence) {
	const definition = model.definitionOf(definitionId);
	const { maxRows } = model.chrome;
	const rows = definition.rows;
	const chrome = headerOf(model, definition);
	const base = { ok: false, rows: [], chrome: null, supported: model.minViewportHeight };
	if (parentOccurrence && chainRootOf(model, parentOccurrence).parent) return { ...base, reason: "nested-split" };
	if (parentOccurrence) {
		const cells = chainCells(model, chainRootOf(model, parentOccurrence));
		if (cells.slice(0, cells.indexOf(parentOccurrence)).some((cell) => isSplit(model.definitionOf(cell.destination)))) return { ...base, reason: "second-split" };
	}
	if (rows.length === 0) return { ...base, reason: "no-rows" };
	if (rows.length > maxRows) return { ...base, reason: "too-many-rows", count: rows.length, maxRows };
	const seen = new Set();
	const results = rows.map((row, index) => {
		const rowDefinition = model.definitionOf(row.destination);
		const problems = [];
		if (!rowDefinition) problems.push("unknown-row-destination");
		if (rowDefinition && isSplit(rowDefinition)) problems.push("split-row");
		if (rowDefinition && isFull(rowDefinition)) problems.push("full-height-row");
		if (seen.has(row.destination)) problems.push("duplicate-row-destination");
		seen.add(row.destination);
		if (row.minHeight > heightBounds(row).reach) problems.push("row-min-exceeds-max");
		if (row.maxHeight === ELASTIC && !(row.preferredHeight >= row.minHeight)) problems.push("elastic-without-preferred");
		if (row.fold != null && row.fold !== false && (!Number.isFinite(row.fold.size) || row.fold.size < 0 || row.fold.size >= row.minHeight)) problems.push("invalid-fold");
		if (rowDefinition && rowDefinition.min > widthBounds(rowDefinition).reach) problems.push("cell-min-exceeds-max");
		const required = chrome + row.minHeight;
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
		if (!next) return cells;
		cells.push(next);
		current = next;
	}
}

function compactPass(model, cells, width, fold) {
	const last = cells[cells.length - 1];
	const compact = new Set();
	const sumOfMins = () => cells.reduce((sum, occurrence) => {
		const definition = model.definitionOf(occurrence.destination);
		return sum + (fold.has(occurrence.id) ? fold.get(occurrence.id) : compact.has(occurrence.id) ? compactWidth(definition) : boundsOf(model, occurrence).steps[0]);
	}, 0);
	for (const occurrence of cells) {
		if (sumOfMins() <= width) break;
		const definition = model.definitionOf(occurrence.destination);
		if (occurrence !== last && !fold.has(occurrence.id) && definition.keep && compactWidth(definition) !== null) compact.add(occurrence.id);
	}
	return { compact, required: sumOfMins() };
}

function foldPass(model, cells, width) {
	const fold = new Map();
	const root = chainRootOf(model, cells[0]);
	const focus = model.foldFocus?.axis === "horizontal" && cells.some((cell) => cell.id === model.foldFocus.occurrence) ? model.foldFocus.occurrence : null;
	const active = focus ?? model.windowStarts.get(root.id);
	let required = cells.reduce((sum, occurrence) => sum + boundsOf(model, occurrence).steps[0], 0);
	const focusIndex = cells.findIndex((cell) => cell.id === focus);
	const candidates = focus ? cells.filter((cell) => cell.id !== focus).sort((a, b) => Math.abs(cells.indexOf(a) - focusIndex) - Math.abs(cells.indexOf(b) - focusIndex) || cells.indexOf(b) - cells.indexOf(a)) : cells.slice(0, -1);
	for (const occurrence of candidates) {
		if (required <= width) break;
		const definition = model.definitionOf(occurrence.destination);
		if (isSplit(definition) || definition.fold === false || definition.keep || (!focus && occurrence.id === active)) continue;
		const size = definition.fold?.size ?? TRANSIENT_FOLD.horizontal;
		fold.set(occurrence.id, size);
		required -= boundsOf(model, occurrence).steps[0] - size;
	}
	return fold;
}

export function chainFits(model, cells, width) {
	return cells.reduce((sum, occurrence) => sum + boundsOf(model, occurrence).min, 0) <= width;
}

function sessionBounds(base, session, hard) {
	if (session === null) return { min: base.min, max: base.max, preferred: base.preferred ?? null, elastic: !!base.elastic };
	const size = Math.min(base.reach ?? base.max, Math.max(base.min, session));
	return { min: hard ? size : base.min, max: size, preferred: size, elastic: !!base.elastic };
}

function sessionsHold(bounds, budget) {
	return bounds.reduce((sum, bound) => sum + (bound.session === null ? bound.min : Math.min(bound.reach ?? bound.max, Math.max(bound.min, bound.session))), 0) <= budget;
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

// allow-comment: room gives way in reading order, in one walk from the left: a cell before a split hides first, then the split gives its widest row up one cell at a time from the row's left, then the split itself hides; the newest cell always stays. What is left shares the width with the demand that walk settled on.
function allocateChain(model, cells, width) {
	const fold = foldPass(model, cells, width);
	const { compact } = compactPass(model, cells, width, fold);
	const anchors = zoomAnchors(model);
	const anchor = cells.find((occurrence) => anchors.has(occurrence.id))?.id ?? null;
	const units = cells.map((occurrence) => {
		const definition = model.definitionOf(occurrence.destination);
		const own = boundsOf(model, occurrence);
		const steps = fold.has(occurrence.id) ? [fold.get(occurrence.id)] : compact.has(occurrence.id) ? [compactWidth(definition)] : own.steps;
		return { occurrence, definition, own, steps, level: 0, hidden: false, keep: !!definition.keep || fold.has(occurrence.id) || occurrence.id === model.foldFocus?.occurrence };
	});
	const minOf = (unit) => unit.steps[unit.level];
	let total = units.reduce((sum, unit) => sum + minOf(unit), 0);
	for (let index = 0; index < units.length && total > width; ) {
		const unit = units[index];
		if (unit.keep || unit.hidden) {
			index += 1;
			continue;
		}
		if (unit.level < unit.steps.length - 1) {
			total -= minOf(unit);
			unit.level += 1;
			total += minOf(unit);
			continue;
		}
		if (index === units.length - 1) break;
		unit.hidden = true;
		total -= minOf(unit);
		index += 1;
	}
	const members = units.filter((unit) => !unit.hidden);
	const bounds = members.map((unit) => {
		if (compact.has(unit.occurrence.id) || fold.has(unit.occurrence.id)) return { min: minOf(unit), max: minOf(unit), preferred: null, session: null };
		return { ...unit.own, min: Math.min(minOf(unit), unit.own.max), session: model.sizeOf(unit.occurrence.id, "width") };
	});
	const hard = sessionsHold(bounds, width);
	const configs = members.map((unit, index) => {
		const config = { id: unit.occurrence.id, title: unit.occurrence.title, keep: unit.keep, ...sessionBounds(bounds[index], bounds[index].session, hard) };
		return unit.occurrence.id === anchor ? { ...config, zoomable: true, elastic: true } : config;
	});
	const sharing = new CellCollection(configs).distribute(width, anchor);
	const byId = new Map(sharing.cells.map((cell) => [cell.config.id, cell]));
	const allocation = { ...sharing, cells: cells.map((occurrence) => byId.get(occurrence.id) ?? { config: { id: occurrence.id, title: occurrence.title }, actual: 0, visible: false }) };
	return { allocation, compact, fold };
}

export function chainWidth(model, chainRoot) {
	if (!chainRoot.parent) return model.size.width;
	const split = model.get(chainRoot.parent);
	const outerRoot = chainRootOf(model, split);
	const { allocation } = allocateChain(model, chainCells(model, outerRoot), chainWidth(model, outerRoot));
	const cell = allocation.cells.find((candidate) => candidate.config.id === split.id);
	return cell && cell.visible ? cell.actual : boundsOf(model, split).min;
}

export function layoutWorkspace(model) {
	const height = Math.max(0, model.size.height);
	const chain = layoutChain(model, model.root, model.size.width, height, true);
	const index = { cells: new Map(), rows: new Map(), chains: new Map() };
	indexChain(chain, index);
	return {
		width: model.size.width,
		height: model.size.height,
		belowMinimum: model.size.height < model.minViewportHeight,
		overflow: chain.overflow,
		overflowX: chain.contentWidth > model.size.width,
		contentHeight: Math.max(height, chain.contentHeight),
		chain,
		...index,
	};
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

function offsetForStart(count, startIndex, startVisibleWith) {
	if (startIndex < 0) return 0;
	for (let hiddenAtEnd = 0; hiddenAtEnd < count - 1 - startIndex; hiddenAtEnd += 1) {
		if (startVisibleWith(hiddenAtEnd)) return hiddenAtEnd;
	}
	return count - 1 - startIndex;
}

function layoutChain(model, chainRoot, width, height, containerInView) {
	const cells = chainCells(model, chainRoot);
	const allocate = (hiddenAtEnd) => {
		const shown = cells.filter((occurrence, index) => index < cells.length - hiddenAtEnd || model.definitionOf(occurrence.destination).keep);
		const { allocation, compact, fold } = allocateChain(model, shown, width);
		return { compact, fold, byId: new Map(allocation.cells.map((cell) => [cell.config.id, cell])) };
	};
	const startIndex = cells.findIndex((occurrence) => occurrence.id === model.windowStarts.get(chainRoot.id));
	const offset = offsetForStart(cells.length, startIndex, (hiddenAtEnd) => !!allocate(hiddenAtEnd).byId.get(cells[startIndex].id)?.visible);
	const { byId, compact, fold } = allocate(offset);
	let overflow = false;
	let contentHeight = height;
	const layoutCells = cells.map((occurrence, index) => {
		const definition = model.definitionOf(occurrence.destination);
		const allocated = byId.get(occurrence.id);
		const bounds = boundsOf(model, occurrence);
		const visible = !!allocated && (allocated.visible || fold.has(occurrence.id));
		const cellWidth = visible ? allocated.actual : bounds.min;
		const isCompact = visible && compact.has(occurrence.id);
		const isFolded = visible && fold.has(occurrence.id);
		const inView = containerInView && visible;
		const cell = { occurrence: occurrence.id, title: occurrence.title, width: cellWidth, visible, compact: isCompact, folded: isFolded, inView, full: inView && !isCompact && !isFolded, kept: !!definition.keep, sized: model.sizeOf(occurrence.id, "width") !== null, min: bounds.min, max: bounds.reach };
		if (isSplit(definition)) {
			const bar = headerOf(model, definition);
			cell.rows = layoutRows(model, occurrence, cellWidth, Math.max(0, height - bar), inView);
			overflow = overflow || cell.rows.overflow;
			contentHeight = Math.max(contentHeight, cell.rows.contentHeight + bar);
		}
		return cell;
	});
	const contentWidth = layoutCells.reduce((sum, cell) => sum + (cell.visible ? cell.width : 0), 0);
	return {
		root: chainRoot.id,
		width,
		height,
		contentWidth: Math.max(width, contentWidth),
		spare: Math.max(0, width - contentWidth),
		cells: layoutCells,
		revealOffset: offset,
		overflow,
		contentHeight,
	};
}

function layoutRows(model, split, width, height, containerInView) {
	const definition = model.definitionOf(split.destination).rows;
	const roots = definition.map((row, index) => model.get(split.children[index]));
	const budget = Math.max(0, height);
	const allocate = (hiddenAtEnd) => {
		const shown = roots.map((root, index) => index).filter((index) => index < roots.length - hiddenAtEnd || definition[index].keep);
		const folded = new Set();
		const focus = model.foldFocus?.axis === "vertical" && roots.some((root) => root.id === model.foldFocus.occurrence) ? model.foldFocus.occurrence : null;
		let required = shown.reduce((sum, index) => sum + definition[index].minHeight, 0);
		const focusIndex = roots.findIndex((root) => root.id === focus);
		const candidates = focus ? shown.filter((index) => roots[index].id !== focus).sort((a, b) => Math.abs(a - focusIndex) - Math.abs(b - focusIndex) || b - a) : shown.slice(0, -1);
		for (const index of candidates) {
			if (required <= budget) break;
			const fold = definition[index].fold;
			if (fold === false || definition[index].keep || roots[index].id === focus || (!focus && roots[index].id === model.rowStarts.get(split.id))) continue;
			folded.add(index);
			required -= definition[index].minHeight - (fold?.size ?? TRANSIENT_FOLD.vertical);
		}
		const bounds = shown.map((index) => folded.has(index) ? { min: definition[index].fold?.size ?? TRANSIENT_FOLD.vertical, max: definition[index].fold?.size ?? TRANSIENT_FOLD.vertical, preferred: null, session: null } : { ...heightBounds(definition[index]), session: model.sizeOf(roots[index].id, "height") });
		const hard = sessionsHold(bounds, budget);
		const allocation = new CellCollection(shown.map((index, position) => ({ id: roots[index].id, title: roots[index].title, keep: !!definition[index].keep || folded.has(index) || roots[index].id === focus, ...sessionBounds(bounds[position], bounds[position].session, hard) }))).distribute(budget, null);
		return { byId: new Map(allocation.cells.map((cell) => [cell.config.id, cell])), folded };
	};
	const startIndex = roots.findIndex((root) => root.id === model.rowStarts.get(split.id));
	const offset = offsetForStart(roots.length, startIndex, (hiddenAtEnd) => !!allocate(hiddenAtEnd).byId.get(roots[startIndex].id)?.visible);
	const allocation = allocate(offset);
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
			height: rowHeight,
			visible,
			folded,
			kept: !!definition[index].keep,
			sized: model.sizeOf(root.id, "height") !== null,
			inView: containerInView && visible,
			minHeight: definition[index].minHeight,
			maxHeight: heightBounds(definition[index]).reach,
			chain: visible ? layoutChain(model, root, width, folded ? definition[index].minHeight : rowHeight, containerInView && !folded) : null,
		};
	});
	const contentHeight = rows.reduce((sum, row) => sum + row.height, 0);
	return { rows, overflow: overflow || contentHeight > budget, contentHeight, spare: Math.max(0, budget - contentHeight) };
}
