export async function waitForElement(root, selector) {
	if (root.querySelector(selector)) return;
	await new Promise((resolve, reject) => {
		const observer = new MutationObserver(() => {
			if (!root.querySelector(selector)) return;
			clearTimeout(deadline);
			observer.disconnect();
			resolve();
		});
		const deadline = setTimeout(() => {
			observer.disconnect();
			reject(new Error(`Element did not mount: ${selector}`));
		}, 3000);
		observer.observe(root, { childList: true, subtree: true });
	});
}
