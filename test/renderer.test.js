import assert from "node:assert/strict";
import { test } from "node:test";
import { openBrowser } from "./browser.js";
import { serveDocs } from "./serve-docs.js";

test("notice action progress fills its button and clears when the action changes", async () => {
	const server = await serveDocs();
	const browser = await openBrowser();
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		await page.evaluate(async () => {
			const { Navigator, Workspace } = await import("/src/index.js");
			const sheet = document.createElement("link");
			sheet.rel = "stylesheet";
			sheet.href = "/src/workspace.css";
			document.head.append(sheet);
			await new Promise(resolve => sheet.onload = resolve);
			const host = document.createElement("div");
			host.style.cssText = "width:600px;height:400px";
			document.body.append(host);
			window.workspace = new Workspace(host, { navigator: new Navigator({ root: "home", minViewportHeight: 100, destinations: { home: { title: "Home", min: 200, max: "*", preferred: 300 } } }), content: () => document.createElement("main") });
			window.workspace.notify({ id: "countdown", scope: "workspace", persistent: true, message: "Starting automatically", action: { label: "Cancel · 3s", progress: 0.4, run() {} } });
		});
		const button = page.getByRole("button", { name: "Cancel · 3s" });
		assert.match(await button.evaluate(el => getComputedStyle(el).backgroundImage), /40%/);
		await page.evaluate(() => window.workspace.updateNotice("countdown", { action: { label: "Start server", run() {} } }));
		assert.equal(await page.getByRole("button", { name: "Start server" }).evaluate(el => getComputedStyle(el).backgroundImage), "none");
	} finally {
		await browser.close();
		await server.close();
	}
});

test("host renderers own paint and native controls while shell retains navigation and lifecycle", async () => {
	const server = await serveDocs();
	const browser = await openBrowser();
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		const result = await page.evaluate(async () => {
			const { Navigator, Workspace, DEFAULT_RENDERER } = await import("/src/index.js");
			const sheet = document.createElement("link");
			sheet.rel = "stylesheet";
			sheet.href = "/src/workspace.css";
			document.head.append(sheet);
			await new Promise((resolve) => (sheet.onload = resolve));
			const host = document.createElement("div");
			host.style.cssText = "width:360px;height:320px";
			document.body.append(host);
			const events = [];
			const views = {};
			let loads = 0;
			const renderer = {
				canvas({ root }) {
					root.style.background = "linear-gradient(red, blue)";
				},
				cell({ root, state }) {
					root.style.background = "linear-gradient(45deg, ivory, tan)";
					events.push(["cell", state.occurrence]);
					return {
						dispose() {
							events.push(["disposed", state.occurrence]);
						}
					};
				},
				header({ root, state, actions, slots }) {
					const title = document.createElement("b");
					const back = document.createElement("button");
					back.textContent = "Return";
					root.append(back, title, slots.utilities);
					actions.navigation.attach(back);
					views[state.occurrence] = { root, back, title };
					return {
						update(next) {
							title.textContent = next.title;
						}
					};
				},
				error({ root, state, actions }) {
					const button = document.createElement("button");
					button.textContent = "Try again";
					root.append(button);
					actions.retry.attach(button);
				},
				notice({ root, state, actions }) {
					const text = document.createElement("p");
					const run = document.createElement("button");
					run.textContent = "Run";
					const dismiss = document.createElement("button");
					dismiss.textContent = "Dismiss";
					root.append(text, run, dismiss);
					actions.action.attach(run);
					actions.dismiss.attach(dismiss);
					actions.show.attach(document.createElement("button"));
					root.append(actions.show.element);
					return {
						update(next) {
							text.textContent = next.message;
						}
					};
				},
				veil({ root }) {
					root.style.background = "repeating-linear-gradient(45deg,transparent,transparent 3px,#2224 3px,#2224 6px)";
				}
			};
			const navigator = new Navigator({
				root: "root",
				minViewportHeight: 100,
				chrome: { header: 40 },
				destinations: {
					root: { title: "Root", min: 200, max: 200, header: "title" },
					work: { title: "Work", min: 200, max: "*", preferred: 300, header: "title" },
					bad: { title: "Bad", min: 200, max: "*", preferred: 300 }
				}
			});
			const workspace = new Workspace(host, {
				navigator,
				renderer,
				content(occurrence) {
					loads++;
					if (occurrence.destination === "bad" && loads < 4) throw Error("offline");
					const element = document.createElement("input");
					element.value = "draft";
					return { element };
				}
			});
			workspace.sync(["root", "work"], { animate: false, origin: null });
			const back = views["root/work"].back;
			const work = workspace.cells.get("root/work");
			const input = work.slot.handle.element;
			input.value = "retained";
			const height = work.header.getBoundingClientRect().height + parseFloat(getComputedStyle(work.header).marginBottom);
			workspace.setTitle("root/work", "Changed");
			const title = views["root/work"].title.textContent;
			back.click();
			await Promise.all([...workspace.chains.values()].map(({ strip }) => strip.finished));
			const revealed = workspace.findCell("root").full;
			workspace.notify({
				id: "job",
				scope: "workspace",
				kind: "action",
				message: "Before",
				action: {
					label: "Run",
					run() {
						return new Promise((resolve) => (window.finishJob = resolve));
					}
				}
			});
			const notice = workspace.notices.notices.get("job");
			const original = notice.element;
			workspace.updateNotice("job", { message: "After" });
			const same = notice.element === original;
			notice.element.querySelector("button").click();
			const busy = notice.busy;
			window.finishJob();
			await Promise.resolve();
			await Promise.resolve();
			workspace.dismiss("job", "resolved");
			workspace.destroy();
			return { hasDefaults: typeof DEFAULT_RENDERER.header === "function", height, title, revealed, same, busy, events, input: input.value };
		});
		assert.equal(result.hasDefaults, true);
		assert.equal(result.height, 40);
		assert.equal(result.title, "Changed");
		assert.equal(result.revealed, true);
		assert.equal(result.same, true);
		assert.equal(result.busy, true);
		assert.equal(result.input, "retained");
		assert.ok(result.events.some(([kind]) => kind === "disposed"));
	} finally {
		await browser.close();
		await server.close();
	}
});

