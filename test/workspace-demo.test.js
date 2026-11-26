import assert from "node:assert/strict";
import { test } from "node:test";
import { albums, depthCount, depthId } from "../docs/assets/album.js";
import { encodeLog } from "../docs/assets/deeplink.js";
import { STRIP_TIMING } from "../src/cell-strip.js";
import { TIMING } from "../src/motion.js";
import { coast, TWENTY_DEEP, open, THREE_ROWS, server, page, useDemoPage, useDemoClock, PRESENTATION, openDemo, openDemoWithNothingKept, frame, inFrame, readout, settle, opened, state, groups, backButton, closeNewest, resize, boxes, hiddenRows, painted, folds, departureOf, installWorkspaceHooks } from "./workspace-fixture.js";

installWorkspaceHooks();

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
	assert.equal(await page.locator(inFrame("a", ".supermax-body")).evaluate((body) => Math.round(body.getBoundingClientRect().top - body.parentElement.getBoundingClientRect().top)), 0, "the cells start at the top of the workspace, with no bar of the shell's above them");
});

test("hiding rows and cells keeps navigation, draft and scroll, and the content cell scrolls by wheel", async () => {
	await openDemoWithNothingKept(THREE_ROWS);
	const captionSelector = inFrame("a", `[data-occurrence="${coast.photo("people", "c")}"] .caption`);
	const metadataBody = inFrame("a", `[data-occurrence="${coast.metadata("people", "c")}"] .supermax-cell-body`);
	await page.fill(captionSelector, "Lighthouse at dusk");
	const metadataBox = await page.locator(metadataBody).boundingBox();
	await page.mouse.move(metadataBox.x + metadataBox.width / 2, metadataBox.y + metadataBox.height / 2);
	await page.mouse.wheel(0, 120);
	await page.waitForFunction((selector) => document.querySelector(selector).scrollTop > 0, metadataBody);
	const scrolled = await page.locator(metadataBody).evaluate((body) => body.scrollTop);
	const before = await state("a");
	await resize([[420, 370], [420, 640]]);
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
	await openDemoWithNothingKept(THREE_ROWS);
	const visible = await page.locator(inFrame("b", ".supermax-cell")).evaluateAll((elements) => elements
		.filter((element) => getComputedStyle(element).visibility === "visible")
		.map((element) => ({ id: element.dataset.occurrence, width: element.getBoundingClientRect().width })));
	const minima = await page.evaluate(() => {
		const model = window.supermaxDemo.frames[1].workspace.navigator;
		const layout = model.layout();
		return Object.fromEntries([...model.occurrences.values()].map((occurrence) => [occurrence.id, layout.cells.get(occurrence.id)?.min ?? 0]));
	});
	for (const cell of visible) assert.ok(cell.width >= minima[cell.id], `${cell.id} is not narrower than its own minimum`);
	await resize([[960, 640], [420, 200]]);
	assert.equal(await page.locator(readout("b", "limit")).count(), 0, "a scrollable short frame does not raise a developer warning");
	assert.equal(Math.round(await page.locator(inFrame("b", ".supermax-row:not(.is-hidden)")).evaluate((element) => element.getBoundingClientRect().height)), 180);
	assert.equal(await page.locator(inFrame("b", ".supermax-body")).evaluate((body) => body.scrollHeight > body.clientHeight), true);
	await resize([[960, 640], [420, 640]]);
	assert.equal(await page.locator(readout("b", "limit")).count(), 0);
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

test("a long chain leaves the host's responsive albums menu at its declared minimum", async () => {
	await openDemo(LONG_CHAIN);
	await resize([[960, 640], [380, 640]]);
	const cells = await page.locator(inFrame("a", `[data-occurrence^="${coast.row("thumbnails")}"]`)).evaluateAll((elements) => elements.map((element) => ({ visible: getComputedStyle(element).visibility === "visible" && element.getBoundingClientRect().width > 0 })));
	assert.ok(cells.some((cell) => !cell.visible) && cells[cells.length - 1].visible, "old cells hide entirely and the newest stays");
	const menu = inFrame("b", '[data-occurrence="albums"]');
	assert.ok(await page.locator(menu).evaluate((element) => element.getBoundingClientRect().width >= 48), "the menu keeps its host-declared minimum");
	assert.equal(await page.locator(`${menu} .album-item-icon`).first().isVisible(), true, "the host content switches to icons at that width");
	assert.equal(await page.locator(`${menu} .album-item-label`).first().isVisible(), false, "long labels leave the narrow menu");
	assert.equal(await page.locator(inFrame("b", ".supermax-compact, .supermax-peek")).count(), 0, "Supermax renders no duplicate presentation");
	await page.click(`${menu} .album-item[data-destination="album:empty"]`);
	assert.deepEqual(await groups("b"), ["Empty album"], "a menu icon navigates");
	assert.deepEqual(await groups("a"), ["Empty album"], "and the other frame follows");
	await resize([[960, 640], [380, 360]]);
	assert.equal(await page.locator(`${menu} .album-item-icon`).first().isVisible(), true, "the icons remain usable at the supported minimum height");
});

test("a dragged divider sizes its preceding cell and resets its preference", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1200, 640], [420, 640]]);
	const thumbnails = inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"]`);
	const photo = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`);
	const metadata = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}/coast:metadata:a"]`);
	const divider = inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"] .supermax-divider.is-vertical[data-divides="${coast.row("thumbnails")}"] .supermax-divider-handle`);
	const widthOf = (selector) => page.locator(selector).evaluate((element) => Math.round(element.getBoundingClientRect().width));
	const widths = async () => [await widthOf(thumbnails), await widthOf(photo), await widthOf(metadata)];
	const drag = async (dx) => {
		const box = await page.locator(divider).boundingBox();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 6 });
		await page.mouse.up();
		return box;
	};
	const [thumbnailsBefore, photoBefore, metadataBefore] = await widths();
	const box = await drag(-20);
	assert.deepEqual(await widths(), [thumbnailsBefore - 20, photoBefore + 20, metadataBefore], "dragging left shrinks the cell before the edge and gives the room to the cell after it");
	assert.equal(await page.locator(inFrame("a", `.supermax-divider.is-sized[data-divides="${coast.row("thumbnails")}"] .supermax-divider-reset`)).count(), 1, "a divider with a session size shows its reset control");
	const widthReset = page.locator(inFrame("a", `.supermax-divider.is-sized[data-divides="${coast.row("thumbnails")}"] .supermax-divider-reset`));
	assert.equal(await widthReset.getAttribute("data-direction"), "right", "the reset arrow points to the preferred gutter position");
	assert.equal(await widthReset.locator("svg path").count(), 1, "the reset icon is a line drawing");
	assert.deepEqual(await widthReset.evaluate((button) => ({ ink: getComputedStyle(button).color, canvas: getComputedStyle(button.closest(".supermax-workspace")).getPropertyValue("--supermax-default-canvas").trim() })), await widthReset.evaluate((button) => { const canvas = getComputedStyle(button.closest(".supermax-workspace")).getPropertyValue("--supermax-default-canvas").trim(); const probe = document.createElement("span"); probe.style.color = canvas; button.append(probe); const ink = getComputedStyle(probe).color; probe.remove(); return { ink, canvas }; }), "the icon ink uses the canvas colour");
	const hairline = () => page.locator(divider).evaluate((element) => getComputedStyle(element, "::before").backgroundColor);
	await page.mouse.move(box.x + box.width / 2 - 20, box.y + 400);
	await page.waitForTimeout(400);
	assert.equal(await hairline(), "rgba(0, 0, 0, 0)", "a sized divider goes back to a quiet hairline once the pointer leaves it");
	const held = await page.locator(divider).boundingBox();
	await page.mouse.move(held.x + held.width / 2, held.y + held.height / 2);
	await page.mouse.down();
	await page.mouse.move(held.x + held.width / 2 + 30, held.y + held.height / 2, { steps: 4 });
	await page.mouse.move(held.x + held.width / 2 + 30, held.y + held.height / 2 + 300, { steps: 2 });
	await page.waitForTimeout(400);
	assert.equal(await hairline(), "rgba(0, 0, 0, 0)", "the divider stays visually quiet while it is dragged, also beyond its hit area");
	await page.mouse.move(held.x + held.width / 2, held.y + held.height / 2, { steps: 4 });
	await page.mouse.up();
	assert.deepEqual(await widths(), [thumbnailsBefore - 20, photoBefore + 20, metadataBefore], "dragging back to where the drag started puts every cell back");
	const lost = await page.locator(divider).boundingBox();
	await page.mouse.move(lost.x + lost.width / 2, lost.y + lost.height / 2);
	await page.mouse.down();
	await page.locator(divider).evaluate((element) => { for (let id = 0; id < 8; id += 1) if (element.hasPointerCapture(id)) element.releasePointerCapture(id); });
	await page.mouse.move(lost.x + lost.width / 2 + 10, lost.y + lost.height / 2 + 200, { steps: 4 });
	await page.mouse.up();
	assert.deepEqual(await widths(), [thumbnailsBefore - 10, photoBefore + 10, metadataBefore], "the edge keeps following when the handle loses the pointer capture");
	await drag(2000 + 20);
	const [thumbnailsWide, photoNarrow, metadataNarrow] = await widths();
	assert.ok(thumbnailsWide > thumbnailsBefore + 40, `dragging far right grows the cell before the edge: ${thumbnailsWide}px from ${thumbnailsBefore}px`);
	assert.equal(await widthReset.getAttribute("data-direction"), "left", "the arrow reverses when reset would move the gutter left");
	assert.ok(photoNarrow < photoBefore && photoNarrow >= 240 && metadataNarrow <= metadataBefore && metadataNarrow >= 200, `the cells after it give way within their bounds: ${photoNarrow}px and ${metadataNarrow}px`);
	await resize([[900, 640], [420, 640]]);
	assert.equal(await page.locator(photo).evaluate((element) => element.closest(".supermax-chain").querySelector(".supermax-divider.is-sized") !== null), true, "the session size survives a frame resize");
	await page.evaluate((from) => window.supermaxDemo.frames[0].workspace.navigate("coast:photo:d", { from }), coast.row("thumbnails"));
	await settle();
	assert.equal(await page.locator(inFrame("a", `.supermax-divider.is-sized[data-divides^="${coast.photo("thumbnails", "d")}"]`)).count(), 0, "a replaced cell takes its session size with it");
	await page.evaluate((from) => window.supermaxDemo.frames[0].workspace.navigate("coast:photo:a", { from }), coast.row("thumbnails"));
	await settle();
	const rowDivider = inFrame("a", `.supermax-divider.is-horizontal[data-divides="${coast.row("thumbnails")}"] .supermax-divider-handle`);
	const rowOf = () => page.locator(inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"]`)).evaluate((element) => Math.round(element.getBoundingClientRect().height));
	const rowBefore = await rowOf();
	const rowBox = await page.locator(rowDivider).boundingBox();
	await page.mouse.move(rowBox.x + 50, rowBox.y + rowBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(rowBox.x + 50, rowBox.y + rowBox.height / 2 - 5, { steps: 4 });
	await page.mouse.up();
	assert.equal(await rowOf(), rowBefore - 5, "a row divider resizes its row by pointer");
	const rowReset = page.locator(inFrame("a", `.supermax-divider.is-horizontal[data-divides="${coast.row("thumbnails")}"] .supermax-divider-reset`));
	assert.equal(await rowReset.getAttribute("data-direction"), "down", "a row reset points toward its preferred lower gutter");
	await page.click(inFrame("a", `.supermax-divider.is-horizontal[data-divides="${coast.row("thumbnails")}"] .supermax-divider-reset`));
	await settle();
	assert.equal(await rowOf(), rowBefore, "its reset control restores the app preference");
	assert.equal(await page.locator(inFrame("a", ".supermax-divider.is-horizontal.is-sized")).count(), 0);
	await page.hover(inFrame("a", `.supermax-divider.is-vertical.is-sized[data-divides="${coast.row("thumbnails")}"] .supermax-divider-handle`));
	await page.click(inFrame("a", `.supermax-divider.is-vertical.is-sized[data-divides="${coast.row("thumbnails")}"] .supermax-divider-reset`));
	assert.equal(await page.locator(inFrame("a", `.supermax-row[data-row="${coast.row("thumbnails")}"] .supermax-divider.is-sized`)).count(), 0, "a width reset returns every cell its drag moved to the app preference");
	const frameHandle = await page.locator(frame("a")).evaluate((element) => getComputedStyle(element).resize);
	assert.equal(frameHandle, "both", "the frame handle is the browser's own resize control, not a divider");
	while ((await groups("a")).length > 0) { await closeNewest("a"); await settle(); }
	await page.click(inFrame("a", '.album-item[data-destination="album:coast"]'));
	await settle();
	assert.ok((await page.locator(inFrame("a", ".supermax-divider.is-horizontal")).count()) >= 2, "reopening the same split brings its row dividers back");
});

