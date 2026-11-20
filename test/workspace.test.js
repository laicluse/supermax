import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { chromium } from "playwright";
import { albums, depthCount, depthId, paths } from "../docs/assets/album.js";
import { appendAction, decodeLog, encodeLog } from "../docs/assets/deeplink.js";
import { STRIP_TIMING } from "../src/cell-strip.js";
import { TIMING } from "../src/motion.js";
import { serveDocs } from "./serve-docs.js";

const coast = paths(albums[0]);
const SETTLE = STRIP_TIMING.settle;
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

async function opened() {
	await page.waitForFunction(() => window.supermaxDemo.pending === 0);
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
});

test("an explicit click on auto-open content promotes it here, and the other frame follows the same path", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"] .metadata-link`));
	await settle();
	assert.deepEqual(await groups("a"), ["Coast", "Metadata A"]);
	assert.deepEqual(await groups("b"), ["Coast", "Photo A", "Metadata A"], "the narrow frame never auto-opened Photo A, so it opens Photo A first and then the clicked metadata");
	assert.equal(await page.locator(readout("b", "rejection")).isHidden(), true, "nothing is refused");
	assert.equal(page.url().split("#")[1], `o:album:coast@albums;o:coast:metadata:a@${coast.photo("thumbnails", "a")}`, "an action applied in one frame enters the log as destination and source only");
});

test("frames diverge on what closing the newest group closes and the demo does not equalise them", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("b", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:a"]`));
	assert.deepEqual(await groups("b"), ["Coast", "Photo A"]);
	assert.deepEqual(await groups("a"), ["Coast", "Photo A"], "the auto-opened photo is promoted in the wide frame");
	await settle();
	assert.deepEqual([await painted(inFrame("b", `[data-occurrence="${coast.row("thumbnails")}"]`)), await painted(inFrame("b", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`))], [false, true], "the narrow row hides the selector entirely for the photo");
	await closeNewest("b");
	assert.deepEqual(await groups("b"), ["Coast"]);
	assert.ok((await state("b")).occurrences.includes(coast.row("thumbnails")));
	const wide = await state("a");
	assert.deepEqual(wide.groups.map((group) => group.title), ["Coast"]);
	assert.ok(!wide.occurrences.includes(coast.metadata("thumbnails", "a")), "the wide frame closed Photo A together with its automatic metadata");
});

test("the log forgets an open that a later open replaced, with everything under it, but never across a Back step", () => {
	const map = coast.row("map");
	const build = (actions) => actions.reduce(appendAction, []);
	const opened = (log) => log.map((action) => (action.type === "close" ? "b" : action.destination));
	assert.deepEqual(opened(build([open("album:coast", "albums"), open("coast:photo:b", map), open("coast:metadata:b", coast.photo("map", "b")), open("coast:photo:c", map), open("coast:photo:a", map)])), ["album:coast", "coast:photo:a"], "B, its metadata and C gave way to A");
	assert.deepEqual(opened(build([open("album:coast", "albums"), open("coast:photo:b", map), { type: "close" }, open("coast:photo:a", map)])), ["album:coast", "coast:photo:b", "b", "coast:photo:a"], "an open before a Back step stays");
	assert.deepEqual(opened(build([open("coast:photo:a", coast.row("thumbnails")), open("coast:photo:b", map)])), ["coast:photo:a", "coast:photo:b"], "opens in other places stay");
});

test("reloading a link with replaced steps lands on the same state and rewrites the link without them", async () => {
	const map = coast.row("map");
	const steps = [open("album:coast", "albums"), ...["b", "c", "d", "c", "b", "a"].map((id) => open(`coast:photo:${id}`, map))];
	const states = async (log) => {
		await openDemo(log);
		return page.evaluate(() => window.supermaxDemo.frames.map((frame) => {
			const state = frame.workspace.navigator.state();
			return { occurrences: [...state.occurrences].sort(), groups: state.groups.map((group) => `${group.title}: ${[...group.members].sort().join(" ")}`) };
		}));
	};
	const replayed = await states(steps);
	const rewritten = decodeLog(await page.evaluate(() => location.hash));
	assert.deepEqual(rewritten.map((action) => action.destination), ["album:coast", "coast:photo:a"]);
	assert.deepEqual(await states([steps[0], steps.at(-1)]), replayed, "the short link restores the same cells and Back steps in both frames");
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
	const withoutIds = (snapshot) => ({ ...snapshot, groups: snapshot.groups.map(({ id, ...group }) => group) });
	assert.deepEqual(withoutIds(await state("a")), withoutIds(live.a), "a fresh navigation replays the wide frame after clicks");
	assert.deepEqual(withoutIds(await state("b")), withoutIds(live.b), "a fresh navigation replays the narrow frame after clicks");
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
	await page.click(inFrame("a", ".supermax-up"));
	await settle();
	assert.deepEqual(await groups("a"), before.a.slice(0, -1), "Depth 20 closes so Depth 15 fits");
	assert.equal(page.url(), before.url, "the shared log does not change");
	assert.deepEqual([await backButton("b"), await groups("b")], [before.b, before.bGroups], "the other frame keeps its window and its cells");
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
	assert.equal((await backButton("a")).label, "Show Map", "with that branch whole, the branch opened before it climbs next");
	await page.click(inFrame("a", ".supermax-up"));
	await settle();
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
	await page.click(inFrame("a", ".supermax-modal-close"));
	assert.equal(await page.locator(inFrame("a", ".supermax-modal-layer:not([data-supermax-exiting])")).count(), 0, "its close control closes the modal");
	await page.waitForFunction(() => !document.querySelector('.frame[data-frame="a"] .supermax-origin.is-modal'));
});

test("a modal grows out of its source cell in a new cell's time while its frustum follows", async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:b", coast.row("map"))]);
	const midway = await page.evaluate((photo) => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const source = document.querySelector(`.frame[data-frame="a"] [data-occurrence="${photo}"]`);
		source.querySelector(".caption-edit").click();
		const { dialog, entrance } = workspace.modal;
		const final = { width: dialog.offsetWidth };
		entrance.pause();
		entrance.currentTime = 100;
		workspace.drawOrigins();
		const now = dialog.getBoundingClientRect();
		const cell = source.getBoundingClientRect();
		const frustum = workspace.modal.originLayer.querySelector(".supermax-frustum");
		const innerFades = dialog.getAnimations({ subtree: true }).filter((animation) => animation.effect.target !== dialog && animation.effect.getKeyframes().some((frame) => frame.opacity !== undefined)).length;
		return { duration: entrance.effect.getTiming().duration, easing: entrance.effect.getTiming().easing, innerFades, cell: cell.width, now: now.width, final: final.width, opacity: Number(frustum.style.opacity) };
	}, coast.photo("map", "b"));
	assert.equal(midway.duration, 200, "the same 200ms as a new cell");
	assert.equal(midway.easing, "ease-out", "and it eases out as a new cell does");
	assert.equal(midway.innerFades, 0, "the dialog fades as one, not part by part");
	assert.ok(midway.now > Math.min(midway.cell, midway.final) && midway.now < Math.max(midway.cell, midway.final), "halfway the plane sits between the source cell and the modal");
	assert.ok(midway.opacity > 0 && midway.opacity < 1, "and its frustum is fading in with it");
	await settle();
});

test("a closed modal folds back into its source as a closing cell does, while the workspace is usable at once", async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:b", coast.row("map"))]);
	await page.click(inFrame("a", `[data-occurrence="${coast.photo("map", "b")}"] .caption-edit`));
	await settle();
	const closing = await page.evaluate((photo) => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const final = workspace.modal.dialog.getBoundingClientRect().width;
		workspace.closeModal("close");
		const layer = document.querySelector('.frame[data-frame="a"] .supermax-modal-layer');
		const dialog = layer?.querySelector(".supermax-modal");
		const exit = dialog?.getAnimations().find((animation) => animation.effect.getKeyframes().some((frame) => frame.transform !== undefined));
		exit?.pause();
		if (exit) exit.currentTime = 100;
		window.__exit = exit;
		return {
			modal: workspace.modal,
			usable: !workspace.body.inert,
			leaving: !!layer?.inert && layer.hasAttribute("data-supermax-exiting"),
			easing: exit?.effect.getTiming().easing,
			duration: exit?.effect.getTiming().duration,
			cell: document.querySelector(`.frame[data-frame="a"] [data-occurrence="${photo}"]`).getBoundingClientRect().width,
			final,
			now: dialog?.getBoundingClientRect().width,
		};
	}, coast.photo("map", "b"));
	assert.equal(closing.modal, null, "the modal is closed at once");
	assert.ok(closing.usable, "and the cells behind it take input again");
	assert.ok(closing.leaving, "while the dialog leaves inert on its way out");
	assert.equal(closing.duration, 200, "in a closing cell's time");
	assert.equal(closing.easing, "ease-in", "easing in as a closing cell does");
	assert.ok(closing.now > Math.min(closing.cell, closing.final) && closing.now < Math.max(closing.cell, closing.final), "halfway the plane sits between the modal and its source");
	await page.waitForFunction(() => {
		const frustum = document.querySelector('.frame[data-frame="a"] .supermax-modal-layer .supermax-frustum');
		return frustum && Number(frustum.style.opacity) > 0 && Number(frustum.style.opacity) < 1;
	});
	await page.evaluate(() => window.__exit.play());
	await page.waitForFunction(() => !document.querySelector('.frame[data-frame="a"] .supermax-modal-layer'));
});

test("content that arrives after its cell has appeared swaps in without a fade of its own", async () => {
	await page.goto(`${server.url}/?delay=300${PRESENTATION === "origami" ? "" : `&presentation=${PRESENTATION}`}#${encodeLog([open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails"))])}`);
	await page.waitForSelector(inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"] .metadata-link`));
	await settle();
	await page.evaluate(() => {
		window.__innerFades = [];
		const seen = new Set();
		const watch = () => {
			for (const animation of document.getAnimations()) {
				const target = animation.effect?.target;
				if (seen.has(animation) || !target?.closest?.('.frame[data-frame="a"] .supermax-cell') || target.classList?.contains("supermax-cell")) continue;
				seen.add(animation);
				if (animation.effect.getKeyframes().some((frame) => frame.opacity !== undefined)) window.__innerFades.push(target.className);
			}
			requestAnimationFrame(watch);
		};
		watch();
	});
	await page.click(inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"] .metadata-link:not(.album-export)`));
	await page.waitForSelector(inFrame("a", `[data-occurrence="${coast.history("thumbnails", "a")}"] .supermax-cell-body:not(:has(.supermax-loading))`), { timeout: 5000 });
	await page.waitForTimeout(300);
	assert.deepEqual(await page.evaluate(() => window.__innerFades), [], "nothing inside the cell fades on its own");
});

test("each frustum face fades from its modal edge towards the source, in bands parallel to that edge", async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:b", coast.row("map"))]);
	await page.click(inFrame("a", `[data-occurrence="${coast.photo("map", "b")}"] .caption-edit`));
	await settle();
	await page.waitForFunction(() => document.querySelector('.frame[data-frame="a"] .supermax-origin.is-modal .supermax-frustum-face'));
	const faces = await page.evaluate(() => {
		const layer = document.querySelector('.frame[data-frame="a"] .supermax-origin.is-modal');
		return [...layer.querySelectorAll(".supermax-frustum-face")].map((face) => {
			const across = face.dataset.side === "top" || face.dataset.side === "bottom";
			const points = face.getAttribute("points").split(" ").map((point) => point.split(",").map(Number)[across ? 1 : 0]);
			const id = /url\("?#([^")]+)"?\)/.exec(face.getAttribute("fill") ?? "")?.[1];
			const gradient = id ? layer.querySelector(`#${CSS.escape(id)}`) : null;
			const at = (name) => Number(gradient?.getAttribute(name));
			const stops = gradient ? [...gradient.querySelectorAll("stop")].map((stop) => ({ offset: Number(stop.getAttribute("offset")), opacity: Number(getComputedStyle(stop).stopOpacity), color: getComputedStyle(stop).stopColor })) : [];
			return { side: face.dataset.side, modalEdge: points[0], sourceEdge: points[2], units: gradient?.getAttribute("gradientUnits"), x1: at("x1"), y1: at("y1"), x2: at("x2"), y2: at("y2"), stops, color: getComputedStyle(face).color };
		});
	});
	assert.ok(faces.length > 0, "the modal has faces");
	for (const face of faces) {
		const across = face.side === "top" || face.side === "bottom";
		assert.equal(face.units, "userSpaceOnUse", `the ${face.side} face fills with a gradient in the layer's own coordinates`);
		const [start, end] = across ? [face.y1, face.y2] : [face.x1, face.x2];
		assert.ok((across ? face.x1 === face.x2 : face.y1 === face.y2) && Math.abs(start - face.modalEdge) < 0.01 && Math.abs(end - face.sourceEdge) < 0.01, `which runs straight from the modal's ${face.side} edge to the source's: ${JSON.stringify(face)}`);
		const alpha = (color) => Number(color.match(/[\d.]+/g)[3] ?? 1);
		const rgb = (color) => color.match(/[\d.]+/g).slice(0, 3).join();
		const [near, far] = face.stops;
		assert.ok(near?.offset === 0 && far?.offset === 1 && rgb(near.color) === rgb(face.color) && rgb(far.color) === rgb(face.color), `in the face's own colour: ${JSON.stringify(face)}`);
		const own = alpha(face.color);
		assert.ok(Math.abs(alpha(near.color) - own - 0.05) < 0.005 && Math.abs(alpha(far.color) - Math.max(0, own - 0.05)) < 0.005, `five points more opaque at the modal edge and five less at the source, ten in all: ${JSON.stringify(face)}`);
	}
});

test("in dark mode the frustum is lighter than what lies behind it, still lit from above", async () => {
	await page.emulateMedia({ colorScheme: "dark" });
	try {
		await openDemo([open("album:coast", "albums"), open("coast:photo:b", coast.row("map"))]);
		await page.click(inFrame("a", `[data-occurrence="${coast.photo("map", "b")}"] .caption-edit`));
		await settle();
		await page.waitForFunction(() => document.querySelector('.frame[data-frame="a"] .supermax-origin.is-modal .supermax-frustum-face'));
		const fills = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.frame[data-frame="a"] .supermax-origin.is-modal .supermax-frustum-face')].map((face) => [face.dataset.side, getComputedStyle(face).color])));
		const white = (fill) => { const [r, g, b, a] = fill.match(/[\d.]+/g).map(Number); return r === 255 && g === 255 && b === 255 ? a : -1; };
		assert.ok(Object.values(fills).length > 0 && Object.values(fills).every((fill) => white(fill) > 0), `every face is a light veil: ${JSON.stringify(fills)}`);
		if (fills.top && fills.bottom) assert.ok(white(fills.top) > white(fills.bottom), "the top face catches the most light");
	} finally {
		await page.emulateMedia({ colorScheme: "light" });
	}
});

test("a modal whose content arrives late already stands at the height that content needs", async () => {
	await page.goto("about:blank");
	await page.goto(`${server.url}/?delay=400${PRESENTATION === "origami" ? "" : `&presentation=${PRESENTATION}`}#${encodeLog([open("album:coast", "albums"), open("coast:photo:b", coast.row("map"))])}`);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	await settle();
	await page.click(inFrame("a", `[data-occurrence="${coast.photo("map", "b")}"] .caption-edit`));
	const height = () => page.evaluate(() => window.supermaxDemo.frames[0].workspace.modal.dialog.offsetHeight);
	assert.ok(await page.locator(inFrame("a", ".supermax-modal .supermax-loading")).count() > 0, "the content is still loading");
	const loading = await height();
	await settle();
	assert.equal(await height(), loading, "the modal keeps its height when the editor arrives");
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
});

test("a modal wider than its viewport shrinks to fit inside the inset", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.evaluate(() => window.supermaxDemo.frames[1].workspace.openModal({ title: "Wide", min: 280, max: 720, preferred: 640, content: () => ({ element: document.createElement("p") }) }, {}));
	await settle();
	const viewport = await page.locator(frame("b")).boundingBox();
	const dialog = await page.locator(inFrame("b", ".supermax-modal")).boundingBox();
	assert.ok(viewport.width < 640, "the frame is narrower than the preferred width");
	assert.ok(Math.abs(dialog.x - viewport.x - 16) <= 1 && Math.abs(viewport.x + viewport.width - dialog.x - dialog.width - 16) <= 1, "the dialog keeps the inset on both sides");
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
			frames: [...root.querySelectorAll(".supermax-row-chain")].map((frame) => getComputedStyle(frame).clipPath),
			overflow: cells.filter((cell) => cell.closest(".supermax-row")).some((cell) => cell.getBoundingClientRect().right > split.right + 0.5),
			radius: getComputedStyle(root.querySelector(".supermax-up")).borderRadius,
		};
	});
	assert.equal(geometry.canvas, "rgb(0, 0, 0)", "the canvas is black in light mode");
	assert.deepEqual(Object.fromEntries(geometry.gutters), {
		albums: "0px",
		"album:coast": "0px",
		"coast:thumbnails": "0px",
		"coast:photo:a": "1px",
		"coast:metadata:a": "1px",
		"coast:map": "0px",
		"coast:photo:b": "1px",
		"coast:metadata:b": "1px",
		"coast:people": "0px",
		"coast:photo:c": "1px",
		"coast:metadata:c": "1px",
	}, "one gutter before every cell but the first of its chain");
	assert.deepEqual(geometry.frames, ["inset(0px 0px 0px 1px)", "inset(0px 0px 0px 1px)", "inset(0px 0px 0px 1px)"], "and the split's own gutter is the left edge of each row's frame, which stays in place");
	assert.deepEqual(geometry.rows, ["0px", "1px", "1px"], "one gutter between rows");
	assert.equal(geometry.overflow, false);
	assert.equal(geometry.radius, "0px", "no rounded rectangles");
});

