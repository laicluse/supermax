import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:os";
import { startBrowserServer } from "./browser.js";

const commands = [
	["test/cell-strip.test.js"],
	["test/serve-demo.test.js"],
	[
		"--test", "--test-concurrency=1",
		"test/renderer.test.js",
		"test/divider-drag.test.js",
		"test/variants-browser.test.js",
		"test/variant-gutters.test.js",
		"test/cell-gutters.test.js",
		"test/fold-label.test.js",
		"test/fold-stability.test.js",
		"test/folding.test.js",
		"test/workspace.test.js",
		"test/workspace-package.test.js",
		"test/retention.test.js",
		"test/chain-scroll.test.js",
		"test/cell-sweep.test.js",
		"test/grow-on-focus-browser.test.js",
	],
];

const server = await startBrowserServer();
try {
	const env = { ...process.env, SUPERMAX_TEST_BROWSER: server.wsEndpoint() };
	for (const args of commands) {
		const child = spawn(process.execPath, args, { env, stdio: "inherit" });
		const [status, signal] = await once(child, "exit");
		if (status === 0) continue;
		process.exitCode = status ?? (128 + constants.signals[signal]);
		break;
	}
} finally {
	await server.close();
}
