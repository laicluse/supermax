const perspective = "perspective(1400px)";

function fold(element, keyframes, timing) {
	element.style.transformOrigin = "left center";
	return element.animate(keyframes, { ...timing, composite: "add" });
}

export const foldPresentation = {
	name: "fold",
	motion: {
		enter: (element, timing) => fold(element, [{ transform: `${perspective} rotateY(-55deg)`, opacity: 0.1 }, { transform: `${perspective} rotateY(0deg)`, opacity: 1 }], timing),
		leave: (element, timing) => fold(element, [{ transform: `${perspective} rotateY(0deg)`, opacity: 1 }, { transform: `${perspective} rotateY(55deg)`, opacity: 0.1 }], timing),
	},
};
