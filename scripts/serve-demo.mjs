import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import { serveDocs } from "../test/serve-docs.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const build = () => new Promise((done) => spawn(process.execPath, ["scripts/build-docs.mjs"], { cwd: repoRoot, stdio: "inherit" }).on("exit", done));

await build();
let pending = null;
watch(new URL("../src/", import.meta.url), { recursive: true }, () => {
	clearTimeout(pending);
	pending = setTimeout(build, 100);
});
const { url } = await serveDocs({ port: Number(process.env.PORT ?? 8260), live: true });
console.log(`Supermax demo at ${url}`);
