import { CellStrip, STRIP_TIMING } from "./cell-strip.js";
import { ContentSlot } from "./content-slot.js";
import { DividerLayer } from "./dividers.js";
import { chainRootOf, isSplit } from "./layout.js";
import { ModalHost } from "./modal.js";
import { NoticeBoard } from "./notices.js";
import { PeekController } from "./peek.js";

export const SLIDE_PRESENTATION = Object.freeze({ name: "slide", motion: null, createStrip: null });

function normalizePresentation(presentation) {
	if (!presentation || typeof presentation.name !== "string" || presentation.name.length === 0) throw new TypeError("presentation needs a name");
	if (!/^[a-z][a-z0-9-]*$/.test(presentation.name)) throw new TypeError("presentation name must be a lowercase identifier");
	const motion = presentation.motion ?? null;
	const createStrip = presentation.createStrip ?? ((viewport) => new CellStrip(viewport, { motion }));
	return Object.freeze({ name: presentation.name, motion, createStrip });
}

export class Workspace extends EventTarget {
	constructor(element, { navigator, content, onIntent = null, presentation = SLIDE_PRESENTATION }) {
		super();
		this.element = element;
		this.navigator = navigator;
		this.content = content;
		this.onIntent = onIntent;
		this.presentation = normalizePresentation(presentation);
		this.document = element.ownerDocument;
		this.cells = new Map();
		this.chains = new Map();
		this.rows = new Map();
		this.rendering = false;
		this.pendingFocus = null;
		this.notices = new NoticeBoard(this);
		this.modalHost = new ModalHost(this);
		this.peeks = new PeekController(this);
		this.dividers = new DividerLayer(this);
		this.reducedMotion = this.document.defaultView.matchMedia("(prefers-reduced-motion: reduce)");
		this.onFocusIn = (event) => this.followFocus(event.target);
		this.buildChrome();
		this.element.classList.add(`supermax-presentation-${this.presentation.name}`);
		this.element.addEventListener("focusin", this.onFocusIn);
		this.onKeydown = (event) => {
			if (event.key === "ArrowLeft" && event.altKey && !event.ctrlKey && !event.metaKey) {
				event.preventDefault();
				this.requestBack();
			}
		};
		this.element.addEventListener("keydown", this.onKeydown);
		this.observer = new this.document.defaultView.ResizeObserver(() => this.measure());
		this.observer.observe(element);
		this.measure();
	}

	create(tag, className, text) {
		const node = this.document.createElement(tag);
		if (className) node.className = className;
		if (text != null) node.textContent = text;
		return node;
	}

	buildChrome() {
		const { navbar, rowTab } = this.navigator.chrome;
		this.element.classList.add("supermax-workspace");
		this.element.style.setProperty("--supermax-navbar", `${navbar}px`);
		this.element.style.setProperty("--supermax-row-tab", `${rowTab}px`);
		this.navbar = this.create("nav", "supermax-navbar");
		this.navbar.setAttribute("aria-label", "Workspace navigation");
		this.backButton = this.create("button", "supermax-back");
		this.backButton.type = "button";
		this.backLabel = this.create("span", "supermax-back-label");
		this.backLabel.textContent = "Back";
		this.backTarget = this.create("span", "supermax-back-target");
		this.backButton.append(this.backLabel, this.backTarget);
		this.backButton.addEventListener("click", () => this.requestBack());
		this.navbarLeft = this.create("div", "supermax-navbar-left");
		this.navbarLeft.append(this.backButton);
		this.titleBox = this.create("div", "supermax-title");
		this.titleText = this.create("strong", "supermax-title-text");
		this.titleContext = this.create("span", "supermax-title-context");
		this.titleBox.append(this.titleContext, this.titleText);
		this.navbar.append(this.navbarLeft, this.titleBox);
		this.body = this.create("div", "supermax-body");
		this.element.replaceChildren(this.navbar, this.body, this.notices.region);
	}

	measure() {
		const rectangle = this.element.getBoundingClientRect();
		const size = { width: Math.round(rectangle.width), height: Math.round(rectangle.height) };
		if (size.width === this.navigator.size.width && size.height === this.navigator.size.height && this.rendered) return;
		this.navigator.resize(size);
		this.render({ animate: false });
	}

	navigate(destination, { from, hint } = {}) {
		return this.intent({ type: "open", destination, from, hint: hint ?? null });
	}

	requestBack() {
		return this.intent({ type: "back" });
	}

