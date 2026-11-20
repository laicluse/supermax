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
		return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
			document.getAnimations().forEach((animation) => animation.finish());
			resolve({ navbar, ...measureRows() });
		})));
		function measureRows() {
		return { rows: [...document.querySelectorAll(".supermax-row")].map((row) => row.getBoundingClientRect().height) };
		}
	});
	assert.equal(measured.navbar, 40);
	assert.deepEqual(measured.rows, [0, 116, 116], "a row that does not fit takes no height at all, and the rows share what the navbar and the split's own title bar leave");
});

test("the workspace composes its overlays behind one surface", async () => {
	const result = await page.evaluate(() => {
		const workspace = window.workspace;
		const element = workspace.element;
		const region = workspace.notices.region;
		const regionInRoot = region.parentElement === document.body && !element.contains(region);
		const id = workspace.notify({ scope: "workspace", kind: "action", message: "Hello", action: { label: "Ok", run() {} } });
		const shown = region.querySelectorAll(".supermax-notice").length;
		workspace.dismissAll();
		return { regionInRoot, id, shown, afterDismiss: region.querySelectorAll(".supermax-notice").length, modal: workspace.modal, peek: workspace.peek };
	});
	assert.deepEqual(result, { regionInRoot: true, id: "notice-1", shown: 1, afterDismiss: 0, modal: null, peek: null }, "notices live in the overlay root, the page by default, outside the cells");
});

test("library text is opt-in: defaults stay English, a host replaces what it names, and a typo fails loudly", async () => {
	const result = await page.evaluate(async () => {
		const { Navigator, Workspace, DEFAULT_STRINGS } = await import("/src/index.js");
		const host = document.createElement("div");
		host.style.cssText = "width:600px;height:400px";
		document.body.append(host);
		const navigator = new Navigator({ destinations: window.fixture.destinations, root: "root", minViewportHeight: window.fixture.minViewportHeight, chrome: window.fixture.chrome });
		const frame = document.createElement("div");
		frame.style.cssText = "contain:layout";
		frame.append(host);
		document.body.append(frame);
		const dutch = new Workspace(host, { navigator, content: () => ({ element: document.createElement("div") }), overlayRoot: frame, strings: { navigation: () => "Werkruimtenavigatie", notices: () => "Meldingen" } });
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
		frame.remove();
		return { ...labels, failures };
	});
	assert.deepEqual(result.defaults, ["Workspace navigation", "Notices"], "a host that passes nothing gets the English defaults");
	assert.deepEqual(result.replaced, ["Werkruimtenavigatie", "Meldingen"], "a host replaces exactly the strings it names");
	assert.equal(result.untouched, "Retry", "every other string keeps its default");
	assert.equal(result.table, true);
	assert.deepEqual(result.failures, ['TypeError: Unknown Supermax string "navigaton"', 'TypeError: Supermax string "retry" must be a function that returns text']);
});

test("origin: null draws no link, and anything else that is not a function is refused", async () => {
	const result = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const navigator = new Navigator({ destinations: window.fixture.destinations, root: "root", minViewportHeight: window.fixture.minViewportHeight, chrome: window.fixture.chrome });
		const host = document.createElement("div");
		host.style.cssText = "width:600px;height:400px";
		document.body.append(host);
		const before = document.querySelectorAll(".supermax-origin").length;
		const bare = new Workspace(host, { navigator, content: () => ({ element: document.createElement("div") }), origin: null });
		const added = document.querySelectorAll(".supermax-origin").length - before;
		bare.destroy();
		host.remove();
		let refused = null;
		try { new Workspace(document.createElement("div"), { navigator, content: () => ({}), origin: "frustum" }); } catch (error) { refused = error.constructor.name; }
		return { added, refused };
	});
	assert.deepEqual(result, { added: 0, refused: "TypeError" });
});

