import { overflowProblems } from "./overflow.js";
import { DEFAULT_CURVE } from "./cell-collection.js";
import { variantProblems } from "./variants.js";
import { aspectProblems } from "./aspect.js";
import { ELASTIC, breakoutOf, chainCells, chainFits, chainRootOf, chainWidth, isBesideSplit, isSplit, layoutWorkspace, rowSplitOf, validateSplit } from "./layout.js";
import { sameLayout, validateDeclarationSet } from "./layout-declaration.js";

const DEFAULT_CHROME = { header: 28, maxRows: 4 };

export class SupermaxConfigurationError extends Error {
	constructor(problems) {
		super(`Supermax configuration is invalid:\n${problems.map(describeProblem).join("\n")}`);
		this.name = "SupermaxConfigurationError";
		this.problems = problems;
	}
}

function describeProblem({ destination, validation, reason }) {
	if (!validation) return `- ${destination}: ${reason}`;
	const rows = validation.rows.filter((row) => !row.ok);
	if (rows.length === 0) return `- ${destination}: ${validation.reason}`;
	return rows.map((row) => `- ${destination}, row ${row.row} (${row.title}): ${row.problems.join(", ")}; needs ${row.required}px of ${row.supported}px`).join("\n");
}

export function validateDestinations(destinations, { minViewportHeight, chrome = {} }) {
	const model = { chrome: { ...DEFAULT_CHROME, ...chrome }, minViewportHeight, definitionOf: (id) => destinations[id] };
	const problems = Object.keys(destinations)
		.filter((id) => isSplit(destinations[id]))
		.map((id) => ({ destination: id, validation: validateSplit(model, id, null) }))
		.filter((problem) => !problem.validation.ok);
	for (const id of Object.keys(destinations)) {
		const definition = destinations[id];
		for (const reason of variantProblems(definition)) problems.push({ destination: id, reason });
		for (const row of definition.rows ?? []) for (const reason of variantProblems(row, "height")) problems.push({ destination: id, reason });
		if (definition.rows && definition.variants) problems.push({ destination: id, reason: "split-with-variants" });
		if (!isSplit(definition) && (!(Number.isFinite(definition.min) && definition.min > 0) || (definition.max !== ELASTIC && !(Number.isFinite(definition.max) && definition.max >= definition.min)))) problems.push({ destination: id, reason: "invalid-size" });
		if (!isSplit(definition) && definition.max !== ELASTIC && definition.preferred != null && (!Number.isFinite(definition.preferred) || definition.preferred < definition.min || definition.preferred > definition.max)) problems.push({ destination: id, reason: "invalid-preferred" });
		if (destinations[id].compact != null) problems.push({ destination: id, reason: "unsupported-compact" });
		if (Object.hasOwn(definition, "height")) problems.push({ destination: id, reason: "unsupported-height" });
		for (const reason of aspectProblems(definition)) problems.push({ destination: id, reason });
		if (destinations[id].placement != null && (!isBesideSplit(destinations[id]) || isSplit(destinations[id]))) problems.push({ destination: id, reason: "invalid-placement" });
		if (isSplit(destinations[id]) && ["min", "max", "preferred", "growOnFocus"].some((key) => destinations[id][key] != null)) problems.push({ destination: id, reason: "split-with-width" });
		if (definition.growOnFocus != null && typeof definition.growOnFocus !== "boolean") problems.push({ destination: id, reason: "invalid-grow-on-focus" });
		if (destinations[id].header != null && destinations[id].header !== "title") problems.push({ destination: id, reason: "invalid-header" });
		if (destinations[id].menu != null && destinations[id].menu !== true && destinations[id].menu !== "exact") problems.push({ destination: id, reason: "invalid-menu" });
		for (const reason of overflowProblems(definition, definition.min)) problems.push({ destination: id, reason });
		if (isSplit(definition) && definition.overflow?.mode === "fold") problems.push({ destination: id, reason: "folding-split" });
	}
	const elastic = Object.keys(destinations).filter((id) => destinations[id].max === ELASTIC);
	for (const id of elastic) {
		if (!(Number.isFinite(destinations[id].preferred) && destinations[id].preferred >= destinations[id].min)) problems.push({ destination: id, reason: "elastic-without-preferred" });
	}
	if (elastic.length === 0) problems.push({ destination: "(destinations)", reason: "no-elastic-destination" });
	return { ok: problems.length === 0, problems };
}
const SPARE_SPACE = Object.freeze(["start", "center", "end"]);

