import { follow, unfollow } from "./follow.js";
import { FoldDrag } from "./fold-drag.js";
import { chainRootOf } from "./layout.js";
import { EASING, TIMING } from "./motion.js";

const CORNERS = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"];

function handleShape(cue) {
	const mark = cue.querySelector(".supermax-fold-mark");
	if (!mark) return null;
	const style = cue.ownerDocument.defaultView.getComputedStyle(mark);
	return Object.fromEntries(CORNERS.map((corner) => [corner, style[corner]]));
}

function seamPattern(document) {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 8 20");
	svg.setAttribute("aria-hidden", "true");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute("d", "M2 2L6 6M2 8L6 12M2 14L6 18");
	svg.append(path);
	return svg;
}

export class FoldController {
	constructor(workspace) {
		this.workspace = workspace;
		this.entries = new Map();
	}

	mount(entry, occurrence, axis) {
		const { workspace } = this;
		const cue = workspace.create("button", `supermax-fold-cue is-${axis}`);
		cue.type = "button";
		cue.setAttribute("aria-label", workspace.strings.unfold(occurrence.title));
		cue.title = workspace.strings.unfold(occurrence.title);
		const custom = workspace.foldContent?.(occurrence, axis, workspace);
		if (custom instanceof workspace.document.defaultView.Node) cue.append(custom);
		else {
			const mark = workspace.create("span", "supermax-fold-mark");
			mark.setAttribute("aria-hidden", "true");
			mark.append(seamPattern(workspace.document));
			cue.append(mark);
		}
		cue.addEventListener("click", (event) => { if (event.detail === 0 && !this.drag) this.focus(occurrence.id, axis); });
		cue.addEventListener("pointerdown", (event) => {
			if (event.button !== 0 || !event.isPrimary || this.drag || workspace.body.inert) return;
			event.preventDefault();
			this.drag = new FoldDrag(this, cue, event);
		});
		if (!this.layer) {
			this.layer = workspace.create("div", "supermax-fold-layer");
			this.layer.inert = workspace.body.inert;
			workspace.element.append(this.layer);
		}
		cue.dataset.foldOccurrence = occurrence.id;
		this.layer.append(cue);
		this.entries.set(cue, { entry, occurrence: occurrence.id, axis });
		entry.foldCue = cue;
	}

	apply(entry, folded, direction) {
		entry.element.classList.toggle("is-folded", folded);
		if (entry.body) entry.body.inert = folded;
		entry.foldCue.inert = !folded && this.drag?.cue !== entry.foldCue;
		if (folded) {
			entry.foldCue.dataset.direction = direction;
			entry.element.dataset.foldDirection = direction;
		} else if (this.drag?.cue !== entry.foldCue) delete entry.foldCue.dataset.direction;
	}

	positionMarks() {
		if (!this.layer) return;
		this.place();
		follow(this.layer, () => {
			this.place();
			return this.workspace.body.getAnimations({ subtree: true }).some((animation) => animation.playState === "running");
		});
	}

