import { Navigator, SLIDE_PRESENTATION, Workspace } from "./supermax/index.js";
import { albums, depthCount, depthId, edits, hintFor, ids, localDestinations, minViewportHeight, paths, remoteKinds } from "./album.js";
import { decodeLog, encodeLog } from "./deeplink.js";
import { foldPresentation } from "./presentation-fold.js";

const presentations = { slide: SLIDE_PRESENTATION, fold: foldPresentation };

const coast = paths(albums[0]);
const open = (destination, from, hint = null) => (hint ? { type: "open", destination, from, hint } : { type: "open", destination, from });
const depthPath = (n) => ["albums", ...Array.from({ length: n }, (_, index) => depthId(index + 1))].join("/");
const twentyDeep = Array.from({ length: depthCount }, (_, index) => open(depthId(index + 1), depthPath(index)));

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
		actions: [open("album:coast", "albums"), open("coast:metadata:a", coast.photo("thumbnails", "a"), hintFor("coast:metadata:a"))],
	},
	{
		label: "Slow metadata, then a failing history",
		network: { delay: "1500", fail: "" },
		actions: [open("album:coast", "albums"), open("coast:photo:c", coast.row("people"))],
	},
	{
		label: "Replace Photo A by B in one row",
		actions: [open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails")), open("coast:photo:b", coast.row("thumbnails"))],
	},
	{
		label: "Long chain: history and one edit",
		actions: [open("album:coast", "albums"), open("coast:history:a", coast.metadata("thumbnails", "a"), { title: "History A" }), open("coast:edit:a:2", coast.history("thumbnails", "a"), hintFor("coast:edit:a:2"))],
	},
	{
		label: "Collapse photo and history in that chain",
		actions: [open("album:coast", "albums"), open("coast:history:a", coast.metadata("thumbnails", "a"), { title: "History A" }), open("coast:edit:a:2", coast.history("thumbnails", "a"), hintFor("coast:edit:a:2"))],
		local: (frame) => [coast.photo("thumbnails", "a"), coast.history("thumbnails", "a")].forEach((id) => frame.workspace.navigator.collapse(id, true)),
	},
	{
		label: "Preferred sizes: photo wide, metadata narrow",
		actions: [open("album:coast", "albums"), open("coast:photo:b", coast.row("map"))],
	},
	{
		label: "Caption modal from the Map row",
		actions: [open("album:coast", "albums"), open("coast:photo:b", coast.row("map"))],
		local: (frame) => { if (frame.key === "a") frame.workspace.element.querySelector(`[data-occurrence="${coast.photo("map", "b")}"] .caption-edit`)?.click(); },
	},
	{
		label: "Notices: saved, failed save, export",
		actions: [open("album:coast", "albums")],
		local: (frame) => {
			if (frame.key !== "a") return;
			const model = frame.workspace.navigator;
			const album = albums[0];
			const photoA = album.photos[0];
			session.saveCaption(model.get(coast.photo("thumbnails", "a")), photoA, ids(album).photo(photoA));
			session.controls.fail.value = "content";
			session.saveCaption(model.get(coast.photo("people", "a")), photoA, ids(album).photo(photoA));
			session.controls.fail.value = "";
			session.exportAlbum(model.get(coast.metadata("thumbnails", "a")), album);
		},
	},
	{ label: "Empty album", actions: [open(ids(albums[1]).album, "albums")] },
	{ label: "Twenty cells deep", actions: twentyDeep },
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
	depth: renderDepth,
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
	const kind = definition.data?.kind;
	if (remoteKinds.has(kind)) {
		return { pending: session.fetchContent(occurrence.destination).then((content) => renderers[kind](occurrence, definition.data, workspace, content)) };
	}
	return renderers[kind](occurrence, definition.data, workspace);
}

function prefetchOnHover(button, id) {
	let timer = null;
	button.addEventListener("pointerenter", () => { timer = setTimeout(() => session.fetchManifest(id), 100); });
	button.addEventListener("pointerleave", () => clearTimeout(timer));
}

