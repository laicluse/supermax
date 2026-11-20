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
		return { rows: [...document.querySelectorAll(".supermax-row")].map((row) => row.getBoundingClientRect().height) };
		}
	});
	assert.equal(measured.navbar, 40);
	assert.deepEqual(measured.rows, [0, 130, 130], "a row that does not fit takes no height at all");
});

test("the workspace composes its overlays behind one surface", async () => {
	const result = await page.evaluate(() => {
		const workspace = window.workspace;
		const element = workspace.element;
		const regionLast = element.lastElementChild === workspace.notices.region;
		const id = workspace.notify({ scope: "workspace", kind: "action", message: "Hello", action: { label: "Ok", run() {} } });
		const shown = element.querySelectorAll(".supermax-notice").length;
		workspace.dismissAll();
		return { regionLast, id, shown, afterDismiss: element.querySelectorAll(".supermax-notice").length, modal: workspace.modal, peek: workspace.peek };
	});
	assert.deepEqual(result, { regionLast: true, id: "notice-1", shown: 1, afterDismiss: 0, modal: null, peek: null });
});

test("library text is opt-in: defaults stay English, a host replaces what it names, and a typo fails loudly", async () => {
	const result = await page.evaluate(async () => {
		const { Navigator, Workspace, DEFAULT_STRINGS } = await import("/src/index.js");
		const host = document.createElement("div");
		host.style.cssText = "width:600px;height:400px";
		document.body.append(host);
		const navigator = new Navigator({ destinations: window.fixture.destinations, root: "root", minViewportHeight: window.fixture.minViewportHeight, chrome: window.fixture.chrome });
		const dutch = new Workspace(host, { navigator, content: () => ({ element: document.createElement("div") }), strings: { navigation: () => "Werkruimtenavigatie", notices: () => "Meldingen" } });
		const labels = {
			defaults: [window.workspace.element.querySelector(".supermax-navbar").getAttribute("aria-label"), window.workspace.notices.region.getAttribute("aria-label")],
			replaced: [host.querySelector(".supermax-navbar").getAttribute("aria-label"), dutch.notices.region.getAttribute("aria-label")],
			untouched: dutch.strings.retry(),
			table: Object.isFrozen(DEFAULT_STRINGS),
		};
		const failures = [];
		for (const strings of [{ navigaton: () => "x" }, { retry: "Opnieuw" }]) {
			try { new Workspace(document.createElement("div"), { navigator, content: () => ({}), strings }); } catch (error) { failures.push(error.constructor.name + ": " + error.message.split(";")[0]); }
		}
		dutch.destroy();
		host.remove();
		return { ...labels, failures };
	});
	assert.deepEqual(result.defaults, ["Workspace navigation", "Notices"], "a host that passes nothing gets the English defaults");
	assert.deepEqual(result.replaced, ["Werkruimtenavigatie", "Meldingen"], "a host replaces exactly the strings it names");
	assert.equal(result.untouched, "Retry", "every other string keeps its default");
	assert.equal(result.table, true);
	assert.deepEqual(result.failures, ['TypeError: Unknown Supermax string "navigaton"', 'TypeError: Supermax string "retry" must be a function that returns text']);
});