export class Navigator {
	constructor({ destinations, root, minViewportHeight, chrome = {}, spareSpace = "start", context = null, curve = DEFAULT_CURVE }) {
		if (!Number.isFinite(minViewportHeight)) throw new TypeError("minViewportHeight must be a finite number of pixels");
		if (!SPARE_SPACE.includes(spareSpace)) throw new TypeError(`spareSpace must be one of ${SPARE_SPACE.join(", ")}`);
		this.setCurve(curve);
		this.spareSpace = spareSpace;
		this.context = context;
		this.destinations = Object.assign(Object.create(null), destinations);
		// allow-comment: a runtime setter changes a destination the host or a server declared; a later declaration of the same destination compares against what was declared, not against the runtime change.
		this.declared = Object.create(null);
		this.rootDestination = root;
		this.minViewportHeight = minViewportHeight;
		this.chrome = { ...DEFAULT_CHROME, ...chrome };
		const report = validateDestinations(this.destinations, { minViewportHeight, chrome: this.chrome });
		if (!report.ok) throw new SupermaxConfigurationError(report.problems);
		this.size = { width: 0, height: 0 };
		this.reset();
	}

	reset() {
		this.occurrences = new Map();
		this.groups = [];
		this.groupSequence = 0;
		this.zoomed = null;
		this.unfolded = [];
		this.withheld = null;
		this.windowStarts = new Map();
		this.rowStarts = new Map();
		this.sizes = { width: new Map(), height: new Map() };
		this.root = this.createOccurrence(this.rootDestination, null, 0, null);
		if (isSplit(this.definitionOf(this.rootDestination))) this.openDefaults(this.root, null);
		this.focused = this.root.id;
	}

	// allow-comment: opening a fold is Show for that one surface. A folded row becomes the row its split keeps, so the rows after it give way. A folded cell is remembered as unfolded, so it folds after every other cell, and the trailing end of its chain closes until it shows in full beside the cells that showed before. Returns the cells it closed.
	unfold(occurrenceId, axis) {
		const occurrence = this.get(occurrenceId);
		if (!occurrence) return [];
		this.zoomed = null;
		if (axis === "vertical") {
			this.startRows(occurrence.parent, occurrenceId);
			return [];
		}
		const layout = this.layout();
		this.unfolded = [...this.unfolded.filter((entry) => entry.occurrence !== occurrenceId), { occurrence: occurrenceId, scope: chainRootOf(this, occurrence).id }];
		return this.showByClosing(occurrenceId, { before: layout, keepShown: true });
	}

	forgetUnfolds() {
		this.unfolded = [];
	}

	// allow-comment: draws the layout a rehearsed action would leave while every cell it would close stays open, withheld from its chain, so a drag that is let go early has closed nothing.
	preview({ after, closed }, draw) {
		const held = { unfolded: this.unfolded, windowStarts: this.windowStarts, rowStarts: this.rowStarts, zoomed: this.zoomed };
		Object.assign(this, { unfolded: after.unfolded, windowStarts: new Map(after.windowStarts), rowStarts: new Map(after.rowStarts), zoomed: after.zoomed, withheld: new Set(closed.map((cell) => cell.id)) });
		try {
			return draw();
		} finally {
			Object.assign(this, held, { withheld: null });
		}
	}

	// allow-comment: the curve gives out the room between the minima and the maxima by position along a chain or down a split; a host that changes it renders the workspace again.
	setCurve(curve) {
		if (typeof curve !== "function") throw new TypeError("curve must be a function of a position from 0 to 1");
		this.curve = curve;
	}

	resize(size) {
		if (![size.width, size.height].every((value) => Number.isFinite(value) && value >= 0)) throw new TypeError("Viewport dimensions must be finite non-negative numbers");
		this.size = { width: size.width, height: size.height };
	}

	definitionOf(id) {
		return Object.hasOwn(this.destinations, id) ? this.destinations[id] : null;
	}

	setAspectRatio(destinationId, aspectRatio, { inset = null } = {}) {
		const definition = this.definitionOf(destinationId);
		if (!definition) throw new TypeError(`Unknown destination: ${destinationId}`);
		const { aspectRatio: _ratio, aspectInset: _inset, ...rest } = definition;
		const updated = aspectRatio == null && inset == null ? rest : { ...rest, aspectRatio, ...(inset == null ? {} : { aspectInset: structuredClone(inset) }) };
		const problems = aspectProblems(updated).map((reason) => ({ destination: destinationId, reason }));
		const model = Object.create(this);
		model.definitionOf = (id) => id === destinationId ? updated : this.definitionOf(id);
		for (const id of Object.keys(this.destinations)) {
			if (!isSplit(this.destinations[id])) continue;
			const validation = validateSplit(model, id, null);
			if (!validation.ok) problems.push({ destination: id, validation });
		}
		if (problems.length) throw new SupermaxConfigurationError(problems);
		this.declared[destinationId] ??= definition;
		this.destinations[destinationId] = updated;
	}