test("an elastic cell in view takes the space the others leave, and without one the canvas shows", async () => {
	const warnings = [];
	const collect = (message) => { if (message.type() === "warning" && message.text().startsWith("Supermax:")) warnings.push(message.text()); };
	page.on("console", collect);
	await openDemo([open("album:coast", "albums")]);
	await resize([[1600, 640], [420, 640]]);
	page.off("console", collect);
	const rows = (key) => page.evaluate((frameKey) => [...document.querySelectorAll(`.frame[data-frame="${frameKey}"] .supermax-row .supermax-chain`)].map((chain) => {
		const cells = [...chain.querySelectorAll(".supermax-cell")].filter((cell) => cell.getBoundingClientRect().width > 0 && getComputedStyle(cell).visibility !== "hidden");
		const photo = cells.find((cell) => cell.dataset.occurrence.includes("coast:photo:"));
		return { gap: Math.round(chain.getBoundingClientRect().right - cells.at(-1).getBoundingClientRect().right), photo: photo ? Math.round(photo.getBoundingClientRect().width) : null };
	}), key);
	const wide = await rows("a");
	assert.ok(wide.every((row) => row.gap === 0), `with the elastic photo in view every row reaches its edge: ${JSON.stringify(wide)}`);
	assert.ok(wide.every((row) => row.photo > 360), "because the photo grows past its preferred width");
	const narrow = await rows("b");
	assert.ok(narrow.every((row) => row.photo === null), "the narrow frame shows no photo in its rows");
	assert.ok(narrow.every((row) => row.gap === 0), `there each elastic selector fills its row: ${JSON.stringify(narrow)}`);
	assert.deepEqual(warnings, [], "and nothing is drawn past a max, so nothing warns");
	await openDemo([open("depth:1", "albums")]);
	await resize([[1600, 640], [420, 640]]);
	const gap = await page.evaluate(() => {
		const chain = document.querySelector('.frame[data-frame="a"] .supermax-body > .supermax-chain');
		const cells = [...chain.querySelectorAll(".supermax-cell")].filter((cell) => cell.getBoundingClientRect().width > 0);
		return Math.round(chain.getBoundingClientRect().right - cells.at(-1).getBoundingClientRect().right);
	});
	assert.ok(gap > 0, `a chain without an elastic cell in view leaves the canvas: ${gap}px`);
});

test("a host that shows the canvas keeps cells at their maximum and centres them", async () => {
	await page.goto("about:blank");
	await page.goto(`${server.url}/?delay=0&spare=center${PRESENTATION === "origami" ? "" : `&presentation=${PRESENTATION}`}#${encodeLog([open("depth:1", "albums")])}`);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	await settle();
	await resize([[1600, 640], [420, 640]]);
	const row = await page.evaluate(() => {
		const chain = document.querySelector('.frame[data-frame="a"] .supermax-body > .supermax-chain');
		const cells = [...chain.querySelectorAll(".supermax-cell")].filter((candidate) => candidate.getBoundingClientRect().width > 0);
		const outer = chain.getBoundingClientRect();
		return { width: cells.at(-1).getBoundingClientRect().width, left: cells[0].getBoundingClientRect().left - outer.left, right: outer.right - cells.at(-1).getBoundingClientRect().right };
	});
	assert.equal(Math.round(row.width), 240, "the cell stays at its max");
	assert.ok(row.left > 4 && Math.abs(row.left - row.right) < 1, `with the canvas showing equally on both sides: ${JSON.stringify(row)}`);
});

const folds = (frameKey) => page.evaluate((key) => document.getAnimations()
	.filter((animation) => animation.effect?.target?.matches?.(`.frame[data-frame="${key}"] .supermax-cell`) && animation.effect.getKeyframes().some((frame) => frame.transform !== undefined))
	.map((animation) => ({
		cell: animation.effect.target.dataset.occurrence.split("/").pop(),
		leaving: animation.effect.target.hasAttribute("data-supermax-exiting"),
		start: animation.startTime,
		delay: animation.effect.getTiming().delay,
		duration: animation.effect.getTiming().duration,
		easing: animation.effect.getTiming().easing,
		first: animation.effect.getKeyframes()[0].transform,
	})), frameKey);

test("a click opens its cell and every default under it in one stroke, folding together", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1400, 640], [420, 640]]);
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:d"));
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:d"]`));
	const opening = (await folds("a")).filter((fold) => !fold.leaving);
	assert.deepEqual(opening.map((fold) => fold.cell).sort(), ["coast:history:d", "coast:metadata:d", "coast:photo:d"], "the photo and its whole default chain fold open");
	assert.equal(new Set(opening.map((fold) => `${fold.start}+${fold.delay}`)).size, 1, "at the same moment");
	assert.ok(opening.every((fold) => fold.duration === 200 && fold.easing === "ease-out"), "in one 200ms stroke that eases out");
	const replaced = (await folds("a")).filter((fold) => fold.leaving).map((fold) => fold.cell).sort();
	assert.deepEqual(replaced, ["coast:metadata:a", "coast:photo:a"], "and the cells it replaces fold away with it, defaults included");
	assert.ok(opening.every((fold) => fold.delay === 200), "a replacement from rest first lets the old cells fold away");
	await settle();
	assert.equal(await page.locator(inFrame("a", "[data-supermax-exiting]")).count(), 0);
});

