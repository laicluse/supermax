import { Navigator, ORIGAMI_PRESENTATION, TimeScale, VEIL_PRESENTATION, Workspace, layoutHashOf, readLayout } from "./supermax/index.js";
import { albums, depthCount, depthId, destinations, edits, embeddedDestinations, ids, minViewportHeight, paths, remoteContent } from "./album.js";
import { appendAction, decodeLog, encodeLog } from "./deeplink.js";
import { foldPresentation } from "./presentation-fold.js";
import { serve } from "./api.js";

const presentations = { origami: ORIGAMI_PRESENTATION, veil: VEIL_PRESENTATION, fold: foldPresentation };

// The demo's own waits, in milliseconds at time scale 1.
const DEMO_TIMING = Object.freeze({ hover: 100, waiting: 700, network: { least: 100, spread: 600, quick: 400, slow: 1500 } });

const coast = paths(albums[0]);
const folding = paths(albums.find((album) => album.id === "folding"));
const open = (destination, from) => ({ type: "open", destination, from });
const depthPath = (n) => ["albums", ...Array.from({ length: n }, (_, index) => depthId(index + 1))].join("/");
const twentyDeep = Array.from({ length: depthCount }, (_, index) => open(depthId(index + 1), depthPath(index)));
const longChain = [
	open("album:coast", "albums"),
	open("coast:photo:a", coast.row("thumbnails")),
	open("coast:metadata:a", coast.photo("thumbnails", "a")),
	open("coast:history:a", coast.metadata("thumbnails", "a")),
	open("coast:edit:a:2", coast.history("thumbnails", "a")),
];

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

const foldReservation = (size) => (frame) => {
	for (const [id, definition] of Object.entries(frame.workspace.navigator.destinations)) {
		if (id === "album:folding") definition.rows.forEach((row) => { row.fold = { size }; });
		else if (id.startsWith("folding:")) definition.fold = { size };
	}
};

