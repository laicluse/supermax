import { chainCells, chainFits, chainRootOf, chainWidth, isSplit, layoutWorkspace, validateSplit } from "./layout.js";

const DEFAULT_CHROME = { navbar: 44, maxRows: 4 };
const GENERIC_CELL = { min: 200, max: 320 };

export class Navigator {
	constructor({ destinations, root, minViewportHeight, chrome = {} }) {
		if (!Number.isFinite(minViewportHeight)) throw new TypeError("minViewportHeight must be a finite number of pixels");
		this.destinations = Object.assign(Object.create(null), destinations);
		this.rootDestination = root;
		this.minViewportHeight = minViewportHeight;
		this.chrome = { ...DEFAULT_CHROME, ...chrome };
		this.size = { width: 0, height: 0 };
		this.reset();
	}

	reset() {
		this.occurrences = new Map();
		this.groups = [];
		this.groupSequence = 0;
		this.windowStarts = new Map();
		this.rowStarts = new Map();
		this.sizes = { width: new Map(), height: new Map() };
		this.root = this.createOccurrence(this.rootDestination, null, 0, null);
		this.focused = this.root.id;
	}

	resize(size) {
		this.size = { width: size.width, height: size.height };
	}

	definitionOf(id) {
		return Object.hasOwn(this.destinations, id) ? this.destinations[id] : null;
	}

	define(id, definition) {
		const previous = this.definitionOf(id);
		this.destinations[id] = { ...definition, provisional: false };
		const completed = [];
		const rejected = [];
		const closed = [];
		for (const occurrence of [...this.occurrences.values()]) {
			if (occurrence.destination !== id) continue;
			occurrence.title = definition.title;
			const group = this.groupOf(occurrence);
			if (!previous?.provisional || !group) continue;
			if (isSplit(definition)) {
				const parent = occurrence.parent ? this.get(occurrence.parent) : null;
				const validation = validateSplit(this, id, parent);
				if (!validation.ok) {
					this.closeSubtree(occurrence);
					rejected.push({ occurrence: occurrence.id, result: { ok: false, reason: "invalid-rows", validation } });
					continue;
				}
				for (const childId of occurrence.children) {
					const child = childId ? this.get(childId) : null;
					if (child) closed.push(...this.removeSubtree(child));
				}
				occurrence.children = [];
				this.dropEmptyGroups();
			}
			if (group.root === occurrence.id) group.title = definition.title;
			this.openDefaults(occurrence, group);
			completed.push(occurrence.id);
		}
		for (const occurrence of [...this.occurrences.values()]) {
			if (occurrence.awaiting !== id || occurrence.children[0]) continue;
			const group = this.groupOf(occurrence);
			if (!group) continue;
			occurrence.awaiting = null;
			const before = occurrence.children.length;
			this.openDefaults(occurrence, group);
			if (occurrence.children.length > before) completed.push(occurrence.children[0]);
		}
		return { completed, rejected, closed };
	}

