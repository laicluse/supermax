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
			this.update(divider, item.size, item.min, item.max, item.sized);
		}
		for (const [key, divider] of this.dividers) {
			if (divider.host === host && !wanted.has(key)) {
				divider.element.remove();
				this.dividers.delete(key);
			}
		}
	}

	dispose(host) {
		for (const [key, divider] of this.dividers) {
			if (divider.host === host) { divider.element.remove(); this.dividers.delete(key); }
		}
	}

	clear() {
		for (const divider of this.dividers.values()) divider.element.remove();
		this.dividers.clear();
	}

	divider(key, host, orientation, occurrenceId, title) {
		const workspace = this.workspace;
		let divider = this.dividers.get(key);
		if (divider && divider.host === host && divider.element.isConnected) return divider;
		if (divider) {
			divider.element.remove();
			this.dividers.delete(key);
		}
		const element = workspace.create("div", `supermax-divider is-${orientation}`);
		element.dataset.divides = occurrenceId;
		const handle = workspace.create("div", "supermax-divider-handle");
		handle.setAttribute("aria-hidden", "true");
		const reset = workspace.create("button", "supermax-divider-reset");
		reset.type = "button";
		reset.setAttribute("aria-label", this.workspace.strings.resetSize(title));
		reset.textContent = "⟲";
		reset.hidden = true;
		const axis = orientation === "vertical" ? "width" : "height";
		reset.addEventListener("click", () => workspace.setSize(occurrenceId, null, axis));
		element.append(handle, reset);
		host.append(element);
		divider = { element, handle, reset, host, occurrenceId, orientation, axis, size: 0, min: 0, max: 0 };
		handle.addEventListener("pointerdown", (event) => this.startDrag(divider, event));
		this.dividers.set(key, divider);
		return divider;
	}

	update(divider, size, min, max, sized) {
		Object.assign(divider, { size, min, max });
		divider.element.classList.toggle("is-sized", sized);
		divider.reset.hidden = !sized;
	}

	resize(divider, size) {
		this.workspace.setSize(divider.occurrenceId, Math.min(divider.max, Math.max(divider.min, Math.round(size))), divider.axis);
	}

	startDrag(divider, event) {
		if (event.button !== 0) return;
		event.preventDefault();
		divider.handle.setPointerCapture(event.pointerId);
		divider.element.classList.add("is-dragging");
		const vertical = divider.orientation === "vertical";
		const drag = { pointerId: event.pointerId, origin: vertical ? event.clientX : event.clientY, start: divider.size };
		const controller = new AbortController();
		const move = (moveEvent) => {
			if (moveEvent.pointerId !== drag.pointerId) return;
			this.resize(divider, drag.start + (vertical ? moveEvent.clientX : moveEvent.clientY) - drag.origin);
		};
		const stop = (upEvent) => {
			if (upEvent.pointerId !== drag.pointerId) return;
			divider.element.classList.remove("is-dragging");
			controller.abort();
		};
		divider.handle.addEventListener("pointermove", move, { signal: controller.signal });
		divider.handle.addEventListener("pointerup", stop, { signal: controller.signal });
		divider.handle.addEventListener("pointercancel", stop, { signal: controller.signal });
	}
}
