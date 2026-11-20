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
		const bars = document.querySelectorAll(".supermax-navbar").length;
		window.workspace.navigate("gallery", { from: "root" });
		document.getElementById("host").style.height = "300px";
		return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
			document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).forEach((animation) => animation.finish());
			resolve({ bars, ...measureRows() });
		})));
		function measureRows() {
		return { rows: [...document.querySelectorAll(".supermax-row")].map((row) => row.getBoundingClientRect().height) };
		}
	});
	assert.equal(measured.bars, 0, "the workspace draws no bar of its own above the cells");
	assert.deepEqual(measured.rows, [0, 136, 136], "a row that does not fit takes no height at all, and the rows share what the split's own title bar leaves");
});

test("a split and a cell in its row that declares a title header each draw their own bar", async () => {
	const titles = await page.evaluate(() => ({
		split: document.querySelector('[data-occurrence="root/gallery"] > .supermax-cell-title .supermax-cell-title-text')?.textContent,
		row: document.querySelector('[data-occurrence="root/gallery/grid"] > .supermax-cell-title .supermax-cell-title-text')?.textContent ?? null,
	}));
	assert.deepEqual(titles, { split: "Gallery", row: "Grid" });
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
		return { regionInRoot, id, shown, afterDismiss: region.querySelectorAll(".supermax-notice").length, modal: workspace.modal };
	});
	assert.deepEqual(result, { regionInRoot: true, id: "notice-1", shown: 1, afterDismiss: 0, modal: null }, "notices live in the overlay root, the page by default, outside the cells");
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
		const dutch = new Workspace(host, { navigator, content: () => ({ element: document.createElement("div") }), overlayRoot: frame, strings: { up: (title) => `Toon ${title}`, notices: () => "Meldingen" } });
		const labels = {
			defaults: [window.workspace.strings.up("List"), window.workspace.notices.region.getAttribute("aria-label")],
			replaced: [dutch.strings.up("Lijst"), dutch.notices.region.getAttribute("aria-label")],
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
	assert.deepEqual(result.defaults, ["Show List", "Notices"], "a host that passes nothing gets the English defaults");
	assert.deepEqual(result.replaced, ["Toon Lijst", "Meldingen"], "a host replaces exactly the strings it names");
	assert.equal(result.untouched, "Retry", "every other string keeps its default");
	assert.equal(result.table, true);
	assert.deepEqual(result.failures, ['TypeError: Unknown Supermax string "navigaton"', 'TypeError: Supermax string "retry" must be a function that returns text']);
});

test("a host frustum renderer paints persistent shell geometry or leaves it unpainted", async () => {
 const result = await page.evaluate(async () => {
  const { Navigator, Workspace } = await import("/src/index.js");
  const host = document.createElement("div"); host.style.cssText="width:600px;height:400px";document.body.append(host);
  const navigator = new Navigator({destinations:window.fixture.destinations,root:"root",minViewportHeight:window.fixture.minViewportHeight,chrome:window.fixture.chrome});
  const paints=[];let mounts=0;
  const workspace = new Workspace(host,{navigator,content:()=>({element:document.createElement("div")}),renderer:{frustum({root}){mounts++;root.setAttribute("fill","gold");return {paint(geometry){paints.push(geometry);}};}}});
  workspace.openModal({title:"Custom",content:()=>({element:document.createElement("div")})},{from:"root"});workspace.drawOrigins();const first=mounts;workspace.drawOrigins();
  const result={stable:mounts===first,drawn:host.querySelectorAll('.supermax-frustum-face[fill="gold"]').length,geometry:paints.some(value=>value.from.width>0&&value.to.width>0)};workspace.destroy();host.remove();return result;
 });assert.equal(result.stable,true);assert.ok(result.drawn>0);assert.equal(result.geometry,true);
});

