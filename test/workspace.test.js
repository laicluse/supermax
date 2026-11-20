import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { chromium } from "playwright";
import { albums, depthCount, depthId, paths } from "../docs/assets/album.js";
import { encodeLog } from "../docs/assets/deeplink.js";
import { serveDocs } from "./serve-docs.js";

const coast = paths(albums[0]);
const open = (destination, from) => ({ type: "open", destination, from });
const THREE_ROWS = [open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails")), open("coast:photo:b", coast.row("map")), open("coast:photo:c", coast.row("people"))];

let server;
let browser;
let page;
const errors = [];

before(async () => {
	server = await serveDocs();
	browser = await chromium.launch({ channel: "chrome", headless: true });
	page = await browser.newPage({ viewport: { width: 1720, height: 900 } });
	page.on("pageerror", (error) => errors.push(error.message));
});

after(async () => {
	await browser?.close();
	await server?.close();
	assert.deepEqual(errors, [], "no page errors during the scenarios");
});

beforeEach(async () => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
});

const PRESENTATION = process.env.SUPERMAX_PRESENTATION ?? "slide";

async function openDemo(log = []) {
	await page.goto("about:blank");
	await page.goto(`${server.url}/${PRESENTATION === "slide" ? "" : `?presentation=${PRESENTATION}`}${log.length ? `#${encodeLog(log)}` : ""}`);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	await settle();
}

const frame = (key) => `.frame[data-frame="${key}"]`;
const inFrame = (key, selector) => selector.split(", ").map((part) => `${frame(key)} ${part}`).join(", ");
const readout = (key, part) => `${frame(key)} + .readout .readout-${part}`;

async function settle() {
	await page.waitForFunction(() => window.supermaxDemo.pending === 0 && !document.querySelector(".supermax-cell.is-loading"));
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
	await page.waitForFunction(() => document.getAnimations().length === 0 && window.supermaxDemo.pending === 0 && !document.querySelector(".supermax-cell.is-loading"));
}

async function state(key) {
	return page.evaluate((frameKey) => window.supermaxDemo.frames.find((candidate) => candidate.key === frameKey).workspace.navigator.state(), key);
}

async function groups(key) {
	return (await state(key)).groups.map((group) => group.title);
}

async function backButton(key) {
	return page.locator(inFrame(key, ".supermax-back")).evaluate((button) => ({ disabled: button.disabled, label: button.getAttribute("aria-label"), text: button.textContent }));
}

async function resize(sizes) {
	await page.evaluate((next) => window.supermaxDemo.resize(next), sizes);
	await page.waitForFunction((expected) => window.supermaxDemo.frames.every((candidate, index) => candidate.workspace.navigator.size.width === expected[index][0] - 2 && candidate.workspace.navigator.size.height === expected[index][1] - 2), sizes);
	await settle();
}

async function boxes(selector) {
	return page.locator(selector).evaluateAll((elements) => elements.map((element) => {
		const rectangle = element.getBoundingClientRect();
		return { id: element.dataset.occurrence ?? element.dataset.row ?? element.className, left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height, visible: getComputedStyle(element).visibility === "visible" && rectangle.width > 0 };
	}));
}

const activeOccurrence = () => page.evaluate(() => document.activeElement?.closest?.(".supermax-cell")?.dataset.occurrence ?? document.activeElement?.tagName);
const collapsedRows = (key) => page.locator(inFrame(key, ".supermax-row")).evaluateAll((elements) => elements.map((element) => element.classList.contains("is-collapsed")));

test("the start state names the end of history and both frames receive a click", async () => {
	await openDemo();
	assert.deepEqual(await backButton("a"), { disabled: true, label: "Back: nothing to close", text: "Back" });
	await page.click(inFrame("a", '.album-item[data-destination="album:coast"]'));
	await settle();
	assert.ok((await state("a")).occurrences.includes(coast.metadata("thumbnails", "a")), "the wide frame auto-opens metadata once its layout metadata has arrived");
	assert.ok(!(await state("b")).occurrences.includes(coast.photo("thumbnails", "a")), "the narrow frame keeps the default as a manual choice");
	assert.equal((await backButton("a")).label, "Back closes Coast");
	assert.equal((await backButton("b")).label, "Back closes Coast");
	assert.equal(page.url().split("#")[1], "o:album:coast@albums");
	assert.equal(await activeOccurrence(), coast.album, "the click moves focus to the opened content in the origin frame");
});

test("an explicit click on auto-open content promotes it here and is rejected where its source is closed", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"] .metadata-link`));
	await settle();
	assert.deepEqual(await groups("a"), ["Coast", "Metadata A"]);
	assert.deepEqual(await groups("b"), ["Coast"]);
	assert.equal(await page.locator(readout("b", "rejection")).textContent(), "Rejected here: Photo A is closed in this frame.");
	assert.equal(page.url().split("#")[1], `o:album:coast@albums;o:coast:metadata:a@${coast.photo("thumbnails", "a")}?title=Metadata+A&min=200&max=320&preferred=220`, "an action applied in one frame enters the log with its hint, so a reload can open it before its definition loads");
});

test("frames diverge on what one Back closes and the demo does not equalise them", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("b", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:a"]`));
	assert.deepEqual(await groups("b"), ["Coast", "Photo A"]);
	assert.deepEqual(await groups("a"), ["Coast", "Photo A"], "the auto-opened photo is promoted in the wide frame");
	assert.equal(await activeOccurrence(), coast.photo("thumbnails", "a"), "focus follows the opened photo in the narrow frame");
	await settle();
	const narrowChain = await page.locator(inFrame("b", `[data-occurrence="${coast.row("thumbnails")}"], [data-occurrence="${coast.photo("thumbnails", "a")}"]`)).evaluateAll((elements) => elements.map((element) => element.classList.contains("is-compact")));
	assert.deepEqual(narrowChain, [true, false], "the narrow row makes the selector compact for the photo");
	await page.click(inFrame("b", ".supermax-back"));
	assert.deepEqual(await groups("b"), ["Coast"]);
	assert.ok((await state("b")).occurrences.includes(coast.row("thumbnails")));
	const wide = await state("a");
	assert.deepEqual(wide.groups.map((group) => group.title), ["Coast"]);
	assert.ok(!wide.occurrences.includes(coast.metadata("thumbnails", "a")), "the wide frame closed Photo A together with its automatic metadata");
	assert.equal(await activeOccurrence(), coast.row("thumbnails"), "Back returns focus to the selector of the closed group");
});

test("a deeplink opens three rows in both frames; a fresh navigation replays it and a reload restores it", async () => {
	await openDemo(THREE_ROWS);
	for (const key of ["a", "b"]) assert.deepEqual(await groups(key), ["Coast", "Photo A", "Photo B", "Photo C"], `frame ${key}`);
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:d"]`));
	await settle();
	const live = { a: await state("a"), b: await state("b") };
	const url = page.url();
	await page.goto("about:blank");
	await page.goto(url);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	await settle();
	assert.deepEqual(await state("a"), live.a, "a fresh navigation replays the wide frame after clicks");
	assert.deepEqual(await state("b"), live.b, "a fresh navigation replays the narrow frame after clicks");
	await page.click("[data-reset]");
	await page.waitForFunction(() => !location.hash);
	await resize([[600, 640], [420, 640]]);
	await page.click(inFrame("a", '.album-item[data-destination="album:coast"]'));
	const narrowLive = await state("a");
	assert.ok(!narrowLive.occurrences.includes(coast.photo("thumbnails", "a")), "at 600px the photo did not auto-open");
	await page.reload();
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	assert.deepEqual(await state("a"), narrowLive, "a reload restores the stored snapshot although the frame is wide again");
});

