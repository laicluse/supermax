import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openBrowser } from "./browser.js";
import { serveDocs } from "./serve-docs.js";

let server, browser, page;
before(async () => {
	server = await serveDocs();
	browser = await openBrowser();
	page = await browser.newPage();
	await page.goto(`${server.url}/blank`);
	await page.evaluate(async () => {
		const { Navigator, Workspace, TimeScale } = await import("/src/index.js");
		const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/src/workspace.css"; document.head.append(link);
		await new Promise((resolve) => { link.onload = resolve; });
		const host = document.createElement("div"); host.style.cssText = "width:700px;height:400px"; document.body.append(host);
		const navigator = new Navigator({ root: "menu", minViewportHeight: 100, destinations: {
			menu: { title: "Menu", min: 48, max: 320, preferred: 240, overflow: { mode: "keep" }, variants: [
				{ id: "labels", when: { minWidth: 161 } }, { id: "icons", min: 48, max: 160, preferred: 48 },
			] },
			work: { title: "Work", min: 200, max: "*", preferred: 500 },
		} });
		navigator.open("work");
		window.changes = [];
		window.workspace = new Workspace(host, { navigator, time: new TimeScale(2), content: () => {
			const element = document.createElement("div"); element.textContent = "Content"; element.style.width = "100%";
			return { element, transition: ({ from, to }) => {
				const drawn = parseFloat(getComputedStyle(element).opacity);
				changes.push({ from, to, drawn });
				return {
					prepare: () => { element.textContent = to.variant ?? "Work"; element.style.opacity = to.variant === "icons" ? ".4" : "1"; },
					animate: ({ animate }) => { window.contentAnimation = animate(element, [{ opacity: drawn }, { opacity: to.variant === "icons" ? .4 : 1 }]); },
				};
			} };
		} });
		window.finish = async () => {
			for (const animation of document.getAnimations()) animation.finish();
			await Promise.all([...workspace.chains.values()].map(({ strip }) => strip.finished));
		};
		window.resize = (width, animate = true) => {
			host.style.width = `${width}px`;
			navigator.resize({ width, height: 400 });
			workspace.render({ animate });
		};
	});
});
after(async () => { await browser?.close(); await server?.close(); });

test("variant content joins the existing geometry lifecycle and retargets from the drawn state", async () => {
	const result = await page.evaluate(async () => {
		await finish();
		resize(479);
		const strip = workspace.chains.get("menu").strip;
		const animation = contentAnimation;
		const timing = animation.effect.getTiming();
		const owned = strip.geometry.includes(animation);
		for (const motion of strip.geometry) { motion.pause(); motion.currentTime = timing.delay + timing.duration * .4; }
		const drawn = parseFloat(getComputedStyle(animation.effect.target).opacity);
		resize(700);
		const captured = changes.at(-1).drawn;
		const cancelled = animation.playState;
		for (const motion of strip.geometry) { motion.pause(); motion.currentTime = 0; }
		const retargeted = parseFloat(getComputedStyle(contentAnimation.effect.target).opacity);
		await finish();
		return { owned, duration: timing.duration, cancelled, drawn, captured, retargeted, variant: workspace.findCell("menu").variant, animations: document.getAnimations().length };
	});
	assert.equal(result.owned, true, "host animation belongs to the strip's existing managed geometry");
	assert.ok(result.duration > 200, "the shared TimeScale applies");
	assert.equal(result.cancelled, "idle");
	assert.ok(Math.abs(result.drawn - result.captured) < .001, "capture precedes cancellation");
	assert.ok(Math.abs(result.drawn - result.retargeted) < .001, "new motion starts at current drawn content");
	assert.equal(result.variant, "labels");
	assert.equal(result.animations, 0, "shared completion cleans up host animations");
});

test("instant commits and reduced motion prepare content without starting animations", async () => {
	await page.evaluate(async () => { await finish(); resize(479, false); });
	assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
	assert.equal(await page.locator('[data-occurrence="menu"]').getAttribute("data-variant"), "icons");
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.evaluate(() => resize(700));
	assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
	assert.equal(await page.locator('[data-occurrence="menu"]').getAttribute("data-variant"), "labels");
});

test("variant transitions retain a painted surface and fixed content width throughout the room exchange", async () => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	const samples = await page.evaluate(async () => {
		await finish();
		const menu = workspace.cells.get("menu");
		delete menu.slot.handle.transition;
		menu.element.classList.remove("is-headless");
		menu.body.style.background = "rgb(23, 25, 28)";
		resize(700, false);
		resize(479);
		const strip = workspace.chains.get("menu").strip;
		const samples = [];
		for (const fraction of [0, .2, .5, .8, 1]) {
			for (const animation of strip.geometry) {
				animation.pause();
				const timing = animation.effect.getTiming();
				animation.currentTime = timing.delay + timing.duration * fraction;
			}
			samples.push({ surface: menu.body.getBoundingClientRect().width, room: menu.element.getBoundingClientRect().width, opacity: getComputedStyle(menu.body).opacity, content: menu.slot.handle.element.getBoundingClientRect().width });
		}
		await finish();
		return samples;
	});
	for (const sample of samples) {
		assert.ok(Math.abs(sample.surface - sample.room) < 1, "the surface fills the moving room");
		assert.equal(sample.opacity, "1", "content fading keeps its backing surface opaque");
		assert.ok(Math.abs(sample.content - 48) < 1, "content uses the target width throughout motion");
	}
});

