/**
 * SVG-based connection line renderer for tile-to-tile connections.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** @type {SVGSVGElement|null} */
let svgLayer = null;

/** @type {Map<string, SVGPathElement>} */
const pathElements = new Map();

/** @type {SVGPathElement|null} */
let tempPath = null;

/**
 * Initialize the SVG connection layer.
 * @param {HTMLElement} canvasEl - The panel-viewer element
 * @returns {SVGSVGElement}
 */
export function initConnectionLayer(canvasEl) {
	svgLayer = canvasEl.querySelector("#connection-layer");
	if (!svgLayer) {
		svgLayer = document.createElementNS(SVG_NS, "svg");
		svgLayer.id = "connection-layer";
		const tileLayer = canvasEl.querySelector("#tile-layer");
		canvasEl.insertBefore(svgLayer, tileLayer);
	}

	// Add arrowhead marker definition
	let defs = svgLayer.querySelector("defs");
	if (!defs) {
		defs = document.createElementNS(SVG_NS, "defs");
		const marker = document.createElementNS(SVG_NS, "marker");
		marker.setAttribute("id", "conn-arrow");
		marker.setAttribute("viewBox", "0 0 10 10");
		marker.setAttribute("refX", "10");
		marker.setAttribute("refY", "5");
		marker.setAttribute("markerWidth", "8");
		marker.setAttribute("markerHeight", "8");
		marker.setAttribute("orient", "auto-start-reverse");
		const arrowPath = document.createElementNS(SVG_NS, "path");
		arrowPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
		arrowPath.setAttribute("fill", "context-stroke");
		marker.appendChild(arrowPath);
		defs.appendChild(marker);
		svgLayer.insertBefore(defs, svgLayer.firstChild);
	}

	return svgLayer;
}

/**
 * Compute the anchor point for a connection handle on a tile edge.
 * Returns screen coordinates.
 */
function getEdgeAnchor(tile, edge, panX, panY, zoom) {
	const sx = tile.x * zoom + panX;
	const sy = tile.y * zoom + panY;
	const sw = tile.width * zoom;
	const sh = tile.height * zoom;

	switch (edge) {
		case "top":
			return { x: sx + sw / 2, y: sy };
		case "bottom":
			return { x: sx + sw / 2, y: sy + sh };
		case "left":
			return { x: sx, y: sy + sh / 2 };
		case "right":
			return { x: sx + sw, y: sy + sh / 2 };
		default:
			return { x: sx + sw / 2, y: sy + sh / 2 };
	}
}

/**
 * Build a cubic bezier path string between two points.
 */