test("the Back control names content in another row than the focus, also when hidden", async () => {
	await openDemo(THREE_ROWS);
	assert.deepEqual(await backButton("a"), { disabled: false, label: "Back closes Photo C", text: "BackPhoto C" });
	await page.focus(inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"] .caption`));
	assert.equal((await backButton("a")).label, "Back closes Photo C");
	assert.equal(await page.locator(inFrame("a", ".supermax-title-text")).textContent(), "Photo A", "the title follows the focused content");
	await resize([[420, 400], [420, 640]]);
	assert.equal((await backButton("a")).label, "Back closes Photo C", "the target stays named while its row is collapsed");
});

test("rows span the split and no cell crosses a row", async () => {
	await openDemo(THREE_ROWS);
	const rows = await boxes(inFrame("a", ".supermax-row"));
	const split = (await boxes(inFrame("a", ".supermax-cell.is-split")))[0];
	assert.equal(rows.length, 3);
	for (const current of rows) {
		assert.ok(Math.abs(current.width - split.width) <= 1, "rows span the split width");
		assert.ok(Math.abs(current.left - split.left) <= 1, "rows start at the split column");
	}
	for (const cell of (await boxes(inFrame("a", ".supermax-row .supermax-cell"))).filter((candidate) => candidate.visible)) {
		assert.ok(rows.some((current) => cell.top >= current.top - 0.5 && cell.top + cell.height <= current.top + current.height + 0.5), `cell ${cell.id} stays inside one row`);
	}
	const navbar = await page.locator(inFrame("a", ".supermax-navbar")).evaluate((element) => element.getBoundingClientRect().height);
	assert.equal(navbar, 44, "the rendered navbar matches the chrome the model computes with");
});

test("collapse thresholds keep navigation, draft and scroll, and the content cell scrolls by wheel", async () => {
	await openDemo(THREE_ROWS);
	const captionSelector = inFrame("a", `[data-occurrence="${coast.photo("people", "c")}"] .caption`);
	const metadataBody = inFrame("a", `[data-occurrence="${coast.metadata("people", "c")}"] .supermax-cell-body`);
	await page.fill(captionSelector, "Lighthouse at dusk");
	const metadataBox = await page.locator(metadataBody).boundingBox();
	await page.mouse.move(metadataBox.x + metadataBox.width / 2, metadataBox.y + metadataBox.height / 2);
	await page.mouse.wheel(0, 120);
	await page.waitForFunction((selector) => document.querySelector(selector).scrollTop > 0, metadataBody);
	const scrolled = await page.locator(metadataBody).evaluate((body) => body.scrollTop);
	const before = await state("a");
	await resize([[420, 400], [420, 640]]);
	const after = await state("a");
	assert.deepEqual({ occurrences: after.occurrences, groups: after.groups }, { occurrences: before.occurrences, groups: before.groups }, "collapse thresholds rewrite no navigation state");
	assert.equal(await activeOccurrence(), coast.photo("people", "c"), "focus moves to the rail of the cell that went compact");
	assert.deepEqual(await collapsedRows("a"), [true, true, false], "top rows collapse first");
	assert.equal(await page.locator(inFrame("a", ".supermax-row-tab:not([hidden])")).count(), 2, "collapsed rows show a tab");
	const chain = await page.locator(inFrame("a", `[data-occurrence="${coast.row("people")}"], [data-occurrence="${coast.photo("people", "c")}"], [data-occurrence="${coast.metadata("people", "c")}"]`)).evaluateAll((elements) => elements.map((element) => element.classList.contains("is-compact")));
	assert.deepEqual(chain, [true, true, false], "the narrow row makes the selector and the photo compact and keeps the newest cell full");
	assert.equal(await page.inputValue(captionSelector), "Lighthouse at dusk", "the draft survives the collapse");
	await page.click(inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"] .supermax-row-tab`));
	await settle();
	assert.deepEqual(await collapsedRows("a"), [false, true, true], "a tab opens its row");
	assert.equal(await activeOccurrence(), coast.row("thumbnails"), "the tab focuses the row's first visible cell, here a compact rail");
	const afterFocus = await state("a");
	assert.deepEqual({ occurrences: afterFocus.occurrences, groups: afterFocus.groups }, { occurrences: before.occurrences, groups: before.groups });
	await resize([[960, 640], [420, 640]]);
	assert.equal(await page.locator(metadataBody).evaluate((body) => body.scrollTop), scrolled, "the scroll position survives collapse and return");
	assert.equal(await page.inputValue(captionSelector), "Lighthouse at dusk");
});

test("below the declared minimum the focused row keeps its height and the workspace scrolls", async () => {
	await openDemo(THREE_ROWS);
	const visible = await page.locator(inFrame("b", ".supermax-cell")).evaluateAll((elements) => elements
		.filter((element) => getComputedStyle(element).visibility === "visible")
		.map((element) => ({ id: element.dataset.occurrence, width: element.getBoundingClientRect().width })));
	const minima = await page.evaluate(() => {
		const model = window.supermaxDemo.frames[1].workspace.navigator;
		return Object.fromEntries([...model.occurrences.values()].map((occurrence) => {
			const definition = model.definitionOf(occurrence.destination);
			const compact = model.layout && window.supermaxDemo.frames[1].workspace.findCell(occurrence.id)?.compact;
			return [occurrence.id, compact ? definition.compact.min : definition.min];
		}));
	});
	for (const cell of visible) assert.ok(cell.width >= minima[cell.id], `${cell.id} is not narrower than its own minimum`);
	await resize([[960, 640], [420, 260]]);
	assert.equal(await page.locator(readout("b", "limit")).isHidden(), false, "the readout says the frame is below the minimum");
	assert.equal(Math.round(await page.locator(inFrame("b", ".supermax-row.is-focused")).evaluate((element) => element.getBoundingClientRect().height)), 180);
	assert.equal(await page.locator(inFrame("b", ".supermax-body")).evaluate((body) => body.scrollHeight > body.clientHeight), true);
	await resize([[960, 640], [420, 640]]);
	assert.equal(await page.locator(readout("b", "limit")).isHidden(), true);
});

test("browser back restores the state before the last action, also after a resize", async () => {
	await openDemo([open("album:coast", "albums")]);
	const captionSelector = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"] .caption`);
	await page.fill(captionSelector, "Fog bank");
	const wideBefore = await state("a");
	await resize([[600, 640], [420, 640]]);
	await page.click(inFrame("b", `[data-occurrence="${coast.row("map")}"] .pin[data-destination="coast:photo:b"]`));
	assert.deepEqual(await groups("a"), ["Coast", "Photo B"]);
	await page.goBack();
	await page.waitForFunction(() => !location.hash.includes("photo:b"));
	const restored = await state("a");
	assert.deepEqual({ occurrences: restored.occurrences, groups: restored.groups }, { occurrences: wideBefore.occurrences, groups: wideBefore.groups }, "the wide frame returns to the occurrences it had, not to a replay at the new width");
	assert.deepEqual(await groups("b"), ["Coast"]);
	assert.equal(await page.inputValue(captionSelector), "Fog bank", "content that stayed open keeps its draft through history");
	await page.goForward();
	await page.waitForFunction(() => location.hash.includes("photo:b"));
	assert.deepEqual(await groups("b"), ["Coast", "Photo B"], "browser forward restores it");
	assert.equal(await page.inputValue(captionSelector), "Fog bank");
});

test("keyboard Back closes the group in both frames and focus returns to the selector", async () => {
	await openDemo(THREE_ROWS);
	await page.focus(inFrame("a", ".supermax-back"));
	await page.keyboard.press("Enter");
	assert.deepEqual(await groups("a"), ["Coast", "Photo A", "Photo B"]);
	assert.deepEqual(await groups("b"), ["Coast", "Photo A", "Photo B"], "the shared Back reaches the other frame");
	assert.equal(await activeOccurrence(), coast.row("people"));
	assert.equal(page.url().split("#")[1], `${encodeLog(THREE_ROWS)};b`);
});

test("keyboard opening in the narrow frame keeps focus on the opened content", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.focus(inFrame("b", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:a"]`));
	await page.keyboard.press("Enter");
	await settle();
	assert.equal(await activeOccurrence(), coast.photo("thumbnails", "a"), "focus follows the photo although its selector went compact");
	await resize([[960, 640], [260, 640]]);
	assert.equal(await page.locator(inFrame("b", `[data-occurrence="${coast.row("thumbnails")}"]`)).evaluate((element) => getComputedStyle(element).visibility), "hidden", "at 260px the selector hides behind a chip");
	await page.click(inFrame("b", `[data-occurrence="${coast.photo("thumbnails", "a")}"] .supermax-reveal.is-left`));
	await settle();
	assert.equal(await activeOccurrence(), coast.row("thumbnails"), "revealing focuses the revealed selector");
	const hidden = await boxes(inFrame("b", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`));
	assert.equal(hidden[0].visible, false, "the cell hidden by the reveal is not painted");
	assert.equal(await page.locator(inFrame("b", `[data-occurrence="${coast.row("thumbnails")}"] .supermax-reveal.is-right`)).textContent(), "Photo A");
});

const LONG_CHAIN = [open("album:coast", "albums"), { ...open("coast:history:a", coast.metadata("thumbnails", "a")), hint: { title: "History A" } }, { ...open("coast:edit:a:2", coast.history("thumbnails", "a")), hint: { title: "Crop 3:2 (A)", min: 200, max: 320 } }];

test("compact cells keep a long chain and the albums menu usable", async () => {
	await openDemo(LONG_CHAIN);
	const widths = await page.locator(inFrame("a", `[data-occurrence^="${coast.row("thumbnails")}"]`)).evaluateAll((elements) => elements.map((element) => [element.dataset.occurrence.split("/").pop(), Math.round(element.getBoundingClientRect().width), element.classList.contains("is-compact")]));
	assert.deepEqual(widths.map((entry) => entry[2]), [true, true, false, false, false], "the two oldest cells go compact, the rest stay full");
	assert.deepEqual(widths.slice(0, 2).map((entry) => entry[1]), [40, 40], "compact cells are 40px rails");
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .supermax-rail`)).getAttribute("aria-label"), "Peek Thumbnails");
	await page.click(inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"] .supermax-collapse`));
	await settle();
	const afterCollapse = await page.locator(inFrame("a", `[data-occurrence^="${coast.row("thumbnails")}"]`)).evaluateAll((elements) => elements.map((element) => [element.classList.contains("is-compact"), getComputedStyle(element).visibility === "visible" && element.getBoundingClientRect().width > 0]));
	assert.deepEqual(afterCollapse, [[true, true], [false, true], [true, true], [false, true], [false, true]], "the user's collapse counts first, one automatic compact remains within the cap, and the chain fits again");
	await page.hover(inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"] .supermax-rail`));
	await page.waitForSelector(inFrame("a", ".supermax-peek .supermax-peek-expand"));
	await page.click(inFrame("a", ".supermax-peek .supermax-peek-expand"));
	await settle();
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"]`)).evaluate((element) => element.classList.contains("is-compact")), false, "Expand in the peek undoes the user's collapse");
	assert.equal(await activeOccurrence(), coast.metadata("thumbnails", "a"), "and focuses the expanded cell");
	assert.deepEqual(await groups("a"), ["Coast", "History A", "Crop 3:2 (A)"], "collapsing changes no group");
	assert.equal(await page.locator(inFrame("b", '[data-occurrence="albums"]')).evaluate((element) => element.classList.contains("is-compact")), true, "the narrow frame shows the albums menu as a rail");
	await page.click(inFrame("b", '.album-icon[data-destination="album:empty"]'));
	assert.deepEqual(await groups("b"), ["Empty album"], "an icon in the rail navigates");
	assert.deepEqual(await groups("a"), ["Empty album"], "and the other frame follows");
	await resize([[960, 640], [420, 360]]);
	assert.equal(await page.locator(inFrame("b", '[data-occurrence="albums"] .album-icon')).first().isVisible(), true, "at the supported minimum height the menu rail is still there");
});

test("a peek shows a compact cell's own content without touching history", async () => {
	await openDemo(LONG_CHAIN);
	const rail = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"] .supermax-rail`);
	const urlBefore = page.url();
	await page.hover(rail);
	await page.waitForSelector(inFrame("a", ".supermax-peek"));
	await page.fill(inFrame("a", ".supermax-peek .caption"), "Peeked draft");
	assert.deepEqual(await groups("a"), ["Coast", "History A", "Crop 3:2 (A)"]);
	assert.equal(page.url(), urlBefore, "a peek writes no history");
	await page.keyboard.press("Escape");
	await page.waitForSelector(inFrame("a", ".supermax-peek"), { state: "detached" });
	await page.waitForTimeout(250);
	assert.equal(await page.locator(inFrame("a", ".supermax-peek")).count(), 0, "Escape from inside the peek closes it and the rail's focus does not reopen it");
	assert.equal(await page.evaluate(() => document.activeElement?.className), "supermax-rail", "focus returns to the rail");
	await page.keyboard.press("Enter");
	await page.waitForSelector(inFrame("a", ".supermax-peek"));
	assert.equal(await page.evaluate(() => document.activeElement?.closest(".supermax-peek") !== null), true, "Enter on the rail opens the peek and moves focus into it");
	await page.mouse.move(5, 5);
	await page.waitForTimeout(350);
	assert.equal(await page.locator(inFrame("a", ".supermax-peek")).count(), 1, "the pointer leaving does not close a peek that holds the keyboard focus");
	await page.keyboard.press("Escape");
	await page.waitForSelector(inFrame("a", ".supermax-peek"), { state: "detached" });
	await page.mouse.move(5, 5);
	await page.waitForTimeout(100);
	await page.hover(rail);
	await page.waitForSelector(inFrame("a", ".supermax-peek"));
	await page.mouse.move(5, 5);
	await page.waitForSelector(inFrame("a", ".supermax-peek"), { state: "detached" });
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"] .caption`)).inputValue(), "Peeked draft", "the draft typed in the peek lives in the cell");
	await page.focus(inFrame("a", ".supermax-back"));
	await page.focus(rail);
	await page.waitForSelector(inFrame("a", ".supermax-peek"));
	await page.keyboard.press("Escape");
	await page.waitForSelector(inFrame("a", ".supermax-peek"), { state: "detached" });
	assert.equal(await page.evaluate(() => document.activeElement?.className), "supermax-rail", "Escape returns focus to the rail");
	await page.click(rail);
	await page.waitForSelector(inFrame("a", ".supermax-peek"));
	await page.click(rail);
	await page.waitForTimeout(250);
	assert.equal(await page.locator(inFrame("a", ".supermax-peek")).count(), 1, "a mouse click on the rail keeps a hovered peek open");
	await page.click(inFrame("a", ".supermax-peek .picture"));
	await page.waitForTimeout(250);
	assert.equal(await page.locator(inFrame("a", ".supermax-peek")).count(), 1, "a click on plain content inside the peek keeps it open");
	const tap = () => page.locator(rail).evaluate((element) => element.dispatchEvent(new PointerEvent("click", { pointerType: "touch", detail: 1, bubbles: true })));
	await tap();
	await page.waitForSelector(inFrame("a", ".supermax-peek"), { state: "detached" });
	await tap();
	await page.waitForSelector(inFrame("a", ".supermax-peek"));
	assert.equal(await page.locator(inFrame("b", ".supermax-peek")).count(), 0, "the peek is local to its frame");
	await page.focus(inFrame("a", ".supermax-peek .caption"));
	await page.keyboard.press("Escape");
	await page.waitForSelector(inFrame("a", ".supermax-peek"), { state: "detached" });
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .supermax-rail`));
	await page.waitForSelector(inFrame("a", ".supermax-peek"));
	await page.click(inFrame("a", '.supermax-peek .thumb[data-destination="coast:photo:d"]'));
	await page.waitForSelector(inFrame("a", ".supermax-peek"), { state: "detached" });
	assert.deepEqual(await groups("a"), ["Coast", "Photo D"], "a navigation from the peek is applied, replacing the deeper chain, and closes the peek");
	assert.deepEqual(await groups("b"), ["Coast", "Photo D"], "the other frame receives the same action");
});

test("dividers resize cells and rows within their bounds by pointer and keyboard, and reset to the app preference", async () => {
	await openDemo([open("album:coast", "albums")]);
	const photo = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`);
	const divider = inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"] .supermax-divider-handle[aria-label="Resize Photo A"]`);
	const widthOf = (selector) => page.locator(selector).evaluate((element) => Math.round(element.getBoundingClientRect().width));
	const before = await widthOf(photo);
	const box = await page.locator(divider).boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
	await page.mouse.up();
	assert.equal(await widthOf(photo), before + 60, "dragging the divider widens the photo by the drag distance");
	assert.equal(await page.locator(divider).getAttribute("aria-valuenow"), String(before + 60));
	assert.equal(await page.locator(inFrame("a", ".supermax-divider.is-sized .supermax-divider-reset")).count(), 1, "a divider with a session size shows its reset control");
	await page.focus(divider);
	await page.keyboard.press("ArrowLeft");
	assert.equal(await widthOf(photo), before + 44, "an arrow key moves the divider by 16px");
	await page.keyboard.press("End");
	const max = Number(await page.locator(divider).getAttribute("aria-valuemax"));
	assert.equal(await widthOf(photo), max, "End reaches the bound and stops there");
	await page.keyboard.press("ArrowRight");
	assert.equal(await widthOf(photo), max, "beyond the bound nothing moves and nothing complains");
	assert.ok(max <= 520, "the bound respects the cell's maximum");
	await resize([[900, 640], [420, 640]]);
	assert.equal(await page.locator(photo).evaluate((element) => element.closest(".supermax-chain").querySelector(".supermax-divider.is-sized") !== null), true, "the session size survives a frame resize");
	await page.evaluate((from) => window.supermaxDemo.frames[0].workspace.navigate("coast:photo:d", { from }), coast.row("thumbnails"));
	await settle();
	assert.equal(await page.locator(inFrame("a", ".supermax-divider.is-sized")).count(), 0, "a replaced cell takes its session size with it");
	await page.evaluate((from) => window.supermaxDemo.frames[0].workspace.navigate("coast:photo:a", { from }), coast.row("thumbnails"));
	await settle();
	const rowDivider = inFrame("a", '.supermax-divider.is-horizontal .supermax-divider-handle[aria-label="Resize Thumbnails"]');
	const rowOf = () => page.locator(inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"]`)).evaluate((element) => Math.round(element.getBoundingClientRect().height));
	const rowBefore = await rowOf();
	await page.focus(rowDivider);
	await page.keyboard.press("ArrowDown");
	assert.equal(await rowOf(), rowBefore + 16, "a row divider grows its row by keyboard");
	const rowBox = await page.locator(rowDivider).boundingBox();
	await page.mouse.move(rowBox.x + 50, rowBox.y + rowBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(rowBox.x + 50, rowBox.y + rowBox.height / 2 - 30, { steps: 4 });
	await page.mouse.up();
	assert.equal(await rowOf(), rowBefore + 16 - 30, "and by pointer");
	await page.focus(rowDivider);
	await page.keyboard.press("Backspace");
	assert.equal(await rowOf(), rowBefore, "Backspace on the divider restores the app preference");
	assert.equal(await page.locator(inFrame("a", ".supermax-divider.is-sized")).count(), 0);
	const frameHandle = await page.locator(frame("a")).evaluate((element) => getComputedStyle(element).resize);
	assert.equal(frameHandle, "both", "the frame handle is the browser's own resize control, not a divider");
	while ((await groups("a")).length > 0) { await page.click(inFrame("a", ".supermax-back")); await settle(); }
	await page.click(inFrame("a", '.album-item[data-destination="album:coast"]'));
	await settle();
	assert.ok((await page.locator(inFrame("a", ".supermax-divider.is-horizontal")).count()) >= 2, "reopening the same split brings its row dividers back");
});

test("remote cells open from hints, complete when their layout metadata arrives, and recover from failures", async () => {
	await openDemo();
	await resize([[1100, 640], [360, 640]]);
	await page.selectOption("[data-delay]", "400");
	await page.click(inFrame("a", '.album-item[data-destination="album:coast"]'));
	const thumbnailsRow = (id) => `[data-occurrence="${coast.row("thumbnails")}/${id}"]`;
	await page.waitForSelector(inFrame("a", thumbnailsRow("coast:photo:a")));
	assert.equal(await page.locator(inFrame("a", thumbnailsRow("coast:photo:a/coast:metadata:a"))).count(), 0, "a default whose layout metadata is still in flight has not opened yet");
	await settle();
	assert.ok((await state("a")).occurrences.includes(coast.history("thumbnails", "a")), "metadata and then its own history default open once their metadata arrives");
	assert.deepEqual(await groups("a"), ["Coast"], "late defaults join the group that opened the album");
	const requests = await page.evaluate(() => window.supermaxDemo.requests.map((request) => `${request.kind} ${request.id}`));
	assert.equal(requests.filter((entry) => entry === "manifest coast:metadata:a").length, 1, "three rows in two frames share one request per destination");
	const editCell = inFrame("a", `[data-occurrence="${coast.edit("thumbnails", "a", 2)}"]`);
	await page.click(inFrame("a", `[data-occurrence="${coast.history("thumbnails", "a")}"] .edit-item[data-destination="coast:edit:a:2"]`));
	await page.waitForSelector(`${editCell}.is-loading`);
	const loading = await page.locator(editCell).evaluate((element) => ({ title: element.querySelector(".supermax-cell-title").textContent, width: element.offsetWidth, status: element.querySelector(".supermax-loading").textContent }));
	assert.equal(loading.title, "Crop 3:2 (A)", "the hint names the cell while it loads");
	assert.equal(loading.status, "Loading Crop 3:2 (A)");
	assert.ok(loading.width >= 200 && loading.width <= 320, "the hint sizes the placeholder inside its bounds");
	await settle();
	const loaded = await page.locator(editCell).evaluate((element) => ({ viewer: element.querySelector(".viewer-line").textContent, width: element.offsetWidth, provisional: element.classList.contains("is-provisional") }));
	assert.equal(loaded.viewer, "Viewing as Ana");
	assert.equal(loaded.width, loading.width, "the loaded cell keeps the placeholder's width, nothing jumps");
	assert.equal(loaded.provisional, false);
	assert.deepEqual(await groups("a"), ["Coast", "Crop 3:2 (A)"], "the hinted opening is one group, completed in place");
	await page.selectOption("[data-fail]", "content");
	await page.click(inFrame("a", `[data-occurrence="${coast.history("thumbnails", "a")}"] .edit-item[data-destination="coast:edit:a:3"]`));
	await settle();
	const failedCell = inFrame("a", `[data-occurrence="${coast.edit("thumbnails", "a", 3)}"]`);
	assert.equal(await page.locator(`${failedCell} .supermax-error strong`).textContent(), "Warm tint (A) could not load.", "a failed content request shows its error in the cell");
	assert.deepEqual(await groups("a"), ["Coast", "Warm tint (A)"], "the navigation itself stands, so Back still closes it");
	await page.selectOption("[data-fail]", "");
	await page.click(`${failedCell} .supermax-retry`);
	await settle();
	assert.equal(await page.locator(`${failedCell} .viewer-line`).textContent(), "Viewing as Ana", "retry loads the content without a new navigation");
	assert.deepEqual(await groups("a"), ["Coast", "Warm tint (A)"], "and adds no Back step");
	await page.selectOption("[data-delay]", "1500");
	await page.click(inFrame("a", `[data-occurrence="${coast.row("map")}"] [data-destination="coast:photo:b"]`));
	await page.click(inFrame("a", ".supermax-back"));
	await page.waitForTimeout(1700);
	await settle();
	assert.ok(!(await state("a")).occurrences.includes(coast.metadata("map", "b")), "layout metadata arriving after Back opens nothing");
	await page.selectOption("[data-delay]", "0");
	await page.selectOption("[data-context]", "ben");
	await settle();
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"] .viewer-line`)).textContent(), "Viewing as Ben (read-only)", "a context switch reloads remote content in place");
	await page.click(inFrame("a", `[data-occurrence="${coast.row("people")}"] [data-destination="coast:photo:c"]`));
	await settle();
	assert.ok((await state("a")).occurrences.includes(coast.metadata("people", "c")), "Ben still gets metadata");
	assert.ok(!(await state("a")).occurrences.includes(coast.history("people", "c")), "but Ben's layout metadata declares no history default");
	await page.selectOption("[data-delay]", "400");
	await page.click(inFrame("a", `[data-occurrence="${coast.row("people")}"] [data-destination="coast:photo:d"]`));
	await page.selectOption("[data-context]", "ana");
	await settle();
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.metadata("people", "d")}"] .viewer-line`)).textContent(), "Viewing as Ana", "a response for the old viewer is discarded, the new viewer's content lands");
	assert.equal(await page.locator(inFrame("a", ".viewer-line")).evaluateAll((elements) => elements.filter((element) => element.textContent.includes("Ben")).length), 0, "no cell keeps the old viewer");
	const before = await page.evaluate(() => window.supermaxDemo.requests.length);
	await page.hover(inFrame("a", `[data-occurrence="${coast.history("thumbnails", "a")}"] .edit-item[data-destination="coast:edit:a:1"]`));
	await page.waitForFunction((count) => window.supermaxDemo.requests.length > count, before);
	await settle();
	assert.equal(await page.evaluate(() => window.supermaxDemo.requests.at(-1).id), "coast:edit:a:1", "hovering an item prefetches its layout metadata");
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.edit("thumbnails", "a", 1)}"]`)).count(), 0, "without opening anything");
	await page.selectOption("[data-context]", "ben");
	await settle();
	while ((await groups("a")).length > 0) { await page.click(inFrame("a", ".supermax-back")); await settle(); }
	await page.click(inFrame("a", '.album-item[data-destination="album:coast"]'));
	await settle();
	assert.ok((await state("a")).occurrences.includes(coast.metadata("thumbnails", "a")), "reopening as Ben still shows metadata");
	assert.ok(!(await state("a")).occurrences.includes(coast.history("thumbnails", "a")), "and does not reuse the layout metadata that Ana loaded earlier");
});

test("a modal knows its source, traps the keyboard, closes before Back and returns focus to a usable place", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	const modal = inFrame("a", ".supermax-modal");
	const photoCell = (row) => inFrame("a", `[data-occurrence="${coast.photo(row, "a")}"]`);
	const urlBefore = page.url();
	await page.selectOption("[data-delay]", "400");
	await page.click(`${photoCell("thumbnails")} .caption-edit`);
	assert.equal(await page.locator(`${modal} .supermax-modal-title`).textContent(), "Caption for Photo A");
	assert.equal(await page.locator(`${modal} .supermax-modal-context`).textContent(), "From Photo A", "the modal names its source");
	assert.equal(await page.locator(`${modal} .supermax-loading`).textContent(), "Loading Caption for Photo A", "delayed modal content uses the loading state");
	await settle();
	assert.equal(await page.locator(`${modal} .viewer-line`).textContent(), "Editing as Ana");
	const inside = () => page.evaluate(() => document.activeElement?.closest(".supermax-modal") !== null);
	assert.equal(await inside(), true, "focus moves into the modal");
	for (let step = 0; step < 6; step += 1) {
		await page.keyboard.press("Tab");
		assert.equal(await inside(), true, "Tab cycles inside the modal");
	}
	await page.keyboard.press("Shift+Tab");
	assert.equal(await inside(), true);
	assert.equal(await page.locator(inFrame("a", ".supermax-body")).getAttribute("inert"), "", "the cells behind the modal are inert");
	await page.keyboard.press("Escape");
	assert.equal(await page.locator(modal).count(), 0, "Escape closes the modal");
	assert.equal(await page.evaluate(() => document.activeElement?.className), "metadata-link caption-edit", "focus returns to the control that opened it");
	assert.equal(page.url(), urlBefore, "a modal writes no history");
	await page.selectOption("[data-delay]", "0");
	await page.click(`${photoCell("people")} .caption-edit`);
	await settle();
	await page.fill(`${modal} .caption-editor-field`, "Dunes at dusk");
	await page.click(`${modal} button[type="submit"]`);
	assert.equal(await page.locator(modal).count(), 0, "saving closes the modal");
	assert.equal(await page.locator(`${photoCell("people")} .caption`).inputValue(), "Dunes at dusk", "the modal wrote into its own source cell");
	assert.equal(await page.locator(`${photoCell("thumbnails")} .caption`).inputValue(), "", "and not into the same photo in another row");
	assert.equal(await activeOccurrence(), coast.photo("people", "a"));
	await page.click(`${photoCell("people")} .caption-edit`);
	await settle();
	await page.evaluate(() => window.supermaxDemo.frames[0].workspace.openModal({ title: "Second", content: () => ({ element: document.createElement("p") }) }, {}));
	assert.equal(await page.locator(modal).count(), 1, "a second open request replaces the modal");
	assert.equal(await page.locator(`${modal} .supermax-modal-title`).textContent(), "Second");
	const groupsBefore = await groups("a");
	await page.click(inFrame("a", ".supermax-back"));
	assert.equal(await page.locator(modal).count(), 0, "the shared Back closes the modal first");
	assert.deepEqual(await groups("a"), groupsBefore, "and navigates nothing");
	await page.click(inFrame("a", `[data-occurrence="${coast.row("map")}"] [data-destination="coast:photo:b"]`));
	await settle();
	await page.click(`${inFrame("a", `[data-occurrence="${coast.photo("map", "b")}"]`)} .caption-edit`);
	await settle();
	await page.click(inFrame("b", ".supermax-back"));
	await settle();
	assert.equal(await page.locator(`${modal} .supermax-modal-context`).textContent(), "Its source has closed", "a source closed from elsewhere is named as such");
	await page.click(`${modal} .supermax-modal-close`);
	assert.equal(await page.locator(modal).count(), 0);
	assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), "BODY", "closing without a source still lands on a usable control");
	await page.click(`${photoCell("people")} .caption-edit`);
	await settle();
	await resize([[1100, 400], [360, 640]]);
	await page.evaluate((row) => window.supermaxDemo.frames[0].workspace.focusRow(row), coast.row("thumbnails"));
	await settle();
	assert.equal(await page.locator(inFrame("a", `.supermax-row[data-row="${coast.row("people")}"]`)).evaluate((element) => element.classList.contains("is-collapsed")), true, "the source row is collapsed behind the modal");
	await page.keyboard.press("Escape");
	assert.equal(await page.evaluate(() => document.activeElement?.className), "supermax-row-tab", "closing onto a collapsed source focuses its row tab");
	await resize([[1100, 640], [360, 640]]);
	await page.click(inFrame("b", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:a"]`));
	await settle();
	await page.click(inFrame("b", `[data-occurrence="${coast.photo("thumbnails", "a")}"] .metadata-link:not(.caption-edit)`));
	await settle();
	const railB = inFrame("b", `[data-occurrence="${coast.photo("thumbnails", "a")}"] .supermax-rail`);
	assert.equal(await page.locator(railB).count(), 1, "the narrow frame shows Photo A as a rail");
	await page.hover(railB);
	await page.waitForSelector(inFrame("b", ".supermax-peek"));
	await page.click(inFrame("b", ".supermax-peek .caption-edit"));
	await settle();
	assert.equal(await page.locator(inFrame("b", ".supermax-peek")).count(), 0, "opening a modal from a peek closes the peek");
	assert.equal(await page.locator(inFrame("b", ".supermax-modal .supermax-modal-context")).textContent(), "From Photo A");
	await page.keyboard.press("Escape");
	assert.equal(await page.evaluate(() => document.activeElement?.className), "supermax-rail", "closing onto a compact source focuses its rail");
	assert.equal(await page.locator(inFrame("b", ".supermax-peek")).count(), 0, "without opening a peek");
});

test("notices stay with their cell, move to the workspace when the source is out of view, and never steal focus", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	const photoA = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`);
	const cellNotice = `${photoA} .supermax-cell-notices .supermax-notice`;
	await page.focus(`${photoA} .caption`);
	await page.click(`${photoA} .caption-save`);
	await page.waitForSelector(cellNotice);
	assert.equal(await page.locator(`${cellNotice} .supermax-notice-text`).textContent(), "Caption saved", "a success notice appears inside its source cell");
	assert.equal(await page.locator(cellNotice).evaluate((element) => element.classList.contains("is-success")), true);
	assert.equal(await page.evaluate(() => document.activeElement?.className), "metadata-link caption-save", "the notice takes no focus");
	const narrowNotice = inFrame("b", ".supermax-notices .supermax-notice");
	assert.equal(await page.locator(`${narrowNotice} .supermax-notice-text`).textContent(), "Photo A (not open): Caption saved", "where the source is not open the workspace notice names it");
	assert.equal(await page.locator(`${narrowNotice} .supermax-notice-go`).count(), 0, "and offers no way to reopen a closed source");
	await page.waitForSelector(cellNotice, { state: "detached", timeout: 6000 });
	assert.equal(await page.locator(narrowNotice).count(), 0, "success notices expire on their own");
	await page.evaluate(() => { const workspace = window.supermaxDemo.frames[0].workspace; workspace.notify({ id: "dup", scope: "workspace", kind: "action", message: "Once" }); workspace.notify({ id: "dup", scope: "workspace", kind: "action", message: "Once" }); });
	assert.equal(await page.locator(inFrame("a", '.supermax-notice[data-notice="dup"]')).count(), 1, "the same event id shows once");
	await page.click(inFrame("a", '.supermax-notice[data-notice="dup"] .supermax-notice-dismiss'));
	assert.equal(await page.locator(inFrame("a", '.supermax-notice[data-notice="dup"]')).count(), 0);
	await page.selectOption("[data-fail]", "content");
	await page.click(`${photoA} .caption-save`);
	await page.waitForSelector(`${cellNotice}.is-error`);
	assert.equal(await page.locator(`${cellNotice}.is-error`).getAttribute("role"), "alert");
	assert.match(await page.locator(`${cellNotice} .supermax-notice-text`).textContent(), /^Saving the caption failed/);
	await page.waitForTimeout(4500);
	assert.equal(await page.locator(`${cellNotice}.is-error`).count(), 1, "an error stays until it is dismissed or acted on");
	const noticesBefore = await page.locator(inFrame("a", ".supermax-notice")).count();
	await page.click(inFrame("a", `[data-occurrence="${coast.row("map")}"] [data-destination="coast:photo:c"]`));
	await settle();
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.metadata("map", "c")}"] .supermax-error`)).count(), 1, "the metadata cell failed to load");
	assert.equal(await page.locator(inFrame("a", ".supermax-notice")).count(), noticesBefore, "a cell error with Retry raises no notice of its own");
	await page.selectOption("[data-fail]", "");
	await page.click(`${cellNotice}.is-error .supermax-notice-action`);
	await page.waitForSelector(`${cellNotice}.is-success`);
	assert.equal(await page.locator(`${cellNotice}.is-error`).count(), 0, "acting on the error retires it");
	await page.evaluate((source) => window.supermaxDemo.frames[0].workspace.notify({ id: "keep", scope: "cell", source, kind: "action", message: "Review the crop", action: { label: "Open", run() {} } }), coast.photo("thumbnails", "a"));
	assert.equal(await page.locator(`${photoA} .supermax-cell-notices [data-notice="keep"]`).count(), 1);
	await resize([[1100, 400], [360, 640]]);
	await page.evaluate((row) => window.supermaxDemo.frames[0].workspace.focusRow(row), coast.row("people"));
	await settle();
	assert.equal(await page.locator(inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"]`)).evaluate((element) => element.classList.contains("is-collapsed")), true, "the source row collapsed");
	const moved = inFrame("a", '.supermax-notices [data-notice="keep"]');
	assert.equal(await page.locator(`${moved} .supermax-notice-text`).textContent(), "Photo A: Review the crop", "a notice whose source is out of view moves to the workspace and names it");
	await page.click(`${moved} .supermax-notice-go`);
	await settle();
	assert.equal(await page.locator(inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"]`)).evaluate((element) => element.classList.contains("is-collapsed")), false, "Show opens the row again");
	assert.equal(await activeOccurrence(), coast.photo("thumbnails", "a"), "and focuses the source");
	assert.equal(await page.locator(moved).count(), 0, "reaching the source retires the notice");
	await resize([[1100, 640], [360, 640]]);
	await page.click(inFrame("a", `[data-occurrence="${coast.row("people")}"] [data-destination="coast:photo:b"]`));
	await settle();
	await page.selectOption("[data-delay]", "400");
	await page.click(inFrame("a", `[data-occurrence="${coast.photo("people", "b")}"] .caption-save`));
	await page.click(inFrame("a", ".supermax-back"));
	await settle();
	await page.waitForSelector(inFrame("a", ".supermax-notices .supermax-notice.is-success"));
	assert.equal(await page.locator(inFrame("a", ".supermax-notices .supermax-notice.is-success .supermax-notice-text")).textContent(), "Photo B (not open): Caption saved", "a late response for a closed source lands in the workspace");
	assert.ok(!(await state("a")).occurrences.includes(coast.photo("people", "b")), "and does not reopen it");
	await page.selectOption("[data-delay]", "0");
	await page.waitForSelector(inFrame("a", ".supermax-notices .supermax-notice.is-success"), { state: "detached", timeout: 6000 });
	await page.click(inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"] .album-export`));
	const exportNotice = inFrame("a", ".supermax-notices .supermax-notice.is-action");
	assert.equal(await page.locator(`${exportNotice} .supermax-notice-text`).textContent(), "Metadata A: Export of Coast is ready");
	assert.equal(await page.locator(`${exportNotice} .supermax-notice-go`).count(), 0, "a source that is in view needs no Show control");
	await page.click(`${photoA} .caption-edit`);
	await settle();
	assert.equal(await page.locator(exportNotice).isVisible(), true, "a workspace notice stays visible above a modal");
	assert.equal(await page.evaluate(() => document.activeElement?.closest(".supermax-modal") !== null), true, "the modal keeps focus");
	const trapped = () => page.evaluate(() => { const active = document.activeElement; const frame = active?.closest('.frame[data-frame="a"]'); return !!frame && !!(active.closest(".supermax-modal") || active.closest(".supermax-notices")); });
	const cycle = await page.evaluate(() => { const frame = document.querySelector('.frame[data-frame="a"]'); const selector = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"; return [...frame.querySelector(".supermax-modal").querySelectorAll(selector), ...frame.querySelector(".supermax-notices").querySelectorAll(selector)].filter((element) => element.offsetParent !== null).length; });
	const startedAt = await page.evaluate(() => document.activeElement?.className);
	let reachedNotice = false;
	for (let step = 0; step < cycle; step += 1) {
		await page.keyboard.press("Tab");
		assert.equal(await trapped(), true, `Tab press ${step + 1} stays inside the modal or its notices`);
		reachedNotice = reachedNotice || await page.evaluate(() => document.activeElement?.closest(".supermax-notice") !== null);
	}
	assert.equal(reachedNotice, true, "one full cycle visits the notice");
	assert.equal(await page.evaluate(() => document.activeElement?.className), startedAt, "and returns to where it started");
	for (let step = 0; step < cycle; step += 1) {
		await page.keyboard.press("Shift+Tab");
		assert.equal(await trapped(), true, `Shift+Tab press ${step + 1} stays inside the modal or its notices`);
	}
	assert.equal(await page.evaluate(() => document.activeElement?.className), startedAt, "Shift+Tab cycles the same ring backwards");
	await page.focus(`${exportNotice} .supermax-notice-dismiss`);
	await page.keyboard.press("Escape");
	assert.equal(await page.locator(exportNotice).count(), 0, "Escape on a notice dismisses that notice");
	assert.equal(await page.locator(inFrame("a", ".supermax-modal")).count(), 1, "and leaves the modal open");
	assert.equal(await page.evaluate(() => document.activeElement?.closest(".supermax-modal") !== null), true, "with focus back inside it");
	await page.evaluate((source) => window.supermaxDemo.frames[0].workspace.notify({ id: "under-modal", scope: "cell", source, kind: "error", message: "Still here" }), coast.photo("thumbnails", "a"));
	assert.equal(await page.locator(inFrame("a", '.supermax-notices [data-notice="under-modal"]')).count(), 1, "a cell notice raised while a modal is open lands in the workspace region, where it is reachable");
	await page.keyboard.press("Escape");
	assert.equal(await page.locator(`${photoA} .supermax-cell-notices [data-notice="under-modal"]`).count(), 1, "closing the modal returns the cell notice to its cell");
	await page.click(`${photoA} [data-notice="under-modal"] .supermax-notice-dismiss`);
	await page.click(inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"] .album-export`));
	await page.click(`${exportNotice} .supermax-notice-action`);
	assert.equal(await page.locator(inFrame("a", ".supermax-notices .supermax-notice.is-success .supermax-notice-text")).last().textContent(), "Downloaded Coast.zip", "an action notice runs its action and retires");
	assert.equal(await page.locator(exportNotice).count(), 0);
});

const TWENTY_DEEP = Array.from({ length: depthCount }, (_, index) => open(depthId(index + 1), ["albums", ...Array.from({ length: index }, (_, step) => depthId(step + 1))].join("/")));

test("a second presentation replaces motion and surface while behaviour, interruption and reduced motion stay the same", async () => {
	await openDemo(THREE_ROWS);
	const workspaceClass = () => page.locator(frame("a") + " .supermax-workspace").evaluate((element) => [...element.classList].filter((name) => name.startsWith("supermax-presentation-")));
	assert.deepEqual(await workspaceClass(), [`supermax-presentation-${PRESENTATION}`], "the page starts in the requested presentation, slide by default");
	await page.selectOption("[data-presentation]", "slide");
	await settle();
	await page.focus(inFrame("a", `[data-occurrence="${coast.photo("map", "b")}"] .caption`));
	const focusedBefore = await activeOccurrence();
	const before = { state: await state("a"), layout: await page.evaluate(() => JSON.stringify(window.supermaxDemo.frames[0].workspace.layout)) };
	await page.evaluate(() => window.supermaxDemo.frames[0].workspace.setPresentation(window.supermaxDemo.presentations.fold));
	assert.equal(await activeOccurrence(), focusedBefore, "switching keeps keyboard focus on the same cell");
	await page.selectOption("[data-presentation]", "fold");
	await settle();
	assert.deepEqual(await workspaceClass(), ["supermax-presentation-fold"], "switching marks the workspace for the override's surface");
	assert.deepEqual(await state("a"), before.state, "switching changes no navigation state");
	assert.equal(await page.evaluate(() => JSON.stringify(window.supermaxDemo.frames[0].workspace.layout)), before.layout, "and no geometry");
	assert.equal(await page.locator(inFrame("a", ".supermax-cell")).first().evaluate((element) => getComputedStyle(element).boxShadow !== "none"), true, "the override's surface treatment applies");
	let changes = 0;
	await page.exposeFunction("countChange", () => { changes += 1; });
	await page.evaluate(() => window.supermaxDemo.frames[0].workspace.addEventListener("change", () => window.countChange()));
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:d"]`));
	assert.ok(await page.evaluate(() => document.getAnimations().some((animation) => animation.effect?.target?.closest?.(".supermax-cell") && String(animation.effect.getKeyframes?.()[0]?.transform ?? "").includes("rotateY"))), "the fold animates the entering cell with a rotation");
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:c"]`));
	const divider = inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"] .supermax-divider-handle[aria-label="Resize Photo C"]`);
	await page.waitForSelector(divider);
	const box = await page.locator(divider).boundingBox();
	await page.mouse.move(box.x + 4, box.y + 100);
	await page.mouse.down();
	await page.mouse.move(box.x + 44, box.y + 100, { steps: 4 });
	await page.mouse.up();
	await settle();
	await page.waitForTimeout(50);
	assert.deepEqual(await groups("a"), ["Coast", "Photo B", "Photo C", "Photo C"], "an interrupted opening lands on the last click");
	assert.equal(await page.locator(inFrame("a", "[data-supermax-exiting]")).count(), 0, "no cell lingers after the interruption");
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "d")}"]`)).count(), 0, "the replaced cell is gone");
	assert.equal(await page.locator(inFrame("a", ".supermax-divider.is-sized")).count(), 1, "a drag during the animation still stored its size");
	assert.equal(changes, 2, "two clicks are two change events, no more");
	assert.equal(await activeOccurrence(), coast.photo("thumbnails", "c"), "focus follows the last opened cell");
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:a"]`));
	assert.equal(await page.evaluate(() => document.getAnimations().length), 0, "reduced motion skips the fold entirely");
	assert.deepEqual((await groups("a")).slice(-1), ["Photo A"], "and reaches the same destination");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.selectOption("[data-presentation]", "slide");
	await settle();
	assert.deepEqual(await workspaceClass(), ["supermax-presentation-slide"]);
	assert.equal(await page.locator(inFrame("a", ".supermax-cell")).first().evaluate((element) => getComputedStyle(element).boxShadow), "none", "switching back removes the override surface");
	await page.selectOption("[data-presentation]", PRESENTATION);
});

test("a twenty-cell chain stays navigable in both presentations", async () => {
	await openDemo(TWENTY_DEEP);
	await resize([[960, 640], [420, 640]]);
	for (const key of ["a", "b"]) {
		const titles = await groups(key);
		assert.equal(titles.length, 20, `frame ${key} holds twenty groups`);
		assert.equal(titles[19], "Depth 20");
	}
	const chain = await page.locator(inFrame("a", '[data-occurrence^="albums/depth:1"]')).evaluateAll((elements) => elements.map((element) => ({ visible: getComputedStyle(element).visibility === "visible" && element.getBoundingClientRect().width > 0, compact: element.classList.contains("is-compact") })));
	assert.equal(chain.length, 20);
	assert.ok(chain.filter((cell) => cell.visible).length >= 3 && chain.filter((cell) => cell.visible).length < 20, "some cells are visible, the rest hidden behind reveal");
	assert.ok(chain.filter((cell) => cell.compact).length <= 2, "the compact cap holds in a long chain");
	assert.equal(await page.locator(inFrame("a", ".supermax-reveal.is-left")).textContent(), "Depth 15", "the reveal chip names the nearest hidden cell");
	await page.waitForFunction(() => document.querySelector('.frame[data-frame="a"] [data-spec-for$="/depth:20"] .cell-spec-state')?.textContent === "allocated");
	const spec = await page.locator(inFrame("a", '[data-spec-for$="/depth:20"]')).evaluate((element) => ({ hidden: element.hidden, text: [...element.querySelectorAll("dt")].map((term) => `${term.textContent} ${term.nextElementSibling.textContent}`) }));
	assert.equal(spec.hidden, false, "a cell with room shows its definition");
	assert.deepEqual(spec.text.slice(0, 4), ["id depth:20", "min 160", "max 240", "compact 36"]);
	assert.match(spec.text[4], /^width \d+ px$/);
	await page.selectOption("[data-presentation]", "fold");
	await settle();
	await page.focus(inFrame("a", ".supermax-back"));
	await page.keyboard.press("Enter");
	await settle();
	assert.equal((await groups("a")).length, 19, "keyboard Back closes the deepest group");
	await page.click(inFrame("a", ".supermax-reveal.is-left"));
	await settle();
	assert.equal(await page.locator(inFrame("a", ".supermax-reveal.is-right")).count(), 1, "revealing to the left hides the deepest cell behind a right chip");
	await page.evaluate((source) => window.supermaxDemo.frames[0].workspace.notify({ id: "deep-three", scope: "cell", source, kind: "action", message: "Look here", action: { label: "Ok", run() {} } }), "albums/depth:1/depth:2/depth:3");
	await page.click(inFrame("a", '.supermax-notices [data-notice="deep-three"] .supermax-notice-go'));
	await settle();
	assert.equal(await page.locator(inFrame("a", '[data-occurrence="albums/depth:1/depth:2/depth:3"]')).evaluate((element) => getComputedStyle(element).visibility === "visible" && element.getBoundingClientRect().width > 0), true, "Show reveals a cell hidden far to the left");
	assert.equal(await activeOccurrence(), "albums/depth:1/depth:2/depth:3", "and focuses it");
	assert.equal(await page.locator(inFrame("a", '[data-notice="deep-three"]')).count(), 0, "the notice retires once its source is reached");
	assert.ok((await page.locator(inFrame("a", '[data-occurrence^="albums/depth:1"]')).evaluateAll((elements) => elements.filter((element) => getComputedStyle(element).visibility === "visible" && element.getBoundingClientRect().width > 0).length)) > 1, "Show moves the window only as far as it must, keeping neighbours in view");
	await page.click(inFrame("a", ".supermax-back"));
	await settle();
	assert.equal((await groups("a")).length, 18);
	assert.equal(await page.locator(inFrame("a", "[data-supermax-exiting]")).count(), 0);
	const start = Date.now();
	await page.click("[data-reset]");
	await page.waitForFunction(() => !location.hash);
	assert.ok(Date.now() - start < 4000, "closing twenty cells is quick");
	assert.equal(await page.locator(inFrame("a", ".supermax-cell")).count(), 1, "only the root remains");
});

test("a layout definition that fails shows its error with Retry, and a prefetch never opens a cell", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	await page.selectOption("[data-fail]", "manifest");
	await page.click(inFrame("a", `[data-occurrence="${coast.row("people")}"] [data-destination="coast:photo:b"]`));
	await settle();
	assert.ok(!(await state("a")).occurrences.includes(coast.metadata("people", "b")), "a default whose layout definition failed does not open");
	await page.click(inFrame("a", `[data-occurrence="${coast.photo("people", "b")}"] .metadata-link:not(.caption-edit):not(.caption-save)`));
	await settle();
	const cell = inFrame("a", `[data-occurrence="${coast.metadata("people", "b")}"]`);
	assert.equal(await page.locator(`${cell} .supermax-error strong`).textContent(), "Metadata B could not load.", "a hinted cell whose definition fails says so");
	assert.equal(await page.locator(`${cell} .supermax-retry`).count(), 1, "with a Retry control");
	assert.deepEqual(await groups("a"), ["Coast", "Photo B", "Metadata B"], "the failed cell is still a Back step");
	await page.selectOption("[data-fail]", "");
	const requestsBefore = await page.evaluate(() => window.supermaxDemo.requests.length);
	await page.hover(inFrame("a", `[data-occurrence="${coast.photo("people", "b")}"] .metadata-link:not(.caption-edit):not(.caption-save)`));
	await page.waitForTimeout(250);
	await settle();
	assert.equal(await page.evaluate(() => window.supermaxDemo.requests.length), requestsBefore, "hovering a link to an open cell requests nothing new");
	await page.click(`${cell} .supermax-retry`);
	await settle();
	assert.equal(await page.locator(`${cell} .viewer-line`).textContent(), "Viewing as Ana", "Retry fetches the definition and the content");
	assert.deepEqual(await groups("a"), ["Coast", "Photo B", "Metadata B"], "without a new Back step");
	await page.click(inFrame("a", ".supermax-crumb:has-text('Coast')"));
	await settle();
	assert.equal(await activeOccurrence(), coast.album, "a crumb in the title context focuses that ancestor");
	await page.focus(inFrame("a", `[data-occurrence="${coast.photo("people", "b")}"] .caption`));
	await page.keyboard.press("Alt+ArrowLeft");
	await settle();
	assert.deepEqual(await groups("a"), ["Coast", "Photo B", "Metadata B"], "inside a text field Alt+ArrowLeft stays a text shortcut");
	await page.focus(`${cell}`);
	await page.keyboard.press("Alt+ArrowLeft");
	await settle();
	assert.deepEqual(await groups("a"), ["Coast", "Photo B"], "Alt+ArrowLeft on a cell is Back");
});

test("reset restores both frames and clears the URL", async () => {
	await openDemo(THREE_ROWS);
	await page.click("[data-reset]");
	await page.waitForFunction(() => !location.hash);
	for (const key of ["a", "b"]) {
		assert.deepEqual(await state(key), { occurrences: ["albums"], groups: [], focused: "albums" }, `frame ${key}`);
		assert.equal((await backButton(key)).disabled, true);
	}
});

test("empty and rejected albums are told apart and keep the workspace usable", async () => {
	await openDemo();
	await page.click(inFrame("a", '.album-item[data-destination="album:empty"]'));
	assert.equal(await page.locator(inFrame("a", ".empty-state")).first().textContent(), "No photos in this album.");
	await page.click(inFrame("a", '.album-item[data-destination="album:lab-over"]'));
	assert.equal(await page.locator(inFrame("a", '.album-item[data-destination="album:lab-over"] + .album-note')).textContent(), "This album needs a taller window than the app supports. Pick another album.");
	assert.deepEqual(await groups("a"), ["Empty album"], "a rejected album leaves the open album in place");
	assert.equal(await page.locator(readout("a", "rejection")).textContent(), "Rejected: row Gallery needs 361px (76px chrome), supported 360px.");
	assert.equal(page.url().split("#")[1], "o:album:empty@albums", "an action rejected everywhere stays out of the log");
	await page.click(inFrame("a", '.album-item[data-destination="album:lab-fit"]'));
	assert.deepEqual(await groups("a"), ["Lab: exact fit"]);
	assert.equal(await page.locator(inFrame("a", '.album-item[data-destination="album:lab-over"] + .album-note')).isHidden(), true, "the note clears after the next successful opening");
});

test("hostile deeplinks are rejected without breaking the page", async () => {
	await openDemo([open("album:coast", "albums"), open("coast:thumbnails", coast.album), { type: "back" }, open("constructor", "albums")]);
	assert.deepEqual(await groups("a"), [], "the row root could not be promoted, so Back closed the album");
	assert.equal(await page.locator(readout("a", "rejection")).textContent(), "Rejected: constructor is not a destination here.");
	assert.equal(page.url().split("#")[1], "o:album:coast@albums;b", "only applied actions survive in the URL");
});

test("a scenario button that every frame refuses leaves the URL untouched", async () => {
	await openDemo();
	await page.click("[data-scenarios] .scenario:has-text(\"Lab: one pixel over\")");
	await page.waitForFunction(() => document.querySelector('.frame[data-frame="a"] + .readout .readout-rejection')?.textContent.includes("Gallery"));
	assert.equal(page.url().includes("#"), false);
	assert.deepEqual(await groups("a"), []);
});

test("a row tab works by keyboard and does not steal the protected row on mousedown", async () => {
	await openDemo(THREE_ROWS);
	await page.focus(inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"] .caption`));
	await resize([[960, 400], [420, 640]]);
	assert.deepEqual(await collapsedRows("a"), [false, true, true], "the row holding the focus stays open");
	assert.equal(await activeOccurrence(), coast.photo("thumbnails", "a"), "focus is still in the caption");
	const tab = inFrame("a", `.supermax-row[data-row="${coast.row("people")}"] .supermax-row-tab`);
	await page.hover(tab);
	await page.mouse.down();
	assert.deepEqual(await collapsedRows("a"), [false, true, true], "pressing the mouse on a tab moves nothing");
	await page.mouse.up();
	await settle();
	assert.deepEqual(await collapsedRows("a"), [true, true, false], "the click opens the row");
	assert.equal(await activeOccurrence(), coast.row("people"), "focus lands on the row's first visible cell");
	await page.focus(inFrame("a", `.supermax-row[data-row="${coast.row("map")}"] .supermax-row-tab`));
	await page.keyboard.press("Enter");
	await settle();
	assert.deepEqual(await collapsedRows("a"), [true, false, true], "Enter on a focused tab opens its row");
	assert.equal(await activeOccurrence(), coast.row("map"), "focus lands in the opened row");
});

test("history restore that removes the focused cell hands focus to visible content", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("b", `[data-occurrence="${coast.row("map")}"] .pin[data-destination="coast:photo:b"]`));
	await page.focus(inFrame("b", `[data-occurrence="${coast.photo("map", "b")}"] .caption`));
	await page.goBack();
	await page.waitForFunction(() => !location.hash.includes("photo:b"));
	assert.equal(await activeOccurrence(), coast.row("map"), "focus moved to the selector that remains");
	assert.equal(await page.locator(inFrame("b", ".supermax-title-text")).textContent(), "Map", "the title follows the handed-over focus");
});

test("rows inside a split hidden by a reveal are not painted", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[960, 640], [300, 640]]);
	await page.click(inFrame("b", ".supermax-navbar .supermax-reveal.is-left"));
	await settle();
	const visibility = await page.locator(inFrame("b", `[data-occurrence="${coast.album}"] .supermax-row .supermax-cell`)).evaluateAll((elements) => [...new Set(elements.map((element) => getComputedStyle(element).visibility))]);
	assert.deepEqual(visibility, ["hidden"], "every cell inside the hidden split computes hidden");
	await page.click(inFrame("b", `[data-occurrence="albums"] .supermax-reveal.is-right`));
	await settle();
	assert.equal(await page.locator(inFrame("b", ".supermax-title-text")).textContent(), "Coast", "the title follows the reveal");
});

