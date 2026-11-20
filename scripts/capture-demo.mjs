import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serveDocs } from "../test/serve-docs.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(repoRoot, process.argv[2] ?? "docs/assets/captures");
const captures = [
	{ name: "three-rows", hash: "o:album:coast@albums;o:coast:photo:a@albums/album:coast/coast:thumbnails;o:coast:photo:b@albums/album:coast/coast:map;o:coast:photo:c@albums/album:coast/coast:people" },
	{ name: "short-frame", hash: "o:album:coast@albums;o:coast:photo:c@albums/album:coast/coast:people", sizes: [[960, 640], [420, 400]] },
	{ name: "lab-rejected", hash: "o:album:coast@albums;o:album:lab-over@albums" },
];

const server = await serveDocs();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
	await mkdir(outputDir, { recursive: true });
	const page = await browser.newPage({ viewport: { width: 1720, height: 860 }, deviceScaleFactor: 1 });
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
	for (const capture of captures) {
		await page.goto("about:blank");
		await page.goto(`${server.url}/#${capture.hash}`);
		await page.waitForSelector(".supermax-workspace");
		if (capture.sizes) await page.evaluate((sizes) => window.supermaxDemo.resize(sizes), capture.sizes);
		await page.waitForTimeout(400);
		const path = resolve(outputDir, `${capture.name}.png`);
		await page.locator(".frames").screenshot({ path });
		console.log(path);
	}
	if (errors.length > 0) {
		console.error(errors.join("\n"));
		process.exitCode = 1;
	}
} finally {
	await browser.close();
	await server.close();
}
