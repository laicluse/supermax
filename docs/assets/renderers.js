import { Navigator, Workspace } from "./supermax/index.js";

function node(document, tag, text, className) {
	const element = document.createElement(tag);
	if (text) element.textContent = text;
	if (className) element.className = className;
	return element;
}
function action(document, descriptor, label) {
	const button = node(document, "button", label, "paper-button");
	descriptor.attach(button);
	return button;
}
const paper = {
	canvas({ root }) {
		root.classList.add("paper-canvas");
	},
	cell({ root }) {
		root.classList.add("paper-material");
	},
	header({ root, state, actions, slots, document }) {
		root.classList.add("paper-header");
		const back = action(document, actions.navigation, "←");
		const title = node(document, "span", state.title, "paper-title");
		slots.utilities.className = "paper-utilities";
		root.append(back, title, slots.utilities);
		return {
			update(next) {
				title.textContent = next.title;
			}
		};
	},
	navigation({ root, actions, document }) {
		root.append(action(document, actions.navigation, "←"));
		root.classList.add("paper-floating");
	},
	fold({ root, state, document }) {
		root.classList.add("paper-fold");
		const label = node(document, "span", state.title, "paper-fold-label");
		root.append(label);
		return {
			update(next) {
				label.textContent = next.title;
			}
		};
	},
	divider({ root }) {
		root.classList.add("paper-divider");
	},
	reset({ root }) {
		root.classList.add("paper-reset");
		root.textContent = "↶";
	},
	loading({ root, document }) {
		root.classList.add("paper-loading");
		for (let count = 0; count < 3; count++) root.append(node(document, "span"));
	},
	error({ root, state, actions, document }) {
		root.classList.add("paper-error");
		const title = node(document, "strong", state.title);
		const detail = node(document, "p", state.detail);
		root.append(title, detail, action(document, actions.retry, "Try again"));
		return {
			update(next) {
				title.textContent = next.title;
				detail.textContent = next.detail;
			}
		};
	},
	notice({ root, state, actions, document }) {
		root.classList.add("paper-notice");
		const text = node(document, "p");
		const show = action(document, actions.show, "Return");
		const run = action(document, actions.action, "Save");
		const dismiss = action(document, actions.dismiss, "×");
		root.append(text, show, run, dismiss);
		return {
			update(next) {
				text.textContent = (next.sourceLabel ? next.sourceLabel + " " : "") + next.message + (next.busy ? " …" : "");
				run.textContent = next.actions.action.label;
			}
		};
	},
	modal({ root, state, actions, slots, document, dragHandle }) {
		root.classList.add("paper-modal");
		const header = node(document, "header", null, "paper-modal-header");
		const title = node(document, "strong", state.title);
		header.append(title, slots.utilities, action(document, actions.close, "×"));
		root.append(header, slots.body);
		dragHandle(header);
		return {
			update(next) {
				title.textContent = next.title;
			}
		};
	},
	backdrop({ root }) {
		root.classList.add("paper-backdrop");
	},
	noticeBackdrop({ root }) {
		root.classList.add("paper-notice-backdrop");
	},
	veil({ root }) {
		root.classList.add("paper-veil");
	},
	frustum({ root, defs, id, document }) {
		const gradient = document.createElementNS(root.namespaceURI, "linearGradient");
		gradient.id = id;
		gradient.setAttribute("gradientUnits", "userSpaceOnUse");
		for (const [offset, colour] of [
			["0", "#1b716f88"],
			["1", "#d9b97311"]
		]) {
			const stop = document.createElementNS(root.namespaceURI, "stop");
			stop.setAttribute("offset", offset);
			stop.setAttribute("stop-color", colour);
			gradient.append(stop);
		}
		defs.append(gradient);
		root.setAttribute("fill", `url(#${id})`);
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

const instances = [];
for (const frame of document.querySelectorAll(".example-frame")) {
	let fail = false;
	const navigator = new Navigator({
		root: "menu",
		minViewportHeight: 240,
		chrome: { header: 34 },
		destinations: {
			menu: { title: "Library", min: 82, max: 82, overflow: { mode: "keep" } },
			notebook: {
				title: "Coastal notebook",
				header: "title",
				rows: [
					{ destination: "outline", minHeight: 100, maxHeight: 170 },
					{ destination: "draft", minHeight: 180, maxHeight: "*", preferredHeight: 300 }
				]
			},
			outline: { title: "Outline", min: 220, max: "*", preferred: 350 },
			draft: { title: "Draft", min: 220, max: "*", preferred: 350 },
			source: { title: "Field observation", min: 240, max: "*", preferred: 360, header: "title", placement: "beside-split", zoomable: true }
		}
	});
	const workspace = new Workspace(frame.querySelector(".workspace"), {
		navigator,
		overlayRoot: frame,
		renderer: frame.dataset.style === "paper" ? paper : {},
		content(occurrence) {
			if (occurrence.destination === "source" && fail) {
				fail = false;
				throw Error("The source could not be reached.");
			}
			const element = node(document, "div", null, occurrence.destination === "menu" ? "demo-menu" : "demo-content");
			if (occurrence.destination === "menu") {
				element.append(node(document, "span", "≋"), node(document, "p", "NOTES"), node(document, "span", "▤"), node(document, "p", "SOURCES"));
			}
			if (occurrence.destination === "outline") {
				const list = node(document, "ol");
				for (const item of ["Morning light", "Shoreline textures", "Field observations"]) list.append(node(document, "li", item));
				element.append(node(document, "h3", "Along the coast"), list);
			}
			if (occurrence.destination === "draft") {
				const input = node(document, "textarea");
				input.value = "The wind left a fine pattern in the sand. Keep this note while opening its source.";
				input.setAttribute("aria-label", "Draft");
				element.append(node(document, "h3", "Today’s draft"), input);
			}
			if (occurrence.destination === "source") {
				element.append(
					node(document, "h3", "Morning at the shore"),
					node(
						document,
						"p",
						"Small changes in the tide reveal another edge. This source opens beside the notebook’s rows, while the draft stays open."
					)
				);
			}
			return { element };
		}
	});
	workspace.sync(["menu", "notebook"], { animate: false, origin: null });
	instances.push({
		workspace,
		fail() {
			fail = true;
		}
	});
}
for (const button of document.querySelectorAll("[data-action]"))
	button.addEventListener("click", () => {
		for (const instance of instances) {
			const workspace = instance.workspace;
			const from = "menu/notebook/draft";
			switch (button.dataset.action) {
				case "back":
					workspace.sync(["menu", "notebook"], { origin: button });
					break;
				case "source":
					workspace.navigate("source", { from, origin: button });
					break;
				case "failure":
					workspace.navigate("source", { from, origin: button });
					instance.fail();
					workspace.reload((occurrence) => occurrence.destination === "source");
					break;
				case "notice":
					workspace.notify({
						id: "saved",
						source: from,
						kind: "action",
						message: "Notebook ready to save.",
						action: { label: "Save", run: () => new Promise((resolve) => setTimeout(resolve, 800)) }
					});
					break;
				case "modal":
					workspace.openModal(
						{
							title: "Notebook settings",
							preferred: 330,
							content() {
								const element = node(document, "div", null, "demo-content");
								element.append(
									node(document, "h3", "A quiet place to write"),
									node(
										document,
										"p",
										"The host chooses the frame and controls. Supermax keeps the dialog’s movement and its connection to the notebook."
									)
								);
								return { element };
							}
						},
						{ from }
					);
					break;
			}
		}
	});
window.rendererDemo = { instances };
