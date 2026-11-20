import { DEFAULT_RENDERER } from "./default-renderer.js";

export class SupermaxRendererError extends Error {
	constructor(part, message) {
		super(`Supermax renderer "${part}": ${message}`);
		this.name = "SupermaxRendererError";
	}
}

export function resolveRenderer(overrides = {}) {
	if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
		throw new SupermaxRendererError("renderer", "expected a map of part factories");
	for (const [name, factory] of Object.entries(overrides)) {
		if (!Object.hasOwn(DEFAULT_RENDERER, name) || typeof factory !== "function")
			throw new SupermaxRendererError(name, "expected a known part and a synchronous factory");
	}
	return Object.keys(overrides).length ? Object.freeze({ ...DEFAULT_RENDERER, ...overrides }) : DEFAULT_RENDERER;
}

function snapshot(state) {
	const actions = state.actions
		? Object.freeze(Object.fromEntries(Object.entries(state.actions).map(([name, value]) => [name, Object.freeze({ ...value })])))
		: undefined;
	return Object.freeze({ ...state, ...(actions ? { actions } : {}) });
}

export function mountPart(workspace, name, root, state = {}, { actions: specifications = {}, slots = {}, ...context } = {}) {
	const bindings = new Map();
	const cleanups = new Set();
	let current = snapshot(state);
	let disposed = false;
	const fail = (message) => {
		throw new SupermaxRendererError(name, message);
	};
	const paintAction = (id, button) => {
		const spec = specifications[id];
		const value = current.actions?.[id] ?? {};
		button.hidden = value.offered === false;
		button.disabled = value.enabled === false;
		button.setAttribute("aria-disabled", String(button.disabled || !!value.busy));
		button.setAttribute("aria-busy", String(!!value.busy));
		button.setAttribute("aria-label", value.label ?? spec.label ?? id);
	};
	const actions = Object.fromEntries(
		Object.entries(specifications).map(([id, spec]) => [
			id,
			{
				get element() {
					return bindings.get(id);
				},
				attach(button) {
					if (disposed) fail("cannot attach to a disposed part");
					if (!(button instanceof workspace.document.defaultView.HTMLButtonElement)) fail(`${id} requires a native button`);
					if (bindings.has(id)) fail(`${id} is already attached; detach before replacing it`);
					button.type = "button";
					const activate = (event) => {
						const value = current.actions?.[id] ?? {};
						if (!disposed && value.offered !== false && value.enabled !== false && !value.busy && !button.hidden && !button.disabled) spec.run(event);
					};
					button.addEventListener("click", activate);
					bindings.set(id, button);
					paintAction(id, button);
					const detach = () => {
						button.removeEventListener("click", activate);
						if (bindings.get(id) === button) bindings.delete(id);
						cleanups.delete(detach);
					};
					cleanups.add(detach);
					return detach;
				}
			}
		])
	);
	const validate = () => {
		for (const id of Object.keys(specifications))
			if (!bindings.get(id) || !root.contains(bindings.get(id))) fail(`missing attached ${id} button inside its root`);
		for (const [id, element] of Object.entries(slots)) if (!root.contains(element)) fail(`missing ${id} outlet inside its root`);
	};
	const factory = workspace.renderer[name];
	root.dataset.supermaxPart = name;
	if (factory === DEFAULT_RENDERER[name]) root.dataset.supermaxDefault = "";
	let handle;
	try {
		handle = factory({ root, state: current, actions, slots, document: workspace.document, ...context }) ?? {};
		if (
			typeof handle !== "object" ||
			typeof handle.then === "function" ||
			["update", "dispose", "paint"].some((key) => handle[key] !== undefined && typeof handle[key] !== "function")
		)
			fail("expected a synchronous lifecycle handle");
		for (const [id, button] of bindings) paintAction(id, button);
		handle.update?.(current);
		validate();
	} catch (error) {
		disposed = true;
		for (const cleanup of [...cleanups]) cleanup();
		if (typeof handle?.dispose === "function") handle.dispose();
		throw error;
	}
	const part = {
		root,
		actions,
		paint(next) {
			if (!disposed) handle.paint?.(next);
		},
		update(next) {
			if (disposed) return;
			try {
				current = snapshot(next);
				for (const [id, button] of bindings) paintAction(id, button);
				handle.update?.(current);
				validate();
			} catch (error) {
				part.dispose();
				throw error;
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const cleanup of [...cleanups]) cleanup();
			handle.dispose?.();
			workspace.renderParts.delete(part);
		}
	};
	workspace.renderParts.add(part);
	return part;
}