	intent(action) {
		this.closePeek();
		if (this.modal && action.type === "back") {
			this.closeModal("back");
			return { ok: true, noop: true };
		}
		if (this.modal) this.closeModal("navigation");
		if (this.onIntent) return this.onIntent(action, this);
		return this.apply(action, { focus: true });
	}

	setPresentation(presentation) {
		const next = normalizePresentation(presentation);
		if (next.name === this.presentation.name && next.createStrip === this.presentation.createStrip) return;
		const activeElement = this.document.activeElement;
		const focused = activeElement?.closest?.(".supermax-cell")?.dataset.occurrence ?? null;
		this.closePeek();
		this.element.classList.remove(`supermax-presentation-${this.presentation.name}`);
		this.presentation = next;
		this.element.classList.add(`supermax-presentation-${next.name}`);
		for (const entry of this.chains.values()) {
			entry.strip.destroy();
			entry.left.remove();
			entry.right.remove();
			entry.viewport.remove();
		}
		this.chains.clear();
		this.dividers.clear();
		if (this.rendered) this.render({ animate: false });
		if (activeElement?.isConnected && this.element.contains(activeElement)) activeElement.focus({ preventScroll: true });
		else if (focused) this.focusCell(focused);
		this.dispatchEvent(new CustomEvent("presentation", { detail: { name: next.name } }));
	}

	get modal() {
		return this.modalHost.current;
	}

	get peek() {
		return this.peeks.current;
	}

	notify(options) {
		return this.notices.notify(options);
	}

	dismiss(noticeId, state = "dismissed") {
		return this.notices.dismiss(noticeId, state);
	}

	dismissAll(state = "dismissed") {
		this.notices.dismissAll(state);
	}

	openModal(definition, options = {}) {
		return this.modalHost.open(definition, options);
	}

	closeModal(reason = "close") {
		this.modalHost.close(reason);
	}

	closePeek() {
		this.peeks.close();
	}

	reload(predicate = () => true) {
		for (const [occurrenceId, entry] of this.cells) {
			const occurrence = this.navigator.get(occurrenceId);
			if (!occurrence || entry.provisional) continue;
			const definition = this.navigator.definitionOf(occurrence.destination);
			if (isSplit(definition) || !predicate(occurrence, definition)) continue;
			this.mountContent(entry, occurrence);
		}
		this.modal?.retry();
	}

	failDefinition(id, error, retry = null) {
		let shown = 0;
		for (const [occurrenceId, entry] of this.cells) {
			const occurrence = this.navigator.get(occurrenceId);
			if (occurrence?.destination !== id || !entry.provisional) continue;
			entry.slot.retry = () => { entry.slot.loading(occurrence.title); retry?.(); };
			entry.slot.error(occurrence.title, error);
			shown += 1;
		}
		this.navigator.abandon(id);
		return shown;
	}

	goTo(occurrenceId) {
		let current = this.navigator.get(occurrenceId);
		while (current) {
			const row = this.rows.get(current.id);
			if (row?.element.classList.contains("is-collapsed")) { this.focusRow(current.id); break; }
			current = current.parent ? this.navigator.get(current.parent) : null;
		}
		const chainRoot = chainRootOf(this.navigator, this.navigator.get(occurrenceId));
		const chain = this.findChain(chainRoot.id);
		const cell = chain?.cells.find((candidate) => candidate.occurrence === occurrenceId);
		if (cell && !cell.visible) {
			const index = chain.cells.indexOf(cell);
			const wanted = chain.cells.length - 1 - index;
			this.reveal(chainRoot.id, wanted - chain.revealOffset);
		}
		this.focusCell(occurrenceId);
		return this.findCell(occurrenceId)?.inView ?? false;
	}

	collapsedRowFor(occurrenceId) {
		let current = this.navigator.get(occurrenceId);
		while (current) {
			if (this.findRow(current.id)?.collapsed) return this.rows.get(current.id)?.tab ?? null;
			current = current.parent ? this.navigator.get(current.parent) : null;
		}
		return null;
	}

	collapse(occurrenceId, collapsed = !this.navigator.collapsed.has(occurrenceId)) {
		this.closePeek();
		this.navigator.collapse(occurrenceId, collapsed);
		this.render({ animate: true });
		this.focusCell(occurrenceId);
	}

	setSize(occurrenceId, size, axis = "width") {
		this.navigator.setSize(occurrenceId, size, axis);
		this.render({ animate: false });
		this.dispatchEvent(new CustomEvent("size", { detail: { occurrence: occurrenceId, size, axis } }));
	}

