import assert from "node:assert/strict";
import { test } from "node:test";
import { albums, depthId } from "../docs/assets/album.js";
import { appendAction, decodeLog, encodeLog } from "../docs/assets/deeplink.js";
import { STRIP_TIMING } from "../src/cell-strip.js";
import { TIMING } from "../src/motion.js";
import { coast, TWENTY_DEEP, useDemoPage, SETTLE, open, THREE_ROWS, server, page, PRESENTATION, openDemo, openDemoWithNothingKept, frame, inFrame, readout, settle, opened, state, groups, backButton, closeNewest, resize, boxes, painted, folds, departureOf, installWorkspaceHooks, waitForContent } from "./workspace-fixture.js";

installWorkspaceHooks();

test("ordinary demo albums retain fold access at narrow widths and heights", async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:a", coast.row("people"))]);
	await page.evaluate(() => window.supermaxDemo.resize([[960, 640], [420, 360]]));
	await settle();
	await page.waitForFunction((id) => [...document.querySelectorAll('.frame[data-frame="b"] .supermax-fold-cue')].some((cue) => cue.dataset.foldOccurrence === id && cue.getClientRects().length), coast.row("map"));
	const cues = await page.locator(inFrame("b", ".supermax-fold-cue:visible")).evaluateAll((elements) => elements.map((element) => ({ axis: element.classList.contains("is-vertical") ? "vertical" : "horizontal", id: element.dataset.foldOccurrence })));
	assert.ok(cues.some((cue) => cue.axis === "vertical" && cue.id === coast.row("map")), "the nearest earlier row presents the fold handle");
	assert.equal(await page.evaluate((id) => window.supermaxDemo.frames[1].workspace.layout.rows.get(id).folded, coast.row("thumbnails")), true, "the row behind it stays folded for the following page turn");
	assert.ok(cues.some((cue) => cue.axis === "horizontal" && cue.id === coast.row("people")), "the active row's selector stays reachable by a fold cue");
	await page.evaluate(() => window.supermaxDemo.resize([[960, 640], [415, 332]]));
	await page.waitForFunction(() => window.supermaxDemo.frames[1].workspace.layout.height === 332);
	assert.equal(await page.locator(readout("b", "limit")).count(), 0, "folding does not create a developer warning");
	const topGutter = await page.evaluate((row) => {
		const frame = document.querySelector('.frame[data-frame="b"]');
		const title = frame.querySelector('.supermax-cell.is-split > .supermax-cell-title');
		const active = frame.querySelector(`.supermax-row[data-row="${row}"]`);
		return { gap: parseFloat(getComputedStyle(title).borderBottomWidth) + parseFloat(getComputedStyle(active).borderTopWidth), painted: getComputedStyle(title).borderBottomColor === "rgba(0, 0, 0, 0)" ? 0 : 1 };
	}, coast.row("people"));
	assert.deepEqual(topGutter, { gap: 1, painted: 0 }, "consecutive zero-height folds share one transparent gutter below the title");
	await page.evaluate(() => window.supermaxDemo.resize([[960, 640], [415, 200]]));
	await page.waitForFunction(() => window.supermaxDemo.frames[1].workspace.layout.height === 200);
	assert.equal(await page.evaluate(() => {
		const workspace = window.supermaxDemo.frames[1].workspace;
		return workspace.layout.overflow && workspace.body.scrollHeight > workspace.body.clientHeight;
	}), true, "below the active row's minimum, the workspace remains scrollable without a warning");
});

test("Show never strands later rows without a fold handle", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.evaluate(() => window.supermaxDemo.resize([[960, 640], [401, 292]]));
	await page.waitForFunction(() => window.supermaxDemo.frames[1].workspace.layout.height === 292);
	for (const expected of [coast.row("map"), coast.row("thumbnails")]) {
		await page.click(inFrame("b", ".supermax-up:not([hidden])"));
		await settle();
		const row = await page.evaluate((id) => window.supermaxDemo.frames[1].workspace.layout.rows.get(id), expected);
		assert.equal(row.visible && !row.folded, true, `Show reaches ${expected}`);
		const later = await page.evaluate(() => window.supermaxDemo.frames[1].workspace.layout.chain.cells[1].rows.rows.filter((candidate) => candidate.visible && candidate.folded).map((candidate) => candidate.occurrence));
		for (const id of [coast.row("map"), coast.row("people")].filter((id) => id !== expected)) {
			assert.ok(later.includes(id), `${id} remains folded instead of disappearing after Show`);
			const route = await page.evaluate((id) => window.supermaxDemo.frames[1].workspace.layout.access.get(id), id);
			assert.equal(route.kind, "fold", "a later page has a forward fold route");
			assert.equal(await page.locator(inFrame("b", `.supermax-fold-cue.is-vertical[data-fold-occurrence="${route.occurrence}"]`)).isVisible(), true, "the nearest page handle provides the route");
		}
	}
});

test("folded rows after the open one share a handle and open one at a time by dragging", async () => {
	await openDemo([open("album:coast", "albums")]);
	await page.evaluate(() => window.supermaxDemo.resize([[960, 640], [401, 292]]));
	await page.waitForFunction(() => window.supermaxDemo.frames[1].workspace.layout.height === 292);
	for (let step = 0; step < 2; step += 1) {
		await page.click(inFrame("b", ".supermax-up:not([hidden])"));
		await settle();
	}
	await page.waitForTimeout(100);
	const folded = inFrame("b", ".supermax-fold-cue.is-vertical:visible");
	const initialCues = await page.locator(folded).evaluateAll((cues) => cues.map((cue) => ({ id: cue.dataset.foldOccurrence, direction: cue.dataset.direction, y: cue.getBoundingClientRect().y, left: cue.getBoundingClientRect().left, right: cue.getBoundingClientRect().right, parent: cue.parentElement.className })));
	assert.deepEqual(initialCues.map((cue) => cue.id), [coast.row("map")], `the run of folded rows presents one handle, for the row nearest the open one: ${JSON.stringify(initialCues)}`);
	const dragOpen = async (id) => {
		const cue = page.locator(inFrame("b", `.supermax-fold-cue.is-vertical[data-fold-occurrence="${id}"]`));
		const box = await cue.boundingBox();
		const direction = await cue.getAttribute("data-direction");
		const sign = direction === "up" ? -1 : 1;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + sign * 200, { steps: 8 });
		await page.mouse.up();
		await page.waitForFunction(() => !window.supermaxDemo.frames[1].workspace.folds.drag);
		await settle();
	};
	await dragOpen(coast.row("map"));
	await settle();
	assert.equal(await page.locator(inFrame("b", `.supermax-row[data-row="${coast.row("map")}"]`)).evaluate((row) => row.classList.contains("is-folded")), false);
	assert.ok((await page.locator(folded).evaluateAll((cues) => cues.map((cue) => cue.dataset.foldOccurrence))).includes(coast.row("people")), "the handle names the row after it once the row opens");
	await dragOpen(coast.row("people"));
	assert.equal(await page.locator(inFrame("b", `.supermax-row[data-row="${coast.row("people")}"]`)).evaluate((row) => row.classList.contains("is-folded")), false, "the following row opens through the same drag gesture");
});

