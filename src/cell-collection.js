// Framework-free Supermax cell distribution primitives.

// allow-comment: a curve maps a position along the chain, 0 at its start and 1 at its end, to the share of the room given out up to there, rising from 0 to 1. A cell's share is the rise over its own stretch of the chain, so both its width and its place count. Linear growth with steepness s gives the first pixel 1 - s of an even share and the last pixel 1 + s; a negative steepness favours the start instead. The default gives the whole room by place, as the deepest cell has the most reason to claim it.
export function linearCurve(steepness) {
	if (!(steepness >= -1 && steepness <= 1)) throw new TypeError(`A linear curve takes a steepness from -1 to 1, not ${steepness}`);
	return (position) => (1 - steepness) * position + steepness * position * position;
}

export const DEFAULT_CURVE = linearCurve(1);

export class CellProxy {
	constructor(config) {
		this.config = config;
		this.actual = config.min;
	}

	get id() { return this.config.id; }
	get title() { return this.config.title; }
	get min() { return this.config.min; }
	get max() { return this.config.max; }
	get preferred() { return this.config.preferred ?? null; }
	get ask() { return this.config.ask ?? this.config.preferred ?? this.config.min; }
	get zoomable() { return !!this.config.zoomable; }
	get elastic() { return !!this.config.elastic; }
	get visible() { return this.actual > 0; }
}

export class CellCollection {
	constructor(configs, curve = DEFAULT_CURVE, fit = "preferred") {
		if (typeof curve !== "function") throw new TypeError("A cell collection's curve must be a function of a position from 0 to 1");
		if (fit !== "preferred" && fit !== "min") throw new TypeError(`A cell collection fits cells by "preferred" or "min", not ${fit}`);
		this.proxies = configs.map((config) => new CellProxy(config));
		this.curve = curve;
		this.fit = fit;
	}

	sumOfActuals() {
		return this.proxies.reduce((sum, proxy) => sum + proxy.actual, 0);
	}

	hiddenCount() {
		return this.proxies.filter((proxy) => !proxy.visible).length;
	}

	rightmostHiddenTitle() {
		for (let index = this.proxies.length - 1; index >= 0; index -= 1) {
			if (!this.proxies[index].visible) return this.proxies[index].title;
		}
		return null;
	}

	resetActualsToMins() {
		this.proxies.forEach((proxy) => { proxy.actual = proxy.min; });
	}

	// allow-comment: a cell asks for its preference when it has one and for its minimum otherwise; a split asks what its widest row asks. The ask is the room a cell wants on the screen to be worth showing, not the size it is held at.
	askOf(proxy) {
		return Math.min(proxy.max, Math.max(proxy.min, proxy.ask));
	}

	// allow-comment: cells hide from the start until the rest fits at its minima, which keeps a small screen workable. A chain then goes on hiding until the rest fits at what it asks for, which decides how many cells a wide screen shows at once; when the cells that cannot hide ask more than there is, that second pass gains nothing and is undone. Split rows stop at the minima, since a row is part of a declared composition rather than a step of navigation.
	hideCellsToFit(maxColumns, keepIndex = this.proxies.length - 1) {
		this.hideUntilFit(maxColumns, keepIndex, (proxy) => proxy.min);
		if (this.fit === "min") return;
		const atMinima = this.proxies.map((proxy) => proxy.actual);
		if (!this.hideUntilFit(maxColumns, keepIndex, (proxy) => this.askOf(proxy))) this.proxies.forEach((proxy, index) => { proxy.actual = atMinima[index]; });
	}

	hideUntilFit(maxColumns, keepIndex, sizeOf) {
		const sum = () => this.proxies.reduce((total, proxy) => total + (proxy.visible ? sizeOf(proxy) : 0), 0);
		if (sum() <= maxColumns) return true;
		for (let index = 0; index < this.proxies.length; index += 1) {
			if (index === keepIndex || this.proxies[index].config.keep) continue;
			this.proxies[index].actual = 0;
			if (sum() <= maxColumns) return true;
		}
		return false;
	}

