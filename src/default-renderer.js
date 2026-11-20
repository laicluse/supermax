import { chevronIcon, defaultNoticeIcon } from "./icons.js";
import { FoldLabel } from "./fold-label.js";

function node(document, tag, className, text) {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text != null) element.textContent = text;
	return element;
}
function button(document, action, className, text) {
	const element = node(document, "button", className, text);
	action.attach(element);
	return element;
}
function navigation(document, action) {
	const element = button(document, action, "supermax-up");
	const icon = node(document, "span", "supermax-up-label");
	icon.setAttribute("aria-hidden", "true");
	icon.append(chevronIcon(document));
	const label = node(document, "span", "supermax-up-target");
	element.append(icon, label);
	return {
		element,
		update(state) {
			label.textContent = state.navigationText ?? "";
		}
	};
}

const factories = {
	canvas() {},
	cell() {},
	header({ root, document, state, actions, slots }) {
		const leading = node(document, "div", "supermax-cell-title-leading");
		const title = node(document, "span", "supermax-cell-title-text");
		const nav = navigation(document, actions.navigation);
		leading.append(nav.element);
		slots.utilities.className = "supermax-cell-title-trailing";
		root.append(leading, title, slots.utilities);
		return {
			update(next) {
				title.textContent = next.title;
				nav.update(next);
			}
		};
	},
	navigation({ root, document, actions }) {
		const nav = navigation(document, actions.navigation);
		nav.element.classList.add("is-floating");
		root.append(nav.element);
		return { update: nav.update };
	},
	fold({ root, state, document, refresh, axis }) {
		const label = new FoldLabel(document, state.title, axis, refresh);
		root.append(label.element);
		let available;
		return {
			update(next) {
				label.title = next.title;
				available = next.available ?? available;
				if (available !== undefined) label.update(available);
			},
			dispose() {
				label.dispose();
			}
		};
	},
	divider() {},
	reset({ root, document }) {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 16 16");
		svg.setAttribute("aria-hidden", "true");
		const path = document.createElementNS(svg.namespaceURI, "path");
		path.setAttribute("d", "M4 4h5a4 4 0 0 1 0 8H4m3-3-3 3 3 3");
		svg.append(path);
		root.append(svg);
	},
	loading({ root, document }) {
		const mark = node(document, "span", "supermax-loading-mark");
		mark.setAttribute("aria-hidden", "true");
		root.append(mark);
	},
	error({ root, document, actions }) {
		const title = node(document, "strong");
		const detail = node(document, "p", "supermax-error-detail");
		const retry = button(document, actions.retry, "supermax-retry");
		root.append(title, detail, retry);
		return {
			update(state) {
				title.textContent = state.title;
				detail.textContent = state.detail;
				retry.textContent = state.actions.retry.label;
			}
		};
	},
	notice({ root, document, actions }) {
		const icon = node(document, "span", "supermax-notice-icon");
		icon.setAttribute("aria-hidden", "true");
		const text = node(document, "div", "supermax-notice-text");
		const source = node(document, "span", "supermax-notice-source");
		const message = document.createTextNode("");
		text.append(source, message);
		const controls = node(document, "div", "supermax-notice-controls");
		const show = button(document, actions.show, "supermax-notice-go");
		const act = button(document, actions.action, "supermax-notice-action");
		const spinner = node(document, "span", "supermax-notice-spinner");
		spinner.setAttribute("aria-hidden", "true");
		controls.append(show, act, spinner);
		const dismiss = button(document, actions.dismiss, "supermax-notice-dismiss", "×");
		root.append(icon, text, controls, dismiss);
		return {
			update(state) {
				source.textContent = state.sourceLabel ?? "";
				message.textContent = (state.sourceLabel ? " " : "") + state.message;
				show.textContent = state.actions.show.label;
				act.textContent = state.actions.action.label;
				spinner.hidden = !state.busy;
				if (state.busy) controls.setAttribute("aria-busy", "true");
				else controls.removeAttribute("aria-busy");
				const glyph = defaultNoticeIcon(state.kind, document);
				icon.replaceChildren(...(glyph ? [glyph] : []));
			}
		};
	},
	modal({ root, document, actions, slots, dragHandle }) {
		const header = node(document, "header", "supermax-modal-header");
		const title = node(document, "strong", "supermax-modal-title");
		slots.utilities.className = "supermax-modal-controls";
		const close = button(document, actions.close, "supermax-modal-close", "×");
		header.append(title, slots.utilities, close);
		root.append(header, slots.body);
		dragHandle(header);
		return {
			update(state) {
				title.textContent = state.title;
				title.id = state.titleId;
				root.setAttribute("aria-labelledby", state.titleId);
			}
		};
	},
	backdrop() {},
	noticeBackdrop() {},
	veil() {},
	frustum({ root, document, side, geometry, defs, id }) {
		const colours = { top: [0.04, 0.13], right: [0.1, 0.08], bottom: [0.13, 0.04], left: [0.08, 0.1] };
		const [light, dark] = colours[side];
		const gradient = document.createElementNS(root.namespaceURI, "linearGradient");
		gradient.id = id;
		gradient.setAttribute("class", "supermax-frustum-fade is-" + side);
		gradient.setAttribute("gradientUnits", "userSpaceOnUse");
		for (const offset of [0, 1]) {
			const stop = document.createElementNS(root.namespaceURI, "stop");
			stop.setAttribute("offset", String(offset));
			stop.setAttribute("class", offset === 0 ? "supermax-frustum-near" : "supermax-frustum-far");
			const delta = offset === 0 ? 0.05 : -0.05;
			stop.style.setProperty("stop-color", `light-dark(rgb(0 0 0 / ${Math.max(0, light + delta)}), rgb(255 255 255 / ${Math.max(0, dark + delta)}))`);
			gradient.append(stop);
		}
		defs.append(gradient);
		root.setAttribute("fill", `url(#${id})`);
		root.setAttribute("stroke", "none");
		return {
			paint(next) {
				for (const [key, value] of Object.entries(next.gradient)) gradient.setAttribute(key, String(value));
			},
			dispose() {
				gradient.remove();
			}
		};
	}
};

export const DEFAULT_RENDERER = Object.freeze(
	Object.fromEntries(
		Object.entries(factories).map(([name, factory]) => [
			name,
			(context) => {
				context.root.dataset.supermaxDefault = "";
				return factory(context);
			}
		])
	)
);