	place() {
		const { workspace } = this;
		const bounds = workspace.body.getBoundingClientRect();
		const origin = workspace.element.getBoundingClientRect();
		const gutter = parseFloat(workspace.document.defaultView.getComputedStyle(workspace.element).getPropertyValue("--supermax-gutter")) || 0;
		const previous = this.visibleCues ?? new Map();
		const visible = new Map();
		for (const [cue, { entry, occurrence, axis }] of this.entries) {
			if (!workspace.navigator.get(occurrence)) {
				cue.hidden = true;
				if (entry.element.isConnected) continue;
				cue.remove();
				this.entries.delete(cue);
				continue;
			}
			const state = axis === "horizontal" ? workspace.findCell(occurrence) : workspace.findRow(occurrence);
			const shown = (this.drag?.active ? this.drag.visible.has(cue) : !!state?.folded && state.inView) && entry.element.isConnected;
			cue.hidden = !shown;
			cue.inert = !shown || !!this.drag?.active && this.drag.cue !== cue;
			if (!shown) continue;
			let box = entry.element.getBoundingClientRect();
			const row = axis === "horizontal" && entry.element.closest(".supermax-row");
			if (row) {
				const clip = row.getBoundingClientRect();
				const top = Math.max(box.top, clip.top);
				const bottom = Math.min(box.bottom, clip.bottom);
				if (bottom - top <= gutter) { cue.hidden = true; continue; }
				box = new workspace.document.defaultView.DOMRect(box.left, top, box.width, bottom - top);
			}
			const direction = cue.dataset.direction;
			const horizontal = axis === "horizontal";
			const gutterBox = horizontal && entry.element.parentElement.matches(".supermax-room") ? entry.element.parentElement.getBoundingClientRect() : box;
			const rowsTop = horizontal ? 0 : entry.element.parentElement.getBoundingClientRect().top;
			const title = horizontal ? null : entry.element.closest(".supermax-cell")?.querySelector(":scope > .supermax-cell-title");
			const atTitleGutter = !horizontal && direction === "down" && title && Math.abs(gutterBox.bottom - rowsTop) < .5;
			let seam = horizontal ? direction === "right" ? gutterBox.right : gutterBox.left : direction === "down" ? gutterBox.bottom - (atTitleGutter ? gutter : 0) : gutterBox.top;
			const boundary = seam + (atTitleGutter ? gutter : 0);
			const edge = boundary >= (horizontal ? bounds.right : bounds.bottom) - .5 ? horizontal ? "right" : "bottom" : "";
			cue.dataset.edge = edge;
			if (edge) seam = (horizontal ? bounds.right : bounds.bottom) - gutter;
			const width = cue.offsetWidth;
			const height = cue.offsetHeight;
			const x = horizontal ? seam + (direction === "left" ? gutter - width : 0) : box.left + (box.width - width) / 2;
			const y = horizontal ? box.top + (box.height - height) / 2 : seam + (direction === "up" ? gutter - height : 0);
			Object.assign(cue.style, { left: `${x - origin.left}px`, top: `${y - origin.top}px` });
			const member = workspace.navigator.get(occurrence);
			const order = horizontal
				? workspace.layout.chains.get(chainRootOf(workspace.navigator, member).id)?.cells.findIndex((cell) => cell.occurrence === occurrence)
				: workspace.layout.cells.get(member.parent)?.rows?.rows.findIndex((row) => row.occurrence === occurrence);
			visible.set(cue, {
				group: horizontal ? entry.element.closest(".supermax-strip") : entry.element.parentElement,
				axis,
				direction,
				order,
				rect: cue.getBoundingClientRect(),
				shape: handleShape(cue),
			});
		}
		this.showNearestPages(visible);
		this.visibleCues = visible;
		if (this.drag && !this.drag.settling || workspace.reducedMotion.matches) return;
		const leaving = [...previous].filter(([cue]) => !visible.has(cue));
		for (const [cue, next] of visible) {
			if (previous.has(cue)) continue;
			const candidates = leaving.filter(([, prior]) => prior.group === next.group && prior.axis === next.axis);
			if (candidates.length !== 1) continue;
			const prior = candidates[0][1];
			const dx = prior.rect.left - next.rect.left;
			const dy = prior.rect.top - next.rect.top;
			const reach = Math.max(prior.rect.width, prior.rect.height, next.rect.width, next.rect.height);
			if (Math.abs(dx) > reach * 2 || Math.abs(dy) > reach * 2) continue;
			const timing = { duration: workspace.time.ms(TIMING.handle), easing: EASING.room };
			cue.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }], timing);
			const mark = cue.querySelector(".supermax-fold-mark");
			if (prior.shape && next.shape && mark) mark.animate([prior.shape, next.shape], timing);
		}
	}

	showNearestPages(visible) {
		const groups = new Map();
		for (const [cue, position] of visible) {
			let byDirection = groups.get(position.group);
			if (!byDirection) groups.set(position.group, byDirection = new Map());
			const key = `${position.axis}:${position.direction}`;
			if (!byDirection.has(key)) byDirection.set(key, []);
			byDirection.get(key).push([cue, position]);
		}
		for (const byDirection of groups.values()) for (const candidates of byDirection.values()) {
			const axis = candidates[0][1].axis;
			const coordinate = ([, position]) => axis === "horizontal" ? position.rect.left : position.rect.top;
			candidates.sort((first, second) => coordinate(first) - coordinate(second));
			const clusters = [];
			for (const candidate of candidates) {
				const cluster = clusters.at(-1);
				if (cluster && coordinate(candidate) - coordinate(cluster.at(-1)) < 44) cluster.push(candidate);
				else clusters.push([candidate]);
			}
			for (const cluster of clusters) {
				if (cluster.length < 2) continue;
				const direction = cluster[0][1].direction;
				const nearest = (this.drag?.cue && cluster.find(([cue]) => cue === this.drag.cue))
					?? cluster.reduce((best, candidate) => ["right", "down"].includes(direction)
						? candidate[1].order > best[1].order ? candidate : best
						: candidate[1].order < best[1].order ? candidate : best);
				for (const [cue] of cluster) {
					if (cue === nearest[0]) continue;
					cue.hidden = true;
					cue.inert = true;
					visible.delete(cue);
				}
			}
		}
		for (const byDirection of groups.values()) for (const [axis, backward, forward] of [["horizontal", "right", "left"], ["vertical", "down", "up"]]) {
			const earlier = (byDirection.get(`${axis}:${backward}`) ?? []).filter(([cue]) => visible.has(cue));
			const later = (byDirection.get(`${axis}:${forward}`) ?? []).filter(([cue]) => visible.has(cue));
			for (const [cue, position] of earlier) {
				const center = axis === "horizontal" ? position.rect.left + position.rect.width / 2 : position.rect.top + position.rect.height / 2;
				const collision = later.find(([other, next]) => visible.has(other) && Math.abs(center - (axis === "horizontal" ? next.rect.left + next.rect.width / 2 : next.rect.top + next.rect.height / 2)) < 44);
				if (!collision) continue;
				const hidden = this.drag?.cue === cue ? collision[0] : cue;
				hidden.hidden = true;
				hidden.inert = true;
				visible.delete(hidden);
			}
		}
	}

	destroy() {
		this.drag?.cancel();
		if (this.layer) unfollow(this.layer);
		this.entries.clear();
	}

	announce(occurrence, axis) {
		this.workspace.dispatchEvent(new CustomEvent("foldfocus", { detail: { occurrence, axis } }));
	}

	focus(occurrenceId, axis) {
		const { workspace } = this;
		if (!workspace.navigator.get(occurrenceId)) return false;
		workspace.navigator.focusFold(occurrenceId, axis);
		workspace.render({ animate: true });
		this.announce(occurrenceId, axis);
		return true;
	}
}
