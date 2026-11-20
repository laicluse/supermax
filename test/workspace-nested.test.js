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

const settle = () => page.evaluate(async () => {
	document.getAnimations().forEach((animation) => animation.finish());
	await Promise.all([...window.workspace.chains.values()].map((entry) => entry.strip.finished));
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

test("a split closing inside a row keeps its rows until that row's strip has finished", async () => {
	await page.evaluate(() => { document.getElementById("host").style.height = "500px"; });
	await page.waitForFunction(() => window.model.size.height === 500);
	await page.evaluate(() => { window.workspace.navigate("item:deep", { from: window.fixture.row("grid") }); });
	await settle();
	const before = await page.evaluate(() => document.querySelectorAll('[data-occurrence="root/gallery/grid/item:deep/innerfit"] .supermax-chain').length);
	assert.ok(before >= 1, "the nested split rendered at least one open row chain");
	const during = await page.evaluate(() => {
		window.workspace.requestBack();
		document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = 100; });
		const exiting = document.querySelector('[data-occurrence="root/gallery/grid/item:deep/innerfit"][data-supermax-exiting]');
		return { exiting: !!exiting, rows: exiting?.querySelectorAll(".supermax-row").length ?? 0, chains: exiting?.querySelectorAll(".supermax-chain").length ?? 0 };
	});
	assert.deepEqual(during, { exiting: true, rows: 2, chains: before }, "the departing split still carries its rows and chains mid-exit");
	await settle();
	assert.equal(await page.evaluate(() => document.querySelectorAll('[data-occurrence^="root/gallery/grid/item:deep"]').length), 0, "everything is gone after the exit");
});

test("a nested split that outgrows its row makes the workspace scroll to it", async () => {
	await page.evaluate(() => { document.getElementById("host").style.height = "300px"; });
	await page.waitForFunction(() => window.model.size.height === 300);
	const result = await page.evaluate(async () => {
		window.workspace.navigate("item:deep", { from: window.fixture.row("grid") });
		window.workspace.focusRow("root/gallery/grid/item:deep/innerfit/list");
		await Promise.all([...window.workspace.chains.values()].map((entry) => entry.strip.finished));
		const body = document.querySelector(".supermax-body");
		const gridRow = document.querySelector('.supermax-row[data-row="root/gallery/grid"]').getBoundingClientRect().height;
		const innerList = document.querySelector('.supermax-row[data-row="root/gallery/grid/item:deep/innerfit/list"]').getBoundingClientRect().height;
		return { scrolls: body.scrollHeight > body.clientHeight, gridRow, innerList };
	});
	assert.equal(result.scrolls, true);
	assert.equal(result.innerList, 200, "the inner list keeps its minimum");
	assert.ok(result.gridRow >= 220, "the outer row grew to hold it");
});
