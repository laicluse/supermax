import assert from "node:assert/strict";
import { chromium } from "playwright";
import { serveDocs } from "../test/serve-docs.js";

const capture = (name) => new URL(`../docs/assets/captures/${name}.png`, import.meta.url).pathname;
const server = await serveDocs();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 608, height: 408 }, deviceScaleFactor: 2 });
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`${server.url}/blank`);
	for (const sheet of ["workspace.css", "default-renderer.css"]) await page.addStyleTag({ url: `${server.url}/src/${sheet}` });
	await page.addStyleTag({ content: "body{margin:24px;background:#edf0ed;font:14px system-ui}#host{position:relative;width:560px;height:360px}[data-supermax-content]{padding:12px;color:#263439;line-height:1.5}" });
	await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div");
		host.id = "host";
		document.body.append(host);
		const titles = { rail: "Mode", mailboxes: "Mailboxes", conversations: "Conversations", message: "Message", attachment: "Attachment" };
		const destinations = Object.fromEntries(Object.entries(titles).map(([id, title]) => [id, { title, header: "title", min: 120, preferred: 250, max: "*" }]));
		destinations.rail = { title: "Mode", min: 60, max: 60, overflow: { mode: "keep" } };
		const navigator = new Navigator({ root: "rail", minViewportHeight: 200, destinations });
		window.workspace = new Workspace(host, { navigator, content: (occurrence) => {
			const element = document.createElement("div");
			element.textContent = occurrence.destination === "rail" ? "" : `${occurrence.title} content`;
			return { element };
		} });
		window.workspace.sync(Object.keys(titles), { origin: null, animate: false });
		await document.fonts.ready;
	});
	const picture = () => page.evaluate(() => window.workspace.layout.chain.cells.map((cell) => cell.folded ? `[${cell.title}]` : cell.full ? cell.title : `(${cell.title})`).join(" "));
	assert.equal(await picture(), "Mode [Mailboxes] [Conversations] Message Attachment");
	await page.screenshot({ path: capture("unfold-start") });
	const box = await page.locator('.supermax-fold-cue[data-fold-occurrence="rail/mailboxes"]').boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 125, box.y + box.height / 2, { steps: 10 });
	await page.screenshot({ path: capture("unfold-drag") });
	await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2, { steps: 6 });
	await page.mouse.up();
	await page.waitForFunction(() => !window.workspace.folds.drag);
	assert.equal(await picture(), "Mode Mailboxes [Conversations] Message");
	await page.screenshot({ path: capture("unfold-released") });
	assert.deepEqual(errors, []);
} finally {
	await browser.close();
	await server.close();
}
