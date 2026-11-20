import { APPEAR, DISAPPEAR } from "./motion.js";

export const HORIZON = 1 - 2 / (1 + Math.sqrt(5));

// A cell folds open from the edge it shares with its parent and folds away on the edge across from it.
function hinge(element, opening) {
	const rowRoot = !!element.closest(".supermax-row-chain") && element.parentElement?.firstElementChild === element;
	if (rowRoot) return opening ? { origin: "center top", folded: "rotateX(-90deg)" } : { origin: "center bottom", folded: "rotateX(90deg)" };
	return opening ? { origin: "left center", folded: "rotateY(90deg)" } : { origin: "right center", folded: "rotateY(-90deg)" };
}

// The whole cell fades as one with its fold, so it is fully transparent the moment it stands on edge.
// An opening cell first takes its room and eases out; a closing one eases in and leaves its room last.
function fold(element, timing, opening, delay = 0) {
	const { origin, folded } = hinge(element, opening);
	element.style.transformOrigin = origin;
	const options = { duration: timing.duration, delay, easing: (opening ? APPEAR : DISAPPEAR).easing, fill: "both" };
	const flat = { transform: "none", opacity: 1 };
	const edge = { transform: folded, opacity: 0 };
	const keyframes = opening ? [{ ...edge, offset: 0 }, { ...edge, offset: 0.3 }, { ...flat, offset: 1 }] : [{ ...flat, offset: 0 }, { ...edge, offset: 0.7 }, { ...edge, offset: 1 }];
	const only = (property) => keyframes.map((frame) => ({ [property]: frame[property], offset: frame.offset }));
	return [element.animate(only("transform"), { ...options, composite: "add" }), element.animate(only("opacity"), options)];
}

export const ORIGAMI_PRESENTATION = Object.freeze({
	name: "origami",
	motion: Object.freeze({
		// A replacement keeps its room: the old cell folds away first, then the new one folds open in its place.
		enter: (element, timing, { replacing } = {}) => fold(element, timing, true, replacing ? timing.duration : 0),
		leave: (element, timing) => fold(element, timing, false),
	}),
	createStrip: null,
});