	provisional(id, hint) {
		const size = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);
		const title = typeof hint?.title === "string" && hint.title.trim().length > 0 ? hint.title : id;
		const definition = { title, min: size(hint?.min, GENERIC_CELL.min), max: size(hint?.max, GENERIC_CELL.max), provisional: true };
		if (Number.isFinite(hint?.preferred) && hint.preferred > 0) definition.preferred = hint.preferred;
		if (typeof hint?.defaultChild === "string" && hint.defaultChild.length > 0) definition.defaultChild = hint.defaultChild;
		if (definition.min > definition.max) definition.max = definition.min;
		this.destinations[id] = definition;
		return definition;
	}

	forget(id) {
		if (!Object.hasOwn(this.destinations, id)) return false;
		if ([...this.occurrences.values()].some((occurrence) => occurrence.destination === id)) return false;
		delete this.destinations[id];
		return true;
	}

	abandon(id) {
		for (const occurrence of this.occurrences.values()) {
			if (occurrence.awaiting === id) occurrence.awaiting = null;
		}
	}

	missingDefinitions() {
		const missing = new Set();
		for (const occurrence of this.occurrences.values()) {
			if (this.definitionOf(occurrence.destination)?.provisional) missing.add(occurrence.destination);
			if (occurrence.awaiting && !this.definitionOf(occurrence.awaiting)) missing.add(occurrence.awaiting);
		}
		return [...missing];
	}

	get(id) {
		return this.occurrences.get(id) ?? null;
	}

	child(occurrence) {
		const id = occurrence?.children[0];
		return id ? this.get(id) : null;
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
			awaiting: null,
		};
		this.occurrences.set(occurrence.id, occurrence);
		if (parent) {
			parent.children[row] = occurrence.id;
			parent.awaiting = null;
		}
		return occurrence;
	}

	open(destinationId, { from, hint = null } = {}) {
		const parent = this.get(from ?? this.root.id);
		if (!parent) return { ok: false, reason: "source-closed", source: from };
		let definition = this.definitionOf(destinationId);
		const canProvision = !definition && typeof destinationId === "string" && destinationId.length > 0 && !!hint;
		if (!definition && !canProvision) return { ok: false, reason: "unknown-destination", destination: destinationId };
		if (isSplit(this.definitionOf(parent.destination))) return { ok: false, reason: "split-source", source: parent.id };
		if (canProvision) definition = this.provisional(destinationId, hint);
		if (isSplit(definition)) {
			const validation = validateSplit(this, destinationId, parent);
			if (!validation.ok) return { ok: false, reason: "invalid-rows", validation };
		}
		const existing = this.child(parent);
		if (existing && existing.destination === destinationId) {
			this.focus(existing.id, { resetReveal: false });
			if (!this.isAuto(existing)) return { ok: true, noop: true, occurrence: existing };
			const group = this.promote(existing);
			return { ok: true, promoted: true, occurrence: existing, group };
		}
		if (existing) this.closeSubtree(existing);
		const occurrence = this.createOccurrence(destinationId, parent, 0, null);
		const group = this.createGroup(occurrence);
		this.focus(occurrence.id);
		this.openDefaults(occurrence, group);
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
		if (definition.provisional || occurrence.children[0]) return;
		const candidate = definition.defaultChild;
		if (!candidate) return;
		if (!this.definitionOf(candidate)) {
			occurrence.awaiting = candidate;
			return;
		}
		if (chainCells(this, chainRootOf(this, occurrence)).some((cell) => cell.destination === candidate)) return;
		if (isSplit(this.definitionOf(candidate)) && !validateSplit(this, candidate, occurrence).ok) return;
		if (!this.fits(occurrence, candidate)) return;
		const child = this.createOccurrence(candidate, occurrence, 0, group);
		this.openDefaults(child, group);
	}

	fits(parentOccurrence, candidateId) {
		const chainRoot = chainRootOf(this, parentOccurrence);
		const width = chainWidth(this, chainRoot);
		const candidate = { id: `${parentOccurrence.id}/${candidateId}`, destination: candidateId };
		return chainFits(this, [...chainCells(this, chainRoot), candidate], width);
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
		this.occurrences.delete(occurrence.id);
		this.windowStarts.delete(occurrence.id);
		this.rowStarts.delete(occurrence.id);
		this.sizes.width.delete(occurrence.id);
		this.sizes.height.delete(occurrence.id);
		if (this.focused === occurrence.id) this.focused = parent ? parent.id : this.root.id;
		closed.unshift({ id: occurrence.id, title: occurrence.title });
		return closed;
	}

	dropEmptyGroups() {
		const live = new Set([...this.occurrences.values()].map((occurrence) => occurrence.group));
		this.groups = this.groups.filter((group) => live.has(group.id));
	}

	nextBack() {
		const group = this.groups[this.groups.length - 1];
		return group ? { id: group.id, title: group.title } : null;
	}

	back() {
		const group = this.groups[this.groups.length - 1];
		if (!group) return { ok: false, reason: "history-empty" };
		const root = this.get(group.root);
		const focusAfterClose = root.parent ?? this.root.id;
		const closed = this.closeSubtree(root);
		this.focus(focusAfterClose, { resetReveal: false });
		return { ok: true, closed, title: group.title, focus: this.focused };
	}

	focus(occurrenceId, { resetReveal = true } = {}) {
		const occurrence = this.get(occurrenceId);
		if (!occurrence) return;
		this.focused = occurrence.id;
		if (!resetReveal) return;
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

	bringIntoView(occurrenceId) {
		const occurrence = this.get(occurrenceId);
		const path = [];
		for (let current = occurrence; current; current = current.parent ? this.get(current.parent) : null) path.unshift(current);
		for (const step of path) {
			const parent = step.parent ? this.get(step.parent) : null;
			if (parent && isSplit(this.definitionOf(parent.destination))) {
				const rows = parent.children.map((id) => (id ? this.get(id) : null));
				this.reachWindow(rows, step, (layout, id) => layout.rows.get(id), (id) => this.startRows(parent.id, id));
			}
			if (step !== occurrence && !isSplit(this.definitionOf(step.destination))) continue;
			const chainRoot = chainRootOf(this, step);
			this.reachWindow(chainCells(this, chainRoot), step, (layout, id) => layout.cells.get(id), (id) => this.startWindow(chainRoot.id, id));
		}
	}

	reachWindow(members, target, find, start) {
		const shown = (id) => !!find(this.layout(), id)?.visible;
		if (shown(target.id)) return;
		const layout = this.layout();
		const targetIndex = members.findIndex((member) => member?.id === target.id);
		const first = members.findIndex((member) => member && find(layout, member.id)?.visible && !find(layout, member.id).kept);
		if (first === -1 || targetIndex < first) {
			start(target.id);
			return;
		}
		for (let index = first + 1; index <= targetIndex; index += 1) {
			start(members[index].id);
			if (shown(target.id)) return;
		}
	}

	backTarget(layout = this.layout()) {
		const outOfView = (occurrence) => !layout.cells.get(occurrence.id)?.inView && !this.definitionOf(occurrence.destination).keep;
		const climb = (start) => {
			for (let current = start?.parent ? this.get(start.parent) : null; current; current = current.parent ? this.get(current.parent) : null) {
				if (outOfView(current)) return current;
			}
			return null;
		};
		const branches = [this.get(this.focused), ...[...this.groups].reverse().map((group) => this.get(group.root))];
		for (const branch of branches) {
			const target = climb(branch);
			if (target) return { id: target.id, title: target.title };
		}
		return null;
	}

	startWindow(chainRootId, occurrenceId) {
		if (occurrenceId) this.windowStarts.set(chainRootId, occurrenceId);
		else this.windowStarts.delete(chainRootId);
	}

	startRows(splitId, rowRootId) {
		if (rowRootId) this.rowStarts.set(splitId, rowRootId);
		else this.rowStarts.delete(splitId);
	}

	focusInfo() {
		const occurrence = this.get(this.focused) ?? this.root;
		const trail = [];
		let current = occurrence.parent ? this.get(occurrence.parent) : null;
		while (current) {
			trail.unshift({ occurrence: current.id, title: current.title });
			current = current.parent ? this.get(current.parent) : null;
		}
		return { occurrence: occurrence.id, title: occurrence.title, trail };
	}

	layout() {
		return layoutWorkspace(this);
	}

	snapshot() {
		return {
			occurrences: [...this.occurrences.values()].map((occurrence) => ({ ...occurrence, children: [...occurrence.children] })),
			groups: this.groups.map((group) => ({ ...group })),
			groupSequence: this.groupSequence,
			focused: this.focused,
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
		this.focused = snapshot.focused;
		this.windowStarts = new Map(snapshot.windowStarts ?? []);
		this.rowStarts = new Map(snapshot.rowStarts ?? []);
		this.sizes = { width: new Map(snapshot.sizes?.width ?? []), height: new Map(snapshot.sizes?.height ?? []) };
		this.root = this.get(this.rootDestination);
		return true;
	}

	state() {
		return {
			occurrences: [...this.occurrences.keys()],
			groups: this.groups.map((group) => ({ id: group.id, title: group.title, root: group.root, members: this.membersOf(group) })),
			focused: this.focused,
		};
	}
}