test("demo cell borders expose only the canvas gutter in every motion style", async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails"))]);
	for (const presentation of ["origami", "veil", "fold"]) {
		await page.selectOption("[data-presentation]", presentation);
		await settle();
		const edges = await page.evaluate((id) => {
			const frame = document.querySelector('.frame[data-frame="a"]');
			const cell = frame.querySelector(`[data-occurrence="${id}"]`);
			const row = cell.closest(".supermax-row");
			const title = frame.querySelector(".supermax-cell.is-split > .supermax-cell-title");
			return {
				cellBorder: getComputedStyle(cell).borderLeftColor,
				rowBorder: getComputedStyle(row).borderTopColor,
				titleBorder: getComputedStyle(title).borderBottomColor,
				paperInset: getComputedStyle(cell).boxShadow.includes("inset"),
			};
		}, coast.photo("thumbnails", "a"));
		assert.deepEqual(edges, { cellBorder: "rgba(0, 0, 0, 0)", rowBorder: "rgba(0, 0, 0, 0)", titleBorder: "rgba(0, 0, 0, 0)", paperInset: false }, presentation);
	}
});

test("every demo scenario keeps open cells reachable across narrow and short frames", async () => {
	await openDemo();
	const scenarios = await page.locator("[data-scenarios] .scenario").allTextContents();
	for (const [index, name] of scenarios.entries()) {
		await page.locator("[data-scenarios] .scenario").nth(index).click();
		await settle();
		for (const width of [220, 320, 401, 420, 800]) {
			for (const height of [200, 292, 360, 640]) {
				const failures = await page.evaluate(({ width, height }) => {
					window.supermaxDemo.resize([[960, 640], [width, height]]);
					const frame = window.supermaxDemo.frames[1];
					frame.workspace.navigator.resize({ width, height });
					frame.workspace.render({ animate: false });
					const { navigator, layout, body } = frame.workspace;
					const problems = [];
					for (const occurrence of navigator.occurrences.values()) {
						if (navigator.placeOf(occurrence, layout) !== "after") continue;
						let folded = false;
						for (let member = occurrence; member; member = member.parent ? navigator.get(member.parent) : null) {
							folded ||= !!layout.cells.get(member.id)?.folded || !!layout.rows.get(member.id)?.folded;
						}
						if (!folded) problems.push(`${occurrence.id} has no fold, Back, or full placement`);
					}
					for (const cell of layout.cells.values()) {
						if (!cell.folded || !cell.inView) continue;
						const cue = [...frame.box.querySelectorAll(".supermax-fold-cue.is-horizontal")].find((candidate) => candidate.dataset.foldOccurrence === cell.occurrence);
						if (!cue) problems.push(`${cell.occurrence} has no horizontal fold handle`);
						else if (!cue.getClientRects().length) {
							const group = frame.workspace.folds.entries.get(cue).entry.element.closest(".supermax-strip");
							const nextPage = [...frame.workspace.folds.visibleCues.keys()].some((candidate) => candidate !== cue && candidate.classList.contains("is-horizontal") && candidate.dataset.direction === cue.dataset.direction && frame.workspace.folds.entries.get(candidate).entry.element.closest(".supermax-strip") === group);
							if (!nextPage) problems.push(`${cell.occurrence} has no adjacent horizontal page handle`);
						}
					}
					for (const row of layout.rows.values()) {
						if (!row.folded || !row.inView) continue;
						const cue = [...frame.box.querySelectorAll(".supermax-fold-cue.is-vertical")].find((candidate) => candidate.dataset.foldOccurrence === row.occurrence);
						if (!cue) problems.push(`${row.occurrence} has no vertical fold handle`);
						else if (!cue.getClientRects().length) {
							const group = frame.workspace.folds.entries.get(cue).entry.element.parentElement;
							const nextPage = [...frame.workspace.folds.visibleCues.keys()].some((candidate) => candidate !== cue && candidate.classList.contains("is-vertical") && candidate.dataset.direction === cue.dataset.direction && frame.workspace.folds.entries.get(candidate).entry.element.parentElement === group);
							if (!nextPage) problems.push(`${row.occurrence} has no adjacent vertical page handle`);
						}
					}
					for (const cue of frame.box.querySelectorAll(".supermax-fold-cue:not([hidden])")) {
						const rect = cue.getBoundingClientRect();
						const centerX = rect.left + rect.width / 2;
						const centerY = rect.top + rect.height / 2;
						const viewport = body.getBoundingClientRect();
						if (centerX < viewport.left || centerX >= viewport.right || centerY < viewport.top || centerY >= viewport.bottom || centerX < 0 || centerX >= innerWidth || centerY < 0 || centerY >= innerHeight) continue;
						const hit = document.elementFromPoint(centerX, centerY);
						if (!cue.contains(hit) && !hit?.closest(".supermax-notice, .supermax-modal")) problems.push(`${cue.dataset.foldOccurrence} has an occluded tap target (${cue.dataset.direction}, ${Math.round(centerX)},${Math.round(centerY)}; hit ${hit?.className})`);
					}
					if (layout.overflowX && body.scrollWidth <= body.clientWidth) problems.push("horizontal overflow has no scroll range");
					if (layout.overflow && body.scrollHeight <= body.clientHeight) problems.push("vertical overflow has no scroll range");
					return problems;
				}, { width, height });
				assert.deepEqual(failures, [], `${name} at ${width}×${height}`);
			}
		}
	}
});

