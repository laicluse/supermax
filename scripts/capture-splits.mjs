import assert from "node:assert/strict";
import { chromium } from "playwright";
import { serveDocs } from "../test/serve-docs.js";

const server = await serveDocs();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 1200, height: 650 }, deviceScaleFactor: 1 });
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`${server.url}/blank`);
	await page.evaluate(async () => {
		const { Navigator, Workspace } = await import("/src/index.js");
		const sheet = document.createElement("link");
		sheet.rel = "stylesheet";
		sheet.href = "/src/workspace.css";
		document.head.append(sheet);
		await new Promise((resolve) => (sheet.onload = resolve));
		const style = document.createElement("style");
		style.textContent =
			"body{margin:0;padding:24px;background:#edf0ed;color:#263439;font:14px system-ui}h1{font-size:20px;margin:0 0 8px}p{line-height:1.5}#host{height:500px}[data-supermax-content]{padding:16px}textarea{box-sizing:border-box;width:100%;height:120px;padding:12px;font:inherit}h2{font-size:16px;margin:0 0 12px}";
		document.head.append(style);
		const heading = document.createElement("h1");
		heading.textContent = "Two independent row stacks, one workspace";
		const explanation = document.createElement("p");
		explanation.textContent = "Collection and writing each keep their own row heights. The reading list spans the full height between them.";
		const host = document.createElement("div");
		host.id = "host";
		document.body.append(heading, explanation, host);
		const navigator = new Navigator({
			root: "library",
			minViewportHeight: 220,
			destinations: {
				library: { title: "Library", min: 90, max: 90 },
				sources: {
					title: "Collection",
					header: "title",
					rows: [
						{ destination: "chapters", minHeight: 160, maxHeight: "*", preferredHeight: 300 },
						{ destination: "references", minHeight: 120, maxHeight: 180 }
					]
				},
				chapters: { title: "Chapters", min: 200, max: 240 },
				references: { title: "References", min: 200, max: 240 },
				reading: { title: "Reading list", header: "title", min: 240, max: 300, placement: "beside-split" },
				writing: {
					title: "Writing",
					header: "title",
					rows: [
						{ destination: "draft", minHeight: 180, maxHeight: "*", preferredHeight: 320 },
						{ destination: "checklist", minHeight: 120, maxHeight: 160 }
					]
				},
				draft: { title: "Draft", min: 280, max: "*", preferred: 500, zoomable: true },
				checklist: { title: "Checklist", min: 280, max: "*", preferred: 500 }
			}
		});
		navigator.sync(["library", "sources", "chapters", "reading", "writing", "draft"]);
		navigator.startRows("library/sources", "library/sources/chapters");
		navigator.startRows("library/sources/chapters/reading/writing", "library/sources/chapters/reading/writing/draft");
		const workspace = new Workspace(host, {
			navigator,
			content(occurrence, definition) {
				if (definition.rows) return {};
				const element = document.createElement("section");
				const title = document.createElement("h2");
				title.textContent = occurrence.title;
				const text = document.createElement("p");
				text.textContent =
					{
						chapters: "Morning light · Shoreline textures · Field observations",
						references: "Maps, photographs and notes stay open here.",
						reading: "1. The edge of the coast\n2. Notes from the field\n3. A changing shoreline",
						checklist: "✓ Keep the source nearby\n✓ Preserve the working draft"
					}[occurrence.destination] ?? "";
				text.style.whiteSpace = "pre-line";
				if (!["sources", "writing", "reading"].includes(occurrence.destination)) element.append(title);
				element.append(text);
				if (occurrence.destination === "draft") {
					const input = document.createElement("textarea");
					input.value = "My draft stays here while the workspace changes.";
					element.append(input);
				}
				return { element };
			}
		});
		window.splitProof = { workspace, host, draft: document.querySelector("textarea") };
	});
	await page.waitForTimeout(300);
	await page.locator("body").screenshot({ path: "docs/assets/captures/independent-splits.png" });
	await page.evaluate(() => {
		window.splitProof.host.style.height = "220px";
	});
	await page.waitForTimeout(700);
	assert.equal(await page.evaluate(() => [...window.splitProof.workspace.layout.rows.values()].filter((row) => row.folded).length), 2);
	await page.locator("body").screenshot({ path: "docs/assets/captures/independent-splits-short.png" });
	await page.setViewportSize({ width: 420, height: 650 });
	await page.waitForTimeout(700);
	await page.evaluate(() => window.splitProof.workspace.zoom("library/sources/chapters/reading/writing/draft", { animate: false }));
	await page.evaluate(() => window.splitProof.workspace.requestUp());
	await page.waitForTimeout(500);
	assert.equal(
		await page.evaluate(
			() =>
				document.querySelector("textarea") === window.splitProof.draft &&
				window.splitProof.draft.value === "My draft stays here while the workspace changes."
		),
		true
	);
	assert.deepEqual(errors, []);
	console.log("Independent splits retain their draft through short and narrow allocation and zoom recovery.");
} finally {
	await browser.close();
	await server.close();
}
