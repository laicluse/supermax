import { ContentSlot } from "./content-slot.js";
import { focusables } from "./focus.js";

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
		const context = workspace.create("span", "supermax-modal-context", source ? `From ${source.title}` : "");
		titles.append(title, context);
		const close = workspace.create("button", "supermax-modal-close", "×");
		close.type = "button";
		close.setAttribute("aria-label", `Close ${definition.title}`);
		close.addEventListener("click", () => this.close("close"));
		header.append(titles, close);
		const body = workspace.create("div", "supermax-modal-body");
		dialog.append(header, body);
		element.append(dialog);
		element.addEventListener("pointerdown", (event) => { if (event.target === element) this.close("backdrop"); });
		this.onKeydown = (event) => this.keydown(event);
		workspace.element.addEventListener("keydown", this.onKeydown, true);
		const modal = { element, dialog, body, context, title: definition.title, source: source?.id ?? null, returnFocus: workspace.document.activeElement, slot: null, retry: null };
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
		modal.context.textContent = modal.source ? (source ? `From ${source.title}` : "Its source has closed") : "";
		modal.dialog.classList.toggle("is-orphaned", !!modal.source && !source);
		this.place();
	}

	place() {
		const modal = this.current;
		if (!modal) return;
		const { dialog } = modal;
		dialog.style.removeProperty("left");
		dialog.style.removeProperty("top");
		dialog.classList.remove("is-anchored");
		const sourceEntry = modal.source ? this.workspace.cells.get(modal.source) : null;
		if (!sourceEntry || !this.workspace.findCell(modal.source)?.full) return;
		const host = modal.element.getBoundingClientRect();
		const cell = sourceEntry.element.getBoundingClientRect();
		const left = Math.max(8, Math.min(cell.left - host.left + 12, host.width - dialog.offsetWidth - 8));
		const top = Math.max(8, Math.min(cell.top - host.top + 12, host.height - dialog.offsetHeight - 8));
		dialog.classList.add("is-anchored");
		dialog.style.left = `${Math.round(left)}px`;
		dialog.style.top = `${Math.round(top)}px`;
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
		modal.slot.dispose();
		modal.element.remove();
		workspace.body.inert = false;
		workspace.element.removeEventListener("keydown", this.onKeydown, true);
		this.onKeydown = null;
		workspace.notices.render();
		workspace.element.classList.remove("has-modal");
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
		workspace.backButton.focus({ preventScroll: true });
	}
}