	run(action) {
		return action.type === "back"
			? this.navigator.back()
			: this.navigator.open(action.destination, { from: action.from, hint: action.hint ?? null });
	}

	define(id, definition) {
		const result = this.navigator.define(id, definition);
		const completed = this.navigator.definitionOf(id);
		for (const [occurrenceId, entry] of this.cells) {
			const occurrence = this.navigator.get(occurrenceId);
			if (occurrence?.destination !== id) continue;
			this.setTitle(entry, occurrence.title);
			if (!entry.provisional) continue;
			if (isSplit(completed)) {
				this.becomeSplit(entry);
				continue;
			}
			if (completed.compact && !entry.rail) this.peeks.mount(entry, occurrence, completed);
			this.mountContent(entry, occurrence);
		}
		for (const rejection of result.rejected) {
			this.dispatchEvent(new CustomEvent("rejected", { detail: { action: { type: "define", destination: id, occurrence: rejection.occurrence }, result: rejection.result } }));
		}
		this.render({ animate: true });
		return result;
	}

	setTitle(entry, title) {
		if (entry.titleNode) entry.titleNode.textContent = title;
		entry.element.setAttribute("aria-label", title);
		entry.collapseButton?.setAttribute("aria-label", `Collapse ${title}`);
		if (entry.rail) {
			entry.rail.setAttribute("aria-label", `Peek ${title}`);
			entry.rail.firstChild.textContent = title;
		}
	}

	becomeSplit(entry) {
		entry.slot.dispose();
		entry.provisional = false;
		entry.header?.remove();
		entry.header = null;
		entry.element.querySelector(":scope > .supermax-compact")?.remove();
		entry.rail = null;
		entry.collapseButton = null;
		entry.element.classList.remove("is-provisional", "is-loading", "is-error", "is-compact");
		entry.element.classList.add("is-split");
		entry.body.replaceChildren(this.create("div", "supermax-rows"));
	}

	mountContent(entry, occurrence) {
		const definition = this.navigator.definitionOf(occurrence.destination);
		entry.provisional = !!definition.provisional;
		entry.element.classList.toggle("is-provisional", entry.provisional);
		entry.slot.retry = () => this.mountContent(entry, this.navigator.get(occurrence.id));
		if (entry.provisional) {
			entry.slot.dispose();
			entry.slot.loading(occurrence.title);
			return;
		}
		entry.slot.mount(occurrence.title, () => this.content(occurrence, definition, this), () => this.cells.get(occurrence.id) === entry);
	}

	apply(action, { animate = true, focus = false } = {}) {
		const result = this.run(action);
		this.render({ animate });
		if (!result.ok) this.dispatchEvent(new CustomEvent("rejected", { detail: { action, result } }));
		this.dispatchEvent(new CustomEvent("change", { detail: { action, result } }));
		if (focus) this.focusAfter(action, result);
		return result;
	}

	replay(actions) {
		this.navigator.reset();
		const results = actions.map((action) => this.run(action));
		this.render({ animate: false });
		actions.forEach((action, index) => {
			if (!results[index].ok) this.dispatchEvent(new CustomEvent("rejected", { detail: { action, result: results[index] } }));
		});
		this.dispatchEvent(new CustomEvent("change", { detail: { action: { type: "replay" }, result: { ok: results.every((result) => result.ok) } } }));
		return results;
	}

	restore(snapshot) {
		if (!this.navigator.restore(snapshot)) return false;
		this.render({ animate: false });
		this.dispatchEvent(new CustomEvent("change", { detail: { action: { type: "restore" }, result: { ok: true } } }));
		return true;
	}

	focusAfter(action, result) {
		if (!result.ok) return;
		if (action.type === "back") this.focusCell(result.focus);
		else if (result.occurrence) this.focusCell(result.occurrence.id);
	}

	focusRow(rowRootId) {
		this.navigator.focus(rowRootId, { resetReveal: false });
		this.render({ animate: true });
		this.focusCell(rowRootId);
	}

	reveal(chainRootId, delta) {
		this.navigator.reveal(chainRootId, delta);
		const before = this.navigator.layout();
		const chain = before.chains.get(chainRootId) ?? null;
		const visible = chain ? chain.cells.filter((cell) => cell.visible) : [];
		const target = delta > 0 ? visible[0] : visible[visible.length - 1];
		if (target) this.navigator.focus(target.occurrence, { resetReveal: false });
		this.render({ animate: true });
		if (target) this.focusCell(target.occurrence);
	}

