import { follow, projectionAlong, unfollow } from "./follow.js";
import { APPEAR, DISAPPEAR, EASING, TIMING, TimeScale } from "./motion.js";

export const STRIP_TIMING = Object.freeze({ duration: TIMING.stroke, easing: EASING.room, settle: TIMING.settle });

// allow-comment: a room whose target moves less than this many pixels takes it without motion.
export const STILL = 2;

const depthOf = (id) => String(id).split("/").length;

// allow-comment: the longest run of staying boxes already in their wanted order stays put, because moving a node resets the scroll of everything inside it.
function inOrder(positions) {
	const tails = [];
	const previous = new Array(positions.length).fill(-1);
	positions.forEach((position, index) => {
		let low = 0;
		let high = tails.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (positions[tails[middle]] < position) low = middle + 1;
			else high = middle;
		}
		if (low > 0) previous[index] = tails[low - 1];
		tails[low] = index;
	});
	const run = [];
	for (let index = tails[tails.length - 1] ?? -1; index !== -1; index = previous[index]) run.unshift(positions[index]);
	return run;
}

function reversedEasing(easing) {
	const curve = /^cubic-bezier\(([^)]*)\)$/.exec(easing)?.[1].split(",").map(Number);
	if (!curve || curve.length !== 4) return easing;
	const [x1, y1, x2, y2] = curve;
	return `cubic-bezier(${1 - x2}, ${1 - y2}, ${1 - x1}, ${1 - y1})`;
}

function absolute(element, transform, origin) {
	const [x, y] = origin.split(" ").map(parseFloat);
	const matrix = transform && transform !== "none" ? new DOMMatrix(transform) : new DOMMatrix();
	return new DOMMatrix().translate(x, y).multiply(matrix).translate(-x, -y);
}

function currentPose(element) {
	const style = getComputedStyle(element);
	return { matrix: absolute(element, style.transform, style.transformOrigin), shade: parseFloat(getComputedStyle(element, "::after").opacity) || 0 };
}

// allow-comment: the shade runs on the ::after's own opacity, which the compositor animates, instead of a custom property every descendant would recalculate each frame.
function fold(element, frames, timing) {
	const animation = element.animate(frames.map(({ transform }) => ({ transform })), timing);
	animation.shade = element.animate(frames.map(({ shade }) => ({ opacity: shade })), { ...timing, pseudoElement: "::after" });
	return animation;
}

const delayOf = (animation) => animation.effect?.getTiming().delay ?? 0;
const started = (animation) => animation.playState === "finished" || (animation.currentTime ?? 0) > delayOf(animation);
const ahead = (animation) => (started(animation) ? 0 : delayOf(animation) - (animation.currentTime ?? 0));
const remaining = (animation) => (animation.playState === "finished" ? 0 : Math.max(0, delayOf(animation) + animation.effect.getTiming().duration - (animation.currentTime ?? 0)));
const moving = (animation) => (animation.playState === "running" || animation.playState === "paused") && started(animation);

function undelay(animation) {
	for (const part of [animation, animation.shade].filter(Boolean)) {
		const time = Math.max(0, (part.currentTime ?? 0) - delayOf(part));
		part.effect.updateTiming({ delay: 0 });
		part.currentTime = time;
	}
}

function postpone(animation, delay) {
	for (const part of [animation, animation.shade].filter(Boolean)) part.effect.updateTiming({ delay: (part.currentTime ?? 0) + delay });
}

function stop(animation) {
	animation?.cancel();
	animation?.shade?.cancel();
}

function poseMatrix(element, pose) {
	const previous = element.style.transformOrigin;
	element.style.transformOrigin = pose.origin;
	const origin = getComputedStyle(element).transformOrigin;
	element.style.transformOrigin = previous;
	return absolute(element, pose.transform, origin);
}