test("a cell that hides for lack of room, or comes back, only moves and never folds", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo(THREE_ROWS);
	await page.evaluate(() => {
		window.__folds = 0;
		const seen = new WeakSet();
		const watch = () => {
			for (const animation of document.getAnimations()) {
				if (seen.has(animation)) continue;
				seen.add(animation);
				if (animation.effect?.target?.classList?.contains("supermax-cell") && animation.effect.getKeyframes().some((frame) => String(frame.transform ?? "").includes("rotate"))) window.__folds += 1;
			}
			window.__watching = requestAnimationFrame(watch);
		};
		watch();
	});
	const visible = async () => (await boxes(inFrame("b", ".supermax-cell"))).filter((cell) => cell.visible).map((cell) => cell.id).join();
	const before = await visible();
	await page.evaluate((row) => window.supermaxDemo.frames[1].workspace.goTo(row), coast.row("people"));
	await settle();
	const shown = await visible();
	await page.evaluate((photo) => window.supermaxDemo.frames[1].workspace.goTo(photo), coast.photo("people", "c"));
	await settle();
	assert.notEqual(shown, before, "going to a hidden parent shows it and hides others in the narrow frame");
	assert.equal(await visible(), before, "and going back to the newest cell shows them again");
	assert.equal(await page.evaluate(() => window.__folds), 0, "hiding and showing are geometry, not an exit or an entrance");
	await page.evaluate(() => cancelAnimationFrame(window.__watching));
});

test("a card keeps its final size while it folds, and only its room opens or closes", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1400, 640], [420, 640]]);
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:d"));
	const cell = (id) => inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "d")}${id ? `/${id}` : ""}"]`);
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:d"]`));
	const sample = (time) => page.evaluate(({ time, cells }) => {
		document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time; });
		return cells.map((selector) => document.querySelector(selector).offsetWidth);
	}, { time, cells: [cell(""), cell("coast:metadata:d")] });
	const early = await sample(250);
	const late = await sample(350);
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
	await settle();
	const final = await page.evaluate((cells) => cells.map((selector) => document.querySelector(selector).offsetWidth), [cell(""), cell("coast:metadata:d")]);
	assert.deepEqual(early, final, "early in the fold the cards already have their final size");
	assert.deepEqual(late, final, "and keep it until the fold ends");
	const closing = await page.evaluate((selector) => {
		window.supermaxDemo.dispatch({ type: "close" }, window.supermaxDemo.frames[0].workspace);
		const element = document.querySelector(selector);
		const widths = [];
		for (const time of [0, 100, 190]) {
			document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time; });
			widths.push(element.offsetWidth);
		}
		return widths;
	}, cell(""));
	assert.ok(closing.every((width) => width === final[0]), `a closing card keeps its size while its room closes: ${closing}`);
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
	await settle();
});

test("a folding card is clipped to its own room, which keeps its gutter free", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:b", coast.row("map"))]);
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:c"));
	await page.click(inFrame("a", `[data-occurrence="${coast.row("map")}"] .pin[data-destination="coast:photo:c"]`));
	await page.evaluate(() => document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = 30; }));
	const leaving = await page.evaluate((selector) => {
		const cell = document.querySelector(selector);
		const room = cell.parentElement;
		const style = getComputedStyle(room);
		const gutter = getComputedStyle(cell).borderLeftWidth;
		return { room: room.classList.contains("supermax-room"), overflow: style.overflowX, clip: style.clipPath, gutter, projected: cell.getBoundingClientRect().left, rest: room.getBoundingClientRect().left };
	}, inFrame("a", `[data-occurrence="${coast.metadata("map", "b")}"]`));
	assert.equal(leaving.room, true, "the card folds inside a room of its own");
	assert.equal(leaving.overflow, "clip", "which clips whatever the perspective draws outside it");
	assert.ok(leaving.projected < leaving.rest, "the perspective pulls the card past its own left edge here");
	assert.equal(leaving.clip, `inset(0px 0px 0px ${leaving.gutter})`, "and the room cuts that off at the gutter");
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
	await settle();
});

test("the gutter beside a split stays in place while the cells in its rows slide past it", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:c", coast.row("thumbnails"))]);
	await resize([[420, 640], [960, 640]]);
	const album = inFrame("a", ".supermax-cell.is-split");
	const edge = () => page.locator(album).evaluate((cell) => {
		const frame = cell.querySelector(".supermax-row-chain");
		return { clip: getComputedStyle(frame).clipPath, left: Math.round(frame.getBoundingClientRect().left) };
	});
	const atRest = await edge();
	await page.evaluate(() => window.supermaxDemo.dispatch({ type: "close" }, window.supermaxDemo.frames[1].workspace));
	await page.evaluate(() => document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = 100; }));
	assert.equal((await page.locator(inFrame("a", `[data-row="${coast.row("thumbnails")}"] .supermax-strip`)).evaluate((strip) => strip.getAnimations().length)) > 0, true, "the row is sliding");
	assert.deepEqual(await edge(), { ...atRest, clip: "inset(0px 0px 0px 1px)" }, "the row frame keeps the gutter beside the split where it was and clips what slides past it");
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
	await settle();
});

test("a cell that stays but changes size takes its final size at once, and only its room moves", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:c", coast.row("thumbnails"))]);
	await resize([[420, 640], [960, 640]]);
	const thumbnails = inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"]`);
	await page.evaluate(() => window.supermaxDemo.dispatch({ type: "close" }, window.supermaxDemo.frames[1].workspace));
	const during = await page.evaluate((selector) => [60, 140].map((time) => {
		document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time; });
		return document.querySelector(selector).offsetWidth;
	}), thumbnails);
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
	await settle();
	const final = await page.locator(thumbnails).evaluate((cell) => cell.offsetWidth);
	assert.deepEqual(during, [final, final], `Thumbnails lays out once, at its final width ${final}px`);
});

test("browser back and forward animate, while a reload shows its state at once", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:b"));
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:b"]`));
	await settle();
	const folds = () => page.evaluate(() => document.getAnimations().filter((animation) => animation.effect?.target?.classList?.contains("supermax-cell") && animation.effect.getKeyframes().some((frame) => String(frame.transform ?? "").includes("rotate"))).length);
	await page.goBack();
	await page.waitForFunction(() => !location.hash.includes("photo:b"));
	assert.ok(await folds() > 0, "browser back folds the cells it changes");
	await settle();
	await page.goForward();
	await page.waitForFunction(() => location.hash.includes("photo:b"));
	assert.ok(await folds() > 0, "and so does browser forward");
	await settle();
});

test("a split that closes stays until the cells in its rows have folded away", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums")]);
	await closeNewest("a");
	const midway = await page.evaluate(() => {
		document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = 100; });
		const split = document.querySelector('.frame[data-frame="a"] .supermax-cell.is-split');
		const inner = split ? [...split.querySelectorAll(".supermax-cell")] : [];
		return {
			split: !!split?.isConnected,
			splitFolds: split ? split.getAnimations().some((animation) => animation.effect.getKeyframes().some((frame) => String(frame.transform ?? "").includes("rotate"))) : null,
			inner: inner.length,
			folding: inner.filter((cell) => cell.getAnimations().some((animation) => animation.effect.getKeyframes().some((frame) => String(frame.transform ?? "").includes("rotate")))).length,
		};
	});
	assert.equal(midway.split, true, "halfway the split is still there");
	assert.equal(midway.splitFolds, false, "it does not fold itself");
	assert.ok(midway.inner > 0 && midway.folding === midway.inner, `while every cell in its rows folds away: ${midway.folding} of ${midway.inner}`);
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
	await settle();
	assert.equal(await page.locator(inFrame("a", ".supermax-cell.is-split")).count(), 0, "and it is gone once they have");
});

test("a cell that shrinks keeps its layout until the transition ends, and slides under the cell that opens", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:c", coast.row("thumbnails"))]);
	await resize([[420, 640], [960, 640]]);
	await closeNewest("a");
	await settle();
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:b"));
	const thumbnails = inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"]`);
	const before = await page.locator(thumbnails).evaluate((cell) => cell.offsetWidth);
	await page.evaluate((selector) => document.querySelector(selector).click(), `${thumbnails} .thumb[data-destination="coast:photo:b"]`);
	const during = await page.evaluate((selector) => [20, 120, 190].map((time) => {
		document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time; });
		return document.querySelector(selector).offsetWidth;
	}), thumbnails);
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
	await settle();
	const after = await page.locator(thumbnails).evaluate((cell) => cell.offsetWidth);
	assert.ok(after < before, `Thumbnails shrinks from ${before}px to ${after}px`);
	assert.deepEqual(during, [before, before, before], "and lays out at its old width for the whole transition");
});

test("neighbours that move together stay joined at their shared edge, opening and closing, across and down", { skip: PRESENTATION !== "origami" }, async () => {
	const seams = (pairs, times) => page.evaluate(async ({ pairs, times }) => {
		const moments = [];
		for (const time of times) {
		document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time; });
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const visible = (element) => {
			const rect = element.getBoundingClientRect();
			let { left, right, top, bottom } = rect;
			for (let node = element.parentElement; node && !node.classList.contains("frame"); node = node.parentElement) {
				const style = getComputedStyle(node);
				const box = node.getBoundingClientRect();
				const inset = /inset\(([^)]*)\)/.exec(style.clipPath)?.[1].split(" ").map(parseFloat);
				const [insetTop = 0, insetRight = insetTop, insetBottom = insetTop, insetLeft = insetRight] = inset ?? [];
				if (inset || style.overflowX !== "visible") {
					left = Math.max(left, box.left + (inset ? insetLeft : 0));
					right = Math.min(right, box.right - (inset ? insetRight : 0));
				}
				if (inset || style.overflowY !== "visible") {
					top = Math.max(top, box.top + (inset ? insetTop : 0));
					bottom = Math.min(bottom, box.bottom - (inset ? insetBottom : 0));
				}
			}
			return { left, right, top, bottom };
		};
		const gaps = () => pairs.map(([before, after, axis]) => {
			const first = visible(document.querySelector(before));
			const second = visible(document.querySelector(after));
			return Math.round((axis === "x" ? second.left - first.right : second.top - first.bottom) * 10) / 10;
		});
		moments.push(gaps());
		}
		return moments;
	}, { pairs, times });
	const play = () => page.evaluate(async () => {
		document.getAnimations().forEach((animation) => animation.finish());
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	const cellIn = (id) => inFrame("a", `[data-occurrence="${id}"]`);
	await openDemo([open("album:coast", "albums"), open("coast:photo:c", coast.row("thumbnails"))]);
	await resize([[1400, 640], [420, 640]]);
	const across = [[cellIn(coast.row("thumbnails")), cellIn(coast.photo("thumbnails", "c")), "x"], [cellIn(coast.photo("thumbnails", "c")), cellIn(coast.metadata("thumbnails", "c")), "x"]];
	const joined = (moments) => moments.every((gaps) => gaps.every((gap) => gap > -1 && gap < 2));
	await closeNewest("a");
	const closing = await seams(across, [40, 100, 160].map((time) => time + SETTLE));
	assert.ok(joined(closing), `closing: each folding paper starts one gutter from where its neighbour ends: ${JSON.stringify(closing)}`);
	await play();
	await settle();
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:c"));
	await page.evaluate((selector) => document.querySelector(selector).click(), `${cellIn(coast.row("thumbnails"))} .thumb[data-destination="coast:photo:c"]`);
	const edges = await page.evaluate(async ({ selector, times }) => {
		const cell = document.querySelector(selector);
		const moments = [];
		for (const time of times) {
			document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time; });
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const room = cell.parentElement.getBoundingClientRect();
			moments.push(Math.round(room.left + room.width + parseFloat(getComputedStyle(cell.parentElement).marginRight) - cell.getBoundingClientRect().right) || 0);
		}
		return moments;
	}, { selector: cellIn(coast.row("thumbnails")), times: [40, 100, 160].map((time) => time + SETTLE) });
	assert.deepEqual(edges, [0, 0, 0], "the shrinking cell moves with that edge as a whole, its own right edge on it, never cut off");
	const opening = await seams(across, [40, 100, 160].map((time) => time + SETTLE));
	assert.ok(joined(opening), `opening: the same: ${JSON.stringify(opening)}`);
	await play();
	await settle();
	while ((await groups("a")).length > 0) { await closeNewest("a"); await settle(); }
	await page.evaluate(() => window.supermaxDemo.prepare("album:coast"));
	await page.evaluate(() => document.querySelector('.frame[data-frame="a"] .album-item[data-destination="album:coast"]').click());
	const down = [[cellIn(coast.row("thumbnails")), cellIn(coast.row("map")), "y"], [cellIn(coast.row("map")), cellIn(coast.row("people")), "y"]];
	const gutter = await seams(down, [100 + SETTLE]);
	assert.ok(joined(gutter), `opening rows: each folding row starts one gutter below the one above: ${JSON.stringify(gutter)}`);
	const later = await seams(down, [40, 160].map((time) => time + SETTLE));
	assert.ok(joined(later), `at every moment: ${JSON.stringify(later)}`);
	await play();
	await settle();
	await closeNewest("a");
	const folding = await seams(down, [40, 100, 160].map((time) => time + SETTLE));
	assert.ok(joined(folding), `and while the rows fold away: ${JSON.stringify(folding)}`);
	await play();
	await settle();
});

