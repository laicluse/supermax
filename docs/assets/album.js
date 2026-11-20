import { LAYOUT_SCHEMA, layoutOf } from "./supermax/layout-declaration.js";

export const minViewportHeight = 360;

const widths = {
	albums: { min: 200, max: 320, preferred: 200, keep: true, compact: { min: 48 } },
	album: { min: 300, max: "*", preferred: 1600 },
	selector: { min: 200, max: "*", preferred: 360 },
	map: { min: 220, max: "*", preferred: 480 },
	photo: { min: 240, max: "*", preferred: 360, zoomable: true },
	metadata: { min: 200, max: 320, preferred: 220 },
	history: { min: 200, max: 320 },
	edit: { min: 200, max: 320 },
	depth: { min: 160, max: 240 },
	full: { min: 320, max: "*", preferred: 900, height: "full" },
};

export const depthCount = 20;
export const depthId = (n) => `depth:${n}`;

export const edits = [
	{ n: 1, title: "Exposure +1", note: "Lifted the shadows after the import." },
	{ n: 2, title: "Crop 3:2", note: "Straightened the horizon and cropped the left edge." },
	{ n: 3, title: "Warm tint", note: "Nudged the white balance toward the evening light." },
];

export const albums = [
	{
		id: "coast",
		title: "Coast",
		rows: [
			{ key: "thumbnails", title: "Thumbnails", minHeight: 180, maxHeight: "*", preferredHeight: 240 },
			{ key: "map", title: "Map", minHeight: 180, maxHeight: 520, preferredHeight: 200 },
			{ key: "people", title: "People", minHeight: 180, maxHeight: 520, preferredHeight: 200 },
		],
		photos: [
			{ id: "a", title: "Photo A", date: "Apr 12, 2023", place: "Big Sur, CA", tags: "landscape, coast, cliffs", hue: 205 },
			{ id: "b", title: "Photo B", date: "Jun 3, 2023", place: "Monterey, CA", tags: "rocks, waves, fog", hue: 190 },
			{ id: "c", title: "Photo C", date: "May 3, 2023", place: "Point Reyes, CA", tags: "lighthouse, sunset, coast", hue: 25 },
			{ id: "d", title: "Photo D", date: "Jul 19, 2023", place: "Mendocino, CA", tags: "dunes, grass, wind", hue: 90 },
		],
	},
	{
		id: "empty",
		title: "Empty album",
		rows: [
			{ key: "thumbnails", title: "Thumbnails", minHeight: 180, maxHeight: "*", preferredHeight: 240 },
			{ key: "map", title: "Map", minHeight: 180, maxHeight: 520 },
		],
		photos: [],
	},
	{
		id: "lab-fit",
		title: "Lab: exact fit",
		rows: [
			{ key: "thumbnails", title: "Gallery", minHeight: 316, maxHeight: "*", preferredHeight: 400 },
			{ key: "map", title: "Notes", minHeight: 180, maxHeight: 520 },
		],
		photos: [{ id: "x", title: "Photo X", date: "Jan 1, 2024", place: "Lab", tags: "fixture", hue: 300 }],
	},
];

export function ids(album) {
	return {
		album: `album:${album.id}`,
		row: (key) => `${album.id}:${key}`,
		photo: (photo) => `${album.id}:photo:${photo.id}`,
		metadata: (photo) => `${album.id}:metadata:${photo.id}`,
		history: (photo) => `${album.id}:history:${photo.id}`,
		edit: (photo, edit) => `${album.id}:edit:${photo.id}:${edit.n}`,
		full: (photo) => `${album.id}:full:${photo.id}`,
	};
}

