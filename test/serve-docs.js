import { readdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const docsRoot = resolve(repoRoot, "docs");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const extraRoots = { "/src/": resolve(repoRoot, "src"), "/test/fixtures/": resolve(repoRoot, "test/fixtures") };
const blankPage = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Supermax test page</title></head><body></body></html>";
const startedAt = String(Date.now());
const followRevision = `<script type="module">
let known = null;
let asking = false;
const timer = setInterval(check, 1000);
addEventListener("focus", check);
document.addEventListener("visibilitychange", check);
async function check() {
	if (asking) return;
	asking = true;
	try {
		const revision = await (await fetch("/__revision", { cache: "no-store", signal: AbortSignal.timeout(1500) })).text();
		if (known === null) known = revision;
		else if (revision !== known) {
			clearInterval(timer);
			location.reload();
		}
	} catch {
	} finally {
		asking = false;
	}
}
check();
</script>`;

async function newestChange(directory) {
	let newest = 0;
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		newest = Math.max(newest, entry.isDirectory() ? await newestChange(path) : (await stat(path)).mtimeMs);
	}
	return newest;
}

export async function serveDocs({ port = 0, live = false } = {}) {
	const server = createServer(async (request, response) => {
		const pathname = new URL(request.url, "http://localhost").pathname;
		if (live && pathname === "/__revision") {
			response.setHeader("Cache-Control", "no-store");
			response.end(`${startedAt}:${await newestChange(docsRoot)}`);
			return;
		}
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
			const body = live && file === resolve(docsRoot, "index.html") ? (await readFile(file, "utf8")).replace("</body>", `${followRevision}</body>`) : await readFile(file);
			response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
			response.setHeader("Cache-Control", "no-store");
			response.end(body);
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise((done) => server.listen(port, "127.0.0.1", done));
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		close: () => new Promise((done) => server.close(done)),
	};
}
