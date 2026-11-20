import assert from "node:assert/strict";
import { chromium } from "playwright";
import { serveDocs } from "../test/serve-docs.js";

const server = await serveDocs();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 608, height: 368 }, deviceScaleFactor: 2 });
	await page.goto(`${server.url}/blank`);
	for (const sheet of ["workspace.css", "default-renderer.css"]) await page.addStyleTag({ url: `${server.url}/src/${sheet}` });
	await page.addStyleTag({ content: "body{margin:24px;background:#edf0ed;font:14px system-ui}#host{position:relative;width:560px;height:320px}[data-supermax-content]{padding:12px;color:#263439;line-height:1.9}.supermax-cell[data-variant=icons] .label{display:none}.tile{display:inline-block;width:20px;height:20px;border-radius:4px;background:#8aa39b;vertical-align:middle;margin-right:8px}" });
	const widths = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div");
		host.id = "host";
		document.body.append(host);
		const list = (title) => ({ title, header: "title", min: 48, preferred: 240, max: 320, variants: [{ id: "labels", when: { minWidth: 161 } }, { id: "icons", min: 48, preferred: 48, max: 160 }] });
		const navigator = new Navigator({ root: "menu", minViewportHeight: 200, destinations: {
			menu: { title: "Menu", header: "title", min: 48, max: 48 },
			library: { title: "Library", rows: [{ destination: "albums", minHeight: 80, maxHeight: 140 }, { destination: "tags", minHeight: 80, preferredHeight: 140, maxHeight: "*" }] },
			albums: list("Albums"),
			tags: list("Tags"),
			photos: { title: "Photos", header: "title", min: 200, preferred: 400, max: "*" },
		} });
		const workspace = new Workspace(host, { navigator, content: (occurrence) => {
			const element = document.createElement("div");
			const names = { albums: ["Coast", "Forest"], tags: ["Family", "Travel"] }[occurrence.destination] ?? [];
			element.innerHTML = names.map((name) => `<div><span class="tile"></span><span class="label">${name}</span></div>`).join("");
			return { element };
		} });
		workspace.sync(["menu", "library"], { origin: null, animate: false });
		navigator.setSize("menu/library", 110);
		workspace.render({ animate: false });
		return ["menu/library", "menu/library/albums", "menu/library/tags"].map((id) => [workspace.findCell(id).width, workspace.findCell(id).variant ?? null]);
	});
	assert.deepEqual(widths, [[110, null], [110, "icons"], [110, "icons"]]);
	await page.screenshot({ path: new URL("../docs/assets/captures/split-between-forms.png", import.meta.url).pathname });
} finally {
	await browser.close();
	await server.close();
}
