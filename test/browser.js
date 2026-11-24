import { chromium } from "playwright";

const options = { channel: "chrome", headless: true };

export function startBrowserServer() {
	return chromium.launchServer({ ...options, host: "127.0.0.1" });
}

export async function openBrowser() {
	const endpoint = process.env.SUPERMAX_TEST_BROWSER;
	if (!endpoint) return chromium.launch(options);

	const browser = await chromium.connect(endpoint, { timeout: 5000 });
	return {
		newPage: (options) => browser.newPage(options),
		async close() {
			try {
				await Promise.all(browser.contexts().map((context) => context.close()));
			} finally {
				await browser.close();
			}
		},
	};
}