function renderDepth(occurrence, data, workspace) {
	const host = element("div", "depth");
	host.append(element("p", "depth-number", String(data.n)));
	if (data.n < depthCount) {
		const next = element("button", "metadata-link depth-next", `Open depth ${data.n + 1}`);
		next.type = "button";
		next.addEventListener("click", () => workspace.navigate(depthId(data.n + 1), { from: occurrence.id }));
		host.append(next);
	} else {
		host.append(element("p", "depth-end", "The end of the chain."));
	}
	return { element: host };
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
	const lab = element("li", "album-lab");
	const depth = element("button", "album-item depth-start", "Lab: twenty cells deep");
	depth.type = "button";
	depth.dataset.destination = depthId(1);
	depth.addEventListener("click", () => workspace.navigate(depthId(1), { from: occurrence.id }));
	lab.append(depth);
	list.append(lab);
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
	link.addEventListener("click", () => workspace.navigate(key.metadata(photo), { from: occurrence.id, hint: hintFor(key.metadata(photo)) }));
	prefetchOnHover(link, key.metadata(photo));
	const editCaption = element("button", "metadata-link caption-edit", "Edit caption");
	editCaption.type = "button";
	editCaption.addEventListener("click", () => workspace.openModal({
		title: `Caption for ${photo.title}`,
		content: (modal, host) => ({ pending: session.fetchContent(key.photo(photo)).then((content) => renderCaptionEditor(modal, host, { photo, caption, content })) }),
	}, { from: occurrence.id }));
	const save = element("button", "metadata-link caption-save", "Save");
	save.type = "button";
	save.addEventListener("click", () => session.saveCaption(occurrence, photo, key.photo(photo)));
	const actions = element("div", "photo-actions");
	actions.append(caption, link, editCaption, save);
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

function renderCaptionEditor(modal, workspace, { photo, caption, content }) {
	const host = element("form", "caption-editor");
	host.append(element("p", "viewer-line", `Editing as ${content.viewer}`));
	const field = element("textarea", "caption caption-editor-field");
	field.rows = 4;
	field.value = caption.value;
	field.setAttribute("aria-label", `Caption for ${photo.title}`);
	const actions = element("div", "caption-editor-actions");
	const save = element("button", "metadata-link is-primary", "Save caption");
	save.type = "submit";
	const cancel = element("button", "metadata-link", "Cancel");
	cancel.type = "button";
	cancel.addEventListener("click", () => workspace.closeModal("cancel"));
	actions.append(save, cancel);
	host.append(field, actions);
	host.addEventListener("submit", (event) => {
		event.preventDefault();
		caption.value = field.value;
		workspace.closeModal("saved");
	});
	return { element: host };
}

function renderMetadata(occurrence, data, workspace, content) {
	const { album, photo } = data;
	const key = ids(album);
	const host = element("div", "metadata");
	host.append(element("p", "viewer-line", `Viewing as ${content.viewer}`));
	const list = element("dl");
	for (const [term, value] of [["Date", photo.date], ["Place", photo.place], ["Tags", photo.tags], ["Album", album.title]]) {
		list.append(element("dt", null, term), element("dd", null, value));
	}
	host.append(list);
	const link = element("button", "metadata-link", "Edit history");
	link.type = "button";
	link.addEventListener("click", () => workspace.navigate(key.history(photo), { from: occurrence.id, hint: { title: `History ${photo.id.toUpperCase()}` } }));
	const exportButton = element("button", "metadata-link album-export", "Export album");
	exportButton.type = "button";
	exportButton.addEventListener("click", () => session.exportAlbum(occurrence, album));
	host.append(element("div", "metadata-actions"), link, exportButton);
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
		button.addEventListener("click", () => workspace.navigate(key.edit(photo, edit), { from: occurrence.id, hint: hintFor(key.edit(photo, edit)) }));
		prefetchOnHover(button, key.edit(photo, edit));
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

function renderEdit(occurrence, data, workspace, content) {
	const { edit, photo } = data;
	const host = element("div", "edit");
	host.append(element("p", "viewer-line", `Viewing as ${content.viewer}`), element("h4", null, edit.title), element("p", null, edit.note));
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
		this.requests = [];
		this.inflight = new Map();
		this.replaying = null;
		this.serial = 0;
		this.controls = {
			delay: document.querySelector("[data-delay]"),
			fail: document.querySelector("[data-fail]"),
			context: document.querySelector("[data-context]"),
			requests: document.querySelector("[data-requests]"),
			presentation: document.querySelector("[data-presentation]"),
		};
		this.controls.context.addEventListener("change", () => this.setContext(this.controls.context.value));
		this.controls.presentation.addEventListener("change", () => this.setPresentation(this.controls.presentation.value));
		this.frames = frames.map((frame) => this.buildFrame(frame));
		this.presentations = presentations;
		const requested = new URLSearchParams(location.search).get("presentation");
		if (requested && presentations[requested]) this.setPresentation(requested);
		window.addEventListener("popstate", (event) => this.arrive(event.state));
		this.arrive(history.state);
	}

	get context() {
		return this.controls.context.value;
	}

	get pending() {
		return this.inflight.size + (this.replaying ? 1 : 0);
	}

	apiUrl(kind, id) {
		const params = new URLSearchParams({ context: this.context });
		if (Number(this.controls.delay.value) > 0) params.set("delay", this.controls.delay.value);
		if (this.controls.fail.value) params.set("fail", this.controls.fail.value);
		return `/api/${kind}/${encodeURIComponent(id)}?${params}`;
	}

	request(kind, id) {
		const context = this.context;
		const key = `${kind}|${context}|${id}`;
		if (this.inflight.has(key)) return this.inflight.get(key);
		const url = this.apiUrl(kind, id);
		this.requests.push({ kind, id, context, url });
		this.controls.requests.textContent = `${this.requests.length} request${this.requests.length === 1 ? "" : "s"}, last: ${kind} ${id}`;
		const promise = fetch(url)
			.then(async (response) => {
				if (!response.ok) throw new Error(`${kind} for ${id} answered ${response.status}`);
				const payload = await response.json();
				if (this.context !== context) throw new Error(`${kind} for ${id} arrived for viewer ${context}, now viewing as ${this.context}`);
				return payload;
			})
			.finally(() => { if (this.inflight.get(key) === promise) this.inflight.delete(key); });
		this.inflight.set(key, promise);
		return promise;
	}

	fetchManifest(id) {
		if (this.frames.every((frame) => frame.workspace.navigator.destination(id) && !frame.workspace.navigator.destination(id).provisional)) return Promise.resolve(null);
		return this.request("manifest", id).then((manifest) => {
			for (const frame of this.frames) frame.workspace.define(id, manifest);
			this.completeDefaults();
			this.record("replace");
			return manifest;
		}, () => null);
	}

	fetchContent(id) {
		return this.request("content", id);
	}

	notifyAll(notice) {
		for (const frame of this.frames) frame.workspace.notify(notice);
	}

	async saveCaption(occurrence, photo, photoId, serial = (this.serial += 1)) {
		const base = { id: `save:${occurrence.id}:${serial}`, scope: "cell", source: occurrence.id, sourceTitle: photo.title };
		try {
			const response = await fetch(`${this.apiUrl("content", photoId)}&save=${serial}`);
			if (!response.ok) throw new Error(`answered ${response.status}`);
			this.notifyAll({ ...base, kind: "success", message: "Caption saved" });
		} catch (error) {
			this.notifyAll({ ...base, kind: "error", message: `Saving the caption failed (${error.message})`, action: { label: "Retry", run: () => this.saveCaption(occurrence, photo, photoId) } });
		}
	}

	exportAlbum(occurrence, album) {
		const serial = (this.serial += 1);
		this.notifyAll({
			id: `export:${album.id}:${serial}`,
			scope: "workspace",
			source: occurrence.id,
			sourceTitle: occurrence.title,
			kind: "action",
			message: `Export of ${album.title} is ready`,
			action: { label: "Download", run: (workspace) => workspace.notify({ scope: "workspace", kind: "success", message: `Downloaded ${album.title}.zip` }) },
		});
	}

	completeDefaults() {
		const waits = [];
		for (const frame of this.frames) {
			const model = frame.workspace.navigator;
			for (const occurrence of model.occurrences.values()) {
				const definition = model.destination(occurrence.destination);
				if (definition?.provisional) waits.push(this.fetchManifest(occurrence.destination));
				else if (definition?.defaultChild && !model.destination(definition.defaultChild) && !occurrence.children[0]) waits.push(this.fetchManifest(definition.defaultChild));
			}
		}
		return waits;
	}

	async settleDefaults() {
		for (let round = 0; round < 12; round += 1) {
			const waits = this.completeDefaults();
			if (waits.length === 0) return;
			await Promise.all(waits);
		}
	}

	setContext(context) {
		this.controls.context.value = context;
		this.inflight.clear();
		const remote = new Set();
		for (const frame of this.frames) {
			const workspace = frame.workspace;
			const model = workspace.navigator;
			const open = new Set([...model.occurrences.values()].map((occurrence) => occurrence.destination));
			for (const [id, definition] of Object.entries(model.destinations)) {
				if (remoteKinds.has(definition.data?.kind) && !open.has(id)) delete model.destinations[id];
			}
			for (const [occurrenceId, entry] of workspace.cells) {
				const occurrence = model.get(occurrenceId);
				const definition = occurrence && model.destination(occurrence.destination);
				if (!definition || !remoteKinds.has(definition.data?.kind)) continue;
				remote.add(occurrence.destination);
				workspace.mountContent(entry, occurrence);
			}
			workspace.modal?.retry();
		}
		for (const id of remote) {
			this.request("manifest", id).then((manifest) => { for (const frame of this.frames) frame.workspace.define(id, manifest); }, () => null);
		}
		this.completeDefaults();
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
		const definitions = localDestinations();
		definitions.albums.compact = { min: 48, content: renderAlbumIcons };
		const model = new Navigator({ destinations: definitions, root: "albums", minViewportHeight });
		const workspace = new Workspace(root, { navigator: model, content: renderContent, onIntent: (action, origin) => this.dispatch(action, origin) });
		workspace.addEventListener("change", () => this.completeDefaults());
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
		this.replaying = null;
		const results = this.frames.map((frame) => frame.workspace.apply(action, { focus: frame.workspace === origin }));
		const originResult = results[this.frames.findIndex((frame) => frame.workspace === origin)];
		if (results.some((result) => result.ok && !result.noop)) {
			this.log.push(action);
			this.record("push");
		}
		this.completeDefaults();
		return originResult;
	}

	record(mode) {
		if (this.replaying) return;
		const state = { log: this.log, snapshots: this.frames.map((frame) => frame.workspace.navigator.snapshot()) };
		const url = this.log.length ? `#${encodeLog(this.log)}` : location.pathname + location.search;
		history[`${mode}State`](state, "", url);
	}

	arrive(state) {
		if (state?.snapshots && this.frames.every((frame, index) => frame.workspace.restore(state.snapshots[index]))) {
			this.replaying = null;
			this.log = state.log;
			return;
		}
		this.replay(decodeLog(location.hash), { mode: "replace" });
	}

	async replay(log, { mode = "push" } = {}) {
		const token = Symbol("replay");
		this.replaying = token;
		for (const frame of this.frames) {
			frame.workspace.closeModal("reset");
			for (const id of [...frame.workspace.notices.keys()]) frame.workspace.dismiss(id);
			frame.workspace.replay([]);
		}
		const kept = [];
		for (const action of log) {
			await this.settleDefaults();
			if (this.replaying !== token) return;
			const results = this.frames.map((frame) => frame.workspace.apply(action, { animate: false }));
			if (results.some((result) => result.ok && !result.noop)) kept.push(action);
		}
		await this.settleDefaults();
		if (this.replaying !== token) return;
		this.replaying = null;
		this.log = kept;
		const unchanged = encodeLog(this.log) === location.hash.replace(/^#/, "");
		this.record(mode === "push" && unchanged ? "replace" : mode);
	}

	setPresentation(name) {
		this.controls.presentation.value = name;
		for (const frame of this.frames) frame.workspace.setPresentation(presentations[name] ?? SLIDE_PRESENTATION);
	}

	setNetwork({ delay, fail }) {
		if (delay !== undefined) this.controls.delay.value = delay;
		if (fail !== undefined) this.controls.fail.value = fail;
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
		case "unknown-destination": return `Rejected: ${action.destination} is not a destination here.`;
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
	button.addEventListener("click", async () => {
		session.setNetwork(scenario.network ?? { delay: "0", fail: "" });
		await session.replay(scenario.actions.map((action) => ({ ...action })));
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
