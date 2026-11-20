// An open replaces whatever was open from the same place, so the log forgets that earlier open and everything opened under it.
// A Back step closes the newest group, so opens before the last Back stay where they are.
export function appendAction(log, action) {
	if (action.type !== "open") return [...log, action];
	const lastClose = log.map((earlier) => earlier.type).lastIndexOf("close");
	const gone = [];
	const inside = (from) => gone.some((path) => from === path || from.startsWith(`${path}/`));
	const kept = log.filter((earlier, index) => {
		if (index <= lastClose || earlier.type !== "open") return true;
		if ((earlier.from === action.from && earlier.destination !== action.destination) || inside(earlier.from)) {
			gone.push(`${earlier.from}/${earlier.destination}`);
			return false;
		}
		return true;
	});
	return [...kept, action];
}

export function encodeLog(log) {
	return log.map((action) => (action.type === "close" ? "b" : `o:${action.destination}@${action.from}`)).join(";");
}

export function decodeLog(hash) {
	const body = hash.replace(/^#/, "");
	if (!body) return [];
	return body.split(";").filter((token) => token.length > 0).map((token) => {
		if (token === "b") return { type: "close" };
		const match = token.match(/^o:([^@]+)@([^?]+)/);
		return match ? { type: "open", destination: match[1], from: match[2] } : { type: "open", destination: token, from: "" };
	});
}