	setVariants(destinationId, variants, { row = null } = {}) {
		const definition = this.definitionOf(destinationId);
		if (!definition) throw new TypeError(`Unknown destination: ${destinationId}`);
		const owner = row === null ? definition : definition.rows?.find((member) => member.destination === row);
		if (!owner || row === null && isSplit(definition)) throw new TypeError("Variants belong to an ordinary destination or a named split row");
		const problems = variantProblems({ ...owner, variants }, row === null ? "width" : "height");
		if (problems.length) throw new SupermaxConfigurationError(problems.map((reason) => ({ destination: destinationId, reason })));
		const next = variants == null ? undefined : structuredClone(variants);
		this.declared[destinationId] ??= definition;
		if (row === null) this.destinations[destinationId] = { ...definition, variants: next };
		else {
			const updated = { ...definition, rows: definition.rows.map((member) => member === owner ? { ...member, variants: next } : member) };
			const model = Object.create(this);
			model.definitionOf = (id) => id === destinationId ? updated : this.definitionOf(id);
			const validation = validateSplit(model, destinationId, null);
			if (!validation.ok) throw new SupermaxConfigurationError([{ destination: destinationId, validation }]);
			this.destinations[destinationId] = updated;
		}
	}

	register(set) {
		const problems = validateDeclarationSet(set, { known: (id) => !!this.definitionOf(id) });
		if (problems.length === 0 && set.context !== this.context) problems.push({ destination: set.root, reason: "declaration-context" });
		const added = [];
		for (const [id, declaration] of problems.length === 0 ? Object.entries(set.destinations) : []) {
			const existing = this.declared[id] ?? this.definitionOf(id);
			if (!existing) added.push(id);
			else if (!sameLayout(existing, declaration)) problems.push({ destination: id, reason: "declaration-mismatch" });
		}
		const merged = { ...set.destinations, ...this.destinations };
		const model = { chrome: this.chrome, minViewportHeight: this.minViewportHeight, definitionOf: (id) => merged[id] ?? null };
		for (const id of problems.length === 0 ? added : []) {
			if (!isSplit(merged[id])) continue;
			const validation = validateSplit(model, id, null);
			if (!validation.ok) problems.push({ destination: id, reason: "invalid-rows", validation });
		}
		if (problems.length > 0) throw new SupermaxConfigurationError(problems);
		for (const id of added) this.destinations[id] = { ...set.destinations[id] };
		return added;
	}

	get(id) {
		return this.occurrences.get(id) ?? null;
	}

	child(occurrence) {
		const id = occurrence?.children[0];
		return id ? this.get(id) : null;
	}

	// allow-comment: what follows a cell in its own chain: beside a split its breakout, after a cell its child unless that child broke out of the row.
	next(occurrence) {
		if (!occurrence) return null;
		const cells = chainCells(this, chainRootOf(this, occurrence));
		return cells[cells.indexOf(occurrence) + 1] ?? null;
	}

	groupOf(occurrence) {
		return this.groups.find((group) => group.id === occurrence.group) ?? null;
	}

	isAuto(occurrence) {
		const group = this.groupOf(occurrence);
		return group ? group.root !== occurrence.id : false;
	}

	membersOf(group) {
		return [...this.occurrences.values()].filter((occurrence) => occurrence.group === group.id).map((occurrence) => occurrence.id);
	}

	createOccurrence(destinationId, parent, row, group) {
		const definition = this.definitionOf(destinationId);
		const occurrence = {
			id: parent ? `${parent.id}/${destinationId}` : destinationId,
			destination: destinationId,
			title: definition.title,
			parent: parent ? parent.id : null,
			slot: row,
			children: [],
			group: group ? group.id : null,
		};
		this.occurrences.set(occurrence.id, occurrence);
		if (parent) parent.children[row] = occurrence.id;
		return occurrence;
	}

