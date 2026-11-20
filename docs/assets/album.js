export const minViewportHeight = 360;

const widths = {
	albums: { min: 200, max: 320 },
	album: { min: 320, max: 1600 },
	selector: { min: 200, max: 360 },
	map: { min: 220, max: 480 },
	photo: { min: 240, max: 520 },
	metadata: { min: 200, max: 320 },
};

export const albums = [
	{
		id: "coast",
		title: "Coast",
		rows: [
			{ key: "thumbnails", title: "Thumbnails", minHeight: 180, maxHeight: 520 },
			{ key: "map", title: "Map", minHeight: 180, maxHeight: 520 },
			{ key: "people", title: "People", minHeight: 180, maxHeight: 520 },
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
			{ key: "thumbnails", title: "Thumbnails", minHeight: 180, maxHeight: 520 },
			{ key: "map", title: "Map", minHeight: 180, maxHeight: 520 },
		],
		photos: [],
	},
	{
		id: "lab-fit",
		title: "Lab: exact fit",
		rows: [
			{ key: "thumbnails", title: "Gallery", minHeight: 284, maxHeight: 600 },
			{ key: "map", title: "Notes", minHeight: 180, maxHeight: 520 },
		],
		photos: [{ id: "x", title: "Photo X", date: "Jan 1, 2024", place: "Lab", tags: "fixture", hue: 300 }],
	},
	{
		id: "lab-over",
		title: "Lab: one pixel over",
		rows: [
			{ key: "thumbnails", title: "Gallery", minHeight: 285, maxHeight: 600 },
			{ key: "map", title: "Notes", minHeight: 180, maxHeight: 520 },
		],
		photos: [{ id: "y", title: "Photo Y", date: "Jan 2, 2024", place: "Lab", tags: "fixture", hue: 330 }],
	},
];

export function ids(album) {
	return {
		album: `album:${album.id}`,
		row: (key) => `${album.id}:${key}`,
		photo: (photo) => `${album.id}:photo:${photo.id}`,
		metadata: (photo) => `${album.id}:metadata:${photo.id}`,
	};
}

export function paths(album) {
	const key = ids(album);
	const albumPath = `albums/${key.album}`;
	const row = (rowKey) => `${albumPath}/${key.row(rowKey)}`;
	const photo = (rowKey, photoId) => `${row(rowKey)}/${key.photo({ id: photoId })}`;
	const metadata = (rowKey, photoId) => `${photo(rowKey, photoId)}/${key.metadata({ id: photoId })}`;
	return { album: albumPath, row, photo, metadata };
}

export function destinations() {
	const result = { albums: { title: "Albums", ...widths.albums, data: { kind: "albums" } } };
	for (const album of albums) {
		const key = ids(album);
		result[key.album] = {
			title: album.title,
			...widths.album,
			rows: album.rows.map((row) => ({ destination: key.row(row.key), minHeight: row.minHeight, maxHeight: row.maxHeight })),
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
			result[key.metadata(photo)] = { title: `Metadata ${photo.id.toUpperCase()}`, ...widths.metadata, data: { kind: "metadata", album, photo } };
		}
	}
	return result;
}