test("a row that stays but changes height moves its content with its bottom edge, never cut off and never laid out again", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[860, 470], [360, 640]]);
	const rows = [coast.row("thumbnails"), coast.row("map"), coast.row("people")];
	const shown = () => page.evaluate((ids) => ids.filter((id) => !document.querySelector(`.frame[data-frame="a"] .supermax-row[data-row="${id}"]`).classList.contains("is-hidden")), rows);
	const before = await shown();
	await page.evaluate((row) => window.supermaxDemo.frames[0].workspace.goTo(row), coast.row("thumbnails"));
	const after = await shown();
	const staying = before.filter((id) => after.includes(id));
	assert.ok(staying.length > 0, `some row stays in view: ${before} then ${after}`);
	const moments = await page.evaluate(async ({ ids, leaving }) => {
		const result = [];
		for (const time of [60, 140]) {
			document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time; });
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			result.push(ids.map((id) => {
				const row = document.querySelector(`.frame[data-frame="a"] .supermax-row[data-row="${id}"]`);
				return Math.round(row.querySelector(".supermax-row-chain").getBoundingClientRect().bottom - row.getBoundingClientRect().bottom) || 0;
			}));
			result.push(leaving.map((id) => getComputedStyle(document.querySelector(`.frame[data-frame="a"] .supermax-row[data-row="${id}"] .supermax-row-chain`)).visibility));
		}
		return result;
	}, { ids: staying, leaving: before.filter((id) => !after.includes(id)) });
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
	await settle();
	const hiding = before.filter((id) => !after.includes(id));
	assert.ok(hiding.length > 0, "a row also gives way");
	assert.deepEqual(moments, [staying.map(() => 0), hiding.map(() => "visible"), staying.map(() => 0), hiding.map(() => "visible")], "the content of each staying row ends on its bottom edge at every moment, and the row that gives way stays painted while it closes");
});

test("closing without a replacement plays the opening backwards, and clicking back and forth reverses the same motion", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:c", coast.row("thumbnails"))]);
	await resize([[1400, 640], [420, 640]]);
	await closeNewest("a");
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
	await settle();
	const cells = [coast.row("thumbnails"), coast.photo("thumbnails", "c"), coast.metadata("thumbnails", "c")].map((id) => inFrame("a", `[data-occurrence="${id}"]`));
	const pose = (times) => page.evaluate(async ({ selectors, times }) => {
		const moments = [];
		for (const time of times) {
			document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time; });
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			moments.push(selectors.map((selector) => {
				const rect = document.querySelector(selector).getBoundingClientRect();
				return [Math.round(rect.left), Math.round(rect.right), Math.round(rect.top)];
			}));
		}
		return moments;
	}, { selectors: cells, times });
	const finish = () => page.evaluate(async () => {
		document.getAnimations().forEach((animation) => animation.finish());
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:c"));
	await page.evaluate((selector) => document.querySelector(selector).click(), `${cells[0]} .thumb[data-destination="coast:photo:c"]`);
	const opening = await pose([50, 100, 150].map((time) => time + SETTLE));
	await finish();
	await settle();
	await closeNewest("a");
	const closing = await pose([150, 100, 50].map((time) => time + SETTLE));
	const near = (a, b) => a.every((cell, index) => cell.every((value, axis) => Math.abs(value - b[index][axis]) <= 2));
	assert.ok(opening.every((moment, index) => near(moment, closing[index])), `each moment of the close mirrors the opening: ${JSON.stringify({ opening, closing })}`);
	await finish();
	await settle();
	await page.evaluate((selector) => document.querySelector(selector).click(), `${cells[0]} .thumb[data-destination="coast:photo:c"]`);
	const motion = () => page.locator(cells[1]).evaluate(async (cell) => {
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const animation = cell.getAnimations().find((candidate) => candidate.effect.getKeyframes().some((frame) => String(frame.transform ?? "").includes("rotate")));
		window.pingPong ??= animation;
		return { same: animation === window.pingPong, rate: animation.playbackRate, time: Math.round(animation.currentTime) };
	});
	await page.evaluate((time) => document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time; }), 100 + SETTLE);
	assert.deepEqual(await motion(), { same: true, rate: 1, time: 100 + SETTLE }, "halfway through opening");
	await closeNewest("a");
	const back = await motion();
	assert.ok(back.same && back.rate === -1 && Math.abs(back.time - 100 - SETTLE) <= 50, `Back halfway reverses the opening from where it is: ${JSON.stringify(back)}`);
	await page.evaluate((selector) => document.querySelector(selector).click(), `${cells[0]} .thumb[data-destination="coast:photo:c"]`);
	const again = await motion();
	assert.ok(again.same && again.rate === 1 && Math.abs(again.time - 100 - SETTLE) <= 80, `and opening again reverses it once more: ${JSON.stringify(again)}`);
	await finish();
	await settle();
});

test("sync brings a workspace to a list of destinations in one render, or leaves it as it was", async () => {
	await openDemo();
	const outcome = await page.evaluate(() => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const events = [];
		for (const type of ["render", "change", "rejected"]) workspace.addEventListener(type, (event) => events.push(type === "change" ? `change:${event.detail.action.type}` : type));
		workspace.openModal({ title: "Draft", content: () => ({ element: document.createElement("p") }) }, {});
		const refused = workspace.sync(["albums", "nowhere"]);
		const optionalRefused = workspace.sync(["albums", "album:coast"], { ifRoom: ["nowhere"], origin: null });
		const modalAfterRefusal = !!workspace.modal;
		const before = [...events];
		events.length = 0;
		const result = workspace.sync(["albums", "album:coast"]);
		return { refused, optionalRefused, modalAfterRefusal, before, events, ok: result.ok, open: result.occurrence?.destination, modal: !!workspace.modal, groups: workspace.navigator.state().groups.map((group) => group.title) };
	});
	assert.deepEqual(outcome.refused, { ok: false, reason: "unknown-destination", destination: "nowhere" });
	assert.deepEqual(outcome.optionalRefused, { ok: false, reason: "unknown-destination", destination: "nowhere" }, "an unknown destination in ifRoom refuses the whole sync too");
	assert.deepEqual(outcome.before, ["rejected", "rejected"], "a refused sync renders nothing and reports the refusal");
	assert.equal(outcome.modalAfterRefusal, true, "and leaves an open modal alone");
	assert.deepEqual(outcome.events, ["render", "change:sync"], "a sync renders once and reports one change");
	assert.deepEqual([outcome.ok, outcome.open, outcome.modal, outcome.groups], [true, "album:coast", false, ["Coast"]], "it opens the album and closes the modal, like any navigation");
	await settle();
});

test("content hears when its cell starts to leave, and again when it comes back before it is gone", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:c", coast.row("thumbnails"))]);
	await closeNewest("a");
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
	await settle();
	await page.evaluate((photo) => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const original = workspace.content;
		window.lifecycle = [];
		workspace.content = (occurrence, definition, host) => {
			const handle = original(occurrence, definition, host);
			if (occurrence.id !== photo) return handle;
			const wrap = (inner) => ({ ...inner, update: (current, ws) => { window.lifecycle.push(`update:${current?.id === photo}`); inner.update?.(current, ws); }, leave: () => { window.lifecycle.push("leave"); inner.leave?.(); }, dispose: () => { window.lifecycle.push("dispose"); inner.dispose?.(); } });
			return typeof handle?.then === "function" ? handle.then(wrap) : wrap(handle);
		};
	}, coast.photo("thumbnails", "c"));
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:c"));
	const thumb = inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:c"]`);
	await page.evaluate((selector) => document.querySelector(selector).click(), thumb);
	await settle();
	await page.evaluate(() => { window.lifecycle.length = 0; document.getAnimations().forEach((animation) => animation.finish()); });
	await closeNewest("a");
	const leaving = await page.evaluate(() => [...window.lifecycle]);
	await page.evaluate((selector) => document.querySelector(selector).click(), thumb);
	const back = await page.evaluate(() => [...window.lifecycle]);
	await closeNewest("a");
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
	await page.waitForFunction(() => window.lifecycle.includes("dispose"));
	const gone = await page.evaluate(() => [...window.lifecycle]);
	assert.deepEqual(leaving, ["leave"], "closing tells the content at once, while its cell still folds away");
	assert.ok(back[0] === "leave" && back.slice(1).includes("update:true") && !back.includes("dispose"), `coming back before it is gone hands the same content its occurrence again: ${JSON.stringify(back)}`);
	assert.deepEqual(gone.slice(gone.lastIndexOf("leave")), ["leave", "dispose"], "and once it has folded away it is disposed");
});

test("content can place its own controls in the cell header, which keeps them visible and cuts the title short", async () => {
	await openDemo([open("album:coast", "albums")]);
	const photo = coast.photo("thumbnails", "a");
	const result = await page.evaluate(async (photo) => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const original = workspace.content;
		workspace.content = (occurrence, definition, host) => {
			const handle = original(occurrence, definition, host);
			if (occurrence.id !== photo) return handle;
			const button = Object.assign(document.createElement("button"), { className: "host-search", textContent: "Search" });
			return typeof handle?.then === "function" ? handle.then((inner) => ({ ...inner, header: button })) : { ...handle, header: button };
		};
		workspace.reload((occurrence) => occurrence.id === photo);
		const cell = document.querySelector(`.frame[data-frame="a"] [data-occurrence="${photo}"]`);
		await new Promise((resolve) => setTimeout(resolve, 50));
		const header = cell.querySelector(":scope > .supermax-cell-title");
		const title = header.querySelector(".supermax-cell-title-text");
		title.textContent = "A very long photo title that cannot possibly fit in the header of this cell";
		const button = header.querySelector(".host-search");
		const placed = !!button && button.getBoundingClientRect().right <= header.getBoundingClientRect().right + 0.5;
		const cut = getComputedStyle(title).textOverflow;
		const modal = workspace.openModal({ title: "Zoom", content: () => ({ element: document.createElement("p"), header: Object.assign(document.createElement("button"), { className: "host-zoom", textContent: "Zoom" }) }) }, {});
		await new Promise((resolve) => setTimeout(resolve, 50));
		const inModal = !!document.querySelector('.frame[data-frame="a"] .supermax-modal-header .host-zoom');
		workspace.closeModal("close");
		return { placed, cut, inModal };
	}, photo);
	assert.deepEqual(result, { placed: true, cut: "ellipsis", inModal: true });
	await closeNewest("a");
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
	await settle();
	assert.equal(await page.locator(inFrame("a", ".host-search")).count(), 0, "and the controls leave with their content");
});

