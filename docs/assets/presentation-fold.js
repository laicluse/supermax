const perspective = "perspective(1400px)";

export const foldPresentation = {
	name: "fold",
	motion: {
		open: () => ({ origin: "left center", transform: `${perspective} rotateY(-55deg)`, shade: 0.9 }),
		close: () => ({ origin: "left center", transform: `${perspective} rotateY(55deg)`, shade: 0.9 }),
	},
};
