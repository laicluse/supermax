import { LAYOUT_HEADER, encodeLayoutHeader, layoutHashOf } from "./supermax/layout-declaration.js";
import { declarationSet, destinations } from "./album.js";

const layouts = new Map();

function layoutFor(id, context) {
	const key = `${context}|${id}`;
	if (!layouts.has(key)) layouts.set(key, encodeLayoutHeader(declarationSet(id, context)));
	return layouts.get(key);
}

export const served = { layout: 0, content: 0 };

function after(delay, answer) {
	return new Promise((resolve) => setTimeout(() => resolve(answer()), delay));
}

export async function serve(url, { method = "GET", context = "ana", delay = 0, fail = "" } = {}) {
	const request = new URL(url, location.href);
	const id = request.searchParams.get("destination");
	const known = !!destinations(context)[id];
	if (request.pathname.endsWith("/supermax/layout")) {
		served.layout += 1;
		const header = known ? await layoutFor(id, context) : null;
		return after(delay, () => {
			if (!header) return new Response(null, { status: 404 });
			if (fail === "manifest" || fail === "all") return new Response(null, { status: 503 });
			const response = new Response(method === "HEAD" ? null : header.text, { headers: { [LAYOUT_HEADER]: header.value, ETag: `"${header.hash}"`, "Cache-Control": "private, no-cache" } });
			return Object.defineProperty(response, "url", { value: request.href });
		});
	}
	if (request.pathname.endsWith("/supermax/content")) {
		served.content += 1;
		const pinned = request.searchParams.get("layout");
		const current = known ? await layoutHashOf(destinations(context)[id]) : null;
		return after(delay, () => {
			if (!current) return new Response(null, { status: 404 });
			if (fail === "content" || fail === "all") return new Response(null, { status: 503 });
			if (pinned !== current) return new Response(null, { status: 409 });
			const definition = destinations(context)[id];
			return Response.json({ id, context, viewer: context === "ben" ? "Ben (read-only)" : "Ana", title: definition.title });
		});
	}
	return new Response(null, { status: 404 });
}