test("notices sit in their source cell by default, or at the top with noticePlacement top", async () => {
	const result = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const place = async (options) => {
			const navigator = new Navigator({ destinations: window.fixture.destinations, root: "root", minViewportHeight: window.fixture.minViewportHeight, chrome: window.fixture.chrome });
			const frame = document.createElement("div");
			frame.style.cssText = "contain:layout;width:1000px;height:500px";
			const host = document.createElement("div");
			host.style.cssText = "width:1000px;height:500px";
			frame.append(host);
			document.body.append(frame);
			const workspace = new Workspace(host, { navigator, content: () => ({ element: document.createElement("div") }), overlayRoot: frame, ...options });
			workspace.navigate("gallery", { from: "root" });
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			workspace.notify({ id: "n", source: "root/gallery/list", kind: "action", message: "Hi", action: { label: "Ok", run() {} } });
			const element = frame.querySelector('[data-notice="n"]');
			const where = element.closest(".supermax-cell-notices") ? "cell" : element.closest(".supermax-notices") ? "top" : "elsewhere";
			workspace.destroy();
			frame.remove();
			return where;
		};
		let refused = null;
		try { new Workspace(document.createElement("div"), { navigator: new Navigator({ destinations: window.fixture.destinations, root: "root", minViewportHeight: window.fixture.minViewportHeight, chrome: window.fixture.chrome }), content: () => ({}), noticePlacement: "corner" }); } catch (error) { refused = error.constructor.name; }
		return { byDefault: await place({}), top: await place({ noticePlacement: "top" }), refused };
	});
	assert.deepEqual(result, { byDefault: "cell", top: "top", refused: "TypeError" });
});

test("notice icons are opt-out: line icons by default, a host function or null", async () => {
	const result = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const icons = async (options) => {
			const navigator = new Navigator({ destinations: window.fixture.destinations, root: "root", minViewportHeight: window.fixture.minViewportHeight, chrome: window.fixture.chrome });
			const frame = document.createElement("div");
			frame.style.cssText = "contain:layout;width:600px;height:400px";
			const host = document.createElement("div");
			host.style.cssText = "width:600px;height:400px";
			frame.append(host);
			document.body.append(frame);
			const workspace = new Workspace(host, { navigator, content: () => ({ element: document.createElement("div") }), overlayRoot: frame, ...options });
			workspace.notify({ id: "i", kind: "error", message: "Hi" });
			const icon = frame.querySelector('[data-notice="i"] .supermax-notice-icon');
			const found = icon ? icon.firstElementChild.tagName.toLowerCase() : null;
			workspace.destroy();
			frame.remove();
			return found;
		};
		let refused = null;
		try { new Workspace(document.createElement("div"), { navigator: new Navigator({ destinations: window.fixture.destinations, root: "root", minViewportHeight: window.fixture.minViewportHeight, chrome: window.fixture.chrome }), content: () => ({}), noticeIcon: "check" }); } catch (error) { refused = error.constructor.name; }
		return { byDefault: await icons({}), custom: await icons({ noticeIcon: (kind, document) => document.createElement("b") }), none: await icons({ noticeIcon: null }), refused };
	});
	assert.deepEqual(result, { byDefault: "svg", custom: "b", none: null, refused: "TypeError" });
});

test("a cell whose left edge stays put keeps its content in place while it widens, and starts a narrowing where it is", async () => {
	const frames = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div");
		host.style.cssText = "width:1180px;height:500px";
		document.body.append(host);
		const navigator = new Navigator({
			destinations: {
				menu: { title: "Menu", min: 195, max: 256 },
				mailboxes: { title: "Mailboxes", min: 259, max: 320 },
				list: { title: "List", min: 320, max: "*", preferred: 640 },
				detail: { title: "Detail", min: 320, max: 640 },
			},
			root: "menu",
			minViewportHeight: window.fixture.minViewportHeight,
			chrome: window.fixture.chrome,
		});
		const workspace = new Workspace(host, { navigator, content: (occurrence) => { const element = document.createElement("div"); element.textContent = occurrence.title; return { element }; } });
		workspace.sync(["menu", "mailboxes", "list", "detail"], { animate: false, origin: null });
		await new Promise((resolve) => requestAnimationFrame(resolve));
		const menu = () => host.querySelector('[data-occurrence="menu"]');
		const room = () => menu().closest(".supermax-room") ?? menu().parentElement;
		const measure = () => ({ room: Math.round(room().getBoundingClientRect().left), cell: Math.round(menu().getBoundingClientRect().left), width: Math.round(room().getBoundingClientRect().width) });
		const run = async (destinations) => {
			workspace.sync(destinations, { origin: null });
			await new Promise((resolve) => setTimeout(resolve, 60));
			const samples = [];
			for (const time of [0, 40, 80, 120, 160, 199]) {
				document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time + (animation.effect.getTiming().delay ?? 0); });
				samples.push(measure());
			}
			document.getAnimations().forEach((animation) => animation.finish());
			await new Promise((resolve) => setTimeout(resolve, 50));
			samples.push(measure());
			return samples;
		};
		const before = measure();
		const widen = await run(["menu", "mailboxes", "list"]);
		const narrow = await run(["menu", "mailboxes", "list", "detail"]);
		host.remove();
		return { before, widen, narrow };
	});
	const { before, widen, narrow } = frames;
	assert.ok(widen.at(-1).width > before.width, `the menu widens once the detail closes: ${before.width} to ${widen.at(-1).width}px`);
	for (const sample of widen) assert.ok(Math.abs(sample.cell - sample.room) <= 1, `while widening, the menu's content stays at its left edge: cell at ${sample.cell}px, room at ${sample.room}px`);
	assert.ok(Math.abs(narrow[0].cell - narrow[0].room) <= 1, `narrowing starts with the content where it was: cell at ${narrow[0].cell}px, room at ${narrow[0].room}px`);
	assert.ok(Math.abs(narrow.at(-1).cell - narrow.at(-1).room) <= 1, "and ends with it at its left edge");
});

