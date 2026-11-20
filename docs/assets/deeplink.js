export function encodeLog(log) {
	return log.map((action) => (action.type === "back" ? "b" : `o:${action.destination}@${action.from}`)).join(";");
}

export function decodeLog(hash) {
	const body = hash.replace(/^#/, "");
	if (!body) return [];
	return body.split(";").filter((token) => token.length > 0).map((token) => {
		if (token === "b") return { type: "back" };
		const match = token.match(/^o:([^@]+)@(.+)$/);
		return match ? { type: "open", destination: match[1], from: match[2] } : { type: "open", destination: token, from: "" };
	});
}
