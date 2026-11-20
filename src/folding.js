function seamPattern(document) {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 12 32");
	svg.setAttribute("aria-hidden", "true");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute("d", "M6 0V5M6 27V32M4 8L8 12M4 14L8 18M4 20L8 24");
	svg.append(path);
	return svg;
}

export class FoldController {
	constructor(workspace) {
		this.workspace = workspace;
	}

	mount(entry, occurrence, axis) {
		const { workspace } = this;
		const cue = workspace.create("button", `supermax-fold-cue is-${axis}`);
		cue.type = "button";
		cue.setAttribute("aria-label", workspace.strings.unfold(occurrence.title));
		cue.title = workspace.strings.unfold(occurrence.title);
		const custom = workspace.foldContent?.(occurrence, axis, workspace);
		if (custom instanceof workspace.document.defaultView.Node) cue.append(custom);
		else {
			const mark = workspace.create("span", "supermax-fold-mark");
			mark.setAttribute("aria-hidden", "true");
			mark.append(seamPattern(workspace.document));
			cue.append(mark);
		}
		cue.addEventListener("click", () => this.focus(occurrence.id, axis));
		entry.element.append(cue);
		entry.foldCue = cue;
	}

	apply(entry, folded, direction) {
		entry.element.classList.toggle("is-folded", folded);
		if (entry.body) entry.body.inert = folded;
		entry.foldCue.inert = !folded;
		if (folded) {
			entry.foldCue.dataset.direction = direction;
			entry.element.dataset.foldDirection = direction;
		} else delete entry.foldCue.dataset.direction;
	}

	focus(occurrenceId, axis) {
		const { workspace } = this;
		if (!workspace.navigator.get(occurrenceId)) return false;
		workspace.peeks.close();
		workspace.navigator.foldFocus = { occurrence: occurrenceId, axis };
		workspace.render({ animate: true });
		workspace.dispatchEvent(new CustomEvent("foldfocus", { detail: { occurrence: occurrenceId, axis } }));
		return true;
	}
}
