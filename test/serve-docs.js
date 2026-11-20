import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { destinations } from "../docs/assets/album.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const docsRoot = resolve(repoRoot, "docs");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const extraRoots = { "/src/": resolve(repoRoot, "src"), "/test/fixtures/": resolve(repoRoot, "test/fixtures") };
const blankPage = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Supermax test page</title></head><body></body></html>";
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

async function serveApi(url, request, response) {
	const [, , kind, ...rest] = url.pathname.split("/");
	const id = decodeURIComponent(rest.join("/"));
	const context = url.searchParams.get("context") ?? "ana";
	const delay = Number(url.searchParams.get("delay") ?? 0);
	const fail = url.searchParams.get("fail");
	const payload = kind === "manifest" ? manifestFor(id, context) : kind === "content" ? contentFor(id, context) : null;
	if (delay > 0) await new Promise((done) => setTimeout(done, Math.min(delay, 10000)));
	if (!payload) {
		response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "unknown" }));
		return;
	}
	if (fail === kind || fail === "all") {
		response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ error: "unavailable" }));
		return;
	}
	const body = JSON.stringify(payload);
	const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
	if (request.headers["if-none-match"] === etag) {
		response.writeHead(304, { ETag: etag, "Cache-Control": "max-age=30" }).end();
		return;
	}
	response.writeHead(200, { "Content-Type": "application/json", ETag: etag, "Cache-Control": "max-age=30", Vary: "Accept" }).end(body);
}

export async function serveDocs() {
	const server = createServer(async (request, response) => {
		const url = new URL(request.url, "http://localhost");
		const pathname = url.pathname;
		if (pathname === "/blank") {
			response.setHeader("Content-Type", "text/html");
			response.end(blankPage);
			return;
		}
		if (pathname.startsWith("/api/")) {
			await serveApi(url, request, response);
			return;
		}
		const extra = Object.keys(extraRoots).find((prefix) => pathname.startsWith(prefix));
		const root = extra ? extraRoots[extra] : docsRoot;
		const relative = normalize(extra ? pathname.slice(extra.length - 1) : (pathname === "/" ? "/index.html" : pathname)).replace(/^(\.\.[/\\])+/, "");
		const file = resolve(root, `.${relative}`);
		if (!file.startsWith(root)) {
			response.writeHead(403).end();
			return;
		}
		try {
			const body = await readFile(file);
			response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
			response.end(body);
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		close: () => new Promise((done) => server.close(done)),
	};
}
