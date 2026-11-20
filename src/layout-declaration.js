export const LAYOUT_HEADER = "Supermax-Layout";
export const LAYOUT_SCHEMA = 1;

const REQUIRED = ["title", "min", "max", "preferred", "defaultChild"];
const FIELDS = new Set([...REQUIRED, "keep", "compact", "rows", "zoomable", "height"]);
const ROW_FIELDS = new Set(["destination", "minHeight", "maxHeight", "preferredHeight", "keep"]);

export class SupermaxLayoutError extends Error {
	constructor(message, reason) {
		super(message);
		this.name = "SupermaxLayoutError";
		this.reason = reason;
	}
}

const size = (value) => Number.isFinite(value) && value > 0;
const ELASTIC = "*";

export function layoutOf(definition) {
	return {
		title: definition.title,
		min: definition.min,
		max: definition.max,
		preferred: definition.preferred ?? null,
		keep: !!definition.keep,
		compact: definition.compact ? { min: definition.compact.min } : null,
		rows: definition.rows ? definition.rows.map((row) => ({ destination: row.destination, minHeight: row.minHeight, maxHeight: row.maxHeight, preferredHeight: row.preferredHeight ?? null, keep: !!row.keep })) : null,
		defaultChild: definition.defaultChild ?? null,
		...(definition.zoomable ? { zoomable: true } : {}),
		...(definition.height === "full" ? { height: "full" } : {}),
	};
}

export function canonicalJSON(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
}

export function sameLayout(first, second) {
	return canonicalJSON(layoutOf(first)) === canonicalJSON(layoutOf(second));
}

function problemsOf(id, declaration) {
	if (!declaration || typeof declaration !== "object") return ["not-an-object"];
	const problems = [];
	if (id.includes("/")) problems.push("invalid-id");
	if (Object.keys(declaration).some((key) => !FIELDS.has(key))) problems.push("unknown-field");
	if (REQUIRED.some((key) => !Object.hasOwn(declaration, key))) problems.push("missing-field");
	if (typeof declaration.title !== "string" || declaration.title.trim().length === 0) problems.push("invalid-title");
	const elastic = declaration.max === ELASTIC;
	if (!size(declaration.min) || (!elastic && (!size(declaration.max) || declaration.min > declaration.max))) problems.push("invalid-size");
	if (elastic && !(size(declaration.preferred) && declaration.preferred >= declaration.min)) problems.push("elastic-without-preferred");
	else if (declaration.preferred != null && (!size(declaration.preferred) || declaration.preferred < declaration.min || (!elastic && declaration.preferred > declaration.max))) problems.push("invalid-preferred");
	if (declaration.compact != null && (!size(declaration.compact.min) || Object.keys(declaration.compact).some((key) => key !== "min"))) problems.push("invalid-compact");
	if (declaration.rows != null) {
		const rows = declaration.rows;
		const badHeight = (row) => (row.maxHeight === ELASTIC ? !(size(row.preferredHeight) && row.preferredHeight >= row.minHeight) : !size(row.maxHeight) || row.minHeight > row.maxHeight);
		const badRow = (row) => !row || typeof row.destination !== "string" || Object.keys(row).some((key) => !ROW_FIELDS.has(key)) || !size(row.minHeight) || badHeight(row);
		if (!Array.isArray(rows) || rows.length === 0 || rows.some(badRow)) problems.push("invalid-row-shape");
	}
	if (declaration.defaultChild != null && (typeof declaration.defaultChild !== "string" || declaration.defaultChild.length === 0 || declaration.defaultChild === id)) problems.push("invalid-default");
	if (declaration.height != null && (declaration.height !== "full" || declaration.rows != null)) problems.push("invalid-height");
	return problems;
}

function referencesOf(declaration) {
	const rows = Array.isArray(declaration?.rows) ? declaration.rows.map((row) => row?.destination) : [];
	return [declaration?.defaultChild, ...rows].filter((reference) => typeof reference === "string" && reference.length > 0);
}

function cyclicDefaults(destinations) {
	const cyclic = new Set();
	for (const id of Object.keys(destinations)) {
		const seen = [id];
		for (let next = destinations[id]?.defaultChild; typeof next === "string" && Object.hasOwn(destinations, next); next = destinations[next]?.defaultChild) {
			if (seen.includes(next)) {
				seen.slice(seen.indexOf(next)).forEach((member) => cyclic.add(member));
				break;
			}
			seen.push(next);
		}
	}
	return cyclic;
}

export function validateDeclarationSet(set, { known = () => false } = {}) {
	const root = typeof set?.root === "string" ? set.root : "(set)";
	if (!set || typeof set !== "object" || !set.destinations || typeof set.destinations !== "object") return [{ destination: root, reason: "not-a-set" }];
	const problems = [];
	if (set.schemaVersion !== LAYOUT_SCHEMA) problems.push({ destination: root, reason: "schema-version" });
	if (!Object.hasOwn(set.destinations, root)) problems.push({ destination: root, reason: "missing-root" });
	const present = (id) => Object.hasOwn(set.destinations, id) || known(id);
	for (const [id, declaration] of Object.entries(set.destinations)) {
		for (const reason of problemsOf(id, declaration)) problems.push({ destination: id, reason });
		if (referencesOf(declaration).some((reference) => !present(reference))) problems.push({ destination: id, reason: "missing-destination" });
	}
	for (const id of cyclicDefaults(set.destinations)) problems.push({ destination: id, reason: "default-cycle" });
	return problems;
}

function base64url(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text) {
	const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
	return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export async function hashLayout(text) {
	const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return `sha256-${base64url(new Uint8Array(digest))}`;
}

export function layoutHashOf(definition) {
	return hashLayout(canonicalJSON(layoutOf(definition)));
}

export async function encodeLayoutHeader(set, { url = null } = {}) {
	const text = canonicalJSON(set);
	const hash = await hashLayout(text);
	const location = url ? `url="${url}"` : `inline="${base64url(new TextEncoder().encode(text))}"`;
	return { value: `v=${LAYOUT_SCHEMA}; hash="${hash}"; ${location}`, hash, text };
}

export function parseLayoutHeader(value) {
	const fields = Object.fromEntries([...String(value ?? "").matchAll(/(\w+)=(?:"([^"]*)"|([^;\s]*))/g)].map((match) => [match[1], match[2] ?? match[3]]));
	if (Number(fields.v) !== LAYOUT_SCHEMA) throw new SupermaxLayoutError(`${LAYOUT_HEADER} has schema ${fields.v ?? "none"}; this Supermax reads ${LAYOUT_SCHEMA}.`, "schema-version");
	if (!fields.hash || (!fields.inline && !fields.url)) throw new SupermaxLayoutError(`${LAYOUT_HEADER} needs a hash and an inline set or a url.`, "malformed-header");
	return { hash: fields.hash, inline: fields.inline ?? null, url: fields.url ?? null };
}

export async function readLayout(response, { fetch = globalThis.fetch } = {}) {
	const header = response.headers.get(LAYOUT_HEADER);
	if (!header) throw new SupermaxLayoutError(`The response carries no ${LAYOUT_HEADER} header.`, "missing-header");
	const { hash, inline, url } = parseLayoutHeader(header);
	const text = inline ? fromBase64url(inline) : await (await fetch(new URL(url, response.url || globalThis.location?.href).href)).text();
	if ((await hashLayout(text)) !== hash) throw new SupermaxLayoutError(`The layout does not match the hash in ${LAYOUT_HEADER}.`, "hash-mismatch");
	return JSON.parse(text);
}
