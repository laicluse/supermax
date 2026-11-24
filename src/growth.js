// allow-comment: a cell whose destination declares growOnFocus grows toward its preference while DOM focus is inside it and the host switched growth on; the cells around it give way for that and return when focus leaves. A fold that only growth made opens by ending the growth, so nothing closes for it. Focus changes settle once per frame, and a change made by a pointer waits until its click has run, so a target never moves away under the pointer that is pressing it. A zoom suspends growth without forgetting it.
export class FocusGrowth {
	constructor(workspace, enabled) {
		this.workspace = workspace;
		this.enabled = !!enabled;
		this.grown = null;
		this.frame = null;
		this.release = null;
		this.pressed = false;
		this.yielded = null;
		const { element, document } = workspace;
		this.onFocus = () => this.schedule();
		this.onPress = () => { this.pressed = true; };
		this.onRelease = () => {
			if (!this.pressed) return;
			this.pressed = false;
			document.defaultView.clearTimeout(this.release);
			this.release = document.defaultView.setTimeout(() => {
				this.release = null;
				this.schedule();
			}, 0);
		};
		element.addEventListener("focusin", this.onFocus);
		element.addEventListener("focusout", this.onFocus);
		workspace.addEventListener("zoom", this.onFocus);
		document.addEventListener("pointerdown", this.onPress, true);
		document.addEventListener("pointerup", this.onRelease, true);
		document.addEventListener("pointercancel", this.onRelease, true);
	}

	set(enabled) {
		this.enabled = !!enabled;
		this.settle();
	}

	// allow-comment: the occurrence growth applies to in this render; one that closed drops out at once, and a zoom holds growth back until it ends.
	current() {
		const { navigator } = this.workspace;
		if (this.grown && !navigator.get(this.grown)) this.grown = null;
		return navigator.zoomed ? null : this.grown;
	}

	focused() {
		const { workspace } = this;
		if (!this.enabled) return null;
		const active = workspace.element.getRootNode().activeElement;
		if (active !== this.yielded) this.yielded = null;
		if (!active || this.yielded || !workspace.element.contains(active)) return null;
		// allow-comment: focus on a fold handle keeps the growth that made the fold, so the handle stays under the key that opens it.
		if (this.grown && active.closest(".supermax-fold-cue")) return this.grown;
		const id = active.closest(".supermax-cell[data-occurrence]")?.dataset.occurrence;
		const occurrence = id && workspace.cells.has(id) ? workspace.navigator.get(id) : null;
		return occurrence && workspace.navigator.definitionOf(occurrence.destination).growOnFocus ? id : null;
	}

	// allow-comment: whether this fold exists only because another cell grew: the ordinary layout shows the surface unfolded.
	gaveWay(occurrenceId, axis) {
		if (!this.current()) return false;
		const plain = this.workspace.navigator.layout();
		const state = axis === "vertical" ? plain.rows.get(occurrenceId) : plain.cells.get(occurrenceId);
		return !!state && state.visible && !state.folded;
	}

	// allow-comment: growth steps back while focus stays where it is, and may start again once focus has moved.
	yield() {
		this.yielded = this.workspace.element.getRootNode().activeElement;
		this.settle();
	}

	schedule() {
		if (this.frame !== null) return;
		this.frame = this.workspace.document.defaultView.requestAnimationFrame(() => {
			this.frame = null;
			if (this.pressed || this.workspace.folds.drag) return;
			this.settle();
		});
	}

	settle() {
		const before = this.current();
		this.grown = this.focused();
		if (this.current() !== before && this.workspace.rendered) this.workspace.render({ animate: true });
	}

	destroy() {
		const { element, document } = this.workspace;
		if (this.frame !== null) document.defaultView.cancelAnimationFrame(this.frame);
		document.defaultView.clearTimeout(this.release);
		this.frame = null;
		this.release = null;
		element.removeEventListener("focusin", this.onFocus);
		element.removeEventListener("focusout", this.onFocus);
		this.workspace.removeEventListener("zoom", this.onFocus);
		document.removeEventListener("pointerdown", this.onPress, true);
		document.removeEventListener("pointerup", this.onRelease, true);
		document.removeEventListener("pointercancel", this.onRelease, true);
	}
}
