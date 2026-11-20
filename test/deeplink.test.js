import assert from "node:assert/strict";
import { decodeLog, encodeLog } from "../docs/assets/deeplink.js";
import { scenario } from "./scenario.js";

scenario("the codec round-trips opens and backs", () => {
	const log = [
		{ type: "open", destination: "album:coast", from: "albums" },
		{ type: "open", destination: "coast:photo:a", from: "albums/album:coast/coast:thumbnails" },
		{ type: "back" },
	];
	assert.equal(encodeLog(log), "o:album:coast@albums;o:coast:photo:a@albums/album:coast/coast:thumbnails;b");
	assert.deepEqual(decodeLog(`#${encodeLog(log)}`), log);
});

scenario("an empty or bare hash is an empty log", () => {
	assert.deepEqual(decodeLog(""), []);
	assert.deepEqual(decodeLog("#"), []);
});

scenario("malformed tokens stay in the log as opens the model can reject", () => {
	assert.deepEqual(decodeLog("#constructor;o:constructor@albums"), [
		{ type: "open", destination: "constructor", from: "" },
		{ type: "open", destination: "constructor", from: "albums" },
	]);
});

console.log("Deeplink codec scenarios passed");
