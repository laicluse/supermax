import { CellStrip, STRIP_TIMING } from "./cell-strip.js";
import { ContentSlot } from "./content-slot.js";
import { DividerLayer } from "./dividers.js";
import { chainRootOf, isSplit } from "./layout.js";
import { ModalHost } from "./modal.js";
import { NoticeBoard } from "./notices.js";
import { PeekController } from "./peek.js";
import { resolveStrings } from "./strings.js";
import { frustumOrigin } from "./origin.js";
import { defaultNoticeIcon } from "./icons.js";
import { HORIZON, ORIGAMI_PRESENTATION } from "./origami.js";

export const SLIDE_PRESENTATION = Object.freeze({ name: "slide", motion: null, createStrip: null });

function normalizePresentation(presentation) {
	if (!presentation || typeof presentation.name !== "string" || presentation.name.length === 0) throw new TypeError("presentation needs a name");
	if (!/^[a-z][a-z0-9-]*$/.test(presentation.name)) throw new TypeError("presentation name must be a lowercase identifier");
	const motion = presentation.motion ?? null;
	const source = presentation.createStrip ?? null;
	const createStrip = source ?? ((viewport) => new CellStrip(viewport, { motion }));
	return Object.freeze({ name: presentation.name, motion, source, createStrip });
}

// How far spare space pushes the cells in from the start; stretch leaves none.
const ALIGN = Object.freeze({ stretch: 0, start: 0, center: 0.5, end: 1 });
const JUSTIFY = Object.freeze({ stretch: "flex-start", start: "flex-start", center: "center", end: "flex-end" });