	open(destinationId, { from, ...rest } = {}) {
		if (Object.hasOwn(rest, "hint")) throw new TypeError("open() takes no hint: register the destination's layout declaration before opening it");
		const parent = this.get(from ?? this.root.id);
		if (!parent) return { ok: false, reason: "source-closed", source: from };
		const definition = this.definitionOf(destinationId);
		if (!definition) return { ok: false, reason: "unknown-destination", destination: destinationId };
		if (isSplit(this.definitionOf(parent.destination))) return { ok: false, reason: "split-source", source: parent.id };
		if (isSplit(definition)) {
			const validation = validateSplit(this, destinationId, parent);
			if (!validation.ok) return { ok: false, reason: "invalid-rows", validation };
		}
		const existing = this.child(parent);
		if (existing && existing.destination === destinationId) {
			this.focused = existing.id;
			if (!this.isAuto(existing)) return { ok: true, noop: true, occurrence: existing };
			const group = this.promote(existing);
			return { ok: true, promoted: true, occurrence: existing, group };
		}
		if (existing) this.closeSubtree(existing);
		const other = isBesideSplit(definition) ? this.breakoutBeside(parent) : null;
		if (other) this.closeSubtree(other);
		const occurrence = this.createOccurrence(destinationId, parent, 0, null);
		const group = this.createGroup(occurrence);
		this.resetReveal(occurrence);
		this.openDefaults(occurrence, group);
		this.focused = occurrence.id;
		return { ok: true, occurrence, group };
	}

	createGroup(rootOccurrence) {
		this.groupSequence += 1;
		const group = { id: this.groupSequence, title: rootOccurrence.title, root: rootOccurrence.id };
		this.groups.push(group);
		rootOccurrence.group = group.id;
		return group;
	}

	promote(occurrence) {
		const previousGroup = occurrence.group;
		const group = this.createGroup(occurrence);
		const move = (current) => {
			for (const childId of current.children) {
				const child = this.get(childId);
				if (child && child.group === previousGroup) {
					child.group = group.id;
					move(child);
				}
			}
		};
		move(occurrence);
		this.dropEmptyGroups();
		return group;
	}

	openDefaults(occurrence, group) {
		const definition = this.definitionOf(occurrence.destination);
		if (isSplit(definition)) {
			if (occurrence.children.length === 0) {
				const rowRoots = definition.rows.map((row, index) => this.createOccurrence(row.destination, occurrence, index, group));
				rowRoots.forEach((rowRoot) => this.openDefaults(rowRoot, group));
			}
			return;
		}
		if (occurrence.children[0]) return;
		const candidate = definition.defaultChild;
		if (!candidate || !this.definitionOf(candidate)) return;
		const place = this.placeFor(occurrence, candidate);
		if (place.cells.some((cell) => cell.destination === candidate)) return;
		if (isSplit(this.definitionOf(candidate)) && !validateSplit(this, candidate, occurrence).ok) return;
		if (place.beside && this.breakoutBeside(occurrence)) return;
		const shown = (layout) => new Set([...layout.cells.values()].filter((cell) => cell.full).map((cell) => cell.occurrence));
		const before = shown(this.layout());
		const child = this.createOccurrence(candidate, occurrence, 0, group);
		const layout = this.layout();
		const after = shown(layout);
		// allow-comment: a default opens only when, with the room its chain then asks for, it shows in full without hiding any cell that showed in full before.
		if (layout.overflowX || layout.overflow || !after.has(child.id) || [...before].some((id) => !after.has(id))) {
			this.removeSubtree(child);
			return;
		}
		this.openDefaults(child, group);
	}

	// allow-comment: the chain a candidate would join from a parent: its parent's own, or the chain beside the split when a full-height cell opens from a row.
	placeFor(parentOccurrence, candidateId) {
		const split = isBesideSplit(this.definitionOf(candidateId)) ? rowSplitOf(this, parentOccurrence) : null;
		const root = chainRootOf(this, split ?? parentOccurrence);
		return { beside: !!split, root, cells: chainCells(this, root) };
	}

	breakoutBeside(parentOccurrence) {
		const split = rowSplitOf(this, parentOccurrence);
		return split ? breakoutOf(this, split) : null;
	}

	closeSubtree(occurrence) {
		const closed = this.removeSubtree(occurrence);
		this.dropEmptyGroups();
		return closed;
	}

