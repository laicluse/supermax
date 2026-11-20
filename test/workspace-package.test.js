import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { serveDocs } from "./serve-docs.js";

let server;
let browser;
let page;

before(async () => {
	server = await serveDocs();
	browser = await chromium.launch({ channel: "chrome", headless: true });
	page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
	await page.goto(`${server.url}/blank`);
	await page.evaluate(async () => {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = "/src/workspace.css";
		document.head.append(link);
		const host = document.createElement("div");
		host.id = "host";
		host.style.cssText = "width:1000px;height:500px";
		document.body.append(host);
		const { Navigator, Workspace } = await import("/src/index.js");
		const fixture = await import("/test/fixtures/gallery.js");
		window.fixture = fixture;
		window.model = new Navigator({ destinations: fixture.destinations, root: "root", minViewportHeight: fixture.minViewportHeight, chrome: fixture.chrome });
		window.workspace = new Workspace(host, {
			navigator: window.model,
			content: (occurrence) => {
				const element = document.createElement("div");
				element.textContent = occurrence.title;
				element.style.height = "400px";
				return { element };
			},
		});
	});
});

after(async () => {
	await browser?.close();
	await server?.close();
});

test("the package stylesheet alone renders the chrome at the sizes the model computes with", async () => {
	const measured = await page.evaluate(() => {
		const navbar = document.querySelector(".supermax-navbar").getBoundingClientRect().height;
		window.workspace.navigate("gallery", { from: "root" });
		document.getElementById("host").style.height = "300px";
		return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ navbar, ...measureRows() }))));
		function measureRows() {
		const tab = document.querySelector(".supermax-row-tab:not([hidden])").getBoundingClientRect().height;
		const rows = [...document.querySelectorAll(".supermax-row")].map((row) => row.getBoundingClientRect().height);
		return { tab, rows };
		}
	});
	assert.equal(measured.navbar, 40);
	assert.equal(measured.tab, 20);
	assert.deepEqual(measured.rows, [20, 120, 120]);
});