function buildBezierPath(x1, y1, x2, y2, fromEdge, toEdge) {
	const dist = Math.max(60, Math.abs(x2 - x1) * 0.4, Math.abs(y2 - y1) * 0.4);

	let cx1 = x1, cy1 = y1, cx2 = x2, cy2 = y2;

	switch (fromEdge) {
		case "right":  cx1 = x1 + dist; break;
		case "left":   cx1 = x1 - dist; break;
		case "bottom": cy1 = y1 + dist; break;
		case "top":    cy1 = y1 - dist; break;
	}

	switch (toEdge) {
		case "right":  cx2 = x2 + dist; break;
		case "left":   cx2 = x2 - dist; break;
		case "bottom": cy2 = y2 + dist; break;
		case "top":    cy2 = y2 - dist; break;
	}

	return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

/**
 * Render all connections as SVG paths.
 * @param {import('./connection-state.js').Connection[]} connections
 * @param {import('./canvas-state.js').Tile[]} tiles
 * @param {number} panX
 * @param {number} panY
 * @param {number} zoom
 */
export function renderConnections(connections, tiles, panX, panY, zoom) {
	if (!svgLayer) return;

	const tileMap = new Map();
	for (const t of tiles) tileMap.set(t.id, t);

	const activeIds = new Set();

	for (const conn of connections) {
		const fromTile = tileMap.get(conn.fromTileId);
		const toTile = tileMap.get(conn.toTileId);
		if (!fromTile || !toTile) continue;

		activeIds.add(conn.id);

		const from = getEdgeAnchor(fromTile, conn.fromEdge, panX, panY, zoom);
		const to = getEdgeAnchor(toTile, conn.toEdge, panX, panY, zoom);

		let pathStr;
		if (conn.lineStyle === "straight") {
			pathStr = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
		} else {
			pathStr = buildBezierPath(from.x, from.y, to.x, to.y, conn.fromEdge, conn.toEdge);
		}

		let path = pathElements.get(conn.id);
		if (!path) {
			path = document.createElementNS(SVG_NS, "path");
			path.dataset.connectionId = conn.id;
			path.setAttribute("stroke", conn.color);
			path.setAttribute("stroke-width", "2");
			path.setAttribute("fill", "none");
			path.setAttribute("marker-end", "url(#conn-arrow)");
			path.classList.add("connection-path");
			svgLayer.appendChild(path);
			pathElements.set(conn.id, path);
		}

		path.setAttribute("d", pathStr);
		path.setAttribute("stroke", conn.color);
	}

	// Remove stale paths
	for (const [id, path] of pathElements) {
		if (!activeIds.has(id)) {
			path.remove();
			pathElements.delete(id);
		}
	}
}

/**
 * Start a temporary connection line that follows the mouse.
 * @param {string} fromTileId
 * @param {string} fromEdge
 * @param {number} startX - Screen X of the anchor
 * @param {number} startY - Screen Y of the anchor
 * @param {(toTileId: string, toEdge: string) => void} onComplete
 * @param {() => void} onCancel
 */
export function startConnectionDrag(fromTileId, fromEdge, startX, startY, canvasEl, onComplete, onCancel) {
	if (!svgLayer) return;

	tempPath = document.createElementNS(SVG_NS, "path");
	tempPath.setAttribute("stroke", "#4a9eff");
	tempPath.setAttribute("stroke-width", "2");
	tempPath.setAttribute("stroke-dasharray", "6 3");
	tempPath.setAttribute("fill", "none");
	tempPath.classList.add("connection-temp-path");
	svgLayer.appendChild(tempPath);

	// Highlight valid drop targets
	const sourceTile = document.querySelector(`.canvas-tile[data-tile-id="${fromTileId}"]`);
	const allHandles = document.querySelectorAll(".tile-conn-handle");
	for (const h of allHandles) {
		if (!sourceTile || !sourceTile.contains(h)) {
			h.classList.add("connection-drop-target");
		}
	}

	function cleanupDropTargets() {
		for (const h of allHandles) {
			h.classList.remove("connection-drop-target");
		}
	}

	// Convert screen coords to panel-viewer relative
	function toLocal(clientX, clientY) {
		const rect = canvasEl.getBoundingClientRect();
		return { x: clientX - rect.left, y: clientY - rect.top };
	}

	function onMove(e) {
		if (!tempPath) return;
		const p = toLocal(e.clientX, e.clientY);
		const d = buildBezierPath(startX, startY, p.x, p.y, fromEdge, "left");
		tempPath.setAttribute("d", d);
	}

	function onUp(e) {
		document.removeEventListener("mousemove", onMove);
		document.removeEventListener("mouseup", onUp);
		cleanupDropTargets();

		if (tempPath) {
			tempPath.remove();
			tempPath = null;
		}

		// Find nearest connection handle within threshold (proximity-based, works with CSS transforms)
		const SNAP_DIST = 30;
		let bestHandle = null;
		let bestDist = SNAP_DIST;
		for (const h of allHandles) {
			if (sourceTile && sourceTile.contains(h)) continue;
			const rect = h.getBoundingClientRect();
			const hx = rect.left + rect.width / 2;
			const hy = rect.top + rect.height / 2;
			const dist = Math.hypot(e.clientX - hx, e.clientY - hy);
			if (dist < bestDist) {
				bestDist = dist;
				bestHandle = h;
			}
		}

		if (bestHandle) {
			const tileEl = bestHandle.closest(".canvas-tile");
			if (tileEl) {
				const toTileId = tileEl.dataset.tileId;
				const toEdge = bestHandle.dataset.edge;
				if (toTileId && toTileId !== fromTileId && toEdge) {
					onComplete(toTileId, toEdge);
					return;
				}
			}
		}

		onCancel();
	}

	document.addEventListener("mousemove", onMove);
	document.addEventListener("mouseup", onUp);
}

/**
 * Remove all SVG elements and reset state.
 */
export function cleanupConnectionLayer() {
	for (const [, path] of pathElements) {
		path.remove();
	}
	pathElements.clear();
	if (tempPath) {
		tempPath.remove();
		tempPath = null;
	}
}
