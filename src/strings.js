export const DEFAULT_STRINGS = Object.freeze({
	navigation: () => "Workspace navigation",
	up: (title) => `Show ${title}`,
	crumb: (title) => `Go to ${title}`,
	loading: (title) => `Loading ${title}`,
	loadFailed: (title) => `${title} could not load.`,
	retry: () => "Retry",
	resize: (title) => `Resize ${title}`,
	resetSize: (title) => `Reset size of ${title}`,
	closeModal: (title) => `Close ${title}`,
	modalFrom: (title) => `From ${title}`,
	modalSourceClosed: () => "Its source has closed",
	notices: () => "Notices",
	noticeShow: (title) => `Show ${title}`,
	noticeSource: (title) => `${title}:`,
	noticeSourceClosed: (title) => `${title} (not open):`,
	closedCell: () => "A closed cell",
	dismissNotice: (message) => `Dismiss: ${message}`,
	peek: (title) => `Peek ${title}`,
	peekDialog: (title) => `${title}, peek`,
	closePeek: () => "Close peek",
});

export function resolveStrings(overrides = {}) {
	for (const [key, value] of Object.entries(overrides)) {
		if (!Object.hasOwn(DEFAULT_STRINGS, key)) throw new TypeError(`Unknown Supermax string "${key}"; known strings are ${Object.keys(DEFAULT_STRINGS).join(", ")}`);
		if (typeof value !== "function") throw new TypeError(`Supermax string "${key}" must be a function that returns text`);
	}
	return Object.freeze({ ...DEFAULT_STRINGS, ...overrides });
}
