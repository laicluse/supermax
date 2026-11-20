import assert from "node:assert/strict";
import { LAYOUT_HEADER, SupermaxLayoutError, encodeLayoutHeader, layoutOf, readLayout, validateDeclarationSet } from "../src/layout-declaration.js";
import { closureOf, declarationSet, destinations, embeddedDestinations } from "../docs/assets/album.js";

const set = {
	schemaVersion: 2,
	context: "ana",
	root: "photo:a",
	destinations: {
		"photo:a": { title: "Photo A", min: 240, max: 520, preferred: 360, defaultChild: "metadata:a" },
		"metadata:a": { title: "Metadata A", min: 200, max: 320, preferred: 220, defaultChild: null },
	},
};
const head = (value, url = "https://example.test/supermax/layout?destination=photo:a") => Object.defineProperty(new Response(null, { headers: value ? { [LAYOUT_HEADER]: value } : {} }), "url", { value: url });

const inline = await encodeLayoutHeader(set);
assert.deepEqual(await readLayout(head(inline.value)), JSON.parse(inline.text), "a HEAD response carries the whole set inline");
assert.match(inline.value, /^v=2; hash="sha256-[\w-]+"; inline="[\w-]+"$/);

const snapshot = await encodeLayoutHeader(set, { url: "/supermax/layout/snapshot/1" });
const fetched = [];
const fetchSnapshot = async (url) => { fetched.push(url); return new Response(snapshot.text); };
assert.deepEqual(await readLayout(head(snapshot.value), { fetch: fetchSnapshot }), set, "a large set comes from the snapshot the header names");
assert.deepEqual(fetched, ["https://example.test/supermax/layout/snapshot/1"]);

const tampered = await encodeLayoutHeader({ ...set, destinations: { ...set.destinations, "photo:a": { ...set.destinations["photo:a"], min: 200 } } });
const mixed = tampered.value.replace(/hash="[^"]+"/, `hash="${inline.hash}"`);
await assert.rejects(readLayout(head(mixed)), (error) => error instanceof SupermaxLayoutError && error.reason === "hash-mismatch", "bytes that do not match the hash are refused");
await assert.rejects(readLayout(head(null)), (error) => error.reason === "missing-header");
await assert.rejects(readLayout(head(inline.value.replace("v=2", "v=3"))), (error) => error.reason === "schema-version");

assert.deepEqual(layoutOf({ title: "Albums", min: 200, max: 320, overflow: { mode: "keep" }, data: { kind: "albums" } }), { title: "Albums", min: 200, max: 320, preferred: null, overflow: { mode: "keep" }, rows: null, defaultChild: null }, "the layout of a definition leaves host data and callbacks out");

{
	const foldable = { schemaVersion: 2, context: "ana", root: "split", destinations: {
		split: { title: "Split", rows: [{ destination: "top", minHeight: 160, maxHeight: 160, overflow: { mode: "fold", size: 20 } }, { destination: "bottom", minHeight: 220, maxHeight: "*", preferredHeight: 280 }] },
		top: { title: "Top", min: 200, max: 300, preferred: null, defaultChild: null, overflow: { mode: "fold", size: 16 } },
		bottom: { title: "Bottom", min: 220, max: "*", preferred: 300, defaultChild: null },
	} };
	assert.deepEqual(validateDeclarationSet(foldable), [], "a server declaration can carry horizontal and vertical fold sizes");
	assert.deepEqual(layoutOf(foldable.destinations.split).rows[0].overflow, { mode: "fold", size: 20 });
	assert.deepEqual(layoutOf(foldable.destinations.top).overflow, { mode: "fold", size: 16 });
	foldable.destinations.top.overflow = { mode: "hide" };
	foldable.destinations.split.rows[0].overflow = { mode: "hide" };
	assert.deepEqual(validateDeclarationSet(foldable), [], "a server declaration can exclude cells and rows from folding");
	assert.deepEqual(layoutOf(foldable.destinations.top).overflow, { mode: "hide" });
	assert.deepEqual(layoutOf(foldable.destinations.split).rows[0].overflow, { mode: "hide" });
	foldable.destinations.top.overflow = { mode: "fold", size: 16 };
	foldable.destinations.top.overflow.size = 0;
	assert.deepEqual(validateDeclarationSet(foldable), [], "a fold can explicitly reserve no space");
	foldable.destinations.top.overflow.size = -1;
	assert.deepEqual(validateDeclarationSet(foldable).map((problem) => problem.reason), ["invalid-fold-size"], "a fold cannot reserve negative space");
}

