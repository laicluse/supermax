export function scenario(name, run) {
	try {
		run();
	} catch (error) {
		error.message = `${name}: ${error.message}`;
		throw error;
	}
}