test("a compact fixed-width form can be expanded back with its divider", async () => {
	await page.evaluate(async () => { await finish(); resize(700, false); workspace.setSize("menu", 48); });
	assert.equal(await page.evaluate(() => workspace.findCell("menu").variant), "icons");
	const handle = page.locator('[data-divides="menu"] .supermax-divider-handle');
	const box = await handle.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 5 });
	await page.mouse.up();
	assert.equal(await page.evaluate(() => workspace.findCell("menu").variant), "labels");
	assert.ok(await page.evaluate(() => workspace.findCell("menu").width >= 161));
});

test("continued viewport movement retargets a form exchange without cancelling its content motion", async () => {
	const result = await page.evaluate(async () => {
		await finish(); workspace.setSize("menu", null); resize(700, false); resize(479);
		const strip = workspace.chains.get("menu").strip;
		for (const animation of strip.geometry) { animation.pause(); animation.currentTime = 40; }
		workspace.element.style.width = "478px";
		workspace.measure();
		const result = { active: strip.geometry.length, variant: workspace.findCell("menu").variant };
		await finish();
		return result;
	});
	assert.ok(result.active > 0);
	assert.equal(result.variant, "icons");
});

test("a form can change while its asynchronous content is loading", async () => {
	const result = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const element = document.createElement("div"); element.style.cssText = "width:700px;height:200px"; document.body.append(element);
		const navigator = new Navigator({ root: "pending", minViewportHeight: 100, destinations: {
			pending: { title: "Pending", min: 48, max: "*", preferred: 240, variants: [{ id: "labels", when: { minWidth: 161 } }, { id: "icons", max: 160, preferred: 48 }] },
		} });
		let resolve;
		const pending = new Promise((done) => { resolve = done; });
		const view = new Workspace(element, { navigator, content: () => pending });
		element.style.width = "100px"; view.measure();
		const content = document.createElement("div"); content.textContent = "Loaded";
		resolve({ element: content }); await pending; await Promise.resolve();
		const result = { variant: view.findCell("pending").variant, mounted: content.isConnected };
		view.destroy(); element.remove();
		return result;
	});
	assert.deepEqual(result, { variant: "icons", mounted: true });
});

test("fixed content width accounts for the gutter inside a non-leading cell", async () => {
	const result = await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const element = document.createElement("div"); element.style.cssText = "width:700px;height:200px"; document.body.append(element);
		const navigator = new Navigator({ root: "menu", minViewportHeight: 100, destinations: {
			menu: { title: "Menu", min: 48, max: 48, overflow: { mode: "keep" } },
			work: { title: "Work", min: 200, max: "*", preferred: 500, header: "title", variants: [{ id: "expanded", when: { minWidth: 400 } }, { id: "compact", max: 399, preferred: 200 }] },
		} }); navigator.open("work");
		const view = new Workspace(element, { navigator, content: () => {
			const element = document.createElement("div"); element.style.width = "100%";
			return { element };
		} });
		view.observer.disconnect();
		element.style.width = "348px"; navigator.resize({ width: 348, height: 200 }); view.render();
		const strip = view.chains.get("menu").strip;
		for (const animation of strip.geometry) { animation.pause(); const timing = animation.effect.getTiming(); animation.currentTime = timing.delay + timing.duration; }
		strip.step();
		const body = view.cells.get("menu/work").body;
		const result = { viewport: body.clientWidth, content: body.scrollWidth };
		for (const animation of strip.geometry) animation.finish(); await strip.finished;
		result.locked = view.cells.get("menu/work").element.hasAttribute("data-supermax-variant-paper");
		view.destroy(); element.remove();
		return result;
	});
	assert.equal(result.content, result.viewport, "the transition adds no horizontal scrollbar");
	assert.equal(result.locked, false, "settling releases the temporary content width");
});

test("a surviving boundary keeps its gutter until its preceding surface has left view", async () => {
	const point = await page.evaluate(async () => {
		await finish();
		workspace.navigator.destinations.menu = { title: "Menu", min: 200, max: 200 };
		workspace.navigator.destinations.work = { title: "Work", min: 300, max: "*", preferred: 400 };
		workspace.navigator.setSize("menu", null); workspace.navigator.setSize("menu/work", null);
		workspace.element.style.setProperty("--supermax-default-canvas", "rgb(201,204,209)");
		workspace.element.style.setProperty("--supermax-default-surface", "rgb(23,25,28)");
		resize(700, false); resize(400);
		const strip = workspace.chains.get("menu").strip;
		for (const animation of strip.geometry) { animation.pause(); const timing = animation.effect.getTiming(); animation.currentTime = timing.delay + timing.duration * .3; }
		strip.step();
		const work = strip.entries.find((entry) => entry.id === "menu/work");
		const box = strip.boxOf(work).getBoundingClientRect();
		return { x: Math.round(box.left), y: Math.round(box.top + 100) };
	});
	const screenshot = (await page.screenshot()).toString("base64");
	const colour = await page.evaluate(async ({ screenshot, point }) => {
		const image = new Image(); image.src = `data:image/png;base64,${screenshot}`; await image.decode();
		const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
		const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
		return [...context.getImageData(point.x, point.y, 1, 1).data];
	}, { screenshot, point });
	assert.deepEqual(colour, [201, 204, 209, 255]);
	assert.equal(await page.evaluate(() => {
		const strip = workspace.chains.get("menu").strip;
		for (const animation of strip.geometry) { const timing = animation.effect.getTiming(); animation.currentTime = timing.delay + timing.duration; }
		strip.step();
		const work = strip.entries.find((entry) => entry.id === "menu/work");
		return strip.boxOf(work).style.getPropertyValue("--supermax-cell-gutter");
	}), "0px", "the viewport edge becomes leading once its predecessor has left");
	await page.evaluate(() => finish());
});