for (const context of ["ana", "ben"]) {
	const catalog = destinations(context);
	for (const id of Object.keys(catalog)) assert.deepEqual(validateDeclarationSet(declarationSet(id, context)), [], `the demo declares ${id} for ${context} as a valid, closed set`);
	const embedded = embeddedDestinations(context);
	assert.deepEqual(closureOf(Object.keys(embedded), context).filter((id) => !Object.hasOwn(embedded, id)), [], `the page embeds every default its own destinations name, for ${context}`);
}

{
	const plain = layoutOf({ title: "Plain", min: 200, max: 300 });
	assert.equal(Object.hasOwn(plain, "zoomable"), false, "a declaration that cannot zoom carries no zoomable field, so existing hashes stay the same");
	assert.equal(layoutOf({ title: "Zoomable", min: 200, max: 300, zoomable: true }).zoomable, true, "one that can zoom says so");
	assert.equal(Object.hasOwn(layoutOf({ title: "Plain", min: 200, max: 300 }), "header"), false, "a cell without a title bar, the common case, carries no header field");
	assert.equal(layoutOf({ title: "Named", min: 200, max: 300, header: "title" }).header, "title", "a cell that needs its title bar says so");
	const headed = (declaration) => validateDeclarationSet({ schemaVersion: 2, context: "ana", root: "x", destinations: { x: { title: "X", min: 200, max: 300, preferred: null, defaultChild: null, ...declaration } } }).map((problem) => problem.reason);
	assert.deepEqual(headed({ header: "title" }), [], "header: \"title\" is a valid declaration");
	assert.deepEqual(headed({ header: "none" }), ["invalid-header"], "there is no other value: no bar is the default");
	assert.deepEqual(validateDeclarationSet({ schemaVersion: 2, context: "ana", root: "s", destinations: { s: { title: "S", rows: [{ destination: "x", minHeight: 100, maxHeight: "*", preferredHeight: 200 }], header: "title" }, x: { title: "X", min: 200, max: 300, preferred: null, defaultChild: null } } }).map((problem) => problem.reason), [], "a split may draw its title above its rows the same way");
	assert.equal(layoutOf({ title: "S", rows: [{ destination: "x", minHeight: 100, maxHeight: "*", preferredHeight: 200 }], header: "title" }).header, "title");
	assert.equal(Object.hasOwn(plain, "menu"), false, "a cell without a menu item carries no menu field, so existing hashes stay the same");
	assert.deepEqual(headed({ menu: true }), [], "menu: true is a valid declaration");
	assert.deepEqual(headed({ menu: "exact" }), [], "menu: \"exact\" is a valid declaration");
	assert.deepEqual(headed({ menu: "always" }), ["invalid-menu"], "there is no other value");
	assert.equal(layoutOf({ title: "Day", min: 200, max: 300, menu: "exact" }).menu, "exact");
}

console.log("Layout declaration scenarios passed");

{
	const set = { schemaVersion: 2, context: "ana", root: "a/b", destinations: { "a/b": { title: "Slashed", min: 200, max: "*", preferred: 300, defaultChild: null } } };
	assert.ok(validateDeclarationSet(set).some((problem) => problem.destination === "a/b" && problem.reason === "invalid-id"), "a destination id with a slash is refused, because occurrence ids are paths of destination ids joined by slashes");
}
