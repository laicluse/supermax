const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function focusables(root) {
	return [...root.querySelectorAll(FOCUSABLE)].filter((candidate) => candidate.offsetParent !== null || candidate === root);
}