test("loading shows only a centered, accessibly named spinner in cells and modals", async () => {
	const result = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const frame = document.createElement("div");
		frame.style.cssText = "contain:layout;width:600px;height:400px";
		const host = document.createElement("div");
		host.style.cssText = "width:600px;height:400px";
		frame.append(host);
		document.body.append(frame);
		const navigator = new Navigator({ destinations: window.fixture.destinations, root: "root", minViewportHeight: window.fixture.minViewportHeight, chrome: window.fixture.chrome });
		const pending = () => new Promise(() => {});
		const workspace = new Workspace(host, { navigator, content: pending, overlayRoot: frame });
		const measure = (body) => {
			const status = body.querySelector(".supermax-loading");
			const mark = status.querySelector(".supermax-loading-mark");
			const area = body.getBoundingClientRect();
			const ring = mark.getBoundingClientRect();
			return { text: status.textContent, label: status.getAttribute("aria-label"), role: status.getAttribute("role"), x: Math.abs((area.left + area.width / 2) - (ring.left + ring.width / 2)), y: Math.abs((area.top + area.height / 2) - (ring.top + ring.height / 2)) };
		};
		const cell = measure(frame.querySelector('[data-occurrence="root"] .supermax-cell-body'));
		workspace.openModal({ title: "Details", content: pending }, { from: "root" });
		const modal = measure(frame.querySelector(".supermax-modal-body"));
		workspace.destroy();
		frame.remove();
		return { cell, modal };
	});
	for (const [kind, state] of Object.entries(result)) {
		assert.equal(state.text, "", `${kind} loading has no visible text`);
		assert.equal(state.role, "status");
		assert.ok(state.x <= 1 && state.y <= 1, `${kind} spinner is centered in its content area: ${JSON.stringify(state)}`);
	}
	assert.equal(result.cell.label, "Loading Root");
	assert.equal(result.modal.label, "Loading Details");
});

test("persistent notices keep an action visible through busy work until the host dismisses them", async () => {
	const initial = await page.evaluate(() => {
		const workspace = window.workspace;
		workspace.dismissAll();
		const temporary = workspace.notify({ id: "temporary", scope: "workspace", message: "Saved" });
		const duration = workspace.notices.notices.get(temporary).remaining;
		workspace.dismiss(temporary);
		const id = workspace.notify({
			id: "recovery", scope: "workspace", kind: "action", persistent: true,
			message: "Service is asleep",
			action: { label: "Start", run: (instance, noticeId) => {
				instance.updateNotice(noticeId, { message: "Starting service" });
				return new Promise((resolve) => { window.resolveRecovery = resolve; });
			} },
		});
		return { duration, id, remaining: workspace.notices.notices.get(id).remaining, duplicate: workspace.notify({ id, message: "Duplicate" }) };
	});
	assert.deepEqual(initial, { duration: 7000, id: "recovery", remaining: null, duplicate: null });
	const notice = page.locator('.supermax-notices [data-notice="recovery"]');
	await notice.locator(".supermax-notice-action").focus();
	await page.evaluate(() => window.workspace.updateNotice("recovery", { message: "Service is still asleep" }));
	assert.equal(await page.evaluate(() => document.activeElement?.className), "supermax-notice-action", "a status update preserves keyboard focus");
	await notice.locator(".supermax-notice-action").click();
	assert.equal(await notice.locator(".supermax-notice-text").textContent(), "Starting service");
	assert.equal(await notice.locator(".supermax-notice-controls").getAttribute("aria-busy"), "true", "busy state stays on the controls while text can be announced");
	assert.equal(await notice.locator(".supermax-notice-spinner").count(), 1);
	assert.equal(await notice.locator(".supermax-notice-action").getAttribute("aria-disabled"), "true", "the action cannot be repeated during work");
	assert.equal(await page.evaluate(() => document.activeElement?.className), "supermax-notice-action", "busy feedback keeps focus on the action");
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(await notice.locator(".supermax-notice-spinner").evaluate((element) => getComputedStyle(element).animationName), "none");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.waitForTimeout(80);
	assert.equal(await notice.count(), 1, "the persistent notice does not expire while work is pending");
	await page.evaluate(() => window.resolveRecovery());
	await page.waitForFunction(() => document.querySelector('[data-notice="recovery"] .supermax-notice-action'));
	assert.equal(await notice.locator(".supermax-notice-controls").getAttribute("aria-busy"), null);
	const resolved = await page.evaluate(() => {
		const workspace = window.workspace;
		const removed = workspace.dismiss("recovery", "resolved");
		const repeated = workspace.notify({ id: "recovery", scope: "workspace", message: "Service is asleep", persistent: true });
		workspace.dismiss(repeated);
		return { removed, repeated };
	});
	assert.deepEqual(resolved, { removed: true, repeated: "recovery" }, "a later incident can reuse the same stable id");
});

