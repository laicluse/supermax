import { mountPart } from "./renderer.js";
import { followEdge } from "./edge-drag.js";
import { follow, unfollow } from "./follow.js";
import { layoutWorkspace, withGrowth } from "./layout.js";
import { TIMING } from "./motion.js";

function previewLayout(workspace, axis, sizes) {
	const navigator = workspace.navigator;
	const preview = Object.create(navigator);
	preview.sizes = { ...navigator.sizes, [axis]: new Map(navigator.sizes[axis]) };
	for (const [id, size] of sizes) preview.setSize(id, size, axis);
	return layoutWorkspace(withGrowth(preview, workspace.growth.current()));
}

function projectedOffset(workspace, divider, sizes) {
	const { parts, edge, axis } = divider;
	const layout = previewLayout(workspace, axis, sizes);
	const projected = parts.map((part) => axis === "width" ? layout.cells.get(part.id) : layout.rows.get(part.id));
	const extent = (part) => axis === "width" ? part.width : part.height;
	if (projected.some((part, index) => !part?.visible || part.folded && (index === edge || extent(part) !== parts[index].size))) return null;
	if (projected.slice(0, edge).some((part, index) => Math.abs(extent(part) - parts[index].size) > .5)) return null;
	return projected.slice(0, edge + 1).reduce((sum, part) => sum + extent(part), 0);
}

function canResize(workspace, divider) {
	const { parts, edge, room, offset } = divider;
	const part = parts[edge];
	const before = offset - part.size;
	const after = parts.slice(edge + 1).reduce((sum, entry) => sum + entry.min, 0);
	const maximum = Math.min(part.max, room - before - after);
	for (const size of new Set([part.size - 1, part.size + 1, part.min, maximum])) {
		const target = before + size;
		const sizes = followEdge(parts, edge, target, room);
		if (!sizes.size) continue;
		const projected = projectedOffset(workspace, divider, sizes);
		if (projected !== null && Math.abs(projected - offset) > .5 && (projected - offset) * (target - offset) > 0 && Math.abs(projected - offset) <= Math.abs(target - offset) + .5) return true;
	}
	return false;
}

function resetOffset(workspace, divider) {
	const layout = previewLayout(workspace, divider.axis, new Map([[divider.occurrenceId, null]]));
	let offset = 0;
	for (const part of divider.parts.slice(0, divider.edge + 1)) {
		const item = divider.axis === "width" ? layout.cells.get(part.id) : layout.rows.get(part.id);
		if (!item?.visible) return null;
		offset += divider.axis === "width" ? item.width : item.height;
	}
	return offset;
}

export class DividerLayer {
	constructor(workspace) {
		this.workspace = workspace;
		this.dividers = new Map();
	}

	sync(host, orientation, items) {
		const wanted = new Set();
		const prefix = orientation === "vertical" ? "w" : "h";
		for (const item of items) {
			const key = `${prefix}:${item.id}`;
			wanted.add(key);
			const divider = this.divider(key, host, orientation, item.id, item.title);
			if (orientation === "vertical") {
				divider.element.style.left = `${item.offset - 4}px`;
				divider.element.style.top = "0";
				divider.element.style.height = "100%";
			} else {
				divider.element.style.top = `${item.offset - 4}px`;
				divider.element.style.left = "0";
				divider.element.style.width = "100%";
			}
			this.update(divider, item);
		}
		for (const [key, divider] of this.dividers) {
			if (divider.host === host && !wanted.has(key)) {
				this.remove(divider);
				this.dividers.delete(key);
			}
		}
	}

	dispose(host) {
		for (const [key, divider] of this.dividers) {
			if (divider.host === host) { this.remove(divider); this.dividers.delete(key); }
		}
	}

	clear() {
		for (const divider of this.dividers.values()) this.remove(divider);
		this.dividers.clear();
	}

	remove(divider) {
		divider.element.ownerDocument.defaultView.clearTimeout(divider.resetTimer);
		divider.dragging?.abort();
		unfollow(divider.element);
		divider.paint?.dispose(); divider.resetPaint?.dispose();
		divider.element.remove();
	}

	divider(key, host, orientation, occurrenceId, title) {
		const workspace = this.workspace;
		let divider = this.dividers.get(key);
		if (divider && divider.host === host && divider.element.isConnected) return divider;
		if (divider) {
			this.remove(divider);
			this.dividers.delete(key);
		}
		const element = workspace.create("div", `supermax-divider is-${orientation}`);
		element.dataset.divides = occurrenceId;
		const handle = workspace.create("div", "supermax-divider-handle");
		handle.setAttribute("aria-hidden", "true");
		const reset = workspace.create("button", "supermax-divider-reset");
		reset.type = "button";
		reset.setAttribute("aria-label", this.workspace.strings.resetSize(title));
		const resetPaint = mountPart(workspace, "reset", reset, { title, orientation });
		const paint = mountPart(workspace, "divider", handle, { title, orientation });
		reset.hidden = true;
		const axis = orientation === "vertical" ? "width" : "height";
		reset.addEventListener("click", () => this.reset(divider));
		element.append(handle, reset);
		host.append(element);
		divider = { paint, resetPaint, element, handle, reset, host, occurrenceId, orientation, title, axis, size: 0, parts: [], edge: 0, room: 0 };
		handle.addEventListener("pointerdown", (event) => this.startDrag(divider, event));
		element.addEventListener("pointermove", () => this.showReset(divider));
		element.addEventListener("pointerenter", () => this.showReset(divider));
		this.dividers.set(key, divider);
		return divider;
	}

