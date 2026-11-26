import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openBrowser } from "./browser.js";
import { serveDocs } from "./serve-docs.js";

let server, browser, page;
before(async () => {
	server = await serveDocs();
	browser = await openBrowser();
	page = await browser.newPage({ viewport: { width: 900, height: 700 } });
	await page.goto(`${server.url}/blank`);
});
after(async () => { await browser?.close(); await server?.close(); });

test("a host's own class sets the workspace height even when the workspace stylesheet loads after it, so the height never follows its content", async () => {
	const heights = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const hostStyle = document.createElement("style");
		hostStyle.textContent = ".page { display: grid; gap: 16px; } .frame { height: 300px; position: absolute; top: 40px; left: 0; right: 0; }";
		document.head.append(hostStyle);
		const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/src/workspace.css"; document.head.append(link);
		await new Promise((resolve) => { link.onload = resolve; });
		const wrapper = document.createElement("main"); wrapper.className = "page";
		const host = document.createElement("div"); host.className = "frame";
		wrapper.append(host); document.body.append(wrapper);
		const navigator = new Navigator({ root: "list", minViewportHeight: 100, destinations: {
			list: { title: "List", min: 200, preferred: 240, max: 260, header: "title" },
			detail: { title: "Detail", min: 300, preferred: 400, max: "*", header: "title" },
		} });
		navigator.open("detail", { from: "list" });
		new Workspace(host, { navigator, content: (occurrence) => ({ element: Object.assign(document.createElement("p"), { textContent: occurrence.title }) }) });
		const frames = (count) => new Promise((resolve) => { const step = () => (count-- <= 0 ? resolve() : requestAnimationFrame(step)); step(); });
		await frames(4);
		const style = getComputedStyle(host);
		const measured = [{ height: host.getBoundingClientRect().height, position: style.position }];
		for (const width of [880, 860, 840]) {
			wrapper.style.width = `${width}px`;
			await frames(6);
			measured.push({ height: host.getBoundingClientRect().height, position: getComputedStyle(host).position });
		}
		return measured;
	});
	assert.deepEqual(heights, Array(4).fill({ height: 300, position: "absolute" }), JSON.stringify(heights));
});