	removeSubtree(occurrence) {
		const closed = [];
		for (const childId of occurrence.children) {
			const child = this.get(childId);
			if (child) closed.push(...this.removeSubtree(child));
		}
		const parent = occurrence.parent ? this.get(occurrence.parent) : null;
		if (parent && parent.children[occurrence.slot] === occurrence.id) parent.children[occurrence.slot] = undefined;
		if (this.zoomed === occurrence.id) this.zoomed = null;
		this.occurrences.delete(occurrence.id);
		this.windowStarts.delete(occurrence.id);
		this.rowStarts.delete(occurrence.id);
		for (const starts of [this.windowStarts, this.rowStarts]) for (const [scope, start] of starts) if (start === occurrence.id) starts.delete(scope);
		this.unfolded = this.unfolded.filter((entry) => entry.occurrence !== occurrence.id && entry.scope !== occurrence.id);
		this.sizes.width.delete(occurrence.id);
		this.sizes.height.delete(occurrence.id);
		closed.unshift({ id: occurrence.id, destination: occurrence.destination, title: occurrence.title });
		return closed;
	}

	dropEmptyGroups() {
		const live = new Set([...this.occurrences.values()].map((occurrence) => occurrence.group));
		this.groups = this.groups.filter((group) => live.has(group.id));
	}

	newestGroup() {
		const group = this.groups[this.groups.length - 1];
		return group ? { id: group.id, title: group.title } : null;
	}

	zoom(occurrenceId) {
		if (occurrenceId === null) {
			this.zoomed = null;
			return true;
		}
		const occurrence = this.get(occurrenceId);
		if (!occurrence || !this.definitionOf(occurrence.destination).zoomable) return false;
		this.forgetUnfolds();
		this.zoomed = occurrence.id;
		return true;
	}

	setTitle(occurrenceId, title) {
		const occurrence = this.get(occurrenceId);
		if (!occurrence) return false;
		occurrence.title = title;
		for (const group of this.groups) if (group.root === occurrenceId) group.title = title;
		return true;
	}

	sync(destinationIds, { ifRoom = [], zoom } = {}) {
		const [rootId] = destinationIds;
		if (rootId !== this.root.destination) return { ok: false, reason: "other-root", destination: rootId };
		const unknown = [...destinationIds, ...ifRoom.flat()].find((id) => !this.definitionOf(id));
		if (unknown) return { ok: false, reason: "unknown-destination", destination: unknown };
		if (zoom != null && (!destinationIds.includes(zoom) || !this.definitionOf(zoom).zoomable)) return { ok: false, reason: "not-zoomable", destination: zoom };
		// allow-comment: the ids name the path from the root to the tip, the occurrence's own path: after a split the next id names one of its rows, and the chain continues inside that row.
		const path = [this.root];
		let shared = 1;
		while (shared < destinationIds.length) {
			const current = path[path.length - 1];
			const id = destinationIds[shared];
			let next = null;
			if (isSplit(this.definitionOf(current.destination))) {
				next = current.children.map((childId) => this.get(childId)).find((row) => row?.destination === id) ?? null;
				if (!next) return { ok: false, reason: "not-a-row", destination: id, source: current.id };
			} else {
				next = [this.next(current), this.child(current)].find((candidate) => candidate?.destination === id) ?? null;
			}
			if (!next) break;
			path.push(next);
			shared += 1;
		}
		const before = this.snapshot();
		let last = path[path.length - 1];
		let changed = false;
		const opened = [];
		// allow-comment: a manual cell that follows a member of the path in its own chain without being the next member lies beside the path and closes: the cell after the tip, and the breakout beside a split the path goes into.
		const requested = new Set(destinationIds.map((_, index) => destinationIds.slice(0, index + 1).join("/")));
		path.forEach((member) => {
			const beside = this.next(member);
			if (beside && !requested.has(beside.id) && !this.isAuto(beside)) {
				this.closeSubtree(beside);
				changed = true;
			}
		});
		if (shared === destinationIds.length && shared > 1 && this.isAuto(last) && !this.isRowRoot(last)) {
			this.promote(last);
			changed = true;
		}
		for (const id of destinationIds.slice(shared)) {
			if (isSplit(this.definitionOf(last.destination))) {
				const row = last.children.map((childId) => this.get(childId)).find((candidate) => candidate?.destination === id) ?? null;
				if (!row) {
					this.restore(before);
					return { ok: false, reason: "not-a-row", destination: id, source: last.id };
				}
				last = row;
				continue;
			}
			const result = this.open(id, { from: last.id });
			if (!result.ok) {
				this.restore(before);
				return { ok: false, reason: result.reason, destination: id };
			}
			last = result.occurrence;
			opened.push(last.id);
			changed = true;
		}
		if (zoom !== undefined) {
			const target = zoom === null ? null : this.get(destinationIds.slice(0, destinationIds.lastIndexOf(zoom) + 1).join("/"))?.id ?? null;
			if ((this.zoomed ?? null) !== target) {
				this.zoomed = target;
				changed = true;
			}
		}
		const offered = ifRoom.flat();
		let kept = last;
		for (const id of offered) {
			const next = this.next(kept);
			if (!next || next.destination !== id) break;
			kept = next;
		}
		const stale = this.next(kept);
		if (stale && stale.optional && this.isAuto(stale)) {
			this.closeSubtree(stale);
			changed = true;
		}
		if (changed) this.bringIntoView(last.id);
		const optional = this.openIfRoom(last, ifRoom);
		this.focused = last.id;
		if (!changed && optional.length === 0) return { ok: true, noop: true, occurrence: last };
		return { ok: true, occurrence: last, optional, opened };
	}

