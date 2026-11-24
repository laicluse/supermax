import assert from "node:assert/strict";
import { stat, utimes } from "node:fs/promises";
import { createServer } from "node:http";
import { openBrowser } from "./browser.js";
import { closeServer, serveDocs } from "./serve-docs.js";

const earlier = { "/": "<!doctype html><script type=\"module\" src=\"./assets/demo.js\"></script>", "/assets/demo.js": "window.build = \"earlier\";" };
const plain = createServer((request, response) => {
	const body = earlier[new URL(request.url, "http://localhost").pathname];
	if (!body) return response.writeHead(404).end();
	response.setHeader("Content-Type", request.url.endsWith(".js") ? "text/javascript" : "text/html");
	response.setHeader("Last-Modified", new Date(Date.now() - 86400000).toUTCString());
	response.end(body);
});
await new Promise((done) => plain.listen(0, "127.0.0.1", done));
const port = plain.address().port;

let browser;
try {
	browser = await openBrowser();
	const page = await browser.newPage();
	await page.goto(`http://127.0.0.1:${port}/`);
	await page.waitForFunction(() => window.build === "earlier");
	await closeServer(plain);
	const demo = await serveDocs({ port, live: true });
	try {
		await page.reload();
		await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2, null, { timeout: 5000 });
		assert.equal(await page.evaluate(() => typeof window.supermaxDemo.declares), "function", "a plain reload runs the current build, whatever an earlier server let the browser cache");
		const moduleSource = () => page.locator('script[type="module"][src]').getAttribute("src");
		const source = await moduleSource();
		assert.match(source, /^\/__build\/[\w.-]+\/assets\/demo\.js$/, "the demo's modules live under a path of their own build");
		const before = source;
		const touched = new URL("../docs/assets/demo.css", import.meta.url);
		const { atime, mtime } = await stat(touched);
		try {
			await utimes(touched, atime, new Date());
			await page.waitForFunction((previous) => {
				const src = document.querySelector('script[type="module"][src]')?.getAttribute("src");
				return src && src !== previous;
			}, before, { timeout: 5000 });
			assert.match(await moduleSource(), /^\/__build\/[\w.-]+\/assets\/demo\.js$/, "a change reloads into the next build's module path");
		} finally {
			await utimes(touched, atime, mtime);
		}
	} finally {
		await demo.close();
	}
	console.log("Demo server scenarios passed");
} finally {
	await Promise.all([browser?.close(), plain.listening ? closeServer(plain) : undefined]);
}
