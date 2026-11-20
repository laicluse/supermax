import { CellStrip } from "./cell-strip.js";
import { chainRootOf, isSplit } from "./layout.js";

export class Workspace extends EventTarget {
	constructor(element, { navigator, content, onIntent = null }) {
		super();
		this.element = element;
		this.navigator = navigator;
		this.content = content;
		this.onIntent = onIntent;
		this.document = element.ownerDocument;
		this.cells = new Map();
		this.chains = new Map();
		this.rows = new Map();
		this.rendering = false;
		this.pendingFocus = null;
		this.reducedMotion = this.document.defaultView.matchMedia("(prefers-reduced-motion: reduce)");
		this.onFocusIn = (event) => this.followFocus(event.target);
		this.buildChrome();
		this.element.addEventListener("focusin", this.onFocusIn);
		this.observer = new this.document.defaultView.ResizeObserver(() => this.measure());
		this.observer.observe(element);
		this.measure();
	}

	create(tag, className) {
		const node = this.document.createElement(tag);
		node.className = className;
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
		this.element.replaceChildren(this.navbar, this.body);
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

	requestBack() {
		return this.intent({ type: "back" });
	}

	intent(action) {
		if (this.onIntent) return this.onIntent(action, this);
		return this.apply(action, { focus: true });
	}

	run(action) {
		return action.type === "back"
			? this.navigator.back()
			: this.navigator.open(action.destination, { from: action.from });
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
		this.dispatchEvent(new CustomEvent("change", { detail: { action: { type: "replay" }, result: { ok: results.every((result) => result.ok), results } } }));
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
		this.render({ animate: true });
		const chain = this.findChain(chainRootId);
		const visible = chain ? chain.cells.filter((cell) => cell.visible) : [];
		const target = delta > 0 ? visible[0] : visible[visible.length - 1];
		if (target) this.focusCell(target.occurrence);
	}

	focusCell(occurrenceId) {
		const target = this.visibleCellFor(occurrenceId);
		const entry = target ? this.cells.get(target) : null;
		if (!entry) return;
		const moved = target !== this.navigator.focused;
		this.navigator.focus(target, { resetReveal: false });
		entry.element.focus({ preventScroll: true });
		if (moved && !this.rendering) this.render({ animate: true });
	}

	visibleCellFor(occurrenceId) {
		let current = this.navigator.get(occurrenceId);
		while (current) {
			if (!this.inCollapsedRow(current.id)) {
				const cell = this.findCell(current.id);
				if (cell?.visible) return current.id;
				const chain = this.findChain(chainRootOf(this.navigator, current).id);
				const visible = chain ? chain.cells.filter((candidate) => candidate.visible) : [];
				if (visible.length > 0) return visible[0].occurrence;
			}
			current = current.parent ? this.navigator.get(current.parent) : null;
		}
		return null;
	}

	inCollapsedRow(occurrenceId) {
		let current = this.navigator.get(occurrenceId);
		while (current && current.parent) {
			const parent = this.navigator.get(current.parent);
			if (isSplit(this.navigator.destination(parent.destination)) && this.findRow(current.id)?.collapsed) return true;
			current = parent;
		}
		return false;
	}

	*walk(chain = this.layout.chain) {
		yield { kind: "chain", chain };
		for (const cell of chain.cells) {
			yield { kind: "cell", cell };
			for (const row of cell.rows?.rows ?? []) {
				yield { kind: "row", row };
				if (row.chain) yield* this.walk(row.chain);
			}
		}
	}

	findChain(chainRootId) {
		for (const node of this.walk()) if (node.kind === "chain" && node.chain.root === chainRootId) return node.chain;
		return null;
	}

	findCell(occurrenceId) {
		for (const node of this.walk()) if (node.kind === "cell" && node.cell.occurrence === occurrenceId) return node.cell;
		return null;
	}

	findRow(rowRootId) {
		for (const node of this.walk()) if (node.kind === "row" && node.row.occurrence === rowRootId) return node.row;
		return null;
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
		} finally {
			this.rendering = false;
		}
		const target = this.pendingFocus;
		this.pendingFocus = null;
		if (target) this.focusCell(target);
		this.dispatchEvent(new CustomEvent("render", { detail: { layout } }));
	}

