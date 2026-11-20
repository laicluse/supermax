import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { serveDocs } from "./serve-docs.js";

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

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
	const page = await browser.newPage();
	await page.goto(`http://127.0.0.1:${port}/`);
	await page.waitForFunction(() => window.build === "earlier");
	await new Promise((done) => plain.close(done));
	const demo = await serveDocs({ port, live: true });
	try {
		await page.reload();
		await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2, null, { timeout: 5000 });
		assert.equal(await page.evaluate(() => typeof window.supermaxDemo.declares), "function", "a plain reload runs the current build, whatever an earlier server let the browser cache");
		const source = (await page.evaluate(() => document.querySelector('script[type="module"][src]').getAttribute("src")));
		assert.match(source, /^\/__build\/[\w.-]+\/assets\/demo\.js$/, "the demo's modules live under a path of their own build");
		const before = source;
		const touched = new URL("../docs/assets/demo.css", import.meta.url);
		const { mtime } = await stat(touched);
		const { utimes } = await import("node:fs/promises");
		await utimes(touched, new Date(), new Date());
		await page.waitForFunction((previous) => document.querySelector('script[type="module"][src]')?.getAttribute("src") !== previous, before, { timeout: 5000 });
		await utimes(touched, mtime, mtime);
		assert.ok(await readFile(touched), "a change reloads the page into the next build's path");
	} finally {
		await demo.close();
	}
	console.log("Demo server scenarios passed");
} finally {
	await browser.close();
}
