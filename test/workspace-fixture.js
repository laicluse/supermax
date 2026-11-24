import assert from "node:assert/strict";
import { after, before, beforeEach } from "node:test";
import { openBrowser } from "./browser.js";
import { albums, depthCount, depthId, paths } from "../docs/assets/album.js";
import { encodeLog } from "../docs/assets/deeplink.js";
import { STRIP_TIMING } from "../src/cell-strip.js";
import { serveDocs } from "./serve-docs.js";

const coast = paths(albums[0]);
const SETTLE = STRIP_TIMING.settle;
const open = (destination, from) => ({ type: "open", destination, from });
const THREE_ROWS = [open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails")), open("coast:photo:b", coast.row("map")), open("coast:photo:c", coast.row("people"))];

const TWENTY_DEEP = Array.from({ length: depthCount }, (_, index) => open(depthId(index + 1), ["albums", ...Array.from({ length: index }, (_, step) => depthId(step + 1))].join("/")));

let server;
let browser;
let page;
const errors = [];

export function installWorkspaceHooks() {
	before(async () => {
		server = await serveDocs();
		browser = await openBrowser();
		page = await newDemoPage();
	});

	after(async () => {
		await browser?.close();
		await server?.close();
		assert.deepEqual(errors, [], "no page errors during the scenarios");
	});

	beforeEach(async () => {
		await page.emulateMedia({ reducedMotion: "no-preference" });
	});
}

async function newDemoPage() {
	const demoPage = await browser.newPage({ viewport: { width: 1720, height: 900 } });
	demoPage.on("pageerror", (error) => errors.push(error.message));
	return demoPage;
}

async function useDemoPage(test) {
	const originalPage = page;
	const clockPage = await newDemoPage();
	page = clockPage;
	test.after(async () => {
		page = originalPage;
		await clockPage.close();
	});
}

async function useDemoClock(test) {
	await useDemoPage(test);
	await page.clock.install();
}

const PRESENTATION = process.env.SUPERMAX_PRESENTATION ?? "origami";

async function openDemo(log = []) {
	await page.goto("about:blank");
	await page.goto(`${server.url}/?delay=0&presentation=${PRESENTATION}${log.length ? `#${encodeLog(log)}` : ""}`);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	await settle();
}

async function openDemoWithNothingKept(log) {
	await openDemo(log);
	await page.evaluate(() => {
		for (const { workspace } of window.supermaxDemo.frames) {
			delete workspace.navigator.destinations.albums.overflow;
			workspace.render({ animate: false });
		}
	});
	await settle();
}

const frame = (key) => `.frame[data-frame="${key}"]`;
const inFrame = (key, selector) => selector.split(", ").map((part) => `${frame(key)} ${part}`).join(", ");
const readout = (key, part) => `${frame(key)} + .readout .readout-${part}`;

async function waitForContent() {
	await page.waitForFunction(() => window.supermaxDemo.pending === 0 && !document.querySelector(".supermax-cell.is-loading"));
}

async function settle() {
	await waitForContent();
	await page.evaluate(() => document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).forEach((animation) => animation.finish()));
	await page.waitForFunction(() => document.getAnimations().every((animation) => animation.effect?.getTiming().iterations === Infinity) && window.supermaxDemo.pending === 0 && !document.querySelector(".supermax-cell.is-loading"));
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
	const control = page.locator(inFrame(key, ".supermax-up:not([hidden])"));
	if (!(await control.count())) return { hidden: true, label: null, text: "" };
	return control.evaluate((button) => ({ hidden: button.hidden, label: button.getAttribute("aria-label"), text: button.textContent }));
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

const folds = (frameKey) => page.evaluate((key) => document.getAnimations()
	.filter((animation) => animation.effect?.target?.matches?.(`.frame[data-frame="${key}"] .supermax-cell`) && animation.effect.getKeyframes().some((frame) => frame.transform !== undefined))
	.map((animation) => ({
		cell: animation.effect.target.dataset.occurrence.split("/").pop(),
		leaving: animation.effect.target.hasAttribute("data-supermax-exiting"),
		start: animation.startTime,
		delay: animation.effect.getTiming().delay,
		duration: animation.effect.getTiming().duration,
		first: animation.effect.getKeyframes()[0].transform,
	})), frameKey);

const departureOf = (selector) => page.locator(selector).evaluate((cell) => {
	const animation = cell.getAnimations().find((candidate) => candidate.effect.getKeyframes().some((frame) => frame.transform !== undefined));
	return animation ? { delay: animation.effect.getTiming().delay, rate: animation.playbackRate, state: animation.playState, to: animation.effect.getKeyframes().at(-1).transform } : null;
});

export { coast, TWENTY_DEEP, SETTLE, open, THREE_ROWS, server, page, useDemoPage, useDemoClock, PRESENTATION, openDemo, openDemoWithNothingKept, frame, inFrame, readout, settle, opened, state, groups, backButton, closeNewest, resize, boxes, hiddenRows, painted, folds, departureOf, waitForContent };
