export const minViewportHeight = 300;

export const chrome = { maxRows: 4 };

export const destinations = {
	root: { title: "Root", min: 100, max: 100 },
	canvas: { title: "Canvas", min: 100, max: "*", preferred: 100 },
	gallery: {
		title: "Gallery",
		header: "title",
		rows: [
			{ destination: "list", minHeight: 100, maxHeight: "*", preferredHeight: 200 },
			{ destination: "grid", minHeight: 100, maxHeight: 200 },
			{ destination: "tags", minHeight: 100, maxHeight: 200 },
		],
	},
	list: { title: "List", min: 100, max: 150, defaultChild: "item:a" },
	grid: { title: "Grid", header: "title", min: 100, max: 150, defaultChild: "item:a" },
	tags: { title: "Tags", min: 100, max: 150, defaultChild: "item:a" },
	"item:a": { title: "Item A", min: 100, max: 200, defaultChild: "detail:a" },
	"item:b": { title: "Item B", min: 100, max: 200, defaultChild: "detail:b" },
	"item:c": { title: "Item C", min: 100, max: 200, defaultChild: "detail:c" },
	"detail:a": { title: "Detail A", min: 150, max: 200, defaultChild: "notes:a" },
	"detail:b": { title: "Detail B", min: 150, max: 200 },
	"detail:c": { title: "Detail C", min: 150, max: 200 },
	"notes:a": { title: "Notes A", min: 100, max: 200 },
	fit: { title: "Fit", header: "title", rows: [{ destination: "list", minHeight: 272, maxHeight: "*", preferredHeight: 300 }, { destination: "grid", minHeight: 100, maxHeight: 200 }] },
	upside: { title: "Upside", min: 300, max: 200 },
	"item:nested": { title: "Nested item", min: 100, max: 200, defaultChild: "inner" },
	inner: { title: "Inner", rows: [{ destination: "list", minHeight: 100, maxHeight: "*", preferredHeight: 300 }, { destination: "grid", minHeight: 100, maxHeight: 200 }] },
};

for (const definition of Object.values(destinations)) {
	if (definition.rows) definition.rows.forEach((row) => { row.fold ??= false; });
	else definition.fold ??= false;
}

export const invalidSplits = {
	over: { title: "Over", header: "title", rows: [{ destination: "list", minHeight: 273, maxHeight: "*", preferredHeight: 300 }, { destination: "grid", minHeight: 100, maxHeight: 200 }] },
	empty: { title: "Empty", rows: [] },
	twins: { title: "Twins", rows: [{ destination: "list", minHeight: 100, maxHeight: "*", preferredHeight: 200 }, { destination: "list", minHeight: 100, maxHeight: 200 }] },
	crowd: { title: "Crowd", rows: ["list", "grid", "tags", "item:a", "item:b"].map((destination) => ({ destination, minHeight: 50, maxHeight: 100 })) },
	conflict: { title: "Conflict", rows: [{ destination: "upside", minHeight: 200, maxHeight: 100 }] },
	outer: { title: "Outer", rows: [{ destination: "empty", minHeight: 100, maxHeight: "*", preferredHeight: 200 }] },
	rigid: { title: "Rigid", rows: [{ destination: "list", minHeight: 100, maxHeight: 200 }, { destination: "grid", minHeight: 100, maxHeight: 200 }] },
	doubled: { title: "Doubled", rows: [{ destination: "list", minHeight: 100, maxHeight: "*", preferredHeight: 200 }, { destination: "grid", minHeight: 100, maxHeight: "*", preferredHeight: 200 }] },
	unpreferred: { title: "Unpreferred", rows: [{ destination: "list", minHeight: 100, maxHeight: "*" }] },
};


export const GALLERY = "root/gallery";
export const row = (key) => `${GALLERY}/${key}`;
export const item = (key, id) => `${row(key)}/item:${id}`;
export const detail = (key, id) => `${item(key, id)}/detail:${id}`;