	isRowRoot(occurrence) {
		const parent = occurrence.parent ? this.get(occurrence.parent) : null;
		return !!parent && isSplit(this.definitionOf(parent.destination));
	}

	// allow-comment: an optional cell opens only when it shows without hiding a cell that is in view now; existing widths may change. A nested list opens whole or not at all.
	openIfRoom(parent, entries) {
		const opened = [];
		const shown = (layout) => [...layout.cells.values()].filter((cell) => cell.full).map((cell) => cell.occurrence);
		let current = parent;
		for (const entry of entries) {
			const ids = Array.isArray(entry) ? entry : [entry];
			const inView = shown(this.layout());
			const before = this.snapshot();
			const added = [];
			let start = current;
			let refused = false;
			for (const id of ids) {
				if (isSplit(this.definitionOf(start.destination))) {
					const row = start.children.map((childId) => this.get(childId)).find((candidate) => candidate?.destination === id) ?? null;
					if (!row) { refused = true; break; }
					start = row;
					continue;
				}
				const existing = this.child(start);
				if (existing) {
					if (existing.destination !== id) { refused = true; break; }
					start = existing;
					continue;
				}
				if (isSplit(this.definitionOf(id)) && !validateSplit(this, id, start).ok) { refused = true; break; }
				const group = this.groups.find((candidate) => candidate.id === start.group) ?? null;
				const child = this.createOccurrence(id, start, 0, group);
				child.optional = true;
				const owner = group ?? this.createGroup(child);
				if (isSplit(this.definitionOf(id))) this.openDefaults(child, owner);
				added.push(child.id);
				start = child;
			}
			const layout = this.layout();
			const fits = !refused && !layout.overflowX && !layout.overflow && added.every((id) => {
				const cell = layout.cells.get(id);
				return cell?.full;
			}) && inView.every((occurrence) => {
				const kept = layout.cells.get(occurrence);
				return kept?.full;
			});
			if (!fits) {
				if (added.length > 0) this.restore(before);
				break;
			}
			opened.push(...added);
			current = start;
		}
		return opened;
	}

	closeNewestGroup() {
		const group = this.groups[this.groups.length - 1];
		if (!group) return { ok: false, reason: "history-empty" };
		const closed = this.closeSubtree(this.get(group.root));
		return { ok: true, closed, title: group.title };
	}

	resetReveal(occurrence) {
		let current = occurrence;
		while (current) {
			this.windowStarts.delete(chainRootOf(this, current).id);
			this.rowStarts.delete(current.id);
			current = current.parent ? this.get(current.parent) : null;
		}
	}

	setSize(occurrenceId, size, axis = "width") {
		if (axis !== "width" && axis !== "height") throw new TypeError("axis must be width or height");
		if (size !== null && !(Number.isFinite(size) && size > 0)) throw new TypeError("size must be a positive number of pixels or null");
		if (!this.get(occurrenceId)) return;
		if (size === null) this.sizes[axis].delete(occurrenceId);
		else this.sizes[axis].set(occurrenceId, size);
	}

	sizeOf(occurrenceId, axis = "width") {
		return this.sizes[axis]?.get(occurrenceId) ?? null;
	}

	bringIntoView(occurrenceId, { chains = true } = {}) {
		for (let member = this.get(occurrenceId); member; ) {
			const root = chainRootOf(this, member);
			if (chains) this.reachWindow(chainCells(this, root), member, (layout, id) => layout.cells.get(id), (id) => this.startWindow(root.id, id));
			if (!root.parent) break;
			const split = this.get(root.parent);
			const rows = split.children.map((id) => this.get(id));
			this.reachWindow(rows, root, (layout, id) => layout.rows.get(id), (id) => this.startRows(split.id, id));
			member = split;
		}
	}

