import { Navigator, Workspace } from "./supermax/index.js";
import { albums, destinations, edits, ids, minViewportHeight, paths } from "./album.js";
import { decodeLog, encodeLog } from "./deeplink.js";

const definitions = destinations();
const coast = paths(albums[0]);
definitions.albums.compact = { min: 48, content: renderAlbumIcons };

const frames = [
	{ key: "a", name: "Frame A", width: 960, height: 640 },
	{ key: "b", name: "Frame B", width: 420, height: 640 },
];

const sizePresets = [
	{ label: "Wide and narrow", sizes: [[960, 640], [420, 640]] },
	{ label: "Both wide", sizes: [[960, 640], [960, 640]] },
	{ label: "Short frame B", sizes: [[960, 640], [420, 400]] },
	{ label: "Below minimum B", sizes: [[960, 640], [420, 300]] },
];

const open = (destination, from) => ({ type: "open", destination, from });
const scenarios = [
	{ label: "Open the Coast album", actions: [open("album:coast", "albums")] },
	{
		label: "Three rows: A, B, C",
		actions: [open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails")), open("coast:photo:b", coast.row("map")), open("coast:photo:c", coast.row("people"))],
	},
	{
		label: "Three rows: A, C, B",
		actions: [open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails")), open("coast:photo:c", coast.row("people")), open("coast:photo:b", coast.row("map"))],
	},
	{
		label: "Click metadata that is already open",
		actions: [open("album:coast", "albums"), open("coast:metadata:a", coast.photo("thumbnails", "a"))],
	},
	{
		label: "Replace Photo A by B in one row",
		actions: [open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails")), open("coast:photo:b", coast.row("thumbnails"))],
	},
	{
		label: "Long chain: history and one edit",
		actions: [open("album:coast", "albums"), open("coast:history:a", coast.metadata("thumbnails", "a")), open("coast:edit:a:2", coast.history("thumbnails", "a"))],
	},
	{
		label: "Collapse photo and history in that chain",
		actions: [open("album:coast", "albums"), open("coast:history:a", coast.metadata("thumbnails", "a")), open("coast:edit:a:2", coast.history("thumbnails", "a"))],
		local: (frame) => [coast.photo("thumbnails", "a"), coast.history("thumbnails", "a")].forEach((id) => frame.workspace.navigator.collapse(id, true)),
	},
	{
		label: "Preferred sizes: photo wide, metadata narrow",
		actions: [open("album:coast", "albums"), open("coast:photo:b", coast.row("map"))],
	},
	{ label: "Empty album", actions: [open(ids(albums[1]).album, "albums")] },
	{ label: "Lab: exact fit", actions: [open(ids(albums[2]).album, "albums")] },
	{ label: "Lab: one pixel over", actions: [open(ids(albums[3]).album, "albums")] },
];

function element(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
}

const renderers = {
	albums: renderAlbums,
	selector: renderSelector,
	photo: renderPhoto,
	metadata: renderMetadata,
	history: renderHistory,
	edit: renderEdit,
};

function renderAlbumIcons(occurrence, workspace) {
	const rail = element("div", "supermax-compact-icons album-icons");
	for (const album of albums) {
		const button = element("button", "album-icon", album.title.slice(0, 1));
		button.type = "button";
		button.setAttribute("aria-label", `Open ${album.title}`);
		button.dataset.destination = ids(album).album;
		button.addEventListener("click", () => workspace.navigate(ids(album).album, { from: occurrence.id }));
		rail.append(button);
	}
	return rail;
}

function renderContent(occurrence, definition, workspace) {
	return renderers[definition.data.kind](occurrence, definition.data, workspace);
}

function renderAlbums(occurrence, data, workspace) {
	const list = element("ul", "album-list");
	const notes = new Map();
	for (const album of albums) {
		const item = element("li");
		const button = element("button", "album-item", album.title);
		button.type = "button";
		button.dataset.destination = ids(album).album;
		button.addEventListener("click", () => workspace.navigate(ids(album).album, { from: occurrence.id }));
		const note = element("p", "album-note");
		note.hidden = true;
		notes.set(ids(album).album, note);
		item.append(button, note);
		list.append(item);
	}
	const onRejected = (event) => {
		const { action, result } = event.detail;
		const note = notes.get(action.destination);
		if (!note || result.reason !== "invalid-rows") return;
		note.hidden = false;
		note.textContent = "This album needs a taller window than the app supports. Pick another album.";
	};
	const onChange = (event) => {
		if (event.detail.result.ok) for (const note of notes.values()) note.hidden = true;
	};
	workspace.addEventListener("rejected", onRejected);
	workspace.addEventListener("change", onChange);
	return {
		element: list,
		update(current) {
			const selected = workspace.navigator.child(current)?.destination ?? null;
			for (const button of list.querySelectorAll(".album-item")) {
				button.setAttribute("aria-current", button.dataset.destination === selected ? "true" : "false");
			}
		},
		dispose() {
			workspace.removeEventListener("rejected", onRejected);
			workspace.removeEventListener("change", onChange);
		},
	};
}

const selectorShapes = {
	thumbnails: {
		host: () => element("div", "thumb-grid"),
		button: (photo) => ({ className: "thumb", label: photo.title }),
	},
	map: {
		host: () => element("div", "map"),
		button: (photo, index) => ({ className: "pin", label: `${photo.title} at ${photo.place}`, style: { left: `${18 + index * 22}%`, top: `${30 + (index % 2) * 30}%` } }),
	},
	people: {
		host: () => element("div", "people"),
		button: (photo, index) => ({ className: "avatar", label: `Person ${index + 1} in ${photo.title}`, text: String.fromCharCode(65 + index) }),
	},
};

function renderSelector(occurrence, data, workspace) {
	const { album, row } = data;
	const key = ids(album);
	const host = element("div", `selector selector-${row.key}`);
	if (album.photos.length === 0) {
		host.append(element("p", "empty-state", "No photos in this album."));
		return { element: host };
	}
	const shape = selectorShapes[row.key];
	const container = shape.host();
	const buttons = album.photos.map((photo, index) => {
		const spec = shape.button(photo, index);
		const button = element("button", spec.className, spec.text);
		button.type = "button";
		button.style.setProperty("--hue", String(photo.hue));
		button.setAttribute("aria-label", spec.label);
		button.dataset.destination = key.photo(photo);
		button.addEventListener("click", () => workspace.navigate(key.photo(photo), { from: occurrence.id }));
		Object.assign(button.style, spec.style ?? {});
		container.append(button);
		return button;
	});
	host.append(container);
	return {
		element: host,
		update(current) {
			const selected = workspace.navigator.child(current)?.destination ?? null;
			for (const button of buttons) button.setAttribute("aria-pressed", button.dataset.destination === selected ? "true" : "false");
		},
	};
}

function renderPhoto(occurrence, data, workspace) {
	const { album, photo } = data;
	const key = ids(album);
	const host = element("div", "photo");
	const picture = element("div", "picture", photo.title);
	picture.style.setProperty("--hue", String(photo.hue));
	const caption = element("textarea", "caption");
	caption.placeholder = "Caption draft";
	caption.setAttribute("aria-label", `Caption draft for ${photo.title}`);
	caption.rows = 2;
	const link = element("button", "metadata-link", "Metadata");
	link.type = "button";
	link.addEventListener("click", () => workspace.navigate(key.metadata(photo), { from: occurrence.id }));
	const actions = element("div", "photo-actions");
	actions.append(caption, link);
	host.append(picture, actions);
	return {
		element: host,
		update(current) {
			const child = workspace.navigator.child(current);
			const auto = !!child && workspace.navigator.isAuto(child);
			link.setAttribute("aria-current", child ? "true" : "false");
			link.setAttribute("aria-label", auto ? "Metadata, opened automatically" : "Metadata");
			link.textContent = auto ? "Metadata (auto)" : "Metadata";
		},
	};
}

function renderMetadata(occurrence, data, workspace) {
	const { album, photo } = data;
	const key = ids(album);
	const host = element("div", "metadata");
	const list = element("dl");
	for (const [term, value] of [["Date", photo.date], ["Place", photo.place], ["Tags", photo.tags], ["Album", album.title]]) {
		list.append(element("dt", null, term), element("dd", null, value));
	}
	host.append(list);
	const link = element("button", "metadata-link", "Edit history");
	link.type = "button";
	link.addEventListener("click", () => workspace.navigate(key.history(photo), { from: occurrence.id }));
	host.append(link);
	const notes = element("ol", "history");
	for (let index = 1; index <= 24; index += 1) notes.append(element("li", null, `Note ${index}: adjusted exposure by ${(index % 5) - 2} stops`));
	host.append(element("h4", null, "Notes"), notes);
	return {
		element: host,
		update(current) {
			link.setAttribute("aria-current", workspace.navigator.child(current) ? "true" : "false");
		},
	};
}

function renderHistory(occurrence, data, workspace) {
	const { album, photo } = data;
	const key = ids(album);
	const host = element("ol", "edit-list");
	const buttons = edits.map((edit) => {
		const item = element("li");
		const button = element("button", "edit-item", edit.title);
		button.type = "button";
		button.dataset.destination = key.edit(photo, edit);
		button.addEventListener("click", () => workspace.navigate(key.edit(photo, edit), { from: occurrence.id }));
		item.append(button);
		host.append(item);
		return button;
	});
	return {
		element: host,
		update(current) {
			const selected = workspace.navigator.child(current)?.destination ?? null;
			for (const button of buttons) button.setAttribute("aria-current", button.dataset.destination === selected ? "true" : "false");
		},
	};
}

function renderEdit(occurrence, data) {
	const { edit, photo } = data;
	const host = element("div", "edit");
	host.append(element("h4", null, edit.title), element("p", null, edit.note));
	const note = element("textarea", "caption");
	note.rows = 2;
	note.placeholder = "Reviewer note";
	note.setAttribute("aria-label", `Reviewer note for ${edit.title} of ${photo.title}`);
	host.append(note);
	return { element: host };
}

class Session {
	constructor() {
		this.log = [];
		this.frames = frames.map((frame) => this.buildFrame(frame));
		window.addEventListener("popstate", (event) => this.arrive(event.state));
		this.arrive(history.state);
	}

	buildFrame(frame) {
		const wrapper = element("div", "frame-wrapper");
		const box = element("div", "frame");
		box.dataset.frame = frame.key;
		box.style.width = `${frame.width}px`;
		box.style.height = `${frame.height}px`;
		const root = element("div", "frame-workspace");
		box.append(root);
		const readout = element("div", "readout");
		const size = element("span", "readout-size");
		const limit = element("span", "readout-limit", `below the supported minimum of ${minViewportHeight}px`);
		limit.hidden = true;
		const rejection = element("span", "readout-rejection");
		rejection.hidden = true;
		readout.append(element("strong", null, frame.name), size, limit, rejection);
		wrapper.append(box, readout);
		document.querySelector("[data-frames]").append(wrapper);
		const model = new Navigator({ destinations: definitions, root: "albums", minViewportHeight });
		const workspace = new Workspace(root, { navigator: model, content: renderContent, onIntent: (action, origin) => this.dispatch(action, origin) });
		workspace.addEventListener("rejected", (event) => {
			rejection.hidden = false;
			rejection.textContent = describeRejection(event.detail, model);
		});
		workspace.addEventListener("change", (event) => {
			if (event.detail.result.ok) rejection.hidden = true;
		});
		workspace.addEventListener("render", (event) => {
			const { layout } = event.detail;
			size.textContent = `${layout.width} × ${layout.height} px`;
			limit.hidden = !layout.belowMinimum;
		});
		return { ...frame, box, workspace };
	}

	dispatch(action, origin) {
		const results = this.frames.map((frame) => frame.workspace.apply(action, { focus: frame.workspace === origin }));
		const originResult = results[this.frames.findIndex((frame) => frame.workspace === origin)];
		if (results.some((result) => result.ok && !result.noop)) {
			this.log.push(action);
			this.record("push");
		}
		return originResult;
	}

	record(mode) {
		const state = { log: this.log, snapshots: this.frames.map((frame) => frame.workspace.navigator.snapshot()) };
		const url = this.log.length ? `#${encodeLog(this.log)}` : location.pathname + location.search;
		history[`${mode}State`](state, "", url);
	}

	arrive(state) {
		if (state?.snapshots && this.frames.every((frame, index) => frame.workspace.restore(state.snapshots[index]))) {
			this.log = state.log;
			return;
		}
		this.replay(decodeLog(location.hash), { mode: "replace" });
	}

	replay(log, { mode = "push" } = {}) {
		const results = this.frames.map((frame) => frame.workspace.replay(log));
		this.log = log.filter((action, index) => results.some((frameResults) => frameResults[index].ok && !frameResults[index].noop));
		const unchanged = encodeLog(this.log) === location.hash.replace(/^#/, "");
		this.record(mode === "push" && unchanged ? "replace" : mode);
	}

	reset() {
		this.replay([]);
	}

	resize(sizes) {
		this.frames.forEach((frame, index) => {
			frame.box.style.width = `${sizes[index][0]}px`;
			frame.box.style.height = `${sizes[index][1]}px`;
		});
	}
}

function describeRejection({ action, result }, model) {
	const titleOf = (path) => {
		const id = (path ?? "").split("/").pop();
		return model.destination(id)?.title ?? id;
	};
	switch (result.reason) {
		case "source-closed": return `Rejected here: ${titleOf(action.from)} is closed in this frame.`;
		case "split-source": return `Rejected: ${titleOf(action.from)} owns its rows; nothing opens next to them.`;
		case "unknown-destination": return `Rejected: ${action.destination} is not a destination.`;
		case "invalid-rows": {
			const row = result.validation.rows.find((candidate) => !candidate.ok);
			if (!row) return `Rejected: ${result.validation.reason.replace(/-/g, " ")}.`;
			if (!row.problems.includes("exceeds-supported-height")) return `Rejected: row ${row.title} has ${row.problems.join(", ").replace(/-/g, " ")}.`;
			return `Rejected: row ${row.title} needs ${row.required}px (${row.chrome}px chrome), supported ${row.supported}px.`;
		}
		case "history-empty": return "Nothing left to close.";
		default: return `Rejected: ${result.reason}`;
	}
}

const session = new Session();
window.supermaxDemo = session;

const scenarioHost = document.querySelector("[data-scenarios]");
for (const scenario of scenarios) {
	const button = element("button", "scenario", scenario.label);
	button.type = "button";
	button.addEventListener("click", () => {
		session.replay(scenario.actions.map((action) => ({ ...action })));
		if (scenario.local) session.frames.forEach((frame) => { scenario.local(frame); frame.workspace.render({ animate: false }); });
	});
	scenarioHost.append(button);
}
const presetHost = document.querySelector("[data-size-presets]");
for (const preset of sizePresets) {
	const button = element("button", "scenario", preset.label);
	button.type = "button";
	button.addEventListener("click", () => session.resize(preset.sizes));
	presetHost.append(button);
}
document.querySelector("[data-reset]").addEventListener("click", () => {
	session.reset();
	session.resize(sizePresets[0].sizes);
});
