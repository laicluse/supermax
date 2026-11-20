import { foldSize } from "./overflow.js";
const WIDTH = ["min", "max", "preferred"];
const HEIGHT = ["minHeight", "maxHeight", "preferredHeight"];

export function variantProblems(owner, axis = "width") {
	if (owner.variants == null) return [];
	const variants = owner.variants;
	if (!Array.isArray(variants) || variants.length < 2) return ["invalid-variants"];
	const fields = axis === "width" ? WIDTH : HEIGHT;
	const [minimum, maximum, preferred] = fields;
	const ids = new Set();
	for (const [index, variant] of variants.entries()) {
		if (!variant || typeof variant !== "object" || typeof variant.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(variant.id) || ids.has(variant.id)) return ["invalid-variant-id"];
		ids.add(variant.id);
		if (Object.keys(variant).some((key) => !["id", "when", ...fields].includes(key))) return ["invalid-variant-field"];
		const bounds = { ...owner, ...variant };
		if (!Number.isFinite(bounds[minimum]) || bounds[minimum] <= 0 || (bounds[maximum] !== "*" && (!Number.isFinite(bounds[maximum]) || bounds[maximum] < bounds[minimum]))) return ["invalid-variant-size"];
		if ((bounds[maximum] === "*" && bounds[preferred] == null) || (bounds[preferred] != null && (!Number.isFinite(bounds[preferred]) || bounds[preferred] < bounds[minimum] || (bounds[maximum] !== "*" && bounds[preferred] > bounds[maximum])))) return ["invalid-variant-preferred"];
		if (bounds[minimum] <= foldSize(owner)) return ["invalid-variant-fold"];
		if (axis === "height" && (bounds[maximum] === "*") !== (owner[maximum] === "*")) return ["variant-changes-elastic-row"];
		if (Number.isFinite(bounds[maximum]) && (variant.when?.[axis === "width" ? "minWidth" : "minHeight"] ?? 0) > bounds[maximum]) return ["unreachable-variant"];
		if (index === variants.length - 1) {
			if (variant.when != null) return ["variant-needs-fallback"];
		} else {
			if (!variant.when || typeof variant.when !== "object" || Object.keys(variant.when).length === 0 || Object.entries(variant.when).some(([key, value]) => !["minWidth", "minHeight"].includes(key) || !Number.isFinite(value) || value <= 0)) return ["invalid-variant-condition"];
		}
	}
	// allow-comment: a user drags a divider through every size between the smallest and the largest form, so the forms together must admit all of them; a size no form admits would make the cell jump over it.
	const [condition, across] = axis === "width" ? ["minWidth", "minHeight"] : ["minHeight", "minWidth"];
	const gapped = (forms) => {
		const admitted = forms.map((variant) => {
			const bounds = { ...owner, ...variant };
			return [Math.max(bounds[minimum], variant.when?.[condition] ?? 0), bounds[maximum] === "*" ? Infinity : bounds[maximum]];
		}).sort((first, second) => first[0] - second[0]);
		let reach = admitted[0][1];
		for (const [from, until] of admitted.slice(1)) {
			if (Math.ceil(from) > Math.floor(reach) + 1) return true;
			reach = Math.max(reach, until);
		}
		return false;
	};
	// allow-comment: a form that also waits for room on the other axis is not always there, so the forms without such a condition must close the range by themselves as well.
	if (gapped(variants) || gapped(variants.filter((variant) => variant.when?.[across] == null))) return ["variant-gap"];
	return [];
}

export function resizeBounds(owner, axis = "width") {
	const [minimum, maximum] = axis === "width" ? WIDTH : HEIGHT;
	const forms = owner.variants ?? [owner];
	return {
		min: Math.min(...forms.map((form) => form[minimum] ?? owner[minimum])),
		max: Math.max(...forms.map((form) => (form[maximum] ?? owner[maximum]) === "*" ? Infinity : form[maximum] ?? owner[maximum])),
	};
}

// allow-comment: a smaller form reaches up to where the next form takes over, so a divider can stop at every size between them. Allocation gives it no more than it prefers; the room above that is the user's to drag into.
function formOf(owner, variant, axis) {
	const form = { ...owner, ...variant };
	const [maximum, preferred] = axis === "width" ? ["max", "preferred"] : ["maxHeight", "preferredHeight"];
	if (variant === owner.variants[0] || form[maximum] === "*" || form[preferred] == null) return form;
	return { ...form, [maximum]: Math.min(form[maximum], form[preferred]), reach: form[maximum] };
}

export function definitionFor(model, occurrence) {
	return model.variantDefinitions?.get(occurrence.id) ?? model.definitionOf(occurrence.destination);
}

