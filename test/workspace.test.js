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

const PRESENTATION = process.env.SUPERMAX_PRESENTATION ?? "origami";

async function openDemo(log = []) {
	await page.goto("about:blank");
	await page.goto(`${server.url}/?delay=0${PRESENTATION === "origami" ? "" : `&presentation=${PRESENTATION}`}${log.length ? `#${encodeLog(log)}` : ""}`);
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
	return page.locator(inFrame(key, ".supermax-up")).evaluate((button) => ({ hidden: button.hidden, label: button.getAttribute("aria-label"), text: button.textContent }));
}

async function closeNewest(key) {
	await page.evaluate((frameKey) => window.supermaxDemo.dispatch({ type: "close" }, window.supermaxDemo.frames.find((candidate) => candidate.key === frameKey).workspace), key);
}

async function resize(sizes) {
	await page.evaluate((next) => window.supermaxDemo.resize(next), sizes);
	await page.waitForFunction((expected) => window.supermaxDemo.frames.every((candidate, index) => candidate.workspace.navigator.size.width === expected[index][0] && candidate.workspace.navigator.size.height === expected[index][1]), sizes);
	await settle();
}

async function boxes(selector) {
	return page.locator(selector).evaluateAll((elements) => elements.map((element) => {
		const rectangle = element.getBoundingClientRect();
		return { id: element.dataset.occurrence ?? element.dataset.row ?? element.className, left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height, visible: getComputedStyle(element).visibility === "visible" && rectangle.width > 0 };
	}));
}

const activeOccurrence = () => page.evaluate(() => document.activeElement?.closest?.(".supermax-cell")?.dataset.occurrence ?? document.activeElement?.tagName);
const hiddenRows = (key) => page.locator(inFrame(key, ".supermax-row")).evaluateAll((elements) => elements.map((element) => element.classList.contains("is-hidden")));
const painted = (selector) => page.locator(selector).evaluate((element) => getComputedStyle(element).visibility === "visible" && element.getBoundingClientRect().width > 0);

test("the start state names the end of history and both frames receive a click", async () => {
	await openDemo();
	assert.deepEqual(await backButton("a"), { hidden: true, label: null, text: "‹" }, "with nothing out of view there is no Show control");
	await page.click(inFrame("a", '.album-item[data-destination="album:coast"]'));
	await settle();
	assert.ok((await state("a")).occurrences.includes(coast.metadata("thumbnails", "a")), "the wide frame auto-opens metadata once its layout metadata has arrived");
	assert.ok(!(await state("b")).occurrences.includes(coast.photo("thumbnails", "a")), "the narrow frame keeps the default as a manual choice");
	assert.equal((await backButton("a")).hidden, true, "Back stays away while every cell is in view");
	assert.equal(page.url().split("#")[1], "o:album:coast@albums");
	assert.equal(await activeOccurrence(), coast.row("thumbnails"), "the click moves focus into the opened album, to the first cell of its top row");
});

test("an explicit click on auto-open content promotes it here, and the other frame follows the same path", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"] .metadata-link`));
	await settle();
	assert.deepEqual(await groups("a"), ["Coast", "Metadata A"]);
	assert.deepEqual(await groups("b"), ["Coast", "Photo A", "Metadata A"], "the narrow frame never auto-opened Photo A, so it opens Photo A first and then the clicked metadata");
	assert.equal(await page.locator(readout("b", "rejection")).isHidden(), true, "nothing is refused");
	assert.equal(page.url().split("#")[1], `o:album:coast@albums;o:coast:metadata:a@${coast.photo("thumbnails", "a")}?title=Metadata+A&min=200&max=320&preferred=220`, "an action applied in one frame enters the log with its hint, so a reload can open it before its definition loads");
});