test("a cell's title can change after it opened, in its header, its name, the rail and the navbar", async () => {
	await openDemo([open("album:coast", "albums")]);
	const renamed = await page.evaluate(() => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const album = workspace.navigator.child(workspace.navigator.root);
		const ok = workspace.setTitle(album.id, "Coast, renamed");
		const cell = document.querySelector(`.frame[data-frame="a"] [data-occurrence="${album.id}"]`);
		const rail = workspace.setTitle("albums", "All albums") && document.querySelector('.frame[data-frame="a"] [data-occurrence="albums"] .supermax-cell-title-text').textContent;
		return { ok, label: cell.getAttribute("aria-label"), navbar: document.querySelector('.frame[data-frame="a"] .supermax-title-text').textContent, rail, unknown: workspace.setTitle("nowhere", "x") };
	});
	assert.deepEqual(renamed, { ok: true, label: "Coast, renamed", navbar: "Coast, renamed", rail: "All albums", unknown: false });
});

test("Show asks first, so a host can keep it from closing a cell, and names the destinations it closed", async () => {
	await openDemo(TWENTY_DEEP);
	const asked = await page.evaluate(() => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const before = workspace.navigator.state().groups.length;
		const seen = [];
		const refuse = (event) => { seen.push(event.detail); event.preventDefault(); };
		workspace.addEventListener("show", refuse);
		workspace.addEventListener("up", () => seen.push("up"));
		const result = workspace.requestUp();
		workspace.removeEventListener("show", refuse);
		return { result, after: workspace.navigator.state().groups.length, before, seen };
	});
	assert.deepEqual(asked.result, { ok: false, reason: "cancelled" }, "a host that refuses keeps Show from happening");
	assert.equal(asked.after, asked.before, "and nothing closes");
	assert.equal(asked.seen.length, 1, "nor does an up follow");
	assert.deepEqual(asked.seen[0].shown, { occurrence: TWENTY_DEEP[14].from + "/depth:15", destination: "depth:15", title: "Depth 15" }, "the question names what would be shown");
	assert.deepEqual(asked.seen[0].closing.map((entry) => entry.destination), ["depth:20"], "and what would close, by destination");
	const done = await page.evaluate(() => new Promise((resolve) => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		workspace.addEventListener("up", (event) => resolve(event.detail.closed.map((entry) => entry.destination)), { once: true });
		workspace.requestUp();
	}));
	assert.deepEqual(done, ["depth:20"], "without a refusal it closes them and names them the same way");
});

test("zooming a cell hides the cells before it, keeps what follows, and Show zooms out, like v1", async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:c", coast.row("thumbnails"))]);
	await resize([[1400, 640], [420, 640]]);
	const photo = coast.photo("thumbnails", "c");
	const shown = () => page.evaluate(() => [...document.querySelectorAll('.frame[data-frame="a"] .supermax-cell')].filter((cell) => cell.closest(".supermax-row")?.matches('[data-row$="coast:thumbnails"]') && getComputedStyle(cell).visibility !== "hidden" && cell.getBoundingClientRect().width > 0).map((cell) => cell.dataset.occurrence.split("/").pop()));
	const before = await shown();
	assert.deepEqual(before.slice(0, 3), ["coast:thumbnails", "coast:photo:c", "coast:metadata:c"]);
	const events = await page.evaluate((photo) => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		window.zoomEvents = [];
		workspace.addEventListener("zoom", (event) => window.zoomEvents.push(event.detail.occurrence?.split("/").pop() ?? null));
		document.querySelector(`.frame[data-frame="a"] [data-occurrence="${photo}"] .supermax-cell-title .zoom-toggle`).click();
		return window.zoomEvents;
	}, photo);
	await settle();
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
	assert.deepEqual(events, ["coast:photo:c"], "the header's zoom control zooms Photo C");
	const zoomed = await shown();
	assert.deepEqual(zoomed.slice(0, 2), ["coast:photo:c", "coast:metadata:c"], `Thumbnails hides, and Photo C keeps what follows it: ${zoomed}`);
	const navbar = await page.locator(inFrame("a", ".supermax-up")).evaluate((button) => ({ hidden: button.hidden, text: button.textContent }));
	assert.deepEqual(navbar, { hidden: false, text: "‹Thumbnails" }, "the Show control offers the way back to the zoomed cell's hidden parent");
	await page.click(inFrame("a", ".supermax-up"));
	await settle();
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
	assert.deepEqual(await page.evaluate(() => window.zoomEvents), ["coast:photo:c", null], "and Show zooms out first");
	assert.deepEqual(await shown(), before, "bringing everything back, with nothing closed");
});

test("a replaced cell folds away towards where its own navigation came from, compared with where the new one came from", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums")]);
	const folds = await page.evaluate(async () => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const place = (top) => {
			const source = document.createElement("button");
			source.style.cssText = `position:absolute;left:0;top:${top}px;width:10px;height:10px`;
			workspace.element.append(source);
			return source;
		};
		const high = place(20);
		const low = place(400);
		const from = "albums/album:coast/coast:thumbnails";
		const photo = (id) => `${from}/coast:photo:${id}`;
		const finish = async () => {
			document.getAnimations().forEach((animation) => { if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish(); });
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		};
		const leaving = (id) => {
			const cell = document.querySelector(`.frame[data-frame="a"] [data-occurrence="${photo(id)}"]`);
			const fold = cell.getAnimations().find((animation) => !animation.effect.pseudoElement && animation.effect.getKeyframes().some((frame) => String(frame.transform ?? "").includes("rotate")));
			return [cell.style.transformOrigin, fold.effect.getKeyframes().at(-1).transform];
		};
		await Promise.all(["b", "c", "d"].map((id) => window.supermaxDemo.prepare(`coast:photo:${id}`)));
		workspace.apply({ type: "open", destination: "coast:photo:b", from, origin: high });
		await finish();
		workspace.apply({ type: "open", destination: "coast:photo:c", from, origin: low });
		const downward = leaving("b");
		await finish();
		workspace.apply({ type: "open", destination: "coast:photo:b", from, origin: high });
		const upward = leaving("c");
		await finish();
		workspace.apply({ type: "open", destination: "coast:photo:d", from });
		const unknown = leaving("b");
		await finish();
		high.remove();
		low.remove();
		return { downward, upward, unknown };
	});
	assert.deepEqual(folds.downward, ["center top", "rotateX(-90deg)"], "a click lower down folds the old cell away over its top edge");
	assert.deepEqual(folds.upward, ["center bottom", "rotateX(90deg)"], "a click higher up folds it away over its bottom edge");
	assert.deepEqual(folds.unknown, ["right center", "rotateY(-90deg)"], "without a source it folds away on its far edge as before");
});

test("clicks faster than a stroke tear the earlier cells off from where they are, and nothing jumps", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.evaluate(() => Promise.all(["b", "c", "d"].map((id) => window.supermaxDemo.prepare(`coast:photo:${id}`))));
	const thumb = (id) => inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:${id}"]`);
	const pose = (id) => page.evaluate((selector) => {
		const element = document.querySelector(selector);
		const style = getComputedStyle(element);
		const [x, y] = style.transformOrigin.split(" ").map(parseFloat);
		const matrix = new DOMMatrix().translate(x, y).multiply(new DOMMatrix(style.transform === "none" ? undefined : style.transform)).translate(-x, -y);
		return { matrix: [...matrix.toFloat64Array()].map((value) => Math.round(value * 1000) / 1000), opacity: Math.round(Number(style.opacity) * 1000) / 1000 };
	}, inFrame("a", `[data-occurrence="${coast.photo("thumbnails", id)}"]`));
	await page.click(thumb("b"));
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.pause()));
	await page.evaluate(() => document.getAnimations().forEach((animation) => { animation.currentTime = 300; }));
	const before = await pose("b");
	await page.evaluate((selector) => {
		document.querySelector(selector).click();
		document.getAnimations().forEach((animation) => animation.pause());
	}, thumb("c"));
	const after = await pose("b");
	assert.deepEqual(after, before, "the half-open cell starts its tear from its own pose");
	const tearing = (await folds("a")).find((fold) => fold.cell === "coast:photo:b");
	assert.equal(tearing?.leaving, true);
	assert.equal(tearing.easing, "ease-in", "and tears off as an exit");
	assert.equal((await folds("a")).find((fold) => fold.cell === "coast:photo:c" && !fold.leaving)?.delay, 0, "a place in motion does not wait: the next cell folds open at once");
	await page.evaluate((selector) => document.querySelector(selector).click(), thumb("d"));
	assert.ok(await page.locator(inFrame("a", `[data-supermax-exiting][data-occurrence$="coast:photo:b"], [data-supermax-exiting][data-occurrence$="coast:photo:c"]`)).count() >= 2, "every superseded layer stays on its own path");
	const paint = await page.evaluate((row) => [...document.querySelector(`.frame[data-frame="a"] [data-row="${row}"] .supermax-strip`).children]
		.map((box) => (box.querySelector(".supermax-cell") ?? box).dataset.occurrence.split("/").pop())
		.filter((id) => id.startsWith("coast:photo:")), coast.row("thumbnails"));
	assert.deepEqual(paint, ["coast:photo:a", "coast:photo:b", "coast:photo:c", "coast:photo:d"], "the oldest layer lies lowest and the cell that arrives now on top");
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
	await settle();
	assert.equal(await page.locator(inFrame("a", "[data-supermax-exiting]")).count(), 0, "and leaves when its own motion ends");
	assert.equal((await groups("a")).at(-1), "Photo D");
});

const shapes = (frameKey) => page.evaluate((key) => document.getAnimations()
	.filter((animation) => animation.effect?.target?.closest?.(`.frame[data-frame="${key}"]`))
	.map((animation) => {
		const frames = animation.effect.getKeyframes();
		const target = animation.effect.target;
		return { target: target.dataset?.occurrence?.split("/").pop() ?? target.className, changes: Object.keys(frames[0]).filter((property) => !["offset", "easing", "composite", "computedOffset"].includes(property) && frames[0][property] !== frames.at(-1)[property]) };
	})
	.filter((shape) => shape.changes.length > 0), frameKey);

test("renders that follow within the settle window move each room once, by the net change", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1400, 640], [420, 640]]);
	await page.evaluate(() => Promise.all(["coast:photo:b", "coast:photo:c"].map((id) => window.supermaxDemo.prepare(id))));
	const thumb = (id) => inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:${id}"]`);
	await page.click(thumb("c"));
	await settle();
	await page.evaluate((selector) => {
		window.supermaxDemo.dispatch({ type: "close" }, window.supermaxDemo.frames[0].workspace);
		document.querySelector(selector).click();
	}, thumb("c"));
	assert.deepEqual(await shapes("a"), [], "a close that the next render takes back moves nothing");
	await settle();
	await page.evaluate((selector) => {
		window.supermaxDemo.dispatch({ type: "close" }, window.supermaxDemo.frames[0].workspace);
		document.querySelector(selector).click();
	}, thumb("b"));
	const strokes = await folds("a");
	const away = strokes.filter((fold) => fold.leaving).map((fold) => fold.cell).sort();
	assert.deepEqual(away, ["coast:history:c", "coast:metadata:c", "coast:photo:c"], "a close followed by another opening at the same place is one replacement");
	assert.ok(strokes.filter((fold) => fold.leaving).every((fold) => fold.delay === 0), "whose old cells fold away at once");
	assert.ok(strokes.filter((fold) => !fold.leaving).every((fold) => fold.delay === STRIP_TIMING.duration), `and whose new cells open in their rooms once the old ones are gone: ${JSON.stringify(strokes)}`);
	await settle();
	assert.equal((await groups("a")).at(-1), "Photo B");
});

const departureOf = (selector) => page.locator(selector).evaluate((cell) => {
	const animation = cell.getAnimations().find((candidate) => candidate.effect.getKeyframes().some((frame) => String(frame.transform ?? "").includes("rotate")));
	return animation ? { delay: animation.effect.getTiming().delay, rate: animation.playbackRate, state: animation.playState, to: animation.effect.getKeyframes().at(-1).transform } : null;
});