	reachWindow(members, target, find, start) {
		const shown = (id) => {
			const placement = find(this.layout(), id);
			return !!placement?.visible && !placement.folded;
		};
		if (shown(target.id)) return;
		const layout = this.layout();
		const targetIndex = members.findIndex((member) => member?.id === target.id);
		const first = members.findIndex((member) => member && find(layout, member.id)?.visible && !find(layout, member.id).folded && !find(layout, member.id).kept);
		if (first === -1 || targetIndex < first) {
			start(target.id);
			return;
		}
		for (let index = first + 1; index <= targetIndex; index += 1) {
			start(members[index].id);
			if (shown(target.id)) return;
		}
	}

	// allow-comment: Show frees the outermost chain first, so a split that a breakout pushed out of view comes back before the cell inside its row does.
	showByClosing(occurrenceId, { before = this.layout(), keepShown = false } = {}) {
		const target = this.get(occurrenceId);
		if (!target) return [];
		const hidden = new Set([...this.occurrences.keys()].filter((id) => !before.cells.get(id)?.full));
		const shown = keepShown ? chainCells(this, chainRootOf(this, target)).filter((cell) => before.cells.get(cell.id)?.full).map((cell) => cell.id) : [];
		this.bringIntoView(occurrenceId, { chains: false });
		const levels = [];
		for (let member = target; member; ) {
			const root = chainRootOf(this, member);
			levels.unshift({ root, member });
			member = root.parent ? this.get(root.parent) : null;
		}
		const closed = [];
		for (const { root, member } of levels) {
			this.windowStarts.delete(root.id);
			while (this.get(member.id)) {
				const layout = this.layout();
				const placement = layout.cells.get(member.id);
				if (placement?.visible && !placement.folded && (member !== target || shown.every((id) => !this.get(id) || layout.cells.get(id)?.full))) break;
				const cells = chainCells(this, root);
				const last = cells[cells.length - 1];
				if (last.id === member.id) break;
				const closing = this.newestWithin(last);
				const fullyShown = (candidate) => !hidden.has(candidate.id) && !!layout.cells.get(candidate.id)?.full && candidate.children.filter(Boolean).every((id) => fullyShown(this.get(id)));
				if (!fullyShown(closing)) {
					this.bringIntoView(occurrenceId);
					return closed;
				}
				closed.push(...this.closeSubtree(closing));
			}
		}
		return closed;
	}

	// allow-comment: the cells in a split's rows come after the split in reading order, so the end of a chain that ends in a split is the newest cell inside its rows; the split itself goes once its rows hold only their roots.
	newestWithin(occurrence) {
		if (!isSplit(this.definitionOf(occurrence.destination))) return occurrence;
		const inside = [...this.occurrences.values()].filter((candidate) => !this.isRowRoot(candidate) && rowSplitOf(this, candidate) === occurrence);
		return inside.length > 0 ? inside[inside.length - 1] : occurrence;
	}

	placeOf(occurrence, layout = this.layout()) {
		if (this.withheld?.has(occurrence.id)) return "after";
		const root = chainRootOf(this, occurrence);
		const split = root.parent ? this.get(root.parent) : null;
		if (split) {
			const container = this.placeOf(split, layout);
			if (container !== "in") return container;
			const rows = layout.cells.get(split.id)?.rows?.rows ?? [];
			const index = rows.findIndex((row) => row.occurrence === root.id);
			if (rows[index]?.folded) return rows[index].foldDirection === "down" ? "above" : "after";
			if (!rows[index]?.visible || rows[index]?.folded) return index < rows.findIndex((row) => row.visible && !row.folded) ? "above" : "after";
		}
		const cells = layout.chains.get(root.id)?.cells ?? [];
		const index = cells.findIndex((cell) => cell.occurrence === occurrence.id);
		if (cells[index]?.visible && !cells[index]?.folded) return "in";
		if (cells[index]?.folded) return cells[index].foldDirection === "right" ? "above" : "after";
		return index < cells.findLastIndex((cell) => cell.visible && !cell.folded) ? "above" : "after";
	}

