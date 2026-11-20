function matrixOf(style) {
	const [x, y] = style.transformOrigin.split(" ").map(parseFloat);
	const transform = style.transform && style.transform !== "none" ? new DOMMatrix(style.transform) : new DOMMatrix();
	return new DOMMatrix().translate(x, y).multiply(transform).translate(-x, -y);
}

// allow-comment: the shift places the paper so its projection starts at the container's edge; `vanish` is the vanishing point measured from that edge with the paper unshifted.
export function projectionAlong(element, axis, { perspective, vanish }) {
	const style = element.ownerDocument.defaultView.getComputedStyle(element);
	const matrix = matrixOf(style);
	const width = parseFloat(style.width) || element.offsetWidth;
	const height = parseFloat(style.height) || element.offsetHeight;
	const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => {
		const point = matrix.transformPoint(new DOMPoint(x, y, 0, 1));
		const depth = point.z / point.w;
		const scale = Number.isFinite(perspective) && perspective > 0 ? perspective / Math.max(perspective - depth, 1) : 1;
		return { along: (axis === "x" ? point.x : point.y) / point.w, scale };
	});
	const shift = Math.max(...corners.map(({ along, scale }) => (-vanish * (1 - scale)) / scale - along));
	const reach = Math.max(...corners.map(({ along, scale }) => vanish * (1 - scale) + (shift + along) * scale));
	return { shift, reach: Math.max(0, reach) };
}

const frames = new Map();

function depthOf(element) {
	let depth = 0;
	for (let node = element; node; node = node.parentElement) depth += 1;
	return depth;
}

export function follow(owner, step) {
	const view = owner.ownerDocument.defaultView;
	let frame = frames.get(view);
	if (!frame) {
		frame = { steps: new Map(), handle: null };
		frames.set(view, frame);
	}
	frame.steps.set(owner, step);
	const tick = () => {
		const deepestFirst = [...frame.steps].sort(([a], [b]) => depthOf(b) - depthOf(a));
		for (const [element, run] of deepestFirst) {
			if (frame.steps.get(element) !== run) continue;
			if (!element.isConnected || run() === false) frame.steps.delete(element);
		}
		frame.handle = frame.steps.size ? view.requestAnimationFrame(tick) : null;
	};
	if (frame.handle === null) frame.handle = view.requestAnimationFrame(tick);
}

export function unfollow(owner) {
	frames.get(owner.ownerDocument.defaultView)?.steps.delete(owner);
}
