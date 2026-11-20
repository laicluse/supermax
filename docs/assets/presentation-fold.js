import { CellStrip } from "./supermax/index.js";

class FoldStrip extends CellStrip {
	constructor(viewport) {
		super(viewport);
		this.folds = [];
	}

	update(entries, options = {}) {
		const before = new Set(this.entries.filter((entry) => !entry.departing).map((entry) => entry.id));
		this.folds.forEach((animation) => animation.cancel());
		this.folds = [];
		const finished = super.update(entries, options);
		const animate = options.animate !== false && this.animations.length > 0;
		if (!animate) return finished;
		for (const entry of this.entries) {
			if (entry.departing) {
				this.fold(entry.element, [{ transform: "perspective(1400px) rotateY(0deg)", opacity: 1 }, { transform: "perspective(1400px) rotateY(55deg)", opacity: 0.1 }], "left");
			} else if (!before.has(entry.id) && entry.visible) {
				this.fold(entry.element, [{ transform: "perspective(1400px) rotateY(-55deg)", opacity: 0.1 }, { transform: "perspective(1400px) rotateY(0deg)", opacity: 1 }], "left");
			}
		}
		return finished;
	}

	fold(element, keyframes, origin) {
		element.style.transformOrigin = `${origin} center`;
		const animation = element.animate(keyframes, { duration: this.duration, easing: this.easing, composite: "add" });
		animation.finished.then(() => { element.style.removeProperty("transform-origin"); }, () => {});
		this.folds.push(animation);
	}

	cancelAnimations() {
		super.cancelAnimations();
		this.folds?.forEach((animation) => animation.cancel());
		this.folds = [];
	}
}

export const foldPresentation = {
	name: "fold",
	createStrip: (viewport) => new FoldStrip(viewport),
};
