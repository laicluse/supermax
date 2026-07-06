import { CellCollection } from "./cell-collection.js";

const cellConfigs = [
	{
		id: "vault",
		title: "Vault",
		min: 3,
		max: 4,
		color: "#0f766e",
		description: "A narrow source column that can disappear first when the viewport gets tight.",
	},
	{
		id: "epics",
		title: "Epics",
		min: 4,
		max: 7,
		color: "#7c3aed",
		description: "Context that should stay readable, but not at the cost of the active work surface.",
	},
	{
		id: "board",
		title: "Board",
		min: 8,
		max: 28,
		zoomable: true,
		color: "#0b6bcb",
		description: "A zoomable workspace that can claim the remaining budget when it becomes the anchor.",
	},
	{
		id: "details",
		title: "Details",
		min: 6,
		max: 18,
		color: "#be123c",
		description: "A right-hand panel that remains visible so selection context and details can coexist.",
	},
];

const state = {
	columns: 24,
	anchorId: null,
};

const elements = {
	root: document.documentElement,
	columns: document.querySelector("[data-columns]"),
	columnsValue: document.querySelector("[data-columns-value]"),
	layout: document.querySelector("[data-layout]"),
	hiddenCells: document.querySelector("[data-hidden-cells]"),
	total: document.querySelector("[data-total]"),
	hiddenCount: document.querySelector("[data-hidden-count]"),
	spare: document.querySelector("[data-spare]"),
	rightmostHidden: document.querySelector("[data-rightmost-hidden]"),
	anchorButtons: Array.from(document.querySelectorAll("[data-anchor]")),
};

function formatColumns(value) {
	return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function render() {
	state.columns = Number(elements.columns.value);
	const layout = new CellCollection(cellConfigs).distribute(state.columns, state.anchorId);
	const renderedCells = layout.cells.map((cell) => ({
		...cell,
		config: cell.config,
	}));
	const visibleCells = renderedCells.filter((cell) => cell.visible);
	const hiddenCells = renderedCells.filter((cell) => !cell.visible);
	const usedColumns = visibleCells.reduce((sum, cell) => sum + cell.actual, 0);

	elements.root.style.setProperty("--columns", String(state.columns));
	elements.columnsValue.textContent = state.columns;
	elements.total.textContent = formatColumns(usedColumns);
	elements.hiddenCount.textContent = hiddenCells.length;
	elements.spare.textContent = formatColumns(layout.spareColumns);
	elements.rightmostHidden.textContent = layout.rightmostHiddenTitle ?? "none";

	elements.anchorButtons.forEach((button) => {
		button.setAttribute("aria-pressed", String(button.dataset.anchor === (state.anchorId ?? "")));
	});

	elements.layout.replaceChildren(...renderedCells.map(renderCell));
	elements.hiddenCells.replaceChildren(
		hiddenCells.length === 0 ? document.createTextNode("All cells are visible.") : document.createTextNode("Hidden:"),
		...hiddenCells.map((cell) => {
			const chip = document.createElement("span");
			chip.className = "hidden-chip";
			chip.textContent = cell.config.title;
			return chip;
		}),
	);
}

function renderCell(cell) {
	const card = document.createElement("article");
	card.className = `cell-card ${cell.visible ? "is-visible" : "is-hidden"}`;
	card.style.setProperty("--share", String(cell.actual || 1));
	card.style.setProperty("--max", String(cell.config.max));
	card.style.setProperty("--color", cell.config.color);

	const title = document.createElement("div");
	title.className = "cell-title";
	title.append(document.createTextNode(cell.config.title));

	const tag = document.createElement("span");
	tag.className = "cell-tag";
	tag.textContent = `${formatColumns(cell.actual)} cols`;
	title.append(tag);

	const body = document.createElement("p");
	body.className = "cell-body";
	body.textContent = cell.config.description;

	const meter = document.createElement("div");
	meter.className = "cell-meter";
	const fill = document.createElement("span");
	meter.append(fill);

	card.append(title, body, meter);
	return card;
}

elements.columns.addEventListener("input", render);
elements.anchorButtons.forEach((button) => {
	button.addEventListener("click", () => {
		state.anchorId = button.dataset.anchor || null;
		render();
	});
});

render();
