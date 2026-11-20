import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const server = createServer(async (request, response) => {
	if (request.url === "/") {
		response.setHeader("Content-Type", "text/html");
		response.end("<!doctype html><title>Cell strip</title>");
		return;
	}
	try {
		const source = await readFile(new URL(`../src/${request.url.slice(1)}`, import.meta.url));
		response.setHeader("Content-Type", "text/javascript");
		response.end(source);
	} catch {
		response.writeHead(404).end();
	}
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
	const page = await browser.newPage();
	await page.goto(`http://127.0.0.1:${server.address().port}/`);
	await page.evaluate(async () => {
		const { CellStrip } = await import("/cell-strip.js");
		document.body.style.margin = "0";
		const viewport = document.createElement("div");
		viewport.style.cssText = "width:320px;height:500px";
		document.body.append(viewport);
		window.strip = new CellStrip(viewport);
		window.cells = Object.fromEntries(["board", "idea", "slice"].map((id) => {
			const element = document.createElement("section");
			element.textContent = id;
			return [id, element];
		}));
		window.entry = (id, visible, width = 320) => ({ id, element: cells[id], width, visible });
		window.sample = () => Object.fromEntries(Object.entries(cells).map(([id, element]) => {
			const rectangle = element.getBoundingClientRect();
			return [id, { left: rectangle.left, width: rectangle.width, visibility: getComputedStyle(element).visibility, inert: element.inert, connected: element.isConnected }];
		}));
		window.seek = (time) => document.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = time; });
		window.finish = async () => { document.getAnimations().forEach((animation) => animation.finish()); await strip.finished; };
		await strip.update([entry("board", true)]);
	});
	assert.equal(await page.evaluate(() => document.getAnimations().length), 0, "initial paint is immediate");
	const push = await page.evaluate(() => {
		strip.update([entry("board", false), entry("idea", true)]);
		seek(100);
		return sample();
	});
	assert(push.board.left < 0 && push.board.left > -320);
	assert(push.idea.left > 0 && push.idea.left < 320);
	assert.equal(push.board.width, 320, "hidden ancestor retains its width");
	assert.equal(push.board.visibility, "visible", "outgoing ancestor remains painted during motion");
	assert.equal(push.board.inert, true);
	assert(Math.abs(push.idea.left - push.board.left - 320) < 0.1, "strip moves as one connected surface");
	await page.evaluate(() => finish());
	assert.equal((await page.evaluate(() => sample())).board.visibility, "hidden");
	const pop = await page.evaluate(() => {
		strip.update([entry("board", true)]);
		seek(100);
		return sample();
	});
	assert(pop.board.left < 0 && pop.board.left > -320);
	assert(pop.idea.left > 0 && pop.idea.left < 320);
	assert.equal(pop.idea.connected, true, "removed child survives until its exit finishes");
	assert.equal(pop.idea.inert, true);
	await page.evaluate(() => finish());
	assert.equal((await page.evaluate(() => sample())).idea.connected, false);
	const interruption = await page.evaluate(() => {
		strip.update([entry("board", false), entry("idea", true)]);
		seek(70);
		const before = sample();
		strip.update([entry("board", true)]);
		seek(0);
		return { before, after: sample() };
	});
	assert(Math.abs(interruption.before.board.left - interruption.after.board.left) < 0.1, "reversing starts at current position");
	await page.evaluate(() => finish());
	const reverseAgain = await page.evaluate(() => {
		strip.update([entry("board", false), entry("idea", true)]);
		seek(90);
		strip.update([entry("board", true)]);
		seek(40);
		const before = sample();
		strip.update([entry("board", false), entry("idea", true)]);
		seek(0);
		return { before, after: sample(), count: strip.entries.filter((cell) => cell.id === "idea").length };
	});
	assert.equal(reverseAgain.count, 1);
	assert(Math.abs(reverseAgain.before.idea.left - reverseAgain.after.idea.left) < 0.1);
	await page.evaluate(() => finish());
	await page.evaluate(() => strip.update([entry("board", true)], { animate: false }));
	const resize = await page.evaluate(() => {
		strip.update([entry("board", true, 200), entry("idea", true, 120)]);
		seek(100);
		return sample();
	});
	assert(resize.board.width > 200 && resize.board.width < 320);
	assert(Math.abs(resize.idea.left - resize.board.width) < 0.1, "width and translation share the same timeline");
	await page.evaluate(() => finish());
	const reorder = await page.evaluate(() => {
		const before = sample();
		strip.update([entry("idea", true, 120), entry("board", true, 200)]);
		seek(0);
		return { before, after: sample() };
	});
	assert(Math.abs(reorder.before.board.left - reorder.after.board.left) < 0.1);
	await page.evaluate(() => finish());
	assert.equal((await page.evaluate(() => sample())).idea.left, 0);
	await page.evaluate(() => strip.update([entry("board", true, 200), entry("idea", true, 120)], { animate: false }));
	assert.equal(await page.evaluate(async () => {
		const replacement = document.createElement("section");
		replacement.textContent = "updated idea";
		cells.idea = replacement;
		await strip.update([entry("board", true, 200), entry("idea", true, 120)]);
		return document.getAnimations().length;
	}), 0, "same geometry content updates do not animate");
	const wrapped = await page.evaluate(async () => {
		strip.viewport.style.width = "520px";
		const wrapper = document.createElement("div");
		wrapper.style.display = "contents";
		strip.strip.append(wrapper);
		wrapper.append(cells.idea);
		strip.update([entry("board", false, 200), entry("idea", true, 320), entry("slice", true, 200)]);
		seek(100);
		const retained = cells.idea.parentElement === wrapper;
		await finish();
		strip.update([entry("board", false, 200), entry("idea", true, 520)]);
		seek(100);
		return { retained, exiting: cells.slice.hasAttribute("data-supermax-exiting"), painted: cells.slice.isConnected };
	});
	assert.equal(wrapped.retained, true);
	assert.equal(wrapped.exiting, true);
	assert.equal(wrapped.painted, true);
	await page.evaluate(() => finish());
	const rootReplacement = await page.evaluate(async () => {
		await strip.update([entry("board", true, 200), entry("idea", true, 320)], { animate: false });
		cells.board = document.createElement("section");
		cells.board.textContent = "replacement board";
		await strip.update([entry("board", true, 200), entry("idea", true, 320)]);
		return sample();
	});
	assert.equal(rootReplacement.board.left, 0, "same-ID replacement preserves its position before a wrapper");
	assert.equal(rootReplacement.idea.left, 200);
	const invalid = await page.evaluate(() => {
		const messages = [];
		for (const entries of [[entry("board", true, 0)], [entry("board", true), entry("board", false)]]) {
			try { strip.update(entries); } catch (error) { messages.push(error.message); }
		}
		return messages;
	});
	assert.deepEqual(invalid, ["Invalid cell width: board", "Duplicate cell id: board"]);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.evaluate(() => strip.update([entry("board", false, 200), entry("idea", true, 320)]));
	const reduced = await page.evaluate(() => sample());
	assert.equal(reduced.idea.left, 0);
	assert.equal(reduced.board.visibility, "hidden");
	assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
	await page.evaluate(() => strip.destroy());
	await page.emulateMedia({ reducedMotion: "no-preference" });
	const scroll = await page.evaluate(async () => {
		const { ORIGAMI_PRESENTATION } = await import("/origami.js");
		const { CellStrip } = await import("/cell-strip.js");
		const viewport = document.createElement("div");
		viewport.style.cssText = "width:900px;height:300px";
		document.body.append(viewport);
		const folding = new CellStrip(viewport, { motion: ORIGAMI_PRESENTATION.motion });
		const make = (id) => {
			const element = document.createElement("section");
			element.style.overflowY = "auto";
			const tall = document.createElement("div");
			tall.style.height = "2000px";
			element.append(tall);
			return element;
		};
		const parent = make("parent");
		const first = make("first");
		const second = make("second");
		await folding.update([{ id: "a/parent", element: parent, width: 300, visible: true }, { id: "a/parent/x", element: first, width: 300, visible: true }]);
		parent.scrollTop = 120;
		folding.update([{ id: "a/parent", element: parent, width: 300, visible: true }, { id: "a/parent/y", element: second, width: 300, visible: true }], { animate: true });
		const during = parent.scrollTop;
		document.getAnimations().forEach((animation) => animation.finish());
		await folding.finished;
		const result = { during, after: parent.scrollTop };
		folding.destroy();
		viewport.remove();
		return result;
	});
	assert.deepEqual(scroll, { during: 120, after: 120 }, "a replacement beside a cell never moves that cell, so it keeps its scroll position");
	console.log("Cell strip browser scenarios passed");
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