test("frames diverge on what closing the newest group closes and the demo does not equalise them", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("b", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:a"]`));
	assert.deepEqual(await groups("b"), ["Coast", "Photo A"]);
	assert.deepEqual(await groups("a"), ["Coast", "Photo A"], "the auto-opened photo is promoted in the wide frame");
	assert.equal(await activeOccurrence(), coast.photo("thumbnails", "a"), "focus follows the opened photo in the narrow frame");
	await settle();
	assert.deepEqual([await painted(inFrame("b", `[data-occurrence="${coast.row("thumbnails")}"]`)), await painted(inFrame("b", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`))], [false, true], "the narrow row hides the selector entirely for the photo");
	await closeNewest("b");
	assert.deepEqual(await groups("b"), ["Coast"]);
	assert.ok((await state("b")).occurrences.includes(coast.row("thumbnails")));
	const wide = await state("a");
	assert.deepEqual(wide.groups.map((group) => group.title), ["Coast"]);
	assert.ok(!wide.occurrences.includes(coast.metadata("thumbnails", "a")), "the wide frame closed Photo A together with its automatic metadata");
	assert.equal(await activeOccurrence(), coast.row("thumbnails"), "closing returns focus to the selector of the closed group");
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

test("the up control names the nearest hidden parent, closes what falls off the end to show it, and browser back undoes that", async () => {
	await openDemo(TWENTY_DEEP);
	await resize([[960, 640], [420, 640]]);
	assert.deepEqual(await backButton("a"), { hidden: false, label: "Show Depth 15", text: "‹Depth 15" });
	const before = { a: await groups("a"), b: await backButton("b"), bGroups: await groups("b"), url: page.url() };
	await page.focus(inFrame("a", ".supermax-up"));
	await page.keyboard.press("Enter");
	await settle();
	assert.deepEqual(await groups("a"), before.a.slice(0, -1), "Depth 20 closes so Depth 15 fits");
	assert.equal(page.url(), before.url, "the shared log does not change");
	assert.deepEqual([await backButton("b"), await groups("b")], [before.b, before.bGroups], "the other frame keeps its window and its cells");
	assert.equal(await activeOccurrence(), TWENTY_DEEP[14].from + "/depth:15", "the shown cell takes focus");
	assert.equal((await backButton("a")).label, "Show Depth 14");
	assert.equal(await page.locator(inFrame("a", ".supermax-title-text")).textContent(), "Depth 19", "the title names the deepest cell still open");
	assert.equal(await page.locator(inFrame("a", ".supermax-crumb")).last().textContent(), "Depth 18");
	const edges = await page.evaluate((id) => {
		const frame = document.querySelector('.frame[data-frame="a"]');
		return { menu: frame.querySelector('[data-occurrence="albums"]').getBoundingClientRect().right, revealed: frame.querySelector(`[data-occurrence="${id}"]`).getBoundingClientRect().left };
	}, TWENTY_DEEP[14].from + "/depth:15");
	assert.equal(Math.round(edges.revealed), Math.round(edges.menu), "the cells folded between the kept menu and the window take no room");
	assert.equal(await page.locator(inFrame("a", ".supermax-reveal, .supermax-row-tab, .supermax-collapse")).count(), 0, "no chip, tab or collapse control competes with it");
	await page.goBack();
	await page.waitForFunction(() => window.supermaxDemo.frames[0].workspace.navigator.state().groups.length === 20);
	await settle();
	assert.deepEqual(await groups("a"), before.a, "browser back returns to the moment before, with Depth 20 open again");
	assert.equal(await page.locator(inFrame("a", ".supermax-title-text")).textContent(), "Depth 20");
});

test("Back climbs the newest branch first, then the branch opened before it in another row", async () => {
	await openDemo([open("album:coast", "albums")]);
	assert.equal((await backButton("a")).hidden, true);
	await page.click(inFrame("a", `[data-occurrence="${coast.metadata("map", "a")}"] .metadata-link`));
	await settle();
	assert.equal((await backButton("a")).label, "Show Map", "opening History A in the Map row hides Map");
	await page.click(inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"] .metadata-link`));
	await settle();
	assert.equal((await backButton("a")).label, "Show Thumbnails", "the hidden parent of the newest branch comes back first");
	await page.click(inFrame("a", ".supermax-up"));
	await settle();
	assert.equal(await activeOccurrence(), coast.row("thumbnails"));
	assert.equal((await backButton("a")).label, "Show Map", "with that branch whole, the branch opened before it climbs next");
	await page.click(inFrame("a", ".supermax-up"));
	await settle();
	assert.equal(await activeOccurrence(), coast.row("map"));
	assert.equal(await painted(inFrame("a", `[data-occurrence="${coast.row("map")}"]`)), true);
	assert.equal((await backButton("a")).hidden, true, "with nothing above any branch out of view Back goes away");
	assert.deepEqual(await groups("a"), ["Coast"], "each step closed only the History A that had pushed its parent out");
});

test("a click in one frame reaches the other as the same new click, even after the up control closed cells there", async () => {
	await openDemo(TWENTY_DEEP);
	await resize([[960, 640], [420, 640]]);
	for (let step = 0; step < 8; step += 1) { await page.click(inFrame("a", ".supermax-up")); await settle(); }
	for (let step = 0; step < 3; step += 1) { await page.click(inFrame("b", ".supermax-up")); await settle(); }
	assert.equal((await groups("a")).length, 12);
	assert.equal((await groups("b")).length, 17, "each frame closed what its own size needed");
	await page.click(inFrame("a", `[data-occurrence="${TWENTY_DEEP[12].from}"] .depth-next`));
	await settle();
	assert.deepEqual(await groups("b"), await groups("a"), "the frame that still had Depth 13 to 17 open opens Depth 13 anew, so both end at the clicked cell");
	await page.click(inFrame("b", ".supermax-up"));
	await settle();
	await page.click(inFrame("b", ".supermax-up"));
	await settle();
	await page.click(inFrame("a", `[data-occurrence="${TWENTY_DEEP[13].from}"] .depth-next`));
	await settle();
	assert.equal(await page.locator(readout("b", "rejection")).isHidden(), true, "a source the other frame closed is opened there first instead of refusing the click");
	assert.deepEqual(await groups("b"), await groups("a"));
});

test("a modal sits front and centre in its own viewport and a frustum links it to its source", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("a", `[data-occurrence="${coast.photo("people", "a")}"] .caption-edit`));
	await settle();
	await page.waitForFunction(() => document.querySelector('.frame[data-frame="a"] .supermax-origin.is-modal .supermax-frustum-face'));
	const geometry = await page.evaluate(() => {
		const frame = document.querySelector('.frame[data-frame="a"]').getBoundingClientRect();
		const dialog = document.querySelector('.frame[data-frame="a"] .supermax-modal').getBoundingClientRect();
		return { dx: Math.round((dialog.left + dialog.width / 2) - (frame.left + frame.width / 2)), dy: Math.round((dialog.top + dialog.height / 2) - (frame.top + frame.height / 2)), inside: dialog.left >= frame.left && dialog.right <= frame.right && dialog.top >= frame.top && dialog.bottom <= frame.bottom };
	});
	assert.ok(Math.abs(geometry.dx) <= 1 && Math.abs(geometry.dy) <= 1 && geometry.inside, `the dialog is centred inside its frame (${geometry.dx}, ${geometry.dy})`);
	const faces = await page.locator(inFrame("a", ".supermax-origin.is-modal .supermax-frustum-face")).evaluateAll((elements) => elements.map((element) => element.getAttribute("class").split(" ").pop()));
	assert.ok(faces.length >= 1 && faces.length <= 2, `only the faces turned towards the viewer are drawn: ${faces.join(", ")}`);
	assert.equal(await page.locator(inFrame("b", ".supermax-modal")).count(), 0, "the other frame stays clear");
	await page.keyboard.press("Escape");
	assert.equal(await page.locator(inFrame("a", ".supermax-origin.is-modal")).count(), 0, "closing removes the frustum with the modal");
});