test("two independent splits stand beside a full-height cell", async () => {
	await openDemo();
	const result = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = document.createElement("div");
		host.style.cssText = "position: fixed; inset: 0; width: 1440px; height: 900px; z-index: 100;";
		document.body.append(host);
		const navigator = new Navigator({
			root: "app",
			minViewportHeight: 320,
			destinations: {
				app: { title: "App", min: 1, max: 1 },
				vaultSplit: { title: "Vault", rows: [
					{ destination: "vault", minHeight: 170, maxHeight: "*", preferredHeight: 700 },
					{ destination: "agents", minHeight: 120, maxHeight: 220 },
				] },
				vault: { title: "Vault", min: 192, max: 256 },
				agents: { title: "Agents", min: 192, max: 256 },
				epics: { title: "Epics", min: 256, max: 384, placement: "beside-split" },
				boardSplit: { title: "Board", rows: [
					{ destination: "board", minHeight: 170, maxHeight: "*", preferredHeight: 700 },
					{ destination: "workflow", minHeight: 120, maxHeight: 220 },
				] },
				board: { title: "Board", min: 320, max: "*", preferred: 1024 },
				workflow: { title: "Workflow", min: 320, max: "*", preferred: 1024 },
				idea: { title: "Idea", min: 320, max: 1024, placement: "beside-split" },
			},
		});
		const workspace = new Workspace(host, { navigator, content: (occurrence, definition) => {
			if (definition.rows) return {};
			const element = document.createElement("section");
			element.textContent = occurrence.title;
			return { element };
		} });
		window.twoSplits = { workspace, host };
		return workspace.sync(["app", "vaultSplit", "vault", "epics", "boardSplit", "board"], { animate: false });
	});
	assert.equal(result.ok, true);
	const rects = await page.evaluate(() => {
		const rect = (id) => {
			const box = document.querySelector(`[data-occurrence="${id}"]`).getBoundingClientRect();
			return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
		};
		return {
			vaultSplit: rect("app/vaultSplit"), vault: rect("app/vaultSplit/vault"), agents: rect("app/vaultSplit/agents"),
			epics: rect("app/vaultSplit/vault/epics"), boardSplit: rect("app/vaultSplit/vault/epics/boardSplit"),
			board: rect("app/vaultSplit/vault/epics/boardSplit/board"), workflow: rect("app/vaultSplit/vault/epics/boardSplit/workflow"),
		};
	});
	assert.ok(rects.vaultSplit.right <= rects.epics.left + 1 && rects.epics.right <= rects.boardSplit.left + 1, JSON.stringify(rects));
	assert.ok(rects.vault.top < rects.agents.top && rects.board.top < rects.workflow.top);
	assert.equal(rects.epics.bottom, rects.boardSplit.bottom, "Epics spans the complete height beside the Board split");
	const detail = await page.evaluate(() => {
		const result = window.twoSplits.workspace.sync(["app", "vaultSplit", "vault", "epics", "boardSplit", "board", "idea"], { animate: false });
		const split = document.querySelector('[data-occurrence="app/vaultSplit/vault/epics/boardSplit"]').getBoundingClientRect();
		const idea = document.querySelector('[data-occurrence="app/vaultSplit/vault/epics/boardSplit/board/idea"]').getBoundingClientRect();
		return { ok: result.ok, beside: idea.left >= split.right - 1, fullHeight: idea.bottom === split.bottom };
	});
	assert.deepEqual(detail, { ok: true, beside: true, fullHeight: true });
});

test("the start state names the end of history and both frames receive a click", async () => {
	await openDemo();
	assert.deepEqual(await backButton("a"), { hidden: true, label: null, text: "" }, "with nothing out of view there is no Show control");
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
	assert.ok(narrowLive.occurrences.includes(coast.photo("thumbnails", "a")), "the host's smaller menu minimum leaves room for the default photo at 600px");
	await page.reload();
	await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
	assert.deepEqual(await state("a"), narrowLive, "a reload restores the stored snapshot although the frame is wide again");
});

test("a long name in the Show control gives way to the title on a phone", async () => {
	await openDemo(TWENTY_DEEP);
	await resize([[960, 640], [390, 640]]);
	await page.evaluate(() => {
		const { workspace } = window.supermaxDemo.frames[1];
		for (const id of workspace.navigator.state().occurrences) workspace.setTitle(id, `A very long name for ${id.split("/").pop()} that does not fit on a phone at all`);
	});
	const measured = await page.locator(inFrame("b", ".supermax-up:not([hidden])")).evaluate((up) => {
		const cell = up.closest(".supermax-cell");
		return {
			cellWidth: cell.getBoundingClientRect().width,
			up: up.getBoundingClientRect().width,
			nameShown: getComputedStyle(up.querySelector(".supermax-up-target")).display !== "none",
			label: up.getAttribute("aria-label"),
			hidden: up.hidden,
			albums: cell.dataset.occurrence === "albums",
		};
	});
	assert.equal(measured.hidden, false, "the Show control is there");
	assert.equal(measured.albums, true, "in the first cell in view, the kept albums menu");
	assert.ok(measured.cellWidth >= 48 && measured.up <= measured.cellWidth, "the control fits inside the host's narrow menu");
	assert.equal(measured.nameShown, false, "with only its arrow, since the name has no room there");
	assert.match(measured.label, /A very long name for depth:19/, "while its accessible name still names the hidden parent by its new title");
	await openDemo(THREE_ROWS);
	await resize([[960, 370], [420, 640]]);
	const wide = await page.locator(inFrame("a", ".supermax-up:not([hidden])")).evaluate((up) => ({ hidden: up.hidden, inBar: !!up.closest(".supermax-cell-title-leading"), nameShown: getComputedStyle(up.querySelector(".supermax-up-target")).display !== "none" && up.querySelector(".supermax-up-target").getBoundingClientRect().width > 20, first: up.closest(".supermax-cell").dataset.occurrence }));
	assert.deepEqual(wide, { hidden: false, inBar: true, nameShown: false, first: "albums" }, "the host keeps the Show control compact inside its narrow menu");
});

test("the Show control says Back when the name of what it brings back is long or repeats its own bar", async () => {
	await openDemo(TWENTY_DEEP);
	await resize([[960, 640], [420, 640]]);
	const control = () => page.locator(inFrame("a", ".supermax-up:not([hidden])")).evaluate((up) => ({ text: up.textContent, label: up.getAttribute("aria-label") }));
	assert.deepEqual(await control(), { text: "Depth 17", label: "Show Depth 17" }, "a short name that differs from the bar names the cell");
	await page.evaluate(() => window.supermaxDemo.frames[0].workspace.setTitle(window.supermaxDemo.frames[0].workspace.upDestination.id, "Your order at the corner shop has been delivered"));
	assert.deepEqual(await control(), { text: "Back", label: "Show Your order at the corner shop has been delivered" }, "a long name becomes Back, while the accessible name still names the cell");
	await page.evaluate(() => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		workspace.setTitle(workspace.upDestination.id, "Albums");
	});
	assert.deepEqual(await control(), { text: "Back", label: "Show Albums" }, "and so does a name that repeats the title of the bar it stands in");
});

test("the up control names the nearest hidden parent, closes what falls off the end to show it, and browser back undoes that", async () => {
	await openDemo(TWENTY_DEEP);
	await resize([[960, 640], [420, 640]]);
	assert.deepEqual(await backButton("a"), { hidden: false, label: "Show Depth 17", text: "Depth 17" });
	const before = { a: await groups("a"), b: await backButton("b"), bGroups: await groups("b"), url: page.url() };
	await page.click(inFrame("a", ".supermax-up:not([hidden])"));
	await settle();
	assert.deepEqual(await groups("a"), before.a.slice(0, -1), "Depth 20 closes so Depth 17 fits");
	assert.equal(page.url(), before.url, "the shared log does not change");
	assert.deepEqual([await backButton("b"), await groups("b")], [before.b, before.bGroups], "the other frame keeps its window and its cells");
	assert.equal((await backButton("a")).label, "Show Depth 16");
	assert.equal(await page.evaluate(() => window.supermaxDemo.frames[0].workspace.navigator.locationInfo().title), "Depth 19", "the location names the deepest cell still open, for a host that shows it");
	const edges = await page.evaluate((id) => {
		const frame = document.querySelector('.frame[data-frame="a"]');
		return { menu: frame.querySelector('[data-occurrence="albums"]').getBoundingClientRect().right, revealed: frame.querySelector(`[data-occurrence="${id}"]`).getBoundingClientRect().left };
	}, TWENTY_DEEP[16].from + "/depth:17");
	assert.equal(Math.round(edges.revealed), Math.round(edges.menu), "the cells folded between the kept menu and the window take no room");
	assert.equal(await page.locator(inFrame("a", ".supermax-reveal, .supermax-row-tab, .supermax-collapse")).count(), 0, "no chip, tab or collapse control competes with it");
	await page.goBack();
	await page.waitForFunction(() => window.supermaxDemo.frames[0].workspace.navigator.state().groups.length === 20);
	await settle();
	assert.deepEqual(await groups("a"), before.a, "browser back returns to the moment before, with Depth 20 open again");
});