test("a remote destination opens once its layout arrives, with its whole chain in one render, and its content loads in a cell that already has its final shape", async (test) => {
	await useDemoPage(test);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await openDemo([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	await page.selectOption("[data-delay]", "400");
	const thumb = inFrame("a", `[data-occurrence="${coast.row("people")}"] [data-destination="coast:photo:c"]`);
	const metadataCell = inFrame("a", `[data-occurrence="${coast.metadata("people", "c")}"]`);
	const atClick = await page.evaluate(({ thumb, metadataCell, photo, history }) => {
		const workspace = window.supermaxDemo.frames.find((candidate) => candidate.key === "a").workspace;
		workspace.addEventListener("render", () => { window.__renders += 1; });
		window.__loading = null;
		const observer = new MutationObserver(() => {
			const cell = document.querySelector(`${metadataCell}.is-loading`);
			if (!cell) return;
			window.__loading = { width: cell.offsetWidth, historyOpen: workspace.navigator.state().occurrences.includes(history) };
			observer.disconnect();
		});
		observer.observe(document.querySelector('.frame[data-frame="a"]'), { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
		const button = document.querySelector(thumb);
		button.click();
		window.__renders = 0;
		return { busy: button.getAttribute("aria-busy"), photoOpen: workspace.navigator.state().occurrences.includes(photo) };
	}, { thumb, metadataCell, photo: coast.photo("people", "c"), history: coast.history("people", "c") });
	assert.equal(atClick.busy, "true", "the control shows at once that it is waiting");
	assert.ok(!atClick.photoOpen, "nothing opens before the layout is known");
	const recorded = await (await page.waitForFunction(() => window.__loading)).jsonValue();
	const loading = recorded.width;
	assert.ok(recorded.historyOpen, "the whole default chain opens with the photo");
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

	await page.clock.install();
	await page.selectOption("[data-delay]", "1500");
	await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
	const lateSelector = inFrame("a", `[data-occurrence="${coast.row("map")}"] [data-destination="coast:photo:b"]`);
	const lateLink = page.locator(lateSelector);
	await lateLink.evaluate((element) => element.click());
	assert.equal(await lateLink.getAttribute("aria-busy"), "true", "the layout is still on its way");
	await page.selectOption("[data-delay]", "0");
	await closeNewest("a");
	assert.deepEqual(await groups("a"), ["Coast", "Photo C"], "Back closes the newest group before the layout arrives");
	assert.equal(await page.evaluate(() => window.supermaxDemo.declares("coast:photo:b")), false);
	await page.clock.runFor(1500);
	await page.clock.resume();
	await page.waitForFunction(() => window.supermaxDemo.declares("coast:photo:b"));
	await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute("aria-busy") === null, lateSelector);
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
	await openDemoWithNothingKept([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	const modal = inFrame("a", ".supermax-modal-layer:not([data-supermax-exiting]) .supermax-modal");
	const photoCell = (row) => inFrame("a", `[data-occurrence="${coast.photo(row, "a")}"]`);
	const urlBefore = page.url();
	await page.selectOption("[data-delay]", "400");
	await page.click(`${photoCell("thumbnails")} .caption-edit`);
	assert.equal(await page.locator(`${modal} .supermax-modal-title`).textContent(), "Caption for Photo A");
	assert.equal(await page.locator(modal).getAttribute("aria-description"), "From Photo A", "the modal names its source to assistive technology");
	assert.equal(await page.locator(`${modal} .supermax-modal-context`).count(), 0, "while the frustum shows it, without a label under the title");
	const loading = page.locator(`${modal} .supermax-loading`);
	assert.equal(await loading.textContent(), "", "the spinner has no visible loading text");
	assert.equal(await loading.getAttribute("aria-label"), "Loading Caption for Photo A", "the loading state still names its task to assistive technology");
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
	assert.equal(await page.locator(inFrame("a", ".supermax-up:not([hidden])")).isHidden(), true, "with nothing hidden above the window the modal leaves no Show control to compete with its own close");
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
	assert.deepEqual(await page.locator(inFrame("a", `.supermax-row[data-row="${coast.row("people")}"]`)).evaluate((element) => {
		const body = element.closest(".supermax-workspace").querySelector(":scope > .supermax-body");
		return { hidden: element.classList.contains("is-hidden"), scrollable: body.scrollHeight > body.clientHeight };
	}), { hidden: false, scrollable: true }, "the source row stays reachable by scrolling behind the modal");
	await page.click(`${modal} .supermax-modal-close`);
	assert.equal(await page.locator(modal).count(), 0, "a modal whose source is out of view closes like any other");
});

test("the demo shows persistent recovery, busy feedback, and host resolution", async () => {
	await page.goto(`${server.url}/?delay=0&presentation=veil`);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	await page.getByRole("button", { name: "Notices: persistent recovery" }).click();
	const notice = page.locator(inFrame("a", '[data-notice="recovery-demo"]'));
	assert.equal(await notice.locator(".supermax-notice-text").textContent(), "Server is asleep");
	assert.deepEqual(await notice.evaluate((element) => {
		const style = getComputedStyle(element);
		return { border: style.borderTopWidth, matchesCanvas: style.borderTopColor === getComputedStyle(document.querySelector('.frame[data-frame="a"] .supermax-canvas')).backgroundColor, radius: style.borderTopLeftRadius };
	}), { border: "1px", matchesCanvas: true, radius: "2px" }, "a default notice uses the canvas hairline and the handle corner radius");
	assert.equal(await page.evaluate(() => window.supermaxDemo.frames[0].workspace.notices.notices.get("recovery-demo").remaining), null);
	await notice.locator(".supermax-notice-action").click();
	assert.equal(await notice.locator(".supermax-notice-text").textContent(), "Starting server…");
	assert.equal(await notice.locator(".supermax-notice-spinner").count(), 1);
	await notice.waitFor({ state: "detached", timeout: 5000 });
	assert.equal(await page.evaluate(() => window.supermaxDemo.frames[0].workspace.notices.notices.has("recovery-demo")), false);
});

test("a notice is a bubble in its source cell, and moves to the top of the viewport naming a source out of view", async (test) => {
	await useDemoClock(test);
	await openDemoWithNothingKept([open("album:coast", "albums")]);
	await resize([[1100, 640], [360, 640]]);
	const photoA = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`);
	const cellNotice = `${photoA} .supermax-cell-notices .supermax-notice`;
	await page.click(`${photoA} .caption-save`);
	await page.waitForSelector(cellNotice);
	assert.equal(await page.locator(`${cellNotice} .supermax-notice-text`).textContent(), "Caption saved", "a success notice appears as a bubble in its source cell, without naming it");
	assert.equal(await page.locator(cellNotice).evaluate((element) => element.classList.contains("is-success")), true);
	const narrowNotice = inFrame("b", ".supermax-notices .supermax-notice");
	assert.equal(await page.locator(`${narrowNotice} .supermax-notice-text`).textContent(), "Photo A (not open): Caption saved", "where the source is not open the workspace notice names it");
	assert.equal(await page.locator(`${narrowNotice} .supermax-notice-go:not([hidden])`).count(), 0, "and offers no way to reopen a closed source");
	await page.clock.fastForward(TIMING.noticeLife);
	await page.waitForSelector(cellNotice, { state: "detached", timeout: 2000 });
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
	const errorId = await page.locator(`${cellNotice}.is-error`).getAttribute("data-notice");
	await page.clock.fastForward(TIMING.noticeLife + 1);
	assert.ok(await page.evaluate((id) => window.supermaxDemo.frames[0].workspace.notices.notices.has(id), errorId), "the error remains after a success notice would expire");
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
	await page.click(`${moved} .supermax-notice-go:not([hidden])`);
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
	await page.clock.fastForward(TIMING.noticeLife);
	await page.waitForSelector(late, { state: "detached", timeout: 2000 });
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
	assert.equal(await page.locator(`${exportNotice} .supermax-notice-go:not([hidden])`).count(), 0, "a source that is in view needs no Show control");
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
	assert.ok(await page.locator(inFrame("a", ".supermax-divider.is-sized")).count() >= 1, "a drag during the animation still stored its size");
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

test("veil replaces a cell without turning it, keeps its surface and lifts the new content after the old has fallen", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.selectOption("[data-presentation]", "veil");
	await settle();
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:b"));
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:b"]`));
	const replacing = await folds("a");
	const surfaces = await page.locator(inFrame("a", ".supermax-cell")).first().evaluate((cell) => [getComputedStyle(cell.querySelector(":scope > .supermax-material")).opacity, getComputedStyle(cell.querySelector(":scope > .supermax-material")).backgroundColor]);
	await settle();
	assert.equal(surfaces[0], "1", "the default material remains opaque while foreground is concealed");
	assert.equal(surfaces[1], "rgb(255, 255, 255)", "the cell retains its surface colour during the replacement");
	assert.ok(replacing.length > 0 && replacing.every((fold) => fold.first === "none"), `no cell turns or travels: ${JSON.stringify(replacing)}`);
	const leaving = replacing.filter((fold) => fold.leaving);
	const arriving = replacing.filter((fold) => !fold.leaving).sort((first, second) => first.delay - second.delay);
	assert.ok(leaving.length > 0 && leaving.every((fold) => fold.duration === TIMING.veilFall), "the old content completes its fall");
	assert.ok(arriving.every((fold) => fold.duration > TIMING.veilFall), "the new content lifts slower than the old fell");
	assert.equal(arriving[0].delay, TIMING.veilFall, "the new content lifts as soon as the old has fallen, so the two never show at once");
	assert.deepEqual(arriving.map((fold) => fold.cell), ["coast:photo:b", "coast:metadata:b"], "and lifts in reading order");
	assert.equal(arriving[1].delay - arriving[0].delay, TIMING.stagger, "one stagger apart");
	await page.selectOption("[data-presentation]", PRESENTATION);
});

test("a narrow Back gives its departing child's room directly to the returning parent", async () => {
	await page.goto(`${server.url}/?delay=0&presentation=veil&speed=10`);
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	await page.getByRole("button", { name: "Twenty cells deep", exact: true }).click();
	await page.evaluate(() => { for (const { workspace } of window.supermaxDemo.frames) { delete workspace.navigator.destinations.albums.overflow; workspace.render({ animate: false }); } });
	await settle();
	await page.evaluate(() => window.supermaxDemo.resize([[960, 640], [277, 633]]));
	await settle();
	const outgoing = inFrame("b", '[data-occurrence$="/depth:20"]');
	await page.click(inFrame("b", ".supermax-up:not([hidden])"));
	const trade = await page.evaluate(() => {
		const strip = window.supermaxDemo.frames[1].workspace.chains.get("albums").strip;
		const parent = strip.entries.find((entry) => entry.id.endsWith("/depth:19"));
		const child = strip.entries.find((entry) => entry.id.endsWith("/depth:20"));
		return { parentWidth: strip.boxOf(parent).getBoundingClientRect().width, childOverlay: child.overlay };
	});
	assert.ok(trade.parentWidth >= 179 && trade.childOverlay, `the old cell veils a full-size returning parent instead of leaving a canvas-sized hole: ${JSON.stringify(trade)}`);
	await page.waitForSelector(outgoing, { state: "detached", timeout: 4000 });
	assert.equal(await page.locator(inFrame("b", '[data-occurrence$="/depth:19"] .depth-number')).textContent(), "19");
	await settle();
	assert.equal(await page.locator(inFrame("b", '[data-occurrence$="/depth:19"]')).evaluate((cell) => getComputedStyle(cell).visibility), "visible");
});

test("a split that another split replaces leaves with the presentation's exit instead of vanishing in a frame", async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails"))]);
	await page.selectOption("[data-speed]", "10");
	await page.click(inFrame("a", '.album-item[data-destination="album:lab-fit"]'));
	const leaving = await page.locator(inFrame("a", '[data-occurrence="albums/album:coast"]')).evaluate((cell) => ({
		exiting: cell.hasAttribute("data-supermax-exiting"),
		split: cell.classList.contains("is-split"),
		exit: cell.getAnimations({ subtree: true }).some((animation) => animation.effect.target === cell && (animation.playState === "running" || animation.pending)),
	}));
	assert.deepEqual(leaving, { exiting: true, split: true, exit: true }, "the replaced split stays mounted, marked as exiting, with its own exit running on it");
	await settle();
	assert.equal(await page.locator(inFrame("a", '[data-occurrence="albums/album:coast"]')).count(), 0, "and is gone once the exit has finished");
	assert.equal(await page.locator(inFrame("a", '[data-occurrence="albums/album:lab-fit"]')).count(), 1);
	await page.selectOption("[data-speed]", "1");
});

test("a split draws its own title above its rows, which stays while the rows change, and its rows share the height below it", async () => {
	await openDemo(THREE_ROWS);
	const album = inFrame("a", '[data-occurrence="albums/album:coast"]');
	const measured = await page.locator(album).evaluate((cell) => {
		const bar = cell.querySelector(":scope > .supermax-cell-title");
		const rows = [...cell.querySelectorAll(".supermax-row:not(.is-hidden)")];
		const top = cell.getBoundingClientRect().top;
		return {
			title: bar?.querySelector(".supermax-cell-title-text")?.textContent,
			barHeight: Math.round(bar.getBoundingClientRect().height),
			barGap: parseFloat(getComputedStyle(bar).marginBottom),
			barWidth: bar.clientWidth,
			cellWidth: Math.round(cell.getBoundingClientRect().width),
			firstRowTop: Math.round(rows[0].getBoundingClientRect().top - top),
			rowsHeight: Math.round(rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0)),
			cellHeight: Math.round(cell.getBoundingClientRect().height),
			rowBars: rows.map((row) => [...row.querySelectorAll(".supermax-cell > .supermax-cell-title-text, .supermax-cell > .supermax-cell-title .supermax-cell-title-text")].map((text) => text.textContent)),
		};
	});
	assert.equal(measured.title, "Coast", "the split's bar carries the split's title");
	const seam = await page.locator(inFrame("a", ".supermax-workspace")).evaluate((workspace) => {
		workspace.style.setProperty("--supermax-default-canvas", "rgb(10, 20, 30)");
		const cell = workspace.querySelector('[data-occurrence="albums/album:coast"]');
		const bar = cell.querySelector(':scope > .supermax-cell-title');
		const colour = getComputedStyle(workspace.querySelector(".supermax-canvas")).backgroundColor;
		const gap = { width: getComputedStyle(bar).borderBottomWidth, border: getComputedStyle(bar).borderBottomColor, cell: getComputedStyle(cell).backgroundColor };
		workspace.style.removeProperty("--supermax-default-canvas");
		return { colour, ...gap };
	});
	assert.deepEqual(seam, { colour: "rgb(10, 20, 30)", width: "1px", border: "rgba(0, 0, 0, 0)", cell: "rgba(0, 0, 0, 0)" }, "the gap under the bar exposes the host's canvas without painting a line");
	assert.equal(measured.barHeight + measured.barGap, 28, "the bar and its canvas gap occupy the chrome height counted by the model");
	assert.equal(measured.barWidth, measured.cellWidth - 1, "across the whole split, leaving the gutter beside it free as its rows do");
	assert.equal(measured.firstRowTop, 28, "the rows start below it");
	assert.equal(measured.rowsHeight, measured.cellHeight - 28, "and share the height that is left");
	assert.deepEqual(measured.rowBars, [[], [], []], "the split's bar stands above all its rows, and inside them no cell draws one, since only the history cells declare a bar and they wait for a wider frame");
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${coast.row("people")}"] .selector-label`)).textContent(), "People", "the lettered avatars are named in their content");
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:d"]`));
	await settle();
	assert.equal(await page.locator(album + " > .supermax-cell-title .supermax-cell-title-text").textContent(), "Coast", "the bar stays while a row opens another cell");
	assert.equal(await page.evaluate(() => window.supermaxDemo.frames[0].workspace.setTitle("albums/album:coast", "Coast, 4 photos")), true);
	assert.equal(await page.locator(album + " > .supermax-cell-title .supermax-cell-title-text").textContent(), "Coast, 4 photos", "and setTitle renames it");
});

for (const splitHeader of [true, false]) test(`a cell inside a row that declares a title header draws its own bar inside the row, ${splitHeader ? "below the split's" : "in a split without one"}`, async () => {
	await page.goto(`${server.url}/blank`);
	await page.addStyleTag({ url: "/src/workspace.css" });
	const measured = await page.evaluate(async (splitHeader) => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = Object.assign(document.body.appendChild(document.createElement("div")), { style: "position:relative;width:800px;height:500px" });
		const navigator = new Navigator({ root: "albums", minViewportHeight: 500, destinations: {
			albums: { title: "Albums", min: 200, max: 200 },
			album: { title: "Coast", ...(splitHeader ? { header: "title" } : {}), rows: [
				{ destination: "details", minHeight: 120, maxHeight: 120 },
				{ destination: "photos", minHeight: 160, maxHeight: "*", preferredHeight: 300 },
			] },
			details: { title: "Details", min: 300, max: "*", preferred: 500 },
			photos: { title: "Photos", header: "title", min: 300, max: "*", preferred: 500 },
		} });
		navigator.open("album", { from: "albums" });
		const workspace = new Workspace(host, { navigator, content: (occurrence) => ({ element: Object.assign(document.createElement("div"), { textContent: occurrence.title }), header: occurrence.destination === "photos" ? Object.assign(document.createElement("button"), { textContent: "Import" }) : undefined }) });
		const cell = (id) => host.querySelector(`[data-occurrence="albums/album/${id}"]`);
		const photos = cell("photos");
		const bar = photos.querySelector(":scope > .supermax-cell-title");
		const row = photos.closest(".supermax-row").getBoundingClientRect();
		const result = {
			splitBar: host.querySelector('[data-occurrence="albums/album"] > .supermax-cell-title .supermax-cell-title-text')?.textContent,
			title: bar?.querySelector(".supermax-cell-title-text")?.textContent,
			controls: bar?.querySelector(".supermax-cell-title-trailing")?.textContent,
			barHeight: Math.round(bar.getBoundingClientRect().height - parseFloat(getComputedStyle(bar).borderTopWidth)),
			barTop: Math.round(bar.getBoundingClientRect().top + parseFloat(getComputedStyle(bar).borderTopWidth) - photos.getBoundingClientRect().top),
			bodyTop: Math.round(photos.querySelector(".supermax-cell-body").getBoundingClientRect().top - photos.getBoundingClientRect().top),
			bottom: Math.round(photos.getBoundingClientRect().bottom - row.bottom),
			detailBars: cell("details").querySelectorAll(":scope > .supermax-cell-title").length,
		};
		workspace.destroy();
		host.remove();
		return result;
	}, splitHeader);
	assert.deepEqual(measured, { splitBar: splitHeader ? "Coast" : undefined, title: "Photos", controls: "Import", barHeight: 28, barTop: 0, bodyTop: 28, bottom: 0, detailBars: 0 }, "the row cell carries its title and its content's controls in its own bar, its body below it within the row, and a row cell without the declaration stays headless");
});

