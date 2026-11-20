import { mountPart, SupermaxRendererError } from "./renderer.js";
import { ContentSlot } from "./content-slot.js";
import { APPEAR, DISAPPEAR } from "./motion.js";

const MODAL_BOUNDS = Object.freeze({ min: 280, max: 720, preferred: 440, minHeight: 160, maxHeight: Infinity, preferredHeight: null });

function px(value) {
	return Number.isFinite(value) ? `${value}px` : "";
}

export class ModalHost {
	constructor(workspace) {
		this.workspace = workspace;
		this.current = null;
		this.serial = 0;
	}

	open(definition, { from } = {}) {
		const workspace = this.workspace;
		const source = workspace.navigator.get(from) ?? null;
		const element = workspace.create("div", "supermax-modal-layer");
		const dialog = workspace.create("section", "supermax-modal");
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-label", definition.title);
		const controls = workspace.create("div", "supermax-modal-controls");
		const body = workspace.create("div", "supermax-modal-body");
		const bindings = new AbortController();
		const state = { title: definition.title, titleId: `supermax-modal-title-${(this.serial += 1)}`, actions: { close: { label: workspace.strings.closeModal(definition.title) } } };
		const backdrop = workspace.create("div", "supermax-backdrop"); backdrop.setAttribute("aria-hidden", "true");
		let part;
		let backdropPart;
		try {
			part = mountPart(workspace, "modal", dialog, state, { slots: { utilities: controls, body }, actions: { close: { run: () => this.close("close") } }, dragHandle: (handle) => {
				if (!dialog.contains(handle)) throw new SupermaxRendererError("modal", "drag handle must belong to the modal");
				handle.addEventListener("pointerdown", (event) => this.drag(event, dialog, element), { signal: bindings.signal });
			} });
			backdropPart = mountPart(workspace, "backdrop", backdrop, { kind: "modal" });
		} catch (error) {
			bindings.abort(); part?.dispose(); backdropPart?.dispose();
			throw error;
		}
		if (this.current) this.close("replaced");
		element.append(backdrop);
		dialog.supermaxBounds = { ...MODAL_BOUNDS, ...Object.fromEntries(Object.keys(MODAL_BOUNDS).filter((key) => definition[key] !== undefined).map((key) => [key, definition[key]])) };
		this.size(dialog, dialog.supermaxBounds);
		dialog.addEventListener("pointerdown", (event) => this.grip(event, dialog, element));
		this.resizeObserver = new workspace.document.defaultView.ResizeObserver(() => workspace.scheduleOrigins());
		this.resizeObserver.observe(dialog);
		const originLayer = workspace.originLayer("supermax-origin is-modal");
		element.append(...(originLayer ? [originLayer] : []), dialog);
		element.addEventListener("pointerdown", (event) => { if (event.target === element) this.close("backdrop"); });
		const modal = { part, backdropPart, backdrop, bindings, element, dialog, body, title: definition.title, source: source?.id ?? null, originLayer, slot: null, retry: null };
		modal.slot = new ContentSlot(workspace, { element, body, header: controls, onSettled: () => this.settled(modal) });
		modal.retry = () => modal.slot.mount(definition.title, () => definition.content(modal, workspace), () => this.current === modal);
		this.current = modal;
		this.describe(modal);
		workspace.folds.drag?.settle(false);
		if (workspace.folds.layer) workspace.folds.layer.inert = true;
		workspace.body.inert = true;
		workspace.notices.render();
		workspace.element.append(element);
		workspace.element.classList.add("has-modal");
		this.place();
		if (!workspace.reducedMotion.matches) modal.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], workspace.time.timing(APPEAR));
		this.appear(modal);
		modal.retry();
		workspace.dispatchEvent(new CustomEvent("modal", { detail: { state: "open", title: definition.title, source: modal.source } }));
		return modal;
	}

	// The dialog grows out of its source cell as a plane, on a new cell's timeline, while the frustum follows it.
	appear(modal) {
		const workspace = this.workspace;
		const view = workspace.document.defaultView;
		const cell = modal.source && workspace.findCell(modal.source)?.full ? workspace.cells.get(modal.source)?.element : null;
		if (!cell || workspace.reducedMotion.matches) return;
		const from = cell.getBoundingClientRect();
		const to = modal.dialog.getBoundingClientRect();
		if (to.width === 0 || to.height === 0) return;
		const { dialog } = modal;
		dialog.style.animation = "none";
		dialog.style.transformOrigin = "0 0";
		modal.entrance = dialog.animate([{ transform: this.planeOver(from, to), opacity: 0 }, { transform: "none", opacity: 1 }], workspace.time.timing(APPEAR));
		const follow = () => {
			if (this.current !== modal) return;
			workspace.drawOrigins();
			if (modal.entrance?.playState === "running") view.requestAnimationFrame(follow);
		};
		view.requestAnimationFrame(follow);
		modal.entrance.finished.then(() => {
			dialog.style.removeProperty("transform-origin");
			modal.entrance = null;
			workspace.scheduleOrigins();
		}, () => {});
	}

	planeOver(cell, dialog) {
		return `translate(${cell.left - dialog.left}px, ${cell.top - dialog.top}px) scale(${cell.width / dialog.width}, ${cell.height / dialog.height})`;
	}

	// The closed dialog shrinks back into its source cell as a closing cell folds away, while the workspace already takes input.
	leave(modal, reason, removed = () => {}) {
		const workspace = this.workspace;
		const view = workspace.document.defaultView;
		const { element, dialog } = modal;
		modal.entrance?.finish();
		if (reason === "destroyed" || workspace.reducedMotion.matches) {
			element.remove();
			removed();
			return;
		}
		element.inert = true;
		element.setAttribute("data-supermax-exiting", "");
		const cell = modal.source && workspace.findCell(modal.source)?.full ? workspace.cells.get(modal.source)?.element : null;
		const to = dialog.getBoundingClientRect();
		dialog.style.animation = "none";
		dialog.style.transformOrigin = "0 0";
		const gone = cell && to.width > 0 && to.height > 0 ? this.planeOver(cell.getBoundingClientRect(), to) : "scale(0.97)";
		const exit = dialog.animate([{ transform: "none", opacity: 1 }, { transform: gone, opacity: 0 }], { ...workspace.time.timing(DISAPPEAR), fill: "forwards" });
		modal.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { ...workspace.time.timing(DISAPPEAR), fill: "forwards" });
		const follow = () => {
			if (!element.isConnected) return;
			workspace.drawModalOrigin(modal, 1 - (exit.effect.getComputedTiming().progress ?? 1));
			view.requestAnimationFrame(follow);
		};
		if (cell && modal.originLayer) view.requestAnimationFrame(follow);
		const remove = () => { element.remove(); removed(); };
		exit.finished.then(remove, remove);
	}

	size(dialog, bounds) {
		dialog.style.minWidth = `min(${px(bounds.min)}, 100%)`;
		dialog.style.maxWidth = Number.isFinite(bounds.max) ? `min(${px(bounds.max)}, 100%)` : "100%";
		dialog.style.width = px(Math.min(bounds.max, Math.max(bounds.min, bounds.preferred ?? bounds.min)));
		dialog.style.minHeight = `min(${px(bounds.minHeight)}, 100%)`;
		dialog.style.maxHeight = Number.isFinite(bounds.maxHeight) ? `min(${px(bounds.maxHeight)}, 100%)` : "100%";
		dialog.style.height = bounds.preferredHeight === null ? "" : px(Math.min(bounds.maxHeight, Math.max(bounds.minHeight, bounds.preferredHeight)));
	}

	pin(dialog, layer) {
		if (dialog.classList.contains("is-placed")) return;
		for (const animation of dialog.getAnimations({ subtree: true })) animation.finish();
		const box = dialog.getBoundingClientRect();
		const base = layer.getBoundingClientRect();
		dialog.style.left = `${box.left - base.left}px`;
		dialog.style.top = `${box.top - base.top}px`;
		dialog.style.width = `${box.width}px`;
		dialog.style.height = `${box.height}px`;
		dialog.classList.add("is-placed");
		this.constrain(dialog, layer);
	}

	constrain(dialog, layer) {
		const bounds = dialog.supermaxBounds;
		const inset = parseFloat(this.workspace.document.defaultView.getComputedStyle(layer).paddingLeft) || 0;
		const room = layer.getBoundingClientRect();
		const width = Math.max(0, room.width - parseFloat(dialog.style.left) - inset);
		const height = Math.max(0, room.height - parseFloat(dialog.style.top) - inset);
		dialog.style.maxWidth = `${Math.min(bounds.max, width)}px`;
		dialog.style.maxHeight = `${Math.min(bounds.maxHeight, height)}px`;
	}

	grip(event, dialog, layer) {
		const box = dialog.getBoundingClientRect();
		if (event.button !== 0 || box.right - event.clientX > 18 || box.bottom - event.clientY > 18) return;
		this.pin(dialog, layer);
		this.constrain(dialog, layer);
	}

	drag(event, dialog, layer) {
		if (event.button !== 0 || event.target.closest("button, a, input, textarea, select")) return;
		event.preventDefault();
		this.pin(dialog, layer);
		const start = { x: event.clientX, y: event.clientY, left: parseFloat(dialog.style.left), top: parseFloat(dialog.style.top) };
		const move = (next) => {
			const inset = parseFloat(this.workspace.document.defaultView.getComputedStyle(layer).paddingLeft) || 0;
			const bounds = layer.getBoundingClientRect();
			const left = Math.min(Math.max(inset, start.left + next.clientX - start.x), bounds.width - dialog.offsetWidth - inset);
			const top = Math.min(Math.max(inset, start.top + next.clientY - start.y), bounds.height - dialog.offsetHeight - inset);
			dialog.style.left = `${Math.max(inset, left)}px`;
			dialog.style.top = `${Math.max(inset, top)}px`;
			this.constrain(dialog, layer);
			this.workspace.scheduleOrigins();
		};
		this.dragging?.abort();
		const controller = new AbortController();
		this.dragging = controller;
		const stop = () => controller.abort();
		const options = { signal: controller.signal };
		this.workspace.document.addEventListener("pointermove", move, options);
		this.workspace.document.addEventListener("pointerup", stop, options);
		this.workspace.document.addEventListener("pointercancel", stop, options);
	}

	settled(modal) {
		if (this.current === modal) this.place();
	}

	render() {
		const modal = this.current;
		if (!modal) return;
		this.describe(modal);
		this.place();
	}

	// allow-comment: the frustum shows the source to sighted users; this names it, or its closing, for everyone else.
	describe(modal) {
		if (!modal.source) return;
		const source = this.workspace.navigator.get(modal.source);
		modal.dialog.setAttribute("aria-description", source ? this.workspace.strings.modalFrom(source.title) : this.workspace.strings.modalSourceClosed());
	}

	place() {
		if (this.current) this.workspace.scheduleOrigins();
	}

	close(reason = "close") {
		const modal = this.current;
		if (!modal) return;
		const workspace = this.workspace;
		this.current = null;
		this.dragging?.abort();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		modal.slot.cancel();
		modal.slot.leave();
		this.leave(modal, reason, () => { modal.slot.dispose(); modal.bindings.abort(); modal.part.dispose(); modal.backdropPart.dispose(); workspace.disposeOrigin(modal.originLayer); });
		workspace.body.inert = false;
		if (workspace.folds.layer) workspace.folds.layer.inert = false;
		workspace.notices.render();
		workspace.element.classList.remove("has-modal");
		workspace.scheduleOrigins();
		workspace.dispatchEvent(new CustomEvent("modal", { detail: { state: "closed", reason, title: modal.title, source: modal.source } }));
	}
}