test("Back climbs the newest branch first, then the branch opened before it in another row", async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[800, 640], [420, 640]]);
	await settle();
	assert.equal((await backButton("a")).label, "Show People", "the smallest kept menu leaves the last row's earlier content as a Show target");
	await page.click(inFrame("a", `[data-occurrence="${coast.metadata("map", "a")}"] .metadata-link`));
	await settle();
	assert.equal((await backButton("a")).label, "Show Map", "opening History A in the Map row hides Map");
	await page.click(inFrame("a", `[data-occurrence="${coast.metadata("thumbnails", "a")}"] .metadata-link`));
	await settle();
	assert.equal((await backButton("a")).label, "Show Thumbnails", "the hidden parent of the newest branch comes back first");
	await page.click(inFrame("a", ".supermax-up:not([hidden])"));
	await settle();
	assert.equal((await backButton("a")).label, "Show Map", "with that branch whole, the branch opened before it climbs next");
	await page.click(inFrame("a", ".supermax-up:not([hidden])"));
	await settle();
	assert.equal(await painted(inFrame("a", `[data-occurrence="${coast.row("map")}"]`)), true);
	assert.equal((await backButton("a")).label, "Show People", "the remaining earlier row is next");
	await page.click(inFrame("a", ".supermax-up:not([hidden])"));
	await settle();
	assert.equal((await backButton("a")).hidden, true, "with nothing above any branch out of view Back goes away");
	assert.deepEqual(await groups("a"), ["Coast"], "each step closed only the History A that had pushed its parent out");
});

test("a click in one frame reaches the other as the same new click, even after the up control closed cells there", async () => {
	await openDemo(TWENTY_DEEP);
	await resize([[960, 640], [420, 640]]);
	for (let step = 0; step < 8; step += 1) { await page.click(inFrame("a", ".supermax-up:not([hidden])")); await settle(); }
	for (let step = 0; step < 3; step += 1) { await page.click(inFrame("b", ".supermax-up:not([hidden])")); await settle(); }
	assert.equal((await groups("a")).length, 12);
	assert.equal((await groups("b")).length, 17, "each frame closed what its own size needed");
	await page.click(inFrame("a", `[data-occurrence="${TWENTY_DEEP[12].from}"] .depth-next`));
	await settle();
	assert.deepEqual(await groups("b"), await groups("a"), "the frame that still had Depth 13 to 17 open opens Depth 13 anew, so both end at the clicked cell");
	await page.click(inFrame("b", ".supermax-up:not([hidden])"));
	await settle();
	await page.click(inFrame("b", ".supermax-up:not([hidden])"));
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
	const settled = await page.waitForFunction(() => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		if (!workspace.modal || workspace.modal.entrance || workspace.originFrame) return null;
		const frustum = document.querySelector('.frame[data-frame="a"] .supermax-origin.is-modal .supermax-frustum');
		const polygons = frustum?.querySelectorAll(".supermax-frustum-face");
		if (frustum?.style.opacity !== "1" || polygons.length !== 4) return null;
		const frame = document.querySelector('.frame[data-frame="a"]').getBoundingClientRect();
		const dialog = document.querySelector('.frame[data-frame="a"] .supermax-modal').getBoundingClientRect();
		const faces = [...polygons].filter((polygon) => getComputedStyle(polygon).display !== "none").map((polygon) => polygon.dataset.side);
		return { dx: Math.round((dialog.left + dialog.width / 2) - (frame.left + frame.width / 2)), dy: Math.round((dialog.top + dialog.height / 2) - (frame.top + frame.height / 2)), inside: dialog.left >= frame.left && dialog.right <= frame.right && dialog.top >= frame.top && dialog.bottom <= frame.bottom, faces };
	});
	const { faces, ...geometry } = await settled.jsonValue();
	await settled.dispose();
	assert.ok(Math.abs(geometry.dx) <= 1 && Math.abs(geometry.dy) <= 1 && geometry.inside, `the dialog is centred inside its frame (${geometry.dx}, ${geometry.dy})`);
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
		return { duration: entrance.effect.getTiming().duration, innerFades, cell: cell.width, now: now.width, final: final.width, opacity: Number(frustum.style.opacity) };
	}, coast.photo("map", "b"));
	assert.equal(midway.duration, 200, "the same 200ms as a new cell");
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
	assert.ok(closing.now > Math.min(closing.cell, closing.final) && closing.now < Math.max(closing.cell, closing.final), "halfway the plane sits between the modal and its source");
	await page.waitForFunction(() => {
		const frustum = document.querySelector('.frame[data-frame="a"] .supermax-modal-layer .supermax-frustum');
		return frustum && Number(frustum.style.opacity) > 0 && Number(frustum.style.opacity) < 1;
	});
	await page.evaluate(() => window.__exit.play());
	await page.waitForFunction(() => !document.querySelector('.frame[data-frame="a"] .supermax-modal-layer'));
});

test("content that arrives after its cell has appeared swaps in without a fade of its own", async () => {
	await page.goto(`${server.url}/?delay=300${PRESENTATION === "origami" ? "" : `&presentation=${PRESENTATION}`}#${encodeLog([open("album:coast", "albums"), open("coast:photo:a", coast.row("thumbnails")), open("coast:history:a", coast.metadata("thumbnails", "a"))])}`);
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
	await resize([[800, 640], [420, 640]]);
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
			return { side: face.dataset.side, modalEdge: points[0], sourceEdge: points[2], units: gradient?.getAttribute("gradientUnits"), x1: at("x1"), y1: at("y1"), x2: at("x2"), y2: at("y2"), stops };
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
		assert.ok(near?.offset === 0 && far?.offset === 1 && rgb(near.color) === "0,0,0" && rgb(far.color) === "0,0,0", `the default callback paints with a dark veil in light mode: ${JSON.stringify(face)}`);
		const own = { top: 0.04, right: 0.1, bottom: 0.13, left: 0.08 }[face.side];
		assert.ok(Math.abs(alpha(near.color) - own - 0.05) < 0.005 && Math.abs(alpha(far.color) - Math.max(0, own - 0.05)) < 0.005, `five points more opaque at the modal edge and five less at the source, ten in all: ${JSON.stringify(face)}`);
	}
});

