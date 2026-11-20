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

function normalizePresentation(presentation) {
	if (!presentation || typeof presentation.name !== "string" || presentation.name.length === 0) throw new TypeError("presentation needs a name");
	if (!/^[a-z][a-z0-9-]*$/.test(presentation.name)) throw new TypeError("presentation name must be a lowercase identifier");
	const motion = presentation.motion ?? null;
	const source = presentation.createStrip ?? null;
	const createStrip = source ?? ((viewport) => new CellStrip(viewport, { motion }));
	return Object.freeze({ name: presentation.name, motion, source, createStrip });
}

// How far spare space pushes the cells in from the start when no elastic cell takes it.
const ALIGN = Object.freeze({ start: 0, center: 0.5, end: 1 });
const JUSTIFY = Object.freeze({ start: "flex-start", center: "center", end: "flex-end" });

export class Workspace extends EventTarget {
	constructor(element, { navigator, content, onIntent = null, presentation = ORIGAMI_PRESENTATION, strings = {}, origin = frustumOrigin, overlayRoot = element.ownerDocument.body, noticePlacement = "source", noticeIcon = defaultNoticeIcon }) {
		super();
		if (noticeIcon !== null && typeof noticeIcon !== "function") throw new TypeError("noticeIcon must be a function that returns an element, or null for no icon");
		this.noticeIcon = noticeIcon;
		if (noticePlacement !== "source" && noticePlacement !== "top") throw new TypeError('noticePlacement must be "source" or "top"');
		this.noticePlacement = noticePlacement;
		if (origin !== null && typeof origin !== "function") throw new TypeError("origin must be a function that draws links, or null to draw none");
		this.strings = resolveStrings(strings);
		this.origin = origin;
		this.overlayRoot = overlayRoot;
		this.element = element;
		this.navigator = navigator;
		this.content = content;
		this.onIntent = onIntent;
		this.presentation = normalizePresentation(presentation);
		this.document = element.ownerDocument;
		this.cells = new Map();
		this.leavingCells = new Map();
		this.chains = new Map();
		this.rows = new Map();
		this.notices = new NoticeBoard(this);
		this.modalHost = new ModalHost(this);
		this.peeks = new PeekController(this);
		this.dividers = new DividerLayer(this);
		this.reducedMotion = this.document.defaultView.matchMedia("(prefers-reduced-motion: reduce)");
		this.buildChrome();
		this.element.classList.add(`supermax-presentation-${this.presentation.name}`);
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

	navigate(destination, { from } = {}) {
		return this.intent({ type: "open", destination, from });
	}

	requestUp() {
		this.closePeek();
		const target = this.navigator.upTarget(this.layout ?? undefined);
		if (!target) return { ok: false, reason: "nothing-hidden" };
		if (this.modal) this.closeModal("navigation");
		const closed = this.navigator.showByClosing(target.id);
		this.render({ animate: true });
		this.dispatchEvent(new CustomEvent("up", { detail: { shown: target.id, closed } }));
		return { ok: true, destination: target.id, closed };
	}

	intent(action) {
		this.closePeek();
		if (this.modal) this.closeModal("navigation");
		if (this.onIntent) return this.onIntent(action, this);
		return this.apply(action);
	}

	setPresentation(presentation) {
		const next = normalizePresentation(presentation);
		if (next.name === this.presentation.name && next.motion === this.presentation.motion && next.source === this.presentation.source) return;
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
			if (!occurrence) continue;
			const definition = this.navigator.definitionOf(occurrence.destination);
			if (isSplit(definition) || !predicate(occurrence, definition)) continue;
			this.mountContent(entry, occurrence);
		}
		this.modal?.retry();
	}

	goTo(occurrenceId) {
		const occurrence = this.navigator.get(occurrenceId);
		if (!occurrence) return false;
		this.navigator.bringIntoView(occurrenceId);
		this.render({ animate: true });
		const target = this.findCell(occurrenceId);
		if (target?.compact) {
			this.peeks.open(occurrenceId);
			return true;
		}
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
			: this.navigator.open(action.destination, { from: action.from });
	}

	mountContent(entry, occurrence) {
		const definition = this.navigator.definitionOf(occurrence.destination);
		entry.slot.retry = () => this.mountContent(entry, this.navigator.get(occurrence.id));
		entry.slot.mount(occurrence.title, () => this.content(occurrence, definition, this), () => this.cells.get(occurrence.id) === entry);
	}