export function rowDefinitions(model, split) {
	return model.variantRows?.get(split.id) ?? model.definitionOf(split.destination).rows;
}

function matches(variant, width, height) {
	return !variant.when || width >= (variant.when.minWidth ?? 0) && height >= (variant.when.minHeight ?? 0);
}

function compare(first, second) {
	for (let index = 0; index < first.length; index += 1) if (first[index] !== second[index]) return first[index] - second[index];
	return 0;
}

export function selectVariants(model, allocate) {
	const choices = [];
	const occurrences = [];
	const walk = (occurrence) => {
		occurrences.push(occurrence);
		for (const id of occurrence.children) if (id) walk(model.get(id));
	};
	walk(model.root);
	for (const occurrence of occurrences) {
		const definition = model.definitionOf(occurrence.destination);
		if (definition.variants) choices.push({ occurrence, owner: definition, axis: "width" });
		definition.rows?.forEach((row, index) => {
			const root = model.get(occurrence.children[index]);
			if (root && row.variants) choices.push({ occurrence: root, split: occurrence, index, owner: row, axis: "height" });
		});
	}
	if (choices.length === 0) return allocate(model);
	const candidate = Object.create(model);
	candidate.variantDefinitions = new Map();
	candidate.variantRows = new Map();
	// allow-comment: retained fold geometry is a visual continuity hint, never an input to responsive variant selection.
	candidate.canonicalVariants = true;
	let best = null;
	let bestRank = null;
	let bestOrder = null;
	const selected = [];
	const widths = new Map(choices.flatMap((choice, index) => choice.axis === "width" ? [[choice.occurrence.id, index]] : []));
	const heights = new Map(choices.flatMap((choice, index) => choice.axis === "height" ? [[choice.occurrence.id, index]] : []));
	// allow-comment: floored demands remain lower bounds under cumulative pixel snapping; required-full prefixes bound every candidate that could outrank the incumbent.
	const minimum = (owner, index, field, condition, position) => {
		const forms = index === undefined ? [owner] : index < position ? [selected[index]] : owner.variants;
		return Math.min(...forms.map((form) => Math.floor(Math.max(form[field] ?? owner[field] ?? 0, form.when?.[condition] ?? 0))));
	};
	const required = (chain, position, full) => {
		let width = 0;
		let height = 0;
		for (const cell of chain.cells) {
			const occurrence = model.get(cell.occurrence);
			const definition = model.definitionOf(occurrence.destination);
			let ownWidth = full.has(occurrence.id) ? minimum(definition, widths.get(occurrence.id), "min", "minWidth", position) : 0;
			let ownHeight = full.has(occurrence.id) ? minimum(definition, widths.get(occurrence.id), "minHeight", "minHeight", position) : 0;
			if (cell.rows) {
				ownWidth = 0;
				ownHeight = 0;
				cell.rows.rows.forEach((row, index) => {
					if (!row.chain) return;
					const child = required(row.chain, position, full);
					if (child.width === 0 && child.height === 0) return;
					const owner = definition.rows[index];
					ownWidth = Math.max(ownWidth, child.width, minimum(owner, heights.get(row.occurrence), "min", "minWidth", position));
					ownHeight += Math.max(child.height, minimum(owner, heights.get(row.occurrence), "minHeight", "minHeight", position));
				});
				if (ownWidth > 0 || ownHeight > 0) ownHeight += definition.header === "title" ? model.chrome.header : 0;
			}
			width += ownWidth;
			height = Math.max(height, ownHeight);
		}
		return { width, height };
	};
	const canImprove = (position, includeTie) => {
		if (!best || bestRank[0] !== 0) return true;
		const full = new Set(model.zoomed ? [] : best.chain.cells.filter((cell) => cell.kept).map((cell) => cell.occurrence));
		const fits = () => {
			const floor = required(best.chain, position, full);
			return floor.width <= model.size.width && floor.height <= model.size.height;
		};
		for (const [index, occurrence] of occurrences.toReversed().entries()) {
			const state = bestRank[index + 1];
			if (state === 0) full.add(occurrence.id);
			else {
				if (state === 1) full.add(occurrence.id);
				if (fits()) return true;
				if (state === 1) full.delete(occurrence.id);
			}
		}
		return includeTie && fits();
	};
	const assign = (position, variant) => {
		const choice = choices[position];
		selected[position] = variant;
		const form = formOf(choice.owner, variant, choice.axis);
		if (choice.axis === "width") candidate.variantDefinitions.set(choice.occurrence.id, form);
		else {
			const rows = [...rowDefinitions(candidate, choice.split)];
			rows[choice.index] = form;
			candidate.variantRows.set(choice.split.id, rows);
		}
	};
	const visit = (position) => {
		if (!canImprove(position, true)) return false;
		if (position < choices.length) {
			const choice = choices[position];
			for (const variant of choice.owner.variants) {
				assign(position, variant);
				if (visit(position + 1)) return true;
			}
			return false;
		}
		const layout = allocate(candidate);
		for (const [index, choice] of choices.entries()) {
			const cell = layout.cells.get(choice.occurrence.id);
			const row = layout.rows.get(choice.occurrence.id);
			const shown = choice.axis === "height" ? row?.inView && !row.folded : cell?.full;
			if (shown && !matches(selected[index], choice.axis === "height" ? row.width : cell.width, choice.axis === "height" ? row.height : cell.height)) return false;
		}
		const rank = [Number(layout.overflowX || layout.overflow), ...occurrences.toReversed().map((occurrence) => {
			const cell = layout.cells.get(occurrence.id);
			return cell?.full ? 0 : cell?.inView ? 1 : 2;
		})];
		const order = choices.map((choice, index) => choice.owner.variants.indexOf(selected[index]));
		if (!best || compare(rank, bestRank) < 0 || compare(rank, bestRank) === 0 && compare(order, bestOrder) < 0) {
			best = layout;
			bestRank = rank;
			bestOrder = order;
			for (const [index, choice] of choices.entries()) {
				const cell = layout.cells.get(choice.occurrence.id);
				if (cell) cell[choice.axis === "width" ? "variant" : "rowVariant"] = selected[index].id;
				const row = layout.rows.get(choice.occurrence.id);
				if (row && choice.axis === "height") {
					row.variant = selected[index].id;
					for (const member of row.chain?.cells ?? []) member.rowVariant = selected[index].id;
				}
			}
		}
		return compare(rank, bestRank) === 0 && !canImprove(0, false);
	};
	choices.forEach((choice, index) => assign(index, choice.owner.variants.at(-1)));
	visit(choices.length);
	visit(0);
	return best;
}