test("while a layout is on its way the cells it replaces fold away in rooms that stay, and the new cell opens there in one stroke", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums")]);
	const photoA = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`);
	const room = () => page.locator(photoA).evaluate((cell) => Math.round(cell.parentElement.getBoundingClientRect().width));
	const before = await room();
	await page.evaluate(() => window.supermaxDemo.setNetwork({ delay: "1500" }));
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:b"]`));
	const departure = await departureOf(photoA);
	assert.equal(departure?.delay, TIMING.depart, "the old photo keeps its content for a moment, then folds away");
	assert.deepEqual((await shapes("a")).filter((shape) => !shape.changes.includes("transform") && !shape.changes.includes("opacity")), [], "and no room moves");
	await page.waitForTimeout(TIMING.depart + STRIP_TIMING.duration + 100);
	assert.equal((await departureOf(photoA)).state, "finished", "it is gone before the layout arrives");
	assert.equal(await room(), before, "its room stays, showing the canvas");
	assert.equal(await page.locator(photoA).evaluate((cell) => cell.inert), true, "and what folded away takes no clicks");
	await page.waitForSelector(inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "b")}"]`), { timeout: 3000 });
	const opening = (await folds("a")).filter((fold) => !fold.leaving);
	assert.deepEqual(opening.map((fold) => fold.cell).sort(), ["coast:metadata:b", "coast:photo:b"]);
	assert.ok(opening.every((fold) => fold.delay === STRIP_TIMING.settle), `the new cells open once the rooms settle, without folding the old ones again: ${JSON.stringify(opening)}`);
	await settle();
	assert.equal((await groups("a")).at(-1), "Photo B");
	assert.equal(await page.locator(inFrame("a", "[data-supermax-exiting]")).count(), 0);
});

test("a layout that arrives before the cells left replaces them as a known layout does", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.evaluate(() => window.supermaxDemo.setNetwork({ delay: "0" }));
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:b"]`));
	await opened();
	const strokes = await folds("a");
	assert.deepEqual(strokes.filter((fold) => fold.leaving).map((fold) => [fold.cell, fold.delay]).sort(), [["coast:metadata:a", 0], ["coast:photo:a", 0]], "the old cells fold away once, from where they are");
	assert.ok(strokes.filter((fold) => !fold.leaving).every((fold) => fold.delay === STRIP_TIMING.duration), "and the new ones open after them");
	await settle();
});

test("a layout that fails folds the departed cells back, and a slow click folds the way a fast one does", { skip: PRESENTATION !== "origami" }, async () => {
	const photoA = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`);
	const pin = inFrame("a", `[data-occurrence="${coast.row("map")}"] .pin[data-destination="coast:photo:c"]`);
	await openDemo([open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails")), open("coast:photo:b", coast.row("map"))]);
	const photoB = inFrame("a", `[data-occurrence="${coast.photo("map", "b")}"]`);
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:c"));
	await page.click(pin);
	const fast = (await folds("a")).find((fold) => fold.cell === "coast:photo:b" && fold.leaving);
	const fastPose = await page.locator(photoB).evaluate((cell) => cell.getAnimations().find((animation) => animation.effect.getKeyframes().some((frame) => String(frame.transform ?? "").includes("rotate"))).effect.getKeyframes().at(-1).transform);
	assert.ok(fast, "the fast click replaces Photo B");
	await settle();
	await openDemo([open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails")), open("coast:photo:b", coast.row("map"))]);
	await page.evaluate(() => window.supermaxDemo.setNetwork({ delay: "400", fail: "manifest" }));
	await page.click(pin);
	assert.equal((await departureOf(photoB)).to, fastPose, "the slow click folds Photo B away on the same edge");
	await page.waitForFunction((selector) => window.supermaxDemo.pending === 0 && document.querySelector(selector).getAnimations().some((animation) => animation.playbackRate === -1), photoB, { timeout: 3000 });
	const back = await departureOf(photoB);
	assert.ok(back.rate === -1 && back.state === "running", `when the layout fails, Photo B folds back from where it is: ${JSON.stringify(back)}`);
	await settle();
	assert.equal(await page.locator(photoB).evaluate((cell) => !cell.inert && getComputedStyle(cell).transform === "none"), true, "and is usable again");
	assert.equal(await page.locator(photoA).evaluate((cell) => getComputedStyle(cell).transform === "none"), true, "while another row never moved");
	await page.evaluate(() => window.supermaxDemo.setNetwork({ delay: "0", fail: "" }));
});

test("going back to a cell that is still folding away brings the same cell back from its pose", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:b"));
	const photoA = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`);
	const element = await page.locator(photoA).elementHandle();
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:b"]`));
	await page.evaluate(() => document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = 120; }));
	await page.evaluate((selector) => document.querySelector(selector).click(), inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:a"]`));
	const back = (await folds("a")).find((fold) => fold.cell === "coast:photo:a" && !fold.leaving);
	assert.ok(back, "Photo A folds back open");
	assert.equal(back.easing, "ease-out");
	assert.equal(await element.evaluate((node) => node.isConnected && !node.hasAttribute("data-supermax-exiting")), true, "it is the same cell, drafts and all");
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
	await settle();
	assert.equal((await groups("a")).at(-1), "Photo A", "and the click on it is the newest group");
});

test("origami folds a cell open from its parent's edge and back onto it when it closes, a replaced cell folding away on its far edge, the whole cell shading to the canvas with the fold", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo(THREE_ROWS);
	const motion = () => page.evaluate(() => {
		const cells = [...document.querySelectorAll('.frame[data-frame="a"] .supermax-cell')];
		return cells.map((cell) => {
			const animations = document.getAnimations().filter((animation) => animation.effect?.target === cell);
			const fold = animations.find((animation) => animation.effect.getKeyframes().some((frame) => frame.transform?.includes("rotate")));
			if (!fold) return null;
			const fade = animations.find((animation) => animation.effect.pseudoElement === "::after" && animation.effect.getKeyframes().some((frame) => frame.opacity !== undefined));
			const edge = (frames, folded) => frames.filter(folded).map((frame) => frame.computedOffset);
			return {
				cell: cell.dataset.occurrence.split("/").pop(),
				leaving: cell.hasAttribute("data-supermax-exiting"),
				origin: cell.style.transformOrigin,
				easing: fold.effect.getTiming().easing,
				direction: fold.effect.getTiming().direction,
				delay: fold.effect.getTiming().delay,
				end: fold.effect.getComputedTiming().endTime,
				transforms: fold.effect.getKeyframes().map((frame) => frame.transform),
				onEdge: edge(fold.effect.getKeyframes(), (frame) => frame.transform !== "none"),
				transparent: fade ? edge(fade.effect.getKeyframes(), (frame) => Number(frame.opacity) === 1) : null,
				opaque: getComputedStyle(cell).opacity,
				shadeOnCompositor: !!fade && !fade.effect.getKeyframes().some((frame) => Object.keys(frame).some((key) => key.startsWith("--"))),
				fadeTiming: fade ? [fade.effect.getTiming().easing, fade.effect.getTiming().delay, fade.effect.getComputedTiming().endTime] : null,
				innerFades: document.getAnimations().filter((animation) => cell.contains(animation.effect?.target) && animation.effect.target !== cell && animation.effect.getKeyframes().some((frame) => frame.opacity !== undefined)).length,
			};
		}).filter(Boolean);
	});
	const wholeCell = (animation, label, easing) => {
		assert.equal(animation.easing, easing, `${label} has ${easing}`);
		assert.deepEqual(animation.transparent, animation.onEdge, `${label} is fully shaded to the canvas exactly while it stands on edge`);
		assert.equal(animation.opaque, "1", `${label} stays opaque, so overlapping cells never show through each other`);
		assert.equal(animation.shadeOnCompositor, true, `${label} shades through the opacity of its canvas-coloured overlay, never through a property its content would recalculate`);
		assert.deepEqual(animation.fadeTiming, [animation.easing, animation.delay, animation.end], `${label} fades on the fold's timeline`);
		assert.equal(animation.innerFades, 0, `${label} fades as one, not element by element`);
	};
	await page.click(inFrame("a", '[data-occurrence$="coast:metadata:a"] .metadata-link:not(.album-export)'));
	const opening = (await motion()).find((animation) => !animation.leaving && animation.cell === "coast:history:a");
	assert.equal(opening?.origin, "left center", "a new cell folds open from the edge it shares with its parent");
	assert.equal(opening.transforms[0], "rotateY(90deg)");
	wholeCell(opening, "the opening cell", "ease-out");
	await settle();
	await page.evaluate(() => window.supermaxDemo.dispatch({ type: "close" }, window.supermaxDemo.frames[0].workspace));
	const closing = (await motion()).find((animation) => animation.leaving && animation.cell === "coast:history:a");
	assert.equal(closing?.origin, "left center", "a closed cell folds back onto the edge it opened from");
	assert.deepEqual([closing.transforms[0], closing.direction], ["rotateY(90deg)", "reverse"], "by playing its opening backwards, so its ease-out runs as an ease-in");
	wholeCell(closing, "the closing cell", "ease-out");
	await settle();
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:b"]`));
	const turning = await motion();
	const away = turning.find((animation) => animation.leaving && animation.cell === "coast:photo:a");
	const back = turning.find((animation) => !animation.leaving && animation.cell === "coast:photo:b");
	assert.equal(away?.origin, "right center", "the replaced cell folds away on its far edge");
	assert.equal(back?.origin, "left center", "and its successor folds open from its parent's edge");
	assert.ok(back.delay >= away.end, "the successor only folds open once the replaced cell is gone");
	assert.equal(back.end, 2 * STRIP_TIMING.duration, "each half takes a new cell's time");
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
	await opened();
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

test("closing the newest group reaches both frames", async () => {
	await openDemo(THREE_ROWS);
	await closeNewest("a");
	assert.deepEqual(await groups("a"), ["Coast", "Photo A", "Photo B"]);
	assert.deepEqual(await groups("b"), ["Coast", "Photo A", "Photo B"], "the shared log reaches the other frame");
	assert.equal(page.url().split("#")[1], `${encodeLog(THREE_ROWS)};b`);
});

const LONG_CHAIN = [open("album:coast", "albums"), open("coast:history:a", coast.metadata("thumbnails", "a")), open("coast:edit:a:2", coast.history("thumbnails", "a"))];

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
	await page.click(rail);
	await page.waitForSelector(inFrame("b", ".supermax-peek"));
	assert.equal(await page.locator(inFrame("a", ".supermax-peek")).count(), 0, "the peek is local to its frame");
	await page.click(inFrame("b", '.supermax-peek .album-item[data-destination="album:empty"]'));
	await page.waitForSelector(inFrame("b", ".supermax-peek"), { state: "detached" });
	assert.deepEqual(await groups("b"), ["Empty album"], "a navigation from the peek is applied and closes the peek");
	assert.deepEqual(await groups("a"), ["Empty album"], "the other frame receives the same action");
});

