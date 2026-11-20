import { mountPart } from "./renderer.js";
export class ContentSlot {
	constructor(workspace, { element, body, header = null, id = null, onSettled = null }) {
		this.workspace = workspace;
		this.element = element;
		this.body = body;
		this.header = header;
		this.id = id;
		this.onSettled = onSettled;
		this.handle = {};
		this.generation = 0;
		this.retry = null;
	}

	cancel() {
		this.generation += 1;
	}

	dispose() {
		this.cancel();
		this.statusPart?.dispose();
		this.statusPart = null;
		this.handle.header?.remove();
		this.handle.dispose?.();
		this.handle = {};
	}

	leave() {
		this.handle.leave?.();
	}

	mount(title, produce, isCurrent) {
		this.dispose();
		const generation = this.generation;
		let outcome;
		try {
			outcome = produce() ?? {};
		} catch (error) {
			this.error(title, error);
			return;
		}
		const pending = typeof outcome?.then === "function" ? outcome : null;
		if (!pending) {
			this.settle(outcome);
			return;
		}
		this.loading(title);
		pending.then(
			(handle) => {
				if (this.generation === generation && isCurrent()) this.settle(handle ?? {});
				else handle?.dispose?.();
			},
			(error) => { if (this.generation === generation && isCurrent()) this.error(title, error); },
		);
	}

	settle(handle) {
		this.statusPart?.dispose();
		this.statusPart = null;
		this.handle = handle;
		if (handle.element) handle.element.setAttribute("data-supermax-content", "");
		this.element.classList.remove("is-loading", "is-error");
		if (this.body) this.body.replaceChildren(...(handle.element ? [handle.element] : []));
		else if (handle.element) this.workspace.warn("content() for a split", `returned an element for the split ${this.id}, whose body holds its rows. A split's content gives only { header } for its title bar.`);
		if (handle.header) {
			if (this.header) this.header.append(handle.header);
			else this.body.prepend(handle.header);
		}
		handle.update?.(this.id ? this.workspace.navigator.get(this.id) : null, this.workspace);
		this.onSettled?.();
		this.workspace.dispatchEvent(new CustomEvent("content", { detail: { occurrence: this.id, state: "loaded" } }));
	}

	loading(title) {
		if (!this.body) {
			this.workspace.dispatchEvent(new CustomEvent("content", { detail: { occurrence: this.id, state: "loading" } }));
			return;
		}
		this.element.classList.add("is-loading");
		this.element.classList.remove("is-error");
		const box = this.workspace.create("div", "supermax-loading");
		box.setAttribute("role", "status");
		box.setAttribute("aria-live", "polite");
		box.setAttribute("aria-label", this.workspace.strings.loading(title));
		this.body.replaceChildren(box);
		this.statusPart?.dispose();
		this.statusPart = mountPart(this.workspace, "loading", box, { title, label: this.workspace.strings.loading(title) });
		this.workspace.dispatchEvent(new CustomEvent("content", { detail: { occurrence: this.id, state: "loading" } }));
	}

	error(title, error) {
		if (!this.body) {
			this.workspace.warn("content() for a split failed", `on ${this.id}, so its title bar shows no controls (${error?.message ?? String(error)}).`);
			this.workspace.dispatchEvent(new CustomEvent("content", { detail: { occurrence: this.id, state: "error", error } }));
			return;
		}
		this.element.classList.add("is-error");
		this.element.classList.remove("is-loading");
		const box = this.workspace.create("div", "supermax-error");
		box.setAttribute("role", "alert");
		this.body.replaceChildren(box);
		this.statusPart?.dispose();
		this.statusPart = mountPart(this.workspace, "error", box, { title: this.workspace.strings.loadFailed(title), detail: error?.message ?? String(error), actions: { retry: { label: this.workspace.strings.retry() } } }, { actions: { retry: { run: () => this.retry?.() } } });
		this.workspace.dispatchEvent(new CustomEvent("content", { detail: { occurrence: this.id, state: "error", error } }));
	}
}