test("in dark mode the frustum is lighter than what lies behind it, still lit from above", async () => {
	await page.emulateMedia({ colorScheme: "dark" });
	try {
		await openDemo([open("album:coast", "albums"), open("coast:photo:b", coast.row("map"))]);
		await resize([[800, 640], [420, 640]]);
		await page.click(inFrame("a", `[data-occurrence="${coast.photo("map", "b")}"] .caption-edit`));
		await settle();
		await page.waitForFunction(() => document.querySelector('.frame[data-frame="a"] .supermax-origin.is-modal .supermax-frustum-face'));
		const fills = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.frame[data-frame="a"] .supermax-origin.is-modal .supermax-frustum-face')].map((face) => [face.dataset.side, getComputedStyle(face.parentElement.querySelector(`#${CSS.escape(/url\("?#([^\")]+)\"?\)/.exec(face.getAttribute("fill"))[1])} stop`)).stopColor])));
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
	const mark = await page.locator(inFrame("a", ".supermax-modal .supermax-loading-mark")).evaluate((element) => {
		const style = getComputedStyle(element);
		return { stroke: style.borderTopWidth, ring: style.borderTopColor, gap: style.borderRightColor, canvas: getComputedStyle(element.closest(".frame").querySelector(".supermax-canvas")).backgroundColor };
	});
	assert.deepEqual(mark, { stroke: "1px", ring: mark.canvas, gap: "rgba(0, 0, 0, 0)", canvas: mark.canvas }, "the loading mark is a one-pixel open ring in canvas colour");
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
			canvas: getComputedStyle(root.querySelector(".supermax-canvas")).backgroundColor,
			gutters: cells.map((cell) => [cell.dataset.occurrence.split("/").pop(), getComputedStyle(cell).borderLeftWidth]),
			rows: [...root.querySelectorAll(".supermax-row")].map((row) => getComputedStyle(row).borderTopWidth),
			frames: [...root.querySelectorAll(".supermax-row-chain")].map((frame) => getComputedStyle(frame).clipPath),
			leads: [...root.querySelectorAll(".supermax-row-chain > .supermax-chain > .supermax-strip > .is-lead")].map((room) => room.style.getPropertyValue("--supermax-cell-gutter-lead")),
			overflow: cells.filter((cell) => cell.closest(".supermax-row")).some((cell) => cell.getBoundingClientRect().right > split.right + 0.5),
			radius: getComputedStyle(root.querySelector(".supermax-up")).borderRadius,
		};
	});
	assert.equal(geometry.canvas, "rgb(221, 221, 221)", "the canvas takes the colour the host sets in --supermax-default-canvas");
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
	assert.deepEqual(geometry.frames, ["none", "none", "none"], "and at rest each row's frame opens, so its leading cell can paint the split's own gutter");
	assert.deepEqual(geometry.leads, ["1px", "1px", "1px"], "which the leading cell of each row keeps clear of its content");
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
	assert.ok(wide.some((row) => row.photo > 360), "a photo with remaining space grows past its preferred width");
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
	assert.equal(Math.round(row.width), 512, "the cell stays at its max");
	assert.ok(row.left > 4 && Math.abs(row.left - row.right) < 1, `with the canvas showing equally on both sides: ${JSON.stringify(row)}`);
});

test("a click opens its cell and every default under it in one stroke, folding together", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo([open("album:coast", "albums")]);
	await resize([[1400, 640], [420, 640]]);
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:d"));
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:d"]`));
	const opening = (await folds("a")).filter((fold) => !fold.leaving);
	assert.deepEqual(opening.map((fold) => fold.cell).sort(), ["coast:history:d", "coast:metadata:d", "coast:photo:d"], "the photo and its whole default chain fold open");
	assert.equal(new Set(opening.map((fold) => `${fold.start}+${fold.delay}`)).size, 1, "at the same moment");
	assert.equal(new Set(opening.map((fold) => fold.duration)).size, 1, "the cells complete their stroke together");
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

test("a cell that stays but changes size takes its final size at once, and only its room moves", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemoWithNothingKept([open("album:coast", "albums"), open("coast:photo:c", coast.row("thumbnails"))]);
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

test("a cell that shrinks keeps its layout until the transition ends, and slides under the cell that opens", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemoWithNothingKept([open("album:coast", "albums"), open("coast:photo:c", coast.row("thumbnails"))]);
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
	await openDemoWithNothingKept([open("album:coast", "albums")]);
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
	assert.deepEqual(hiding, [], "later nonfoldable rows remain visible after the earlier row is selected");
	assert.deepEqual(moments, [staying.map(() => 0), [], staying.map(() => 0), []], "the content of each staying row ends on its bottom edge at every moment");
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
		document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getTiming().iterations)).forEach((animation) => animation.finish());
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	await page.evaluate(() => window.supermaxDemo.prepare("coast:photo:c"));
	await page.evaluate((selector) => document.querySelector(selector).click(), `${cells[0]} .thumb[data-destination="coast:photo:c"]`);
	const opening = await pose([50, 100, 150].map((time) => time + SETTLE));
	await finish();
	await settle();
	await closeNewest("a");
	const closing = await pose([150, 100, 50].map((time) => time + SETTLE));
	const near = (a, b) => a.every((cell, index) => cell.every((value, axis) => index === 0 || Math.abs(value - b[index][axis]) <= 2));
	assert.ok(opening.every((moment, index) => near(moment, closing[index])), `each moment of the close mirrors the opening for the cells that close, whose left edge is the shared edge: ${JSON.stringify({ opening, closing })}`);
	assert.ok(closing.every((moment) => Math.abs(moment[0][0] - closing[0][0][0]) <= 1), `the neighbour that widens keeps its content at its left edge instead of jumping left and sliding back: ${JSON.stringify(closing.map((moment) => moment[0]))}`);
	await finish();
	await settle();
	const thumb = `${cells[0]} .thumb[data-destination="coast:photo:c"]`;
	await page.evaluate(({ thumb, time }) => {
		document.querySelector(thumb).click();
		for (const animation of document.getAnimations()) {
			if (!Number.isFinite(animation.effect?.getTiming().iterations)) continue;
			animation.pause();
			animation.currentTime = time;
		}
	}, { thumb, time: 100 + SETTLE });
	await waitForContent();
	const turns = await page.evaluate(async ({ thumb, cell }) => {
		const demo = window.supermaxDemo;
		const find = () => document.querySelector(cell).getAnimations().find((candidate) => candidate.effect.getKeyframes().some((frame) => String(frame.transform ?? "").includes("rotate")));
		const original = find();
		const sample = async () => {
			const animation = find();
			await animation.ready;
			return { same: animation === original, rate: animation.playbackRate, time: Math.round(animation.currentTime) };
		};
		const opening = await sample();
		demo.dispatch({ type: "close" }, demo.frames[0].workspace);
		const back = await sample();
		document.querySelector(thumb).click();
		return { opening, back, again: await sample() };
	}, { thumb, cell: cells[1] });
	assert.deepEqual(turns.opening, { same: true, rate: 1, time: 100 + SETTLE }, "halfway through opening");
	assert.ok(turns.back.same && turns.back.rate === -1 && Math.abs(turns.back.time - turns.opening.time) <= 50, `Back halfway reverses the opening from where it is: ${JSON.stringify(turns.back)}`);
	assert.ok(turns.again.same && turns.again.rate === 1 && Math.abs(turns.again.time - turns.back.time) <= 50, `and opening again reverses it once more: ${JSON.stringify(turns.again)}`);
	await finish();
	await settle();
});

