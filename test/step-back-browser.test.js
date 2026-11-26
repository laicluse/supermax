import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openBrowser } from "./browser.js";
import { serveDocs } from "./serve-docs.js";

let server, browser, page;
before(async () => {
	server = await serveDocs();
	browser = await openBrowser();
	page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
	await page.goto(`${server.url}/blank`);
	await page.evaluate(async () => {
		const { Navigator, Workspace, TimeScale } = await import("/src/index.js");
		const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/src/workspace.css"; document.head.append(link);
		await new Promise((resolve) => { link.onload = resolve; });
		const host = document.createElement("div"); host.style.cssText = "width:1200px;height:400px"; window.host = host; document.body.append(host);
		window.destinations = {
			menu: { title: "Menu", min: 160, preferred: 200, max: 220, header: "title" },
			inbox: { title: "Inbox", min: 240, preferred: 320, max: "*", header: "title" },
			message: { title: "Invoice 0001", min: 300, preferred: 420, max: "*", header: "title", back: true },
			notes: { title: "Notes", min: 200, preferred: 240, max: 280, header: "title", back: true },
		};
		window.finish = async () => {
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			for (const animation of document.getAnimations()) animation.finish();
			await Promise.all([...workspace.chains.values()].map(({ strip }) => strip.finished));
		};
		window.mounts = 0;
		window.build = (chain, { set = destinations, root = "menu", options = {} } = {}) => {
			window.workspace?.destroy();
			const navigator = new Navigator({ root, minViewportHeight: 100, destinations: set });
			for (let index = 1; index < chain.length; index += 1) navigator.open(chain[index], { from: chain.slice(0, index).join("/") });
			window.workspace = new Workspace(host, { navigator, time: new TimeScale(1), ...options, content: (occurrence) => {
				window.mounts += 1;
				const element = document.createElement("div");
				element.textContent = occurrence.title;
				return { element };
			} });
		};
		window.controls = () => [...host.querySelectorAll(".supermax-cell")].map((cell) => {
			const up = cell.querySelector(":scope > .supermax-cell-title .supermax-up");
			return { cell: cell.dataset.occurrence, offered: !!up && !up.hidden, text: up?.textContent ?? "", label: up?.getAttribute("aria-label") ?? "", inLeading: !!up?.closest(".supermax-cell-title-leading") };
		}).filter((control) => control.offered);
	});
});
after(async () => { await browser?.close(); await server?.close(); });

const build = async (chain, width = 1200) => {
	await page.evaluate(([chain, width]) => { host.style.width = `${width}px`; build(chain); }, [chain, width]);
	await page.evaluate(() => finish());
};
const frames = (count = 4) => page.evaluate((count) => new Promise((resolve) => { const step = () => (count-- <= 0 ? resolve() : requestAnimationFrame(step)); step(); }), count);

test("a cell that declares back carries a step back in its leading part while its parent is in view", async () => {
	await build(["menu", "inbox", "message"]);
	assert.deepEqual(await page.evaluate(() => controls()), [
		{ cell: "menu/inbox/message", offered: true, text: "", label: "Back to Inbox", inLeading: true },
	], "only the message offers it: the inbox declares no back, and Show has nothing to bring back");
	const look = await page.evaluate(() => {
		const up = host.querySelector('[data-occurrence="menu/inbox/message"] .supermax-up');
		const chevron = up.querySelector(".supermax-up-label");
		return { className: up.className, chevron: !!chevron.querySelector("svg"), chevronMargin: getComputedStyle(chevron).marginRight };
	});
	assert.deepEqual(look, { className: "supermax-up", chevron: true, chevronMargin: "0px" }, "it is the Show control's own button and chevron, so a host renderer draws it the way it draws Show, without the gap a name would need");
});

test("only the trailing cell of a chain carries the step back, so a row of open cells shows one arrow", async () => {
	await build(["menu", "inbox", "message", "notes"]);
	assert.deepEqual((await page.evaluate(() => controls())).map((control) => `${control.cell}:${control.label}`), ["menu/inbox/message/notes:Back to Invoice 0001"], "the message declares back too, but the notes stand after it");
	assert.deepEqual(await page.evaluate(() => workspace.requestBack("menu/inbox/message")), { ok: false, reason: "no-step-back" }, "and requestBack refuses a cell that is not the trailing one");
	await page.click('[data-occurrence="menu/inbox/message/notes"] .supermax-up');
	await page.evaluate(() => finish());
	assert.deepEqual((await page.evaluate(() => controls())).map((control) => `${control.cell}:${control.label}`), ["menu/inbox/message:Back to Inbox"], "once the notes closed, the message is the trailing cell and carries it");
});