test("a render that turns a widening back narrows the cell's content with its room instead of jumping at the end", async () => {
	const result = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div");
		host.style.cssText = "width:1180px;height:500px";
		document.body.append(host);
		const navigator = new Navigator({
			destinations: {
				menu: { title: "Menu", min: 195, max: 256 },
				mailboxes: { title: "Mailboxes", min: 259, max: 320 },
				list: { title: "List", min: 320, max: "*", preferred: 640 },
				detail: { title: "Detail", min: 320, max: 640 },
			},
			root: "menu",
			minViewportHeight: window.fixture.minViewportHeight,
			chrome: window.fixture.chrome,
		});
		const workspace = new Workspace(host, { navigator, content: (occurrence) => { const element = document.createElement("div"); element.textContent = occurrence.title; return { element }; } });
		const full = ["menu", "mailboxes", "list", "detail"];
		workspace.sync(full, { animate: false, origin: null });
		await new Promise((resolve) => requestAnimationFrame(resolve));
		const menu = () => host.querySelector('[data-occurrence="menu"]');
		workspace.sync(["menu", "mailboxes", "list"], { origin: null });
		await new Promise((resolve) => setTimeout(resolve, 120));
		workspace.sync(full, { origin: null });
		await new Promise((resolve) => setTimeout(resolve, 60));
		const widths = [];
		for (const time of [0, 100, 199]) {
			document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time + (animation.effect.getTiming().delay ?? 0); });
			widths.push(Math.round(menu().getBoundingClientRect().width));
		}
		document.getAnimations().forEach((animation) => animation.finish());
		await new Promise((resolve) => setTimeout(resolve, 50));
		widths.push(Math.round(menu().getBoundingClientRect().width));
		host.remove();
		return widths;
	});
	const [, , last, settled] = result;
	assert.ok(Math.abs(last - settled) <= 2, `the content's width at the end of the motion is its settled width, not a jump: ${result.join(", ")}px`);
});

test("a closing modal keeps its content until it has gone, and tells the content to stop writing at once", async () => {
	const result = await page.evaluate(async () => {
		const events = [];
		const modal = window.workspace.openModal({ title: "Edit", content: () => {
			const element = document.createElement("p");
			element.textContent = "Draft";
			return { element, leave: () => events.push(["leave", document.contains(element)]), dispose: () => events.push(["dispose", document.querySelector(".supermax-modal-layer") !== null]) };
		} }, { from: null });
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		window.workspace.closeModal("close");
		events.push(["closed"]);
		document.getAnimations().forEach((animation) => animation.finish());
		await new Promise((resolve) => setTimeout(resolve, 50));
		return { events, modal: !!modal };
	});
	assert.deepEqual(result.events, [["leave", true], ["closed"], ["dispose", false]], "leave runs while the dialog is still there, dispose only once it is gone");
});