test("the workspace warns once per kind when a host leaves out what its contract asks, and the demo never does", async () => {
	const warnings = [];
	const listen = (message) => { if (message.type() === "warning" && message.text().startsWith("Supermax:")) warnings.push(message.text()); };
	page.on("console", listen);
	try {
		await openDemo([open("album:coast", "albums")]);
		await page.evaluate(() => Promise.all(["coast:photo:b", "coast:photo:c", "coast:photo:d"].map((id) => window.supermaxDemo.prepare(id))));
		await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:b"]`));
		await page.click(inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "b")}"] .metadata-link`));
		await page.click(inFrame("a", '.album-item[data-destination="album:empty"]'));
		await page.click(inFrame("a", '.album-item[data-destination="album:coast"]'));
		await settle();
		assert.deepEqual(warnings, [], "the demo passes what the contract asks");
		const kinds = () => warnings.map((warning) => warning.split(" ")[1]);
		await page.evaluate((row) => {
			const workspace = window.supermaxDemo.frames[0].workspace;
			workspace.navigate("coast:photo:c", { from: row });
			workspace.navigate("coast:photo:d", { from: row });
			workspace.navigate("coast:photo:b", { from: row, origin: null });
		}, coast.row("thumbnails"));
		assert.deepEqual(kinds(), ["navigate()"], `a replacement without an origin warns once: ${warnings}`);
		await page.evaluate((row) => {
			const workspace = window.supermaxDemo.frames[0].workspace;
			workspace.sync(["albums", "album:empty"]);
			workspace.sync(["albums", "album:coast"], { origin: null });
			workspace.depart(workspace.navigator.child(workspace.navigator.root).id);
			workspace.depart(workspace.navigator.child(workspace.navigator.root).id, { origin: null }).cancel();
			workspace.openModal({ title: "Unsourced", content: () => ({ element: document.createElement("p") }) });
			workspace.openModal({ title: "Global", content: () => ({ element: document.createElement("p") }) }, { from: null });
			workspace.closeModal();
		}, coast.row("thumbnails"));
		assert.deepEqual(kinds(), ["navigate()", "sync()", "depart()", "openModal()"], `so does a sync or departure without one, and a modal without a source, while null says there is none: ${warnings}`);
		await page.evaluate(() => {
			const workspace = window.supermaxDemo.frames[0].workspace;
			const again = () => { workspace.removeEventListener("render", again); workspace.render(); };
			workspace.addEventListener("render", again);
			workspace.render();
		});
		assert.deepEqual(kinds().at(-1), "render()", `and a render from inside a render handler, which makes one click two renders: ${warnings}`);
		await settle();
	} finally {
		page.off("console", listen);
	}
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

test("a root cell places content controls in its title bar, which keeps them visible and cuts the title short", async () => {
	await openDemo([open(depthId(1), "albums")]);
	const depth = `albums/${depthId(1)}`;
	const result = await page.evaluate(async (id) => {
		const { waitForElement } = await import("/test/fixtures/readiness.js");
		const workspace = window.supermaxDemo.frames[0].workspace;
		const original = workspace.content;
		workspace.content = (occurrence, definition, host) => {
			const handle = original(occurrence, definition, host);
			if (occurrence.id !== id) return handle;
			const button = Object.assign(document.createElement("button"), { className: "host-search", textContent: "Search" });
			return typeof handle?.then === "function" ? handle.then((inner) => ({ ...inner, header: button })) : { ...handle, header: button };
		};
		workspace.reload((occurrence) => occurrence.id === id);
		const cell = document.querySelector(`.frame[data-frame="a"] [data-occurrence="${id}"]`);
		await waitForElement(cell, ".host-search");
		const header = cell.querySelector(":scope > .supermax-cell-title");
		const title = header.querySelector(".supermax-cell-title-text");
		title.textContent = "A very long photo title that cannot possibly fit in the header of this cell";
		const button = header.querySelector(".host-search");
		const placed = !!button && button.getBoundingClientRect().right <= header.getBoundingClientRect().right + 0.5;
		const cut = getComputedStyle(title).textOverflow;
		const modal = workspace.openModal({ title: "Zoom", content: () => ({ element: document.createElement("p"), header: Object.assign(document.createElement("button"), { className: "host-zoom", textContent: "Zoom" }) }) }, {});
		await waitForElement(document.querySelector('.frame[data-frame="a"]'), ".host-zoom");
		const inModal = !!document.querySelector('.frame[data-frame="a"] .supermax-modal-header .host-zoom');
		workspace.closeModal("close");
		return { placed, cut, inModal };
	}, depth);
	assert.deepEqual(result, { placed: true, cut: "ellipsis", inModal: true });
	await closeNewest("a");
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
	await settle();
	assert.equal(await page.locator(inFrame("a", ".host-search")).count(), 0, "and the controls leave with their content");
});

test("a cell inside a split row that declares a title header puts content controls in its bar", async () => {
	await openDemo([open("album:coast", "albums"), open("coast:history:a", coast.metadata("thumbnails", "a"))]);
	const history = coast.history("thumbnails", "a");
	const placement = await page.evaluate(async (id) => {
		const { waitForElement } = await import("/test/fixtures/readiness.js");
		const workspace = window.supermaxDemo.frames[0].workspace;
		const original = workspace.content;
		workspace.content = (occurrence, definition, host) => {
			const handle = original(occurrence, definition, host);
			if (occurrence.id !== id) return handle;
			const button = Object.assign(document.createElement("button"), { className: "host-search", textContent: "Search" });
			return typeof handle?.then === "function" ? handle.then((inner) => ({ ...inner, header: button })) : { ...handle, header: button };
		};
		workspace.reload((occurrence) => occurrence.id === id);
		const cell = document.querySelector(`.frame[data-frame="a"] [data-occurrence="${id}"]`);
		await waitForElement(cell, ".host-search");
		return { bar: !!cell.querySelector(":scope > .supermax-cell-title .supermax-cell-title-trailing .host-search"), body: !!cell.querySelector(":scope > .supermax-cell-body .host-search") };
	}, history);
	assert.deepEqual(placement, { bar: true, body: false }, "the history cell declares its bar, so its search goes there as it would outside a row");
});

test("a split that declares a title header puts content controls in its bar, the way a cell does", async () => {
	await page.goto(`${server.url}/blank`);
	await page.addStyleTag({ url: "/src/workspace.css" });
	const seen = await page.evaluate(async () => {
		const { waitForElement } = await import("/test/fixtures/readiness.js");
		const { Navigator, Workspace } = await import("/src/index.js");
		const host = Object.assign(document.body.appendChild(document.createElement("div")), { style: "position:relative;width:1200px;height:400px" });
		const navigator = new Navigator({ root: "albums", minViewportHeight: 300, destinations: {
			albums: { title: "Albums", min: 200, max: 200 },
			split: { title: "Coast", header: "title", rows: [
				{ destination: "photos", minHeight: 120, maxHeight: "*", preferredHeight: 200 },
				{ destination: "notes", minHeight: 120, maxHeight: 200 },
			] },
			plain: { title: "Plain", rows: [{ destination: "notes", minHeight: 120, maxHeight: "*", preferredHeight: 200 }] },
			photos: { title: "Photos", min: 200, max: "*", preferred: 300 },
			notes: { title: "Notes", min: 200, max: 300 },
		} });
		const asked = [];
		const warnings = [];
		const warn = console.warn;
		console.warn = (message) => warnings.push(String(message));
		const control = (label) => Object.assign(document.createElement("button"), { className: "host-copy", textContent: label });
		const workspace = new Workspace(host, { navigator, content: (occurrence) => {
			asked.push(occurrence.destination);
			if (occurrence.destination === "split") return Promise.resolve({ header: control("Copy 48213") });
			return { element: Object.assign(document.createElement("div"), { className: "host-body", textContent: occurrence.title }) };
		} });
		workspace.sync(["albums", "split"]);
		const split = host.querySelector('[data-occurrence="albums/split"]');
		await waitForElement(split, ".host-copy");
		const result = {
			bar: split.querySelector(":scope > .supermax-cell-title .supermax-cell-title-trailing .host-copy")?.textContent ?? null,
			rows: split.querySelectorAll(":scope > .supermax-cell-body .supermax-row").length,
			rowBodies: split.querySelectorAll(":scope > .supermax-cell-body .host-body").length,
		};
		workspace.content = (occurrence) => occurrence.destination === "split" ? { element: document.createElement("div"), header: control("Again") } : { element: Object.assign(document.createElement("div"), { className: "host-body" }) };
		workspace.reload((occurrence) => occurrence.destination === "split");
		result.reloaded = split.querySelector(":scope > .supermax-cell-title .host-copy")?.textContent ?? null;
		result.rowsAfterElement = split.querySelectorAll(":scope > .supermax-cell-body .supermax-row").length;
		result.warned = warnings.some((message) => message.includes("split"));
		workspace.sync(["albums", "plain"]);
		result.plainAsked = asked.includes("plain");
		console.warn = warn;
		workspace.destroy();
		host.remove();
		return result;
	});
	assert.deepEqual(seen, { bar: "Copy 48213", rows: 2, rowBodies: 2, reloaded: "Again", rowsAfterElement: 2, warned: true, plainAsked: false }, "the split's content gives its bar controls and nothing else: its rows keep the body, an element it returns is refused with a warning, and a split without a bar is not asked");
});

test("a cell's title can change after it opened, in its bar, accessible name and location", async () => {
	await openDemo([open("album:coast", "albums")]);
	const renamed = await page.evaluate(() => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const album = workspace.navigator.child(workspace.navigator.root);
		const ok = workspace.setTitle(album.id, "Coast, renamed");
		const cell = document.querySelector(`.frame[data-frame="a"] [data-occurrence="${album.id}"]`);
		const rail = workspace.setTitle("albums", "All albums") && document.querySelector('.frame[data-frame="a"] [data-occurrence="albums"] .supermax-cell-title-text').textContent;
		return { ok, label: cell.getAttribute("aria-label"), location: workspace.navigator.locationInfo().title, rail, unknown: workspace.setTitle("nowhere", "x") };
	});
	assert.deepEqual(renamed, { ok: true, label: "Coast, renamed", location: "Coast, renamed", rail: "All albums", unknown: false });
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
	assert.deepEqual(asked.seen[0].shown, { occurrence: TWENTY_DEEP[16].from + "/depth:17", destination: "depth:17", title: "Depth 17" }, "the question names what would be shown");
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
		document.querySelector(`.frame[data-frame="a"] [data-occurrence="${photo}"] .zoom-toggle`).click();
		return window.zoomEvents;
	}, photo);
	await settle();
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
	assert.deepEqual(events, ["coast:photo:c"], "the header's zoom control zooms Photo C");
	const zoomed = await shown();
	assert.deepEqual(zoomed.slice(0, 2), ["coast:photo:c", "coast:metadata:c"], `Thumbnails hides, and Photo C keeps what follows it: ${zoomed}`);
	const show = await page.locator(inFrame("a", ".supermax-up:not([hidden])")).evaluate((button) => ({ hidden: button.hidden, text: button.textContent }));
	assert.deepEqual(show, { hidden: false, text: "Thumbnails" }, "the Show control offers the way back to the zoomed cell's hidden parent");
	await page.click(inFrame("a", ".supermax-up:not([hidden])"));
	await settle();
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
	assert.deepEqual(await page.evaluate(() => window.zoomEvents), ["coast:photo:c", null], "and Show zooms out first");
	assert.deepEqual(await shown(), before, "bringing everything back, with nothing closed");
});