test("the step back closes the cell after asking through show, and the parent takes the room", async () => {
	await build(["menu", "inbox", "message"]);
	const refused = await page.evaluate(() => {
		const seen = [];
		const refuse = (event) => { seen.push(event.detail); event.preventDefault(); };
		workspace.addEventListener("show", refuse, { once: true });
		workspace.addEventListener("up", () => seen.push("up"), { once: true });
		host.querySelector('[data-occurrence="menu/inbox/message"] .supermax-up').click();
		return { seen: seen.map((entry) => entry === "up" ? entry : { shown: entry.shown.occurrence, closing: entry.closing.map((closing) => closing.destination), retry: typeof entry.retry }), open: workspace.navigator.get("menu/inbox/message") !== null };
	});
	assert.deepEqual(refused, { seen: [{ shown: "menu/inbox", closing: ["message"], retry: "function" }], open: true }, "a host that refuses keeps it open, and hears what would close");
	const closed = await page.evaluate(() => new Promise((resolve) => {
		workspace.addEventListener("up", (event) => resolve({ shown: event.detail.shown, closed: event.detail.closed.map((entry) => entry.destination) }), { once: true });
		host.querySelector('[data-occurrence="menu/inbox/message"] .supermax-up').click();
	}));
	assert.deepEqual(closed, { shown: "menu/inbox", closed: ["message"] }, "without a refusal it closes and up names it");
	await page.evaluate(() => finish());
	const after = await page.evaluate(() => ({ message: workspace.navigator.get("menu/inbox/message"), spare: workspace.layout.chains.get("menu").spare, controls: controls(), focus: workspace.navigator.focus().occurrence }));
	assert.deepEqual(after, { message: null, spare: 0, controls: [], focus: "menu/inbox" }, "the inbox is the tip, takes the width, and carries no control of its own");
});

test("a refused step back runs again through retry, which asks again", async () => {
	await build(["menu", "inbox", "message"]);
	const asked = await page.evaluate(() => {
		let retry;
		let questions = 0;
		const listener = (event) => {
			questions += 1;
			if (questions === 1) { retry = event.detail.retry; event.preventDefault(); }
		};
		workspace.addEventListener("show", listener);
		host.querySelector('[data-occurrence="menu/inbox/message"] .supermax-up').click();
		const before = workspace.navigator.get("menu/inbox/message") !== null;
		const result = retry();
		workspace.removeEventListener("show", listener);
		return { before, questions, result: result.ok, after: workspace.navigator.get("menu/inbox/message") !== null };
	});
	assert.deepEqual(asked, { before: true, questions: 2, result: true, after: false }, "the host confirms a discarded draft and repeats the same step back");
});

test("a cell that opened by itself steps back the same way and stays closed when the window widens", async () => {
	await build(["menu", "inbox"]);
	await page.evaluate(() => workspace.sync(["menu", "inbox"], { origin: null, ifRoom: [["message"]] }));
	await page.evaluate(() => finish());
	assert.equal(await page.evaluate(() => workspace.navigator.isAuto(workspace.navigator.get("menu/inbox/message"))), true, "the message opened as the inbox's default");
	assert.deepEqual((await page.evaluate(() => controls())).map((control) => control.label), ["Back to Inbox"]);
	await page.click('[data-occurrence="menu/inbox/message"] .supermax-up');
	await page.evaluate(() => finish());
	await page.evaluate(() => { host.style.width = "1600px"; });
	await page.evaluate(() => finish());
	assert.equal(await page.evaluate(() => workspace.navigator.get("menu/inbox/message")), null, "room alone never opens it again");
});

test("a default child steps back and stays closed when the window widens", async () => {
	await page.evaluate(() => { destinations.inbox = { ...destinations.inbox, defaultChild: "message" }; });
	try {
		await build(["menu"]);
		await page.evaluate(() => workspace.navigate("inbox", { from: "menu", origin: null }));
		await page.evaluate(() => finish());
		assert.equal(await page.evaluate(() => workspace.navigator.isAuto(workspace.navigator.get("menu/inbox/message"))), true, "the message opened as the inbox's default");
		await page.click('[data-occurrence="menu/inbox/message"] .supermax-up');
		await page.evaluate(() => finish());
		await page.evaluate(() => { host.style.width = "1600px"; });
		await page.evaluate(() => finish());
		assert.equal(await page.evaluate(() => workspace.navigator.get("menu/inbox/message")), null, "room alone never opens it again");
	} finally {
		await page.evaluate(() => { const { defaultChild, ...inbox } = destinations.inbox; destinations.inbox = { ...inbox, defaultChild: null }; });
	}
});

test("where the parent has left the window, the cell holds Show instead of a step back", async () => {
	await build(["menu", "inbox", "message"], 420);
	assert.deepEqual(await page.evaluate(() => controls()), [
		{ cell: "menu/inbox/message", offered: true, text: "Inbox", label: "Show Inbox", inLeading: true },
	], "one control in the slot: Show, which brings the inbox back");
});

