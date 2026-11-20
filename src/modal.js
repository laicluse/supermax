import { ContentSlot } from "./content-slot.js";
import { focusables } from "./focus.js";

const MODAL_BOUNDS = Object.freeze({ min: 280, max: 720, preferred: 440, minHeight: 160, maxHeight: Infinity, preferredHeight: null });

function px(value) {
	return Number.isFinite(value) ? `${value}px` : "";
}

export class ModalHost {
	constructor(workspace) {
		this.workspace = workspace;
		this.current = null;
		this.serial = 0;
		this.onKeydown = null;
	}

	open(definition, { from } = {}) {
		const workspace = this.workspace;
		workspace.closePeek();
		if (this.current) this.close("replaced");
		const source = workspace.navigator.get(from) ?? null;
		const element = workspace.create("div", "supermax-modal-layer");
		const dialog = workspace.create("section", "supermax-modal");
		dialog.setAttribute("role", "dialog");
		dialog.tabIndex = -1;
		const header = workspace.create("header", "supermax-modal-header");
		const titles = workspace.create("div", "supermax-modal-titles");
		const title = workspace.create("strong", "supermax-modal-title", definition.title);
		title.id = `supermax-modal-title-${(this.serial += 1)}`;
		dialog.setAttribute("aria-labelledby", title.id);
		const context = workspace.create("span", "supermax-modal-context", source ? workspace.strings.modalFrom(source.title) : "");
		titles.append(title, context);
		const close = workspace.create("button", "supermax-modal-close", "×");
		close.type = "button";
		close.setAttribute("aria-label", workspace.strings.closeModal(definition.title));
		close.addEventListener("click", () => this.close("close"));
		header.append(titles, close);
		const body = workspace.create("div", "supermax-modal-body");
		dialog.append(header, body);
		dialog.supermaxBounds = { ...MODAL_BOUNDS, ...Object.fromEntries(Object.keys(MODAL_BOUNDS).filter((key) => definition[key] !== undefined).map((key) => [key, definition[key]])) };
		this.size(dialog, dialog.supermaxBounds);
		header.addEventListener("pointerdown", (event) => this.drag(event, dialog, element));
		dialog.addEventListener("pointerdown", (event) => this.grip(event, dialog, element));
		this.resizeObserver = new workspace.document.defaultView.ResizeObserver(() => workspace.scheduleOrigins());
		this.resizeObserver.observe(dialog);
		const originLayer = workspace.origin ? workspace.originLayer("supermax-origin is-modal") : null;
		element.append(...(originLayer ? [originLayer] : []), dialog);
		element.addEventListener("pointerdown", (event) => { if (event.target === element) this.close("backdrop"); });
		this.onKeydown = (event) => this.keydown(event);
		workspace.element.addEventListener("keydown", this.onKeydown, true);
		workspace.notices.region.addEventListener("keydown", this.onKeydown, true);
		const modal = { element, dialog, body, context, title: definition.title, source: source?.id ?? null, originLayer, returnFocus: workspace.document.activeElement, slot: null, retry: null };
		modal.slot = new ContentSlot(workspace, { element, body, onSettled: () => this.settled(modal) });
		modal.retry = () => modal.slot.mount(definition.title, () => definition.content(modal, workspace), () => this.current === modal);
		this.current = modal;
		workspace.body.inert = true;
		workspace.notices.render();
		workspace.element.append(element);
		workspace.element.classList.add("has-modal");
		this.place();
		modal.retry();
		this.focus();
		workspace.dispatchEvent(new CustomEvent("modal", { detail: { state: "open", title: definition.title, source: modal.source } }));
		return modal;
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
		const inset = parseFloat(getComputedStyle(layer).paddingLeft) || 0;
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
			const inset = parseFloat(getComputedStyle(layer).paddingLeft) || 0;
			const bounds = layer.getBoundingClientRect();
			const left = Math.min(Math.max(inset, start.left + next.clientX - start.x), bounds.width - dialog.offsetWidth - inset);
			const top = Math.min(Math.max(inset, start.top + next.clientY - start.y), bounds.height - dialog.offsetHeight - inset);
			dialog.style.left = `${Math.max(inset, left)}px`;
			dialog.style.top = `${Math.max(inset, top)}px`;
			this.constrain(dialog, layer);
			this.workspace.scheduleOrigins();
		};
		const stop = () => {
			this.workspace.document.removeEventListener("pointermove", move);
			this.workspace.document.removeEventListener("pointerup", stop);
		};
		this.workspace.document.addEventListener("pointermove", move);
		this.workspace.document.addEventListener("pointerup", stop);
	}

	settled(modal) {
		if (this.current !== modal) return;
		this.place();
		const active = this.workspace.document.activeElement;
		if (!active || active === this.workspace.document.body || modal.dialog.contains(active)) this.focus();
	}

	render() {
		const modal = this.current;
		if (!modal) return;
		const source = modal.source ? this.workspace.navigator.get(modal.source) : null;
		modal.context.textContent = modal.source ? (source ? this.workspace.strings.modalFrom(source.title) : this.workspace.strings.modalSourceClosed()) : "";
		modal.dialog.classList.toggle("is-orphaned", !!modal.source && !source);
		this.place();
	}

	place() {
		if (this.current) this.workspace.scheduleOrigins();
	}

	focus() {
		const modal = this.current;
		if (!modal) return;
		const target = focusables(modal.dialog).find((candidate) => !candidate.classList.contains("supermax-modal-close")) ?? modal.dialog;
		target.focus({ preventScroll: true });
	}

	keydown(event) {
		const modal = this.current;
		if (!modal) return;
		const region = this.workspace.notices.region;
		const inDialog = modal.dialog.contains(event.target);
		const inNotices = region.contains(event.target);
		if (event.key === "Escape" && inDialog) {
			event.preventDefault();
			event.stopPropagation();
			this.close("escape");
			return;
		}
		if (event.key !== "Tab" || !(inDialog || inNotices)) return;
		const items = [...focusables(modal.dialog), ...focusables(region)];
		if (items.length === 0) { event.preventDefault(); modal.dialog.focus({ preventScroll: true }); return; }
		const index = items.indexOf(this.workspace.document.activeElement);
		const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index === items.length - 1 || index === -1 ? 0 : index + 1);
		event.preventDefault();
		items[next].focus({ preventScroll: true });
	}

	close(reason = "close") {
		const modal = this.current;
		if (!modal) return;
		const workspace = this.workspace;
		this.current = null;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		modal.slot.dispose();
		modal.element.remove();
		workspace.body.inert = false;
		workspace.element.removeEventListener("keydown", this.onKeydown, true);
		workspace.notices.region.removeEventListener("keydown", this.onKeydown, true);
		this.onKeydown = null;
		workspace.notices.render();
		workspace.element.classList.remove("has-modal");
		workspace.scheduleOrigins();
		this.returnFocus(modal);
		workspace.dispatchEvent(new CustomEvent("modal", { detail: { state: "closed", reason, title: modal.title, source: modal.source } }));
	}

	returnFocus(modal) {
		const workspace = this.workspace;
		if (modal.source && workspace.navigator.get(modal.source)) {
			const target = workspace.visibleCellFor(modal.source);
			if (target === modal.source && modal.returnFocus && workspace.element.contains(modal.returnFocus) && modal.returnFocus.offsetParent !== null) {
				modal.returnFocus.focus({ preventScroll: true });
				return;
			}
			if (target) { workspace.focusCell(target); return; }
		}
		const first = workspace.visibleCellFor(workspace.navigator.focused) ?? workspace.visibleCellFor(workspace.navigator.root.id);
		if (first) { workspace.focusCell(first); return; }
		workspace.upButton.focus({ preventScroll: true });
	}
}
