import { pipeline } from "node:stream/promises";
import { run } from "node:test";
import { tap } from "node:test/reporters";
import { startBrowserServer } from "./browser.js";

const files = [
	"test/workspace.test.js",
	"test/workspace-demo.test.js",
	"test/folding.test.js",
	"test/cell-sweep.test.js",
	"test/variant-gutters.test.js",
	"test/renderer.test.js",
	"test/divider-drag.test.js",
	"test/variants-browser.test.js",
	"test/cell-gutters.test.js",
	"test/fold-label.test.js",
	"test/fold-stability.test.js",
	"test/workspace-package.test.js",
	"test/retention.test.js",
	"test/chain-scroll.test.js",
	"test/grow-on-focus-browser.test.js",
	"test/step-back-browser.test.js",
	"test/cell-strip.test.js",
	"test/serve-demo.test.js",
];

if (process.env.NODE_TEST_CONTEXT !== undefined) {
	throw new Error("Run the browser suite with npm run test:browser");
}

const server = await startBrowserServer();
const previousEndpoint = process.env.SUPERMAX_TEST_BROWSER;
try {
	process.env.SUPERMAX_TEST_BROWSER = server.wsEndpoint();
	const results = run({ files, concurrency: 4 });
	results.on("test:fail", ({ todo }) => {
		if (!todo) process.exitCode = 1;
	});
	await pipeline(results, tap, process.stdout, { end: false });
} finally {
	if (previousEndpoint === undefined) delete process.env.SUPERMAX_TEST_BROWSER;
	else process.env.SUPERMAX_TEST_BROWSER = previousEndpoint;
	await server.close();
}