	// allow-comment: every cell stands on its minimum and the whole room above the minima goes out along the curve, up to each maximum; an elastic cell stops at its preference like any other, and takes what is left only once every cell is at its maximum. A preference plays no part in the shares: it decides which cells show, not where they stand.
	distributeRemainingSpace(maxColumns) {
		const visible = this.proxies.filter((proxy) => proxy.visible);
		if (visible.length === 0) return;
		const sumOfVisibleMins = visible.reduce((sum, proxy) => sum + proxy.min, 0);
		if (sumOfVisibleMins > maxColumns) return;
		const sumOfVisibleMaxes = visible.reduce((sum, proxy) => sum + proxy.max, 0);
		if (maxColumns >= sumOfVisibleMaxes) {
			visible.forEach((proxy) => { proxy.actual = proxy.max; });
			const elastic = visible.findLast((proxy) => proxy.elastic);
			if (elastic) elastic.actual += maxColumns - sumOfVisibleMaxes;
			return;
		}
		this.fillAlongCurve(visible, maxColumns, (proxy) => proxy.min, (proxy) => proxy.max);
	}

	// allow-comment: each cell's share is the curve's rise over its stretch of the chain laid out at the minima, so the outcome depends on nothing but the bounds and the budget. A cell that would pass its maximum stops there and the others take what it left, by the same shares.
	fillAlongCurve(visible, maxColumns, floorOf, ceilingOf) {
		const total = visible.reduce((sum, proxy) => sum + floorOf(proxy), 0);
		const shares = new Map();
		let edge = 0;
		for (const proxy of visible) {
			const next = edge + floorOf(proxy);
			shares.set(proxy, total > 0 ? this.curve(next / total) - this.curve(edge / total) : 1 / visible.length);
			edge = next;
		}
		const fixed = new Set();
		for (;;) {
			const active = visible.filter((proxy) => !fixed.has(proxy));
			if (active.length === 0) return;
			const room = maxColumns - visible.reduce((sum, proxy) => sum + (fixed.has(proxy) ? ceilingOf(proxy) : floorOf(proxy)), 0);
			const totalShare = active.reduce((sum, proxy) => sum + shares.get(proxy), 0);
			let clamped = false;
			for (const proxy of active) {
				const grown = floorOf(proxy) + (totalShare > 0 ? room * shares.get(proxy) / totalShare : room / active.length);
				if (grown > ceilingOf(proxy)) {
					proxy.actual = ceilingOf(proxy);
					fixed.add(proxy);
					clamped = true;
				} else {
					proxy.actual = grown;
				}
			}
			if (!clamped) return;
		}
	}

	hideCellsBeforeAnchor(anchorIndex) {
		for (let index = 0; index < anchorIndex; index += 1) this.proxies[index].actual = 0;
	}

	findAnchorIndex(anchorId) {
		if (anchorId == null) return -1;
		for (let index = 0; index < this.proxies.length; index += 1) {
			if (this.proxies[index].id === anchorId) return this.proxies[index].zoomable ? index : -1;
		}
		return -1;
	}

	distribute(maxColumns, anchorId) {
		this.resetActualsToMins();
		this.hideCellsToFit(maxColumns);
		const anchorIndex = this.findAnchorIndex(anchorId == null ? null : anchorId);
		if (anchorIndex > 0) this.hideCellsBeforeAnchor(anchorIndex);
		this.distributeRemainingSpace(maxColumns);
		return {
			cells: this.proxies.map((proxy) => ({
				config: proxy.config,
				actual: proxy.actual,
				visible: proxy.visible,
			})),
			hiddenCount: this.hiddenCount(),
			rightmostHiddenTitle: this.rightmostHiddenTitle(),
		};
	}
}
