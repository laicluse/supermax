import { APPEAR, DISAPPEAR } from "./motion.js";

export const STRIP_TIMING = Object.freeze({ duration: 200, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" });

const depthOf = (id) => String(id).split("/").length;

function absolute(element, transform, origin) {
	const [x, y] = origin.split(" ").map(parseFloat);
	const matrix = transform && transform !== "none" ? new DOMMatrix(transform) : new DOMMatrix();
	return new DOMMatrix().translate(x, y).multiply(matrix).translate(-x, -y);
}

function currentPose(element) {
	const style = getComputedStyle(element);
	return { matrix: absolute(element, style.transform, style.transformOrigin), shade: parseFloat(style.getPropertyValue("--supermax-shade")) || 0 };
}

function poseMatrix(element, pose) {
	const previous = element.style.transformOrigin;
	element.style.transformOrigin = pose.origin;
	const origin = getComputedStyle(element).transformOrigin;
	element.style.transformOrigin = previous;
	return absolute(element, pose.transform, origin);
}

export class CellStrip {
	constructor(viewport, { duration = STRIP_TIMING.duration, easing = STRIP_TIMING.easing, motion = null } = {}) {
		this.viewport = viewport;
		this.duration = duration;
		this.easing = easing;
		this.motion = motion;
		this.strip = viewport.ownerDocument.createElement("div");
		this.strip.className = "supermax-strip";
		this.strip.style.cssText = "position:relative;display:flex;flex-shrink:0;height:100%;will-change:transform;transform:translateX(0px)";
		this.previousOverflow = viewport.style.overflow;
		viewport.style.overflow = "hidden";
		viewport.append(this.strip);
		this.entries = [];
		this.geometry = [];
		this.motions = new Map();
		this.rooms = new WeakMap();
		this.finished = Promise.resolve();
		this.initialized = false;
		this.reducedMotion = viewport.ownerDocument.defaultView.matchMedia("(prefers-reduced-motion: reduce)");
		this.onMotionPreference = () => {
			if (this.reducedMotion.matches) this.sync(this.entries.filter((entry) => !entry.departing));
		};
		this.reducedMotion.addEventListener("change", this.onMotionPreference);
	}

	update(entries, { animate = true, arrive = false } = {}) {
		const ids = new Set();
		for (const entry of entries) {
			if (ids.has(entry.id)) throw new Error(`Duplicate cell id: ${entry.id}`);
			if (!Number.isFinite(entry.width) || entry.width <= 0) throw new Error(`Invalid cell width: ${entry.id}`);
			ids.add(entry.id);
		}
		const firstPaint = !this.initialized;
		this.initialized = true;
		if (!animate || this.reducedMotion.matches || this.duration <= 0 || (firstPaint && !arrive)) return this.sync(entries);

		const view = this.viewport.ownerDocument.defaultView;
		const startingTransform = view.getComputedStyle(this.strip).transform;
		const previous = new Map(this.entries.map((entry) => {
			const box = this.boxOf(entry);
			return [entry.id, {
				...entry,
				box,
				currentWidth: parseFloat(view.getComputedStyle(box).width) || 0,
				currentMargin: parseFloat(view.getComputedStyle(box).marginRight) || 0,
				currentLeft: box.offsetLeft,
				currentRect: box.getBoundingClientRect().left,
			}];
		}));

		const next = entries.map((entry) => ({ ...entry, departing: false, overlay: false }));
		const leaving = this.entries.filter((entry) => !ids.has(entry.id)).map((entry) => ({ ...entry, visible: false }));
		const newlyLeaving = leaving.filter((entry) => !entry.departing);
		const returning = next.filter((entry) => previous.get(entry.id)?.departing);
		const arriving = next.filter((entry) => entry.visible && !previous.has(entry.id));

		const partners = new Map();
		for (const entry of arriving) {
			const partner = newlyLeaving.find((candidate) => depthOf(candidate.id) === depthOf(entry.id) && ![...partners.values()].includes(candidate));
			if (partner) partners.set(entry.id, partner);
		}
		const fromRest = [...partners.values()].some((partner) => !this.motions.has(partner.id));
		const wait = fromRest ? this.duration : 0;

		for (const entry of leaving) {
			const motion = this.motions.get(entry.id);
			const paired = [...partners.values()].includes(entry);
			if (!entry.departing) entry.overlay = paired || motion?.kind === "enter" || motion?.kind === "return";
			entry.departing = true;
		}

		this.cancelGeometry();
		this.entries = [...leaving.filter((entry) => entry.overlay), ...next, ...leaving.filter((entry) => !entry.overlay)];
		const firstVisible = next.findIndex((entry) => entry.visible);
		const lastVisible = next.findLastIndex((entry) => entry.visible);
		let offset = 0;
		let totalWidth = 0;
		next.forEach((entry, index) => {
			entry.displayWidth = !entry.visible && index > firstVisible && index < lastVisible ? 0 : entry.width;
			if (firstVisible === -1 || index < firstVisible) offset += entry.displayWidth;
			totalWidth += entry.displayWidth;
		});
		for (const entry of leaving) entry.displayWidth = 0;
		for (const entry of this.entries) entry.card = !!this.motion && !entry.overlay;
		this.place(previous);
		const targetTransform = `translateX(${-offset}px)`;
		this.strip.style.width = `${totalWidth}px`;
		this.strip.style.transform = targetTransform;

		if (this.motion) {
			for (const entry of newlyLeaving) {
				if (entry.still) continue;
				const motion = this.motions.get(entry.id);
				if (motion?.kind === "enter" || motion?.kind === "return") this.tearAway(entry);
				else this.foldAway(entry);
			}
			for (const entry of returning) if (!entry.still) this.foldBack(entry);
			for (const entry of arriving) if (!entry.still) this.foldOpen(entry, wait);
		}

		const timing = (delay) => ({ duration: this.duration, easing: this.easing, delay, fill: "both" });
		if (startingTransform !== view.getComputedStyle(this.strip).transform) {
			this.geometry.push(this.strip.animate([{ transform: startingTransform }, { transform: targetTransform }], timing(wait)));
		}
		for (const entry of this.entries) {
			if (entry.overlay) continue;
			const old = previous.get(entry.id);
			const room = (record) => record.currentWidth + record.currentMargin;
			const from = old && !old.overlay ? room(old) : partners.has(entry.id) ? room(previous.get(partners.get(entry.id).id)) : 0;
			const to = entry.displayWidth;
			if (Math.abs(from - to) <= 0.01) continue;
			const delay = timing(entry.departing ? 0 : wait);
			const box = this.boxOf(entry);
			if (entry.card) {
				const card = parseFloat(box.style.width) || 0;
				this.geometry.push(box.animate([{ marginRight: `${from - card}px` }, { marginRight: `${to - card}px` }], delay));
			} else {
				this.geometry.push(box.animate([{ width: `${from}px` }, { width: `${to}px` }], delay));
			}
		}
		if (!this.motion) this.slide(previous, timing(wait));
		return this.awaitSettled();
	}

	boxOf(entry) {
		if (!this.motion) return entry.element;
		let room = this.rooms.get(entry.element);
		if (!room) {
			room = this.viewport.ownerDocument.createElement("div");
			room.className = "supermax-room";
			this.rooms.set(entry.element, room);
		}
		if (entry.element.parentElement !== room) room.append(entry.element);
		return room;
	}

	place(previous) {
		for (const entry of this.entries) {
			const old = previous.get(entry.id);
			const box = this.boxOf(entry);
			if (old && old.box !== box) old.box.replaceWith(box);
			const style = box.style;
			style.flex = "0 0 auto";
			style.boxSizing = "border-box";
			style.minWidth = "0";
			style.maxWidth = "none";
			style.height = "100%";
			if (box !== entry.element) Object.assign(entry.element.style, { width: "100%", height: "100%", boxSizing: "border-box" });
			entry.element.style.visibility = "";
			if (entry.overlay) {
				Object.assign(style, { position: "absolute", top: "0", left: `${old?.overlay ? parseFloat(style.left) : old?.currentLeft ?? 0}px`, width: `${old?.overlay ? parseFloat(style.width) : old?.currentWidth ?? entry.width}px` });
			} else {
				for (const property of ["position", "top", "left"]) style.removeProperty(property);
				const kept = old?.overlay ? 0 : parseFloat(style.width) || old?.currentWidth || 0;
				const card = entry.card ? Math.max(kept, entry.displayWidth) : entry.displayWidth;
				style.width = `${card}px`;
				if (entry.card) style.marginRight = `${entry.displayWidth - card}px`;
				else style.removeProperty("margin-right");
			}
			entry.element.inert = !entry.visible;
			entry.element.toggleAttribute("data-supermax-exiting", entry.departing);
			entry.element.toggleAttribute("data-supermax-folded", !entry.departing && entry.displayWidth === 0);
			if (!this.strip.contains(box)) this.strip.append(box);
		}
		const siblings = new Map();
		for (const entry of this.entries) {
			const box = this.boxOf(entry);
			const parent = box.parentElement;
			if (!siblings.has(parent)) siblings.set(parent, []);
			siblings.get(parent).push(box);
		}
		for (const [parent, boxes] of siblings) {
			const currentOrder = [...parent.children].filter((box) => boxes.includes(box));
			if (boxes.every((box, index) => box === currentOrder[index])) continue;
			for (let index = boxes.length - 2; index >= 0; index -= 1) parent.insertBefore(boxes[index], boxes[index + 1]);
		}
	}

	slide(previous, timing) {
		const viewportRight = this.viewport.getBoundingClientRect().right;
		for (const entry of this.entries) {
			const old = previous.get(entry.id);
			const currentLeft = entry.element.getBoundingClientRect().left;
			const startingLeft = old ? old.currentRect : Math.max(currentLeft, viewportRight);
			const distance = startingLeft - currentLeft;
			if (Math.abs(distance) > 0.01) this.geometry.push(entry.element.animate([{ transform: `translateX(${distance}px)` }, { transform: "translateX(0px)" }], timing));
		}
	}

	axisOf(entry) {
		return { axis: entry.axis ?? "chain" };
	}

	foldOpen(entry, delay) {
		const pose = this.motion.open(entry.element, this.axisOf(entry));
		entry.element.style.transformOrigin = pose.origin;
		const animation = entry.element.animate([{ transform: pose.transform, "--supermax-shade": pose.shade ?? 1 }, { transform: "none", "--supermax-shade": 0 }], { duration: this.duration, delay, easing: APPEAR.easing, fill: "both" });
		this.track(entry, "enter", animation);
	}

	foldAway(entry) {
		const pose = this.motion.close(entry.element, this.axisOf(entry));
		entry.element.style.transformOrigin = pose.origin;
		const animation = entry.element.animate([{ transform: "none", "--supermax-shade": 0 }, { transform: pose.transform, "--supermax-shade": pose.shade ?? 1 }], { duration: this.duration, easing: DISAPPEAR.easing, fill: "forwards" });
		this.track(entry, "leave", animation);
	}

	tearAway(entry) {
		const from = currentPose(entry.element);
		const pose = this.motion.close(entry.element, this.axisOf(entry));
		const to = poseMatrix(entry.element, pose);
		this.motions.get(entry.id)?.animation.cancel();
		entry.element.style.transformOrigin = "0 0";
		const animation = entry.element.animate([{ transform: from.matrix.toString(), "--supermax-shade": from.shade }, { transform: to.toString(), "--supermax-shade": pose.shade ?? 1 }], { duration: this.duration, easing: DISAPPEAR.easing, fill: "forwards" });
		this.track(entry, "tear", animation);
	}

	foldBack(entry) {
		const from = currentPose(entry.element);
		this.motions.get(entry.id)?.animation.cancel();
		entry.element.style.transformOrigin = "0 0";
		const animation = entry.element.animate([{ transform: from.matrix.toString(), "--supermax-shade": from.shade }, { transform: new DOMMatrix().toString(), "--supermax-shade": 0 }], { duration: this.duration, easing: APPEAR.easing, fill: "both" });
		this.track(entry, "return", animation);
	}

	track(entry, kind, animation) {
		const motion = { kind, animation };
		this.motions.set(entry.id, motion);
		animation.finished.then(() => {
			if (this.motions.get(entry.id) !== motion) return;
			this.motions.delete(entry.id);
			const current = this.entries.find((candidate) => candidate.id === entry.id);
			if (current?.departing) this.drop(current);
			else {
				animation.cancel();
				entry.element.style.removeProperty("transform-origin");
			}
		}, () => {});
	}

	drop(entry) {
		const box = this.boxOf(entry);
		box.remove();
		for (const property of ["position", "top", "left", "margin-right"]) box.style.removeProperty(property);
		entry.element.style.removeProperty("transform-origin");
		this.entries = this.entries.filter((candidate) => candidate !== entry);
	}

	awaitSettled() {
		const running = () => [...this.geometry, ...[...this.motions.values()].map((motion) => motion.animation)];
		if (running().length === 0) {
			this.settle();
			this.finished = Promise.resolve();
			return this.finished;
		}
		this.resolveFinished?.();
		const token = Symbol("update");
		this.token = token;
		this.finished = new Promise((resolve) => { this.resolveFinished = resolve; });
		const wait = () => Promise.all(running().map((animation) => animation.finished.catch(() => null))).then(() => {
			if (this.token !== token) return;
			if (running().some((animation) => animation.playState === "running" || animation.pending)) return wait();
			this.settle();
			this.resolveFinished?.();
			this.resolveFinished = null;
		});
		wait();
		return this.finished;
	}

	settle() {
		this.cancelGeometry();
		for (const entry of [...this.entries]) {
			if (entry.departing && !this.motions.has(entry.id)) this.drop(entry);
			else if (!entry.departing) {
				entry.element.style.visibility = entry.visible ? "" : "hidden";
				const box = this.boxOf(entry);
				if (entry.card) box.style.width = `${entry.displayWidth}px`;
				box.style.removeProperty("margin-right");
			}
		}
	}

	cancelGeometry() {
		const geometry = this.geometry;
		this.geometry = [];
		geometry.forEach((animation) => animation.cancel());
	}

	sync(entries) {
		this.cancelGeometry();
		for (const motion of this.motions.values()) motion.animation.cancel();
		this.motions = new Map();
		for (const entry of this.entries) {
			if (!entries.some((candidate) => candidate.element === entry.element)) this.drop(entry);
		}
		this.entries = entries.map((entry) => ({ ...entry, departing: false, overlay: false }));
		const firstVisible = this.entries.findIndex((entry) => entry.visible);
		const lastVisible = this.entries.findLastIndex((entry) => entry.visible);
		let offset = 0;
		let totalWidth = 0;
		this.entries.forEach((entry, index) => {
			entry.displayWidth = !entry.visible && index > firstVisible && index < lastVisible ? 0 : entry.width;
			if (firstVisible === -1 || index < firstVisible) offset += entry.displayWidth;
			totalWidth += entry.displayWidth;
		});
		this.place(new Map());
		for (const entry of this.entries) {
			entry.element.style.removeProperty("transform-origin");
			this.boxOf(entry).style.removeProperty("margin-right");
			entry.element.style.visibility = entry.visible ? "" : "hidden";
		}
		this.strip.style.width = `${totalWidth}px`;
		this.strip.style.transform = `translateX(${-offset}px)`;
		this.resolveFinished?.();
		this.resolveFinished = null;
		this.token = null;
		this.finished = Promise.resolve();
		return this.finished;
	}

	destroy() {
		this.sync([]);
		this.reducedMotion.removeEventListener("change", this.onMotionPreference);
		this.strip.remove();
		this.viewport.style.overflow = this.previousOverflow;
		this.entries = [];
	}
}
