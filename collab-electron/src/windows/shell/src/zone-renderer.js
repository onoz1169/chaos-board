/**
 * Canvas zone renderer.
 *
 * Draws persistent background zones that visually partition the canvas
 * into STIMULUS / WILL / SUPPLY areas.
 */

const ZONES = [
	{
		id: "zone-stimulus",
		label: "STIMULUS",
		color: "rgba(80,140,255,0.05)",
		borderColor: "rgba(80,140,255,0.35)",
		x: 40,
		y: 40,
		width: 1000,
		height: 10000,
	},
	{
		id: "zone-will",
		label: "WILL",
		color: "rgba(60,180,100,0.05)",
		borderColor: "rgba(60,180,100,0.35)",
		x: 1100,
		y: 40,
		width: 1000,
		height: 10000,
	},
	{
		id: "zone-supply",
		label: "SUPPLY",
		color: "rgba(220,80,80,0.05)",
		borderColor: "rgba(220,80,80,0.35)",
		x: 2160,
		y: 40,
		width: 1000,
		height: 10000,
	},
];

/** @type {HTMLDivElement | null} */
let layerEl = null;

/** @type {Map<string, HTMLDivElement>} */
const zoneDOMs = new Map();

export function getZones() {
	return ZONES;
}

/**
 * Find which zone contains a canvas coordinate point.
 * @param {number} cx - canvas X
 * @param {number} cy - canvas Y
 * @returns {typeof ZONES[number] | null}
 */
export function getZoneAtPoint(cx, cy) {
	for (const zone of ZONES) {
		if (cx >= zone.x && cx <= zone.x + zone.width &&
			cy >= zone.y && cy <= zone.y + zone.height) {
			return zone;
		}
	}
	return null;
}

/**
 * Get all tile IDs whose center falls inside a zone.
 * @param {string} zoneId
 * @param {Array<{ id: string, x: number, y: number, width: number, height: number }>} tiles
 * @returns {string[]}
 */
export function getTilesInZone(zoneId, tiles) {
	const zone = ZONES.find((z) => z.id === zoneId);
	if (!zone) return [];
	const result = [];
	for (const tile of tiles) {
		const cx = tile.x + tile.width / 2;
		const cy = tile.y + tile.height / 2;
		if (cx >= zone.x && cx <= zone.x + zone.width &&
			cy >= zone.y && cy <= zone.y + zone.height) {
			result.push(tile.id);
		}
	}
	return result;
}

/**
 * Flash a zone element to indicate selection.
 * @param {string} zoneId
 */
export function flashZone(zoneId) {
	const el = zoneDOMs.get(zoneId);
	if (!el) return;
	el.classList.add("zone-selected");
	setTimeout(() => el.classList.remove("zone-selected"), 600);
}

/**
 * Create zone DOM elements.
 */
export function initZoneLayer() {
	layerEl = document.getElementById("zone-layer");
	if (!layerEl) return;

	for (const zone of ZONES) {
		const el = document.createElement("div");
		el.className = "canvas-zone";
		el.id = zone.id;
		el.dataset.zoneId = zone.id;
		el.style.background = zone.color;
		el.style.borderColor = zone.borderColor;

		const label = document.createElement("div");
		label.className = "canvas-zone-label";
		label.textContent = zone.label;
		label.style.color = zone.borderColor;
		el.appendChild(label);

		layerEl.appendChild(el);
		zoneDOMs.set(zone.id, el);
	}
}

/**
 * Reposition zone elements to match current pan / zoom.
 */
export function repositionZones(panX, panY, zoom) {
	for (const zone of ZONES) {
		const el = zoneDOMs.get(zone.id);
		if (!el) continue;
		el.style.left = `${zone.x * zoom + panX}px`;
		el.style.top = `${zone.y * zoom + panY}px`;
		el.style.width = `${zone.width * zoom}px`;
		el.style.height = `${zone.height * zoom}px`;
	}
}
