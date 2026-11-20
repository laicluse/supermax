export const STRIP_TIMING = Object.freeze({ duration: 200, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" });

export class CellStrip {
	constructor(viewport, { duration = STRIP_TIMING.duration, easing = STRIP_TIMING.easing, motion = null } = {}) {
		this.viewport = viewport;
		this.duration = duration;
		this.easing = easing;
		this.motion = motion;
		this.strip = viewport.ownerDocument.createElement("div");
		this.strip.className = "supermax-strip";
		this.strip.style.cssText = "display:flex;flex-shrink:0;height:100%;will-change:transform;transform:translateX(0px)";
		this.previousOverflow = viewport.style.overflow;
		viewport.style.overflow = "hidden";
		viewport.append(this.strip);
		this.entries = [];
		this.animations = [];
		this.motions = new Map();
		this.finished = Promise.resolve();
		this.initialized = false;
		this.reducedMotion = viewport.ownerDocument.defaultView.matchMedia("(prefers-reduced-motion: reduce)");
		this.onMotionPreference = () => {
			if (this.reducedMotion.matches) this.animations.forEach((animation) => animation.finish());
		};
		this.reducedMotion.addEventListener("change", this.onMotionPreference);
	}

	update(entries, { animate = true } = {}) {
		const ids = new Set();
		for (const entry of entries) {
			if (ids.has(entry.id)) throw new Error(`Duplicate cell id: ${entry.id}`);
			if (!Number.isFinite(entry.width) || entry.width <= 0) throw new Error(`Invalid cell width: ${entry.id}`);
			ids.add(entry.id);
		}
		const view = this.viewport.ownerDocument.defaultView;
		const startingTransform = view.getComputedStyle(this.strip).transform;
		const previous = new Map(this.entries.map((entry) => [entry.id, {
			...entry,
			currentWidth: entry.element.getBoundingClientRect().width,
			currentLeft: entry.element.getBoundingClientRect().left,
		}]));
		const resumed = this.motionsInFlight();
		this.cancelAnimations();
		const departing = this.entries.filter((entry) => !ids.has(entry.id));
		this.entries = entries.map((entry) => ({ ...entry, departing: false }));
		this.entries.push(...departing.map((entry) => ({ ...entry, visible: false, departing: true, instant: false })));
		this.pairs = this.motion ? this.pairReplacements(previous, resumed) : new Map();
		const firstVisible = this.entries.findIndex((entry) => entry.visible);
		const lastVisible = this.entries.findLastIndex((entry) => entry.visible);
		let offset = 0;
		let totalWidth = 0;
		this.entries.forEach((entry, index) => {
			entry.displayWidth = !entry.visible && index > firstVisible && index < lastVisible ? 0 : entry.width;
			if (entry.departing && this.pairs.has(entry.id)) entry.displayWidth = 0;
		});
		for (const [index, entry] of this.entries.entries()) {
			if (firstVisible === -1 || index < firstVisible) offset += entry.displayWidth;
			totalWidth += entry.displayWidth;
			const old = previous.get(entry.id);
			if (old && old.element !== entry.element) old.element.replaceWith(entry.element);
			entry.element.style.flex = "0 0 auto";
			entry.element.style.boxSizing = "border-box";
			entry.element.style.minWidth = "0";
			entry.element.style.maxWidth = "none";
			entry.element.style.height = "100%";
			entry.element.style.visibility = "";
			entry.element.inert = !entry.visible;
			entry.element.toggleAttribute("data-supermax-exiting", entry.departing);
			entry.element.toggleAttribute("data-supermax-folded", entry.displayWidth === 0);
			entry.element.style.width = `${entry.displayWidth}px`;
			if (!this.strip.contains(entry.element)) this.strip.append(entry.element);
		}
		const siblings = new Map();
		for (const entry of this.entries) {
			const parent = entry.element.parentElement;
			if (!siblings.has(parent)) siblings.set(parent, []);
			siblings.get(parent).push(entry.element);
		}
		for (const [parent, elements] of siblings) {
			const currentOrder = [...parent.children].filter((element) => elements.includes(element));
			if (elements.every((element, index) => element === currentOrder[index])) continue;
			for (let index = elements.length - 2; index >= 0; index -= 1) {
				parent.insertBefore(elements[index], elements[index + 1]);
			}
		}
		const targetTransform = `translateX(${-offset}px)`;
		this.strip.style.width = `${totalWidth}px`;
		this.strip.style.transform = targetTransform;
		this.overlayReplaced(previous);
		const shouldAnimate = animate && this.initialized && !this.reducedMotion.matches && this.duration > 0;
		this.initialized = true;
		if (shouldAnimate) {
			this.animateStrip(view, startingTransform, targetTransform);
			this.animateWidths(previous);
			this.animateMovement(previous);
			this.animateMotion(previous, resumed);
		} else if (resumed.size > 0 && !this.reducedMotion.matches) {
			this.animateMotion(previous, resumed, { carriedOnly: true });
		}
		if (this.animations.length === 0) {
			this.settle();
			this.finished = Promise.resolve();
			return this.finished;
		}
		const currentAnimations = this.animations;
		this.finished = new Promise((resolve) => { this.resolveFinished = resolve; });
		Promise.all(currentAnimations.map((animation) => animation.finished)).then(() => {
			if (this.animations !== currentAnimations) return;
			this.settle();
			this.cancelAnimations();
		}, () => {});
		return this.finished;
	}

	timing() {
		return { duration: this.duration, easing: this.easing, fill: "both" };
	}

	animateStrip(view, startingTransform, targetTransform) {
		const targetMatrix = view.getComputedStyle(this.strip).transform;
		if (startingTransform === targetMatrix) return;
		this.animations.push(this.strip.animate([{ transform: startingTransform }, { transform: targetTransform }], this.timing()));
	}

	pairReplacements(previous, resumed) {
		const before = [...previous.values()].filter((entry) => !entry.departing);
		const pairs = new Map();
		for (const [id, motion] of resumed) {
			const entry = this.entries.find((candidate) => candidate.id === id);
			const partner = this.entries.find((candidate) => candidate.id === motion.partner);
			if (entry && partner && entry.departing !== partner.departing) pairs.set(id, partner);
		}
		this.entries.forEach((entry, index) => {
			const old = before[index];
			if (entry.departing || entry.instant || !entry.visible || previous.has(entry.id) || !old?.visible || this.entries.some((next) => next.id === old.id && !next.departing)) return;
			pairs.set(old.id, entry);
			pairs.set(entry.id, old);
		});
		return pairs;
	}

	overlayReplaced(previous) {
		const stripLeft = this.strip.getBoundingClientRect().left;
		for (const entry of this.entries) {
			if (!entry.departing || !this.pairs.has(entry.id)) continue;
			const successor = this.pairs.get(entry.id);
			Object.assign(entry.element.style, {
				position: "absolute",
				top: "0",
				left: `${successor.element.getBoundingClientRect().left - stripLeft}px`,
				width: `${previous.get(entry.id).currentWidth}px`,
			});
		}
	}

	animateWidths(previous) {
		for (const entry of this.entries) {
			if (entry.instant || (entry.departing && this.pairs.has(entry.id))) continue;
			const old = previous.get(entry.id) ?? this.pairs.get(entry.id);
			if (old && Math.abs(old.currentWidth - entry.displayWidth) > 0.01) {
				this.animations.push(entry.element.animate([{ width: `${old.currentWidth}px` }, { width: `${entry.displayWidth}px` }], this.timing()));
			}
		}
	}

	animateMovement(previous) {
		for (const entry of this.entries) {
			if (entry.instant || (entry.departing && this.pairs.has(entry.id))) continue;
			const old = previous.get(entry.id) ?? this.pairs.get(entry.id);
			const currentLeft = entry.element.getBoundingClientRect().left;
			const startingLeft = old ? old.currentLeft : Math.max(currentLeft, this.viewport.getBoundingClientRect().right);
			const distance = startingLeft - currentLeft;
			if (Math.abs(distance) > 0.01) {
				this.animations.push(entry.element.animate([{ transform: `translateX(${distance}px)` }, { transform: "translateX(0px)" }], this.timing()));
			}
		}
	}

	// An update during an entrance or exit carries that motion on from where it was, so a cell never lands half folded.
	animateMotion(previous, resumed, { carriedOnly = false } = {}) {
		if (!this.motion) return;
		const timing = { duration: this.duration, easing: this.easing };
		for (const entry of this.entries) {
			const kind = entry.departing ? "leave" : "enter";
			const carried = resumed.get(entry.id)?.kind === kind ? resumed.get(entry.id) : null;
			const fresh = entry.departing ? !previous.get(entry.id)?.departing : !previous.has(entry.id) && entry.visible && !entry.instant;
			if (!carried && (!fresh || carriedOnly)) continue;
			const partner = this.pairs.get(entry.id) ?? null;
			const produced = [].concat(this.motion[kind](entry.element, timing, entry.departing ? { replacedBy: partner?.element ?? null } : { replacing: partner?.element ?? null }) ?? []);
			for (const animation of produced) {
				if (carried) animation.currentTime = carried.elapsed;
				this.animations.push(animation);
			}
			this.motions.set(entry.id, { kind, partner: partner?.id ?? null, animations: produced });
		}
	}

	motionsInFlight() {
		const resumed = new Map();
		for (const [id, motion] of this.motions) {
			const [lead] = motion.animations;
			if (lead && lead.playState === "running") resumed.set(id, { kind: motion.kind, partner: motion.partner, elapsed: lead.currentTime });
		}
		this.motions = new Map();
		return resumed;
	}

	settle() {
		for (const entry of this.entries) {
			for (const property of ["transform-origin", "position", "top", "left"]) entry.element.style.removeProperty(property);
			if (entry.departing) entry.element.remove();
			else entry.element.style.visibility = entry.visible ? "" : "hidden";
		}
		this.entries = this.entries.filter((entry) => !entry.departing);
		this.strip.style.width = `${this.entries.reduce((width, entry) => width + entry.displayWidth, 0)}px`;
	}

	cancelAnimations() {
		const animations = this.animations;
		this.animations = [];
		animations.forEach((animation) => animation.cancel());
		this.resolveFinished?.();
		this.resolveFinished = null;
	}

	destroy() {
		this.cancelAnimations();
		this.reducedMotion.removeEventListener("change", this.onMotionPreference);
		this.strip.remove();
		this.viewport.style.overflow = this.previousOverflow;
		this.entries = [];
	}
}