	renderNavbar() {
		const next = this.navigator.nextBack();
		this.backButton.disabled = !next;
		this.backTarget.hidden = !next;
		this.backTarget.textContent = next ? next.title : "";
		this.backButton.setAttribute("aria-label", next ? `Back closes ${next.title}` : "Back: nothing to close");
		const info = this.navigator.focusInfo();
		this.titleText.textContent = info.title;
		this.titleContext.textContent = info.context.join(" › ");
		this.titleContext.hidden = info.context.length === 0;
	}

	renderChain(chain, host, animating) {
		let entry = this.chains.get(chain.root);
		if (!entry) {
			const viewport = this.create("div", "supermax-chain");
			host.append(viewport);
			const strip = new CellStrip(viewport);
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
		this.protectFocus(entries.filter((cell) => !cell.visible).map((cell) => cell.element));
		entry.strip.update(entries, { animate: animating });
		for (const cell of chain.cells) {
			if (cell.rows) this.renderRows(cell, animating);
		}
		const visible = chain.cells.filter((cell) => cell.visible);
		this.placeReveal(entry.left, chain.hiddenLeft, visible[0], "prepend");
		this.placeReveal(entry.right, chain.hiddenRight, visible[visible.length - 1], "append");
		return entry.viewport;
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

	placeReveal(button, title, cell, position) {
		button.hidden = !title;
		if (!title) return;
		button.textContent = title;
		button.setAttribute("aria-label", `Show ${title}`);
		const header = cell ? this.cells.get(cell.occurrence)?.header : null;
		const host = header ?? this.navbarLeft;
		if (button.parentElement !== host) host[header ? position : "append"](button);
	}

	mountCell(occurrenceId) {
		let entry = this.cells.get(occurrenceId);
		if (entry) return entry.element;
		const occurrence = this.navigator.get(occurrenceId);
		const definition = this.navigator.destination(occurrence.destination);
		const element = this.create("section", "supermax-cell");
		element.dataset.occurrence = occurrenceId;
		element.tabIndex = -1;
		element.setAttribute("aria-label", occurrence.title);
		const body = this.create("div", "supermax-cell-body");
		let header = null;
		let handle = {};
		if (isSplit(definition)) {
			element.classList.add("is-split");
			body.append(this.create("div", "supermax-rows"));
		} else {
			header = this.create("header", "supermax-cell-title");
			header.textContent = occurrence.title;
			element.append(header);
			handle = this.content(occurrence, definition, this) ?? {};
			if (handle.element) body.append(handle.element);
		}
		element.append(body);
		entry = { element, body, header, handle, parent: occurrence.parent };
		this.cells.set(occurrenceId, entry);
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
			{ duration: 200, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
		);
	}

	pruneClosed() {
		for (const [occurrenceId, entry] of this.cells) {
			if (this.navigator.get(occurrenceId)) continue;
			this.protectFocus([entry.element], entry.parent);
			this.cells.delete(occurrenceId);
			this.afterExit(entry.element, () => entry.handle.dispose?.());
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
			entry.handle.update?.(this.navigator.get(occurrenceId), this);
		}
	}

	destroy() {
		this.observer.disconnect();
		this.element.removeEventListener("focusin", this.onFocusIn);
		for (const entry of this.cells.values()) entry.handle.dispose?.();
		for (const entry of this.chains.values()) entry.strip.destroy();
		this.cells.clear();
		this.chains.clear();
		this.rows.clear();
		this.element.replaceChildren();
		this.element.classList.remove("supermax-workspace");
		this.element.style.removeProperty("--supermax-navbar");
		this.element.style.removeProperty("--supermax-row-tab");
	}
}