test("the workspace announces each change of focus once, after the render that made it, for a menu to follow", async () => {
	await page.goto(`${server.url}/blank`);
	await page.addStyleTag({ url: "/src/workspace.css" });
	const seen = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = Object.assign(document.body.appendChild(document.createElement("div")), { style: "position:relative;width:1200px;height:400px" });
		const navigator = new Navigator({ root: "albums", minViewportHeight: 300, destinations: {
			albums: { title: "Albums", min: 200, max: 200 },
			"album:coast": { title: "Coast", min: 200, max: 300, defaultChild: "photo:a", menu: true },
			"photo:a": { title: "Photo A", min: 200, max: "*", preferred: 300 },
		} });
		const events = [];
		const workspace = new Workspace(host, { navigator, content: (occurrence) => ({ element: Object.assign(document.createElement("div"), { textContent: occurrence.title }) }) });
		workspace.addEventListener("focus", (event) => events.push({ ...event.detail, rendered: !!workspace.findCell(event.detail.occurrence) }));
		workspace.navigate("album:coast", { from: "albums", origin: null });
		workspace.sync(["albums", "album:coast"]);
		workspace.apply({ type: "close" });
		workspace.destroy();
		host.remove();
		return events;
	});
	assert.deepEqual(seen, [
		{ occurrence: "albums/album:coast", destinations: ["albums", "album:coast"], title: "Coast", menu: "album:coast", rendered: true },
		{ occurrence: "albums", destinations: ["albums"], title: "Albums", menu: null, rendered: true },
	], "the navigation and closing it each move the focus once, and a sync that changes nothing announces nothing; the event names the menu item to mark; the constructor's first render announces before a listener exists, so a host reads the start with navigator.focus()");
});

