/**
 * Persistent tile group state.
 *
 * @typedef {Object} TileGroup
 * @property {string} id
 * @property {string} label
 * @property {string} color - CSS rgba background color
 * @property {Set<string>} tileIds
 */

const GROUP_COLORS = [
	"rgba(99,179,255,0.08)",
	"rgba(99,200,140,0.08)",
	"rgba(180,130,255,0.08)",
	"rgba(255,170,90,0.08)",
	"rgba(255,140,170,0.08)",
];

const GROUP_BORDER_COLORS = [
	"rgba(99,179,255,0.5)",
	"rgba(99,200,140,0.5)",
	"rgba(180,130,255,0.5)",
	"rgba(255,170,90,0.5)",
	"rgba(255,140,170,0.5)",
];

let colorIndex = 0;
let groupIdCounter = 0;

/** @type {TileGroup[]} */
export const groups = [];

function nextColor() {
	const bg = GROUP_COLORS[colorIndex % GROUP_COLORS.length];
	colorIndex++;
	return bg;
}

export function getBorderColor(bgColor) {
	const idx = GROUP_COLORS.indexOf(bgColor);
	if (idx >= 0) return GROUP_BORDER_COLORS[idx];
	return "rgba(99,179,255,0.5)";
}

/**
 * Create a new group from a set of tile IDs.
 * @param {string[]} tileIds
 * @param {string} [label]
 * @returns {TileGroup}
 */
export function addGroup(tileIds, label) {
	// Remove these tiles from any existing groups first
	for (const id of tileIds) {
		removeFromAllGroups(id);
	}
	groupIdCounter++;
	const group = {
		id: `group-${Date.now()}-${groupIdCounter}`,
		label: label || `Group ${groups.length + 1}`,
		color: nextColor(),
		tileIds: new Set(tileIds),
	};
	groups.push(group);
	return group;
}

/** @param {string} groupId */
export function removeGroup(groupId) {
	const idx = groups.findIndex((g) => g.id === groupId);
	if (idx !== -1) groups.splice(idx, 1);
}

/** @param {string} groupId */
export function getGroup(groupId) {
	return groups.find((g) => g.id === groupId) || null;
}

/** @param {string} tileId */
export function getGroupForTile(tileId) {
	return groups.find((g) => g.tileIds.has(tileId)) || null;
}

/**
 * @param {string} groupId
 * @param {string[]} tileIds
 */
export function setGroupTiles(groupId, tileIds) {
	const g = getGroup(groupId);
	if (g) {
		g.tileIds = new Set(tileIds);
	}
}

/** Remove a tile from whichever group(s) it belongs to. */
function removeFromAllGroups(tileId) {
	for (const g of groups) {
		g.tileIds.delete(tileId);
	}
}

/**
 * Remove a tile from its group. If the group has fewer than 2 tiles, dissolve it.
 * @param {string} tileId
 */
export function removeTileFromGroup(tileId) {
	removeFromAllGroups(tileId);
	// Dissolve groups with fewer than 2 members
	for (let i = groups.length - 1; i >= 0; i--) {
		if (groups[i].tileIds.size < 2) {
			groups.splice(i, 1);
		}
	}
}

export function clearGroups() {
	groups.length = 0;
}

/**
 * Compute the bounding rectangle of a group's tiles.
 * @param {TileGroup} group
 * @param {import('./canvas-state.js').Tile[]} tilesArr
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function computeGroupBounds(group, tilesArr) {
	const PADDING = 16;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	let count = 0;
	for (const t of tilesArr) {
		if (!group.tileIds.has(t.id)) continue;
		count++;
		if (t.x < minX) minX = t.x;
		if (t.y < minY) minY = t.y;
		if (t.x + t.width > maxX) maxX = t.x + t.width;
		if (t.y + t.height > maxY) maxY = t.y + t.height;
	}
	if (count === 0) return null;
	return {
		x: minX - PADDING,
		y: minY - PADDING,
		width: maxX - minX + PADDING * 2,
		height: maxY - minY + PADDING * 2,
	};
}

export function toJSON() {
	return groups.map((g) => ({
		id: g.id,
		label: g.label,
		color: g.color,
		tileIds: [...g.tileIds],
	}));
}

/** @param {Array} arr */
export function fromJSON(arr) {
	clearGroups();
	if (!Array.isArray(arr)) return;
	for (const raw of arr) {
		groupIdCounter++;
		groups.push({
			id: raw.id || `group-${Date.now()}-${groupIdCounter}`,
			label: raw.label || "Group",
			color: raw.color || GROUP_COLORS[0],
			tileIds: new Set(raw.tileIds || []),
		});
	}
}