export class CellStrip {
	constructor(viewport, { duration = STRIP_TIMING.duration, easing = STRIP_TIMING.easing, settle = STRIP_TIMING.settle, time = new TimeScale(), motion = null, horizon = null, toward = null } = {}) {
		this.time = time;
		this.settling = settle;
		this.departures = new Map();
		this.roomDelay = 0;
		this.viewport = viewport;
		this.toward = toward;
		this.horizon = horizon;
		this.driven = new Set();
		this.drivenWaiters = [];
		this.duration = duration;
		this.roomDuration = duration;
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

	update(entries, { animate = true, arrive = false, interactive = false } = {}) {
		const ids = new Set();
		for (const entry of entries) {
			if (ids.has(entry.id)) throw new Error(`Duplicate cell id: ${entry.id}`);
			if (!Number.isFinite(entry.width) || (entry.width < 0 || (entry.width === 0 && !entry.folded))) throw new Error(`Invalid cell width: ${entry.id}`);
			ids.add(entry.id);
		}
		const firstPaint = !this.initialized;
		this.initialized = true;
		if (!animate || (!interactive && this.reducedMotion.matches) || this.duration <= 0 || (firstPaint && !arrive)) return this.sync(entries);

		const view = this.viewport.ownerDocument.defaultView;
		const departed = this.resolveDepartures(ids);
		for (const entry of this.entries) {
			const motion = this.motions.get(entry.id);
			if (!entry.departing || entry.overlay || !motion || ahead(motion.animation) <= 0) continue;
			stop(motion.animation);
			this.motions.delete(entry.id);
			entry.element.style.removeProperty("transform-origin");
			entry.departing = false;
		}
		const running = [...this.geometry, ...[...this.motions.values()].map((motion) => motion.animation)];
		const hold = running.some(moving) ? 0 : this.time.ms(this.settling);
		const pending = Math.max(0, ...running.map(ahead));
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

		const next = entries.map((entry) => {
			const old = previous.get(entry.id);
			return { ...entry, departing: false, overlay: false, paperWidth: old && old.folded !== entry.folded ? Math.max(old.width, entry.width) : old?.paperWidth ?? null };
		});
		const leaving = this.entries.filter((entry) => !ids.has(entry.id)).map((entry) => ({ ...entry, visible: false }));
		const newlyLeaving = leaving.filter((entry) => !entry.departing);
		const returning = next.filter((entry) => previous.get(entry.id)?.departing);
		const arriving = next.filter((entry) => entry.visible && !previous.has(entry.id));
		arriving.forEach((entry, index) => { entry.order = (entry.row ?? 0) + index; });

		const partners = new Map();
		for (const entry of arriving) {
			const partner = newlyLeaving.find((candidate) => depthOf(candidate.id) === depthOf(entry.id) && ![...partners.values()].includes(candidate));
			if (partner) partners.set(entry.id, partner);
		}
		for (const entry of arriving) entry.replaces = partners.has(entry.id);
		let wait = 0;
		for (const partner of partners.values()) {
			const departure = departed.get(partner.id);
			wait = Math.max(wait, departure ? remaining(departure) : this.motions.has(partner.id) ? 0 : this.time.ms(this.poseOf("close", partner).duration ?? this.duration));
		}
		const start = Math.max(wait, hold, pending);
		const gone = (entry) => Math.max(hold, pending, departed.has(entry.id) ? remaining(departed.get(entry.id)) : 0);
		this.roomDelay = start;

		for (const entry of leaving) {
			const motion = this.motions.get(entry.id);
			const paired = [...partners.values()].includes(entry);
			if (!entry.departing) entry.overlay = paired;
			entry.departing = true;
		}

		this.cancelGeometry();
		this.entries = [...leaving.filter((entry) => entry.overlay), ...next, ...leaving.filter((entry) => !entry.overlay)];
		const firstVisible = next.findIndex((entry) => entry.visible);
		const lastVisible = next.findLastIndex((entry) => entry.visible);
		let offset = 0;
		let totalWidth = 0;
		next.forEach((entry, index) => {
			entry.position = totalWidth;
			entry.displayWidth = !entry.visible && index > firstVisible && index < lastVisible ? 0 : entry.width;
			if (firstVisible === -1 || index < firstVisible) offset += entry.displayWidth;
			totalWidth += entry.displayWidth;
		});
		for (const entry of leaving) entry.displayWidth = 0;
		for (const entry of this.entries) {
			entry.card = !!this.motion && !entry.overlay && !entry.paperWidth;
			if (entry.paperWidth) {
				entry.element.setAttribute("data-supermax-fold-paper", "");
				entry.element.style.setProperty("--supermax-fold-paper-width", `${entry.paperWidth}px`);
			}
		}
		this.place(previous);
		const targetTransform = `translateX(${-offset}px)`;
		this.strip.style.width = `${totalWidth}px`;
		this.strip.style.transform = targetTransform;

		if (this.motion) {
			// allow-comment: a split opens and closes through its rows, which fold in the same stroke, but a split that another cell replaces leaves as one card, or it would vanish in a frame.
			for (const entry of newlyLeaving) {
				if (entry.still && !entry.overlay) continue;
				if (departed.has(entry.id)) {
					this.track(entry, "leave", departed.get(entry.id));
					continue;
				}
				const motion = this.motions.get(entry.id);
				if (entry.overlay) {
					const successor = [...partners].find(([, partner]) => partner === entry)?.[0];
					const toward = successor ? this.toward?.(entry.id, successor) ?? null : null;
					if (motion?.kind === "enter" || motion?.kind === "return") this.tearAway(entry, toward);
					else this.foldAway(entry, toward);
				} else if (motion) this.reverse(entry, "leave");
				else this.foldIn(entry, start);
			}
			for (const entry of returning) {
				if (entry.still && !this.motions.has(entry.id)) continue;
				if (this.motions.get(entry.id)?.reversible) this.reverse(entry, "enter");
				else this.foldBack(entry);
			}
			for (const motion of this.motions.values()) {
				const delay = motion.kind === "enter" ? ahead(motion.animation) : 0;
				if (delay > 0 && delay < start) postpone(motion.animation, start);
			}
			for (const entry of arriving) if (!entry.still) this.foldOpen(entry, start, !partners.has(entry.id));
		}
		this.drive(arriving, newlyLeaving, partners);

		const closingOnly = arriving.length === 0 && returning.length === 0 && newlyLeaving.some((entry) => !entry.overlay);
		const easing = closingOnly ? reversedEasing(this.easing) : this.easing;
		const moves = [];
		const timing = (delay) => ({ duration: this.time.ms(this.roomDuration), easing, delay, fill: "both" });
		const stripFrom = new DOMMatrix(startingTransform === "none" ? undefined : startingTransform).m41;
		if (startingTransform !== view.getComputedStyle(this.strip).transform) {
			moves.push({ distance: Math.abs(stripFrom + offset), run: () => this.geometry.push(this.strip.animate([{ transform: startingTransform }, { transform: targetTransform }], timing(start))) });
		}
		const origin = this.strip.getBoundingClientRect().left - stripFrom - offset;
		for (const entry of this.entries) {
			if (entry.overlay || this.driven.has(entry.id)) continue;
			const old = previous.get(entry.id);
			const room = (record) => record.currentWidth + record.currentMargin;
			const from = old && !old.overlay ? room(old) : partners.has(entry.id) ? room(previous.get(partners.get(entry.id).id)) : 0;
			const to = entry.displayWidth;
			if (Math.abs(from - to) < STILL) continue;
			moves.push({ distance: Math.abs(from - to), run: () => {
				const delay = timing(entry.departing ? gone(entry) : start);
				const box = this.boxOf(entry);
				if (entry.card) {
					const card = parseFloat(box.style.width) || 0;
					const left = origin + (entry.position ?? 0);
					const revealed = !old && !this.follows();
					const anchoredLeft = revealed || (to > from && old && !old.overlay && Math.abs(left - old.currentRect) + STILL < Math.abs(left + to - old.currentRect - from));
					if (anchoredLeft || entry.follows) this.geometry.push(box.animate([{ width: `${from}px`, marginRight: "0px" }, { width: `${to}px`, marginRight: "0px" }], delay));
					else this.geometry.push(box.animate([{ marginRight: `${from - card}px` }, { marginRight: `${to - card}px` }], delay));
					if (entry.follows) this.geometry.push(entry.element.animate([{ width: `${from}px` }, { width: `${to}px` }], delay));
					else if (!anchoredLeft) this.geometry.push(entry.element.animate([{ marginLeft: `${from - card}px` }, { marginLeft: `${to - card}px` }], delay));
				} else {
					this.geometry.push(box.animate([{ width: `${from}px` }, { width: `${to}px` }], delay));
				}
			} });
		}
		this.roomDuration = this.motion?.travel ? this.motion.travel(Math.max(0, ...moves.map((move) => move.distance))) : this.duration;
		for (const move of moves) move.run();
		if (!this.motion) this.slide(previous, timing(start));
		if (this.driven.size) {
			this.step();
			follow(this.strip, () => this.step());
		}
		return this.awaitSettled();
	}

	drive(arriving, newlyLeaving, partners) {
		const before = this.driven;
		this.driven = new Set(this.entries.filter((entry) => {
			if (entry.overlay || !this.motion) return false;
			if (entry.still) return typeof entry.follow === "function" && (before.has(entry.id) || (arriving.includes(entry) && !partners.has(entry.id)) || newlyLeaving.includes(entry));
			return !!this.motions.get(entry.id)?.follows;
		}).map((entry) => entry.id));
		for (const id of before) {
			const entry = this.entries.find((candidate) => candidate.id === id);
			if (entry && !this.driven.has(id)) this.release(entry);
		}
	}

	step() {
		this.followPapers();
		if (this.driven.size === 0) {
			const waiters = this.drivenWaiters;
			this.drivenWaiters = [];
			waiters.forEach((resolve) => resolve());
			return false;
		}
		return true;
	}

	roomTiming() {
		return { duration: this.time.ms(this.roomDuration), easing: this.easing, delay: this.roomDelay };
	}

	followPapers() {
		const view = this.viewport.ownerDocument.defaultView;
		const horizon = this.horizon?.() ?? null;
		for (const entry of this.entries) {
			if (!this.driven.has(entry.id)) continue;
			const box = this.boxOf(entry);
			box.style.marginRight = "0px";
			if (entry.still) {
				const reach = entry.follow();
				if (reach === null) this.release(entry);
				else box.style.width = `${reach}px`;
				continue;
			}
			if (!this.motions.has(entry.id)) {
				this.release(entry);
				continue;
			}
			const place = box.getBoundingClientRect();
			if (horizon) box.style.perspectiveOrigin = `${horizon.x - place.left}px ${horizon.y - place.top}px`;
			const style = view.getComputedStyle(box);
			const vanish = horizon ? horizon.x - place.left : parseFloat(style.perspectiveOrigin);
			const { shift, reach } = projectionAlong(entry.element, "x", { perspective: parseFloat(style.perspective), vanish });
			entry.element.style.marginLeft = `${shift}px`;
			box.style.width = `${reach}px`;
		}
	}

	release(entry) {
		this.driven.delete(entry.id);
		entry.element.style.removeProperty("margin-left");
		if (!entry.departing) this.boxOf(entry).style.width = `${entry.displayWidth}px`;
	}

	followed() {
		if (this.driven.size === 0) return Promise.resolve();
		return new Promise((resolve) => this.drivenWaiters.push(resolve));
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
			const ownWidth = entry.element.style.width.endsWith("px") ? parseFloat(entry.element.style.width) : 0;
			if (box !== entry.element) Object.assign(entry.element.style, { width: "100%", height: "100%", boxSizing: "border-box", flex: "none" });
			entry.element.style.visibility = "";
			if (entry.overlay) {
				Object.assign(style, { position: "absolute", top: "0", left: `${old?.overlay ? parseFloat(style.left) : old?.currentLeft ?? 0}px`, width: `${old?.overlay ? parseFloat(style.width) : old?.currentWidth ?? entry.width}px` });
			} else {
				for (const property of ["position", "top", "left"]) style.removeProperty(property);
				const kept = old?.overlay ? 0 : ownWidth || old?.currentWidth || 0;
				const shown = old && !old.overlay ? old.currentWidth + old.currentMargin : 0;
				entry.follows = entry.card && shown > 0 && shown < kept - 0.5 && entry.displayWidth < shown;
				const card = entry.follows ? shown : entry.card ? Math.max(kept, entry.displayWidth) : entry.displayWidth;
				style.width = `${card}px`;
				if (entry.card) entry.element.style.width = `${card}px`;
				if (entry.card) style.marginRight = `${entry.displayWidth - card}px`;
				else style.removeProperty("margin-right");
			}
			entry.element.inert = !entry.visible;
			entry.element.toggleAttribute("data-supermax-exiting", entry.departing);
			entry.element.toggleAttribute("data-supermax-folded", !entry.departing && !entry.folded && entry.displayWidth === 0);
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
			const anchors = currentOrder.filter((box) => this.entries.some((entry) => !entry.departing && this.boxOf(entry) === box));
			const staying = inOrder(anchors.map((box) => boxes.indexOf(box))).map((position) => boxes[position]);
			const end = currentOrder[currentOrder.length - 1].nextSibling;
			for (let index = boxes.length - 1; index >= 0; index -= 1) {
				if (staying.includes(boxes[index])) continue;
				parent.insertBefore(boxes[index], boxes[index + 1] ?? end);
			}
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
		return { axis: entry.axis ?? "chain", order: entry.order ?? 0, width: entry.width, replaces: !!entry.replaces };
	}

	poseOf(kind, entry, toward = null) {
		return this.motion[kind](entry.element, { ...this.axisOf(entry), ...(kind === "close" ? { toward } : {}) });
	}

	// allow-comment: a pose may carry its own duration, easing and delay; without them a stroke takes the strip's duration and the shared appear or disappear easing.
	strokeOf(pose, { easing, delay = 0, ...rest }) {
		return { duration: this.time.ms(pose.duration ?? this.duration), easing: pose.easing ?? easing, delay: delay + this.time.ms(pose.delay ?? 0), ...rest };
	}

	follows() {
		return this.motion?.follow !== false;
	}

	foldOpen(entry, delay, follows) {
		const pose = this.poseOf("open", entry);
		entry.element.style.transformOrigin = pose.origin ?? "center";
		const animation = fold(entry.element, [{ transform: pose.transform ?? "none", shade: pose.shade ?? 1 }, { transform: "none", shade: 0 }], this.strokeOf(pose, { delay, easing: APPEAR.easing, fill: "both" }));
		this.track(entry, "enter", animation, follows && this.follows(), true);
	}

	foldIn(entry, delay = 0) {
		const pose = this.poseOf("open", entry);
		const close = this.poseOf("close", entry);
		entry.element.style.transformOrigin = pose.origin ?? "center";
		const animation = fold(entry.element, [{ transform: pose.transform ?? "none", shade: pose.shade ?? 1 }, { transform: "none", shade: 0 }], this.strokeOf({ duration: close.duration ?? pose.duration, easing: pose.easing }, { delay, easing: APPEAR.easing, fill: "both", direction: "reverse" }));
		this.track(entry, "leave", animation, this.follows(), true);
	}

	reverse(entry, kind) {
		const motion = this.motions.get(entry.id);
		motion.animation.reverse();
		motion.animation.shade?.reverse();
		motion.kind = kind;
		motion.follows = this.follows();
		motion.reversible = true;
	}

	foldAway(entry, toward = null) {
		const pose = this.poseOf("close", entry, toward);
		entry.element.style.transformOrigin = pose.origin ?? "center";
		const animation = fold(entry.element, [{ transform: "none", shade: 0 }, { transform: pose.transform ?? "none", shade: pose.shade ?? 1 }], this.strokeOf(pose, { easing: DISAPPEAR.easing, fill: "forwards" }));
		this.track(entry, "leave", animation, !entry.overlay && this.follows());
	}

	tearAway(entry, toward = null) {
		const from = currentPose(entry.element);
		const pose = this.poseOf("close", entry, toward);
		const to = poseMatrix(entry.element, pose);
		stop(this.motions.get(entry.id)?.animation);
		entry.element.style.transformOrigin = "0 0";
		const animation = fold(entry.element, [{ transform: from.matrix.toString(), shade: from.shade }, { transform: to.toString(), shade: pose.shade ?? 1 }], this.strokeOf({ ...pose, delay: 0 }, { easing: DISAPPEAR.easing, fill: "forwards" }));
		this.track(entry, "tear", animation);
	}

	foldBack(entry) {
		const from = currentPose(entry.element);
		const pose = this.poseOf("open", entry);
		stop(this.motions.get(entry.id)?.animation);
		entry.element.style.transformOrigin = "0 0";
		const animation = fold(entry.element, [{ transform: from.matrix.toString(), shade: from.shade }, { transform: new DOMMatrix().toString(), shade: 0 }], this.strokeOf({ ...pose, delay: 0 }, { easing: APPEAR.easing, fill: "both" }));
		this.track(entry, "return", animation, this.follows());
	}

	// allow-comment: a departure folds a cell away in its own room before the host knows what replaces it; the room stays reserved until the next update decides.
	depart(ids, { after = 0, toward = null } = {}) {
		if (!this.motion || this.reducedMotion.matches || this.duration <= 0) return;
		for (const entry of this.entries) {
			if (!ids.has(entry.id) || entry.departing || entry.still || !entry.visible || this.departures.has(entry.id) || this.motions.has(entry.id)) continue;
			const pose = this.poseOf("close", entry, toward);
			entry.element.style.transformOrigin = pose.origin ?? "center";
			entry.element.inert = true;
			this.departures.set(entry.id, fold(entry.element, [{ transform: "none", shade: 0 }, { transform: pose.transform ?? "none", shade: pose.shade ?? 1 }], this.strokeOf(pose, { delay: this.time.ms(after), easing: DISAPPEAR.easing, fill: "forwards" })));
		}
	}

	stay(ids) {
		for (const [id, animation] of this.departures) {
			if (!ids.has(id)) continue;
			this.departures.delete(id);
			this.comeBack(this.entries.find((entry) => entry.id === id), animation);
		}
	}

	comeBack(entry, animation) {
		entry.element.inert = !entry.visible;
		if (!started(animation)) {
			stop(animation);
			entry.element.style.removeProperty("transform-origin");
			return;
		}
		undelay(animation);
		animation.reverse();
		animation.shade?.reverse();
		this.track(entry, "enter", animation, false, true);
	}

	resolveDepartures(ids) {
		const departed = new Map();
		for (const [id, animation] of this.departures) {
			const entry = this.entries.find((candidate) => candidate.id === id);
			if (ids.has(id) || !started(animation)) this.comeBack(entry, animation);
			else {
				undelay(animation);
				departed.set(id, animation);
			}
		}
		this.departures = new Map();
		return departed;
	}

	track(entry, kind, animation, follows = false, reversible = false) {
		const motion = { kind, animation, follows, reversible };
		this.motions.set(entry.id, motion);
		animation.finished.then(() => {
			if (this.motions.get(entry.id) !== motion) return;
			const current = this.entries.find((candidate) => candidate.id === entry.id);
			// allow-comment: a room that does not follow its cell closes on its own timeline, so the finished motion stays parked until the room has gone or the cell is wanted again.
			if (current?.departing && !current.overlay && !this.follows()) {
				motion.parked = true;
				return;
			}
			this.motions.delete(entry.id);
			stop(animation);
			if (current?.departing) this.drop(current);
			else entry.element.style.removeProperty("transform-origin");
		}, () => {});
	}

	drop(entry) {
		this.driven.delete(entry.id);
		entry.element.style.removeProperty("margin-left");
		this.clearFoldPaper(entry);
		const box = this.boxOf(entry);
		box.remove();
		for (const property of ["position", "top", "left", "margin-right"]) box.style.removeProperty(property);
		entry.element.style.removeProperty("transform-origin");
		this.entries = this.entries.filter((candidate) => candidate !== entry);
	}

	awaitSettled() {
		const running = () => [...this.geometry, ...[...this.motions.values()].map((motion) => motion.animation)];
		if (running().length === 0 && this.driven.size === 0) {
			this.settle();
			this.finished = Promise.resolve();
			return this.finished;
		}
		this.resolveFinished?.();
		const token = Symbol("update");
		this.token = token;
		this.finished = new Promise((resolve) => { this.resolveFinished = resolve; });
		const wait = () => Promise.all([...running().map((animation) => animation.finished.catch(() => null)), this.followed()]).then(() => {
			if (this.token !== token) return;
			if (this.driven.size || running().some((animation) => animation.playState === "running" || animation.pending)) return wait();
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
			if (entry.departing && (!this.motions.has(entry.id) || this.motions.get(entry.id).parked)) {
				stop(this.motions.get(entry.id)?.animation);
				this.motions.delete(entry.id);
				this.drop(entry);
			}
			else if (!entry.departing) {
				this.clearFoldPaper(entry);
				entry.element.style.visibility = entry.visible ? "" : "hidden";
				const box = this.boxOf(entry);
				if (entry.card) {
					box.style.width = `${entry.displayWidth}px`;
					entry.element.style.width = `${entry.displayWidth}px`;
					entry.element.style.removeProperty("margin-left");
				}
				box.style.removeProperty("margin-right");
			}
		}
	}

	clearFoldPaper(entry) {
		entry.paperWidth = null;
		entry.element.removeAttribute("data-supermax-fold-paper");
		entry.element.style.removeProperty("--supermax-fold-paper-width");
	}

	cancelGeometry() {
		const geometry = this.geometry;
		this.geometry = [];
		geometry.forEach((animation) => animation.cancel());
	}

	sync(entries) {
		this.cancelGeometry();
		unfollow(this.strip);
		for (const entry of this.entries) {
			entry.element.style.removeProperty("margin-left");
			this.clearFoldPaper(entry);
		}
		this.driven = new Set();
		this.step();
		for (const motion of this.motions.values()) stop(motion.animation);
		for (const animation of this.departures.values()) stop(animation);
		this.motions = new Map();
		this.departures = new Map();
		this.roomDelay = 0;
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