export class Workspace extends EventTarget {
	constructor(element, { navigator, content, onIntent = null, presentation = ORIGAMI_PRESENTATION, strings = {}, origin = frustumOrigin, overlayRoot = element.ownerDocument.body, noticePlacement = "source", noticeIcon = defaultNoticeIcon }) {
		super();
		if (noticeIcon !== null && typeof noticeIcon !== "function") throw new TypeError("noticeIcon must be a function that returns an element, or null for no icon");
		this.noticeIcon = noticeIcon;
		if (noticePlacement !== "source" && noticePlacement !== "top") throw new TypeError('noticePlacement must be "source" or "top"');
		this.noticePlacement = noticePlacement;
		if (origin !== null && typeof origin !== "function") throw new TypeError("origin must be a function that draws links, or null to draw none");
		this.strings = resolveStrings(strings);
		this.pastMaxWarned = new Set();
		this.origin = origin;
		this.overlayRoot = overlayRoot;
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
			if (event.key === "ArrowLeft" && event.altKey && !event.ctrlKey && !event.metaKey && !event.target.closest?.("input, textarea, select, [contenteditable]")) {
				event.preventDefault();
				this.requestUp();
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
		const { navbar } = this.navigator.chrome;
		this.element.classList.add("supermax-workspace");
		this.element.style.setProperty("--supermax-navbar", `${navbar}px`);
		this.navbar = this.create("nav", "supermax-navbar");
		this.navbar.setAttribute("aria-label", this.strings.navigation());
		this.upButton = this.create("button", "supermax-up");
		this.upButton.type = "button";
		this.upLabel = this.create("span", "supermax-up-label");
		this.upLabel.textContent = "‹";
		this.upLabel.setAttribute("aria-hidden", "true");
		this.upName = this.create("span", "supermax-up-target");
		this.upButton.append(this.upLabel, this.upName);
		this.upButton.addEventListener("click", () => this.requestUp());
		this.navbarLeft = this.create("div", "supermax-navbar-left");
		this.navbarLeft.append(this.upButton);
		this.titleBox = this.create("div", "supermax-title");
		this.titleText = this.create("strong", "supermax-title-text");
		this.titleContext = this.create("span", "supermax-title-context");
		this.titleBox.append(this.titleContext, this.titleText);
		this.navbar.append(this.navbarLeft, this.titleBox);
		this.body = this.create("div", "supermax-body");
		this.element.replaceChildren(this.navbar, this.body);
		this.noticeOrigin = this.origin ? this.originLayer("supermax-origin is-notices") : null;
		if (this.noticeOrigin) this.overlayRoot.append(this.noticeOrigin);
		this.onViewportChange = () => {
			this.placeHorizon();
			this.scheduleOrigins();
		};
		this.document.defaultView.addEventListener("resize", this.onViewportChange);
		this.document.addEventListener("scroll", this.onViewportChange, true);
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

	requestUp() {
		this.closePeek();
		const target = this.navigator.upTarget(this.layout ?? undefined);
		if (!target) return { ok: false, reason: "nothing-hidden" };
		if (this.modal) this.closeModal("navigation");
		const closed = this.navigator.showByClosing(target.id);
		this.render({ animate: true });
		this.focusCell(target.id);
		this.dispatchEvent(new CustomEvent("up", { detail: { shown: target.id, closed } }));
		return { ok: true, destination: target.id, closed };
	}

	intent(action) {
		this.closePeek();
		if (this.modal) this.closeModal("navigation");
		if (this.onIntent) return this.onIntent(action, this);
		return this.apply(action, { focus: true });
	}

	setPresentation(presentation) {
		const next = normalizePresentation(presentation);
		if (next.name === this.presentation.name && next.motion === this.presentation.motion && next.source === this.presentation.source) return;
		const activeElement = this.document.activeElement;
		const focused = activeElement?.closest?.(".supermax-cell")?.dataset.occurrence ?? null;
		this.closePeek();
		this.element.classList.remove(`supermax-presentation-${this.presentation.name}`);
		this.presentation = next;
		this.element.classList.add(`supermax-presentation-${next.name}`);
		for (const entry of this.chains.values()) {
			entry.strip.destroy();
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
		const modal = this.modalHost.open(definition, options);
		this.renderNavbar();
		return modal;
	}

	closeModal(reason = "close") {
		this.modalHost.close(reason);
		this.renderNavbar();
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
		const occurrence = this.navigator.get(occurrenceId);
		if (!occurrence) return false;
		this.navigator.bringIntoView(occurrenceId);
		this.navigator.focus(occurrenceId, { resetReveal: false });
		this.render({ animate: true });
		const target = this.findCell(occurrenceId);
		if (target?.compact) {
			this.peeks.open(occurrenceId);
			this.peeks.focus();
			return true;
		}
		this.focusCell(occurrenceId);
		return target?.full ?? false;
	}

	setSize(occurrenceId, size, axis = "width") {
		this.navigator.setSize(occurrenceId, size, axis);
		this.render({ animate: false });
		this.dispatchEvent(new CustomEvent("size", { detail: { occurrence: occurrenceId, size, axis } }));
	}

	run(action) {
		return action.type === "close"
			? this.navigator.closeNewestGroup()
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
			if (completed.keep && completed.compact && !entry.rail) this.peeks.mount(entry, occurrence, completed);
			this.mountContent(entry, occurrence);
		}
		for (const rejection of result.rejected) {
			this.dispatchEvent(new CustomEvent("rejected", { detail: { action: { type: "define", destination: id, occurrence: rejection.occurrence }, result: rejection.result } }));
		}
		if (result.completed.includes(this.navigator.focused)) this.navigator.bringIntoView(this.navigator.focused);
		this.render({ animate: true });
		return result;
	}

	setTitle(entry, title) {
		if (entry.titleNode) entry.titleNode.textContent = title;
		entry.element.setAttribute("aria-label", title);
		if (entry.rail) {
			entry.rail.setAttribute("aria-label", this.strings.peek(title));
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
		if (result.ok && result.occurrence) this.navigator.bringIntoView(result.occurrence.id);
		this.render({ animate });
		if (!result.ok) this.dispatchEvent(new CustomEvent("rejected", { detail: { action, result } }));
		this.dispatchEvent(new CustomEvent("change", { detail: { action, result } }));
		if (focus) this.focusAfter(action, result);
		return result;
	}

	replay(actions) {
		this.navigator.reset();
		const results = actions.map((action) => {
			const result = this.run(action);
			if (result.ok && result.occurrence) this.navigator.bringIntoView(result.occurrence.id);
			return result;
		});
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
		if (action.type === "close") this.focusCell(result.focus);
		else if (result.occurrence) this.focusCell(result.occurrence.id);
	}

	focusCell(occurrenceId) {
		const target = this.visibleCellFor(occurrenceId);
		const entry = target ? this.cells.get(target) : null;
		if (!entry) return;
		if (target !== this.navigator.focused) {
			this.navigator.focus(target, { resetReveal: false });
			this.renderNavbar();
		}
		const focusable = (this.findCell(target)?.compact ? entry.rail : null) ?? entry.element;
		this.programmaticFocus = true;
		focusable.focus({ preventScroll: true });
		this.programmaticFocus = false;
	}

	visibleCellFor(occurrenceId) {
		let current = this.navigator.get(occurrenceId);
		while (current) {
			const cell = this.findCell(current.id);
			if (cell?.inView) return this.contentCellIn(cell);
			const chain = this.findChain(chainRootOf(this.navigator, current).id);
			const inView = chain ? chain.cells.filter((candidate) => candidate.inView) : [];
			if (inView.length > 0) return this.contentCellIn(inView.find((candidate) => !candidate.kept) ?? inView[0]);
			current = current.parent ? this.navigator.get(current.parent) : null;
		}
		return null;
	}

	contentCellIn(cell) {
		if (!cell.rows) return cell.occurrence;
		const row = cell.rows.rows.find((candidate) => candidate.inView);
		const first = row?.chain ? row.chain.cells.find((candidate) => candidate.inView && !candidate.kept) : null;
		return first ? this.contentCellIn(first) : cell.occurrence;
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
		if (this.rendering || target.closest?.(".supermax-navbar")) return;
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
			this.warnPastMax(layout);
			this.upDestination = this.navigator.upTarget(layout);
			const animating = animate && !this.reducedMotion.matches;
			const rootViewport = this.renderChain(layout.chain, this.body, animating);
			rootViewport.style.height = `${layout.overflow ? layout.contentHeight : layout.chain.height}px`;
			rootViewport.style.width = layout.overflowX ? `${layout.chain.contentWidth}px` : "";
			this.body.classList.toggle("is-overflow", layout.overflow);
			this.body.classList.toggle("is-overflow-x", layout.overflowX);
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
		this.placeHorizon();
		this.scheduleOrigins();
		Promise.all([...this.chains.values()].map((entry) => entry.strip.finished)).then(() => this.scheduleOrigins());
		const target = this.pendingFocus;
		this.pendingFocus = null;
		if (target) this.focusCell(target);
	}

	placeHorizon() {
		const view = this.document.defaultView;
		const root = this.overlayRoot === this.document.body ? new DOMRect(0, 0, view.innerWidth, view.innerHeight) : this.overlayRoot.getBoundingClientRect();
		const x = root.left + root.width / 2;
		const y = root.top + root.height * HORIZON;
		for (const entry of this.chains.values()) {
			const box = entry.viewport.getBoundingClientRect();
			entry.viewport.style.perspectiveOrigin = `${Math.round(x - box.left)}px ${Math.round(y - box.top)}px`;
		}
	}

	originLayer(className) {
		const layer = this.document.createElementNS("http://www.w3.org/2000/svg", "svg");
		layer.setAttribute("class", className);
		layer.setAttribute("aria-hidden", "true");
		return layer;
	}

	scheduleOrigins() {
		if (!this.origin || this.originFrame) return;
		this.originFrame = this.document.defaultView.requestAnimationFrame(() => {
			this.originFrame = null;
			this.drawOrigins();
		});
	}

	originLink(id, overlay, sourceId) {
		const entry = sourceId ? this.cells.get(sourceId) : null;
		if (!overlay?.isConnected || !entry || !this.findCell(sourceId)?.full) return null;
		return { id, from: overlay.getBoundingClientRect(), to: entry.element.getBoundingClientRect() };
	}

	drawOrigins() {
		if (!this.origin || !this.layout) return;
		const modal = this.modal;
		const local = (layer, links) => {
			const base = layer.getBoundingClientRect();
			const shift = (rect) => new DOMRect(rect.left - base.left, rect.top - base.top, rect.width, rect.height);
			return links.map((link) => ({ ...link, from: shift(link.from), to: shift(link.to) }));
		};
		if (modal) this.origin({ kind: "modal", layer: modal.originLayer, links: local(modal.originLayer, [this.originLink("modal", modal.dialog, modal.source)].filter(Boolean)) });
		const bubbles = new Map();
		for (const notice of modal ? [] : this.notices.notices.values()) {
			if (notice.host === this.notices.region || notice.entering || bubbles.has(notice.source)) continue;
			const link = this.originLink(notice.source, notice.host, notice.source);
			if (link) bubbles.set(notice.source, link);
		}
		this.origin({ kind: "notice", layer: this.noticeOrigin, links: local(this.noticeOrigin, [...bubbles.values()]) });
		this.notices.veil();
	}

	warnPastMax(layout) {
		const past = [
			...[...layout.cells.values()].filter((cell) => cell.visible && !cell.compact && cell.width > cell.max + 0.5).map((cell) => [cell, "wider", cell.width, cell.max]),
			...[...layout.rows.values()].filter((row) => row.visible && row.height > row.maxHeight + 0.5).map((row) => [row, "taller", row.height, row.maxHeight]),
		];
		for (const [item, direction, size, max] of past) {
			const key = `${direction}:${item.occurrence.split("/").pop()}`;
			if (this.pastMaxWarned.has(key)) continue;
			this.pastMaxWarned.add(key);
			console.warn(`Supermax: "${item.title}" is drawn ${Math.round(size)}px ${direction === "wider" ? "wide" : "tall"}, past its max of ${max}px, because the cells beside it cannot fill the space. Raise a max to keep this configuration within its bounds.`);
		}
	}

	renderNavbar() {
		const next = this.upDestination;
		this.upButton.hidden = !next;
		this.upName.textContent = next ? next.title : "";
		if (next) this.upButton.setAttribute("aria-label", this.strings.up(next.title));
		else this.upButton.removeAttribute("aria-label");
		const info = this.navigator.locationInfo(this.layout ?? undefined);
		this.titleText.textContent = info.title;
		this.titleContext.replaceChildren(...info.trail.flatMap((step, index) => {
			const crumb = this.create("button", "supermax-crumb", step.title);
			crumb.type = "button";
			crumb.setAttribute("aria-label", this.strings.crumb(step.title));
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
			entry = { viewport, strip };
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
		entry.strip.strip.style.marginLeft = `${chain.spare * ALIGN[this.navigator.spareSpace]}px`;
		for (const cell of chain.cells) {
			if (cell.rows) this.renderRows(cell, animating);
		}
		const visible = chain.cells.filter((cell) => cell.visible);
		for (const cell of chain.cells) this.cells.get(cell.occurrence)?.element.classList.toggle("is-leading", cell === visible[0]);
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
			if (!next || !row.visible || !next.visible) return;
			const others = rows.filter((candidate) => candidate !== row).reduce((sum, candidate) => sum + (!candidate.visible || candidate.sized ? candidate.height : candidate.minHeight), 0);
			items.push({ id: row.occurrence, title: row.title, offset, size: row.height, min: row.minHeight, max: Math.max(row.minHeight, Math.min(row.maxHeight, budget - others)), sized: row.sized });
		});
		return items;
	}

	protectFocus(elements, target = this.navigator.focused) {
		const active = this.activeAtRender;
		if (!active || this.pendingFocus || !elements.some((element) => element.contains(active))) return;
		this.pendingFocus = this.navigator.get(target) ? target : this.navigator.focused;
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
		entry = { element, body, header, titleNode, slot: new ContentSlot(this, { element, body, id: occurrenceId }), parent: occurrence.parent, rail: null, provisional: false };
		if (!isSplit(definition) && definition.keep && definition.compact) this.peeks.mount(entry, occurrence, definition);
		this.cells.set(occurrenceId, entry);
		if (!isSplit(definition)) this.mountContent(entry, occurrence);
		return element;
	}

	renderRows(cell, animating) {
		const host = this.cells.get(cell.occurrence).body.firstElementChild;
		host.style.justifyContent = JUSTIFY[this.navigator.spareSpace];
		for (const row of cell.rows.rows) {
			let entry = this.rows.get(row.occurrence);
			if (!entry) {
				const element = this.create("div", "supermax-row");
				element.dataset.row = row.occurrence;
				const chain = this.create("div", "supermax-row-chain");
				element.append(chain);
				host.append(element);
				entry = { element, chain, height: null, animation: null };
				this.rows.set(row.occurrence, entry);
			}
			this.setRowHeight(entry, row.height, animating);
			entry.element.classList.toggle("is-hidden", !row.visible);
			const leading = row === cell.rows.rows.find((candidate) => candidate.visible);
			entry.element.classList.toggle("is-leading", leading);
			if (!row.visible) this.protectFocus([entry.chain]);
			entry.chain.inert = !row.visible;
			entry.chain.style.visibility = row.visible ? "" : "hidden";
			if (row.visible) {
				entry.chain.style.height = leading ? `${row.height}px` : `calc(${row.height}px - var(--supermax-gutter, 0px))`;
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
			if (entry.element.classList.contains("is-split")) this.dividers.dispose(entry.body.firstElementChild);
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
		this.document.defaultView.removeEventListener("resize", this.onViewportChange);
		this.document.removeEventListener("scroll", this.onViewportChange, true);
		if (this.originFrame) this.document.defaultView.cancelAnimationFrame(this.originFrame);
		this.noticeOrigin?.remove();
		for (const entry of this.cells.values()) entry.slot.dispose();
		for (const entry of this.chains.values()) entry.strip.destroy();
		this.cells.clear();
		this.chains.clear();
		this.rows.clear();
		this.element.replaceChildren();
		this.element.classList.remove("supermax-workspace", `supermax-presentation-${this.presentation.name}`);
		this.element.style.removeProperty("--supermax-navbar");
	}
}