	apply(action, { animate = true } = {}) {
		const result = this.run(action);
		if (result.ok && result.occurrence) this.navigator.bringIntoView(result.occurrence.id);
		this.render({ animate });
		if (!result.ok) this.dispatchEvent(new CustomEvent("rejected", { detail: { action, result } }));
		this.dispatchEvent(new CustomEvent("change", { detail: { action, result } }));
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

	restore(snapshot, { animate = false } = {}) {
		if (!this.navigator.restore(snapshot)) return false;
		this.render({ animate });
		this.dispatchEvent(new CustomEvent("change", { detail: { action: { type: "restore" }, result: { ok: true } } }));
		return true;
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

	render({ animate = true } = {}) {
		this.wasRendered = this.rendered;
		this.rendered = true;
		const layout = this.navigator.layout();
		this.layout = layout;
		this.upDestination = this.navigator.upTarget(layout);
		const animating = animate && !this.reducedMotion.matches;
		this.animating = animating;
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
		this.dispatchEvent(new CustomEvent("render", { detail: { layout } }));
		this.placeHorizon();
		this.scheduleOrigins();
		Promise.all([...this.chains.values()].map((entry) => entry.strip.finished)).then(() => this.scheduleOrigins());
	}

	placeHorizon() {
		const view = this.document.defaultView;
		const root = this.overlayRoot === this.document.body ? new DOMRect(0, 0, view.innerWidth, view.innerHeight) : this.overlayRoot.getBoundingClientRect();
		const x = root.left + root.width / 2;
		const y = root.top + root.height * HORIZON;
		for (const entry of this.chains.values()) {
			const box = entry.viewport.getBoundingClientRect();
			entry.viewport.style.perspectiveOrigin = `${Math.round(x - box.left)}px ${Math.round(y - box.top)}px`;
			for (const room of entry.strip.strip.querySelectorAll(":scope > .supermax-room")) {
				const place = room.getBoundingClientRect();
				room.style.perspectiveOrigin = `${Math.round(x - place.left)}px ${Math.round(y - place.top)}px`;
			}
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

	localLinks(layer, links) {
		const base = layer.getBoundingClientRect();
		const shift = (rect) => new DOMRect(rect.left - base.left, rect.top - base.top, rect.width, rect.height);
		return links.map((link) => ({ ...link, from: shift(link.from), to: shift(link.to) }));
	}

	drawModalOrigin(modal, entering) {
		if (!this.origin || !modal.originLayer) return;
		this.origin({ kind: "modal", layer: modal.originLayer, links: this.localLinks(modal.originLayer, [this.originLink("modal", modal.dialog, modal.source)].filter(Boolean)), entering });
	}

	drawOrigins() {
		if (!this.origin || !this.layout) return;
		const modal = this.modal;
		if (modal) this.drawModalOrigin(modal, modal.entrance ? modal.entrance.effect.getComputedTiming().progress ?? 1 : null);
		const bubbles = new Map();
		for (const notice of modal ? [] : this.notices.notices.values()) {
			if (notice.host === this.notices.region || notice.entering || bubbles.has(notice.source)) continue;
			const link = this.originLink(notice.source, notice.host, notice.source);
			if (link) bubbles.set(notice.source, link);
		}
		this.origin({ kind: "notice", layer: this.noticeOrigin, links: this.localLinks(this.noticeOrigin, [...bubbles.values()]) });
		this.notices.veil();
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

	renderChain(chain, host, animating, { inRow = false } = {}) {
		let entry = this.chains.get(chain.root);
		const created = !entry;
		if (created) {
			const viewport = this.create("div", "supermax-chain");
			host.append(viewport);
			const strip = this.presentation.createStrip(viewport, this);
			entry = { viewport, strip };
			this.chains.set(chain.root, entry);
		}
		const entries = chain.cells.map((cell, index) => ({
			id: cell.occurrence,
			element: this.mountCell(cell.occurrence),
			width: cell.width,
			visible: cell.visible,
			axis: inRow && index === 0 ? "row" : "chain",
			still: !!cell.rows,
		}));
		for (const cell of chain.cells) this.peeks.apply(cell);
		entry.strip.update(entries, { animate: animating, arrive: created && this.wasRendered && animating });
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

	mountCell(occurrenceId) {
		let entry = this.cells.get(occurrenceId);
		if (entry) return entry.element;
		entry = this.leavingCells.get(occurrenceId);
		if (entry) {
			this.leavingCells.delete(occurrenceId);
			this.cells.set(occurrenceId, entry);
			return entry.element;
		}
		const occurrence = this.navigator.get(occurrenceId);
		const definition = this.navigator.definitionOf(occurrence.destination);
		const element = this.create("section", "supermax-cell");
		element.dataset.occurrence = occurrenceId;
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
		entry = { element, body, header, titleNode, slot: new ContentSlot(this, { element, body, id: occurrenceId }), parent: occurrence.parent, rail: null };
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
			entry.chain.inert = !row.visible;
			entry.chain.style.visibility = row.visible ? "" : "hidden";
			if (row.visible) {
				entry.chain.style.height = leading ? `${row.height}px` : `calc(${row.height}px - var(--supermax-gutter, 0px))`;
				this.renderChain(row.chain, entry.chain, animating, { inRow: true });
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
			this.cells.delete(occurrenceId);
			this.leavingCells.set(occurrenceId, entry);
			if (entry.element.classList.contains("is-split")) this.dividers.dispose(entry.body.firstElementChild);
			this.afterExit(entry.element, () => {
				if (this.leavingCells.get(occurrenceId) !== entry) return;
				this.leavingCells.delete(occurrenceId);
				entry.slot.dispose();
			});
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
			entry.strip.update([], { animate: this.animating }).then(() => this.afterExit(entry.viewport, () => {
				entry.strip.destroy();
				entry.viewport.remove();
			}));
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
			const leaving = exiting.isConnected && this.chains.get(ownerId) === entry && entry.strip.entries.some((candidate) => candidate.element === exiting && candidate.departing);
			if (leaving) entry.strip.finished.then(settle);
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
		this.element.classList.remove("has-modal", "is-below-minimum");
		this.observer.disconnect();
		this.document.defaultView.removeEventListener("resize", this.onViewportChange);
		this.document.removeEventListener("scroll", this.onViewportChange, true);
		if (this.originFrame) this.document.defaultView.cancelAnimationFrame(this.originFrame);
		this.noticeOrigin?.remove();
		for (const entry of [...this.cells.values(), ...this.leavingCells.values()]) entry.slot.dispose();
		for (const entry of this.chains.values()) entry.strip.destroy();
		this.cells.clear();
		this.leavingCells.clear();
		this.chains.clear();
		this.rows.clear();
		this.element.replaceChildren();
		this.element.classList.remove("supermax-workspace", `supermax-presentation-${this.presentation.name}`);
		this.element.style.removeProperty("--supermax-navbar");
	}
}
