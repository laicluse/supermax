export const minViewportHeight = 300;

export const chrome = { navbar: 40, maxRows: 4 };

export const destinations = {
	root: { title: "Root", min: 100, max: 100 },
	gallery: {
		title: "Gallery",
		min: 300,
		max: 1000,
		rows: [
			{ destination: "list", minHeight: 100, maxHeight: 200 },
			{ destination: "grid", minHeight: 100, maxHeight: 200 },
			{ destination: "tags", minHeight: 100, maxHeight: 200 },
		],
	},
	list: { title: "List", min: 100, max: 150, defaultChild: "item:a" },
	grid: { title: "Grid", min: 100, max: 150, defaultChild: "item:a" },
	tags: { title: "Tags", min: 100, max: 150, defaultChild: "item:a" },
	"item:a": { title: "Item A", min: 100, max: 200, defaultChild: "detail:a" },
	"item:b": { title: "Item B", min: 100, max: 200, defaultChild: "detail:b" },
	"item:c": { title: "Item C", min: 100, max: 200, defaultChild: "detail:c" },
	"detail:a": { title: "Detail A", min: 150, max: 200, defaultChild: "notes:a" },
	"detail:b": { title: "Detail B", min: 150, max: 200 },
	"detail:c": { title: "Detail C", min: 150, max: 200 },
	"notes:a": { title: "Notes A", min: 100, max: 200 },
	fit: { title: "Fit", min: 300, max: 1000, rows: [{ destination: "list", minHeight: 260, maxHeight: 300 }, { destination: "grid", minHeight: 100, maxHeight: 200 }] },
	upside: { title: "Upside", min: 300, max: 200 },
	"item:nested": { title: "Nested item", min: 100, max: 200, defaultChild: "inner" },
	inner: { title: "Inner", min: 200, max: 1000, rows: [{ destination: "list", minHeight: 100, maxHeight: 300 }, { destination: "grid", minHeight: 100, maxHeight: 200 }] },
};

export const invalidSplits = {
	over: { title: "Over", min: 300, max: 1000, rows: [{ destination: "list", minHeight: 261, maxHeight: 300 }, { destination: "grid", minHeight: 100, maxHeight: 200 }] },
	empty: { title: "Empty", min: 300, max: 1000, rows: [] },
	twins: { title: "Twins", min: 300, max: 1000, rows: [{ destination: "list", minHeight: 100, maxHeight: 200 }, { destination: "list", minHeight: 100, maxHeight: 200 }] },
	crowd: { title: "Crowd", min: 300, max: 1000, rows: ["list", "grid", "tags", "item:a", "item:b"].map((destination) => ({ destination, minHeight: 50, maxHeight: 100 })) },
	conflict: { title: "Conflict", min: 300, max: 1000, rows: [{ destination: "upside", minHeight: 200, maxHeight: 100 }] },
	outer: { title: "Outer", min: 300, max: 1000, rows: [{ destination: "empty", minHeight: 100, maxHeight: 200 }] },
};


export const GALLERY = "root/gallery";
export const row = (key) => `${GALLERY}/${key}`;
export const item = (key, id) => `${row(key)}/item:${id}`;
export const detail = (key, id) => `${item(key, id)}/detail:${id}`;