test("every change of the zoom emits a zoom event, also when it ends because its cell closes or a restore puts it back", async () => {
	const events = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div");
		host.style.cssText = "width:1180px;height:500px";
		document.body.append(host);
		const navigator = new Navigator({
			destinations: {
				menu: { title: "Menu", min: 195, max: 256 },
				list: { title: "List", min: 320, max: "*", preferred: 640 },
				detail: { title: "Detail", min: 320, max: 640, zoomable: true },
			},
			root: "menu",
			minViewportHeight: window.fixture.minViewportHeight,
			chrome: window.fixture.chrome,
		});
		const workspace = new Workspace(host, { navigator, content: () => ({ element: document.createElement("div") }) });
		const seen = [];
		workspace.addEventListener("zoom", (event) => seen.push(event.detail.occurrence?.split("/").pop() ?? null));
		workspace.sync(["menu", "list", "detail"], { animate: false, origin: null });
		const zoomedOut = navigator.snapshot();
		workspace.zoom("menu/list/detail", { animate: false });
		const zoomedIn = navigator.snapshot();
		workspace.restore(zoomedOut);
		workspace.restore(zoomedIn);
		workspace.sync(["menu", "list"], { animate: false, origin: null });
		host.remove();
		return seen;
	});
	assert.deepEqual(events, ["detail", null, "detail", null], "zooming, restoring both ways and closing the zoomed cell each emit zoom once");
});

test("a compact rail with its own content leaves that content room inside the cell, with only the package stylesheet", async () => {
	const measured = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div");
		host.style.cssText = "width:700px;height:500px";
		document.body.append(host);
		const navigator = new Navigator({
			destinations: {
				menu: { title: "Mail", min: 195, max: 256, keep: true, compact: { min: 48 } },
				list: { title: "List", min: 320, max: "*", preferred: 640 },
				detail: { title: "Detail", min: 320, max: 640 },
			},
			root: "menu",
			minViewportHeight: window.fixture.minViewportHeight,
			chrome: window.fixture.chrome,
		});
		const workspace = new Workspace(host, {
			navigator,
			content: () => ({ element: document.createElement("div") }),
			compactContent: () => {
				const icons = document.createElement("div");
				icons.className = "test-icons";
				for (const letter of ["I", "X"]) { const button = document.createElement("button"); button.textContent = letter; icons.append(button); }
				return icons;
			},
		});
		workspace.sync(["menu", "list", "detail"], { animate: false, origin: null });
		await new Promise((resolve) => requestAnimationFrame(resolve));
		const cell = host.querySelector('[data-occurrence="menu"]');
		const compact = cell.querySelector(".supermax-compact").getBoundingClientRect();
		const icons = [...cell.querySelectorAll(".test-icons button")].map((button) => button.getBoundingClientRect());
		const result = { compact: cell.classList.contains("is-compact"), bottom: Math.round(compact.bottom), icons: icons.map((rect) => Math.round(rect.bottom)), widths: icons.map((rect) => Math.round(rect.width)) };
		host.remove();
		return result;
	});
	assert.equal(measured.compact, true, "the menu shows as a rail");
	assert.ok(measured.icons.every((bottom) => bottom <= measured.bottom), `its icons stay inside the cell: icons end at ${measured.icons}, the rail at ${measured.bottom}px`);
	assert.ok(measured.widths.every((width) => width > 0), "and take room");
});

test("a sync that carries the zoom replaces a zoomed cell in one render, without showing the cells before it", async () => {
	const result = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div");
		host.style.cssText = "width:1180px;height:500px";
		document.body.append(host);
		const navigator = new Navigator({
			destinations: {
				menu: { title: "Menu", min: 195, max: 256 },
				list: { title: "List", min: 320, max: "*", preferred: 640 },
				"messages:1": { title: "Messages 1", min: 320, max: 640, zoomable: true },
				"messages:2": { title: "Messages 2", min: 320, max: 640, zoomable: true },
			},
			root: "menu",
			minViewportHeight: window.fixture.minViewportHeight,
			chrome: window.fixture.chrome,
		});
		const workspace = new Workspace(host, { navigator, content: () => ({ element: document.createElement("div") }) });
		workspace.sync(["menu", "list", "messages:1"], { animate: false, origin: null, zoom: "messages:1" });
		const renders = [];
		workspace.addEventListener("render", (event) => renders.push(event.detail.layout.cells.get("menu/list")?.visible ?? false));
		workspace.sync(["menu", "list", "messages:2"], { animate: false, origin: null, zoom: "messages:2" });
		const zoomed = navigator.zoomed;
		host.remove();
		return { renders, zoomed };
	});
	assert.deepEqual(result.renders, [false], "one render, in which the list stays hidden behind the zoom");
	assert.equal(result.zoomed, "menu/list/messages:2");
});
