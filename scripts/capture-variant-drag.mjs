import assert from "node:assert/strict";
import { chromium } from "playwright";
import { serveDocs } from "../test/serve-docs.js";

const server = await serveDocs();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 608, height: 328 }, deviceScaleFactor: 2 });
	await page.goto(`${server.url}/blank`);
	for (const sheet of ["workspace.css", "default-renderer.css"]) await page.addStyleTag({ url: `${server.url}/src/${sheet}` });
	await page.addStyleTag({ content: "body{margin:24px;background:#edf0ed;font:14px system-ui}#host{position:relative;width:560px;height:280px}[data-supermax-content]{padding:12px;color:#263439;line-height:1.9}.supermax-cell[data-variant=icons] .label{display:none}.tile{display:inline-block;width:20px;height:20px;border-radius:4px;background:#8aa39b;vertical-align:middle;margin-right:8px}" });
	await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div");
		host.id = "host";
		document.body.append(host);
		const navigator = new Navigator({ root: "albums", minViewportHeight: 200, destinations: {
			albums: { title: "Albums", header: "title", min: 48, preferred: 240, max: 320, overflow: { mode: "keep" }, variants: [{ id: "labels", when: { minWidth: 161 } }, { id: "icons", min: 48, preferred: 48, max: 160 }] },
			photos: { title: "Photos", header: "title", min: 200, preferred: 400, max: "*" },
		} });
		window.workspace = new Workspace(host, { navigator, content: (occurrence) => {
			const element = document.createElement("div");
			if (occurrence.destination === "albums") element.innerHTML = ["Coast", "Forest", "City"].map((name) => `<div><span class="tile"></span><span class="label">${name}</span></div>`).join("");
			else element.textContent = "Photos content";
			return { element };
		} });
		window.workspace.sync(["albums", "photos"], { origin: null, animate: false });
	});
	const handle = page.locator(".supermax-divider-handle").first();
	const box = await handle.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + 80);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 62, box.y + 80, { steps: 6 });
	await page.mouse.up();
	await page.waitForTimeout(400);
	const albums = await page.evaluate(() => ({ width: window.workspace.findCell("albums").width, variant: window.workspace.findCell("albums").variant }));
	assert.deepEqual(albums, { width: 110, variant: "icons" });
	await page.screenshot({ path: new URL("../docs/assets/captures/variant-between-forms.png", import.meta.url).pathname });
} finally {
	await browser.close();
	await server.close();
}
