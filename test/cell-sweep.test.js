import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { serveDocs } from "./serve-docs.js";

const helper = fileURLToPath(new URL("../packages/supermax/bin/cell-sweep.mjs", import.meta.url));
const execute = promisify(execFile);
const run = (...args) => execute(process.execPath, [helper, ...args]).then((result) => ({ code: 0, ...result }), (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
const frameOf = async (file) => (await execute("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file])).stdout.trim();

test("the cell-sweep helper records every cell of a route alone, from its smallest to its largest width", async () => {
	const server = await serveDocs();
	const out = mkdtempSync(join(tmpdir(), "cell-sweep-test-"));
	try {
		const result = await run(`${server.url}/test/fixtures/sweep.html`, "--out", out, "--height", "760", "--step", "40", "--elastic-max", "600");
		assert.equal(result.code, 0, result.stderr);
		const { clips, splits, missed } = JSON.parse(readFileSync(join(out, "sweeps.json"), "utf8"));
		assert.deepEqual(clips.map((clip) => [clip.title, clip.declared, clip.reached]), [
			["Menu", { min: 80, max: 240 }, { min: 80, max: 240 }],
			["Lanes", { min: 200, max: 420 }, { min: 200, max: 420 }],
			["Summary", { min: 200, max: 420 }, { min: 200, max: 420 }],
			["Detail", { min: 240, max: "*" }, { min: 240, max: 600 }],
		], "every cell with a width of its own, also the ones without a divider, down to the smaller form that only shows when room is scarce");
		assert.deepEqual(splits.map((split) => split.title), ["Board"], "a split has no width of its own");
		assert.deepEqual(missed, []);
		assert.equal(await frameOf(join(out, clips[0].file)), "240,760", "a clip is as wide as its cell at its largest and shows nothing beside it");
		assert.equal((await frameOf(join(out, clips[2].file))).split(",")[0], "420");
		assert.equal(result.stdout.trim().split("\n").length, clips.length, "one line per clip");

		const none = await run(`${server.url}/test/fixtures/sweep.html`, "--out", join(out, "none"), "--only", "no such cell");
		assert.equal(none.code, 1);
		assert.match(none.stderr, /No cell of the route .* matches "no such cell"/);
		assert.deepEqual(JSON.parse(readFileSync(join(out, "none", "sweeps.json"), "utf8")).clips, [], "a failed run leaves an empty manifest");
	} finally {
		rmSync(out, { recursive: true, force: true });
		await server.close();
	}
});

test("the cell-sweep helper names a missing URL and a page that did not load", async () => {
	const out = mkdtempSync(join(tmpdir(), "cell-sweep-test-"));
	try {
		const usage = await run("--out", out);
		assert.equal(usage.code, 1);
		assert.match(usage.stderr, /^Usage: cell-sweep\.mjs <url>/);
		const unreachable = await run("http://127.0.0.1:9/", "--out", out);
		assert.equal(unreachable.code, 1);
		assert.match(unreachable.stderr, /did not load: net::ERR_/);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});