test("a sync that only moves the focus between open rows still announces it", async () => {
	await page.goto(`${server.url}/blank`);
	await page.addStyleTag({ url: "/src/workspace.css" });
	const seen = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = Object.assign(document.body.appendChild(document.createElement("div")), { style: "position:relative;width:1200px;height:400px" });
		const navigator = new Navigator({ root: "albums", minViewportHeight: 400, destinations: {
			albums: { title: "Albums", min: 200, max: 200 },
			split: { title: "Split", rows: [
				{ destination: "left", minHeight: 150, maxHeight: "*", preferredHeight: 200 },
				{ destination: "right", minHeight: 150, maxHeight: 200 },
			] },
			left: { title: "Left", min: 200, max: 300 },
			right: { title: "Right", min: 200, max: 300 },
			detail: { title: "Detail", min: 200, max: "*", preferred: 300 },
		} });
		const events = [];
		const workspace = new Workspace(host, { navigator, content: (occurrence) => ({ element: Object.assign(document.createElement("div"), { textContent: occurrence.title }) }) });
		workspace.sync(["albums", "split", "left", "detail"]);
		workspace.sync(["albums", "split", "right", "detail"]);
		workspace.addEventListener("focus", (event) => events.push(event.detail.occurrence));
		const result = workspace.sync(["albums", "split", "left", "detail"]);
		workspace.destroy();
		host.remove();
		return { noop: !!result.noop, events };
	});
	assert.deepEqual(seen, { noop: true, events: ["albums/split/left/detail"] }, "the sync changes nothing that is open, yet the menu hears that the focus moved to the left row");
});

