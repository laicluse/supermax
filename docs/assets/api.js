import { destinations } from "./album.js";

const catalog = destinations();

function manifestFor(id, context) {
	const definition = catalog[id];
	if (!definition) return null;
	const { data, ...layout } = definition;
	const manifest = { ...layout, data: JSON.parse(JSON.stringify(data)), context };
	if (context === "ben" && data?.kind === "metadata") delete manifest.defaultChild;
	return manifest;
}

function contentFor(id, context) {
	const definition = catalog[id];
	if (!definition) return null;
	return { id, context, viewer: context === "ben" ? "Ben (read-only)" : "Ana", title: definition.title };
}

export class ApiError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

export function fetchFromCatalog(kind, id, { context = "ana", delay = 0, fail = "" } = {}) {
	const payload = kind === "manifest" ? manifestFor(id, context) : kind === "content" ? contentFor(id, context) : null;
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			if (!payload) reject(new ApiError(404, "The server does not know this destination."));
			else if (fail === kind || fail === "all") reject(new ApiError(503, "The server answered 503."));
			else resolve(payload);
		}, delay);
	});
}
