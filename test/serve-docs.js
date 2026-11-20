import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, normalize, resolve } from "node:path";

const docsRoot = resolve(new URL("../docs/", import.meta.url).pathname);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };

export async function serveDocs() {
	const server = createServer(async (request, response) => {
		const pathname = new URL(request.url, "http://localhost").pathname;
		const relative = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
		const file = resolve(docsRoot, `.${relative}`);
		if (!file.startsWith(docsRoot)) {
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