test("dividers resize cells and rows within their bounds by pointer, and reset to the app preference", async () => {
	await openDemo([open("album:coast", "albums")]);
	const photo = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`);
	const divider = inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"] .supermax-divider[data-divides="${coast.photo("thumbnails", "a")}"] .supermax-divider-handle`);
	const widthOf = (selector) => page.locator(selector).evaluate((element) => Math.round(element.getBoundingClientRect().width));
	const before = await widthOf(photo);
	const box = await page.locator(divider).boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
	await page.mouse.up();
	assert.equal(await widthOf(photo), before + 60, "dragging the divider widens the photo by the drag distance");
	assert.equal(await page.locator(inFrame("a", ".supermax-divider.is-sized .supermax-divider-reset")).count(), 1, "a divider with a session size shows its reset control");
	const far = await page.locator(divider).boundingBox();
	await page.mouse.move(far.x + far.width / 2, far.y + far.height / 2);
	await page.mouse.down();
	await page.mouse.move(far.x + far.width / 2 + 2000, far.y + far.height / 2, { steps: 6 });
	await page.mouse.up();
	const max = await widthOf(photo);
	assert.ok(max > before + 60 && max <= 520, `dragging past the bound stops at it, within the cell's maximum: ${max}px`);
	await resize([[900, 640], [420, 640]]);
	assert.equal(await page.locator(photo).evaluate((element) => element.closest(".supermax-chain").querySelector(".supermax-divider.is-sized") !== null), true, "the session size survives a frame resize");
	await page.evaluate((from) => window.supermaxDemo.frames[0].workspace.navigate("coast:photo:d", { from }), coast.row("thumbnails"));
	await settle();
	assert.equal(await page.locator(inFrame("a", ".supermax-divider.is-sized")).count(), 0, "a replaced cell takes its session size with it");
	await page.evaluate((from) => window.supermaxDemo.frames[0].workspace.navigate("coast:photo:a", { from }), coast.row("thumbnails"));
	await settle();
	const rowDivider = inFrame("a", `.supermax-divider.is-horizontal[data-divides="${coast.row("thumbnails")}"] .supermax-divider-handle`);
	const rowOf = () => page.locator(inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"]`)).evaluate((element) => Math.round(element.getBoundingClientRect().height));
	const rowBefore = await rowOf();
	const rowBox = await page.locator(rowDivider).boundingBox();
	await page.mouse.move(rowBox.x + 50, rowBox.y + rowBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(rowBox.x + 50, rowBox.y + rowBox.height / 2 - 30, { steps: 4 });
	await page.mouse.up();
	assert.equal(await rowOf(), rowBefore - 30, "a row divider resizes its row by pointer");
	await page.click(inFrame("a", `.supermax-divider.is-horizontal[data-divides="${coast.row("thumbnails")}"] .supermax-divider-reset`));
	assert.equal(await rowOf(), rowBefore, "its reset control restores the app preference");
	assert.equal(await page.locator(inFrame("a", ".supermax-divider.is-sized")).count(), 0);
	const frameHandle = await page.locator(frame("a")).evaluate((element) => getComputedStyle(element).resize);
	assert.equal(frameHandle, "both", "the frame handle is the browser's own resize control, not a divider");
	while ((await groups("a")).length > 0) { await closeNewest("a"); await settle(); }
	await page.click(inFrame("a", '.album-item[data-destination="album:coast"]'));
	await settle();
	assert.ok((await page.locator(inFrame("a", ".supermax-divider.is-horizontal")).count()) >= 2, "reopening the same split brings its row dividers back");
});

test("a remote destination opens once its layout arrives, with its whole chain in one render, and its content loads in a cell that already has its final shape", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	await page.selectOption("[data-delay]", "400");
	await page.evaluate(() => {
		window.__renders = 0;
		window.supermaxDemo.frames[0].workspace.addEventListener("render", () => { window.__renders += 1; });
	});
	const thumb = inFrame("a", `[data-occurrence="${coast.row("people")}"] [data-destination="coast:photo:c"]`);
	await page.click(thumb);
	await page.evaluate(() => { window.__renders = 0; });
	assert.equal(await page.locator(thumb).getAttribute("aria-busy"), "true", "the control shows at once that it is waiting");
	assert.ok(!(await state("a")).occurrences.includes(coast.photo("people", "c")), "nothing opens before the layout is known");
	const metadataCell = inFrame("a", `[data-occurrence="${coast.metadata("people", "c")}"]`);
	await page.waitForSelector(`${metadataCell}.is-loading`);
	const loading = await page.locator(metadataCell).evaluate((element) => element.offsetWidth);
	assert.ok((await state("a")).occurrences.includes(coast.history("people", "c")), "the whole default chain opens with the photo");
	await settle();
	assert.equal(await page.evaluate(() => window.__renders), 1, "one render once the layout is known, also while content loads");
	assert.equal(await page.locator(metadataCell).evaluate((element) => element.offsetWidth), loading, "the loaded cell keeps the width it opened with");
	assert.equal(await page.locator(thumb).getAttribute("aria-busy"), null);
	assert.deepEqual(await groups("a"), ["Coast", "Photo C"]);
	const layouts = await page.evaluate(() => window.supermaxDemo.requests.filter((request) => request.kind === "layout").map((request) => request.url));
	assert.deepEqual(layouts, ["/supermax/layout?destination=coast%3Aphoto%3Ac"], "two frames share one HEAD for the destination");

	await page.selectOption("[data-fail]", "content");
	await page.click(inFrame("a", `[data-occurrence="${coast.history("people", "c")}"] .edit-item[data-destination="coast:edit:c:3"]`));
	await settle();
	const failedCell = inFrame("a", `[data-occurrence="${coast.edit("people", "c", 3)}"]`);
	assert.equal(await page.locator(`${failedCell} .supermax-error strong`).textContent(), "Warm tint (C) could not load.", "a failed content request shows its error in the cell");
	assert.deepEqual(await groups("a"), ["Coast", "Photo C", "Warm tint (C)"], "the navigation itself stands, so Back still closes it");
	await page.selectOption("[data-fail]", "");
	await page.click(`${failedCell} .supermax-retry`);
	await settle();
	assert.equal(await page.locator(`${failedCell} .viewer-line`).textContent(), "Viewing as Ana", "retry loads the content without a new navigation");
	assert.deepEqual(await groups("a"), ["Coast", "Photo C", "Warm tint (C)"], "and adds no Back step");

	await page.selectOption("[data-delay]", "1500");
	await page.click(inFrame("a", `[data-occurrence="${coast.row("map")}"] [data-destination="coast:photo:b"]`));
	await closeNewest("a");
	await page.waitForTimeout(1700);
	await settle();
	assert.ok(!(await state("a")).occurrences.includes(coast.photo("map", "b")), "a layout arriving after Back opens nothing");
});

test("a reload shows the whole restored chain at once, without a fold, while layouts and content load", async () => {
	await page.goto("about:blank");
	await page.addInitScript(() => {
		window.__folds = 0;
		const seen = new WeakSet();
		const watch = () => {
			for (const animation of document.getAnimations()) {
				if (seen.has(animation)) continue;
				seen.add(animation);
				if (animation.effect?.target?.classList?.contains("supermax-cell") && animation.effect.getKeyframes().some((frame) => String(frame.transform ?? "").includes("rotate"))) window.__folds += 1;
			}
			requestAnimationFrame(watch);
		};
		requestAnimationFrame(watch);
	});
	await page.goto(`${server.url}/?delay=400${PRESENTATION === "origami" ? "" : `&presentation=${PRESENTATION}`}#${encodeLog([open("album:coast", "albums"), open("coast:photo:c", coast.row("people")), open("coast:history:c", coast.metadata("people", "c")), open("coast:edit:c:2", coast.history("people", "c"))])}`);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	assert.ok((await state("a")).occurrences.includes(coast.edit("people", "c", 2)), "the first render already holds the whole chain");
	await settle();
	assert.equal(await page.evaluate(() => window.__folds), 0, "nothing folds on load");
});

test("another viewer is another context, with its own layout for the same destination", async () => {
	await page.goto("about:blank");
	await page.goto(`${server.url}/?delay=0&viewer=ben${PRESENTATION === "origami" ? "" : `&presentation=${PRESENTATION}`}#${encodeLog([open("album:coast", "albums")])}`);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	await settle();
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"] .viewer-line`)).textContent(), "Viewing as Ben (read-only)");
	const defaultOfMetadata = () => page.evaluate(() => window.supermaxDemo.frames[0].workspace.navigator.definitionOf("coast:metadata:a").defaultChild ?? null);
	assert.equal(await defaultOfMetadata(), null, "Ben's metadata declares no history default");
	await page.selectOption("[data-context]", "ana");
	await page.waitForURL(/viewer=ana/);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	await settle();
	assert.equal(await defaultOfMetadata(), "coast:history:a", "switching the viewer loads the page with that viewer's layout");
});

test("a modal knows its source, makes the cells behind it inert and closes before Back", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	const modal = inFrame("a", ".supermax-modal-layer:not([data-supermax-exiting]) .supermax-modal");
	const photoCell = (row) => inFrame("a", `[data-occurrence="${coast.photo(row, "a")}"]`);
	const urlBefore = page.url();
	await page.selectOption("[data-delay]", "400");
	await page.click(`${photoCell("thumbnails")} .caption-edit`);
	assert.equal(await page.locator(`${modal} .supermax-modal-title`).textContent(), "Caption for Photo A");
	assert.equal(await page.locator(modal).getAttribute("aria-description"), "From Photo A", "the modal names its source to assistive technology");
	assert.equal(await page.locator(`${modal} .supermax-modal-context`).count(), 0, "while the frustum shows it, without a label under the title");
	assert.equal(await page.locator(`${modal} .supermax-loading`).textContent(), "Loading Caption for Photo A", "delayed modal content uses the loading state");
	await settle();
	assert.equal(await page.locator(`${modal} .viewer-line`).textContent(), "Editing as Ana");
	assert.equal(await page.locator(inFrame("a", ".supermax-body")).getAttribute("inert"), "", "the cells behind the modal are inert");
	await page.click(`${modal} .supermax-modal-close`);
	assert.equal(await page.locator(modal).count(), 0, "its close control closes the modal");
	assert.equal(page.url(), urlBefore, "a modal writes no history");
	await page.selectOption("[data-delay]", "0");
	await page.click(`${photoCell("people")} .caption-edit`);
	await settle();
	await page.fill(`${modal} .caption-editor-field`, "Dunes at dusk");
	await page.click(`${modal} button[type="submit"]`);
	assert.equal(await page.locator(modal).count(), 0, "saving closes the modal");
	assert.equal(await page.locator(`${photoCell("people")} .caption`).inputValue(), "Dunes at dusk", "the modal wrote into its own source cell");
	assert.equal(await page.locator(`${photoCell("thumbnails")} .caption`).inputValue(), "", "and not into the same photo in another row");
	await page.click(`${photoCell("people")} .caption-edit`);
	await settle();
	await page.evaluate(() => window.supermaxDemo.frames[0].workspace.openModal({ title: "Second", content: () => ({ element: document.createElement("p") }) }, {}));
	assert.equal(await page.locator(modal).count(), 1, "a second open request replaces the modal");
	assert.equal(await page.locator(`${modal} .supermax-modal-title`).textContent(), "Second");
	const groupsBefore = await groups("a");
	assert.equal(await page.locator(inFrame("a", ".supermax-up")).isHidden(), true, "with nothing hidden above the window the modal leaves no Show control to compete with its own close");
	await page.click(`${modal} .supermax-modal-close`);
	assert.equal(await page.locator(modal).count(), 0, "the replacing modal closes like the first");
	assert.deepEqual(await groups("a"), groupsBefore, "and navigates nothing");
	await page.click(inFrame("a", `[data-occurrence="${coast.row("map")}"] [data-destination="coast:photo:b"]`));
	await settle();
	await page.click(`${inFrame("a", `[data-occurrence="${coast.photo("map", "b")}"]`)} .caption-edit`);
	await settle();
	await closeNewest("b");
	await settle();
	assert.equal(await page.locator(modal).getAttribute("aria-description"), "Its source has closed", "a source closed from elsewhere is described as such");
	assert.equal(await page.locator(`${modal} .supermax-modal-context, ${modal}.is-orphaned`).count(), 0, "and shows only by the frustum that is gone");
	await page.click(`${modal} .supermax-modal-close`);
	assert.equal(await page.locator(modal).count(), 0);
	await page.click(`${photoCell("people")} .caption-edit`);
	await settle();
	await resize([[1100, 400], [360, 640]]);
	await page.evaluate((row) => window.supermaxDemo.frames[0].workspace.goTo(row), coast.row("thumbnails"));
	await settle();
	assert.equal(await page.locator(inFrame("a", `.supermax-row[data-row="${coast.row("people")}"]`)).evaluate((element) => element.classList.contains("is-hidden")), true, "the source row is out of view behind the modal");
	await page.click(`${modal} .supermax-modal-close`);
	assert.equal(await page.locator(modal).count(), 0, "a modal whose source is out of view closes like any other");
});