test("custom modal, loading and frustum paint keep geometry and retry under shell control", async () => {
	const server = await serveDocs();
	const browser = await openBrowser();
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		const result = await page.evaluate(async () => {
			const { Navigator, Workspace, DEFAULT_RENDERER } = await import("/src/index.js");
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = "/src/workspace.css";
			document.head.append(link);
			await new Promise((resolve) => (link.onload = resolve));
			const host = document.createElement("div");
			host.style.cssText = "width:600px;height:400px";
			document.body.append(host);
			const hits = {};
			let attempt = 0;
			let load;
			const navigator = new Navigator({
				root: "root",
				minViewportHeight: 100,
				destinations: { root: { title: "Root", min: 100, max: "*", preferred: 300 } }
			});
			const renderer = {
				modal(context) {
					hits.modal = (hits.modal ?? 0) + 1;
					const { root, slots, actions, dragHandle } = context;
					const bar = document.createElement("div");
					const close = document.createElement("button");
					close.textContent = "Finish";
					bar.append(close, slots.utilities);
					actions.close.attach(close);
					root.append(bar, slots.body);
					dragHandle(bar);
					root.style.background = "rgb(10, 20, 30)";
					return {
						dispose() {
							hits.disposed = true;
						}
					};
				},
				frustum({ root }) {
					hits.frustum = (hits.frustum ?? 0) + 1;
					root.setAttribute("fill", "purple");
					return {
						paint({ progress }) {
							hits.progress = progress;
						}
					};
				},
				loading({ root }) {
					root.textContent = "Pending";
					hits.loading = true;
				},
				error({ root, actions }) {
					const retry = document.createElement("button");
					retry.textContent = "Recover";
					actions.retry.attach(retry);
					root.append(retry);
				}
			};
			const workspace = new Workspace(host, {
				navigator,
				renderer,
				content() {
					attempt++;
					if (attempt === 1) return new Promise((resolve) => (load = resolve));
					if (attempt === 2) throw Error("offline");
					const element = document.createElement("p");
					element.textContent = "Loaded";
					return { element };
				}
			});
			const pending = host.textContent.includes("Pending");
			load({ element: document.createElement("p") });
			await Promise.resolve();
			workspace.reload(() => true);
			const retry = host.querySelector(".supermax-error button");
			retry.click();
			const recovered = host.textContent.includes("Loaded");
			workspace.openModal(
				{
					title: "Modal",
					content() {
						return { element: document.createElement("input") };
					}
				},
				{ from: "root" }
			);
			workspace.drawOrigins();
			const entrance = workspace.modal.entrance;
			entrance.finish();
			await entrance.finished;
			workspace.drawOrigins();
			const handoff = hits.progress;
			await new Promise((resolve) => requestAnimationFrame(resolve));
			workspace.drawOrigins();
			const faces = [...host.querySelectorAll(".supermax-frustum-face")];
			const count = hits.frustum;
			const points = faces.map((face) => face.getAttribute("points"));
			workspace.drawOrigins();
			const stable = hits.frustum === count;
			const colours = faces.every((face) => face.getAttribute("fill") === "purple");
			host.querySelector(".supermax-modal button").click();
			for (const animation of document.getAnimations()) animation.finish();
			await Promise.resolve();
			workspace.destroy();
			return { pending, recovered, stable, colours, points, hits, handoff };
		});
		assert.equal(result.pending, true);
		assert.equal(result.recovered, true);
		assert.equal(result.stable, true);
		assert.equal(result.colours, true);
		assert.equal(result.handoff, 1, "frustum geometry remains complete after the modal entrance finishes");
		assert.ok(result.points.length > 0);
		assert.ok(result.points.every(Boolean));
		assert.equal(result.hits.disposed, true);
	} finally {
		await browser.close();
		await server.close();
	}
});