test("a full-height cell opened from a row breaks out beside its split, and Back closes it alone", async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:b", coast.row("thumbnails"))]);
	const photoB = coast.photo("thumbnails", "b");
	const fullB = coast.full("thumbnails", "b");
	await page.click(inFrame("a", `[data-occurrence="${photoB}"] .full-link`));
	await settle();
	const placed = await page.locator(inFrame("a", `[data-occurrence="${fullB}"]`)).evaluate((cell) => {
		const workspace = cell.closest(".supermax-workspace");
		const body = workspace.querySelector(":scope > .supermax-body, :scope > .supermax-chain")?.getBoundingClientRect() ?? workspace.getBoundingClientRect();
		const split = workspace.querySelector('[data-occurrence="albums/album:coast"]').getBoundingClientRect();
		const rect = cell.getBoundingClientRect();
		return { inRow: !!cell.closest(".supermax-row"), rightOfSplit: Math.round(rect.left) >= Math.round(split.right) - 1, height: Math.round(rect.height), splitHeight: Math.round(split.height), bodyHeight: Math.round(body.height) };
	});
	assert.equal(placed.inRow, false, "the full-height cell stands in the root chain, not inside the thumbnails row");
	assert.equal(placed.rightOfSplit, true, "to the right of the album's split");
	assert.equal(placed.height, placed.splitHeight, "as tall as the split beside it");
	const headless = await page.locator(inFrame("a", `[data-occurrence="${fullB}"]`)).evaluate((cell) => ({ bars: cell.querySelectorAll(":scope > .supermax-cell-title").length, label: cell.getAttribute("aria-label"), headless: cell.classList.contains("is-headless"), bodyTop: Math.round(cell.querySelector(".supermax-cell-body").getBoundingClientRect().top - cell.getBoundingClientRect().top) }));
	assert.deepEqual(headless, { bars: 0, label: "Photo B at full height", headless: true, bodyTop: 0 }, "a cell without header: \"title\" draws no title bar, its body starts at the top, and it keeps its title as its accessible name");
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${photoB}"] .full-link`)).getAttribute("aria-current"), null);
	assert.equal(await page.locator(inFrame("a", `[data-row="${coast.row("thumbnails")}"] [data-occurrence="${fullB}"]`)).count(), 0, "the row's own chain does not hold it");
	await closeNewest("a");
	await settle();
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${fullB}"]`)).count(), 0, "Back closes the breakout");
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${photoB}"]`)).count(), 1, "and leaves the photo that opened it");
	const replayed = await page.evaluate(([row, photo, full]) => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const results = workspace.replay([{ type: "sync", destinations: ["albums", "album:coast"] }, { type: "open", destination: "coast:photo:b", from: row }, { type: "open", destination: "coast:full:b", from: photo }]);
		return { ok: results.map((result) => result.ok), beside: workspace.navigator.next(workspace.navigator.get("albums/album:coast"))?.id, renders: document.querySelector(`.frame[data-frame="a"] [data-occurrence="${full}"]`)?.closest(".supermax-row") === null };
	}, [coast.row("thumbnails"), photoB, fullB]);
	assert.deepEqual(replayed, { ok: [true, true, true], beside: fullB, renders: true }, "a replay with a sync action and the opening from the row rebuilds the breakout in one render, and next() names it beside the split");
	await settle();
});