	focusCell(occurrenceId) {
		const target = this.visibleCellFor(occurrenceId);
		const entry = target ? this.cells.get(target) : null;
		if (!entry) return;
		const focusable = (this.findCell(target)?.compact ? entry.rail : null) ?? entry.element;
		this.programmaticFocus = true;
		focusable.focus({ preventScroll: true });
		this.programmaticFocus = false;
	}

	visibleCellFor(occurrenceId) {
		let current = this.navigator.get(occurrenceId);
		while (current) {
			const cell = this.findCell(current.id);
			if (cell?.inView) return current.id;
			const chain = this.findChain(chainRootOf(this.navigator, current).id);
			const inView = chain ? chain.cells.filter((candidate) => candidate.inView) : [];
			if (inView.length > 0) return inView[0].occurrence;
			current = current.parent ? this.navigator.get(current.parent) : null;
		}
		return null;
	}

	findChain(chainRootId) {
		return this.layout?.chains.get(chainRootId) ?? null;
	}

	findCell(occurrenceId) {
		return this.layout?.cells.get(occurrenceId) ?? null;
	}

	findRow(rowRootId) {
		return this.layout?.rows.get(rowRootId) ?? null;
	}

	followFocus(target) {
		if (this.rendering || target.closest?.(".supermax-row-tab, .supermax-reveal, .supermax-navbar")) return;
		const cell = target.closest?.(".supermax-cell");
		if (!cell || !this.element.contains(cell) || cell.classList.contains("is-split")) return;
		const occurrenceId = cell.dataset.occurrence;
		if (occurrenceId === this.navigator.focused || !this.navigator.get(occurrenceId)) return;
		this.navigator.focus(occurrenceId, { resetReveal: false });
		this.render({ animate: true });
	}

	render({ animate = true } = {}) {
		this.rendering = true;
		this.rendered = true;
		this.activeAtRender = this.document.activeElement;
		let layout;
		try {
			layout = this.navigator.layout();
			this.layout = layout;
			const animating = animate && !this.reducedMotion.matches;
			const rootViewport = this.renderChain(layout.chain, this.body, animating);
			rootViewport.style.height = `${layout.overflow ? layout.contentHeight : layout.chain.height}px`;
			this.body.classList.toggle("is-overflow", layout.overflow);
			this.element.classList.toggle("is-below-minimum", layout.belowMinimum);
			this.pruneClosed();
			this.refreshContent();
			this.renderNavbar();
			this.modalHost.render();
			this.notices.render();
		} finally {
			this.rendering = false;
		}
		this.dispatchEvent(new CustomEvent("render", { detail: { layout } }));
		const target = this.pendingFocus;
		this.pendingFocus = null;
		if (target) this.focusCell(target);
	}

	renderNavbar() {
		const next = this.navigator.nextBack();
		this.backButton.disabled = !next;
		this.backTarget.hidden = !next;
		this.backTarget.textContent = next ? next.title : "";
		this.backButton.setAttribute("aria-label", next ? `Back closes ${next.title}` : "Back: nothing to close");
		const info = this.navigator.focusInfo();
		this.titleText.textContent = info.title;
		this.titleContext.replaceChildren(...info.trail.flatMap((step, index) => {
			const crumb = this.create("button", "supermax-crumb", step.title);
			crumb.type = "button";
			crumb.setAttribute("aria-label", `Go to ${step.title}`);
			crumb.addEventListener("click", () => this.goTo(step.occurrence));
			return index === 0 ? [crumb] : [this.create("span", "supermax-crumb-separator", "›"), crumb];
		}));
		this.titleContext.hidden = info.trail.length === 0;
	}