test("a modal opens at its preferred size, moves by its header and resizes only within its bounds and its viewport", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.evaluate(() => window.supermaxDemo.frames[0].workspace.openModal({ title: "Sized", min: 300, max: 520, preferred: 480, minHeight: 200, preferredHeight: 260, content: () => ({ element: document.createElement("p") }) }, {}));
	await settle();
	const dialog = inFrame("a", ".supermax-modal");
	const size = () => page.locator(dialog).evaluate((element) => { const box = element.getBoundingClientRect(); return { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) }; });
	const opened = await size();
	assert.deepEqual([opened.width, opened.height], [480, 260], "the preferred size within min and max");
	const header = await page.locator(`${dialog} .supermax-modal-title`).boundingBox();
	await page.mouse.move(header.x + 4, header.y + 4);
	await page.mouse.down();
	await page.mouse.move(header.x - 96, header.y + 64, { steps: 4 });
	await page.mouse.up();
	const moved = await size();
	assert.deepEqual([moved.left - opened.left, moved.top - opened.top], [-100, 60], "the header moves the dialog with the pointer");
	const resize = async (dx, dy) => {
		const box = await page.locator(dialog).boundingBox();
		await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width - 4 + dx, box.y + box.height - 4 + dy, { steps: 6 });
		await page.mouse.up();
		return size();
	};
	assert.equal((await resize(800, 0)).width, 520, "growing stops at max");
	assert.equal((await resize(-800, 0)).width, 300, "shrinking stops at min");
	const tall = await resize(0, 2000);
	const viewport = await page.locator(frame("a")).boundingBox();
	assert.ok(tall.top + tall.height <= viewport.y + viewport.height - 15, "growing stops at the viewport inset");
	await page.keyboard.press("Escape");
});

test("a modal wider than its viewport shrinks to fit inside the inset", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.evaluate(() => window.supermaxDemo.frames[1].workspace.openModal({ title: "Wide", min: 280, max: 720, preferred: 640, content: () => ({ element: document.createElement("p") }) }, {}));
	await settle();
	const viewport = await page.locator(frame("b")).boundingBox();
	const dialog = await page.locator(inFrame("b", ".supermax-modal")).boundingBox();
	assert.ok(viewport.width < 640, "the frame is narrower than the preferred width");
	assert.ok(Math.abs(dialog.x - viewport.x - 16) <= 1 && Math.abs(viewport.x + viewport.width - dialog.x - dialog.width - 16) <= 1, "the dialog keeps the inset on both sides");
	await page.keyboard.press("Escape");
});

test("cells stand one gutter apart over the canvas, and rows never run past their split", async () => {
	await openDemo(THREE_ROWS);
	const geometry = await page.evaluate(() => {
		const root = document.querySelector('.frame[data-frame="a"]');
		const cells = [...root.querySelectorAll(".supermax-cell")].filter((cell) => cell.getBoundingClientRect().width > 0 && getComputedStyle(cell).visibility !== "hidden");
		const split = root.querySelector(".supermax-cell.is-split").getBoundingClientRect();
		return {
			canvas: getComputedStyle(root.querySelector(".supermax-workspace")).backgroundColor,
			gutters: cells.map((cell) => [cell.dataset.occurrence.split("/").pop(), getComputedStyle(cell).borderLeftWidth]),
			rows: [...root.querySelectorAll(".supermax-row")].map((row) => getComputedStyle(row).borderTopWidth),
			overflow: cells.filter((cell) => cell.closest(".supermax-row")).some((cell) => cell.getBoundingClientRect().right > split.right + 0.5),
			radius: getComputedStyle(root.querySelector(".supermax-up")).borderRadius,
		};
	});
	assert.equal(geometry.canvas, "rgb(0, 0, 0)", "the canvas is black in light mode");
	assert.deepEqual(Object.fromEntries(geometry.gutters), {
		albums: "0px",
		"album:coast": "0px",
		"coast:thumbnails": "1px",
		"coast:photo:a": "1px",
		"coast:metadata:a": "1px",
		"coast:map": "1px",
		"coast:photo:b": "1px",
		"coast:metadata:b": "1px",
		"coast:people": "1px",
		"coast:photo:c": "1px",
		"coast:metadata:c": "1px",
	}, "one gutter before every cell but the first, the split passing its own to each row");
	assert.deepEqual(geometry.rows, ["0px", "1px", "1px"], "one gutter between rows");
	assert.equal(geometry.overflow, false);
	assert.equal(geometry.radius, "0px", "no rounded rectangles");
});