test("a transparent host veil conceals foreground on the shell timeline while material stays painted", async () => {
	const server = await serveDocs();
	const browser = await openBrowser();
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		const result = await page.evaluate(async () => {
			const { Navigator, Workspace, VEIL_PRESENTATION } = await import("/src/index.js");
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = "/src/workspace.css";
			document.head.append(link);
			await new Promise((resolve) => (link.onload = resolve));
			const host = document.createElement("div");
			host.style.cssText = "width:700px;height:300px";
			document.body.append(host);
			const navigator = new Navigator({
				root: "root",
				minViewportHeight: 100,
				destinations: { root: { title: "Root", min: 100, max: 100 }, work: { title: "Work", min: 200, max: "*", preferred: 400 } }
			});
			const workspace = new Workspace(host, {
				navigator,
				presentation: { ...VEIL_PRESENTATION, name: "alternate" },
				renderer: {
					cell({ root }) {
						root.style.background = "rgb(40, 50, 60)";
					},
					veil({ root }) {
						root.style.background = "transparent";
					}
				},
				content() {
					return { element: document.createElement("input") };
				}
			});
			workspace.navigate("work", { from: "root", origin: null });
			const entry = workspace.cells.get("root/work");
			const deadline = performance.now() + 2000;
			const motionsForCell = () => host.getAnimations({ subtree: true }).filter((animation) => entry.element.contains(animation.effect?.target));
			let motions = motionsForCell();
			while (!motions.some((animation) => animation.effect.target === entry.body)) {
				if (performance.now() >= deadline) throw new Error("The work cell did not start its content motion");
				await new Promise((resolve) => requestAnimationFrame(resolve));
				motions = motionsForCell();
			}
			await Promise.all(motions.map((animation) => animation.ready));
			motions = motionsForCell();
			const snapshots = [];
			for (const fraction of [0, 1]) {
				for (const animation of motions) {
					animation.pause();
					const timing = animation.effect.getTiming();
					animation.currentTime = timing.delay + timing.duration * fraction;
				}
				snapshots.push({
					opacity: Number(getComputedStyle(entry.body).opacity),
					material: getComputedStyle(entry.materialPart.root).backgroundColor
				});
			}
			for (const animation of motions) animation.finish();
			workspace.destroy();
			return snapshots;
		});
		assert.equal(result[0].opacity, 0);
		assert.equal(result[1].opacity, 1);
		assert.equal(result[0].material, "rgb(40, 50, 60)");
	} finally {
		await browser.close();
		await server.close();
	}
});

