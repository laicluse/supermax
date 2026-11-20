export const HORIZON = 1 - 2 / (1 + Math.sqrt(5));

export const ORIGAMI_PRESENTATION = Object.freeze({
	name: "origami",
	motion: Object.freeze({
		open: (element, { axis }) => (axis === "row" ? { origin: "center top", transform: "rotateX(-90deg)" } : { origin: "left center", transform: "rotateY(90deg)" }),
		close: (element, { axis, toward }) => {
			if (toward === "up") return { origin: "center top", transform: "rotateX(-90deg)" };
			if (toward === "down" || axis === "row") return { origin: "center bottom", transform: "rotateX(90deg)" };
			return { origin: "right center", transform: "rotateY(-90deg)" };
		},
	}),
	createStrip: null,
});
