import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { serveDocs } from "./serve-docs.js";

test("moving split and row seams expose one gutter throughout responsive exchanges", async () => {
	const server = await serveDocs();
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		for (const scale of [1, 2]) for (const presentation of ["veil", "origami", "plain"]) for (const gutter of [0, 1, 4]) {
			const page = await browser.newPage({ viewport: { width: 800, height: 760 }, deviceScaleFactor: scale, colorScheme: "dark" });
			await page.goto(`${server.url}/?delay=0&presentation=${presentation}`);
			await page.waitForFunction(() => window.supermaxDemo?.frames.length === 2);
			await page.addStyleTag({ content: ".topbar,.controls,.frame-wrapper:first-child{display:none}.demo{display:block;padding:16px}" });
			await page.evaluate(() => window.supermaxDemo.resize([[255, 624], [255, 616]]));
			await page.waitForFunction(() => window.supermaxDemo.frames[1].workspace.layout.width === 255);
			await page.evaluate(async ({ gutter, presentation }) => {
				await window.supermaxDemo.replay([{ type: "open", destination: "album:coast", from: "albums" }]);
				window.subject = window.supermaxDemo.frames[1];
				subject.workspace.observer.disconnect();
				subject.workspace.element.style.setProperty("--supermax-gutter", `${gutter}px`);
				if (presentation === "plain") subject.workspace.setPresentation({ name: "plain" });
				window.resizeSubject = (width, animate) => {
					subject.box.style.width = `${width}px`;
					subject.workspace.navigator.resize({ width, height: 616 });
					subject.workspace.render({ animate });
				};
				resizeSubject(549, false);
			}, { gutter, presentation });
			for (const width of gutter === 1 ? [479, 549, 479] : [479, 549]) {
				await page.evaluate((width) => resizeSubject(width, true), width);
				for (const fraction of gutter === 1 ? [0, .1, .25, .5, .75, .9, 1] : [0, .5, 1]) {
					const points = await page.evaluate((fraction) => {
						const workspace = subject.workspace;
						for (const { strip } of workspace.chains.values()) for (const animation of strip.geometry) {
							animation.pause(); const timing = animation.effect.getTiming(); animation.currentTime = timing.delay + timing.duration * fraction;
						}
						for (const row of workspace.rows.values()) if (row.animation) {
							row.animation.pause(); const timing = row.animation.effect.getTiming(); row.animation.currentTime = timing.delay + timing.duration * fraction;
						}
						for (const { strip } of workspace.chains.values()) strip.step();
						const strip = workspace.chains.get("albums").strip;
						const split = strip.entries.find((entry) => entry.id === "albums/album:coast");
						const room = strip.boxOf(split).getBoundingClientRect();
						const points = [10, 150, 600].map((offset) => ({ axis: "x", x: room.left, y: room.top + offset, name: `split at ${offset}` }));
						const header = workspace.cells.get(split.id).header;
						points.push({ axis: "y", x: room.left + room.width / 2, y: header.getBoundingClientRect().bottom - parseFloat(getComputedStyle(header).borderBottomWidth), name: "title seam" });
						for (const row of workspace.rows.values()) if (!row.leading) points.push({ axis: "y", x: room.left + room.width / 2, y: row.element.getBoundingClientRect().top, name: "row seam" });
						return points;
					}, fraction);
					if (gutter === 0) points.splice(0, 1);
					const screenshot = (await page.screenshot()).toString("base64");
					const pixels = await page.evaluate(async ({ screenshot, points, scale, gutter }) => {
						const image = new Image(); image.src = `data:image/png;base64,${screenshot}`; await image.decode();
						const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
						const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
						return points.map((point) => {
							let coverage = 0;
							const edge = point.axis === "x" ? point.x : point.y;
							for (let pixel = Math.round(edge * scale); pixel < Math.round(edge * scale) + Math.max(1, gutter * scale); pixel += 1) {
								const red = context.getImageData(point.axis === "x" ? pixel : Math.floor(point.x * scale), point.axis === "y" ? pixel : Math.floor(point.y * scale), 1, 1).data[0];
								coverage += (red - 23) / (201 - 23) / scale;
							}
							return { ...point, coverage };
						});
					}, { screenshot, points, scale, gutter });
					for (const point of pixels) assert.ok(Math.abs(point.coverage - gutter) < .03, `${presentation}, DPR ${scale}, gutter ${gutter}, width ${width}, progress ${fraction}, ${point.name}: ${point.coverage} CSS pixels of canvas`);
				}
				await page.evaluate(async () => {
					for (const animation of document.getAnimations()) animation.finish();
					await Promise.all([...subject.workspace.chains.values()].map(({ strip }) => strip.finished));
				});
			}
			await page.close();
		}
	} finally { await browser.close(); await server.close(); }
});
