import assert from "node:assert/strict";
import { LAYOUT_HEADER, SupermaxLayoutError, encodeLayoutHeader, layoutOf, readLayout, validateDeclarationSet } from "../src/layout-declaration.js";
import { closureOf, declarationSet, destinations, embeddedDestinations } from "../docs/assets/album.js";

const set = {
	schemaVersion: 1,
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
assert.match(inline.value, /^v=1; hash="sha256-[\w-]+"; inline="[\w-]+"$/);

const snapshot = await encodeLayoutHeader(set, { url: "/supermax/layout/snapshot/1" });
const fetched = [];
const fetchSnapshot = async (url) => { fetched.push(url); return new Response(snapshot.text); };
assert.deepEqual(await readLayout(head(snapshot.value), { fetch: fetchSnapshot }), set, "a large set comes from the snapshot the header names");
assert.deepEqual(fetched, ["https://example.test/supermax/layout/snapshot/1"]);

const tampered = await encodeLayoutHeader({ ...set, destinations: { ...set.destinations, "photo:a": { ...set.destinations["photo:a"], min: 200 } } });
const mixed = tampered.value.replace(/hash="[^"]+"/, `hash="${inline.hash}"`);
await assert.rejects(readLayout(head(mixed)), (error) => error instanceof SupermaxLayoutError && error.reason === "hash-mismatch", "bytes that do not match the hash are refused");
await assert.rejects(readLayout(head(null)), (error) => error.reason === "missing-header");
await assert.rejects(readLayout(head(inline.value.replace("v=1", "v=2"))), (error) => error.reason === "schema-version");

assert.deepEqual(layoutOf({ title: "Albums", min: 200, max: 320, keep: true, compact: { min: 48, content: () => null }, data: { kind: "albums" } }), { title: "Albums", min: 200, max: 320, preferred: null, keep: true, compact: { min: 48 }, rows: null, defaultChild: null }, "the layout of a definition leaves host data and callbacks out");

for (const context of ["ana", "ben"]) {
	const catalog = destinations(context);
	for (const id of Object.keys(catalog)) assert.deepEqual(validateDeclarationSet(declarationSet(id, context)), [], `the demo declares ${id} for ${context} as a valid, closed set`);
	const embedded = embeddedDestinations(context);
	assert.deepEqual(closureOf(Object.keys(embedded), context).filter((id) => !Object.hasOwn(embedded, id)), [], `the page embeds every default its own destinations name, for ${context}`);
}

console.log("Layout declaration scenarios passed");