test("renderer configuration faults are explicit and leave no mounted workspace", async () => {
	const server = await serveDocs();
	const browser = await openBrowser();
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		const reports = await page.evaluate(async () => {
			const { Navigator, Workspace } = await import("/src/index.js");
			const reports = [];
			for (const renderer of [
				{ heder() {} },
				{
					header({ root, slots, actions }) {
						root.append(slots.utilities);
						actions.navigation.attach(document.createElement("div"));
					}
				},
				{
					header({ root, slots }) {
						root.append(slots.utilities);
					}
				}
			]) {
				const host = document.createElement("div");
				host.style.cssText = "width:300px;height:200px";
				document.body.append(host);
				const navigator = new Navigator({
					root: "root",
					minViewportHeight: 100,
					destinations: { root: { title: "Root", min: 100, max: "*", preferred: 200, header: "title" } }
				});
				let failure;
				try {
					new Workspace(host, {
						navigator,
						renderer,
						content() {
							return { element: document.createElement("p") };
						}
					});
				} catch (error) {
					failure = error.name;
				}
				reports.push({ failure, children: host.childElementCount });
				host.remove();
			}
			return reports;
		});
		for (const report of reports) {
			assert.equal(report.failure, "SupermaxRendererError");
			assert.equal(report.children, 0);
		}
	} finally {
		await browser.close();
		await server.close();
	}
});

test("native action bindings preserve availability, busy focus and disposal across host button replacement", async () => {
	const server = await serveDocs();
	const browser = await openBrowser();
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		const result = await page.evaluate(async () => {
			const { mountPart } = await import("/src/renderer.js");
			const root = document.createElement("div");
			document.body.append(root);
			let calls = 0,
				detach,
				button;
			const workspace = {
				document,
				renderParts: new Set(),
				renderer: {
					header({ root, actions }) {
						button = document.createElement("button");
						root.append(button);
						detach = actions.go.attach(button);
					}
				}
			};
			const part = mountPart(
				workspace,
				"header",
				root,
				{ actions: { go: { label: "Go" } } },
				{
					actions: {
						go: {
							run() {
								calls++;
							}
						}
					}
				}
			);
			button.click();
			const initial = calls;
			part.update({ actions: { go: { offered: false, label: "Go" } } });
			button.hidden = false;
			button.click();
			const unavailable = calls;
			part.update({ actions: { go: { busy: true, label: "Go" } } });
			button.focus();
			button.click();
			const busy = { calls, focused: document.activeElement === button, disabled: button.disabled, aria: button.getAttribute("aria-disabled") };
			part.update({ actions: { go: { enabled: false, label: "Go" } } });
			button.click();
			const disabled = button.disabled;
			part.update({ actions: { go: { label: "Go" } } });
			let duplicate;
			try {
				part.actions.go.attach(document.createElement("button"));
			} catch (error) {
				duplicate = error.name;
			}
			detach();
			const old = button;
			button = document.createElement("button");
			root.append(button);
			part.actions.go.attach(button);
			old.click();
			button.click();
			const replacement = calls;
			part.dispose();
			button.click();
			let late;
			try {
				part.actions.go.attach(document.createElement("button"));
			} catch (error) {
				late = error.name;
			}
			root.remove();
			return { initial, unavailable, busy, disabled, duplicate, replacement, disposed: calls, late, parts: workspace.renderParts.size };
		});
		assert.equal(result.initial, 1);
		assert.equal(result.unavailable, 1);
		assert.deepEqual(result.busy, { calls: 1, focused: true, disabled: false, aria: "true" });
		assert.equal(result.disabled, true);
		assert.equal(result.duplicate, "SupermaxRendererError");
		assert.equal(result.replacement, 2);
		assert.equal(result.disposed, 2);
		assert.equal(result.late, "SupermaxRendererError");
		assert.equal(result.parts, 0);
	} finally {
		await browser.close();
		await server.close();
	}
});

test("lazy renderer faults clean up notice records and staged modal parts", async () => {
	const server = await serveDocs();
	const browser = await openBrowser();
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		const result = await page.evaluate(async () => {
			const { Navigator, Workspace } = await import("/src/index.js");
			const host = document.createElement("div");
			host.style.cssText = "width:400px;height:300px";
			document.body.append(host);
			const navigator = new Navigator({
				root: "root",
				minViewportHeight: 100,
				destinations: { root: { title: "Root", min: 100, max: "*", preferred: 200 } }
			});
			const workspace = new Workspace(host, {
				navigator,
				renderer: {
					notice() {},
					backdrop() {
						return Promise.resolve({});
					}
				},
				content() {
					return { element: document.createElement("p") };
				}
			});
			const before = workspace.renderParts.size;
			let noticeFailure, modalFailure;
			try {
				workspace.notify({ message: "Notice", scope: "workspace" });
			} catch (error) {
				noticeFailure = error.name;
			}
			const notices = workspace.notices.notices.size;
			const cards = workspace.notices.region.children.length;
			try {
				workspace.openModal(
					{
						title: "Modal",
						content() {
							return { element: document.createElement("p") };
						}
					},
					{ from: "root" }
				);
			} catch (error) {
				modalFailure = error.name;
			}
			const after = workspace.renderParts.size;
			workspace.destroy();
			return { noticeFailure, modalFailure, notices, cards, before, after };
		});
		assert.equal(result.noticeFailure, "SupermaxRendererError");
		assert.equal(result.modalFailure, "SupermaxRendererError");
		assert.equal(result.notices, 0);
		assert.equal(result.cards, 0);
		assert.equal(result.after, result.before);
	} finally {
		await browser.close();
		await server.close();
	}
});