	renderChain(chain, host, animating) {
		let entry = this.chains.get(chain.root);
		if (!entry) {
			const viewport = this.create("div", "supermax-chain");
			host.append(viewport);
			const strip = this.presentation.createStrip(viewport, this);
			const left = this.revealButton("left", () => this.reveal(chain.root, 1));
			const right = this.revealButton("right", () => this.reveal(chain.root, -1));
			entry = { viewport, strip, left, right };
			this.chains.set(chain.root, entry);
		}
		const entries = chain.cells.map((cell) => ({
			id: cell.occurrence,
			element: this.mountCell(cell.occurrence),
			width: cell.width,
			visible: cell.visible,
		}));
		for (const cell of chain.cells) this.peeks.apply(cell);
		this.protectFocus(entries.filter((cell) => !cell.visible).map((cell) => cell.element));
		entry.strip.update(entries, { animate: animating });
		for (const cell of chain.cells) {
			if (cell.rows) this.renderRows(cell, animating);
		}
		const visible = chain.cells.filter((cell) => cell.visible);
		this.placeReveal(entry.left, chain.hiddenLeft, visible[0], "prepend", entry.viewport);
		this.placeReveal(entry.right, chain.hiddenRight, visible[visible.length - 1], "append", entry.viewport);
		this.dividers.sync(entry.viewport, "vertical", this.widthDividers(chain, visible));
		return entry.viewport;
	}

	widthDividers(chain, visible) {
		const items = [];
		let offset = 0;
		visible.forEach((cell, index) => {
			offset += cell.width;
			const next = visible[index + 1];
			if (!next || cell.compact || next.compact) return;
			const others = visible.filter((candidate) => candidate !== cell).reduce((sum, candidate) => sum + (candidate.compact || candidate.sized ? candidate.width : candidate.min), 0);
			items.push({ id: cell.occurrence, title: cell.title, offset, size: cell.width, min: cell.min, max: Math.max(cell.min, Math.min(cell.max, chain.width - others)), sized: cell.sized });
		});
		return items;
	}

	heightDividers(rows, budget) {
		const items = [];
		let offset = 0;
		rows.forEach((row, index) => {
			offset += row.height;
			const next = rows[index + 1];
			if (!next || row.collapsed || next.collapsed) return;
			const others = rows.filter((candidate) => candidate !== row).reduce((sum, candidate) => sum + (candidate.collapsed || candidate.sized ? candidate.height : candidate.minHeight), 0);
			items.push({ id: row.occurrence, title: row.title, offset, size: row.height, min: row.minHeight, max: Math.max(row.minHeight, Math.min(row.maxHeight, budget - others)), sized: row.sized });
		});
		return items;
	}

	protectFocus(elements, target = this.navigator.focused) {
		const active = this.activeAtRender;
		if (!active || this.pendingFocus || !elements.some((element) => element.contains(active))) return;
		this.pendingFocus = this.navigator.get(target) ? target : this.navigator.focused;
	}

	revealButton(side, onClick) {
		const button = this.create("button", `supermax-reveal is-${side}`);
		button.type = "button";
		button.hidden = true;
		button.addEventListener("click", onClick);
		return button;
	}

	placeReveal(button, title, cell, position, viewport) {
		button.hidden = !title;
		if (!title) return;
		button.textContent = title;
		button.setAttribute("aria-label", `Show ${title}`);
		const header = cell && !cell.compact ? this.cells.get(cell.occurrence)?.header : null;
		const floating = !!cell && cell.compact;
		const host = header ?? (floating ? viewport : this.navbarLeft);
		button.classList.toggle("is-floating", floating);
		if (button.parentElement !== host) host[header ? position : "append"](button);
	}

	mountCell(occurrenceId) {
		let entry = this.cells.get(occurrenceId);
		if (entry) return entry.element;
		const occurrence = this.navigator.get(occurrenceId);
		const definition = this.navigator.definitionOf(occurrence.destination);
		const element = this.create("section", "supermax-cell");
		element.dataset.occurrence = occurrenceId;
		element.tabIndex = -1;
		element.setAttribute("aria-label", occurrence.title);
		const body = this.create("div", "supermax-cell-body");
		let header = null;
		let titleNode = null;
		if (isSplit(definition)) {
			element.classList.add("is-split");
			body.append(this.create("div", "supermax-rows"));
		} else {
			header = this.create("header", "supermax-cell-title");
			titleNode = this.create("span", "supermax-cell-title-text", occurrence.title);
			header.append(titleNode);
			element.append(header);
		}
		element.append(body);
		entry = { element, body, header, titleNode, slot: new ContentSlot(this, { element, body, id: occurrenceId }), parent: occurrence.parent, rail: null, collapseButton: null, provisional: false };
		if (!isSplit(definition) && definition.compact) this.peeks.mount(entry, occurrence, definition);
		this.cells.set(occurrenceId, entry);
		if (!isSplit(definition)) this.mountContent(entry, occurrence);
		return element;
	}

