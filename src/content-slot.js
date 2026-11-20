export class ContentSlot {
	constructor(workspace, { element, body, id = null, onSettled = null }) {
		this.workspace = workspace;
		this.element = element;
		this.body = body;
		this.id = id;
		this.onSettled = onSettled;
		this.handle = {};
		this.generation = 0;
		this.retry = null;
	}

	dispose() {
		this.generation += 1;
		this.handle.dispose?.();
		this.handle = {};
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
		this.handle = handle;
		this.element.classList.remove("is-loading", "is-error");
		this.body.replaceChildren(...(handle.element ? [handle.element] : []));
		handle.update?.(this.id ? this.workspace.navigator.get(this.id) : null, this.workspace);
		this.onSettled?.();
		this.workspace.dispatchEvent(new CustomEvent("content", { detail: { occurrence: this.id, state: "loaded" } }));
	}

	loading(title) {
		this.element.classList.add("is-loading");
		this.element.classList.remove("is-error");
		const box = this.workspace.create("div", "supermax-loading");
		box.setAttribute("role", "status");
		box.setAttribute("aria-live", "polite");
		box.append(this.workspace.create("span", "supermax-loading-mark"), this.workspace.document.createTextNode(this.workspace.strings.loading(title)));
		this.body.replaceChildren(box);
		this.workspace.dispatchEvent(new CustomEvent("content", { detail: { occurrence: this.id, state: "loading" } }));
	}

	error(title, error) {
		this.element.classList.add("is-error");
		this.element.classList.remove("is-loading");
		const box = this.workspace.create("div", "supermax-error");
		box.setAttribute("role", "alert");
		box.append(this.workspace.create("strong", null, this.workspace.strings.loadFailed(title)));
		const detail = this.workspace.create("p", "supermax-error-detail");
		detail.textContent = error?.message ?? String(error);
		const retry = this.workspace.create("button", "supermax-retry");
		retry.type = "button";
		retry.textContent = this.workspace.strings.retry();
		retry.addEventListener("click", () => this.retry?.());
		box.append(detail, retry);
		this.body.replaceChildren(box);
		this.workspace.dispatchEvent(new CustomEvent("content", { detail: { occurrence: this.id, state: "error", error } }));
	}
}
