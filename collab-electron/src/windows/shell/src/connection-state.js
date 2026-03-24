/**
 * Connection state management for tile-to-tile connection lines.
 *
 * @typedef {Object} Connection
 * @property {string} id
 * @property {string} fromTileId
 * @property {'top'|'right'|'bottom'|'left'} fromEdge
 * @property {string} toTileId
 * @property {'top'|'right'|'bottom'|'left'} toEdge
 * @property {'bezier'|'straight'} lineStyle
 * @property {string} color
 */

/** @type {Connection[]} */
export const connections = [];

let idCounter = 0;

/**
 * Add a new connection between two tiles.
 * @param {Omit<Connection, 'id'>} opts
 * @returns {Connection}
 */
export function addConnection(opts) {
	idCounter++;
	const conn = {
		id: `conn-${Date.now()}-${idCounter}`,
		fromTileId: opts.fromTileId,
		fromEdge: opts.fromEdge,
		toTileId: opts.toTileId,
		toEdge: opts.toEdge,
		lineStyle: opts.lineStyle || "bezier",
		color: opts.color || "#888888",
	};
	connections.push(conn);
	return conn;
}

/**
 * Remove a connection by ID.
 * @param {string} id
 */
export function removeConnection(id) {
	const idx = connections.findIndex((c) => c.id === id);
	if (idx !== -1) connections.splice(idx, 1);
}

/**
 * Get all connections involving a specific tile.
 * @param {string} tileId
 * @returns {Connection[]}
 */
export function getConnectionsForTile(tileId) {
	return connections.filter(
		(c) => c.fromTileId === tileId || c.toTileId === tileId,
	);
}

/**
 * Remove all connections.
 */
export function clearConnections() {
	connections.length = 0;
}

/**
 * Serialize connections to a plain array for persistence.
 * @returns {object[]}
 */
export function toJSON() {
	return connections.map((c) => ({ ...c }));
}

/**
 * Restore connections from a saved array.
 * @param {object[]} arr
 */
export function fromJSON(arr) {
	connections.length = 0;
	if (!Array.isArray(arr)) return;
	for (const item of arr) {
		if (item.id && item.fromTileId && item.toTileId) {
			connections.push({
				id: item.id,
				fromTileId: item.fromTileId,
				fromEdge: item.fromEdge || "right",
				toTileId: item.toTileId,
				toEdge: item.toEdge || "left",
				lineStyle: item.lineStyle || "bezier",
				color: item.color || "#888888",
			});
		}
	}
}