test("a twenty-cell chain stays navigable in both presentations", async () => {
	await openDemoWithNothingKept(TWENTY_DEEP);
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
	assert.equal((await backButton("a")).label, "Show Depth 17", "Back names the nearest hidden cell");
	await page.waitForFunction(() => document.querySelector('.frame[data-frame="a"] [data-spec-for$="/depth:20"] .cell-spec-state')?.textContent === "allocated");
	const spec = await page.locator(inFrame("a", '[data-spec-for$="/depth:20"]')).evaluate((element) => ({ hidden: element.hidden, text: [...element.querySelectorAll("dt")].map((term) => `${term.textContent} ${term.nextElementSibling.textContent}`) }));
	assert.equal(spec.hidden, false, "a cell with room shows its definition");
	assert.deepEqual(spec.text.slice(0, 4), ["id depth:20", "min 128", "max 512", "preferred 256"]);
	assert.ok(spec.text.includes("overflow none"));
	assert.match(spec.text.find((line) => line.startsWith("width ")), /^width \d+ px$/);
	await page.selectOption("[data-presentation]", "fold");
	await settle();
	await page.click(inFrame("a", ".supermax-up:not([hidden])"));
	await settle();
	assert.equal((await groups("a")).length, 19, "Show closes Depth 20 to show Depth 17");
	assert.equal(await page.locator(inFrame("a", `[data-occurrence="${TWENTY_DEEP[19].from}/depth:20"]`)).count(), 0);
	await page.evaluate((source) => window.supermaxDemo.frames[0].workspace.notify({ id: "deep-three", scope: "cell", source, kind: "action", message: "Look here", action: { label: "Ok", run() {} } }), "albums/depth:1/depth:2/depth:3");
	await page.click(inFrame("a", '.supermax-notices [data-notice="deep-three"] .supermax-notice-go:not([hidden])'));
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
});