	upTarget(layout = this.layout()) {
		const appearance = [...this.occurrences.keys()];
		const candidates = [];
		const tipsOf = (members) => members.filter((occurrence) => !occurrence.children.some((childId) => members.some((member) => member.id === childId)));
		const branches = [...this.groups].reverse().map((group) => appearance.map((id) => this.get(id)).filter((occurrence) => occurrence.group === group.id));
		branches.push(appearance.map((id) => this.get(id)));
		for (const members of branches) {
			for (const tip of tipsOf(members).reverse()) {
				for (let current = tip; current; current = current.parent ? this.get(current.parent) : null) {
					if (this.placeOf(current, layout) === "above") {
						const root = chainRootOf(this, current);
						const row = layout.rows.get(root.id);
						const target = row?.inView && row.folded ? root : current;
						candidates.push({ id: target.id, title: target.title });
						break;
					}
				}
			}
		}
		const ancestors = new Set();
		for (const candidate of candidates) for (let parent = this.get(this.get(candidate.id).parent); parent; parent = this.get(parent.parent)) ancestors.add(parent.id);
		return candidates.find((candidate) => !ancestors.has(candidate.id)) ?? null;
	}

	startWindow(chainRootId, occurrenceId) {
		if (occurrenceId) this.windowStarts.set(chainRootId, occurrenceId);
		else this.windowStarts.delete(chainRootId);
	}

	startRows(splitId, rowRootId) {
		if (rowRootId) this.rowStarts.set(splitId, rowRootId);
		else this.rowStarts.delete(splitId);
	}

	// allow-comment: an occurrence id is its path from the root, so when the focused cell has closed, the longest beginning of that path that is still open takes over.
	focus() {
		let id = this.focused;
		while (id && !this.get(id)) id = id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : null;
		const occurrence = this.get(id) ?? this.root;
		const destinations = occurrence.id.split("/");
		const menu = destinations.find((destination, index) => {
			const rule = this.definitionOf(destination)?.menu;
			return rule === true || (rule === "exact" && index === destinations.length - 1);
		}) ?? null;
		return { occurrence: occurrence.id, destinations, title: occurrence.title, menu };
	}

	locationInfo(layout = this.layout()) {
		const roots = [...this.groups].reverse().map((group) => this.get(group.root)).filter(Boolean);
		const occurrence = roots.find((root) => layout.cells.get(root.id)?.inView) ?? roots[0] ?? this.root;
		return { occurrence: occurrence.id, title: occurrence.title };
	}

	layout() {
		return layoutWorkspace(this);
	}

	unzoomedLayout() {
		const zoomed = this.zoomed;
		this.zoomed = null;
		try {
			return layoutWorkspace(this);
		} finally {
			this.zoomed = zoomed;
		}
	}

	snapshot() {
		return {
			occurrences: [...this.occurrences.values()].map((occurrence) => ({ ...occurrence, children: [...occurrence.children] })),
			groups: this.groups.map((group) => ({ ...group })),
			groupSequence: this.groupSequence,
			zoomed: this.zoomed,
			focused: this.focused,
			unfolded: this.unfolded.map((entry) => ({ ...entry })),
			windowStarts: [...this.windowStarts],
			rowStarts: [...this.rowStarts],
			sizes: { width: [...this.sizes.width], height: [...this.sizes.height] },
		};
	}

	restore(snapshot) {
		if (!snapshot.occurrences.every((occurrence) => this.definitionOf(occurrence.destination))) return false;
		this.occurrences = new Map(snapshot.occurrences.map((occurrence) => [occurrence.id, { ...occurrence, children: [...occurrence.children] }]));
		this.groups = snapshot.groups.map((group) => ({ ...group }));
		this.groupSequence = snapshot.groupSequence;
		this.zoomed = this.get(snapshot.zoomed) && this.definitionOf(this.get(snapshot.zoomed).destination).zoomable ? snapshot.zoomed : null;
		const inChain = (scope, id) => !!this.get(scope) && !!this.get(id) && chainRootOf(this, this.get(id)).id === scope;
		const inRows = (scope, id) => !!this.get(id) && !!this.get(scope) && isSplit(this.definitionOf(this.get(scope).destination)) && this.get(scope).children.includes(id);
		this.unfolded = (snapshot.unfolded ?? []).filter((entry) => inChain(entry.scope, entry.occurrence)).map((entry) => ({ ...entry }));
		this.windowStarts = new Map((snapshot.windowStarts ?? []).filter(([scope, id]) => inChain(scope, id)));
		this.rowStarts = new Map((snapshot.rowStarts ?? []).filter(([scope, id]) => inRows(scope, id)));
		this.sizes = { width: new Map(snapshot.sizes?.width ?? []), height: new Map(snapshot.sizes?.height ?? []) };
		this.root = this.get(this.rootDestination);
		this.focused = snapshot.focused ?? this.root.id;
		return true;
	}

	state() {
		return {
			occurrences: [...this.occurrences.keys()],
			groups: this.groups.map((group) => ({ id: group.id, title: group.title, root: group.root, members: this.membersOf(group) })),
		};
	}
}