	showReset(divider) {
		if (divider.reset.hidden || divider.element.classList.contains("is-resetting") || !divider.resizable) return;
		const view = divider.element.ownerDocument.defaultView;
		view.clearTimeout(divider.resetTimer);
		divider.element.classList.add("is-reset-visible");
		divider.resetTimer = view.setTimeout(() => divider.element.classList.remove("is-reset-visible"), this.workspace.time.ms(TIMING.resetHint));
	}

	reset(divider) {
		const { workspace } = this;
		divider.element.classList.add("is-resetting");
		divider.reset.inert = true;
		workspace.setSizes(new Map([[divider.occurrenceId, null]]), divider.axis, { animate: true });
		if (!divider.element.isConnected) return;
		divider.reset.hidden = false;
		const step = () => {
			const source = divider.orientation === "vertical" ? workspace.cells.get(divider.occurrenceId)?.element.parentElement : workspace.rows.get(divider.occurrenceId)?.element;
			if (!source?.isConnected) return false;
			const seam = source.getBoundingClientRect();
			const host = divider.host.getBoundingClientRect();
			if (divider.orientation === "vertical") divider.element.style.left = `${seam.right - host.left - 4}px`;
			else divider.element.style.top = `${seam.bottom - host.top - 4}px`;
			const moving = workspace.body.getAnimations({ subtree: true }).some((animation) => animation.playState === "running");
			if (!moving) {
				divider.element.classList.remove("is-resetting", "is-reset-visible");
				divider.reset.hidden = true;
				divider.reset.inert = false;
			}
			return moving;
		};
		step();
		follow(divider.element, step);
	}

	update(divider, { title, size, sized, parts, edge, room, offset }) {
		Object.assign(divider, { title, size, parts, edge, room, offset });
		divider.resizable = canResize(this.workspace, divider);
		divider.element.classList.toggle("is-fixed", !divider.resizable);
		divider.element.classList.toggle("is-sized", sized);
		divider.reset.hidden = !sized && !divider.element.classList.contains("is-resetting");
		if (sized) {
			const preferred = resetOffset(this.workspace, divider);
			const distance = preferred === null ? 0 : preferred - offset;
			divider.reset.dataset.direction = Math.abs(distance) < 1 ? "still" : divider.orientation === "vertical" ? distance > 0 ? "right" : "left" : distance > 0 ? "down" : "up";
		}
		if (!divider.resizable) {
			divider.element.ownerDocument.defaultView.clearTimeout(divider.resetTimer);
			divider.element.classList.toggle("is-reset-visible", sized && divider.reset.dataset.direction !== "still");
		}
		const state = { title, size, sized, resizable: divider.resizable, orientation: divider.orientation, direction: sized ? divider.reset.dataset.direction : null };
		divider.paint.update(state); divider.resetPaint.update(state);
	}

	startDrag(divider, event) {
		if (event.button !== 0 || !divider.resizable) return;
		event.preventDefault();
		divider.handle.setPointerCapture(event.pointerId);
		const vertical = divider.orientation === "vertical";
		const { parts, edge, room } = divider;
		const start = parts.slice(0, edge + 1).reduce((sum, entry) => sum + entry.size, 0);
		const drag = { pointerId: event.pointerId, origin: vertical ? event.clientX : event.clientY };
		const original = new Map(parts.map((entry) => [entry.id, this.workspace.navigator.sizeOf(entry.id, divider.axis)]));
		const touched = new Set();
		divider.dragging?.abort();
		const controller = new AbortController();
		divider.dragging = controller;
		const move = (moveEvent) => {
			if (moveEvent.pointerId !== drag.pointerId) return;
			const target = start + (vertical ? moveEvent.clientX : moveEvent.clientY) - drag.origin;
			const sizes = followEdge(parts, edge, target, room);
			for (const id of touched) if (!sizes.has(id)) sizes.set(id, original.get(id));
			if (sizes.size === 0) return;
			const offset = projectedOffset(this.workspace, { ...divider, parts, edge }, sizes);
			if (offset === null) return;
			if ((offset - start) * (target - start) < 0 || Math.abs(offset - start) > Math.abs(target - start) + .5) return;
			if (Math.abs(offset - divider.offset) < .5 && ![...sizes].every(([id, size]) => size === original.get(id))) return;
			divider.element.classList.add("is-dragging");
			for (const id of sizes.keys()) touched.add(id);
			this.workspace.setSizes(sizes, divider.axis);
		};
		const stop = (upEvent) => {
			if (upEvent.pointerId !== drag.pointerId) return;
			divider.element.classList.remove("is-dragging");
			this.showReset(divider);
			controller.abort();
		};
		const view = divider.handle.ownerDocument;
		view.addEventListener("pointermove", move, { signal: controller.signal });
		view.addEventListener("pointerup", stop, { signal: controller.signal });
		view.addEventListener("pointercancel", stop, { signal: controller.signal });
		divider.handle.addEventListener("lostpointercapture", stop, { signal: controller.signal });
	}
}
