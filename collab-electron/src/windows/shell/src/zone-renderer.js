/**
 * Canvas zone renderer.
 *
 * Draws persistent background zones that visually partition the canvas.
 *
 * Work zones:    STIMULUS / WILL / SUPPLY (top row)
 * Shared zone:   REFLECT (center, bridges work and life)
 * Life zones:    PLAY / LEARN / LIFE (bottom row)
 */

const ZONE_W = 4200;
const ZONE_GAP = 500;
const WORK_H = 3000;
const REFLECT_H = 2000;
const LIFE_H = 3000;

const COL0 = 40;
const COL1 = COL0 + ZONE_W + ZONE_GAP;
const COL2 = COL1 + ZONE_W + ZONE_GAP;

const ROW_WORK = 40;
const ROW_REFLECT = ROW_WORK + WORK_H + ZONE_GAP;
const ROW_LIFE = ROW_REFLECT + REFLECT_H + ZONE_GAP;

const ZONES = [
	// ── Work (top row) ──
	{
		id: "zone-stimulus",
		label: "STIMULUS",
		color: "rgba(80,140,255,0.12)",
		borderColor: "rgba(80,140,255,0.7)",
		x: COL0,
		y: ROW_WORK,
		width: ZONE_W,
		height: WORK_H,
	},
	{
		id: "zone-will",
		label: "WILL",
		color: "rgba(60,180,100,0.12)",
		borderColor: "rgba(60,180,100,0.7)",
		x: COL1,
		y: ROW_WORK,
		width: ZONE_W,
		height: WORK_H,
	},
	{
		id: "zone-supply",
		label: "SUPPLY",
		color: "rgba(220,80,80,0.12)",
		borderColor: "rgba(220,80,80,0.7)",
		x: COL2,
		y: ROW_WORK,
		width: ZONE_W,
		height: WORK_H,
	},
	// ── Shared (center) ──
	{
		id: "zone-reflect",
		label: "REFLECT",
		color: "rgba(200,180,120,0.12)",
		borderColor: "rgba(200,180,120,0.7)",
		x: COL1,
		y: ROW_REFLECT,
		width: ZONE_W,
		height: REFLECT_H,
	},
	// ── Life (bottom row) ──
	{
		id: "zone-play",
		label: "PLAY",
		color: "rgba(255,150,50,0.12)",
		borderColor: "rgba(255,150,50,0.7)",
		x: COL0,
		y: ROW_LIFE,
		width: ZONE_W,
		height: LIFE_H,
	},
	{
		id: "zone-learn",
		label: "LEARN",
		color: "rgba(160,120,220,0.12)",
		borderColor: "rgba(160,120,220,0.7)",
		x: COL1,
		y: ROW_LIFE,
		width: ZONE_W,
		height: LIFE_H,
	},
	{
		id: "zone-life",
		label: "LIFE",
		color: "rgba(220,100,160,0.12)",
		borderColor: "rgba(220,100,160,0.7)",
		x: COL2,
		y: ROW_LIFE,
		width: ZONE_W,
		height: LIFE_H,
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

		layerEl.appendChild(el);
		zoneDOMs.set(zone.id, el);

		// Add date lines to REFLECT zone
		if (zone.id === "zone-reflect") {
			for (let i = 0; i < 7; i++) {
				const d = new Date(); d.setDate(d.getDate() - i);
				const dateStr = d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
				const opacity = 0.5 - i * 0.06;
				const line = document.createElement("div");
				line.style.cssText = `position:absolute;width:100%;height:1px;background:rgba(200,180,120,${opacity});top:${(i + 1) * (REFLECT_H / 8)}px;pointer-events:none;`;
				const lbl = document.createElement("span");
				lbl.textContent = dateStr;
				lbl.style.cssText = `position:absolute;left:8px;top:-14px;font-size:10px;color:rgba(200,180,120,${opacity});white-space:nowrap;`;
				line.appendChild(lbl);
				el.appendChild(line);
			}
		}
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

/**
 * Get the center point of a zone (in canvas coordinates).
 * @param {string} zoneId
 * @returns {{ x: number, y: number } | null}
 */
const TYPE_LABELS = { term: "Term", note: "Note", text: "Text", draw: "Draw", browser: "Web" };

export function updateZoneSummaries(tiles) {
	for (const zone of ZONES) {
		const ids = getTilesInZone(zone.id, tiles);
		const matched = tiles.filter((t) => ids.includes(t.id));
		const counts = {};
		for (const t of matched) counts[t.type] = (counts[t.type] || 0) + 1;
		const parts = Object.entries(counts).map(([k, v]) => `${TYPE_LABELS[k] || k} ${v}`);
		const el = summaryDOMs.get(zone.id);
		if (el) el.textContent = parts.length ? parts.join(" / ") : "Empty";
	}
}

export function getZoneCenter(zoneId) {
	const zone = ZONES.find((z) => z.id === zoneId);
	if (!zone) return null;
	return {
		x: zone.x + zone.width / 2,
		y: zone.y + zone.height / 2,
	};
}