// allow-comment: growth keeps the forms the ordinary layout chose: it pins them and gives way in a neighbour only down to the size at which its form still holds.
export function pinVariants(model, layout) {
	const candidate = Object.create(model);
	candidate.variantDefinitions = new Map();
	candidate.variantRows = new Map();
	candidate.variantFloors = { width: new Map(), height: new Map() };
	candidate.canonicalVariants = true;
	let pinned = false;
	for (const [id, cell] of layout.cells) {
		const occurrence = cell.variant ? model.get(id) : null;
		const owner = occurrence && model.definitionOf(occurrence.destination);
		const variant = owner?.variants?.find((form) => form.id === cell.variant);
		if (!variant) continue;
		candidate.variantDefinitions.set(id, formOf(owner, variant, "width"));
		if (variant.when?.minWidth) candidate.variantFloors.width.set(id, variant.when.minWidth);
		pinned = true;
	}
	for (const [id, row] of layout.rows) {
		const root = row.variant ? model.get(id) : null;
		const split = root?.parent ? model.get(root.parent) : null;
		const index = split ? split.children.indexOf(id) : -1;
		const owner = index >= 0 ? model.definitionOf(split.destination).rows[index] : null;
		const variant = owner?.variants?.find((form) => form.id === row.variant);
		if (!variant) continue;
		const rows = [...(candidate.variantRows.get(split.id) ?? model.definitionOf(split.destination).rows)];
		rows[index] = formOf(owner, variant, "height");
		candidate.variantRows.set(split.id, rows);
		if (variant.when?.minHeight) candidate.variantFloors.height.set(id, variant.when.minHeight);
		pinned = true;
	}
	return pinned ? candidate : model;
}

export function keepsVariants(model, layout, from) {
	for (const [id, before] of from.cells) {
		const cell = layout.cells.get(id);
		if (!cell || cell.visible !== before.visible || cell.folded !== before.folded) return false;
		if (before.variant) {
			const variant = model.definitionOf(model.get(id).destination).variants.find((form) => form.id === before.variant);
			if (cell.full && !matches(variant, cell.width, cell.height)) return false;
			cell.variant = before.variant;
		}
		if (before.rowVariant) cell.rowVariant = before.rowVariant;
	}
	for (const [id, before] of from.rows) {
		const row = layout.rows.get(id);
		if (!row || row.visible !== before.visible || row.folded !== before.folded) return false;
		if (before.variant) {
			const root = model.get(id);
			const split = model.get(root.parent);
			const variant = model.definitionOf(split.destination).rows[split.children.indexOf(id)].variants.find((form) => form.id === before.variant);
			if (row.inView && !row.folded && !matches(variant, row.width, row.height)) return false;
			row.variant = before.variant;
		}
	}
	return true;
}
