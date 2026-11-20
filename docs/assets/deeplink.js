export function encodeLog(log) {
	return log.map((action) => {
		if (action.type === "close") return "b";
		const hint = action.hint ? `?${new URLSearchParams(Object.entries(action.hint).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]))}` : "";
		return `o:${action.destination}@${action.from}${hint}`;
	}).join(";");
}

export function decodeLog(hash) {
	const body = hash.replace(/^#/, "");
	if (!body) return [];
	return body.split(";").filter((token) => token.length > 0).map((token) => {
		if (token === "b") return { type: "close" };
		const match = token.match(/^o:([^@]+)@([^?]+)(?:\?(.*))?$/);
		if (!match) return { type: "open", destination: token, from: "" };
		const action = { type: "open", destination: match[1], from: match[2] };
		if (match[3]) {
			const hint = Object.fromEntries(new URLSearchParams(match[3]));
			for (const key of ["min", "max", "preferred"]) {
				if (!(key in hint)) continue;
				const value = Number(hint[key]);
				if (Number.isFinite(value) && value > 0) hint[key] = value;
				else delete hint[key];
			}
			action.hint = hint;
		}
		return action;
	});
}
