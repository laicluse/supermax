import assert from "node:assert/strict";
import { test } from "node:test";
import { openBrowser } from "./browser.js";
import { Navigator } from "../src/navigation.js";
import { serveDocs } from "./serve-docs.js";

function gallery(width = 420) {
	const model = new Navigator({ root: "menu", minViewportHeight: 200, destinations: {
		menu: { title: "Menu", min: 48, max: 120, overflow: { mode: "keep" } },
		split: { title: "Work", rows: [
			{ destination: "list", minHeight: 100, maxHeight: "*", preferredHeight: 200 },
			{ destination: "support", minHeight: 100, maxHeight: 100 },
		] },
		list: { title: "List", min: 300, max: 360 },
		photo: { title: "Photo", min: 260, max: "*", preferred: 400 },
		support: { title: "Support", min: 80, max: "*", preferred: 100 },
	} });
	model.resize({ width, height: 300 });
	model.open("split", { from: "menu" });
	model.open("photo", { from: "menu/split/list" });
	return model;
}

const widths = (model) => model.layout().chain.cells.map((cell) => cell.width);

test("opening a folded row keeps the outer widths without creating session sizes", () => {
	const model = gallery();
	model.resize({ width: 420, height: 150 });
	const before = widths(model);
	const open = model.state();
	for (const target of ["menu/split/list", "menu/split/support", "menu/split/list"]) {
		assert.deepEqual(model.unfold(target, "vertical"), []);
		assert.deepEqual(widths(model), before);
		assert.equal(model.layout().rows.get(target).folded, false);
		assert.equal(model.sizeOf("menu"), null);
		assert.deepEqual(model.state(), open);
		const snapshot = model.snapshot();
		model.layout(); model.layout();
		assert.deepEqual(model.snapshot(), snapshot, "layout remains a query");
	}
});

test("a restored snapshot opens the same folds as the model it came from", () => {
	const model = gallery();
	model.resize({ width: 420, height: 150 });
	model.unfold("menu/split/list", "vertical");
	const independent = gallery();
	independent.resize({ width: 420, height: 150 });
	independent.restore(JSON.parse(JSON.stringify(model.snapshot())));
	assert.deepEqual(widths(model), widths(independent));
	assert.equal(independent.layout().rows.get("menu/split/list").folded, false);
	model.reset();
	assert.equal(model.layout().chain.cells.length, 1);
});

test("surviving leading edges stay still during shrinking, growing and interrupted room changes", async () => {
	const server = await serveDocs();
	const browser = await openBrowser();
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		const results = await page.evaluate(async () => {
			const { CellStrip, VEIL_PRESENTATION, ORIGAMI_PRESENTATION } = await import("/src/index.js");
			const results = [];
			for (const motion of [null, VEIL_PRESENTATION.motion, ORIGAMI_PRESENTATION.motion]) for (const width of [420, 960]) {
				const host = document.createElement("div");
				host.style.cssText = `position:relative;width:${width}px;height:160px`;
				document.body.append(host);
				const menu = document.createElement("div"), work = document.createElement("div");
				menu.textContent = "Menu";
				const strip = new CellStrip(host, { duration: 300, settle: 0, motion: motion && { ...motion, travel: () => 300 } });
				const entries = (size) => [{ id: "menu", element: menu, width: size, visible: true }, { id: "work", element: work, width: width - size, visible: true }];
				await strip.update(entries(72), { animate: false });
				const left = menu.getBoundingClientRect().left;
				const samples = [];
				for (const [size, times] of [[67, [0, 90, 180]], [72, [0, 60, 160]], [67, [0, 150, 300]]]) {
					strip.update(entries(size));
					for (const time of times) {
						for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; }
						samples.push(menu.getBoundingClientRect().left - left);
					}
				}
				for (const animation of document.getAnimations()) animation.finish();
				await strip.finished;
				samples.push(menu.getBoundingClientRect().left - left);
				results.push({ width, motion: motion === null ? "paper" : motion === VEIL_PRESENTATION.motion ? "veil" : "origami", samples });
				strip.destroy(); host.remove();
			}
			return results;
		});
		for (const result of results) assert.ok(result.samples.every((offset) => Math.abs(offset) < .02), JSON.stringify(result));
	} finally { await browser.close(); await server.close(); }
});

test("opening folded rows keeps the menu and its centered content stable in every presentation", async () => {
	const server = await serveDocs();
	const browser = await openBrowser();
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
		await page.goto(`${server.url}/blank`);
		await page.addStyleTag({ url: `${server.url}/src/workspace.css` });
		const results = await page.evaluate(async (destinations) => {
			const { Navigator, Workspace, VEIL_PRESENTATION, ORIGAMI_PRESENTATION } = await import("/src/index.js");
			const { foldPresentation } = await import("/assets/presentation-fold.js");
			const results = [];
			for (const presentation of [VEIL_PRESENTATION, ORIGAMI_PRESENTATION, foldPresentation]) for (const width of [420, 960]) {
				const host = document.createElement("div");
				host.style.cssText = `position:relative;width:${width}px;height:150px`;
				document.body.append(host);
				const navigator = new Navigator({ root: "menu", minViewportHeight: 200, destinations });
				navigator.resize({ width, height: 150 });
				navigator.open("split", { from: "menu" });
				navigator.open("photo", { from: "menu/split/list" });
				const workspace = new Workspace(host, { navigator, presentation, content: () => {
					const element = document.createElement("div");
					element.style.cssText = "display:flex;justify-content:center";
					const button = document.createElement("button"); button.textContent = "C"; element.append(button);
					return { element };
				} });
				const settle = async () => {
					for (const animation of host.getAnimations({ subtree: true })) if (animation.effect.getTiming().iterations !== Infinity) animation.finish();
					await Promise.all([...workspace.chains.values()].map((chain) => chain.strip.finished));
					await new Promise(requestAnimationFrame);
				};
				await settle();
				const menu = workspace.cells.get("menu").element;
				const button = menu.querySelector(".supermax-cell-body button");
				const measure = () => ({ left: menu.getBoundingClientRect().left, width: menu.getBoundingClientRect().width, button: button.getBoundingClientRect().left, target: workspace.layout.cells.get("menu").width });
				const before = measure(), samples = [];
				for (const [target, axis] of [["menu/split/list", "vertical"], ["menu/split/support", "vertical"], ["menu/split/list", "vertical"]]) {
					workspace.folds.open(target, axis);
					for (const fraction of [0, .1, .5, .9, 1]) {
						for (const animation of host.getAnimations({ subtree: true })) {
							animation.pause(); animation.currentTime = fraction * animation.effect.getComputedTiming().endTime;
						}
						samples.push(measure());
					}
					await settle(); samples.push(measure());
				}
				results.push({ presentation: presentation.name, width, before, samples });
				workspace.destroy(); host.remove();
			}
			return results;
		}, gallery().destinations);
		for (const result of results) for (const sample of result.samples) for (const key of ["left", "width", "button", "target"]) {
			assert.ok(Math.abs(sample[key] - result.before[key]) < .02, `${result.presentation} ${result.width} ${key}: ${JSON.stringify(sample)} vs ${JSON.stringify(result.before)}`);
		}
	} finally { await browser.close(); await server.close(); }
});