test("renderer faults dispose frustum faces and updates while preserving an existing modal", async () => {
	const server = await serveDocs();
	const browser = await openBrowser();
	try {
		const page = await browser.newPage();
		await page.goto(`${server.url}/blank`);
		const result = await page.evaluate(async () => {
			const { Navigator, Workspace, DEFAULT_RENDERER } = await import("/src/index.js");
			const { mountPart } = await import("/src/renderer.js");
			const { frustumOrigin, disposeOrigin } = await import("/src/origin.js");
			const host = document.createElement("div");
			host.style.cssText = "width:400px;height:300px";
			document.body.append(host);
			let broken = false;
			const navigator = new Navigator({
				root: "root",
				minViewportHeight: 100,
				destinations: { root: { title: "Root", min: 100, max: "*", preferred: 200 } }
			});
			const workspace = new Workspace(host, {
				navigator,
				renderer: {
					modal(context) {
						if (broken) throw new Error("Broken modal");
						return DEFAULT_RENDERER.modal(context);
					}
				},
				content() {
					return { element: document.createElement("p") };
				}
			});
			const original = workspace.openModal(
				{
					title: "Original",
					content() {
						return { element: document.createElement("p") };
					}
				},
				{ from: "root" }
			);
			broken = true;
			try {
				workspace.openModal(
					{
						title: "Replacement",
						content() {
							return { element: document.createElement("p") };
						}
					},
					{ from: "root" }
				);
			} catch {}
			const retained = workspace.modal === original && original.dialog.isConnected;
			workspace.destroy();
			let disposed = 0,
				paints = 0;
			const fake = {
				document,
				renderParts: new Set(),
				time: {
					ms() {
						return 100;
					}
				},
				reducedMotion: { matches: true },
				renderer: {
					frustum() {
						if (++paints === 2) throw new Error("Broken face");
						return {
							dispose() {
								disposed++;
							}
						};
					},
					header({ root, actions }) {
						const button = document.createElement("button");
						root.append(button);
						actions.go.attach(button);
						return {
							update(state) {
								if (state.break) button.remove();
							},
							dispose() {
								disposed++;
							}
						};
					}
				}
			};
			const layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			document.body.append(layer);
			let frustumFailed = false;
			try {
				frustumOrigin({
					workspace: fake,
					kind: "modal",
					layer,
					links: [
						{
							id: "link",
							from: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
							to: { left: 10, top: 10, right: 200, bottom: 200, width: 190, height: 190 }
						}
					]
				});
			} catch {
				frustumFailed = true;
			}
			const afterFault = { nodes: layer.children.length, parts: fake.renderParts.size, disposed };
			disposeOrigin(layer);
			const root = document.createElement("div");
			let calls = 0;
			const part = mountPart(
				fake,
				"header",
				root,
				{},
				{
					actions: {
						go: {
							run() {
								calls++;
							}
						}
					}
				}
			);
			const button = part.actions.go.element;
			let updateFailure;
			try {
				part.update({ break: true });
			} catch (error) {
				updateFailure = error.name;
			}
			button.click();
			const remaining = fake.renderParts.size;
			layer.remove();
			return { retained, frustumFailed, afterFault, updateFailure, remaining, calls, disposed };
		});
		assert.equal(result.retained, true);
		assert.equal(result.frustumFailed, true);
		assert.deepEqual(result.afterFault, { nodes: 0, parts: 0, disposed: 1 });
		assert.equal(result.updateFailure, "SupermaxRendererError");
		assert.equal(result.remaining, 0);
		assert.equal(result.calls, 0);
		assert.equal(result.disposed, 2);
	} finally {
		await browser.close();
		await server.close();
	}
});
