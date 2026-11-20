import { CellCollection } from "./cell-collection.js";

export function isSplit(definition) {
	return Array.isArray(definition?.rows);
}

export function validateSplit(model, definitionId, parentOccurrence, inheritedTabs = null, visiting = new Set()) {
	const definition = model.destination(definitionId);
	const { navbar, rowTab, maxRows } = model.chrome;
	const rows = definition.rows;
	const base = { ok: false, rows: [], chrome: null, supported: model.minViewportHeight };
	if (visiting.has(definitionId)) return { ...base, reason: "cycle", destination: definitionId };
	if (rows.length === 0) return { ...base, reason: "no-rows" };
	if (rows.length > maxRows) return { ...base, reason: "too-many-rows", count: rows.length, maxRows };
	const path = new Set([...visiting, definitionId]);
	const ancestorTabs = inheritedTabs ?? ancestorSplits(model, parentOccurrence)
		.reduce((sum, split) => sum + model.destination(split.destination).rows.length - 1, 0);
	const chrome = navbar + rowTab * (ancestorTabs + rows.length - 1);
	const seen = new Set();
	const results = rows.map((row, index) => {
		const rowDefinition = model.destination(row.destination);
		const problems = [];
		if (!rowDefinition) problems.push("unknown-row-destination");
		if (seen.has(row.destination)) problems.push("duplicate-row-destination");
		seen.add(row.destination);
		if (row.minHeight > row.maxHeight) problems.push("row-min-exceeds-max");
		if (rowDefinition && rowDefinition.min > rowDefinition.max) problems.push("cell-min-exceeds-max");
		const nested = rowDefinition && isSplit(rowDefinition) ? validateSplit(model, row.destination, null, ancestorTabs + rows.length - 1, path) : null;
		if (nested && !nested.ok) problems.push("invalid-nested-split");
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
			nested,
		};
	});
	const ok = results.every((row) => row.ok);
	return { ok, reason: ok ? null : "invalid-rows", rows: results, chrome, supported: model.minViewportHeight };
}

function ancestorSplits(model, occurrence) {
	const splits = [];
	let current = occurrence;
	while (current) {
		if (isSplit(model.destination(current.destination))) splits.push(current);
		current = current.parent ? model.get(current.parent) : null;
	}
	return splits;
}

export function chainRootOf(model, occurrence) {
	let current = occurrence;
	while (current.parent) {
		const parent = model.get(current.parent);
		if (isSplit(model.destination(parent.destination))) break;
		current = parent;
	}
	return current;
}

export function chainCells(model, chainRoot) {
	const cells = [chainRoot];
	let current = chainRoot;
	while (!isSplit(model.destination(current.destination)) && current.children[0]) {
		current = model.get(current.children[0]);
		cells.push(current);
	}
	return cells;
}

function configsOf(model, cells) {
	return cells.map((occurrence) => {
		const definition = model.destination(occurrence.destination);
		return { id: occurrence.id, title: occurrence.title, min: definition.min, max: definition.max };
	});
}

export function chainWidth(model, chainRoot) {
	if (!chainRoot.parent) return model.size.width;
	const split = model.get(chainRoot.parent);
	const outerRoot = chainRootOf(model, split);
	const outerCells = chainCells(model, outerRoot);
	const allocation = new CellCollection(configsOf(model, outerCells)).distribute(chainWidth(model, outerRoot));
	const cell = allocation.cells.find((candidate) => candidate.config.id === split.id);
	return cell && cell.visible ? cell.actual : model.destination(split.destination).min;
}

export function layoutWorkspace(model) {
	const { navbar } = model.chrome;
	const height = Math.max(0, model.size.height - navbar);
	const chain = layoutChain(model, model.root, model.size.width, height);
	return {
		width: model.size.width,
		height: model.size.height,
		navbar,
		belowMinimum: model.size.height < model.minViewportHeight,
		overflow: chain.overflow,
		contentHeight: Math.max(height, chain.contentHeight),
		chain,
	};
}