test("a chain whose cells all reach their maximum ends in empty surface, not canvas", async () => {
	await openDemo([open("album:coast", "albums")]);
	const ends = await page.evaluate(() => [...document.querySelectorAll('.frame[data-frame="b"] .supermax-row .supermax-chain')].map((chain) => {
		const strip = chain.querySelector(".supermax-strip");
		const box = chain.getBoundingClientRect();
		const spare = box.right - strip.getBoundingClientRect().right;
		const hit = document.elementFromPoint(box.right - 2, box.top + box.height / 2);
		return { spare, hit: hit === strip, fill: getComputedStyle(strip, "::after").backgroundColor, surface: (() => { const probe = chain.appendChild(document.createElement("i")); probe.style.background = "var(--supermax-surface)"; const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color; })() };
	}).filter((end) => end.spare > 4));
	assert.ok(ends.length > 0, "frame B has a row whose cells stop short of its edge");
	for (const end of ends) {
		assert.ok(end.hit, "the strip owns the space after its last cell");
		assert.equal(end.fill, end.surface, "that space shows the surface token");
	}
});

test("origami folds a new cell open, folds a closed one back in reverse, and turns a replaced cell over", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo(THREE_ROWS);
	const motion = () => page.evaluate(() => document.getAnimations().filter((animation) => animation.effect?.target?.matches?.('.frame[data-frame="a"] .supermax-cell')).map((animation) => ({
		cell: animation.effect.target.dataset.occurrence.split("/").pop(),
		leaving: animation.effect.target.hasAttribute("data-supermax-exiting"),
		direction: animation.effect.getTiming().direction,
		transforms: animation.effect.getKeyframes().map((frame) => frame.transform).filter(Boolean),
	})).filter((animation) => animation.transforms.some((transform) => transform.includes("rotate"))));
	await page.click(inFrame("a", '[data-occurrence$="coast:metadata:a"] .metadata-link:not(.album-export)'));
	await settle();
	await page.evaluate(() => window.supermaxDemo.dispatch({ type: "close" }, window.supermaxDemo.frames[0].workspace));
	const closing = await motion();
	assert.ok(closing.some((animation) => animation.leaving && animation.direction === "reverse" && animation.transforms.includes("rotateY(90deg)")), "the closed cell folds back on its hinge");
	await settle();
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:b"]`));
	const turning = await motion();
	assert.ok(turning.some((animation) => animation.leaving && animation.cell === "coast:photo:a" && animation.transforms.at(-1) === "rotateY(180deg)"), "the replaced cell turns away");
	assert.ok(turning.some((animation) => !animation.leaving && animation.cell === "coast:photo:b" && animation.transforms[0] === "rotateY(-180deg)"), "its successor is on the back");
	await settle();
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

test("hiding rows and cells keeps navigation, draft and scroll, and the content cell scrolls by wheel", async () => {
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
	assert.deepEqual({ occurrences: after.occurrences, groups: after.groups }, { occurrences: before.occurrences, groups: before.groups }, "hiding rewrites no navigation state");
	assert.deepEqual(await hiddenRows("a"), [true, true, false], "top rows hide entirely");
	assert.equal(await painted(inFrame("a", `[data-occurrence="${coast.photo("people", "c")}"]`)), false, "the narrow row hides the photo instead of squeezing it");
	assert.equal(await activeOccurrence(), coast.metadata("people", "c"), "focus moves to the content that stays in view");
	assert.equal(await page.inputValue(captionSelector), "Lighthouse at dusk", "the draft survives while its cell is hidden");
	await resize([[960, 640], [420, 640]]);
	assert.deepEqual(await hiddenRows("a"), [false, false, false]);
	assert.equal(await page.locator(metadataBody).evaluate((body) => body.scrollTop), scrolled, "the scroll position survives hiding and return");
	assert.equal(await page.inputValue(captionSelector), "Lighthouse at dusk");
});

test("below the declared minimum the last row keeps its height and the workspace scrolls", async () => {
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
	await resize([[960, 640], [420, 200]]);
	assert.equal(await page.locator(readout("b", "limit")).isHidden(), false, "the readout says the frame is below the minimum");
	assert.equal(Math.round(await page.locator(inFrame("b", ".supermax-row:not(.is-hidden)")).evaluate((element) => element.getBoundingClientRect().height)), 180);
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

test("closing the newest group reaches both frames and focus returns to the selector", async () => {
	await openDemo(THREE_ROWS);
	await closeNewest("a");
	assert.deepEqual(await groups("a"), ["Coast", "Photo A", "Photo B"]);
	assert.deepEqual(await groups("b"), ["Coast", "Photo A", "Photo B"], "the shared log reaches the other frame");
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
	await page.click(inFrame("b", ".supermax-up"));
	await settle();
	assert.equal(await activeOccurrence(), coast.row("thumbnails"), "Back focuses the revealed selector");
	assert.equal(await page.locator(inFrame("b", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`)).count(), 0, "the photo that pushed the selector out closes to make room");
	assert.ok((await state("a")).occurrences.includes(coast.photo("thumbnails", "a")), "while the other frame keeps it open");
});

const LONG_CHAIN = [open("album:coast", "albums"), { ...open("coast:history:a", coast.metadata("thumbnails", "a")), hint: { title: "History A" } }, { ...open("coast:edit:a:2", coast.history("thumbnails", "a")), hint: { title: "Crop 3:2 (A)", min: 200, max: 320 } }];

test("a long chain hides old cells entirely while the kept albums menu stays as an icon rail", async () => {
	await openDemo(LONG_CHAIN);
	const cells = await page.locator(inFrame("a", `[data-occurrence^="${coast.row("thumbnails")}"]`)).evaluateAll((elements) => elements.map((element) => ({ compact: element.classList.contains("is-compact"), visible: getComputedStyle(element).visibility === "visible" && element.getBoundingClientRect().width > 0 })));
	assert.ok(cells.every((cell) => !cell.compact), "no content cell takes a compact form");
	assert.ok(cells.some((cell) => !cell.visible) && cells[cells.length - 1].visible, "old cells hide entirely and the newest stays");
	assert.equal(await page.locator(inFrame("a", ".supermax-rail")).count(), 1, "only the kept menu has a rail");
	assert.equal(await page.locator(inFrame("b", '[data-occurrence="albums"]')).evaluate((element) => element.classList.contains("is-compact")), true, "the narrow frame shows the albums menu as a rail");
	await page.click(inFrame("b", '.album-icon[data-destination="album:empty"]'));
	assert.deepEqual(await groups("b"), ["Empty album"], "an icon in the rail navigates");
	assert.deepEqual(await groups("a"), ["Empty album"], "and the other frame follows");
	await resize([[960, 640], [420, 360]]);
	assert.equal(await page.locator(inFrame("b", '[data-occurrence="albums"] .album-icon')).first().isVisible(), true, "at the supported minimum height the menu rail is still there");
});

test("a peek shows the kept menu's own content without touching history", async () => {
	await openDemo(LONG_CHAIN);
	const rail = inFrame("b", '[data-occurrence="albums"] .supermax-rail');
	const urlBefore = page.url();
	await page.hover(rail);
	await page.waitForSelector(inFrame("b", ".supermax-peek"));
	assert.ok(await page.locator(inFrame("b", ".supermax-peek .album-item")).count() > 0, "the peek shows the full menu");
	assert.equal(page.url(), urlBefore, "a peek writes no history");
	await page.mouse.move(5, 5);
	await page.waitForSelector(inFrame("b", ".supermax-peek"), { state: "detached" });
	await page.focus(rail);
	await page.waitForSelector(inFrame("b", ".supermax-peek"));
	await page.keyboard.press("Escape");
	await page.waitForSelector(inFrame("b", ".supermax-peek"), { state: "detached" });
	assert.equal(await page.evaluate(() => document.activeElement?.className), "supermax-rail", "Escape returns focus to the rail");
	await page.keyboard.press("Enter");
	await page.waitForSelector(inFrame("b", ".supermax-peek"));
	assert.equal(await page.evaluate(() => document.activeElement?.closest(".supermax-peek") !== null), true, "Enter on the rail opens the peek and moves focus into it");
	await page.mouse.move(5, 5);
	await page.waitForTimeout(350);
	assert.equal(await page.locator(inFrame("b", ".supermax-peek")).count(), 1, "the pointer leaving does not close a peek that holds the keyboard focus");
	assert.equal(await page.locator(inFrame("a", ".supermax-peek")).count(), 0, "the peek is local to its frame");
	await page.click(inFrame("b", '.supermax-peek .album-item[data-destination="album:empty"]'));
	await page.waitForSelector(inFrame("b", ".supermax-peek"), { state: "detached" });
	assert.deepEqual(await groups("b"), ["Empty album"], "a navigation from the peek is applied and closes the peek");
	assert.deepEqual(await groups("a"), ["Empty album"], "the other frame receives the same action");
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
	while ((await groups("a")).length > 0) { await closeNewest("a"); await settle(); }
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
	await closeNewest("a");
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
	while ((await groups("a")).length > 0) { await closeNewest("a"); await settle(); }
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
	assert.equal(await page.locator(inFrame("a", ".supermax-up")).isHidden(), true, "with nothing hidden above the window the modal leaves no Show control to compete with its own close");
	await page.keyboard.press("Escape");
	assert.equal(await page.locator(modal).count(), 0, "the replacing modal closes like the first");
	assert.deepEqual(await groups("a"), groupsBefore, "and navigates nothing");
	await page.click(inFrame("a", `[data-occurrence="${coast.row("map")}"] [data-destination="coast:photo:b"]`));
	await settle();
	await page.click(`${inFrame("a", `[data-occurrence="${coast.photo("map", "b")}"]`)} .caption-edit`);
	await settle();
	await closeNewest("b");
	await settle();
	assert.equal(await page.locator(`${modal} .supermax-modal-context`).textContent(), "Its source has closed", "a source closed from elsewhere is named as such");
	await page.click(`${modal} .supermax-modal-close`);
	assert.equal(await page.locator(modal).count(), 0);
	assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), "BODY", "closing without a source still lands on a usable control");
	await page.click(`${photoCell("people")} .caption-edit`);
	await settle();
	await resize([[1100, 400], [360, 640]]);
	await page.evaluate((row) => window.supermaxDemo.frames[0].workspace.goTo(row), coast.row("thumbnails"));
	await settle();
	assert.equal(await page.locator(inFrame("a", `.supermax-row[data-row="${coast.row("people")}"]`)).evaluate((element) => element.classList.contains("is-hidden")), true, "the source row is out of view behind the modal");
	await page.keyboard.press("Escape");
	assert.ok(await page.evaluate(() => document.activeElement?.closest(".supermax-cell") !== null), "closing onto a hidden source lands in a visible cell");
});

test("a notice is a bubble in its source cell, moves to the top of the viewport naming a source out of view, and never steals focus", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	const photoA = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`);
	const cellNotice = `${photoA} .supermax-cell-notices .supermax-notice`;
	await page.focus(`${photoA} .caption`);
	await page.click(`${photoA} .caption-save`);
	await page.waitForSelector(cellNotice);
	assert.equal(await page.locator(`${cellNotice} .supermax-notice-text`).textContent(), "Caption saved", "a success notice appears as a bubble in its source cell, without naming it");
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
	assert.equal(await page.locator(`${photoA} .supermax-cell-notices [data-notice="keep"] .supermax-notice-text`).textContent(), "Review the crop");
	await resize([[1100, 400], [360, 640]]);
	assert.equal(await page.locator(inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"]`)).evaluate((element) => element.classList.contains("is-hidden")), true, "the source row is out of view");
	const moved = inFrame("a", '.supermax-notices [data-notice="keep"]');
	assert.equal(await page.locator(`${moved} .supermax-notice-text`).textContent(), "Photo A: Review the crop", "a notice whose source went out of view moves to the top and names it");
	await page.click(`${moved} .supermax-notice-go`);
	await settle();
	assert.equal(await page.locator(inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"]`)).evaluate((element) => element.classList.contains("is-hidden")), false, "Show brings the row back");
	assert.equal(await activeOccurrence(), coast.photo("thumbnails", "a"), "and focuses the source");
	assert.equal(await page.locator(moved).count(), 0, "reaching the source retires the notice");
	await resize([[1100, 640], [360, 640]]);
	await page.click(inFrame("a", `[data-occurrence="${coast.row("people")}"] [data-destination="coast:photo:b"]`));
	await settle();
	await page.selectOption("[data-delay]", "400");
	await page.click(inFrame("a", `[data-occurrence="${coast.photo("people", "b")}"] .caption-save`));
	await closeNewest("a");
	await settle();
	const late = inFrame("a", `.supermax-notices .supermax-notice[data-source="${coast.photo("people", "b")}"]`);
	await page.waitForSelector(late);
	assert.equal(await page.locator(`${late} .supermax-notice-text`).textContent(), "Photo B (not open): Caption saved", "a late response for a closed source names it");
	assert.ok(!(await state("a")).occurrences.includes(coast.photo("people", "b")), "and does not reopen it");
	await page.selectOption("[data-delay]", "0");
	await page.waitForSelector(late, { state: "detached", timeout: 6000 });
	await page.click(inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"] .album-export`));
	const exportNotice = inFrame("a", ".supermax-notice.is-action");
	assert.equal(await page.locator(`${inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"]`)} .supermax-cell-notices .supermax-notice-text`).textContent(), "Export of Coast is ready", "the bubble in its source cell needs no name");
	await page.waitForFunction(() => [...document.querySelectorAll('.frame[data-frame="a"] .supermax-origin.is-notices .supermax-frustum.is-notice')].some((group) => group.style.opacity === "1"));
	const recess = await page.evaluate(() => {
		const frame = document.querySelector('.frame[data-frame="a"]');
		const target = [...frame.querySelectorAll(".supermax-origin.is-notices .supermax-frustum-target")].map((element) => element.getBoundingClientRect());
		const cells = [...frame.querySelectorAll(".supermax-cell-notices")].map((element) => element.closest(".supermax-cell").getBoundingClientRect());
		return target.every((rect) => cells.some((cell) => Math.abs(rect.left - cell.left) < 2 && Math.abs(rect.width - cell.width) < 2));
	});
	assert.equal(recess, true, "each bubble's frustum stays inside its own source cell");
	assert.equal(await page.locator(inFrame("b", ".supermax-notice-veil.is-shown")).count(), 1, "the frame whose notices sit at the top dims a band behind them");
	assert.equal(await page.locator(`${exportNotice} .supermax-notice-go`).count(), 0, "a source that is in view needs no Show control");
	await page.click(`${photoA} .caption-edit`);
	await settle();
	assert.equal(await page.locator(`${inFrame("a", ".supermax-notices")} .supermax-notice.is-action .supermax-notice-text`).textContent(), "Metadata A: Export of Coast is ready", "a modal moves bubbles to the top, where the keyboard can reach them, naming their source");
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
	const underModal = inFrame("a", '.supermax-notices [data-notice="under-modal"]');
	assert.equal(await page.locator(`${underModal} .supermax-notice-text`).textContent(), "Photo A: Still here", "a notice raised while a modal hides its source names it");
	await page.keyboard.press("Escape");
	assert.equal(await page.locator(`${photoA} .supermax-cell-notices [data-notice="under-modal"] .supermax-notice-text`).textContent(), "Still here", "closing the modal returns the notice to its cell");
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
	assert.ok(chain.every((cell) => !cell.compact), "no cell in a long chain takes a compact form");
	assert.equal((await backButton("a")).label, "Show Depth 15", "Back names the nearest hidden cell");
	await page.waitForFunction(() => document.querySelector('.frame[data-frame="a"] [data-spec-for$="/depth:20"] .cell-spec-state')?.textContent === "allocated");
	const spec = await page.locator(inFrame("a", '[data-spec-for$="/depth:20"]')).evaluate((element) => ({ hidden: element.hidden, text: [...element.querySelectorAll("dt")].map((term) => `${term.textContent} ${term.nextElementSibling.textContent}`) }));
	assert.equal(spec.hidden, false, "a cell with room shows its definition");
	assert.deepEqual(spec.text.slice(0, 3), ["id depth:20", "min 160", "max 240"]);
	assert.match(spec.text[3], /^width \d+ px$/);
	await page.selectOption("[data-presentation]", "fold");
	await settle();
	await page.focus(inFrame("a", ".supermax-up"));
	await page.keyboard.press("Enter");
	await settle();
	assert.equal((await groups("a")).length, 19, "the keyboard up step closes Depth 20 to show Depth 15");
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${TWENTY_DEEP[19].from}/depth:20"]`)).count(), 0);
	await page.evaluate((source) => window.supermaxDemo.frames[0].workspace.notify({ id: "deep-three", scope: "cell", source, kind: "action", message: "Look here", action: { label: "Ok", run() {} } }), "albums/depth:1/depth:2/depth:3");
	await page.click(inFrame("a", '.supermax-notices [data-notice="deep-three"] .supermax-notice-go'));
	await settle();
	assert.equal(await page.locator(inFrame("a", '[data-occurrence="albums/depth:1/depth:2/depth:3"]')).evaluate((element) => getComputedStyle(element).visibility === "visible" && element.getBoundingClientRect().width > 0), true, "Show reveals a cell hidden far to the left");
	assert.equal(await activeOccurrence(), "albums/depth:1/depth:2/depth:3", "and focuses it");
	assert.equal(await page.locator(inFrame("a", '[data-notice="deep-three"]')).count(), 0, "the notice retires once its source is reached");
	assert.ok((await page.locator(inFrame("a", '[data-occurrence^="albums/depth:1"]')).evaluateAll((elements) => elements.filter((element) => getComputedStyle(element).visibility === "visible" && element.getBoundingClientRect().width > 0).length)) > 1, "Show moves the window only as far as it must, keeping neighbours in view");
	await closeNewest("a");
	await settle();
	assert.equal((await groups("a")).length, 18);
	assert.equal(await page.locator(inFrame("a", "[data-supermax-exiting]")).count(), 0);
	const start = Date.now();
	await page.click("[data-reset]");
	await page.waitForFunction(() => !location.hash);
	assert.ok(Date.now() - start < 4000, "closing twenty cells is quick");
	assert.equal(await page.locator(inFrame("a", ".supermax-cell")).count(), 1, "only the root remains");
});

test("opening a cell whose layout definition failed before fetches it again, also without a pointer", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	await page.selectOption("[data-fail]", "manifest");
	await page.click(inFrame("a", `[data-occurrence="${coast.row("people")}"] [data-destination="coast:photo:b"]`));
	await settle();
	await page.selectOption("[data-fail]", "");
	await page.focus(inFrame("a", `[data-occurrence="${coast.photo("people", "b")}"] .metadata-link:not(.caption-edit):not(.caption-save)`));
	await page.keyboard.press("Enter");
	await settle();
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.metadata("people", "b")}"] .viewer-line`)).textContent(), "Viewing as Ana");
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
	assert.equal(await activeOccurrence(), coast.row("thumbnails"), "a crumb in the title context goes to that ancestor, here into the album's top row");
	await page.evaluate(() => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		workspace.upRequests = 0;
		const original = workspace.requestUp.bind(workspace);
		workspace.requestUp = () => { workspace.upRequests += 1; return original(); };
	});
	await page.focus(inFrame("a", `[data-occurrence="${coast.photo("people", "b")}"] .caption`));
	await page.keyboard.press("Alt+ArrowLeft");
	assert.equal(await page.evaluate(() => window.supermaxDemo.frames[0].workspace.upRequests), 0, "inside a text field Alt+ArrowLeft stays a text shortcut");
	await resize([[420, 640], [360, 640]]);
	const target = await page.evaluate(() => window.supermaxDemo.frames[0].workspace.upDestination?.id ?? null);
	assert.ok(target, "the narrower frame hides a cell to the left");
	await page.focus(`${cell}`);
	await page.keyboard.press("Alt+ArrowLeft");
	await settle();
	assert.equal(await activeOccurrence(), target, "Alt+ArrowLeft on a cell is Back");
	assert.deepEqual(await groups("a"), ["Coast", "Photo B", "Metadata B"], "and closes nothing");
});

test("reset restores both frames and clears the URL", async () => {
	await openDemo(THREE_ROWS);
	await page.click("[data-reset]");
	await page.waitForFunction(() => !location.hash);
	for (const key of ["a", "b"]) {
		assert.deepEqual(await state(key), { occurrences: ["albums"], groups: [], focused: "albums" }, `frame ${key}`);
		assert.equal((await backButton(key)).hidden, true);
	}
});

test("an empty album says so, and the exact-fit lab opens", async () => {
	await openDemo();
	await page.click(inFrame("a", '.album-item[data-destination="album:empty"]'));
	assert.equal(await page.locator(inFrame("a", ".empty-state")).first().textContent(), "No photos in this album.");
	await page.click(inFrame("a", '.album-item[data-destination="album:lab-fit"]'));
	assert.deepEqual(await groups("a"), ["Lab: exact fit"], "a split that fits the supported height to the pixel opens");
	assert.equal(await page.locator(inFrame("a", ".album-note")).count(), 0, "configuration diagnostics never appear in the interface");
});

test("hostile deeplinks are rejected without breaking the page", async () => {
	await openDemo([open("album:coast", "albums"), open("coast:thumbnails", coast.album), { type: "close" }, open("constructor", "albums")]);
	assert.deepEqual(await groups("a"), [], "the row root could not be promoted, so Back closed the album");
	assert.equal(await page.locator(readout("a", "rejection")).textContent(), "Rejected: constructor is not a destination here.");
	assert.equal(page.url().split("#")[1], "o:album:coast@albums;b", "only applied actions survive in the URL");
});

test("history restore that removes the focused cell hands focus to visible content", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("b", `[data-occurrence="${coast.row("map")}"] .pin[data-destination="coast:photo:b"]`));
	await page.focus(inFrame("b", `[data-occurrence="${coast.photo("map", "b")}"] .caption`));
	await page.goBack();
	await page.waitForFunction(() => !location.hash.includes("photo:b"));
	assert.equal(await activeOccurrence(), coast.row("map"), "focus moved to the selector that remains");
	assert.equal(await page.locator(inFrame("b", ".supermax-title-text")).textContent(), "Coast", "the title names where the application now is, the album");
});

test("cells inside a hidden row are not painted and Back brings the row back", async () => {
	await openDemo(THREE_ROWS);
	await resize([[960, 640], [420, 300]]);
	assert.deepEqual(await hiddenRows("b"), [true, true, false]);
	const visibility = await page.locator(inFrame("b", `.supermax-row[data-row="${coast.row("map")}"] .supermax-cell`)).evaluateAll((elements) => [...new Set(elements.map((element) => getComputedStyle(element).visibility))]);
	assert.deepEqual(visibility, ["hidden"], "every cell inside the hidden row computes hidden");
	for (let step = 0; step < 5 && (await hiddenRows("b"))[1]; step += 1) {
		await page.click(inFrame("b", ".supermax-up"));
		await settle();
	}
	assert.deepEqual(await hiddenRows("b"), [true, false, true], "Back reaches the row of the branch opened before, once nothing above the focus is hidden");
	assert.equal(await page.locator(inFrame("b", ".supermax-title-text")).textContent(), "Photo B", "Photo C closed to show People, so the title names the newest navigation still in view");
});

test("motion: an opening animates, an immediate close leaves nothing behind, reduced motion animates nothing", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("a", `[data-occurrence="${coast.row("map")}"] .pin[data-destination="coast:photo:c"]`));
	assert.ok(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length) > 0);
	await closeNewest("a");
	await page.waitForFunction(() => document.getAnimations().length === 0);
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.photo("map", "c")}"]`)).count(), 0);
	assert.equal(await page.locator(inFrame("a", "[data-supermax-exiting]")).count(), 0);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.click(inFrame("a", `[data-occurrence="${coast.row("map")}"] .pin[data-destination="coast:photo:c"]`));
	assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
	await closeNewest("a");
	assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
});

test("a closing split keeps its rows until the exit finishes", async () => {
	await openDemo([open("album:coast", "albums")]);
	await closeNewest("a");
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
	await page.waitForFunction((expected) => document.querySelector('.frame[data-frame="b"] + .readout .readout-size').textContent === expected, `${Math.round(handleAfter.width)} × ${Math.round(handleAfter.height)} px`);
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