test("an old action cannot change a later notice with the same id", async () => {
	const result = await page.evaluate(async () => {
		const workspace = window.workspace;
		workspace.notify({ id: "same", scope: "workspace", kind: "action", persistent: true, message: "First", action: { label: "Go", run: () => new Promise((resolve) => { window.resolveFirstNotice = resolve; }) } });
		workspace.notices.region.querySelector('[data-notice="same"] .supermax-notice-action').click();
		workspace.dismiss("same");
		workspace.notify({ id: "same", scope: "workspace", kind: "action", persistent: true, busy: true, message: "Second" });
		const before = workspace.notices.notices.get("same").busy;
		window.resolveFirstNotice();
		await Promise.resolve();
		await Promise.resolve();
		const after = workspace.notices.notices.get("same").busy;
		workspace.dismiss("same");
		return { before, after };
	});
	assert.deepEqual(result, { before: true, after: true });
});

test("an event-driven persistent action stays open while the host owns its busy state", async () => {
	const result = await page.evaluate(() => {
		const workspace = window.workspace;
		workspace.notify({ id: "event", scope: "workspace", kind: "action", persistent: true, message: "Disconnected", action: { label: "Reconnect", run: (instance, id) => { instance.updateNotice(id, { message: "Connecting", busy: true }); } } });
		workspace.notices.region.querySelector('[data-notice="event"] .supermax-notice-action').click();
		const notice = workspace.notices.notices.get("event");
		const state = { active: !!notice, busy: notice.busy, text: notice.element.querySelector(".supermax-notice-text").textContent };
		workspace.dismiss("event", "resolved");
		return state;
	});
	assert.deepEqual(result, { active: true, busy: true, text: "Connecting" });
});