test("in zoom the Show control names only what zooming out brings back, because zooming out is the inverse of zooming in", async () => {
	await openDemo([open("album:coast", "albums"), open("coast:photo:c", coast.row("thumbnails"))]);
	await resize([[1400, 640], [420, 640]]);
	const photo = coast.photo("thumbnails", "c");
	const visibleTitles = () => page.evaluate(() => [...document.querySelectorAll('.frame[data-frame="b"] .supermax-cell')].filter((cell) => getComputedStyle(cell).visibility === "visible" && cell.getBoundingClientRect().width > 0).map((cell) => cell.getAttribute("aria-label")));
	const before = await visibleTitles();
	await page.evaluate((photo) => window.supermaxDemo.frames[1].workspace.zoom(photo), photo);
	await settle();
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
	const control = await page.locator(inFrame("b", ".supermax-up:not([hidden])")).evaluate((button) => ({ hidden: button.hidden, name: button.querySelector(".supermax-up-target")?.textContent ?? "", label: button.getAttribute("aria-label") }));
	assert.equal(control.hidden, false, "zoom always provides an exit");
	await page.locator(inFrame("b", ".supermax-up:not([hidden])")).click();
	await settle();
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
	const after = await visibleTitles();
	assert.deepEqual(after, before, "zooming out restores exactly what was in view before zooming in");
	if (control.label === "Zoom out") assert.equal(control.name, "Back");
	else assert.ok(after.includes(control.name), `the name in the Show control, ${control.name}, is a cell that zooming out brought back into view: ${after}`);
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

test("while a layout is on its way the cells it replaces fold away in rooms that stay, and the new cell opens there in one stroke", { skip: PRESENTATION !== "origami" }, async (test) => {
	await useDemoPage(test);
	await openDemo([open("album:coast", "albums")]);
	const photoA = inFrame("a", `[data-occurrence="${coast.photo("thumbnails", "a")}"]`);
	const room = () => page.locator(photoA).evaluate((cell) => Math.round(cell.parentElement.getBoundingClientRect().width));
	const before = await room();
	await page.evaluate(() => {
		const demo = window.supermaxDemo;
		demo.setNetwork({ delay: "0" });
		const request = demo.request.bind(demo);
		const layout = Promise.withResolvers();
		window.releaseLayout = layout.resolve;
		demo.request = (kind, method, url) => {
			const response = request(kind, method, url);
			if (kind !== "layout" || url !== "/supermax/layout?destination=coast%3Aphoto%3Ab") return response;
			return Promise.all([response, layout.promise]).then(([result]) => result);
		};
	});
	await page.click(inFrame("a", `[data-occurrence="${coast.row("thumbnails")}"] .thumb[data-destination="coast:photo:b"]`));
	assert.equal(await page.evaluate(() => window.supermaxDemo.requests.some(({ kind, url }) => kind === "layout" && url === "/supermax/layout?destination=coast%3Aphoto%3Ab")), true, "the new layout was requested");
	const departure = await departureOf(photoA);
	assert.equal(departure?.delay, TIMING.depart, "the old photo keeps its content for a moment, then folds away");
	assert.deepEqual((await shapes("a")).filter((shape) => !shape.changes.includes("transform") && !shape.changes.includes("opacity")), [], "and no room moves");
	await page.evaluate(() => {
		const finite = document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getTiming().iterations));
		for (const animation of finite) animation.finish();
	});
	assert.equal((await departureOf(photoA)).state, "finished", "it is gone before the layout arrives");
	assert.equal(await room(), before, "its room stays, showing the canvas");
	assert.equal(await page.locator(photoA).evaluate((cell) => cell.inert), true, "and what folded away takes no clicks");
	await page.evaluate((occurrence) => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const capture = (event) => {
			if (!event.detail.layout.cells.has(occurrence)) return;
			workspace.removeEventListener("render", capture);
			window.layoutOpening = workspace.element.getAnimations({ subtree: true }).flatMap((animation) => {
				const cell = animation.effect?.target;
				if (!cell?.matches?.(".supermax-cell") || !animation.effect.getKeyframes().some((keyframe) => keyframe.transform !== undefined)) return [];
				return [{ cell: cell.dataset.occurrence.split("/").pop(), delay: animation.effect.getTiming().delay, leaving: cell.hasAttribute("data-supermax-exiting"), state: animation.playState }];
			});
		};
		workspace.addEventListener("render", capture);
		window.releaseLayout();
	}, coast.photo("thumbnails", "b"));
	await page.waitForFunction(() => window.layoutOpening);
	const animations = await page.evaluate(() => window.layoutOpening);
	const opening = animations.filter((animation) => !animation.leaving);
	assert.ok(animations.filter((animation) => animation.leaving).every((animation) => animation.state === "finished"), "the old cells do not fold away a second time");
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
	assert.equal(await element.evaluate((node) => node.isConnected && !node.hasAttribute("data-supermax-exiting")), true, "it is the same cell, drafts and all");
	await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
	await settle();
	assert.equal((await groups("a")).at(-1), "Photo A", "and the click on it is the newest group");
});