test("the demo's Speed control slows every time Supermax and the demo keep, and keeps that in the URL", async (test) => {
	await useDemoClock(test);
	const SLOW = 10;
	await openDemo(LONG_CHAIN);
	await resize([[960, 640], [380, 640]]);
	await page.selectOption("[data-speed]", String(SLOW));
	assert.match(page.url(), /[?&]speed=10/, "the choice is in the URL");
	await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
	await page.evaluate(() => { window.slowNotice = window.supermaxDemo.frames[0].workspace.notify({ scope: "workspace", kind: "success", message: "Saved", duration: 100 }); });
	const noticeIsOpen = () => page.evaluate(() => window.supermaxDemo.frames[0].workspace.notices.notices.has(window.slowNotice));
	await page.clock.runFor(100 * SLOW - 1);
	assert.equal(await noticeIsOpen(), true, "the notice remains until the scaled deadline");
	await page.clock.runFor(1);
	assert.equal(await noticeIsOpen(), false, "the notice expires at its scaled deadline");
	await page.clock.resume();

	await openDemo([open("album:coast", "albums")]);
	await page.selectOption("[data-speed]", String(SLOW));
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:b"));
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:b"]`));
	const replacing = await folds("a");
	const [falls, lifts] = PRESENTATION === "veil" ? [[TIMING.veilFall], [TIMING.veilLift, TIMING.veilLiftLarge]] : [[STRIP_TIMING.duration], [STRIP_TIMING.duration, STRIP_TIMING.duration]];
	const within = (value, [low, high = low]) => value >= low * SLOW && value <= high * SLOW;
	assert.ok(replacing.length > 0 && replacing.every((fold) => within(fold.duration, fold.leaving ? falls : lifts)), `every fold lasts ${SLOW} times longer: ${JSON.stringify(replacing)}`);
	assert.ok(replacing.filter((fold) => !fold.leaving).every((fold) => within(fold.delay, [falls[0], falls[0] + TIMING.staggerLimit])), "and a replacement waits that much longer for the old cells");
	await settle();
	await page.evaluate(() => window.supermaxDemo.setNetwork({ delay: "400" }));
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:c"]`));
	assert.equal((await departureOf(inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "b")}"]`)))?.delay, TIMING.depart * SLOW, "the wait before a departure grows with it");
	await page.clock.fastForward(400 * 3);
	assert.equal((await state("a")).occurrences.includes(coast.photo("thumbnails", "c")), false, "the demo's network delay is slowed too");
	await page.selectOption("[data-delay]", "0");
	await page.clock.fastForward(400 * SLOW);
	await page.waitForFunction((id) => window.supermaxDemo.frames[0].workspace.navigator.get(id), coast.photo("thumbnails", "c"), { timeout: 2000 });
	await settle();
	await closeNewest("a");
	const closingFolds = (await folds("a")).filter((fold) => fold.leaving);
	assert.ok(closingFolds.length > 0 && closingFolds.every((fold) => fold.delay === STRIP_TIMING.settle * SLOW), `and so does the settle window: ${JSON.stringify(closingFolds)}`);
	await settle();
	const requests = await page.evaluate(() => window.supermaxDemo.requests.length);
	await page.hover(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:d"]`));
	await page.clock.fastForward(100 * 4);
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
	assert.equal(await page.evaluate(() => window.supermaxDemo.frames[1].workspace.navigator.locationInfo().title), "Coast", "the location names where the application now is, the album");
});

test("cells inside a hidden row are not painted and Back brings the row back", async () => {
	await openDemoWithNothingKept(THREE_ROWS);
	await resize([[960, 640], [420, 300]]);
	assert.deepEqual(await hiddenRows("b"), [true, true, false]);
	const visibility = await page.locator(inFrame("b", `.supermax-row[data-row="${coast.row("map")}"] .supermax-cell`)).evaluateAll((elements) => [...new Set(elements.map((element) => getComputedStyle(element).visibility))]);
	assert.deepEqual(visibility, ["hidden"], "every cell inside the hidden row computes hidden");
	for (let step = 0; step < 5 && (await hiddenRows("b"))[1]; step += 1) {
		await page.click(inFrame("b", ".supermax-up:not([hidden])"));
		await settle();
	}
	assert.deepEqual(await hiddenRows("b"), [true, false, false], "Back reaches the earlier row while the later nonfoldable row stays reachable");
	assert.equal(await page.evaluate(() => window.supermaxDemo.frames[1].workspace.navigator.locationInfo().title), "Photo B", "Photo C closed to show People, so the location names the newest navigation still in view");
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
		const split = document.querySelector('.frame[data-frame="a"] .supermax-cell.is-split');
		const rotates = (cell) => cell.getAnimations().some((animation) => animation.effect.getKeyframes().some((frame) => String(frame.transform ?? "").includes("rotate")));
		const inner = [...(split?.querySelectorAll(".supermax-cell") ?? [])];
		return {
			exiting: split?.hasAttribute("data-supermax-exiting") ?? false,
			rows: split?.querySelectorAll(".supermax-row").length ?? 0,
			splitFolds: split ? rotates(split) : null,
			inner: inner.length,
			folding: inner.filter(rotates).length,
		};
	});
	assert.deepEqual({ exiting: during.exiting, rows: during.rows }, { exiting: true, rows: 3 }, "the departing album still carries its rows mid-exit");
	if (PRESENTATION === "origami") {
		assert.equal(during.splitFolds, false, "the split does not fold itself");
		assert.ok(during.inner > 0 && during.folding === during.inner, `every cell in its rows folds away: ${during.folding} of ${during.inner}`);
	}
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
	await settle();
	assert.equal(await page.locator(inFrame("a", ".supermax-row")).count(), 0, "rows are gone after the exit");
	assert.equal(await page.locator(inFrame("a", ".supermax-cell.is-split")).count(), 0, "the split is gone once its rows have folded away");
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
		return { children: element.childElementCount, classes: element.className, cells: workspace.cells.size };
	});
	assert.deepEqual(result, { children: 0, classes: "frame-workspace", cells: 0 });
});