export function paths(album) {
	const key = ids(album);
	const albumPath = `albums/${key.album}`;
	const row = (rowKey) => `${albumPath}/${key.row(rowKey)}`;
	const photo = (rowKey, photoId) => `${row(rowKey)}/${key.photo({ id: photoId })}`;
	const metadata = (rowKey, photoId) => `${photo(rowKey, photoId)}/${key.metadata({ id: photoId })}`;
	const history = (rowKey, photoId) => `${metadata(rowKey, photoId)}/${key.history({ id: photoId })}`;
	const edit = (rowKey, photoId, n) => `${history(rowKey, photoId)}/${key.edit({ id: photoId }, { n })}`;
	const full = (rowKey, photoId) => `${photo(rowKey, photoId)}/${key.full({ id: photoId })}`;
	return { album: albumPath, row, photo, metadata, history, edit, full };
}

export const remoteLayouts = new Set(["photo", "metadata", "history", "edit"]);
export const remoteContent = new Set(["metadata", "history", "edit"]);

const catalogs = new Map();

export function destinations(context = "ana") {
	if (catalogs.has(context)) return catalogs.get(context);
	const result = { albums: { title: "Albums", ...widths.albums, data: { kind: "albums" } } };
	for (let n = 1; n <= depthCount; n += 1) {
		result[depthId(n)] = { title: `Depth ${n}`, ...widths.depth, data: { kind: "depth", n } };
	}
	for (const album of albums) {
		const key = ids(album);
		result[key.album] = {
			title: album.title,
			...widths.album,
			rows: album.rows.map(({ key: rowKey, title, ...bounds }) => ({ destination: key.row(rowKey), ...bounds })),
			data: { kind: "album", album },
		};
		for (const row of album.rows) {
			result[key.row(row.key)] = {
				title: row.title,
				...(row.key === "map" ? widths.map : widths.selector),
				defaultChild: album.photos.length ? key.photo(album.photos[0]) : null,
				data: { kind: "selector", album, row },
			};
		}
		for (const photo of album.photos) {
			result[key.photo(photo)] = { title: photo.title, ...widths.photo, defaultChild: key.metadata(photo), data: { kind: "photo", album, photo } };
			result[key.metadata(photo)] = { title: `Metadata ${photo.id.toUpperCase()}`, ...widths.metadata, defaultChild: context === "ben" ? null : key.history(photo), data: { kind: "metadata", album, photo } };
			result[key.history(photo)] = { title: `History ${photo.id.toUpperCase()}`, ...widths.history, data: { kind: "history", album, photo } };
			result[key.full(photo)] = { title: `${photo.title} at full height`, ...widths.full, data: { kind: "full", album, photo } };
			for (const edit of edits) {
				result[key.edit(photo, edit)] = { title: `${edit.title} (${photo.id.toUpperCase()})`, ...widths.edit, data: { kind: "edit", album, photo, edit } };
			}
		}
	}
	catalogs.set(context, result);
	return result;
}

export function closureOf(roots, context = "ana") {
	const catalog = destinations(context);
	const reached = new Set();
	const visit = (id) => {
		if (reached.has(id) || !catalog[id]) return;
		reached.add(id);
		if (catalog[id].defaultChild) visit(catalog[id].defaultChild);
		for (const row of catalog[id].rows ?? []) visit(row.destination);
	};
	roots.forEach(visit);
	return [...reached];
}

export function declarationSet(root, context = "ana") {
	const catalog = destinations(context);
	return {
		schemaVersion: LAYOUT_SCHEMA,
		context,
		root,
		destinations: Object.fromEntries(closureOf([root], context).map((id) => [id, declare(catalog[id])])),
	};
}

function declare(definition) {
	const { keep, compact, rows, ...layout } = layoutOf(definition);
	return { ...layout, ...(keep ? { keep } : {}), ...(compact ? { compact } : {}), ...(rows ? { rows: rows.map(({ keep: rowKeep, preferredHeight, ...row }) => ({ ...row, ...(preferredHeight !== null ? { preferredHeight } : {}), ...(rowKeep ? { keep: rowKeep } : {}) })) } : {}) };
}

export function embeddedDestinations(context = "ana") {
	const catalog = destinations(context);
	const local = Object.keys(catalog).filter((id) => !remoteLayouts.has(catalog[id].data.kind));
	return Object.fromEntries(closureOf(local, context).map((id) => [id, catalog[id]]));
}
