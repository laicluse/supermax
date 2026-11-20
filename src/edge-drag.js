export function followEdge(parts, edge, target, room) {
	const entry = parts[edge];
	const before = parts.slice(0, edge).reduce((sum, part) => sum + part.size, 0);
	const after = parts.slice(edge + 1).reduce((sum, part) => sum + part.min, 0);
	const maximum = Math.max(entry.min, Math.min(entry.max, room - before - after));
	const size = Math.min(maximum, Math.max(entry.min, Math.round(target) - before));
	return new Map(size === entry.size ? [] : [[entry.id, size]]);
}