test("motion: an opening animates, an immediate Back leaves nothing behind, reduced motion animates nothing", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("a", `[data-occurrence="${coast.row("map")}"] .pin[data-destination="coast:photo:c"]`));
	assert.ok(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length) > 0);
	await page.click(inFrame("a", ".supermax-back"));
	await page.waitForFunction(() => document.getAnimations().length === 0);
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.photo("map", "c")}"]`)).count(), 0);
	assert.equal(await page.locator(inFrame("a", "[data-supermax-exiting]")).count(), 0);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.click(inFrame("a", `[data-occurrence="${coast.row("map")}"] .pin[data-destination="coast:photo:c"]`));
	assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
	await page.click(inFrame("a", ".supermax-back"));
	assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
});

test("a closing split keeps its rows until the exit finishes", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("a", ".supermax-back"));
	const during = await page.evaluate(() => {
		document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = 100; });
		const exiting = document.querySelector('.frame[data-frame="a"] [data-supermax-exiting]');
		return { exiting: !!exiting, rows: exiting?.querySelectorAll(".supermax-row").length ?? 0 };
	});
	assert.deepEqual(during, { exiting: true, rows: 3 }, "the departing album still carries its rows mid-exit");
	await settle();
	assert.equal(await page.locator(inFrame("a", ".supermax-row")).count(), 0, "rows are gone after the exit");
});