test("origami folds a cell open from its parent's edge and back onto it when it closes, a replaced cell folding away on its far edge, the whole cell shading to the canvas with the fold", { skip: PRESENTATION !== "origami" }, async () => {
	await openDemo(THREE_ROWS);
	await page.evaluate((id) => {
		const workspace = window.supermaxDemo.frames[0].workspace;
		const history = workspace.navigator.get(id);
		if (history) workspace.navigator.closeSubtree(history);
		workspace.render({ animate: false });
	}, coast.history("thumbnails", "a"));
	const motion = () => page.evaluate(() => {
		const cells = [...document.querySelectorAll('.frame[data-frame="a"] .supermax-cell')];
		return cells.map((cell) => {
			const animations = document.getAnimations().filter((animation) => animation.effect?.target === cell);
			const fold = animations.find((animation) => animation.effect.getKeyframes().some((frame) => frame.transform?.includes("rotate")));
			if (!fold) return null;
			const fade = document.getAnimations().find((animation) => animation.effect?.target === cell.querySelector(":scope > .supermax-veil") && animation.effect.getKeyframes().some((frame) => frame.opacity !== undefined));
			const edge = (frames, folded) => frames.filter(folded).map((frame) => frame.computedOffset);
			return {
				cell: cell.dataset.occurrence.split("/").pop(),
				leaving: cell.hasAttribute("data-supermax-exiting"),
				origin: cell.style.transformOrigin,
				direction: fold.effect.getTiming().direction,
				delay: fold.effect.getTiming().delay,
				end: fold.effect.getComputedTiming().endTime,
				transforms: fold.effect.getKeyframes().map((frame) => frame.transform),
				onEdge: edge(fold.effect.getKeyframes(), (frame) => frame.transform !== "none"),
				transparent: fade ? edge(fade.effect.getKeyframes(), (frame) => Number(frame.opacity) === 1) : null,
				opaque: getComputedStyle(cell).opacity,
				shadeOnCompositor: !!fade && !fade.effect.getKeyframes().some((frame) => Object.keys(frame).some((key) => key.startsWith("--"))),
				fadeTiming: fade ? [fade.effect.getTiming().delay, fade.effect.getComputedTiming().endTime] : null,
				innerFades: document.getAnimations().filter((animation) => cell.contains(animation.effect?.target) && animation.effect.target !== cell && !animation.effect.target.classList.contains("supermax-veil") && animation.effect.getKeyframes().some((frame) => frame.opacity !== undefined)).length,
			};
		}).filter(Boolean);
	});
	const wholeCell = (animation, label) => {
		assert.deepEqual(animation.transparent, animation.onEdge, `${label} is fully shaded to the canvas exactly while it stands on edge`);
		assert.equal(animation.opaque, "1", `${label} stays opaque, so overlapping cells never show through each other`);
		assert.equal(animation.shadeOnCompositor, true, `${label} shades through the opacity of its canvas-coloured overlay, never through a property its content would recalculate`);
		assert.deepEqual(animation.fadeTiming, [animation.delay, animation.end], `${label} fades on the fold's timeline`);
		assert.equal(animation.innerFades, 0, `${label} fades as one, not element by element`);
	};
	await page.click(inFrame("a", '[data-occurrence$="coast:metadata:a"] .metadata-link:not(.album-export)'));
	const opening = (await motion()).find((animation) => !animation.leaving && animation.cell === "coast:history:a");
	assert.equal(opening?.origin, "left center", "a new cell folds open from the edge it shares with its parent");
	assert.equal(opening.transforms[0], "rotateY(90deg)");
	wholeCell(opening, "the opening cell");
	await settle();
	await page.evaluate(() => window.supermaxDemo.dispatch({ type: "close" }, window.supermaxDemo.frames[0].workspace));
	const closing = (await motion()).find((animation) => animation.leaving && animation.cell === "coast:history:a");
	assert.equal(closing?.origin, "left center", "a closed cell folds back onto the edge it opened from");
	assert.deepEqual([closing.transforms[0], closing.direction], ["rotateY(90deg)", "reverse"], "by playing its opening backwards");
	wholeCell(closing, "the closing cell");
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