	renderRows(cell, animating) {
		const host = this.cells.get(cell.occurrence).body.firstElementChild;
		for (const row of cell.rows.rows) {
			let entry = this.rows.get(row.occurrence);
			if (!entry) {
				const element = this.create("div", "supermax-row");
				element.dataset.row = row.occurrence;
				const tab = this.create("button", "supermax-row-tab");
				tab.type = "button";
				tab.textContent = row.title;
				tab.setAttribute("aria-label", `Open row ${row.title}`);
				tab.addEventListener("click", () => this.focusRow(row.occurrence));
				const chain = this.create("div", "supermax-row-chain");
				element.append(tab, chain);
				host.append(element);
				entry = { element, tab, chain, height: null, animation: null };
				this.rows.set(row.occurrence, entry);
			}
			this.setRowHeight(entry, row.height, animating);
			entry.element.classList.toggle("is-collapsed", row.collapsed);
			entry.element.classList.toggle("is-focused", row.focused);
			if (row.collapsed) this.protectFocus([entry.chain]);
			entry.tab.hidden = !row.collapsed;
			entry.chain.inert = row.collapsed;
			entry.chain.style.visibility = row.collapsed ? "hidden" : "";
			if (!row.collapsed) {
				entry.chain.style.height = `${row.height}px`;
				this.renderChain(row.chain, entry.chain, animating);
			}
		}
		this.dividers.sync(host, "horizontal", this.heightDividers(cell.rows.rows, cell.rows.contentHeight));
	}

	setRowHeight(entry, height, animating) {
		const previous = animating && entry.height !== null ? entry.element.offsetHeight : null;
		entry.height = height;
		entry.animation?.cancel();
		entry.animation = null;
		entry.element.style.height = `${height}px`;
		if (!animating || previous === null || Math.abs(previous - height) < 0.5) return;
		entry.animation = entry.element.animate(
			[{ height: `${previous}px` }, { height: `${height}px` }],
			STRIP_TIMING,
		);
	}

	pruneClosed() {
		for (const [occurrenceId, entry] of this.cells) {
			if (this.navigator.get(occurrenceId)) continue;
			if (this.peek?.occurrence === occurrenceId) this.closePeek();
			this.protectFocus([entry.element], entry.parent);
			this.cells.delete(occurrenceId);
			this.afterExit(entry.element, () => entry.slot.dispose());
		}
		for (const [rowId, entry] of this.rows) {
			if (this.navigator.get(rowId)) continue;
			this.rows.delete(rowId);
			this.afterExit(entry.element, () => entry.element.remove());
		}
		for (const [chainRootId, entry] of this.chains) {
			if (this.navigator.get(chainRootId)) continue;
			this.chains.delete(chainRootId);
			entry.left.remove();
			entry.right.remove();
			this.dividers.dispose(entry.viewport);
			this.afterExit(entry.viewport, () => {
				entry.strip.destroy();
				entry.viewport.remove();
			});
		}
	}

	afterExit(element, dispose) {
		const exiting = element.closest("[data-supermax-exiting]");
		const viewport = exiting?.parentElement?.closest(".supermax-chain");
		const owner = viewport ? [...this.chains.entries()].find(([, entry]) => entry.viewport === viewport) : null;
		if (!owner) {
			dispose();
			return;
		}
		const [ownerId, entry] = owner;
		const settle = () => {
			if (exiting.isConnected && this.chains.get(ownerId) === entry) entry.strip.finished.then(settle);
			else dispose();
		};
		entry.strip.finished.then(settle);
	}

	refreshContent() {
		for (const [occurrenceId, entry] of this.cells) {
			entry.slot.handle.update?.(this.navigator.get(occurrenceId), this);
		}
	}

	destroy() {
		this.closePeek();
		if (this.modal) this.closeModal("destroyed");
		this.notices.clear();
		this.dividers.clear();
		this.layout = null;
		this.pendingFocus = null;
		this.element.removeEventListener("keydown", this.onKeydown);
		this.element.classList.remove("has-modal", "is-below-minimum");
		this.observer.disconnect();
		this.element.removeEventListener("focusin", this.onFocusIn);
		for (const entry of this.cells.values()) entry.slot.dispose();
		for (const entry of this.chains.values()) entry.strip.destroy();
		this.cells.clear();
		this.chains.clear();
		this.rows.clear();
		this.element.replaceChildren();
		this.element.classList.remove("supermax-workspace", `supermax-presentation-${this.presentation.name}`);
		this.element.style.removeProperty("--supermax-navbar");
		this.element.style.removeProperty("--supermax-row-tab");
	}
}