test("each frame resizes through its own handle and the readout follows", async () => {
	await openDemo();
	const otherBefore = await page.locator(frame("a")).boundingBox();
	const handleBefore = await page.locator(frame("b")).boundingBox();
	await page.mouse.move(handleBefore.x + handleBefore.width - 4, handleBefore.y + handleBefore.height - 4);
	await page.mouse.down();
	await page.mouse.move(handleBefore.x + handleBefore.width + 196, handleBefore.y + handleBefore.height - 104, { steps: 8 });
	await page.mouse.up();
	const handleAfter = await page.locator(frame("b")).boundingBox();
	assert.ok(handleAfter.width > handleBefore.width + 150, "the corner handle widens the frame");
	assert.ok(handleAfter.height < handleBefore.height - 50, "the corner handle shortens the frame");
	await page.waitForFunction((expected) => document.querySelector('.frame[data-frame="b"] + .readout .readout-size').textContent === expected, `${Math.round(handleAfter.width) - 2} × ${Math.round(handleAfter.height) - 2} px`);
	assert.deepEqual(await page.locator(frame("a")).boundingBox(), otherBefore, "resizing one frame leaves the other untouched");
});

test("destroy removes the shell, its listener and its properties", async () => {
	await openDemo([open("album:coast", "albums")]);
	const result = await page.evaluate(() => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const element = workspace.element;
		const before = workspace.navigator.focused;
		workspace.destroy();
		const probe = document.createElement("button");
		element.append(probe);
		probe.focus();
		return { children: element.childElementCount - 1, classes: element.className, cells: workspace.cells.size, navbarProperty: element.style.getPropertyValue("--supermax-navbar"), focusUnchanged: workspace.navigator.focused === before };
	});
	assert.deepEqual(result, { children: 0, classes: "frame-workspace", cells: 0, navbarProperty: "", focusUnchanged: true });
});