function layoutChain(model, chainRoot, width, height) {
	const cells = chainCells(model, chainRoot);
	const offset = Math.min(model.revealOffsets.get(chainRoot.id) ?? 0, cells.length - 1);
	const shown = cells.slice(0, cells.length - offset);
	const allocation = new CellCollection(configsOf(model, shown)).distribute(width);
	let overflow = false;
	let contentHeight = height;
	const layoutCells = cells.map((occurrence, index) => {
		const definition = model.destination(occurrence.destination);
		const allocated = allocation.cells[index];
		const visible = allocated ? allocated.visible : false;
		const cellWidth = visible ? allocated.actual : definition.min;
		const cell = { occurrence: occurrence.id, title: occurrence.title, width: cellWidth, visible };
		if (isSplit(definition)) {
			cell.rows = layoutRows(model, occurrence, cellWidth, height);
			overflow = overflow || cell.rows.overflow;
			contentHeight = Math.max(contentHeight, cell.rows.contentHeight);
		}
		return cell;
	});
	return {
		root: chainRoot.id,
		width,
		height,
		cells: layoutCells,
		revealOffset: offset,
		hiddenLeft: allocation.rightmostHiddenTitle,
		hiddenRight: offset > 0 ? cells[cells.length - offset].title : null,
		overflow,
		contentHeight,
	};
}

function layoutRows(model, split, width, height) {
	const definition = model.destination(split.destination).rows;
	const roots = definition.map((row, index) => model.get(split.children[index]));
	const pinnedId = rowContaining(model, split, model.focused) ?? roots[roots.length - 1].id;
	const { rowTab } = model.chrome;
	const floors = new Map();
	for (let pass = 0; pass <= roots.length; pass += 1) {
		const allocation = allocateRows(roots, definition, floors, height, rowTab, pinnedId);
		let overflow = false;
		let grown = false;
		const rows = roots.map((root, index) => {
			const allocated = allocation.cells[index];
			const pinned = root.id === pinnedId;
			const minHeight = Math.max(definition[index].minHeight, floors.get(root.id) ?? 0);
			let rowHeight = allocated.actual;
			if (pinned && rowHeight < minHeight) {
				rowHeight = minHeight;
				overflow = true;
			}
			const collapsed = !pinned && !allocated.visible;
			const chain = collapsed ? null : layoutChain(model, root, width, rowHeight);
			if (chain && chain.contentHeight > rowHeight) {
				floors.set(root.id, chain.contentHeight);
				grown = true;
			}
			if (chain?.overflow) overflow = true;
			return { occurrence: root.id, title: root.title, height: collapsed ? rowTab : rowHeight, collapsed, focused: pinned, chain };
		});
		if (grown && pass < roots.length) continue;
		return { rows, overflow, contentHeight: rows.reduce((sum, row) => sum + row.height, 0) };
	}
	return { rows: [], overflow: true, contentHeight: 0 };
}

function allocateRows(roots, definition, floors, height, rowTab, pinnedId) {
	let hidden = 0;
	let allocation;
	for (let attempt = 0; attempt <= roots.length; attempt += 1) {
		const collection = new CellCollection(roots.map((root, index) => ({
			id: root.id,
			title: root.title,
			min: Math.max(definition[index].minHeight, floors.get(root.id) ?? 0),
			max: Math.max(definition[index].maxHeight, floors.get(root.id) ?? 0),
		})));
		allocation = collection.distribute(Math.max(0, height - hidden * rowTab), null, { pinnedId });
		if (allocation.hiddenCount === hidden) break;
		hidden = allocation.hiddenCount;
	}
	return allocation;
}

function rowContaining(model, split, occurrenceId) {
	let current = model.get(occurrenceId);
	while (current && current.parent) {
		if (current.parent === split.id) return current.id;
		current = model.get(current.parent);
	}
	return null;
}