test("a temporary interactive notice pauses its timeout while its action is busy", async () => {
	await page.mouse.move(0, 0);
	const initial = await page.evaluate(() => {
		const workspace = window.workspace;
		workspace.notify({ id: "temporary-action", scope: "workspace", kind: "action", persistent: false, duration: 120, message: "Upload pending", action: { label: "Send", run: () => new Promise((resolve) => { window.finishTemporaryAction = resolve; }) } });
		workspace.notices.region.querySelector('[data-notice="temporary-action"] .supermax-notice-action').click();
		const notice = workspace.notices.notices.get("temporary-action");
		return { busy: notice.busy, remaining: notice.remaining };
	});
	assert.equal(initial.busy, true);
	assert.ok(initial.remaining > 0 && initial.remaining <= 120);
	await page.waitForTimeout(180);
	assert.equal(await page.locator('[data-notice="temporary-action"]').count(), 1, "the timeout stays paused past its original expiry");
	await page.evaluate(() => window.finishTemporaryAction());
	await page.waitForFunction(() => !window.workspace.notices.notices.has("temporary-action"));
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

test("the default notice renderer can be composed with host iconography", async () => {
	const result = await page.evaluate(async () => {
		const { Navigator, Workspace, DEFAULT_RENDERER } = await import("/src/index.js");
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
		try { new Workspace(document.createElement("div"), { navigator: new Navigator({ destinations: window.fixture.destinations, root: "root", minViewportHeight: window.fixture.minViewportHeight, chrome: window.fixture.chrome }), content: () => ({}), renderer: { notice: "check" } }); } catch (error) { refused = error.constructor.name; }
		const notice = (tag) => (context) => { const handle=DEFAULT_RENDERER.notice(context);return {update(state){handle.update(state);const icon=context.root.querySelector(".supermax-notice-icon");if(tag)icon.replaceChildren(context.document.createElement(tag));else icon.remove();}}; };
		return { byDefault: await icons({}), custom: await icons({ renderer: { notice: notice("b") } }), none: await icons({ renderer: { notice: notice(null) } }), refused };
	});
	assert.deepEqual(result, { byDefault: "svg", custom: "b", none: null, refused: "SupermaxRendererError" });
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
			document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).forEach((animation) => animation.finish());
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
		document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).forEach((animation) => animation.finish());
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
		document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).forEach((animation) => animation.finish());
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

test("a kept cell retains its declared minimum without a second presentation", async () => {
	const measured = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div");
		host.style.cssText = "width:370px;height:500px";
		document.body.append(host);
		const navigator = new Navigator({
			destinations: {
				menu: { title: "Mail", min: 48, max: 256, overflow: { mode: "keep" } },
				list: { title: "List", min: 320, max: "*", preferred: 640, overflow: { mode: "hide" } },
				detail: { title: "Detail", min: 320, max: 640 },
			},
			root: "menu",
			minViewportHeight: window.fixture.minViewportHeight,
			chrome: window.fixture.chrome,
		});
		const workspace = new Workspace(host, { navigator, content: () => ({ element: document.createElement("button") }) });
		workspace.sync(["menu", "list", "detail"], { animate: false, origin: null });
		await new Promise((resolve) => requestAnimationFrame(resolve));
		const cell = host.querySelector('[data-occurrence="menu"]');
		const result = { width: Math.round(cell.getBoundingClientRect().width), body: !!cell.querySelector(".supermax-cell-body button"), rail: !!cell.querySelector(".supermax-compact") };
		host.remove();
		return result;
	});
	assert.ok(measured.width >= 48, "the kept cell remains at its host-declared minimum");
	assert.equal(measured.body, true, "the host content stays in its own cell body");
	assert.equal(measured.rail, false, "Supermax adds no compact rail");
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


test("floating navigation stays at the top of a headless cell without intercepting its actions", async () => {
	await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div");
		host.id = "headless-navigation";
		host.style.cssText = "position:fixed;inset:0;width:390px;height:900px;background:white;z-index:1000";
		document.body.append(host);
		const navigator = new Navigator({ destinations: {
			feed: { title: "Feed", min: 200, max: 200, overflow: { mode: "hide" } },
			episode: { title: "Episode", min: 390, max: "*", preferred: 390 },
		}, root: "feed", minViewportHeight: 300, chrome: { maxRows: 4 } });
		window.headlessWorkspace = new Workspace(host, { navigator, content: () => {
			const element = document.createElement("div");
			const action = document.createElement("button");
			action.textContent = "Not interested";
			action.style.cssText = "position:absolute;top:430px;left:6px;height:40px";
			action.onclick = () => { action.textContent = "Dismissed"; };
			element.append(action);
			return { element };
		} });
		window.headlessWorkspace.sync(["feed", "episode"], { animate: false, origin: null });
	});
	try {
		const control = page.locator("#headless-navigation .supermax-up:not([hidden]).is-floating");
		await control.waitFor({ state: "visible" });
		const bounds = await control.boundingBox();
		assert.equal(bounds.y, 6);
		assert.ok(bounds.height >= 28 && bounds.height <= 44, `floating control height is ${bounds.height}`);
		await page.locator('#headless-navigation [data-occurrence="feed/episode"] button', { hasText: "Not interested" }).click({ timeout: 1000 });
		assert.equal(await page.getByRole("button", { name: "Dismissed", exact: true }).count(), 1);
		await control.click();
		assert.equal(await page.locator('#headless-navigation [data-occurrence="feed"]').isVisible(), true);
	} finally {
		await page.evaluate(() => { window.headlessWorkspace.destroy(); document.getElementById("headless-navigation").remove(); });
	}
});
