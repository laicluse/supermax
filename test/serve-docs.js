import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const docsRoot = resolve(repoRoot, "docs");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const extraRoots = { "/src/": resolve(repoRoot, "src"), "/test/fixtures/": resolve(repoRoot, "test/fixtures") };
const blankPage = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Supermax test page</title></head><body></body></html>";
export async function serveDocs() {
	const server = createServer(async (request, response) => {
		const url = new URL(request.url, "http://localhost");
		const pathname = url.pathname;
		if (pathname === "/blank") {
			response.setHeader("Content-Type", "text/html");
			response.end(blankPage);
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
