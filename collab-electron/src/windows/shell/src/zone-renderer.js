/**
 * Canvas zone renderer.
 *
 * Draws persistent background zones that visually partition the canvas.
 *
 * INTELLIGENCE → HUNT → FORGE → REST → REFLECT
 *   諜報          狩      鍛治     回復    内省
 *
 * Each zone has a main workspace area on top and a 5W1H strip at the bottom:
 *   WHY | WHAT | WHO | WHERE | WHEN | HOW
 */

const ZONE_W = 4200;
const ZONE_GAP = 500;
const ZONE_H = 4000;
const W1H_ROW_H = 400; // height of each 5W1H row
const W1H_STRIP_H = W1H_ROW_H * 6; // 6 rows stacked vertically
const TOTAL_ZONE_H = ZONE_H + W1H_STRIP_H;

const COL0 = 40;
const COL1 = COL0 + ZONE_W + ZONE_GAP;
const COL2 = COL1 + ZONE_W + ZONE_GAP;
const COL3 = COL2 + ZONE_W + ZONE_GAP;
const COL4 = COL3 + ZONE_W + ZONE_GAP;

const ROW = 40;

const W1H_LABELS = ["WHY", "WHAT", "WHO", "WHERE", "WHEN", "HOW"];

const ZONES = [
	{
		id: "zone-intelligence",
		label: "INTELLIGENCE",
		color: "rgba(80,140,255,0.12)",
		borderColor: "rgba(80,140,255,0.7)",
		x: COL0,
		y: ROW,
		width: ZONE_W,
		height: TOTAL_ZONE_H,
	},
	{
		id: "zone-hunt",
		label: "HUNT",
		color: "rgba(220,80,80,0.12)",
		borderColor: "rgba(220,80,80,0.7)",
		x: COL1,
		y: ROW,
		width: ZONE_W,
		height: TOTAL_ZONE_H,
	},
	{
		id: "zone-forge",
		label: "FORGE",
		color: "rgba(60,180,100,0.12)",
		borderColor: "rgba(60,180,100,0.7)",
		x: COL2,
		y: ROW,
		width: ZONE_W,
		height: TOTAL_ZONE_H,
	},
	{
		id: "zone-rest",
		label: "REST",
		color: "rgba(200,180,120,0.12)",
		borderColor: "rgba(200,180,120,0.7)",
		x: COL3,
		y: ROW,
		width: ZONE_W,
		height: TOTAL_ZONE_H,
	},
	{
		id: "zone-reflect",
		label: "REFLECT",
		color: "rgba(160,120,200,0.12)",
		borderColor: "rgba(160,120,200,0.7)",
		x: COL4,
		y: ROW,
		width: ZONE_W,
		height: TOTAL_ZONE_H,
	},
];

/** @type {HTMLDivElement | null} */
let layerEl = null;

/** @type {Map<string, HTMLDivElement>} */
const zoneDOMs = new Map();

/** @type {Map<string, HTMLDivElement>} */
const summaryDOMs = new Map();

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

		const summary = document.createElement("div");
		summary.className = "canvas-zone-summary";
		summary.style.color = zone.borderColor;
		summary.textContent = "Empty";
		el.appendChild(summary);
		summaryDOMs.set(zone.id, summary);

		// 5W1H strip at the bottom — 6 rows stacked vertically
		const strip = document.createElement("div");
		strip.className = "zone-5w1h-strip";
		strip.style.borderTopColor = zone.borderColor;

		for (const q of W1H_LABELS) {
			const row = document.createElement("div");
			row.className = "zone-5w1h-row";
			row.style.borderColor = zone.borderColor;

			const rowLabel = document.createElement("div");
			rowLabel.className = "zone-5w1h-label";
			rowLabel.textContent = q;
			rowLabel.style.color = zone.borderColor;
			row.appendChild(rowLabel);

			strip.appendChild(row);
		}
		el.appendChild(strip);

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

/** @type {Record<string, string>} */
const TYPE_LABELS = { term: "Term", note: "Note", text: "Text", browser: "Web", shape: "Shape" };

/**
 * Update zone summary labels with tile-type counts.
 * @param {Array<{ id: string, type: string, x: number, y: number, width: number, height: number }>} tiles
 */
export function updateZoneSummaries(tiles) {
	for (const zone of ZONES) {
		const ids = new Set(getTilesInZone(zone.id, tiles));
		const counts = {};
		for (const t of tiles) {
			if (ids.has(t.id)) counts[t.type] = (counts[t.type] || 0) + 1;
		}
		const parts = Object.entries(counts).map(([k, v]) => `${TYPE_LABELS[k] || k} ${v}`);
		const el = summaryDOMs.get(zone.id);
		if (el) el.textContent = parts.length ? parts.join(" / ") : "Empty";
	}
}

/**
 * Get the center point of a zone (in canvas coordinates).
 * @param {string} zoneId
 * @returns {{ x: number, y: number } | null}
 */
export function getZoneCenter(zoneId) {
	const zone = ZONES.find((z) => z.id === zoneId);
	if (!zone) return null;
	return {
		x: zone.x + zone.width / 2,
		y: zone.y + zone.height / 2,
	};
}