const scenarios = [
	{ label: "Folding: cells and rows", folding: true, actions: [open("album:folding", "albums"), open("folding:photo:x", folding.row("thumbnails"))], sizes: [[960, 640], [420, 360]], network: { delay: "0", fail: "" }, presentation: "veil", local: foldReservation(0) },
	{ label: "Folding: 8px reserved on both axes", folding: true, actions: [open("album:folding", "albums"), open("folding:photo:x", folding.row("thumbnails"))], sizes: [[960, 640], [420, 360]], network: { delay: "0", fail: "" }, presentation: "veil", local: foldReservation(8) },
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
		label: "Slow layout metadata, failing content",
		network: { delay: String(DEMO_TIMING.network.slow), fail: "content" },
		actions: [open("album:coast", "albums"), open("coast:photo:c", coast.row("people"))],
	},
	{
		label: "Replace Photo A by B in one row",
		actions: [open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails")), open("coast:photo:b", coast.row("thumbnails"))],
	},
	{
		label: "Long chain: history and one edit",
		actions: longChain,
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
	full: renderFull,
	metadata: renderMetadata,
	history: renderHistory,
	edit: renderEdit,
};

function renderAlbumIcons(occurrence, workspace) {
	const rail = element("div", "album-icons");
	for (const album of albums) {
		const button = element("button", "album-icon", album.title.slice(0, 1));
		button.type = "button";
		button.setAttribute("aria-label", `Open ${album.title}`);
		button.dataset.destination = ids(album).album;
		button.addEventListener("click", () => workspace.navigate(ids(album).album, { from: occurrence.id, origin: button }));
		rail.append(button);
	}
	const lab = element("button", "album-icon album-icon-lab", "20");
	lab.type = "button";
	lab.setAttribute("aria-label", "Open the twenty cells lab");
	lab.dataset.destination = depthId(1);
	lab.addEventListener("click", () => workspace.navigate(depthId(1), { from: occurrence.id, origin: lab }));
	rail.append(lab);
	return rail;
}

function renderContent(occurrence, definition, workspace) {
	const { data } = destinations(session.context)[occurrence.destination];
	const kind = data.kind;
	const withSpec = (handle) => {
		handle.element?.append(renderSpec(occurrence, definition));
		return handle;
	};
	if (remoteContent.has(kind)) {
		return session.fetchContent(occurrence.destination).then((content) => withSpec(renderers[kind](occurrence, data, workspace, content)));
	}
	return withSpec(renderers[kind](occurrence, data, workspace));
}

function renderSpec(occurrence, definition) {
	const spec = element("dl", "cell-spec");
	spec.dataset.specFor = occurrence.id;
	spec.setAttribute("aria-hidden", "true");
	const line = (term, value) => {
		if (value == null) return;
		spec.append(element("dt", null, term), element("dd", null, String(value)));
	};
	line("id", occurrence.destination);
	line("min", definition.min);
	line("max", definition.max);
	line("preferred", definition.preferred);
	line("keep", definition.keep ? "yes" : null);
	line("compact", definition.compact?.min);
	line("defaultChild", definition.defaultChild);
	spec.append(element("dt", null, "width"), element("dd", "cell-spec-width", "…"));
	spec.append(element("dt", null, "state"), element("dd", "cell-spec-state", "…"));
	return spec;
}

const specFit = new ResizeObserver((entries) => {
	for (const entry of entries) fitSpec(entry.target.querySelector(":scope > * > .cell-spec"));
});

function fitSpec(spec) {
	if (!spec) return;
	const body = spec.closest(".supermax-cell-body");
	if (!body) return;
	spec.hidden = false;
	if (body.scrollHeight > body.clientHeight || body.scrollWidth > body.clientWidth) spec.hidden = true;
}

function updateSpecs(root, layout) {
	for (const spec of root.querySelectorAll(".cell-spec")) {
		const cell = layout.cells.get(spec.dataset.specFor);
		if (!cell) continue;
		const state = cell.compact ? "compact" : cell.visible ? (cell.sized ? "dragged" : "allocated") : "hidden";
		spec.querySelector(".cell-spec-width").textContent = `${Math.round(cell.width)} px`;
		spec.querySelector(".cell-spec-state").textContent = state;
		const body = spec.closest(".supermax-cell-body");
		if (body) specFit.observe(body);
		requestAnimationFrame(() => fitSpec(spec));
	}
}

function renderDepth(occurrence, data, workspace) {
	const host = element("div", "depth");
	host.append(element("p", "depth-number", String(data.n)));
	if (data.n < depthCount) {
		const next = element("button", "metadata-link depth-next", `Open depth ${data.n + 1}`);
		next.type = "button";
		next.addEventListener("click", () => workspace.navigate(depthId(data.n + 1), { from: occurrence.id, origin: next }));
		host.append(next);
	} else {
		host.append(element("p", "depth-end", "The end of the chain."));
	}
	return { element: host };
}

function renderAlbums(occurrence, data, workspace) {
	const list = element("ul", "album-list");
	for (const album of albums) {
		const item = element("li");
		const button = element("button", "album-item", album.title);
		button.type = "button";
		button.dataset.destination = ids(album).album;
		button.addEventListener("click", () => workspace.navigate(ids(album).album, { from: occurrence.id, origin: button }));
		item.append(button);
		list.append(item);
	}
	const lab = element("li", "album-lab");
	const depth = element("button", "album-item depth-start", "Lab: twenty cells deep");
	depth.type = "button";
	depth.dataset.destination = depthId(1);
	depth.addEventListener("click", () => workspace.navigate(depthId(1), { from: occurrence.id, origin: depth }));
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
		button.addEventListener("click", () => workspace.navigate(key.photo(photo), { from: occurrence.id, origin: button }));
		Object.assign(button.style, spec.style ?? {});
		container.append(button);
		return button;
	});
	if (row.key === "people") host.append(element("span", "selector-label", "People"));
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
	caption.rows = 1;
	const link = element("button", "metadata-link", "Metadata");
	link.type = "button";
	link.dataset.destination = key.metadata(photo);
	link.addEventListener("click", () => workspace.navigate(key.metadata(photo), { from: occurrence.id, origin: link }));
	const editCaption = element("button", "metadata-link caption-edit", "Edit caption");
	editCaption.type = "button";
	editCaption.addEventListener("click", () => workspace.openModal({
		title: `Caption for ${photo.title}`,
		preferredHeight: 295,
		content: (modal, host) => session.fetchContent(key.photo(photo)).then((content) => renderCaptionEditor(modal, host, { photo, caption, content })),
	}, { from: occurrence.id }));
	const save = element("button", "metadata-link caption-save", "Save");
	save.type = "button";
	save.addEventListener("click", () => session.saveCaption(occurrence, photo, key.photo(photo)));
	const full = element("button", "metadata-link full-link", "Full height");
	full.type = "button";
	full.dataset.destination = key.full(photo);
	full.addEventListener("click", () => workspace.navigate(key.full(photo), { from: occurrence.id, origin: full }));
	const actions = element("div", "photo-actions");
	actions.append(caption, link, editCaption, save, full);
	const zoom = element("button", "zoom-toggle", "⤢");
	zoom.type = "button";
	zoom.addEventListener("click", () => workspace.zoom(workspace.navigator.zoomed === occurrence.id ? null : occurrence.id));
	picture.append(zoom);
	host.append(picture, actions);
	return {
		element: host,
		update(current) {
			const zoomed = workspace.navigator.zoomed === current?.id;
			zoom.setAttribute("aria-pressed", String(zoomed));
			zoom.setAttribute("aria-label", zoomed ? `Zoom out of ${photo.title}` : `Zoom into ${photo.title}`);
			const child = workspace.navigator.child(current);
			const auto = !!child && workspace.navigator.isAuto(child);
			link.setAttribute("aria-current", child ? "true" : "false");
			link.setAttribute("aria-label", auto ? "Metadata, opened automatically" : "Metadata");
			link.textContent = auto ? "Metadata (auto)" : "Metadata";
		},
	};
}