test("a notice is a bubble in its source cell, and moves to the top of the viewport naming a source out of view", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	const photoA = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`);
	const cellNotice = `${photoA} .supermax-cell-notices .supermax-notice`;
	await page.click(`${photoA} .caption-save`);
	await page.waitForSelector(cellNotice);
	assert.equal(await page.locator(`${cellNotice} .supermax-notice-text`).textContent(), "Caption saved", "a success notice appears as a bubble in its source cell, without naming it");
	assert.equal(await page.locator(cellNotice).evaluate((element) => element.classList.contains("is-success")), true);
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
	assert.equal(await page.locator(`${inFrame("a", ".supermax-notices")} .supermax-notice.is-action .supermax-notice-text`).textContent(), "Metadata A: Export of Coast is ready", "a modal moves bubbles to the top, out from under it, naming their source");
	await page.click(`${exportNotice} .supermax-notice-dismiss`);
	assert.equal(await page.locator(exportNotice).count(), 0, "dismissing a notice above a modal removes that notice");
	assert.equal(await page.locator(inFrame("a", ".supermax-modal")).count(), 1, "and leaves the modal open");
	await page.evaluate((source) => window.supermaxDemo.frames[0].workspace.notify({ id: "under-modal", scope: "cell", source, kind: "error", message: "Still here" }), coast.photo("thumbnails", "a"));
	const underModal = inFrame("a", '.supermax-notices [data-notice="under-modal"]');
	assert.equal(await page.locator(`${underModal} .supermax-notice-text`).textContent(), "Photo A: Still here", "a notice raised while a modal hides its source names it");
	await page.click(inFrame("a", ".supermax-modal-close"));
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
	assert.deepEqual(await workspaceClass(), [`supermax-presentation-${PRESENTATION}`], "the page starts in the requested presentation, origami by default");
	await page.selectOption("[data-presentation]", "origami");
	await settle();
	const before = { state: await state("a"), layout: await page.evaluate(() => JSON.stringify(window.supermaxDemo.frames[0].workspace.layout)) };
	await page.evaluate(() => window.supermaxDemo.frames[0].workspace.setPresentation(window.supermaxDemo.presentations.fold));
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
	await opened();
	assert.ok(await page.evaluate(() => document.getAnimations().some((animation) => animation.effect?.target?.closest?.(".supermax-cell") && String(animation.effect.getKeyframes?.()[0]?.transform ?? "").includes("rotateY"))), "the fold animates the entering cell with a rotation");
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:c"]`));
	const divider = inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"] .supermax-divider[data-divides="${coast.photo("thumbnails", "c")}"] .supermax-divider-handle`);
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
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:a"]`));
	assert.equal(await page.evaluate(() => document.getAnimations().length), 0, "reduced motion skips the fold entirely");
	assert.deepEqual((await groups("a")).slice(-1), ["Photo A"], "and reaches the same destination");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.selectOption("[data-presentation]", "origami");
	await settle();
	assert.deepEqual(await workspaceClass(), ["supermax-presentation-origami"]);
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
	await page.click(inFrame("a", ".supermax-up"));
	await settle();
	assert.equal((await groups("a")).length, 19, "Show closes Depth 20 to show Depth 15");
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${TWENTY_DEEP[19].from}/depth:20"]`)).count(), 0);
	await page.evaluate((source) => window.supermaxDemo.frames[0].workspace.notify({ id: "deep-three", scope: "cell", source, kind: "action", message: "Look here", action: { label: "Ok", run() {} } }), "albums/depth:1/depth:2/depth:3");
	await page.click(inFrame("a", '.supermax-notices [data-notice="deep-three"] .supermax-notice-go'));
	await settle();
	assert.equal(await page.locator(inFrame("a", '[data-occurrence="albums/depth:1/depth:2/depth:3"]')).evaluate((element) => getComputedStyle(element).visibility === "visible" && element.getBoundingClientRect().width > 0), true, "Show reveals a cell hidden far to the left");
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

test("a layout that failed is asked for again on the next attempt", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	await page.selectOption("[data-fail]", "manifest");
	const thumb = inFrame("a", `[data-occurrence="${coast.row("people")}"] [data-destination="coast:photo:b"]`);
	await page.click(thumb);
	await settle();
	assert.ok(!(await state("a")).occurrences.includes(coast.photo("people", "b")));
	await page.selectOption("[data-fail]", "");
	await page.click(thumb);
	await settle();
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.metadata("people", "b")}"] .viewer-line`)).textContent(), "Viewing as Ana");
});

test("a layout that fails leaves the workspace as it was, with Retry at its source, and a prefetch never opens a cell", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	await page.selectOption("[data-fail]", "manifest");
	const opened = async () => { const { occurrences, groups: list } = await state("a"); return { occurrences, groups: list }; };
	const before = await opened();
	await page.click(inFrame("a", `[data-occurrence="${coast.row("people")}"] [data-destination="coast:photo:b"]`));
	await settle();
	assert.deepEqual(await opened(), before, "nothing opened and no Back step was added");
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.row("people")}"] .supermax-notice`)).count(), 0, "the row stays usable: the message does not cover it");
	const notice = inFrame("a", ".supermax-notice");
	assert.match(await page.locator(notice).textContent(), /Could not open Person 2 in Photo B from People\. The server answered 503\./, "the source says what failed");
	await page.selectOption("[data-fail]", "");
	const requestsBefore = await page.evaluate(() => window.supermaxDemo.requests.length);
	await page.hover(inFrame("a", `[data-occurrence="${coast.row("people")}"] [data-destination="coast:photo:d"]`));
	await page.waitForTimeout(250);
	await settle();
	const asked = await page.evaluate((from) => window.supermaxDemo.requests.slice(from).map((request) => request.url), requestsBefore);
	assert.deepEqual(asked, ["/supermax/layout?destination=coast%3Aphoto%3Ad"], "hovering a link asks for its layout");
	assert.ok(!(await state("a")).occurrences.includes(coast.photo("people", "d")), "and opens nothing");
	await page.click(`${notice} .supermax-notice-action`);
	await settle();
	const cell = inFrame("a", `[data-occurrence="${coast.metadata("people", "b")}"]`);
	assert.equal(await page.locator(`${cell} .viewer-line`).textContent(), "Viewing as Ana", "Retry asks for the layout again and opens the destination");
	assert.deepEqual(await groups("a"), ["Coast", "Photo B"]);
	await page.click(inFrame("a", ".supermax-crumb:has-text('Coast')"));
	await settle();
});

test("the demo's Speed control slows every time Supermax and the demo keep, and keeps that in the URL", async () => {
	const SLOW = 10;
	const near = (actual, expected) => actual >= expected * 0.9 && actual <= expected * 1.4;
	const until = (check) => page.evaluate((source) => new Promise((resolve) => {
		const test = new Function(`return (${source})()`);
		const started = performance.now();
		const poll = () => (test() ? resolve(performance.now() - started) : requestAnimationFrame(poll));
		poll();
	}), check.toString());
	await openDemo(LONG_CHAIN);
	await page.selectOption("[data-speed]", String(SLOW));
	assert.match(page.url(), /[?&]speed=10/, "the choice is in the URL");
	await page.evaluate(() => document.querySelector('.frame[data-frame="b"] [data-occurrence="albums"] .supermax-rail').dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" })));
	const opening = await until(() => !!document.querySelector('.frame[data-frame="b"] .supermax-peek'));
	assert.ok(near(opening, 150 * SLOW), `a peek opens after ${SLOW} times its 150ms: ${Math.round(opening)}ms`);
	await page.evaluate(() => document.querySelector('.frame[data-frame="b"] .supermax-peek').dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" })));
	const closing = await until(() => !document.querySelector('.frame[data-frame="b"] .supermax-peek'));
	assert.ok(near(closing, 200 * SLOW), `and closes after ${SLOW} times its 200ms: ${Math.round(closing)}ms`);
	await page.evaluate(() => { window.slowNotice = window.supermaxDemo.frames[0].workspace.notify({ scope: "workspace", kind: "success", message: "Saved", duration: 100 }); });
	const expiry = await until(() => !window.supermaxDemo.frames[0].workspace.notices.notices.has(window.slowNotice));
	assert.ok(near(expiry, 100 * SLOW), `a notice expires after ${SLOW} times its duration: ${Math.round(expiry)}ms`);

	await openDemo([open("album:coast", "albums")]);
	await page.selectOption("[data-speed]", String(SLOW));
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:b"));
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:b"]`));
	const replacing = await folds("a");
	assert.ok(replacing.length > 0 && replacing.every((fold) => fold.duration === STRIP_TIMING.duration * SLOW), `every fold lasts ${SLOW} times longer: ${JSON.stringify(replacing)}`);
	assert.ok(replacing.filter((fold) => !fold.leaving).every((fold) => fold.delay === STRIP_TIMING.duration * SLOW), "and a replacement waits that much longer for the old cells");
	await settle();
	await page.evaluate(() => window.supermaxDemo.setNetwork({ delay: "400" }));
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:c"]`));
	assert.equal((await departureOf(inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "b")}"]`)))?.delay, TIMING.depart * SLOW, "the wait before a departure grows with it");
	await page.waitForTimeout(400 * 3);
	assert.equal((await state("a")).occurrences.includes(coast.photo("thumbnails", "c")), false, "the demo's network delay is slowed too");
	await page.waitForFunction((id) => window.supermaxDemo.frames[0].workspace.navigator.get(id), coast.photo("thumbnails", "c"), { timeout: 400 * SLOW * 2 });
	await settle();
	await closeNewest("a");
	const closingFolds = (await folds("a")).filter((fold) => fold.leaving);
	assert.ok(closingFolds.length > 0 && closingFolds.every((fold) => fold.delay === STRIP_TIMING.settle * SLOW), `and so does the settle window: ${JSON.stringify(closingFolds)}`);
	await settle();
	const requests = await page.evaluate(() => window.supermaxDemo.requests.length);
	await page.hover(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:d"]`));
	await page.waitForTimeout(100 * 4);
	assert.equal(await page.evaluate(() => window.supermaxDemo.requests.length), requests, "and so is the pause before a hover asks for a layout");
	await page.reload();
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	assert.equal(await page.inputValue("[data-speed]"), "10", "the choice survives a reload");
	await page.selectOption("[data-speed]", "1");
	assert.doesNotMatch(page.url(), /speed=/);
	await page.evaluate(() => window.supermaxDemo.setNetwork({ delay: "0" }));
	await settle();
});

test("reset restores both frames and clears the URL", async () => {
	await openDemo(THREE_ROWS);
	await page.click("[data-reset]");
	await page.waitForFunction(() => !location.hash);
	for (const key of ["a", "b"]) {
		assert.deepEqual(await state(key), { occurrences: ["albums"], groups: [] }, `frame ${key}`);
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

test("history restore names where the application now is", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.click(inFrame("b", `[data-occurrence="${coast.row("map")}"] .pin[data-destination="coast:photo:b"]`));
	await page.waitForFunction(() => location.hash.includes("photo:b"));
	await page.goBack();
	await page.waitForFunction(() => !location.hash.includes("photo:b"));
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
	await opened();
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
		workspace.destroy();
		return { children: element.childElementCount, classes: element.className, cells: workspace.cells.size, navbarProperty: element.style.getPropertyValue("--supermax-navbar") };
	});
	assert.deepEqual(result, { children: 0, classes: "frame-workspace", cells: 0, navbarProperty: "" });
});