test("a step back is not offered while the parent is folded, because the fold handle is its route", async () => {
	await page.evaluate(() => { destinations.menu = { ...destinations.menu, overflow: { mode: "keep" } }; });
	try {
		await build(["menu", "inbox", "message"], 560);
		const state = await page.evaluate(() => ({ inbox: workspace.findCell("menu/inbox").folded, controls: controls() }));
		assert.deepEqual(state, { inbox: true, controls: [{ cell: "menu", offered: true, text: "Inbox", label: "Show Inbox", inLeading: true }] }, "the message offers nothing; Show in the first cell reaches the folded inbox");
	} finally {
		await page.evaluate(() => { const { overflow, ...menu } = destinations.menu; destinations.menu = menu; });
	}
});

test("a refused Show retries the cell it named, and stops once that cell is in view", async () => {
	await page.evaluate(() => {
		host.style.width = "430px";
		build(["a", "b", "c"], { root: "a", set: { a: { title: "A", min: 370, max: 370 }, b: { title: "B", min: 240, max: 240 }, c: { title: "C", min: 300, preferred: 340, max: "*" } } });
	});
	await page.evaluate(() => finish());
	const asked = await page.evaluate(() => {
		let retry;
		let shown;
		workspace.addEventListener("show", (event) => { shown = event.detail.shown.occurrence; retry = event.detail.retry; event.preventDefault(); }, { once: true });
		workspace.requestUp();
		window.retryShow = retry;
		return shown;
	});
	assert.equal(asked, "a/b");
	await page.evaluate(() => { host.style.width = "1000px"; });
	await frames();
	await page.evaluate(() => finish());
	const result = await page.evaluate(() => ({ result: retryShow(), open: workspace.navigator.state().occurrences.length }));
	assert.deepEqual(result, { result: { ok: false, reason: "stale" }, open: 3 }, "B came into view by itself, so nothing closes for it, and A is never asked for instead");
});

test("a retry after the workspace was destroyed changes nothing", async () => {
	await build(["menu", "inbox", "message"]);
	const after = await page.evaluate(() => {
		let retry;
		workspace.addEventListener("show", (event) => { retry = event.detail.retry; event.preventDefault(); }, { once: true });
		host.querySelector('[data-occurrence="menu/inbox/message"] .supermax-up').click();
		const navigator = workspace.navigator;
		workspace.destroy();
		const before = window.mounts;
		const result = retry();
		window.workspace = null;
		return { result, mounted: window.mounts - before, open: navigator.get("menu/inbox/message") !== null };
	});
	assert.deepEqual(after, { result: { ok: false, reason: "destroyed" }, mounted: 0, open: true });
});

test("focus on the step back keeps it, also when the cell grows on focus and its parent gives way", async () => {
	await page.evaluate(() => {
		host.style.width = "760px";
		build(["menu", "list", "form"], { options: { growOnFocus: true }, set: {
			menu: { title: "Menu", min: 160, max: 160, overflow: { mode: "keep" }, header: "title" },
			list: { title: "List", min: 240, max: 240, header: "title" },
			form: { title: "Form", min: 300, preferred: 320, max: "*", growOnFocus: 600, back: true, header: "title" },
		} });
	});
	await page.evaluate(() => finish());
	await page.focus('[data-occurrence="menu/list/form"] .supermax-up');
	await frames(6);
	await page.evaluate(() => finish());
	const focused = await page.evaluate(() => ({ grown: workspace.findCell("menu/list").folded || !workspace.findCell("menu/list").full, focus: document.activeElement.getAttribute("aria-label"), controls: controls().map((control) => `${control.cell}:${control.label}`) }));
	assert.equal(focused.grown, true, "the form grew and the list gave way");
	assert.equal(focused.focus, "Back to List", "focus stays on the step back");
	assert.ok(focused.controls.includes("menu/list/form:Back to List"), `the form still offers the step back: ${focused.controls}`);
	await page.keyboard.press("Enter");
	await page.evaluate(() => finish());
	assert.equal(await page.evaluate(() => workspace.navigator.get("menu/list/form")), null, "Enter steps back");
});

test("a split that opened a cell inside its rows is not the trailing cell, so only that cell steps back", async () => {
	await page.evaluate(() => {
		host.style.width = "1200px";
		build(["list", "detail"], { root: "list", set: {
			list: { title: "List", min: 200, preferred: 240, max: 260, header: "title" },
			detail: { title: "Detail", rows: [{ destination: "row", minHeight: 60, maxHeight: "*", preferredHeight: 200 }], header: "title", back: true },
			row: { title: "Row", min: 200, preferred: 260, max: "*" },
			edit: { title: "Edit", min: 200, preferred: 240, max: 300, header: "title", back: true },
		} });
	});
	await page.evaluate(() => finish());
	assert.deepEqual((await page.evaluate(() => controls())).map((control) => `${control.cell}:${control.label}`), ["list/detail:Back to List"], "with nothing open in its rows, the split is the trailing cell");
	await page.evaluate(() => workspace.navigate("edit", { from: "list/detail/row", origin: null }));
	await page.evaluate(() => finish());
	assert.deepEqual((await page.evaluate(() => controls())).map((control) => `${control.cell}:${control.label}`), ["list/detail/row/edit:Back to Row"], "the cell in its row comes after it in reading order and carries the only arrow");
});