function renderFull(occurrence, data) {
	const { photo } = data;
	const host = element("div", "photo photo-full");
	const picture = element("div", "picture picture-full", photo.title);
	picture.style.setProperty("--hue", String(photo.hue));
	const note = element("p", "photo-note", `${photo.place}, ${photo.date}. Opened beside the album's rows, at the full height of the workspace.`);
	host.append(picture, note);
	return { element: host };
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
	link.dataset.destination = key.history(photo);
	link.addEventListener("click", () => workspace.navigate(key.history(photo), { from: occurrence.id, origin: link }));
	const exportButton = element("button", "metadata-link album-export", "Export album");
	exportButton.type = "button";
	exportButton.addEventListener("click", () => session.exportAlbum(occurrence, album));
	host.append(link, exportButton);
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
		button.dataset.destination = key.edit(photo, edit);
		button.addEventListener("click", () => workspace.navigate(key.edit(photo, edit), { from: occurrence.id, origin: button }));
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
		this.declarations = [];
		this.failed = new Set();
		this.replaying = null;
		this.serial = 0;
		this.saveNotices = new Map();
		this.frames = [];
		this.controls = {
			delay: document.querySelector("[data-delay]"),
			fail: document.querySelector("[data-fail]"),
			context: document.querySelector("[data-context]"),
			requests: document.querySelector("[data-requests]"),
			presentation: document.querySelector("[data-presentation]"),
			spare: document.querySelector("[data-spare]"),
			speed: document.querySelector("[data-speed]"),
		};
		const query = new URLSearchParams(location.search);
		const reloadWith = (key, value) => {
			const next = new URLSearchParams(location.search);
			next.set(key, value);
			location.search = next.toString();
		};
		if ([...this.controls.context.options].some((option) => option.value === query.get("viewer"))) this.controls.context.value = query.get("viewer");
		this.controls.context.addEventListener("change", () => reloadWith("viewer", this.controls.context.value));
		if ([...this.controls.spare.options].some((option) => option.value === query.get("spare"))) this.controls.spare.value = query.get("spare");
		this.controls.spare.addEventListener("change", () => reloadWith("spare", this.controls.spare.value));
		this.controls.presentation.addEventListener("change", () => this.setPresentation(this.controls.presentation.value));
		if ([...this.controls.speed.options].some((option) => option.value === query.get("speed"))) this.controls.speed.value = query.get("speed");
		this.time = new TimeScale(Number(this.controls.speed.value));
		this.time.addEventListener("change", () => this.paintTime());
		this.paintTime();
		this.controls.speed.addEventListener("change", () => {
			const next = new URL(location.href);
			if (this.controls.speed.value === "1") next.searchParams.delete("speed");
			else next.searchParams.set("speed", this.controls.speed.value);
			history.replaceState(history.state, "", next);
			this.time.set(Number(this.controls.speed.value));
		});
		const { least, spread, quick, slow } = DEMO_TIMING.network;
		this.controls.delay.append(...[["random", `${least} to ${least + spread} ms`], ["0", "none"], [String(quick), `${quick} ms`], [String(slow), `${slow} ms`]].map(([value, label]) => new Option(label, value)));
		if (query.has("delay")) this.controls.delay.value = query.get("delay");
		this.context = this.controls.context.value;
		this.embedded = embeddedDestinations(this.context);
		this.presentations = presentations;
		this.start(query.get("presentation"));
	}

	async start(requested) {
		await this.prepareAll(history.state?.log ?? decodeLog(location.hash));
		this.frames = frames.map((frame) => this.buildFrame(frame));
		if (requested && presentations[requested]) this.setPresentation(requested);
		window.addEventListener("popstate", (event) => this.arrive(event.state, { animate: true }));
		this.arrive(history.state);
	}

	paintTime() {
		this.time.paint(document.documentElement, { times: { waiting: DEMO_TIMING.waiting }, easings: {}, prefix: "demo" });
	}

	get pending() {
		return this.inflight.size + (this.replaying ? 1 : 0);
	}

	network() {
		const chosen = this.controls.delay.value;
		const { least, spread } = DEMO_TIMING.network;
		const delay = chosen === "random" ? Math.round(least + Math.random() * spread) : Number(chosen) || 0;
		return { context: this.context, delay: this.time.ms(delay), fail: this.controls.fail.value };
	}

	request(kind, method, url) {
		if (this.inflight.has(url)) return this.inflight.get(url).then((response) => response.clone());
		this.requests.push({ kind, url });
		this.controls.requests.textContent = `${this.requests.length} request${this.requests.length === 1 ? "" : "s"}, last: ${method} ${kind}`;
		const promise = serve(url, { method, ...this.network() }).then((response) => {
			if (!response.ok) throw new Error(`The server answered ${response.status}.`);
			return response;
		}).finally(() => { if (this.inflight.get(url) === promise) this.inflight.delete(url); });
		this.inflight.set(url, promise);
		return promise.then((response) => response.clone());
	}

	declares(id) {
		return Object.hasOwn(this.embedded, id) || this.declarations.some((set) => Object.hasOwn(set.destinations, id));
	}

	prepare(id) {
		if (this.declares(id)) return Promise.resolve();
		const url = `/supermax/layout?destination=${encodeURIComponent(id)}`;
		const pending = this.inflight.get(`prepare:${url}`);
		if (pending) return pending;
		const promise = this.request("layout", "HEAD", url).then((response) => readLayout(response)).then((set) => {
			if (!this.declares(id)) {
				for (const frame of this.frames) frame.workspace.navigator.register(set);
				this.declarations.push(set);
			}
			this.failed.delete(id);
		}, (error) => {
			this.failed.add(id);
			throw error;
		}).finally(() => this.inflight.delete(`prepare:${url}`));
		this.inflight.set(`prepare:${url}`, promise);
		return promise;
	}

	prepareAll(log) {
		const wanted = [...new Set(log.filter((action) => action.type === "open").map((action) => action.destination))];
		return Promise.allSettled(wanted.map((id) => this.prepare(id)));
	}

	async fetchContent(id) {
		const layout = await layoutHashOf(destinations(this.context)[id]);
		const response = await this.request("content", "GET", `/supermax/content?destination=${encodeURIComponent(id)}&layout=${encodeURIComponent(layout)}`);
		return response.json();
	}

	notifyAll(notice) {
		for (const frame of this.frames) frame.workspace.notify(notice);
	}

	async saveCaption(occurrence, photo, photoId, serial = (this.serial += 1)) {
		const base = { id: `save:${occurrence.id}:${serial}`, scope: "cell", source: occurrence.id, sourceTitle: photo.title };
		const previous = this.saveNotices.get(occurrence.id);
		if (previous) for (const frame of this.frames) frame.workspace.dismiss(previous);
		this.saveNotices.set(occurrence.id, base.id);
		try {
			const layout = await layoutHashOf(destinations(this.context)[photoId]);
			const response = await serve(`/supermax/content?destination=${encodeURIComponent(photoId)}&layout=${encodeURIComponent(layout)}`, this.network());
			if (!response.ok) throw new Error(`The server answered ${response.status}.`);
			this.notifyAll({ ...base, kind: "success", message: "Caption saved" });
		} catch (error) {
			this.notifyAll({ ...base, kind: "error", message: `Saving the caption failed. ${error.message}`, action: { label: "Retry", run: () => this.saveCaption(occurrence, photo, photoId) } });
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
		const model = new Navigator({ destinations: this.embedded, root: "albums", minViewportHeight, spareSpace: this.controls.spare.value, context: this.context });
		for (const set of this.declarations) model.register(set);
		let hover = null;
		const wanted = (id) => id && !this.declares(id) && !this.failed.has(id);
		root.addEventListener("pointerover", (event) => {
			const id = event.target.closest?.("[data-destination]")?.dataset.destination;
			clearTimeout(hover);
			if (wanted(id)) hover = setTimeout(() => { if (wanted(id)) this.prepare(id).catch(() => null); }, this.time.ms(DEMO_TIMING.hover));
		});
		root.addEventListener("pointerdown", () => clearTimeout(hover));
		const workspace = new Workspace(root, { navigator: model, content: renderContent, compactContent: renderAlbumIcons, overlayRoot: box, time: this.time, onIntent: (action, origin) => this.dispatch(action, origin) });
		workspace.addEventListener("up", () => this.record("push"));
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
			updateSpecs(root, layout);
		});
		return { ...frame, box, workspace };
	}

	dispatch(action, origin) {
		this.replaying = null;
		this.intents = (this.intents ?? 0) + 1;
		if (action.type === "open" && !this.declares(action.destination)) return this.dispatchWhenPrepared(action, origin, this.intents);
		const originResult = origin.apply(action);
		const results = [originResult, ...this.frames.filter((frame) => frame.workspace !== origin).map((frame) => this.follow(frame.workspace, action, origin, originResult))];
		if (results.some((result) => result.ok && !result.noop)) {
			const { origin: source, ...logged } = action;
			this.log = results.every((result) => result.ok) ? appendAction(this.log, logged) : [...this.log, logged];
			this.record("push");
		}
		return originResult;
	}

	dispatchWhenPrepared(action, origin, intent) {
		const source = origin.element.querySelector(`[data-occurrence="${CSS.escape(action.from)}"]`);
		const control = source?.querySelector(`[data-destination="${CSS.escape(action.destination)}"]`) ?? null;
		control?.classList.add("is-pending");
		control?.setAttribute("aria-busy", "true");
		const departures = this.frames.map(({ workspace }) => {
			const replaced = workspace.navigator.child(workspace.navigator.get(action.from));
			return replaced ? workspace.depart(replaced.id, { origin: action.origin }) : null;
		});
		this.prepare(action.destination).then(() => {
			if (this.intents === intent && origin.navigator.get(action.from)) this.dispatch(action, origin);
		}, (error) => {
			if (this.intents !== intent) return;
			departures.forEach((departure) => departure?.cancel());
			const name = control?.getAttribute("aria-label") || control?.textContent.trim() || action.destination;
			const from = origin.navigator.get(action.from)?.title;
			origin.notify({ id: `prepare:${action.from}:${action.destination}`, scope: "workspace", kind: "error", message: `Could not open ${name}${from ? ` from ${from}` : ""}. ${error.message}`, action: { label: "Retry", run: () => this.dispatch(action, origin) } });
		}).finally(() => {
			control?.classList.remove("is-pending");
			control?.removeAttribute("aria-busy");
		});
		return { ok: false, reason: "pending", destination: action.destination };
	}

	follow(workspace, action, origin, originResult) {
		if (action.type !== "open" || !originResult.ok || !originResult.occurrence) return workspace.apply(action);
		const path = [];
		for (let current = originResult.occurrence; current?.parent; current = origin.navigator.get(current.parent)) path.unshift(current);
		for (const step of path.slice(0, -1)) {
			if (!workspace.navigator.get(step.id)) workspace.run({ type: "open", destination: step.destination, from: step.parent });
		}
		const existing = workspace.navigator.get(originResult.occurrence.id);
		if (existing && !originResult.noop && !originResult.promoted) workspace.navigator.closeSubtree(existing);
		return workspace.apply(action);
	}

	record(mode) {
		if (this.replaying) return;
		const state = { log: this.log, snapshots: this.frames.map((frame) => frame.workspace.navigator.snapshot()) };
		const url = this.log.length ? `#${encodeLog(this.log)}` : location.pathname + location.search;
		history[`${mode}State`](state, "", url);
	}

	async arrive(state, { animate = false } = {}) {
		await this.prepareAll(state?.log ?? decodeLog(location.hash));
		if (state?.snapshots && this.frames.every((frame, index) => frame.workspace.restore(state.snapshots[index], { animate }))) {
			this.replaying = null;
			this.log = state.log;
			return;
		}
		this.replay(decodeLog(location.hash), { mode: "replace" });
	}

	async replay(log, { mode = "push" } = {}) {
		const token = Symbol("replay");
		this.replaying = token;
		await this.prepareAll(log);
		if (this.replaying !== token) return;
		for (const frame of this.frames) {
			frame.workspace.closeModal("reset");
			frame.workspace.dismissAll();
		}
		const perFrame = this.frames.map((frame) => frame.workspace.replay(log));
		this.log = [];
		log.forEach((action, index) => {
			const results = perFrame.map((results) => results[index]);
			if (results.some((result) => result.ok && !result.noop)) this.log = results.every((result) => result.ok) ? appendAction(this.log, action) : [...this.log, action];
		});
		this.replaying = null;
		const unchanged = encodeLog(this.log) === location.hash.replace(/^#/, "");
		this.record(mode === "push" && unchanged ? "replace" : mode);
	}

	setPresentation(name) {
		this.controls.presentation.value = name;
		for (const frame of this.frames) frame.workspace.setPresentation(presentations[name] ?? ORIGAMI_PRESENTATION);
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
		return model.definitionOf(id)?.title ?? id;
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
		for (const choice of scenarioHost.querySelectorAll(".scenario")) choice.setAttribute("aria-pressed", String(choice === button));
		session.setNetwork(scenario.network ?? { delay: new URLSearchParams(location.search).get("delay") ?? "random", fail: "" });
		await session.replay(scenario.actions.map((action) => ({ ...action })));
		for (const frame of session.frames) frame.box.classList.toggle("is-folding-scenario", !!scenario.folding);
		if (scenario.sizes) session.resize(scenario.sizes);
		if (scenario.presentation) session.setPresentation(scenario.presentation);
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
	for (const choice of scenarioHost.querySelectorAll(".scenario")) choice.setAttribute("aria-pressed", "false");
	for (const frame of session.frames) frame.box.classList.remove("is-folding-scenario");
	session.resize(sizePresets[0].sizes);
});
