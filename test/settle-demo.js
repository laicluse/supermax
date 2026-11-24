export async function settleDemo(page) {
	await page.waitForFunction(() => window.supermaxDemo?.pending === 0 && !document.querySelector(".supermax-cell.is-loading"));
	await page.evaluate(() => new Promise((resolve, reject) => {
		const deadline = performance.now() + 5000;
		let previousFrameWasIdle = false;
		const advance = () => {
			const running = document.getAnimations().filter((animation) => animation.playState === "running" && Number.isFinite(animation.effect?.getTiming().iterations));
			for (const animation of running) animation.finish();
			const idle = running.length === 0 && window.supermaxDemo.pending === 0 && !document.querySelector(".supermax-cell.is-loading");
			if (idle && previousFrameWasIdle) resolve();
			else if (performance.now() >= deadline) reject(new Error("Demo motion did not settle"));
			else {
				previousFrameWasIdle = idle;
				requestAnimationFrame(advance);
			}
		};
		requestAnimationFrame(advance);
	}));
}
