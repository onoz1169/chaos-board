import "./shell.css";
import {
	tiles, addTile, removeTile, getTile, bringToFront,
	generateId, defaultSize, inferTileType, snapToGrid,
	selectTile, deselectTile, toggleTileSelection,
	clearSelection, isSelected, getSelectedTiles,
} from "./canvas-state.js";
import {
	createTileDOM, positionTile, positionAllTiles, splitFilepath,
	updateTileTitle, getTileLabel,
} from "./tile-renderer.js";
import { attachDrag, attachResize, attachMarquee } from "./tile-interactions.js";
import {
	groups, addGroup, removeGroup, getGroupForTile,
	removeTileFromGroup, clearGroups, toJSON as groupsToJSON,
	fromJSON as groupsFromJSON,
} from "./group-state.js";
import { initGroupLayer, renderGroups } from "./group-renderer.js";
import { initZoneLayer, repositionZones, getTilesInZone, getZoneAtPoint, flashZone, getZones, getZoneCenter, updateZoneSummaries, ZONE_H, W1H_ROW_H, TOTAL_ZONE_H, W1H_LABELS } from "./zone-renderer.js";
import { strokes as penStrokes, clearStrokes as clearPenStrokes, undoStroke, toJSON as penStrokesToJSON, fromJSON as penStrokesFromJSON } from "./pen-stroke-state.js";
import { initPenOverlay, redraw as redrawPenOverlay, togglePenMode, isPenMode, setPenMode, setPenTool } from "./pen-overlay.js";
import { connections, addConnection, removeConnection, getConnectionsForTile, toJSON as connectionsToJSON, fromJSON as connectionsFromJSON } from "./connection-state.js";
import { initConnectionLayer, renderConnections, startConnectionDrag, cleanupConnectionLayer } from "./connection-renderer.js";

// -- Dark mode --

function applyCanvasOpacity(percent) {
	const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
	document.documentElement.style.setProperty(
		"--canvas-opacity",
		String(clamped / 100),
	);
}

function initDarkMode() {
	// Default to dark mode always
	document.documentElement.classList.add("dark");
}

initDarkMode();

// Load saved canvas opacity
window.shellApi.getPref("canvasOpacity").then((v) => {
	if (v != null) applyCanvasOpacity(v);
});

// Listen for live changes from settings
window.shellApi.onPrefChanged((key, value) => {
	if (key === "canvasOpacity") applyCanvasOpacity(value);
});

// -- Canvas --

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 1;
const ZOOM_RUBBER_BAND_K = 400;
const CANVAS_DBLCLICK_SUPPRESS_MS = 500;
const CELL = 20;
const MAJOR = 80;


let canvasX = 0;
let canvasY = 0;
let zoomSnapTimer = null;
let zoomSnapRaf = null;
let lastZoomFocalX = 0;
let lastZoomFocalY = 0;
let canvasScale = 1;
let zoomIndicatorTimer = null;

const canvasEl = document.getElementById("panel-viewer");
const gridCanvas = document.getElementById("grid-canvas");
const gridCtx = gridCanvas.getContext("2d");
canvasEl.tabIndex = -1;

function isDark() {
	return document.documentElement.classList.contains("dark");
}

function resizeGridCanvas() {
	const dpr = window.devicePixelRatio || 1;
	const w = canvasEl.clientWidth;
	const h = canvasEl.clientHeight;
	gridCanvas.width = w * dpr;
	gridCanvas.height = h * dpr;
	gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawGrid() {
	const w = canvasEl.clientWidth;
	const h = canvasEl.clientHeight;
	if (w === 0 || h === 0) return;

	const dark = isDark();
	gridCtx.clearRect(0, 0, w, h);

	const step = CELL * canvasScale;
	const majorStep = MAJOR * canvasScale;
	const offX = ((canvasX % majorStep) + majorStep) % majorStep;
	const offY = ((canvasY % majorStep) + majorStep) % majorStep;

	// Dots at minor intersections
	const dotOffX = ((canvasX % step) + step) % step;
	const dotOffY = ((canvasY % step) + step) % step;
	const dotSize = Math.max(1, 1.5 * canvasScale);
	gridCtx.fillStyle = dark
		? "rgba(255,255,255,0.22)"
		: "rgba(0,0,0,0.20)";
	for (let x = dotOffX; x <= w; x += step) {
		for (let y = dotOffY; y <= h; y += step) {
			const px = Math.round(x);
			const py = Math.round(y);
			gridCtx.fillRect(px, py, dotSize, dotSize);
		}
	}

	// Brighter dots at major intersections
	const majorDotSize = Math.max(1, 1.5 * canvasScale);
	gridCtx.fillStyle = dark
		? "rgba(255,255,255,0.40)"
		: "rgba(0,0,0,0.35)";
	for (let x = offX; x <= w; x += majorStep) {
		for (let y = offY; y <= h; y += majorStep) {
			const px = Math.round(x);
			const py = Math.round(y);
			gridCtx.fillRect(px, py, majorDotSize, majorDotSize);
		}
	}
}

let onCanvasUpdate = null;

const zoomIndicatorEl = document.getElementById("zoom-indicator");
const zoomResetBtnEl = document.getElementById("zoom-reset-btn");

function showZoomIndicator() {
	const pct = Math.round(canvasScale * 100);
	zoomIndicatorEl.textContent = `${pct}%`;
	zoomIndicatorEl.classList.add("visible");
	if (zoomResetBtnEl) zoomResetBtnEl.textContent = `${pct}%`;
	clearTimeout(zoomIndicatorTimer);
	zoomIndicatorTimer = setTimeout(() => {
		zoomIndicatorEl.classList.remove("visible");
	}, 1200);
}

function updateCanvas() {
	drawGrid();
	if (onCanvasUpdate) onCanvasUpdate();
}

let prevCanvasW = canvasEl.clientWidth;
let prevCanvasH = canvasEl.clientHeight;

new ResizeObserver(() => {
	const w = canvasEl.clientWidth;
	const h = canvasEl.clientHeight;
	canvasX += (w - prevCanvasW) / 2;
	canvasY += (h - prevCanvasH) / 2;
	prevCanvasW = w;
	prevCanvasH = h;
	resizeGridCanvas();
	updateCanvas();
}).observe(canvasEl);

resizeGridCanvas();

function snapBackZoom() {
	const fx = lastZoomFocalX;
	const fy = lastZoomFocalY;
	const target = canvasScale > ZOOM_MAX ? ZOOM_MAX : ZOOM_MIN;

	function animate() {
		const prevScale = canvasScale;
		canvasScale += (target - canvasScale) * 0.15;

		if (Math.abs(canvasScale - target) < 0.001) {
			canvasScale = target;
		}

		const ratio = canvasScale / prevScale - 1;
		canvasX -= (fx - canvasX) * ratio;
		canvasY -= (fy - canvasY) * ratio;
		showZoomIndicator();
		updateCanvas();

		if (canvasScale === target) {
			zoomSnapRaf = null;
			return;
		}
		zoomSnapRaf = requestAnimationFrame(animate);
	}

	zoomSnapRaf = requestAnimationFrame(animate);
}

function applyZoom(deltaY, focalX, focalY) {
	if (zoomSnapRaf) {
		cancelAnimationFrame(zoomSnapRaf);
		zoomSnapRaf = null;
	}
	clearTimeout(zoomSnapTimer);

	const prevScale = canvasScale;
	let factor = Math.exp((-deltaY * 0.6) / 100);

	if (canvasScale >= ZOOM_MAX && factor > 1) {
		const overshoot = canvasScale / ZOOM_MAX - 1;
		const damping = 1 / (1 + overshoot * ZOOM_RUBBER_BAND_K);
		factor = 1 + (factor - 1) * damping;
		canvasScale *= factor;
	} else if (canvasScale <= ZOOM_MIN && factor < 1) {
		const overshoot = ZOOM_MIN / canvasScale - 1;
		const damping = 1 / (1 + overshoot * ZOOM_RUBBER_BAND_K);
		factor = 1 - (1 - factor) * damping;
		canvasScale *= factor;
	} else {
		canvasScale *= factor;
	}

	const ratio = canvasScale / prevScale - 1;
	canvasX -= (focalX - canvasX) * ratio;
	canvasY -= (focalY - canvasY) * ratio;
	lastZoomFocalX = focalX;
	lastZoomFocalY = focalY;

	if (canvasScale > ZOOM_MAX || canvasScale < ZOOM_MIN) {
		zoomSnapTimer = setTimeout(snapBackZoom, 150);
	}

	showZoomIndicator();
	updateCanvas();
}


canvasEl.addEventListener("wheel", (e) => {
	e.preventDefault();

	if (e.ctrlKey) {
		const rect = canvasEl.getBoundingClientRect();
		applyZoom(e.deltaY, e.clientX - rect.left, e.clientY - rect.top);
	} else {
		if (!isPenMode()) {
			canvasX -= e.deltaX * 1.2;
			canvasY -= e.deltaY * 1.2;
			updateCanvas();
		}
	}
}, { passive: false });

// Zoom controls (persistent bottom-right buttons)
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");
const zoomFitBtn = document.getElementById("zoom-fit-btn");

function zoomAtCenter(deltaY) {
	const cw = canvasEl.clientWidth / 2;
	const ch = canvasEl.clientHeight / 2;
	applyZoom(deltaY, cw, ch);
}

if (zoomInBtn) zoomInBtn.addEventListener("click", () => zoomAtCenter(-120));
if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => zoomAtCenter(120));
if (zoomResetBtn) {
	zoomResetBtn.addEventListener("click", () => {
		const prevScale = canvasScale;
		canvasScale = 1;
		const cw = canvasEl.clientWidth / 2;
		const ch = canvasEl.clientHeight / 2;
		const ratio = canvasScale / prevScale - 1;
		canvasX -= (cw - canvasX) * ratio;
		canvasY -= (ch - canvasY) * ratio;
		showZoomIndicator();
		updateCanvas();
	});
}

function fitAllZones() {
	const zones = getZones();
	if (!zones.length) return;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const z of zones) {
		if (z.x < minX) minX = z.x;
		if (z.y < minY) minY = z.y;
		if (z.x + z.width > maxX) maxX = z.x + z.width;
		if (z.y + z.height > maxY) maxY = z.y + z.height;
	}
	const bboxW = maxX - minX;
	const bboxH = maxY - minY;
	const vw = canvasEl.clientWidth;
	const vh = canvasEl.clientHeight;
	const padding = 0.92;
	const fitZoom = Math.min((vw * padding) / bboxW, (vh * padding) / bboxH);
	canvasScale = Math.max(ZOOM_MIN, Math.min(fitZoom, ZOOM_MAX));
	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	canvasX = -cx * canvasScale + vw / 2;
	canvasY = -cy * canvasScale + vh / 2;
	showZoomIndicator();
	updateCanvas();
}

if (zoomFitBtn) zoomFitBtn.addEventListener("click", fitAllZones);
showZoomIndicator();

updateCanvas();

// -- Constants --

function getPanelConstraints(side) {
	const s = getComputedStyle(document.documentElement);
	const min = parseInt(
		s.getPropertyValue(`--panel-${side}-min`).trim(), 10,
	);
	const max = parseInt(
		s.getPropertyValue(`--panel-${side}-max`).trim(), 10,
	);
	return { min, max };
}

// -- Panel persistence --

const _prefCache = {};

function savePanelPref(key, value) {
	_prefCache[key] = value;
	window.shellApi.setPref(key, value);
}

function loadPanelPref(key) {
	const value = _prefCache[key];
	if (value == null) return null;
	return value;
}

function savePanelVisible(panel, visible) {
	_prefCache[`panel-visible-${panel}`] = visible;
	window.shellApi.setPref(`panel-visible-${panel}`, visible);
}

function loadPanelVisible(panel, fallback) {
	const value = _prefCache[`panel-visible-${panel}`];
	if (value == null) return fallback;
	return !!value;
}

function normalizeShortcutKey(key) {
	if (!key) return null;
	return key.length === 1 ? key.toLowerCase() : key;
}

function isFocusSearchShortcut(input) {
	const inputType = input?.type;
	const hasCommandModifier =
		input?.meta ||
		input?.control ||
		input?.metaKey ||
		input?.ctrlKey;
	if (
		!input ||
		(inputType !== "keyDown" && inputType !== "keydown") ||
		input.isAutoRepeat ||
		input.repeat
	) {
		return false;
	}
	if (!hasCommandModifier) return false;
	return input.code === "KeyK" || normalizeShortcutKey(input.key) === "k";
}

// -- Webview creation --

function createWebview(name, config, container, onDndMessage) {
	const wv = document.createElement("webview");
	wv.setAttribute("src", config.src);
	wv.setAttribute("preload", config.preload);
	wv.setAttribute(
		"webpreferences", "contextIsolation=yes, sandbox=yes",
	);
	wv.style.flex = "1";

	let ready = false;
	const pendingMessages = [];
	let onBeforeInput = null;

	wv.addEventListener("dom-ready", () => {
		ready = true;
		for (const [ch, args] of pendingMessages) {
			wv.send(ch, ...args);
		}
		pendingMessages.length = 0;
		wv.addEventListener("before-input-event", (e) => {
			const detail = e.detail;
			if (!detail || detail.type !== "keyDown") return;
			if (detail.meta && detail.alt && detail.code === "KeyI") {
				wv.openDevTools();
			}
			if (onBeforeInput) onBeforeInput(e, detail);
		});
	});

	wv.addEventListener("ipc-message", (event) => {
		if (event.channel.startsWith("dnd:")) {
			onDndMessage(event.channel, event.args);
			return;
		}
		console.log(
			`[shell] ipc from ${name}: ${event.channel}`,
			...event.args,
		);
	});

	wv.addEventListener("console-message", (event) => {
		window.shellApi.logFromWebview(
			name, event.level, event.message, event.sourceId,
		);
	});

	container.appendChild(wv);

	return {
		send(channel, ...args) {
			if (ready) wv.send(channel, ...args);
			else pendingMessages.push([channel, args]);
		},
		setBeforeInput(cb) {
			onBeforeInput = cb;
		},
		webview: wv,
	};
}

// -- Resize --

function setupResize(
	handle, panel, counterpart, side,
	getAllWebviews, onResize,
) {
	const resizeOverlay = document.getElementById("resize-overlay");

	handle.addEventListener("mousedown", (e) => {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = panel.getBoundingClientRect().width;
		let prevClamped = startWidth;

		handle.classList.add("active");
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		resizeOverlay.style.display = "block";

		for (const h of getAllWebviews()) {
			h.webview.style.pointerEvents = "none";
		}

		function onMouseMove(e) {
			const constraints = getPanelConstraints(side);
			const delta = e.clientX - startX;
			const unclamped =
				side === "nav" ? startWidth + delta : startWidth - delta;
			const clamped = Math.max(
				constraints.min,
				Math.min(constraints.max, unclamped),
			);
			const counterDelta = prevClamped - clamped;
			prevClamped = clamped;
			panel.style.flex = `0 0 ${clamped}px`;
			counterpart.style.flex = "1 1 0";
			onResize(counterDelta);
		}

		function onMouseUp() {
			handle.classList.remove("active");
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			resizeOverlay.style.display = "";

			for (const h of getAllWebviews()) {
				h.webview.style.pointerEvents = "";
			}

			savePanelPref(
				`panel-width-${side}`,
				panel.getBoundingClientRect().width,
			);
		}

		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
	});
}

// -- Init --

async function init() {
	const [
		configs, workspaceData,
		prefNavWidth, prefNavVisible,
	] = await Promise.all([
		window.shellApi.getViewConfig(),
		window.shellApi.workspaceList(),
		window.shellApi.getPref("panel-width-nav"),
		window.shellApi.getPref("panel-visible-nav"),
	]);

	if (prefNavWidth != null) {
		_prefCache["panel-width-nav"] = prefNavWidth;
	}
	if (prefNavVisible != null) {
		_prefCache["panel-visible-nav"] = prefNavVisible;
	}

	// Memo state (must be declared early — used by getCanvasStateForSave)
	let spMemo = { content: "", drawing: "" };

	// Kanban state (must be declared early — used by getCanvasStateForSave)
	// card: { id, title, due, priority: "high"|"mid"|"low"|"", notes }
	/** @type {{ columns: Array<{ id: string, title: string, cards: Array<any> }>, archived: Array<any>, mode?: string }} */
	let kanbanState = {
		columns: [
			{ id: "col-todo", title: "Todo", cards: [] },
			{ id: "col-doing", title: "Doing", cards: [] },
		],
		archived: [],
		mode: "free", // "free" | "zone"
	};

	const ZONE_COLUMNS = [
		{ id: "zone-intelligence", title: "INTELLIGENCE", color: "rgba(80,140,255,0.9)" },
		{ id: "zone-hunt", title: "HUNT", color: "rgba(220,80,80,0.9)" },
		{ id: "zone-blacksmith", title: "BLACKSMITH", color: "rgba(60,180,100,0.9)" },
		{ id: "zone-rest", title: "REST", color: "rgba(200,180,120,0.9)" },
		{ id: "zone-reflect", title: "REFLECT", color: "rgba(160,120,200,0.9)" },
	];

	// DOM elements
	const panelNav = document.getElementById("panel-nav");
	const panelViewer = document.getElementById("panel-viewer");
	const navResizeHandle = document.getElementById("nav-resize");
	const navToggle = document.getElementById("nav-toggle");
	const workspaceTrigger =
		document.getElementById("workspace-trigger");
	const workspaceTriggerParent =
		document.getElementById("workspace-trigger-parent");
	const workspaceTriggerName =
		document.getElementById("workspace-trigger-name");
	const workspaceMenu =
		document.getElementById("workspace-menu");
	const workspaceMenuItems =
		document.getElementById("workspace-menu-items");
	const wsAddOption =
		document.getElementById("ws-add-option");
	const settingsOverlay =
		document.getElementById("settings-overlay");
	const settingsBackdrop =
		document.getElementById("settings-backdrop");
	const settingsModal = document.getElementById("settings-modal");
	const updatePill = document.getElementById("update-pill");
	const dragDropOverlay =
		document.getElementById("drag-drop-overlay");
	const loadingOverlay =
		document.getElementById("loading-overlay");
	const loadingStatusEl =
		document.getElementById("loading-status");

	const tileLayer = document.getElementById("tile-layer");
	const groupLayer = document.getElementById("group-layer");
	initZoneLayer();
	initConnectionLayer(canvasEl);

	// Right-click on connection paths to delete or toggle style
	{
		const connLayer = document.getElementById("connection-layer");
		if (connLayer) {
			connLayer.addEventListener("contextmenu", (e) => {
				const target = e.target;
				if (!target || !target.classList.contains("connection-path")) return;
				e.preventDefault();
				e.stopPropagation();
				const connId = target.dataset.connectionId;
				if (!connId) return;

				// Remove any existing connection context menu
				const existing = document.getElementById("conn-context-menu");
				if (existing) existing.remove();

				const menu = document.createElement("div");
				menu.id = "conn-context-menu";
				menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px 0;z-index:9999;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:12px;font-family:var(--font-mono);`;

				const deleteItem = document.createElement("div");
				deleteItem.textContent = "Delete connection";
				deleteItem.style.cssText = "padding:6px 12px;cursor:pointer;color:var(--fg);";
				deleteItem.addEventListener("mouseenter", () => { deleteItem.style.background = "var(--border)"; });
				deleteItem.addEventListener("mouseleave", () => { deleteItem.style.background = ""; });
				deleteItem.addEventListener("click", () => {
					removeConnection(connId);
					renderConnections(connections, tiles, canvasX, canvasY, canvasScale);
					saveCanvasDebounced();
					menu.remove();
				});
				menu.appendChild(deleteItem);

				const conn = connections.find(c => c.id === connId);
				if (conn) {
					const toggleItem = document.createElement("div");
					toggleItem.textContent = conn.lineStyle === "straight" ? "Curved line" : "Straight line";
					toggleItem.style.cssText = "padding:6px 12px;cursor:pointer;color:var(--fg);";
					toggleItem.addEventListener("mouseenter", () => { toggleItem.style.background = "var(--border)"; });
					toggleItem.addEventListener("mouseleave", () => { toggleItem.style.background = ""; });
					toggleItem.addEventListener("click", () => {
						conn.lineStyle = conn.lineStyle === "straight" ? "bezier" : "straight";
						renderConnections(connections, tiles, canvasX, canvasY, canvasScale);
						saveCanvasDebounced();
						menu.remove();
					});
					menu.appendChild(toggleItem);
				}

				document.body.appendChild(menu);
				const dismiss = (ev) => {
					if (!menu.contains(ev.target)) {
						menu.remove();
						document.removeEventListener("mousedown", dismiss);
					}
				};
				setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
			});
		}
	}

	// Long-press anywhere on canvas (including on tiles) to select all tiles in that zone
	{
		const LONG_PRESS_MS = 400;
		let pressTimer = null;
		let pressStartX = 0;
		let pressStartY = 0;

		canvasEl.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			if (spaceHeld) return;
			pressStartX = e.clientX;
			pressStartY = e.clientY;

			pressTimer = setTimeout(() => {
				pressTimer = null;
				// Convert screen coords to canvas coords
				const rect = canvasEl.getBoundingClientRect();
				const cx = (e.clientX - rect.left - canvasX) / canvasScale;
				const cy = (e.clientY - rect.top - canvasY) / canvasScale;
				const zone = getZoneAtPoint(cx, cy);
				if (!zone) return;

				const ids = getTilesInZone(zone.id, tiles);
				if (ids.length === 0) return;

				clearSelection();
				for (const id of ids) selectTile(id);
				syncSelectionVisuals();
				flashZone(zone.id);
			}, LONG_PRESS_MS);
		}, true);  // capture phase to fire before tile handlers

		canvasEl.addEventListener("mousemove", (e) => {
			if (!pressTimer) return;
			const dist = Math.hypot(e.clientX - pressStartX, e.clientY - pressStartY);
			if (dist > 5) {
				clearTimeout(pressTimer);
				pressTimer = null;
			}
		}, true);

		canvasEl.addEventListener("mouseup", () => {
			if (pressTimer) {
				clearTimeout(pressTimer);
				pressTimer = null;
			}
		}, true);
	}
	initGroupLayer(canvasEl);

	// -- Group/ungroup helpers --

	function groupSelectedTiles() {
		const sel = getSelectedTiles();
		if (sel.length < 2) return;
		addGroup(sel.map((t) => t.id));
		repositionAllTiles();
		saveCanvasImmediate();
	}

	function ungroupSelectedTiles() {
		const sel = getSelectedTiles();
		const gids = new Set();
		for (const t of sel) {
			const g = getGroupForTile(t.id);
			if (g) gids.add(g.id);
		}
		if (gids.size === 0) return;
		for (const gid of gids) removeGroup(gid);
		repositionAllTiles();
		saveCanvasImmediate();
	}

	// Listen for ungroup button clicks dispatched from group-renderer
	groupLayer.addEventListener("group-ungroup", (e) => {
		const { groupId } = e.detail;
		if (groupId) {
			removeGroup(groupId);
			repositionAllTiles();
			saveCanvasImmediate();
		}
	});
	/** @type {Map<string, {container: HTMLElement, contentArea: HTMLElement, titleText: HTMLElement, webview?: HTMLElement}>} */
	const tileDOMs = new Map();
	const viewport = {
		get panX() { return canvasX; },
		get panY() { return canvasY; },
		get zoom() { return canvasScale; },
	};

	// State
	let navVisible = loadPanelVisible("nav", true);
	let dragCounter = 0;
	let dropdownOpen = false;
	let activeSurface = "canvas";
	let lastNonModalSurface = "canvas";
	let settingsModalOpen = false;
	let focusedTileId = null;
	let isScratchpadOpen = false;

	// -- Canvas persistence --

	let saveTimer = null;
	let canvasRestoreComplete = false;

	function getCanvasStateForSave() {
		return {
			version: 1,
			tiles: tiles.map((t) => ({
				id: t.id,
				type: t.type,
				x: t.x,
				y: t.y,
				width: t.width,
				height: t.height,
				filePath: t.filePath,
				folderPath: t.folderPath,
				workspacePath: t.workspacePath,
				ptySessionId: t.ptySessionId,
				url: t.url,
				label: t.label,
				content: t.content,
				noteColor: t.noteColor,
				fontSize: t.fontSize,
				shapeType: t.shapeType,
				shapeColor: t.shapeColor,
				shapeBorder: t.shapeBorder,
				zIndex: t.zIndex,
			})),
			viewport: {
				panX: canvasX,
				panY: canvasY,
				zoom: canvasScale,
			},
			groups: groupsToJSON(),
			penStrokes: penStrokesToJSON(),
			connections: connectionsToJSON(),
			scratchpad: getScratchpadStateForSave(),
			kanban: getKanbanStateForSave(),
		};
	}

	function saveCanvasDebounced() {
		if (!canvasRestoreComplete) return;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				await window.shellApi.canvasSaveState(getCanvasStateForSave());
			} catch (err) {
				console.error("Canvas save failed:", err);
				setTimeout(() => {
					window.shellApi.canvasSaveState(getCanvasStateForSave()).catch(console.error);
				}, 3000);
			}
		}, 500);
	}

	function saveCanvasImmediate() {
		if (!canvasRestoreComplete) return;
		clearTimeout(saveTimer);
		window.shellApi.canvasSaveState(getCanvasStateForSave()).catch(err => {
			console.error("Immediate canvas save failed:", err);
		});
	}

	// -- Workspace data --

	const workspaces = [];
	let activeIndex = -1;

	function getAllWebviews() {
		const all = [];
		for (const ws of workspaces) {
			all.push(ws.nav);
		}
		all.push(singletonViewer);
		all.push(singletonWebviews.settings);
		for (const [, dom] of tileDOMs) {
			if (dom.webview) {
				all.push({
					webview: dom.webview,
					send: (ch, ...args) => {
						if (dom.webview) dom.webview.send(ch, ...args);
					},
				});
			}
		}
		return all;
	}

	function noteSurfaceFocus(surface) {
		if (settingsModalOpen && surface !== "settings") {
			focusSurface("settings");
			return;
		}
		if (activeSurface === "canvas-tile" && surface !== "canvas-tile") {
			blurCanvasTileGuest();
		}
		activeSurface = surface;
		if (surface !== "settings") {
			lastNonModalSurface = surface;
		}
		const canvasOwned = surface === "canvas" || surface === "canvas-tile";
		canvasEl.classList.toggle("canvas-focused", canvasOwned);
		if (surface !== "canvas-tile") clearTileFocusRing();
	}

	function getActiveWorkspace() {
		if (activeIndex < 0 || activeIndex >= workspaces.length) {
			return null;
		}
		return workspaces[activeIndex];
	}

	function isViewerVisible() {
		return singletonViewer.webview.style.display !== "none";
	}

	function resolveSurface(surface = lastNonModalSurface) {
		if (surface === "canvas-tile" && focusedTileId) {
			const dom = tileDOMs.get(focusedTileId);
			if (dom && dom.webview) return "canvas-tile";
		}
		if (surface === "viewer" && !isViewerVisible()) {
			surface = null;
		}
		if (surface === "nav" && !(navVisible && getActiveWorkspace())) {
			surface = null;
		}
		if (surface === "viewer") return "viewer";
		if (surface === "nav") return "nav";
		if (navVisible && getActiveWorkspace()) return "nav";
		if (isViewerVisible()) return "viewer";
		return "canvas";
	}

	function focusSurface(surface = lastNonModalSurface) {
		if (surface === "canvas-tile" && focusedTileId) {
			const dom = tileDOMs.get(focusedTileId);
			if (dom && dom.webview) {
				dom.webview.focus();
				noteSurfaceFocus("canvas-tile");
				return;
			}
		}

		requestAnimationFrame(() => {
			window.focus();
			if (surface === "settings") {
				singletonWebviews.settings.webview.focus();
				noteSurfaceFocus("settings");
				return;
			}
			const resolved = resolveSurface(surface);
			const workspace = getActiveWorkspace();
			if (resolved === "nav" && workspace) {
				workspace.nav.webview.focus();
				noteSurfaceFocus("nav");
				return;
			}
			if (resolved === "viewer" && isViewerVisible()) {
				singletonViewer.webview.focus();
				noteSurfaceFocus("viewer");
				return;
			}
			canvasEl.focus();
			noteSurfaceFocus("canvas");
		});
	}

	function setUnderlyingShellInert(inert) {
		panelsEl.inert = inert;
		navToggle.inert = inert;
		workspaceTrigger.inert = inert;
		wsAddOption.inert = inert;
	}

	function blurNonModalSurfaces() {
		canvasEl.blur();
		navToggle.blur();
		workspaceTrigger.blur();
		singletonViewer.webview.blur();
		for (const workspace of workspaces) {
			workspace.nav.webview.blur();
		}
	}

	// -- Tile management --

	function repositionAllTiles() {
		for (const tile of tiles) {
			const dom = tileDOMs.get(tile.id);
			if (!dom) continue;
			positionTile(dom.container, tile, canvasX, canvasY, canvasScale);
		}
		repositionZones(canvasX, canvasY, canvasScale);
		renderGroups(groups, tiles, canvasX, canvasY, canvasScale);
		updateZoneSummaries(tiles);
		renderConnections(connections, tiles, canvasX, canvasY, canvasScale);
	}

	// ── Tile temperature visualization ──
	function updateTileTemperatures() {
		const now = Date.now();
		for (const tile of tiles) {
			const dom = tileDOMs.get(tile.id);
			if (!dom) continue;
			const lastActive = tile._lastInteraction || now;
			const hoursAgo = (now - lastActive) / 3.6e6;
			let opacity = 0;
			if (hoursAgo < 1) opacity = 0.8;
			else if (hoursAgo < 24) opacity = 0.4;
			else if (hoursAgo < 168) opacity = 0.15;
			dom.container.style.boxShadow = opacity
				? `0 0 8px rgba(100,200,255,${opacity})`
				: "none";
		}
	}
	setInterval(updateTileTemperatures, 60000);

	function spawnTerminalWebview(tile, autoFocus = false) {
		const dom = tileDOMs.get(tile.id);
		if (!dom) return;

		const wv = document.createElement("webview");
		const termConfig = configs.terminalTile;
		const params = new URLSearchParams();
		if (tile.ptySessionId) {
			params.set("sessionId", tile.ptySessionId);
			params.set("restored", "1");
		} else if (tile.cwd) {
			params.set("cwd", tile.cwd);
		}
		const qs = params.toString();
		wv.setAttribute(
			"src",
			qs ? `${termConfig.src}?${qs}` : termConfig.src,
		);
		wv.setAttribute("preload", termConfig.preload);
		wv.setAttribute(
			"webpreferences", "contextIsolation=yes, sandbox=yes",
		);
		wv.style.width = "100%";
		wv.style.height = "100%";
		wv.style.border = "none";

		dom.contentArea.appendChild(wv);
		dom.webview = wv;

		wv.addEventListener("dom-ready", () => {
			if (autoFocus) focusCanvasTile(tile.id);
		});

		wv.addEventListener("ipc-message", (event) => {
			if (event.channel === "pty-session-id") {
				tile.ptySessionId = event.args[0];
				saveCanvasDebounced();
			}
			if (event.channel === "pty-exited") {
				const exitCode = event.args[1];
				const statusDot = dom.container.querySelector(".tile-term-status");
				if (statusDot) {
					if (exitCode === 0 || exitCode === undefined) {
						statusDot.classList.add("stopped");
						statusDot.classList.remove("error");
						statusDot.title = "Stopped";
					} else {
						statusDot.classList.add("error");
						statusDot.classList.remove("stopped");
						statusDot.title = "Error";
					}
				}
				// Update linked kanban card status
				updateKanbanCardStatus(tile.id, exitCode === 0 || exitCode === undefined ? "done" : "error");
			}
		});
	}

	function spawnGraphWebview(tile) {
		const dom = tileDOMs.get(tile.id);
		if (!dom) return;

		const wv = document.createElement("webview");
		const graphConfig = configs.graphTile;
		const params = new URLSearchParams();
		params.set("folder", tile.folderPath);
		params.set("workspace", tile.workspacePath ?? "");
		const qs = params.toString();
		wv.setAttribute(
			"src",
			`${graphConfig.src}?${qs}`,
		);
		wv.setAttribute("preload", graphConfig.preload);
		wv.setAttribute(
			"webpreferences", "contextIsolation=yes, sandbox=yes",
		);
		wv.style.width = "100%";
		wv.style.height = "100%";
		wv.style.border = "none";

		dom.contentArea.appendChild(wv);
		dom.webview = wv;
	}

	function createGraphTile(cx, cy, folderPath) {
		const wsPath = workspaces[activeIndex]?.path ?? "";
		const tile = createCanvasTile("graph", cx, cy, { folderPath, workspacePath: wsPath });
		spawnGraphWebview(tile);
		saveCanvasImmediate();
		return tile;
	}

	function syncSelectionVisuals() {
		const selectedTiles = getSelectedTiles();
		const isMultiSelect = selectedTiles.length > 1;
		for (const [id, dom] of tileDOMs) {
			const selected = isSelected(id);
			dom.container.classList.toggle("tile-selected", selected);
			dom.container.classList.toggle("tile-group-selected", selected && isMultiSelect);
		}
	}

	function spawnBrowserWebview(tile, autoFocus = false) {
		const dom = tileDOMs.get(tile.id);
		if (!dom) return;

		if (!tile.url) {
			if (autoFocus && dom.urlInput) {
				dom.urlInput.focus();
			}
			return;
		}

		let url = tile.url;
		if (!/^https?:\/\//i.test(url)) {
			const isLocal = /^localhost(:|$)/i.test(url) ||
				/^127\.0\.0\.1(:|$)/.test(url);
			url = (isLocal ? "http://" : "https://") + url;
			tile.url = url;
		}
		const blocked = /^(javascript|file|data):/i;
		if (blocked.test(url)) return;

		const wv = document.createElement("webview");
		wv.setAttribute("src", url);
		wv.setAttribute("allowpopups", "");
		wv.setAttribute("partition", "persist:browser");
		wv.setAttribute(
			"webpreferences", "contextIsolation=yes, sandbox=yes",
		);
		wv.style.width = "100%";
		wv.style.height = "100%";
		wv.style.border = "none";

		dom.contentArea.appendChild(wv);
		dom.webview = wv;

		const stopSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
		const reloadSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3v4h-4"/><path d="M12.36 10a5 5 0 1 1-.96-5.36L13 7"/></svg>`;

		function updateNavState() {
			if (dom.navBack) dom.navBack.disabled = !wv.canGoBack();
			if (dom.navForward) dom.navForward.disabled = !wv.canGoForward();
		}

		// Replace buttons with clones to strip stale listeners from prior spawns
		for (const key of ["navBack", "navForward", "navReload"]) {
			if (dom[key]) {
				const fresh = dom[key].cloneNode(true);
				dom[key].replaceWith(fresh);
				dom[key] = fresh;
			}
		}

		if (dom.navBack) {
			dom.navBack.addEventListener("click", (e) => {
				e.stopPropagation();
				if (wv.canGoBack()) wv.goBack();
			});
		}
		if (dom.navForward) {
			dom.navForward.addEventListener("click", (e) => {
				e.stopPropagation();
				if (wv.canGoForward()) wv.goForward();
			});
		}
		if (dom.navReload) {
			dom.navReload.addEventListener("click", (e) => {
				e.stopPropagation();
				if (wv.isLoading()) {
					wv.stop();
				} else {
					wv.reload();
				}
			});
		}

		wv.addEventListener("dom-ready", () => {
			wv.setZoomFactor(0.85);
		});

		function clearErrors() {
			for (const el of [...dom.contentArea.querySelectorAll(".tile-load-error")]) {
				el.remove();
			}
		}

		wv.addEventListener("did-start-loading", () => {
			clearErrors();
			wv.style.display = "";
			if (dom.navReload) {
				dom.navReload.innerHTML = stopSvg;
				dom.navReload.title = "Stop";
			}
		});

		wv.addEventListener("did-stop-loading", () => {
			if (dom.navReload) {
				dom.navReload.innerHTML = reloadSvg;
				dom.navReload.title = "Reload";
			}
			updateNavState();
		});

		wv.addEventListener("did-navigate", (e) => {
			tile.url = e.url;
			if (dom.urlInput) dom.urlInput.value = e.url;
			updateTileTitle(dom, tile);
			updateNavState();
			saveCanvasDebounced();
		});

		wv.addEventListener("did-navigate-in-page", (e) => {
			if (e.isMainFrame) {
				tile.url = e.url;
				if (dom.urlInput) dom.urlInput.value = e.url;
				updateTileTitle(dom, tile);
				updateNavState();
				saveCanvasDebounced();
			}
		});

		wv.addEventListener("did-fail-load", (e) => {
			if (e.errorCode === -3) return;
			if (!e.isMainFrame) return;
			clearErrors();
			wv.style.display = "none";
			const errDiv = document.createElement("div");
			errDiv.className = "tile-load-error";
			errDiv.style.cssText = "padding:20px;color:#888;font-size:13px;";
			errDiv.textContent = `Failed to load: ${e.validatedURL || tile.url}`;
			dom.contentArea.appendChild(errDiv);
		});

		wv.addEventListener("render-process-gone", () => {
			const crashDiv = document.createElement("div");
			crashDiv.style.cssText = "padding:20px;color:#888;font-size:13px;";
			crashDiv.textContent = "Page crashed. Edit the URL and press Enter to reload.";
			if (dom.webview) {
				dom.contentArea.removeChild(dom.webview);
				dom.webview = null;
			}
			dom.contentArea.appendChild(crashDiv);
		});

		if (autoFocus) {
			wv.addEventListener("dom-ready", () => focusCanvasTile(tile.id));
		}
	}

	function createShapeTile(cx, cy, shapeType = "rect", shapeColor, shapeBorder, extra = {}) {
		// Set sensible default dimensions per shape type
		if (!extra.width && !extra.height) {
			if (shapeType === "arrow-right") { extra.width = 200; extra.height = 100; }
			else if (shapeType === "line") { extra.width = 240; extra.height = 30; }
		}
		const tile = createCanvasTile("shape", cx, cy, {
			...extra,
			shapeType,
			shapeColor: shapeColor || "rgba(80,140,255,0.25)",
			shapeBorder: shapeBorder || "rgba(80,140,255,0.8)",
		});
		const dom = tileDOMs.get(tile.id);
		if (dom) {
			dom.container.addEventListener("shape-change", () => saveCanvasDebounced());
		}
		saveCanvasImmediate();
		return tile;
	}

	function getEdgeAnchorPos(tile, edge) {
		const sx = tile.x * canvasScale + canvasX;
		const sy = tile.y * canvasScale + canvasY;
		const sw = tile.width * canvasScale;
		const sh = tile.height * canvasScale;
		switch (edge) {
			case "top": return { x: sx + sw / 2, y: sy };
			case "bottom": return { x: sx + sw / 2, y: sy + sh };
			case "left": return { x: sx, y: sy + sh / 2 };
			case "right": return { x: sx + sw, y: sy + sh / 2 };
			default: return { x: sx + sw / 2, y: sy + sh / 2 };
		}
	}

	function createCanvasTile(type, canvasXPos, canvasYPos, extra = {}) {
		const size = defaultSize(type);
		const tile = addTile({
			id: extra.id || generateId(),
			type,
			x: canvasXPos,
			y: canvasYPos,
			width: extra.width || size.width,
			height: extra.height || size.height,
			...extra,
		});
		snapToGrid(tile);
		window.shellApi.trackEvent("tile_created", { type });

		const dom = createTileDOM(tile, {
			onClose: (id) => closeCanvasTile(id),
			onFocus: (id, e) => {
				if (e && e.shiftKey) {
					toggleTileSelection(id);
					syncSelectionVisuals();
					return;
				}
				clearSelection();
				syncSelectionVisuals();
				focusCanvasTile(id, e);
			},
			onOpenInViewer: (id) => {
				const t = getTile(id);
				if (t?.filePath) {
					window.shellApi.trackEvent("tile_opened_in_viewer", { type: t.type });
					window.shellApi.selectFile(t.filePath);
				}
			},
			onNavigate: (id, url) => {
				const t = getTile(id);
				if (!t || t.type !== "browser") return;
				t.url = url;
				const d = tileDOMs.get(id);
				if (d?.webview) {
					d.contentArea.removeChild(d.webview);
					d.webview = null;
				}
				spawnBrowserWebview(t);
				saveCanvasImmediate();
			},
		});

		// Shared drag options for a tile
		function buildDragOpts(tile, dom) {
			return {
				viewport,
				onUpdate: repositionAllTiles,
				disablePointerEvents: (wvs) => {
					for (const w of wvs) w.webview.style.pointerEvents = "none";
				},
				enablePointerEvents: (wvs) => {
					for (const w of wvs) w.webview.style.pointerEvents = "";
				},
				getAllWebviews,
				getGroupDragContext: () => {
					const dragIds = new Set();
					if (isSelected(tile.id)) {
						for (const st of getSelectedTiles()) dragIds.add(st.id);
					}
					const pg = getGroupForTile(tile.id);
					if (pg) {
						for (const gid of pg.tileIds) dragIds.add(gid);
					}
					if (dragIds.size <= 1) return null;
					return [...dragIds].map((id) => {
						const t = getTile(id);
						return t ? { tile: t, container: tileDOMs.get(id)?.container, startX: t.x, startY: t.y } : null;
					}).filter(Boolean);
				},
				onShiftClick: (id) => {
					toggleTileSelection(id);
					syncSelectionVisuals();
				},
				onDrop: () => {
					updateZoneSummaries(tiles);
					saveCanvasDebounced();
					syncSelectionVisuals();
				},
				onFocus: (id, e) => focusCanvasTile(id, e),
				isSpaceHeld: () => spaceHeld,
				contentOverlay: dom.contentOverlay,
				isSelected: () => isSelected(tile.id),
			};
		}

		// Drag from title bar
		attachDrag(dom.titleBar, tile, buildDragOpts(tile, dom));

		// Sticky notes: also drag from content area
		if (tile.type === "text" && dom.contentArea) {
			attachDrag(dom.contentArea, tile, buildDragOpts(tile, dom));
		}

		attachResize(
			dom.container, tile, viewport,
			repositionAllTiles,
			getAllWebviews,
		);

		// Wire connection handles
		const connHandles = dom.container.querySelectorAll(".tile-conn-handle");
		for (const handle of connHandles) {
			handle.addEventListener("mousedown", (e) => {
				e.stopPropagation();
				e.preventDefault();
				const edge = handle.dataset.edge;
				const anchor = getEdgeAnchorPos(tile, edge);
				startConnectionDrag(tile.id, edge, anchor.x, anchor.y, canvasEl,
					(toTileId, toEdge) => {
						addConnection({ fromTileId: tile.id, fromEdge: edge, toTileId, toEdge });
						renderConnections(connections, tiles, canvasX, canvasY, canvasScale);
						saveCanvasDebounced();
					},
					() => {}
				);
			});
		}

		tileLayer.appendChild(dom.container);
		tileDOMs.set(tile.id, dom);
		positionTile(dom.container, tile, canvasX, canvasY, canvasScale);

		// Persist label changes triggered by inline rename (term tiles)
		dom.container.addEventListener("tile-label-change", () => {
			saveCanvasDebounced();
		});

		// Tile-specific right-click context menu
		dom.container.addEventListener("contextmenu", async (e) => {
			e.preventDefault();
			e.stopPropagation();

			const menuItems = [
				{ id: "duplicate", label: "Duplicate" },
				{ id: "bring-to-front", label: "Bring to Front" },
				{ separator: true },
				{ id: "delete", label: "Delete" },
			];
			const selected = await showCanvasContextMenu(e.clientX, e.clientY, menuItems);

			if (selected === "duplicate") {
				duplicateTile(tile);
			} else if (selected === "bring-to-front") {
				bringToFront(tile);
				tile._lastInteraction = Date.now();
				positionTile(dom.container, tile, canvasX, canvasY, canvasScale);
				saveCanvasDebounced();
			} else if (selected === "delete") {
				closeCanvasTile(tile.id);
			}
		});

		return tile;
	}

	function getViewportCenter() {
		const rect = canvasEl.getBoundingClientRect();
		const cx = (rect.width / 2 - canvasX) / canvasScale;
		const cy = (rect.height / 2 - canvasY) / canvasScale;
		return { cx, cy };
	}

	function createTextTile(cx, cy, content = "", noteColor = "#FFF3B0", fontSize = 14) {
		const tile = createCanvasTile("text", cx, cy, { content, noteColor, fontSize });
		const dom = tileDOMs.get(tile.id);
		if (!dom) return;

		// Apply background color
		dom.container.style.setProperty("--sticky-color", noteColor);

		// Set initial content and wire up input handler
		const textEl = dom.contentArea.querySelector(".sticky-text");
		const STICKY_FONT_SIZES = [10, 12, 14, 16, 20, 24, 32, 48];
		if (textEl) {
			textEl.textContent = content;
			textEl.style.fontSize = fontSize + "px";
			textEl.addEventListener("input", () => {
				tile.content = textEl.textContent;
				saveCanvasDebounced();
			});
			// Ctrl+Scroll to resize font
			textEl.addEventListener("wheel", (e) => {
				if (!e.ctrlKey && !e.metaKey) return;
				e.preventDefault();
				e.stopPropagation();
				const idx = STICKY_FONT_SIZES.indexOf(tile.fontSize || 14);
				const next = e.deltaY < 0
					? STICKY_FONT_SIZES[Math.min(idx + 1, STICKY_FONT_SIZES.length - 1)]
					: STICKY_FONT_SIZES[Math.max(idx - 1, 0)];
				tile.fontSize = next;
				textEl.style.fontSize = next + "px";
				saveCanvasDebounced();
			}, { passive: false });
		}

		// Wire up A- / A+ buttons
		const fontDownBtn = dom.container.querySelector(".sticky-font-down");
		const fontUpBtn = dom.container.querySelector(".sticky-font-up");
		const adjustFont = (dir) => {
			const idx = STICKY_FONT_SIZES.indexOf(tile.fontSize || 14);
			const next = dir > 0
				? STICKY_FONT_SIZES[Math.min(idx + 1, STICKY_FONT_SIZES.length - 1)]
				: STICKY_FONT_SIZES[Math.max(idx - 1, 0)];
			tile.fontSize = next;
			if (textEl) textEl.style.fontSize = next + "px";
			saveCanvasDebounced();
		};
		if (fontDownBtn) fontDownBtn.addEventListener("click", (e) => { e.stopPropagation(); adjustFont(-1); });
		if (fontUpBtn) fontUpBtn.addEventListener("click", (e) => { e.stopPropagation(); adjustFont(1); });

		saveCanvasImmediate();
	}

	function closeCanvasTile(id) {
		const dom = tileDOMs.get(id);

		if (dom) {
			dom.container.remove();
			tileDOMs.delete(id);
		}

		// Clear kanban card references to this tile
		const allCols = [...kanbanState.columns, ...(kanbanState.zoneColumns || [])];
		for (const col of allCols) {
			for (const card of col.cards) {
				if (card.tileId === id) {
					card.tileId = null;
					card.status = null;
				}
			}
		}

		deselectTile(id);
		removeTileFromGroup(id);
		for (const conn of getConnectionsForTile(id)) {
			removeConnection(conn.id);
		}
		const tile = getTile(id);
		if (tile) window.shellApi.trackEvent("tile_closed", { type: tile.type });
		removeTile(id);
		renderConnections(connections, tiles, canvasX, canvasY, canvasScale);
		saveCanvasImmediate();
	}

	function duplicateTile(src) {
		const extra = { width: src.width, height: src.height };
		if (src.filePath !== undefined) extra.filePath = src.filePath;
		if (src.folderPath !== undefined) extra.folderPath = src.folderPath;
		if (src.workspacePath !== undefined) extra.workspacePath = src.workspacePath;
		if (src.url !== undefined) extra.url = src.url;
		if (src.label !== undefined) extra.label = src.label;
		if (src.content !== undefined) extra.content = src.content;
		if (src.noteColor !== undefined) extra.noteColor = src.noteColor;
		if (src.fontSize !== undefined) extra.fontSize = src.fontSize;
		if (src.cwd !== undefined) extra.cwd = src.cwd;
		if (src.shapeType !== undefined) extra.shapeType = src.shapeType;
		if (src.shapeColor !== undefined) extra.shapeColor = src.shapeColor;
		if (src.shapeBorder !== undefined) extra.shapeBorder = src.shapeBorder;
		let newTile;
		if (src.type === "shape") {
			newTile = createShapeTile(src.x + 30, src.y + 30, src.shapeType, src.shapeColor, src.shapeBorder, extra);
		} else {
			newTile = createCanvasTile(src.type, src.x + 30, src.y + 30, extra);
		}
		if (src.type === "term") {
			spawnTerminalWebview(newTile, false);
		} else if (src.type === "text") {
			const dom = tileDOMs.get(newTile.id);
			if (dom) {
				const textEl = dom.contentArea.querySelector(".sticky-text");
				if (textEl) textEl.textContent = src.content || "";
			}
		}
		repositionAllTiles();
		saveCanvasDebounced();
		return newTile;
	}

	function clearTileFocusRing() {
		for (const [, d] of tileDOMs) {
			d.container.classList.remove("tile-focused");
		}
	}

	function blurCanvasTileGuest(id = focusedTileId) {
		if (!id) return;
		const dom = tileDOMs.get(id);
		if (!dom?.webview) return;
		try {
			dom.webview.send("shell-blur");
		} catch { }
		try {
			dom.webview.blur();
		} catch { }
	}

	function focusCanvasTile(id, mouseEvent) {
		const tile = getTile(id);
		if (tile) {
			bringToFront(tile);
			tile._lastInteraction = Date.now();
			repositionAllTiles();
		}
		const dom = tileDOMs.get(id);
		if (dom && dom.webview) {
			if (focusedTileId && focusedTileId !== id) {
				blurCanvasTileGuest(focusedTileId);
			}
			focusedTileId = id;
			clearTileFocusRing();
			dom.container.classList.add("tile-focused");
			dom.webview.focus();
			noteSurfaceFocus("canvas-tile");

			if (
				mouseEvent && mouseEvent.button === 0 &&
				tile.type !== "browser"
			) {
				forwardClickToWebview(dom.webview, mouseEvent);
			}
		}
	}

	function forwardClickToWebview(webview, mouseEvent) {
		const rect = webview.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		const x = Math.round(
			(mouseEvent.clientX - rect.left)
			* (webview.offsetWidth / rect.width),
		);
		const y = Math.round(
			(mouseEvent.clientY - rect.top)
			* (webview.offsetHeight / rect.height),
		);
		if (x < 0 || y < 0) return;
		if (x > webview.offsetWidth || y > webview.offsetHeight) return;
		webview.sendInputEvent({
			type: "mouseDown", x, y, button: "left", clickCount: 1,
		});
		webview.sendInputEvent({
			type: "mouseUp", x, y, button: "left", clickCount: 1,
		});
	}

	function createFileTile(type, cx, cy, filePath) {
		const tile = createCanvasTile(type, cx, cy, { filePath });
		const dom = tileDOMs.get(tile.id);
		if (!dom) return;

		if (type === "image") {
			const img = document.createElement("img");
			img.src = `collab-file://${filePath}`;
			img.style.width = "100%";
			img.style.height = "100%";
			img.style.objectFit = "contain";
			img.draggable = false;
			dom.contentArea.appendChild(img);
		} else {
			const wv = document.createElement("webview");
			const viewerConfig = configs.viewer;
			const mode = type === "note" ? "note" : "code";
			wv.setAttribute(
				"src",
				`${viewerConfig.src}?tilePath=${encodeURIComponent(filePath)}&tileMode=${mode}`,
			);
			wv.setAttribute("preload", viewerConfig.preload);
			wv.setAttribute(
				"webpreferences", "contextIsolation=yes, sandbox=yes",
			);
			wv.style.width = "100%";
			wv.style.height = "100%";
			wv.style.border = "none";

			dom.contentArea.appendChild(wv);
			dom.webview = wv;

		}

		saveCanvasImmediate();
	}

	// -- Edge indicators --

	const edgeIndicatorsEl = document.getElementById("edge-indicators");
	let activeTooltipEl = null;
	let panAnimRaf = null;
	/** @type {Map<string, HTMLElement>} */
	const edgeDotMap = new Map();
	/** @type {Map<string, number>} */
	const edgeDotFadeOuts = new Map();

	function getTileTypeLabel(type) {
		if (type === "image") return "img";
		return type;
	}

	function isFullyOffScreen(tile, vw, vh) {
		const left = tile.x * canvasScale + canvasX;
		const top = tile.y * canvasScale + canvasY;
		const right = left + tile.width * canvasScale;
		const bottom = top + tile.height * canvasScale;
		return right <= 0 || left >= vw || bottom <= 0 || top >= vh;
	}

	function rayRectIntersect(cx, cy, tx, ty, vw, vh) {
		const dx = tx - cx;
		const dy = ty - cy;
		const INSET = 8;
		let tMin = Infinity;
		let ix = cx;
		let iy = cy;

		// Left edge (x=0)
		if (dx < 0) {
			const t = (0 - cx) / dx;
			const y = cy + t * dy;
			if (t > 0 && t < tMin && y >= 0 && y <= vh) {
				tMin = t; ix = INSET; iy = y;
			}
		}
		// Right edge (x=vw)
		if (dx > 0) {
			const t = (vw - cx) / dx;
			const y = cy + t * dy;
			if (t > 0 && t < tMin && y >= 0 && y <= vh) {
				tMin = t; ix = vw - INSET; iy = y;
			}
		}
		// Top edge (y=0)
		if (dy < 0) {
			const t = (0 - cy) / dy;
			const x = cx + t * dx;
			if (t > 0 && t < tMin && x >= 0 && x <= vw) {
				tMin = t; ix = x; iy = INSET;
			}
		}
		// Bottom edge (y=vh)
		if (dy > 0) {
			const t = (vh - cy) / dy;
			const x = cx + t * dx;
			if (t > 0 && t < tMin && x >= 0 && x <= vw) {
				tMin = t; ix = x; iy = vh - INSET;
			}
		}

		return { x: ix, y: iy };
	}

	function panToTile(tile, fitToView = false) {
		if (panAnimRaf) {
			cancelAnimationFrame(panAnimRaf);
			panAnimRaf = null;
		}

		const vw = canvasEl.clientWidth;
		const vh = canvasEl.clientHeight;

		// Calculate target zoom: fit tile with padding so content is readable
		let targetScale = canvasScale;
		if (fitToView) {
			const pad = 80; // px padding around tile
			const scaleX = (vw - pad * 2) / tile.width;
			const scaleY = (vh - pad * 2) / tile.height;
			targetScale = Math.min(scaleX, scaleY, 1); // cap at 100%
			targetScale = Math.max(targetScale, 0.33);  // floor at 33%
		}

		const targetX = vw / 2 - (tile.x + tile.width / 2) * targetScale;
		const targetY = vh / 2 - (tile.y + tile.height / 2) * targetScale;
		const startX = canvasX;
		const startY = canvasY;
		const startScale = canvasScale;
		const startTime = performance.now();
		const DURATION = 400;

		function easeOut(t) {
			return 1 - Math.pow(1 - t, 3);
		}

		function step(now) {
			const elapsed = now - startTime;
			const t = Math.min(elapsed / DURATION, 1);
			const e = easeOut(t);
			canvasX = startX + (targetX - startX) * e;
			canvasY = startY + (targetY - startY) * e;
			if (fitToView) {
				canvasScale = startScale + (targetScale - startScale) * e;
			}
			updateCanvas();
			repositionAllTiles();

			if (t < 1) {
				panAnimRaf = requestAnimationFrame(step);
			} else {
				panAnimRaf = null;
				const dom = tileDOMs.get(tile.id);
				if (dom) {
					dom.container.classList.add("edge-indicator-highlight");
					setTimeout(() => {
						dom.container.classList.remove("edge-indicator-highlight");
					}, 600);
				}
			}
		}

		panAnimRaf = requestAnimationFrame(step);
	}

	function removeTooltip() {
		if (activeTooltipEl) {
			activeTooltipEl.remove();
			activeTooltipEl = null;
		}
	}

	function showTooltip(dot, tile, dotX, dotY, vw, vh) {
		removeTooltip();
		const tooltip = document.createElement("div");
		tooltip.className = "edge-dot-tooltip";
		const label = getTileLabel(tile);
		const typeStr = getTileTypeLabel(tile.type);
		tooltip.textContent = `${typeStr}: ${label.name}`;
		edgeIndicatorsEl.appendChild(tooltip);

		const PAD = 6;
		const tw = tooltip.offsetWidth;
		const th = tooltip.offsetHeight;

		let tx = dotX - tw / 2;
		let ty = dotY - th / 2;

		// Push inward from whichever edge the dot sits on
		if (dotX <= PAD + 4) tx = dotX + PAD;
		else if (dotX >= vw - PAD - 4) tx = dotX - PAD - tw;
		if (dotY <= PAD + 4) ty = dotY + PAD;
		else if (dotY >= vh - PAD - 4) ty = dotY - PAD - th;

		// Clamp within viewport
		tx = Math.max(PAD, Math.min(tx, vw - tw - PAD));
		ty = Math.max(PAD, Math.min(ty, vh - th - PAD));

		tooltip.style.left = `${tx}px`;
		tooltip.style.top = `${ty}px`;
		activeTooltipEl = tooltip;
	}

	function updateEdgeIndicators() {
		activeTooltipEl = null;

		const vw = canvasEl.clientWidth;
		const vh = canvasEl.clientHeight;
		const vcx = vw / 2;
		const vcy = vh / 2;

		const activeIds = new Set();

		for (const tile of tiles) {
			if (!isFullyOffScreen(tile, vw, vh)) continue;

			activeIds.add(tile.id);

			const tcx = tile.x * canvasScale + canvasX + (tile.width * canvasScale) / 2;
			const tcy = tile.y * canvasScale + canvasY + (tile.height * canvasScale) / 2;
			const { x: dotX, y: dotY } = rayRectIntersect(vcx, vcy, tcx, tcy, vw, vh);

			let dot = edgeDotMap.get(tile.id);
			if (dot) {
				// Cancel pending fade-out if tile went offscreen again
				const fadeTimer = edgeDotFadeOuts.get(tile.id);
				if (fadeTimer != null) {
					clearTimeout(fadeTimer);
					edgeDotFadeOuts.delete(tile.id);
					dot.classList.add("visible");
				}
			} else {
				dot = document.createElement("div");
				dot.className = "edge-dot";

				dot.addEventListener("mouseenter", () => {
					const ctx = dot._edgeCtx;
					if (ctx) showTooltip(dot, ctx.tile, ctx.dotX, ctx.dotY, ctx.vw, ctx.vh);
				});
				dot.addEventListener("mouseleave", removeTooltip);
				dot.addEventListener("click", () => {
					removeTooltip();
					const ctx = dot._edgeCtx;
					if (ctx) panToTile(ctx.tile);
				});

				edgeIndicatorsEl.appendChild(dot);
				edgeDotMap.set(tile.id, dot);
				requestAnimationFrame(() => dot.classList.add("visible"));
			}
			dot.style.left = `${dotX}px`;
			dot.style.top = `${dotY}px`;
			dot._edgeCtx = { tile, dotX, dotY, vw, vh };
		}

		// Fade out dots for tiles no longer offscreen
		for (const [id, dot] of edgeDotMap) {
			if (activeIds.has(id)) continue;
			if (edgeDotFadeOuts.has(id)) continue;
			dot.classList.remove("visible");
			edgeDotFadeOuts.set(id, setTimeout(() => {
				dot.remove();
				edgeDotMap.delete(id);
				edgeDotFadeOuts.delete(id);
			}, 200));
		}
	}

	// -- Pen overlay --
	initPenOverlay(canvasEl, {
		onStrokeEnd: () => saveCanvasDebounced(),
	});
	redrawPenOverlay(canvasX, canvasY, canvasScale);

	onCanvasUpdate = () => {
		repositionAllTiles();
		updateEdgeIndicators();
		redrawPenOverlay(canvasX, canvasY, canvasScale);
		saveCanvasDebounced();
	};

	updateEdgeIndicators();

	// -- Double-click to create terminal tile --

	canvasEl.addEventListener("dblclick", (e) => {
		if (
			spaceHeld ||
			isPanning ||
			Date.now() < suppressCanvasDblClickUntil
		) return;
		if (
			e.target !== canvasEl && e.target !== gridCanvas &&
			e.target !== tileLayer
		) return;

		const rect = canvasEl.getBoundingClientRect();
		const screenX = e.clientX - rect.left;
		const screenY = e.clientY - rect.top;
		const cx = (screenX - canvasX) / canvasScale;
		const cy = (screenY - canvasY) / canvasScale;

		const ws = getActiveWorkspace();
		const cwd = ws ? ws.path : undefined;
		const tile = createCanvasTile("term", cx, cy, { cwd });
		spawnTerminalWebview(tile, true);
		saveCanvasImmediate();
	});

	// -- Right-click context menu on canvas (custom HTML menu) --

	const ctxMenu = document.getElementById("canvas-context-menu");

	function showCanvasContextMenu(x, y, items) {
		ctxMenu.innerHTML = "";
		return new Promise((resolve) => {
			for (const item of items) {
				if (item.separator) {
					const sep = document.createElement("div");
					sep.className = "ctx-menu-separator";
					ctxMenu.appendChild(sep);
					continue;
				}
				const btn = document.createElement("button");
				btn.className = "ctx-menu-item";
				btn.textContent = item.label;
				btn.addEventListener("click", () => {
					hideCanvasContextMenu();
					resolve(item.id);
				});
				ctxMenu.appendChild(btn);
			}

			// Position menu, keeping it within viewport
			ctxMenu.style.left = `${x}px`;
			ctxMenu.style.top = `${y}px`;
			ctxMenu.classList.add("visible");

			// Adjust if overflowing viewport
			requestAnimationFrame(() => {
				const menuRect = ctxMenu.getBoundingClientRect();
				if (menuRect.right > window.innerWidth) {
					ctxMenu.style.left = `${x - menuRect.width}px`;
				}
				if (menuRect.bottom > window.innerHeight) {
					ctxMenu.style.top = `${y - menuRect.height}px`;
				}
			});

			function onDismiss(ev) {
				if (!ctxMenu.contains(ev.target)) {
					hideCanvasContextMenu();
					resolve(null);
				}
			}
			function onEscape(ev) {
				if (ev.key === "Escape") {
					hideCanvasContextMenu();
					resolve(null);
				}
			}
			function hideCanvasContextMenu() {
				ctxMenu.classList.remove("visible");
				document.removeEventListener("mousedown", onDismiss, true);
				document.removeEventListener("keydown", onEscape, true);
			}
			// Delay listener attachment so the triggering event doesn't immediately dismiss
			setTimeout(() => {
				document.addEventListener("mousedown", onDismiss, true);
				document.addEventListener("keydown", onEscape, true);
			}, 0);
		});
	}

	// -- Copy zone info helpers --

	/**
	 * Get structured content for all tiles in a zone.
	 * @param {string} zoneId
	 * @param {"all"|"5w1h"} section
	 * @returns {Promise<{ zone: object, tiles: Array<{ tile: object, content: string, w1hRow: string|null }> }>}
	 */
	async function getZoneTileContents(zoneId, section) {
		const zones = getZones();
		const zone = zones.find((z) => z.id === zoneId);
		if (!zone) return { zone: null, tiles: [] };

		const tileIds = getTilesInZone(zoneId, tiles);
		const results = [];

		for (const tileId of tileIds) {
			const tile = tiles.find(t => t.id === tileId);
			if (!tile) continue;

			const centerY = tile.y + tile.height / 2;
			const w1hStart = zone.y + ZONE_H;
			const isIn5w1h = centerY >= w1hStart && centerY <= zone.y + TOTAL_ZONE_H;

			// Determine 5W1H row if tile is in the strip
			let w1hRow = null;
			if (isIn5w1h) {
				const rowIndex = Math.floor((centerY - w1hStart) / W1H_ROW_H);
				w1hRow = W1H_LABELS[Math.min(rowIndex, W1H_LABELS.length - 1)];
			}

			// Filter based on section
			if (section === "5w1h" && !isIn5w1h) continue;

			// Get content based on tile type
			let content = "";
			const dom = tileDOMs.get(tileId);

			try {
				if (tile.type === "text") {
					// Sticky note
					const textEl = dom?.contentArea?.querySelector(".sticky-text");
					content = textEl ? textEl.textContent || "" : (tile.content || "");
				} else if (tile.type === "term") {
					// Terminal — read xterm buffer via webview executeJavaScript
					if (dom?.webview) {
						try {
							content = await dom.webview.executeJavaScript(`
								(() => {
									try {
										const term = window.__xterm;
										if (!term) return '[terminal not ready]';
										const buf = term.buffer.active;
										const lines = [];
										for (let i = 0; i < buf.length; i++) {
											const line = buf.getLine(i);
											if (line) lines.push(line.translateToString(true));
										}
										return lines.join('\\n').trimEnd();
									} catch (e) {
										return '[error reading terminal: ' + e.message + ']';
									}
								})()
							`);
						} catch {
							content = "[terminal webview not accessible]";
						}
					} else {
						content = "[terminal not loaded]";
					}
				} else if (tile.type === "shape") {
					// Shape tile
					const textEl = dom?.container?.querySelector(".shape-text");
					content = textEl ? textEl.textContent || "" : (tile.content || "");
				} else if (tile.type === "browser") {
					// Browser tile
					content = `URL: ${tile.url || "(none)"}`;
					if (tile.label) content += `\nLabel: ${tile.label}`;
				} else if (tile.type === "note" || tile.type === "code") {
					// File-based tiles
					content = `File: ${tile.filePath || "(none)"}`;
					if (tile.label) content += `\nLabel: ${tile.label}`;
				} else if (tile.type === "image") {
					content = `Image: ${tile.filePath || "(none)"}`;
				} else if (tile.type === "graph") {
					content = `Graph: ${tile.folderPath || "(none)"}`;
				}
			} catch {
				content = "[error reading tile content]";
			}

			results.push({ tile, content, w1hRow });
		}

		return { zone, tiles: results };
	}

	/**
	 * Format zone tile contents as readable text.
	 * @param {object} data - output from getZoneTileContents
	 * @param {"all"|"5w1h"} section
	 * @returns {string}
	 */
	function formatZoneInfo(data, section) {
		if (!data.zone) return "No zone found.";

		const typeLabels = {
			term: "Terminal", text: "Sticky", shape: "Shape",
			browser: "Browser", note: "Note", code: "Code",
			image: "Image", graph: "Graph",
		};

		const lines = [];
		lines.push(`=== ${data.zone.label} Zone ===`);
		lines.push("");

		if (section === "all") {
			// Workspace area tiles (non-5W1H)
			const workspaceTiles = data.tiles.filter((t) => !t.w1hRow);
			for (const { tile, content } of workspaceTiles) {
				const typeLabel = typeLabels[tile.type] || tile.type;
				const name = tile.label || getTileLabel(tile).name || "";
				const cwdPart = tile.cwd ? ` (${tile.cwd})` : "";
				lines.push(`[${typeLabel}] ${name}${cwdPart}`);
				if (content) {
					lines.push(content);
				}
				lines.push("");
			}
		}

		// 5W1H section
		const w1hTiles = data.tiles.filter((t) => t.w1hRow);
		if (w1hTiles.length > 0) {
			lines.push("--- 5W1H ---");
			for (const label of W1H_LABELS) {
				const rowTiles = w1hTiles.filter((t) => t.w1hRow === label);
				if (rowTiles.length === 0) continue;
				lines.push(`${label}:`);
				for (const { tile, content } of rowTiles) {
					const typeLabel = typeLabels[tile.type] || tile.type;
					const name = tile.label || getTileLabel(tile).name || "";
					const cwdPart = tile.cwd ? ` (${tile.cwd})` : "";
					lines.push(`  [${typeLabel}] ${name}${cwdPart}`);
					if (content) {
						const indented = content.split("\n").map((l) => `  ${l}`).join("\n");
						lines.push(indented);
					}
				}
			}
		}

		return lines.join("\n").trimEnd();
	}

	canvasEl.addEventListener("contextmenu", async (e) => {
		if (
			e.target !== canvasEl && e.target !== gridCanvas &&
			e.target !== tileLayer && e.target !== groupLayer &&
			!e.target.closest("#group-layer")
		) return;
		e.preventDefault();

		const rect = canvasEl.getBoundingClientRect();
		const screenX = e.clientX - rect.left;
		const screenY = e.clientY - rect.top;
		const cx = (screenX - canvasX) / canvasScale;
		const cy = (screenY - canvasY) / canvasScale;

		// Check if right-click is inside a zone
		const clickedZone = getZoneAtPoint(cx, cy);

		const menuItems = [
			{ id: "search-tiles", label: "Search tiles (\u2318K)" },
			{ id: "jump-zone", label: "Jump to zone (\u2318J)" },
			{ separator: true },
			{ id: "new-terminal", label: "\uFF0B Terminal" },
			{ id: "new-text", label: "\uFF0B Text file" },
			{ id: "new-sticky", label: "\uFF0B Sticky note" },
			{ id: "new-browser", label: "\uFF0B Browser" },
			{ separator: true },
			{ id: "new-shape-rect", label: "▭ Rectangle" },
			{ id: "new-shape-circle", label: "○ Circle" },
			{ id: "new-shape-diamond", label: "◇ Diamond" },
			{ id: "new-shape-triangle", label: "△ Triangle" },
			{ id: "new-shape-arrow", label: "→ Arrow" },
			{ id: "new-shape-line", label: "─ Line" },
		];

		// Add zone copy options if right-clicked inside a zone
		if (clickedZone) {
			menuItems.push({ separator: true });
			menuItems.push({ id: "copy-zone-info", label: `Copy zone info (${clickedZone.label})` });
			menuItems.push({ id: "copy-zone-5w1h", label: `Copy zone 5W1H (${clickedZone.label})` });
		}

		const selTiles = getSelectedTiles();
		if (selTiles.length >= 2 || (selTiles.length > 0 && selTiles.some((t) => getGroupForTile(t.id)))) {
			menuItems.push({ separator: true });
		}
		if (selTiles.length >= 2) {
			menuItems.push({ id: "group-tiles", label: "Group tiles (\u2318G)" });
		}
		if (selTiles.length > 0 && selTiles.some((t) => getGroupForTile(t.id))) {
			menuItems.push({ id: "ungroup-tiles", label: "Ungroup (\u2318\u21E7G)" });
		}
		const selected = await showCanvasContextMenu(e.clientX, e.clientY, menuItems);

		if (selected === "copy-zone-info" && clickedZone) {
			const data = await getZoneTileContents(clickedZone.id, "all");
			const text = formatZoneInfo(data, "all");
			await navigator.clipboard.writeText(text);
			flashZone(clickedZone.id);
		} else if (selected === "copy-zone-5w1h" && clickedZone) {
			const data = await getZoneTileContents(clickedZone.id, "5w1h");
			const text = formatZoneInfo(data, "5w1h");
			await navigator.clipboard.writeText(text);
			flashZone(clickedZone.id);
		} else if (selected === "search-tiles") {
			if (window.__openTileSearch) window.__openTileSearch();
		} else if (selected === "jump-zone") {
			if (window.__openZoneJumpPalette) window.__openZoneJumpPalette();
		} else if (selected === "new-terminal") {
			const ws = getActiveWorkspace();
			const cwd = ws ? ws.path : undefined;
			const tile = createCanvasTile("term", cx, cy, { cwd });
			spawnTerminalWebview(tile, true);
			saveCanvasImmediate();
		} else if (selected === "new-text") {
			const ws = getActiveWorkspace();
			if (!ws) return;
			const filePath = `${ws.path}/Note-${Date.now()}.md`;
			const writeResult = await window.shellApi.writeFile(filePath, "");
			if (!writeResult || !writeResult.ok) return;
			createFileTile("note", cx, cy, filePath);
		} else if (selected === "new-sticky") {
			createTextTile(cx, cy);
		} else if (selected === "new-browser") {
			const tile = createCanvasTile("browser", cx, cy);
			spawnBrowserWebview(tile, true);
			saveCanvasImmediate();
		} else if (selected && selected.startsWith("new-shape-")) {
			const SHAPE_MAP = { "new-shape-rect": "rect", "new-shape-circle": "circle", "new-shape-diamond": "diamond", "new-shape-triangle": "triangle", "new-shape-arrow": "arrow-right", "new-shape-line": "line" };
			createShapeTile(cx, cy, SHAPE_MAP[selected] || "rect");
		} else if (selected === "group-tiles") {
			groupSelectedTiles();
		} else if (selected === "ungroup-tiles") {
			ungroupSelectedTiles();
		}
	});

	// -- Dropdown --

	function openDropdown() {
		dropdownOpen = true;
		workspaceMenu.classList.remove("hidden");
		panelNav.classList.add("dropdown-open");
	}

	function closeDropdown() {
		dropdownOpen = false;
		workspaceMenu.classList.add("hidden");
		panelNav.classList.remove("dropdown-open");
	}

	function renderDropdown() {
		workspaceMenuItems.innerHTML = "";

		for (let i = 0; i < workspaces.length; i++) {
			const ws = workspaces[i];
			const parts = ws.path.split("/");
			const name = parts.pop() || ws.path;
			const parent = parts.length > 1
				? parts.slice(-2).join("/") + "/"
				: "";

			const item = document.createElement("button");
			item.type = "button";
			item.className =
				"dropdown-item" + (i === activeIndex ? " active" : "");
			item.title = ws.path;

			const labelSpan = document.createElement("span");
			labelSpan.className = "dropdown-item-label";

			const parentSpan = document.createElement("span");
			parentSpan.className = "dropdown-item-parent";
			parentSpan.textContent = parent;
			labelSpan.appendChild(parentSpan);

			const nameSpan = document.createElement("span");
			nameSpan.className = "dropdown-item-name";
			nameSpan.textContent = name;
			labelSpan.appendChild(nameSpan);

			item.appendChild(labelSpan);

			const removeBtn = document.createElement("button");
			removeBtn.type = "button";
			removeBtn.className = "ws-remove";
			removeBtn.innerHTML = "&times;";
			removeBtn.title = "Remove workspace";
			removeBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				closeDropdown();
				removeWorkspace(i);
			});
			item.appendChild(removeBtn);

			item.addEventListener("click", () => {
				closeDropdown();
				switchWorkspace(i);
			});

			workspaceMenuItems.appendChild(item);
		}

		if (activeIndex >= 0 && workspaces[activeIndex]) {
			const { parent, name } = splitFilepath(workspaces[activeIndex].path);
			workspaceTriggerParent.textContent = parent;
			workspaceTriggerName.textContent = name;
		} else {
			workspaceTriggerParent.textContent = "";
			workspaceTriggerName.textContent = "No workspace";
		}
	}

	workspaceTrigger.addEventListener("click", () => {
		if (dropdownOpen) closeDropdown();
		else openDropdown();
	});

	document.addEventListener("click", (e) => {
		if (!dropdownOpen) return;
		const dropdown =
			document.getElementById("workspace-dropdown");
		if (!dropdown.contains(e.target)) {
			closeDropdown();
		}
	});

	document.addEventListener("focusin", (event) => {
		if (!settingsModalOpen) return;
		if (settingsOverlay.contains(event.target)) return;
		focusSurface("settings");
	});

	wsAddOption.addEventListener("click", async () => {
		closeDropdown();
		const result = await window.shellApi.workspaceAdd();
		if (!result) return;

		const { workspaces: wsList, active } = result;

		if (workspaces.length < wsList.length) {
			const newPath = wsList[wsList.length - 1];
			addWorkspace(newPath);
		}

		switchWorkspace(active);
	});

	// -- Drag-and-drop handler --

	function handleDndMessage(channel, args) {
		if (channel === "dnd:dragenter") {
			dragCounter++;
			if (dragCounter === 1 && dragDropOverlay) {
				dragDropOverlay.classList.add("visible");
				for (const h of getAllWebviews()) {
					h.webview.style.pointerEvents = "none";
				}
			}
		} else if (channel === "dnd:dragleave") {
			dragCounter = Math.max(0, dragCounter - 1);
			if (dragCounter === 0 && dragDropOverlay) {
				dragDropOverlay.classList.remove("visible");
			}
		} else if (channel === "dnd:drop") {
			dragCounter = 0;
			if (dragDropOverlay) {
				dragDropOverlay.classList.remove("visible");
			}
			for (const h of getAllWebviews()) {
				h.webview.style.pointerEvents = "";
			}
		}
	}

	// -- Singleton webviews --

	const singletonViewer = createWebview(
		"viewer", configs.viewer, panelViewer, handleDndMessage,
	);
	singletonViewer.webview.style.display = "none";
	singletonViewer.webview.addEventListener("focus", () => {
		noteSurfaceFocus("viewer");
	});
	singletonViewer.setBeforeInput((event, detail) => {
		if (!isFocusSearchShortcut(detail)) return;
		event.preventDefault();
		handleShortcut("focus-search");
	});

	const singletonWebviews = {
		settings: createWebview(
			"settings", configs.settings,
			settingsModal, handleDndMessage,
		),
	};
	singletonWebviews.settings.webview.addEventListener("focus", () => {
		noteSurfaceFocus("settings");
	});
	window.addEventListener("focus", () => {
		noteSurfaceFocus("shell");
	});

	canvasEl.addEventListener("focus", () => {
		noteSurfaceFocus("canvas");
	});

	// Canvas starts focused
	canvasEl.classList.add("canvas-focused");

	// -- Empty state --

	let emptyStateEl = null;

	function showEmptyState() {
		if (emptyStateEl) return;
		emptyStateEl = document.createElement("div");
		emptyStateEl.id = "empty-state";
		emptyStateEl.textContent = "No workspace open";
		panelNav.appendChild(emptyStateEl);
	}

	function hideEmptyState() {
		if (emptyStateEl) {
			emptyStateEl.remove();
			emptyStateEl = null;
		}
	}

	// -- Workspace creation --

	function addWorkspace(path) {
		const navContainer = document.createElement("div");
		navContainer.className = "nav-container";
		navContainer.style.display = "none";
		panelNav.appendChild(navContainer);

		const navHandle = createWebview(
			"nav", configs.nav, navContainer, handleDndMessage,
		);
		navHandle.webview.addEventListener("focus", () => {
			noteSurfaceFocus("nav");
		});

		const wsData = { path, nav: navHandle, navContainer };
		workspaces.push(wsData);

		navHandle.send("workspace-changed", path);

		hideEmptyState();
		renderDropdown();
		return wsData;
	}

	// -- Workspace switching --

	function switchWorkspace(index) {
		if (
			index === activeIndex ||
			index < 0 ||
			index >= workspaces.length
		) {
			return;
		}

		if (activeIndex >= 0 && workspaces[activeIndex]) {
			workspaces[activeIndex].navContainer.style.display = "none";
		}

		activeIndex = index;
		workspaces[activeIndex].navContainer.style.display = "";

		const wsPath = workspaces[activeIndex].path;
		workspaces[activeIndex].nav.send(
			"workspace-changed", wsPath,
		);

		applyNavVisibility();
		renderDropdown();
		window.shellApi.workspaceSwitch(index);
	}

	// -- Workspace closing --

	async function removeWorkspace(index) {
		if (index < 0 || index >= workspaces.length) return;

		let result;
		try {
			result = await window.shellApi.workspaceRemove(index);
		} catch (err) {
			console.error("[shell] Failed to remove workspace:", err);
			return;
		}

		const ws = workspaces[index];
		ws.nav.webview.remove();
		ws.navContainer.remove();
		workspaces.splice(index, 1);

		activeIndex = -1;

		if (workspaces.length === 0) {
			showEmptyState();
		} else if (
			result.active >= 0 &&
			result.active < workspaces.length
		) {
			switchWorkspace(result.active);
		}

		renderDropdown();
	}

	// -- Toggle button positioning --

	function updateTogglePositions() {
		const panelsEl = document.getElementById("panels");
		const panelsRect = panelsEl.getBoundingClientRect();
		const centerY = panelsRect.top + panelsRect.height / 2;

		if (navVisible) {
			const navRect = panelNav.getBoundingClientRect();
			navToggle.style.left = `${navRect.right + 8}px`;
		} else {
			navToggle.style.left = `${panelsRect.left + 8}px`;
		}
		navToggle.style.top = `${centerY}px`;
		navToggle.style.transform = "translateY(-50%)";
	}

	const panelsEl = document.getElementById("panels");
	new ResizeObserver(updateTogglePositions).observe(panelsEl);

	// -- Panel visibility --

	function applyNavVisibility() {
		if (navVisible) {
			panelNav.style.display = "";
			navResizeHandle.style.display = "";
			const stored = loadPanelPref("panel-width-nav");
			const px = stored != null && stored > 1 ? stored : 280;
			panelNav.style.flex = `0 0 ${px}px`;
			panelViewer.style.flex = "1 1 0";
		} else {
			panelNav.style.display = "none";
			navResizeHandle.style.display = "none";
			panelViewer.style.flex = "";
		}
		navToggle.setAttribute(
			"aria-pressed", String(navVisible),
		);
		navToggle.setAttribute(
			"aria-label",
			navVisible ? "Hide Navigator" : "Show Navigator",
		);
		navToggle.title =
			navVisible ? "Hide Navigator" : "Show Navigator";
		if (navVisible) {
			requestAnimationFrame(() => {
				singletonViewer.send("nav-visibility", true);
			});
		} else {
			singletonViewer.send("nav-visibility", false);
		}
		updateTogglePositions();
	}

	// -- Restore canvas state --

	const savedState = await window.shellApi.canvasLoadState();
	if (savedState) {
		canvasX = savedState.viewport.panX;
		canvasY = savedState.viewport.panY;
		canvasScale = savedState.viewport.zoom;
		updateCanvas();

		for (const savedTile of savedState.tiles) {
			if (savedTile.type === "term") {
				const tile = createCanvasTile(
					"term", savedTile.x, savedTile.y, {
					id: savedTile.id,
					width: savedTile.width,
					height: savedTile.height,
					zIndex: savedTile.zIndex,
					ptySessionId: savedTile.ptySessionId,
					label: savedTile.label,
				},
				);
				spawnTerminalWebview(tile);
			} else if (savedTile.type === "graph" && savedTile.folderPath) {
				const tile = createCanvasTile(
					"graph", savedTile.x, savedTile.y, {
					id: savedTile.id,
					width: savedTile.width,
					height: savedTile.height,
					zIndex: savedTile.zIndex,
					folderPath: savedTile.folderPath,
					workspacePath: savedTile.workspacePath,
				},
				);
				spawnGraphWebview(tile);
			} else if (savedTile.type === "browser") {
				const tile = createCanvasTile(
					"browser", savedTile.x, savedTile.y, {
					id: savedTile.id,
					width: savedTile.width,
					height: savedTile.height,
					zIndex: savedTile.zIndex,
					url: savedTile.url,
				},
				);
				spawnBrowserWebview(tile);
			} else if (savedTile.type === "text") {
				createTextTile(
					savedTile.x, savedTile.y,
					savedTile.content || "",
					savedTile.noteColor || "#FFF3B0",
					savedTile.fontSize || 14,
				);
			} else if (savedTile.type === "shape") {
				createShapeTile(
					savedTile.x, savedTile.y,
					savedTile.shapeType || "rect",
					savedTile.shapeColor,
					savedTile.shapeBorder,
					{ id: savedTile.id, width: savedTile.width, height: savedTile.height, zIndex: savedTile.zIndex, content: savedTile.content },
				);
			} else if (savedTile.filePath) {
				createFileTile(
					savedTile.type, savedTile.x, savedTile.y, savedTile.filePath,
				);
			}
		}

		// Restore persistent groups
		if (savedState.groups) {
			groupsFromJSON(savedState.groups);
			renderGroups(groups, tiles, canvasX, canvasY, canvasScale);
		}

		// Restore pen strokes
		if (savedState.penStrokes) {
			penStrokesFromJSON(savedState.penStrokes);
			redrawPenOverlay(canvasX, canvasY, canvasScale);
		}

		// Restore connections
		if (savedState.connections) {
			connectionsFromJSON(savedState.connections);
			renderConnections(connections, tiles, canvasX, canvasY, canvasScale);
		}

		// Restore scratchpad
		if (savedState.scratchpad) {
			restoreScratchpadState(savedState.scratchpad);
		}

		// Restore kanban
		if (savedState.kanban) {
			restoreKanbanState(savedState.kanban);
		}

		// All data restored — enable saving
		canvasRestoreComplete = true;
	} else {
		// No saved state (fresh start) — enable saving
		canvasRestoreComplete = true;
	}

	// -- Initialize workspaces --

	const { workspaces: wsPaths, active } = workspaceData;

	for (const path of wsPaths) {
		addWorkspace(path);
	}

	if (workspaces.length === 0) {
		showEmptyState();
	} else if (active >= 0 && active < workspaces.length) {
		switchWorkspace(active);
	} else if (workspaces.length > 0) {
		switchWorkspace(0);
	}

	applyNavVisibility();

	// -- Nav resize --

	setupResize(
		navResizeHandle, panelNav, panelViewer,
		"nav", getAllWebviews, () => {
			updateTogglePositions();
		},
	);

	// -- Update pill --

	/** @type {{ status: string, progress?: number, version?: string, error?: string }} */
	let updateState = { status: "idle" };
	const isDevMode = import.meta.env.DEV;

	function renderUpdatePill() {
		if (updateState.status === "downloading") {
			updatePill.style.display = "inline-block";
			updatePill.classList.add("is-downloading");
			updatePill.classList.remove("is-error");
			updatePill.textContent = `Updating ${Math.round(updateState.progress ?? 0)}%`;
			updatePill.title = "Downloading update...";
		} else if (updateState.status === "installing") {
			updatePill.style.display = "inline-block";
			updatePill.classList.add("is-downloading");
			updatePill.classList.remove("is-error");
			updatePill.textContent = "Installing…";
			updatePill.title = "Extracting and verifying update...";
		} else if (updateState.status === "available") {
			updatePill.style.display = "inline-block";
			updatePill.classList.remove("is-downloading");
			updatePill.classList.remove("is-error");
			updatePill.textContent = "Download & Update";
			updatePill.title = `Click to download v${updateState.version}`;
		} else if (updateState.status === "ready") {
			updatePill.style.display = "inline-block";
			updatePill.classList.remove("is-downloading");
			updatePill.classList.remove("is-error");
			updatePill.textContent = "Update & Restart";
			updatePill.title = `Click to install v${updateState.version}`;
		} else if (updateState.status === "error") {
			updatePill.style.display = "inline-block";
			updatePill.classList.remove("is-downloading");
			updatePill.classList.add("is-error");
			updatePill.textContent = "Update failed — retry";
			updatePill.title = updateState.error || "Update failed";
		} else if (isDevMode) {
			updatePill.style.display = "inline-block";
			updatePill.classList.remove("is-downloading");
			updatePill.classList.remove("is-error");
			updatePill.textContent = updateState.status === "checking" ? "Checking…" : "Check for Update";
			updatePill.title = "Click to check for updates";
		} else {
			updatePill.style.display = "none";
			updatePill.classList.remove("is-downloading");
			updatePill.classList.remove("is-error");
		}
	}

	window.shellApi.updateGetStatus().then((s) => {
		updateState = s;
		renderUpdatePill();
	}).catch(() => {});

	window.shellApi.onUpdateStatus((s) => {
		updateState = s;
		renderUpdatePill();
	});

	updatePill.addEventListener("click", () => {
		if (updateState.status === "downloading" || updateState.status === "installing") {
			return;
		}
		if (updateState.status === "available") {
			window.shellApi.updateDownload();
		} else if (updateState.status === "ready") {
			window.shellApi.updateInstall();
		} else if (updateState.status === "error") {
			updateState = { status: "idle" };
			renderUpdatePill();
			window.shellApi.updateCheck();
		} else if (isDevMode && (updateState.status === "idle" || updateState.status === "checking")) {
			window.shellApi.updateCheck();
		}
	});

	// -- Panel toggle --

	navToggle.addEventListener("click", () => {
		navVisible = !navVisible;
		savePanelVisible("nav", navVisible);
		applyNavVisibility();
	});

	// -- Settings --

	settingsBackdrop.addEventListener("click", () => {
		window.shellApi.closeSettings();
	});

	window.shellApi.onSettingsToggle((action) => {
		const open = action === "open";
		settingsModalOpen = open;
		if (open) {
			blurNonModalSurfaces();
		} else {
			singletonWebviews.settings.webview.blur();
		}
		setUnderlyingShellInert(open);
		settingsOverlay.classList.toggle("visible", open);
		if (open) {
			focusSurface("settings");
			return;
		}
		focusSurface(lastNonModalSurface);
	});

	// -- IPC forwarding --

	window.shellApi.onForwardToWebview(
		(target, channel, ...args) => {
			if (target === "settings") {
				singletonWebviews.settings.send(channel, ...args);
			} else if (target === "nav") {
				if (activeIndex >= 0 && workspaces[activeIndex]) {
					workspaces[activeIndex].nav.send(channel, ...args);
				}
			} else if (
				target === "viewer" ||
				target.startsWith("viewer:")
			) {
				if (channel === "file-selected") {
					const hasSelectedFile = !!args[0];
					if (!hasSelectedFile) {
						singletonViewer.webview.blur();
					}
					singletonViewer.webview.style.display =
						hasSelectedFile ? "" : "none";
					if (!hasSelectedFile) {
						focusSurface(lastNonModalSurface);
					}
				}
				if (channel === "file-renamed") {
					const [oldPath, newPath] = args;
					let anyUpdated = false;
					for (const t of tiles) {
						if (t.filePath === oldPath) {
							t.filePath = newPath;
							t.type = inferTileType(newPath);
							const dom = tileDOMs.get(t.id);
							if (dom) updateTileTitle(dom, t);
							anyUpdated = true;
						}
						if (t.type === "graph" && t.folderPath && (t.folderPath === oldPath || t.folderPath.startsWith(oldPath + "/"))) {
							t.folderPath = newPath + t.folderPath.slice(oldPath.length);
							const dom = tileDOMs.get(t.id);
							if (dom) {
								updateTileTitle(dom, t);
								if (dom.webview) dom.webview.send("scope-changed", t.folderPath);
							}
							anyUpdated = true;
						}
					}
					if (anyUpdated) saveCanvasDebounced();
				}
				if (channel === "files-deleted") {
					const deleted = new Set(args[0]);
					for (const t of [...tiles]) {
						if (t.filePath && deleted.has(t.filePath)) {
							closeCanvasTile(t.id);
						}
						if (t.type === "graph" && t.folderPath && deleted.has(t.folderPath)) {
							closeCanvasTile(t.id);
						}
					}
				}
				if (channel !== "workspace-changed") {
					singletonViewer.send(channel, ...args);
				}
				// Broadcast events to canvas tile webviews
				if (
					channel === "fs-changed" ||
					channel === "file-renamed" ||
					channel === "wikilinks-updated" ||
					channel.startsWith("agent:") ||
					channel === "replay:data"
				) {
					for (const [, dom] of tileDOMs) {
						if (dom.webview) dom.webview.send(channel, ...args);
					}
				}
			} else if (target === "canvas") {
				if (channel === "open-terminal") {
					const cwd = args[0];
					const size = defaultSize("term");
					const rect = canvasEl.getBoundingClientRect();
					const cx = (rect.width / 2 - canvasX) / canvasScale - size.width / 2;
					const cy = (rect.height / 2 - canvasY) / canvasScale - size.height / 2;
					const tile = createCanvasTile("term", cx, cy, { cwd });
					spawnTerminalWebview(tile, true);
					saveCanvasImmediate();
				}
				if (channel === "open-browser-tile") {
					const url = args[0];
					const sourceWcId = args[1];
					let srcTile = null;
					for (const [id, d] of tileDOMs) {
						if (d.webview && d.webview.getWebContentsId() === sourceWcId) {
							srcTile = getTile(id);
							break;
						}
					}
					const x = srcTile ? srcTile.x + 40 : 0;
					const y = srcTile ? srcTile.y + 40 : 0;
					const extra = { url };
					if (srcTile) {
						extra.width = srcTile.width;
						extra.height = srcTile.height;
					}
					const newTile = createCanvasTile("browser", x, y, extra);
					spawnBrowserWebview(newTile, true);
					saveCanvasImmediate();
				}
				if (channel === "create-graph-tile") {
					const folderPath = args[0];
					const size = defaultSize("graph");
					const rect = canvasEl.getBoundingClientRect();
					const cx = (rect.width / 2 - canvasX) / canvasScale - size.width / 2;
					const cy = (rect.height / 2 - canvasY) / canvasScale - size.height / 2;
					createGraphTile(cx, cy, folderPath);
				}
			}
		},
	);

	// -- Canvas pinch from tile webviews --

	window.shellApi.onCanvasPinch((deltaY) => {
		const rect = canvasEl.getBoundingClientRect();
		applyZoom(deltaY, rect.width / 2, rect.height / 2);
	});

	// -- Marquee selection --

	attachMarquee(canvasEl, {
		viewport,
		tiles: () => tiles,
		onSelectionChange: (ids) => {
			if (shiftHeld) {
				for (const id of ids) selectTile(id);
			} else {
				clearSelection();
				for (const id of ids) selectTile(id);
			}
			syncSelectionVisuals();
			if (ids.size === 0) {
				blurCanvasTileGuest();
				clearTileFocusRing();
				focusedTileId = null;
				noteSurfaceFocus("canvas");
			}
		},
		isShiftHeld: () => shiftHeld,
		isSpaceHeld: () => spaceHeld,
		getAllWebviews,
	});

	// -- Selection keyboard handlers --

	window.addEventListener("keydown", (e) => {
		if (isScratchpadOpen) return;
		// Cmd+G = group selected tiles
		if (e.key === "g" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
			if (getSelectedTiles().length >= 2) {
				e.preventDefault();
				groupSelectedTiles();
				return;
			}
		}
		// Cmd+Shift+G = ungroup selected tiles
		if (e.key === "g" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
			const sel = getSelectedTiles();
			if (sel.length > 0 && sel.some((t) => getGroupForTile(t.id))) {
				e.preventDefault();
				ungroupSelectedTiles();
				return;
			}
		}

		// Cmd+Shift+A: Auto-layout grid
		if (e.key === "a" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
			e.preventDefault();
			executeCanvasRpc("autoLayout", { algorithm: "grid", options: { columns: 3 } });
			return;
		}

		// 1-5: Jump to zone (no input focused)
		if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
			&& e.key >= "1" && e.key <= "5"
			&& document.activeElement?.tagName !== "INPUT"
			&& document.activeElement?.tagName !== "TEXTAREA") {
			const zones = getZones();
			const idx = parseInt(e.key) - 1;
			if (idx < zones.length) {
				e.preventDefault();
				executeCanvasRpc("jumpToZone", { zoneId: zones[idx].id });
				return;
			}
		}

		// Arrow keys: move selected tiles
		if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
			const sel = getSelectedTiles();
			if (sel.length > 0) {
				e.preventDefault();
				const step = e.shiftKey ? 40 : 20;
				for (const t of sel) {
					if (e.key === "ArrowUp") t.y -= step;
					if (e.key === "ArrowDown") t.y += step;
					if (e.key === "ArrowLeft") t.x -= step;
					if (e.key === "ArrowRight") t.x += step;
				}
				repositionAllTiles();
				saveCanvasDebounced();
				return;
			}
		}

		if (e.key === "Escape" && getSelectedTiles().length > 0) {
			clearSelection();
			syncSelectionVisuals();
			return;
		}

		if (
			(e.key === "Backspace" || e.key === "Delete") &&
			(activeSurface === "canvas" || activeSurface === "canvas-tile")
		) {
			const selected = getSelectedTiles();
			if (selected.length === 0) return;

			const count = selected.length;
			window.shellApi.showConfirmDialog({
				message: count === 1 ? "Delete this tile?" : `Delete ${count} tiles?`,
				detail: "This cannot be undone.",
				buttons: ["Cancel", "Delete"],
			}).then((response) => {
				if (response !== 1) return;
				for (const t of selected) closeCanvasTile(t.id);
				clearSelection();
				syncSelectionVisuals();
			});
		}
	});

	// -- Copy / Paste (Cmd+C / Cmd+V) --

	let clipboardTiles = [];
	let pasteOffset = 0;

	window.addEventListener("keydown", async (e) => {
		if (isScratchpadOpen) return;
		const isMac = navigator.platform.toUpperCase().includes("MAC");
		const mod = isMac ? e.metaKey : e.ctrlKey;
		if (!mod) return;

		// Don't interfere with text editing (sticky notes, inputs)
		const focused = document.activeElement;
		const isEditingText =
			focused &&
			(focused.isContentEditable ||
				focused.tagName === "INPUT" ||
				focused.tagName === "TEXTAREA");
		if (isEditingText) return;

		if (
			e.key === "c" &&
			(activeSurface === "canvas" || activeSurface === "canvas-tile")
		) {
			const selected = getSelectedTiles();
			if (selected.length === 0) return;
			e.preventDefault();
			clipboardTiles = selected.map((t) => ({ ...t }));
			pasteOffset = 0;
			return;
		}

		if (
			e.key === "v" &&
			clipboardTiles.length > 0 &&
			(activeSurface === "canvas" || activeSurface === "canvas-tile")
		) {
			e.preventDefault();
			pasteOffset += 40;
			clearSelection();
			for (const src of clipboardTiles) {
				const newX = src.x + pasteOffset;
				const newY = src.y + pasteOffset;
				const extra = { width: src.width, height: src.height };
				if (src.filePath !== undefined) extra.filePath = src.filePath;
				if (src.folderPath !== undefined) extra.folderPath = src.folderPath;
				if (src.workspacePath !== undefined) extra.workspacePath = src.workspacePath;
				if (src.url !== undefined) extra.url = src.url;
				if (src.label !== undefined) extra.label = src.label;
				if (src.content !== undefined) extra.content = src.content;
				if (src.noteColor !== undefined) extra.noteColor = src.noteColor;
				if (src.fontSize !== undefined) extra.fontSize = src.fontSize;
				if (src.cwd !== undefined) extra.cwd = src.cwd;
				if (src.shapeType !== undefined) extra.shapeType = src.shapeType;
				if (src.shapeColor !== undefined) extra.shapeColor = src.shapeColor;
				if (src.shapeBorder !== undefined) extra.shapeBorder = src.shapeBorder;
				let newTile;
				if (src.type === "shape") {
					newTile = createShapeTile(newX, newY, src.shapeType, src.shapeColor, src.shapeBorder, extra);
				} else {
					newTile = createCanvasTile(src.type, newX, newY, extra);
				}
				if (src.type === "term") {
					spawnTerminalWebview(newTile, false);
				}
				selectTile(newTile.id);
			}
			repositionAllTiles();
			syncSelectionVisuals();
			saveCanvasDebounced();
			return;
		}
	});

	// -- Cmd+D: Duplicate focused tile --
	// -- Cmd+0: Reset zoom to 100% --

	window.addEventListener("keydown", (e) => {
		if (isScratchpadOpen) return;
		const isMac = navigator.platform.toUpperCase().includes("MAC");
		const mod = isMac ? e.metaKey : e.ctrlKey;
		if (!mod) return;

		// Don't interfere with text editing
		const focused = document.activeElement;
		const isEditingText =
			focused &&
			(focused.isContentEditable ||
				focused.tagName === "INPUT" ||
				focused.tagName === "TEXTAREA");
		if (isEditingText) return;

		// Cmd+D: Duplicate focused tile
		if (e.key === "d" && (activeSurface === "canvas" || activeSurface === "canvas-tile")) {
			e.preventDefault();
			const tileToDup = focusedTileId ? getTile(focusedTileId) : null;
			if (tileToDup) {
				duplicateTile(tileToDup);
			}
			return;
		}

		// Cmd+0: Reset zoom to 100%
		if (e.key === "0") {
			e.preventDefault();
			const prevScale = canvasScale;
			canvasScale = 1;
			const cw = canvasEl.clientWidth / 2;
			const ch = canvasEl.clientHeight / 2;
			const ratio = canvasScale / prevScale - 1;
			canvasX -= (cw - canvasX) * ratio;
			canvasY -= (ch - canvasY) * ratio;
			showZoomIndicator();
			updateCanvas();
			repositionAllTiles();
			return;
		}

		// Cmd+= / Cmd+-: Zoom in/out (centered on viewport)
		if (e.key === "=" || e.key === "+" || e.key === "-") {
			e.preventDefault();
			const cw = canvasEl.clientWidth / 2;
			const ch = canvasEl.clientHeight / 2;
			const delta = (e.key === "-") ? 120 : -120;
			applyZoom(delta, cw, ch);
			repositionAllTiles();
			return;
		}
	});

	// -- Shift+scroll passthrough --
	// When Shift is held, disable pointer-events on tile webviews so
	// two-finger scroll falls through to the canvas pan handler.

	let shiftHeld = false;

	window.addEventListener("keydown", (e) => {
		if (e.key === "Shift" && !shiftHeld) {
			shiftHeld = true;
			canvasEl.classList.add("shift-held");
		}
	});

	window.addEventListener("keyup", (e) => {
		if (e.key === "Shift") {
			shiftHeld = false;
			canvasEl.classList.remove("shift-held");
		}
	});

	window.addEventListener("blur", () => {
		if (shiftHeld) {
			shiftHeld = false;
			canvasEl.classList.remove("shift-held");
		}
	});

	// -- Space+click and middle-click pan --

	let spaceHeld = false;
	let isPanning = false;
	let suppressCanvasDblClickUntil = 0;

	window.addEventListener("keydown", (e) => {
		if (isScratchpadOpen) return;
		if (e.code === "Space" && !e.target.closest?.("webview")) {
			// Don't intercept space when typing in an input or contenteditable
			const focused = document.activeElement;
			if (focused && (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA" || focused.isContentEditable)) return;
			e.preventDefault();
			if (!e.repeat && !spaceHeld) {
				spaceHeld = true;
				canvasEl.classList.add("space-held");
				for (const h of getAllWebviews()) {
					h.webview.blur();
				}
			}
		}
	});

	window.addEventListener("keyup", (e) => {
		if (e.code === "Space") {
			spaceHeld = false;
			if (!isPanning) {
				canvasEl.classList.remove("space-held");
			}
		}
	});

	window.addEventListener("blur", () => {
		if (spaceHeld) {
			spaceHeld = false;
			canvasEl.classList.remove("space-held", "panning");
		}
	});

	canvasEl.addEventListener("mousedown", (e) => {
		const shouldPan = e.button === 1 || (e.button === 0 && spaceHeld);
		if (!shouldPan) return;

		e.preventDefault();
		suppressCanvasDblClickUntil =
			Date.now() + CANVAS_DBLCLICK_SUPPRESS_MS;
		isPanning = true;
		canvasEl.classList.add("panning");

		const startMX = e.clientX;
		const startMY = e.clientY;
		const startPanX = canvasX;
		const startPanY = canvasY;

		for (const h of getAllWebviews()) {
			h.webview.style.pointerEvents = "none";
		}

		function onMove(ev) {
			canvasX = startPanX + (ev.clientX - startMX);
			canvasY = startPanY + (ev.clientY - startMY);
			updateCanvas();
		}

		function onUp() {
			isPanning = false;
			canvasEl.classList.remove("panning");
			if (!spaceHeld) canvasEl.classList.remove("space-held");
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			for (const h of getAllWebviews()) {
				h.webview.style.pointerEvents = "";
			}
		}

		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	});

	// -- Shortcuts --

	function focusActiveNavSearch() {
		const workspace = getActiveWorkspace();
		if (!workspace) return;

		focusSurface("nav");
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				workspace.nav.send("focus-search");
			});
		});
	}

	function handleShortcut(action) {
		if (settingsModalOpen && action !== "toggle-settings") {
			focusSurface("settings");
			return;
		}
		if (action === "toggle-settings") {
			window.shellApi.toggleSettings();
		} else if (action === "toggle-nav") {
			navVisible = !navVisible;
			savePanelVisible("nav", navVisible);
			applyNavVisibility();
		} else if (action === "close-tab") {
			if (activeIndex >= 0 && activeIndex < workspaces.length) {
				removeWorkspace(activeIndex);
			}
		} else if (action === "focus-search") {
			if (activeIndex >= 0 && workspaces[activeIndex]) {
				if (!navVisible) {
					navVisible = true;
					savePanelVisible("nav", navVisible);
					applyNavVisibility();
				}
				focusActiveNavSearch();
			}
		} else if (action === "add-workspace") {
			wsAddOption.click();
		} else if (action.startsWith("switch-tab-")) {
			const idx = parseInt(action.slice(11), 10) - 1;
			if (idx >= 0 && idx < workspaces.length) {
				switchWorkspace(idx);
			}
		}
	}

	window.shellApi.onShortcut(handleShortcut);

	window.addEventListener("keydown", (event) => {
		if (!isFocusSearchShortcut(event)) return;
		event.preventDefault();
		handleShortcut("focus-search");
	});

	// -- Browser tile Cmd+L focus URL --

	window.shellApi.onBrowserTileFocusUrl((webContentsId) => {
		for (const [id, dom] of tileDOMs) {
			if (!dom.webview || !dom.urlInput) continue;
			if (dom.webview.getWebContentsId() === webContentsId) {
				dom.urlInput.readOnly = false;
				dom.urlInput.focus();
				dom.urlInput.select();
				break;
			}
		}
	});

	// -- Loading --

	window.shellApi.onLoadingStatus((message) => {
		loadingStatusEl.textContent = message;
	});

	window.shellApi.onLoadingDone(() => {
		loadingOverlay.classList.add("fade-out");
		setTimeout(() => {
			loadingOverlay.remove();
		}, 350);
		checkFirstLaunchDialog();
	});

	// -- Drag-and-drop (window-level) --

	window.addEventListener("dragenter", (e) => {
		e.preventDefault();
		dragCounter++;
		if (dragCounter === 1 && dragDropOverlay) {
			dragDropOverlay.classList.add("visible");
		}
	});

	window.addEventListener("dragover", (e) => {
		e.preventDefault();
	});

	window.addEventListener("dragleave", (e) => {
		e.preventDefault();
		dragCounter = Math.max(0, dragCounter - 1);
		if (dragCounter === 0 && dragDropOverlay) {
			dragDropOverlay.classList.remove("visible");
		}
	});

	window.addEventListener("drop", async (e) => {
		e.preventDefault();
		dragCounter = 0;
		if (dragDropOverlay) {
			dragDropOverlay.classList.remove("visible");
		}

		const rect = canvasEl.getBoundingClientRect();
		const screenX = e.clientX - rect.left;
		const screenY = e.clientY - rect.top;
		const cx = (screenX - canvasX) / canvasScale;
		const cy = (screenY - canvasY) / canvasScale;

		let paths = [];

		if (window.shellApi.getDragPaths) {
			try {
				paths = await window.shellApi.getDragPaths();
			} catch {
				// getDragPaths may not be available
			}
		}

		if (paths.length === 0 && e.dataTransfer?.files) {
			for (let i = 0; i < e.dataTransfer.files.length; i++) {
				const p = e.dataTransfer.files[i].path;
				if (p) paths.push(p);
			}
		}

		if (paths.length === 0) return;

		const viewerRect = panelViewer.getBoundingClientRect();
		if (e.clientX < viewerRect.left) return;

		for (let i = 0; i < paths.length; i++) {
			const filePath = paths[i];
			const type = inferTileType(filePath);
			createFileTile(type, cx + i * 30, cy + i * 30, filePath);
		}
	});

	if (dragDropOverlay) {
		dragDropOverlay.addEventListener("transitionend", () => {
			if (!dragDropOverlay.classList.contains("visible")) {
				for (const h of getAllWebviews()) {
					h.webview.style.pointerEvents = "";
				}
			}
		});
	}

	// -- Canvas RPC handler --

	function findAutoPlacement(width, height) {
		const CANVAS_W = 4000;
		const CANVAS_H = 3000;
		const STEP = 20;

		for (let y = 0; y <= CANVAS_H - height; y += STEP) {
			for (let x = 0; x <= CANVAS_W - width; x += STEP) {
				const overlaps = tiles.some((t) =>
					x < t.x + t.width &&
					x + width > t.x &&
					y < t.y + t.height &&
					y + height > t.y
				);
				if (!overlaps) return { x, y };
			}
		}

		const last = tiles[tiles.length - 1];
		if (last) return { x: last.x + 40, y: last.y + 40 };
		return { x: 40, y: 40 };
	}

	function executeCanvasRpc(method, params) {
		switch (method) {
			case "tileList": {
				return {
					tiles: tiles.map((t) => ({
						id: t.id,
						type: t.type,
						filePath: t.filePath,
						folderPath: t.folderPath,
						position: { x: t.x, y: t.y },
						size: { width: t.width, height: t.height },
					})),
				};
			}
			case "tileAdd": {
				const tileType = params.tileType || "note";
				const size = defaultSize(tileType);
				const pos = params.position
					? { x: params.position.x, y: params.position.y }
					: findAutoPlacement(size.width, size.height);

				let tile;
				if (tileType === "graph") {
					const wsPath = workspaces[activeIndex]?.path ?? "";
					tile = createCanvasTile("graph", pos.x, pos.y, {
						folderPath: params.filePath,
						workspacePath: wsPath,
					});
					spawnGraphWebview(tile);
				} else {
					tile = createCanvasTile(tileType, pos.x, pos.y, {
						filePath: params.filePath,
					});
					const dom = tileDOMs.get(tile.id);
					if (dom && tileType === "image") {
						const img = document.createElement("img");
						img.src = `collab-file://${params.filePath}`;
						img.style.width = "100%";
						img.style.height = "100%";
						img.style.objectFit = "contain";
						img.draggable = false;
						dom.contentArea.appendChild(img);
					} else if (dom) {
						const wv = document.createElement("webview");
						const viewerConfig = configs.viewer;
						const mode = tileType === "note" ? "note" : "code";
						wv.setAttribute(
							"src",
							`${viewerConfig.src}?tilePath=${encodeURIComponent(params.filePath)}&tileMode=${mode}`,
						);
						wv.setAttribute("preload", viewerConfig.preload);
						wv.setAttribute(
							"webpreferences",
							"contextIsolation=yes, sandbox=yes",
						);
						wv.style.width = "100%";
						wv.style.height = "100%";
						wv.style.border = "none";
						dom.contentArea.appendChild(wv);
						dom.webview = wv;
					}
				}
				saveCanvasImmediate();
				return { tileId: tile.id };
			}
			case "tileRemove": {
				const tile = getTile(params.tileId);
				if (!tile) throw Object.assign(new Error("Tile not found"), { code: 3 });
				closeCanvasTile(params.tileId);
				return {};
			}
			case "tileMove": {
				const tile = getTile(params.tileId);
				if (!tile) throw Object.assign(new Error("Tile not found"), { code: 3 });
				tile.x = params.position.x;
				tile.y = params.position.y;
				snapToGrid(tile);
				repositionAllTiles();
				saveCanvasImmediate();
				return {};
			}
			case "tileResize": {
				const tile = getTile(params.tileId);
				if (!tile) throw Object.assign(new Error("Tile not found"), { code: 3 });
				tile.width = params.size.width;
				tile.height = params.size.height;
				snapToGrid(tile);
				repositionAllTiles();
				saveCanvasImmediate();
				return {};
			}
			case "tileGetContent": {
				const tile = tiles.find(t => t.id === params.tileId);
				if (!tile) throw Object.assign(new Error("Tile not found"), { code: 3 });

				let content = "";
				const dom = tileDOMs.get(tile.id);

				if (tile.type === "text") {
					// Sticky note - get contenteditable text
					const textEl = dom?.contentArea?.querySelector(".sticky-text");
					content = textEl?.textContent || tile.content || "";
				} else if (tile.type === "term") {
					// Terminal - return label/cwd info
					content = JSON.stringify({ label: tile.label, cwd: tile.cwd });
				} else if (tile.type === "browser") {
					content = JSON.stringify({ url: tile.url, label: tile.label });
				} else {
					// For file-based tiles (note, code, image), return the filePath
					content = JSON.stringify({ filePath: tile.filePath, label: tile.label });
				}

				return { tileId: tile.id, type: tile.type, content };
			}
			case "tileBatch": {
				const results = [];
				for (const op of params.operations) {
					try {
						const result = executeCanvasRpc(op.method, op.params || {});
						results.push({ success: true, result });
					} catch (err) {
						results.push({ success: false, error: err.message });
					}
				}
				saveCanvasImmediate();
				return { results };
			}
			case "autoLayout": {
				const { algorithm, tileIds, options } = params;
				const gap = options?.gap || 60;
				const startX = options?.startX || 100;
				const startY = options?.startY || 100;
				const cols = options?.columns || 3;

				// Get target tiles (all if no tileIds specified)
				let targetTiles = tileIds
					? tiles.filter(t => tileIds.includes(t.id))
					: [...tiles];

				if (targetTiles.length === 0) return { moved: 0 };

				if (algorithm === "grid") {
					targetTiles.forEach((tile, i) => {
						const col = i % cols;
						const row = Math.floor(i / cols);
						const tileW = tile.width || 400;
						const tileH = tile.height || 300;
						tile.x = startX + col * (tileW + gap);
						tile.y = startY + row * (tileH + gap);
					});
				} else if (algorithm === "horizontal") {
					let curX = startX;
					targetTiles.forEach((tile) => {
						tile.x = curX;
						tile.y = startY;
						curX += (tile.width || 400) + gap;
					});
				} else if (algorithm === "vertical") {
					let curY = startY;
					targetTiles.forEach((tile) => {
						tile.x = startX;
						tile.y = curY;
						curY += (tile.height || 300) + gap;
					});
				}

				repositionAllTiles();
				saveCanvasImmediate();
				return { moved: targetTiles.length, algorithm };
			}
			case "viewportGet": {
				return {
					pan: { x: canvasX, y: canvasY },
					zoom: canvasScale,
				};
			}
			case "viewportSet": {
				// Blocked: external viewport control disabled to prevent unwanted panning
				return {};
			}
			case "jumpToZone": {
				const zone = getZones().find(z => z.id === params.zoneId);
				if (!zone) return { error: "zone not found" };
				const container = document.getElementById("panel-viewer");
				if (!container) return {};
				const rect = container.getBoundingClientRect();
				// Fit the entire zone (including 5W1H strip) inside the viewport
				const fitZoom = Math.min(
					rect.width * 0.92 / zone.width,
					rect.height * 0.92 / zone.height,
				);
				canvasScale = Math.max(ZOOM_MIN, Math.min(fitZoom, ZOOM_MAX));
				const cx = zone.x + zone.width / 2;
				const cy = zone.y + zone.height / 2;
				canvasX = -cx * canvasScale + rect.width / 2;
				canvasY = -cy * canvasScale + rect.height / 2;
				updateCanvas();
				flashZone(params.zoneId);
				saveCanvasDebounced();
				return { jumped: params.zoneId };
			}
			case "searchTiles": {
				const query = (params.query || "").toLowerCase();
				if (!query) return { results: [] };
				const results = tiles
					.filter(t => {
						const searchText = [
							t.label, t.title, t.cwd, t.filePath, t.url,
							getTileLabel(t).name, getTileLabel(t).parent,
						].filter(Boolean).join(" ").toLowerCase();
						return searchText.includes(query);
					})
					.map(t => ({ id: t.id, title: getTileLabel(t).name, x: t.x, y: t.y, type: t.type }));
				return { results };
			}
			case "jumpToTile": {
				const tile = tiles.find(t => t.id === params.tileId);
				if (!tile) return { error: "tile not found" };
				const container = document.getElementById("panel-viewer");
				if (!container) return {};
				const rect = container.getBoundingClientRect();
				const tw = tile.width || 400;
				const th = tile.height || 300;
				const padding = 80;
				const fitZoom = Math.min(
					(rect.width - padding * 2) / tw,
					(rect.height - padding * 2) / th,
					ZOOM_MAX,
				);
				canvasScale = Math.max(ZOOM_MIN, Math.min(fitZoom, 0.8));
				const cx = tile.x + tw / 2;
				const cy = tile.y + th / 2;
				canvasX = -cx * canvasScale + rect.width / 2;
				canvasY = -cy * canvasScale + rect.height / 2;
				updateCanvas();
				saveCanvasDebounced();
				return { jumped: tile.id };
			}
			default: {
				throw Object.assign(new Error(`Unknown method: ${method}`), { code: -32601 });
			}
		}
	}

	function handleCanvasRpc(request) {
		const { requestId, method, params } = request;

		try {
			const result = executeCanvasRpc(method, params);
			window.shellApi.canvasRpcResponse({ requestId, result });
		} catch (err) {
			window.shellApi.canvasRpcResponse({
				requestId,
				error: {
					code: err.code || -32603,
					message: err.message || "Internal error",
				},
			});
		}
	}

	window.shellApi.onCanvasRpcRequest(handleCanvasRpc);

	// ── Palette functions (inside init so they can access executeCanvasRpc) ──

	function closePalette() {
		const el = document.getElementById("palette-overlay");
		if (el) {
			if (el._keyHandler) document.removeEventListener("keydown", el._keyHandler);
			el.remove();
		}
	}

	function openZoneJumpPalette() {
		closePalette();
		const zones = getZones();
		const overlay = document.createElement("div");
		overlay.id = "palette-overlay";
		overlay.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:9999;";

		const box = document.createElement("div");
		box.style.cssText = "background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:8px;width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.6);";

		const title = document.createElement("div");
		title.textContent = "Jump to Zone";
		title.style.cssText = "font-size:11px;color:#666;padding:4px 8px 8px;letter-spacing:2px;";
		box.appendChild(title);

		const ZONE_KEYS = ["1","2","3","4","5"];
		zones.forEach((zone, i) => {
			const btn = document.createElement("button");
			btn.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;padding:8px 12px;background:transparent;border:none;color:#ccc;font-size:13px;font-family:inherit;cursor:pointer;border-radius:4px;text-align:left;";
			btn.innerHTML = `<span style="color:${zone.borderColor};font-weight:700;min-width:20px;">${ZONE_KEYS[i] || ""}</span><span style="color:${zone.borderColor}">${zone.label}</span>`;
			btn.addEventListener("mouseenter", () => { btn.style.background = "#252525"; });
			btn.addEventListener("mouseleave", () => { btn.style.background = "transparent"; });
			btn.addEventListener("click", () => {
				closePalette();
				executeCanvasRpc("jumpToZone", { zoneId: zone.id });
			});
			box.appendChild(btn);
		});

		overlay.appendChild(box);
		document.body.appendChild(overlay);

		const keyHandler = (e) => {
			if (e.key === "Escape") { closePalette(); return; }
			const idx = parseInt(e.key) - 1;
			if (idx >= 0 && idx < zones.length) {
				closePalette();
				executeCanvasRpc("jumpToZone", { zoneId: zones[idx].id });
			}
		};
		document.addEventListener("keydown", keyHandler);
		overlay._keyHandler = keyHandler;
	}

	function openTileSearch() {
		closePalette();
		const overlay = document.createElement("div");
		overlay.id = "palette-overlay";
		overlay.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:9999;";

		const box = document.createElement("div");
		box.style.cssText = "background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:8px;width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.6);";

		const input = document.createElement("input");
		input.type = "text";
		input.placeholder = "Search tiles by name...";
		input.style.cssText = "width:100%;padding:10px 12px;background:#111;border:1px solid #333;border-radius:4px;color:#e0e0e0;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box;";
		box.appendChild(input);

		const resultsList = document.createElement("div");
		resultsList.style.cssText = "max-height:300px;overflow-y:auto;margin-top:6px;";
		box.appendChild(resultsList);

		let selectedIndex = -1;

		function updateHighlight() {
			const buttons = resultsList.querySelectorAll("button");
			buttons.forEach((btn, i) => {
				btn.style.background = i === selectedIndex ? "#333" : "transparent";
			});
			if (selectedIndex >= 0 && buttons[selectedIndex]) {
				buttons[selectedIndex].scrollIntoView({ block: "nearest" });
			}
		}

		function renderResults(query) {
			resultsList.innerHTML = "";
			selectedIndex = -1;
			if (!query) return;
			const { results: matches } = executeCanvasRpc("searchTiles", { query });
			if (matches.length === 0) {
				const empty = document.createElement("div");
				empty.textContent = "No matches";
				empty.style.cssText = "color:#555;font-size:12px;padding:8px 12px;";
				resultsList.appendChild(empty);
				return;
			}
			matches.forEach((m, i) => {
				const btn = document.createElement("button");
				const typeLabel = m.type === "term" ? "Terminal" : m.type;
				btn.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;padding:8px 12px;background:transparent;border:none;color:#ccc;font-size:13px;font-family:inherit;cursor:pointer;border-radius:4px;text-align:left;";
				btn.innerHTML = `<span style="color:#888;font-size:10px;min-width:50px;">${typeLabel}</span><span>${m.title || "(untitled)"}</span>`;
				btn.addEventListener("mouseenter", () => { selectedIndex = i; updateHighlight(); });
				btn.addEventListener("mouseleave", () => { selectedIndex = -1; updateHighlight(); });
				btn.addEventListener("click", () => {
					closePalette();
					executeCanvasRpc("jumpToTile", { tileId: m.id });
				});
				resultsList.appendChild(btn);
			});
		}

		input.addEventListener("input", () => renderResults(input.value.trim()));
		input.addEventListener("keydown", (e) => {
			const buttons = resultsList.querySelectorAll("button");
			if (e.key === "Escape") closePalette();
			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (buttons.length > 0) {
					selectedIndex = selectedIndex < buttons.length - 1 ? selectedIndex + 1 : 0;
					updateHighlight();
				}
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				if (buttons.length > 0) {
					selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : buttons.length - 1;
					updateHighlight();
				}
			}
			if (e.key === "Enter") {
				if (selectedIndex >= 0 && buttons[selectedIndex]) {
					buttons[selectedIndex].click();
				} else if (buttons.length > 0) {
					buttons[0].click();
				}
			}
		});

		overlay.appendChild(box);
		document.body.appendChild(overlay);
		setTimeout(() => input.focus(), 50);

		const keyHandler = (e) => { if (e.key === "Escape") closePalette(); };
		document.addEventListener("keydown", keyHandler);
		overlay._keyHandler = keyHandler;
	}

	// Expose globally for context menu
	window.__openTileSearch = openTileSearch;
	window.__openZoneJumpPalette = openZoneJumpPalette;

	// -- beforeunload save --

	window.addEventListener("beforeunload", () => {
		saveCanvasImmediate();
	});

	// -- Memo (Scratchpad) overlay --
	const scratchpadOverlay = document.getElementById("scratchpad-overlay");
	const scratchpadBackdrop = document.getElementById("scratchpad-backdrop");
	const scratchpadCloseBtn = document.getElementById("scratchpad-close");
	const scratchpadEditor = document.getElementById("scratchpad-editor");
	const scratchpadDockBtn = document.getElementById("tool-scratchpad-btn");
	const scratchpadCanvas = document.getElementById("scratchpad-canvas");
	const scratchpadBody = document.getElementById("scratchpad-body");
	const scratchpadCtx = scratchpadCanvas ? scratchpadCanvas.getContext("2d") : null;
	const scratchpadWordcount = document.getElementById("scratchpad-wordcount");
	const scratchpadCopyBtn = document.getElementById("scratchpad-copy");
	const scratchpadSendCanvasBtn = document.getElementById("scratchpad-send-canvas");

	let scratchpadTool = "text";
	let spDrawing = false;
	let spLastX = 0;
	let spLastY = 0;
	let spPenColor = "#ffffff";

	// Memo is a single continuous document (spMemo declared at top of init())

	function saveMemo() {
		// Only read from DOM when memo is visible — when hidden, innerHTML may be empty
		if (isScratchpadOpen && scratchpadEditor) {
			spMemo.content = scratchpadEditor.innerHTML || "";
		}
		if (isScratchpadOpen && scratchpadCanvas && scratchpadCanvas.width > 0 && scratchpadCanvas.height > 0) {
			try { spMemo.drawing = scratchpadCanvas.toDataURL(); } catch {}
		}
	}

	function updateWordCount() {
		if (!scratchpadWordcount || !scratchpadEditor) return;
		const text = scratchpadEditor.textContent || "";
		const words = text.trim() ? text.trim().split(/\s+/).length : 0;
		const chars = text.length;
		scratchpadWordcount.textContent = `${words} words · ${chars} chars`;
	}

	// Save/restore for canvas state persistence
	function getScratchpadStateForSave() {
		try {
			saveMemo();
		} catch (err) {
			console.error("saveMemo error:", err);
		}
		return { content: spMemo.content || "", drawing: spMemo.drawing || "" };
	}

	function restoreScratchpadState(saved) {
		try {
			if (saved && typeof saved.content === "string" && !saved.entries) {
				// New single-memo format
				spMemo = { content: saved.content || "", drawing: saved.drawing || "" };
			} else if (saved && saved.entries && typeof saved.entries === "object") {
				// Legacy multi-entry format — merge all entries chronologically into one
				const keys = Object.keys(saved.entries).sort();
				const htmlParts = [];
				let latestDrawing = "";
				for (const key of keys) {
					const entry = saved.entries[key];
					if (!entry) continue;
					const content = (entry.content || "").trim();
					if (content) {
						htmlParts.push(`<h3>${key}</h3>${content}`);
					}
					if (entry.drawing) latestDrawing = entry.drawing;
				}
				spMemo = {
					content: htmlParts.join("<br>"),
					drawing: latestDrawing,
				};
			} else if (saved && (saved.content || saved.drawing)) {
				// Oldest legacy format
				spMemo = { content: saved.content || "", drawing: saved.drawing || "" };
			} else {
				spMemo = { content: "", drawing: "" };
			}
			// Load into DOM
			if (scratchpadEditor) scratchpadEditor.innerHTML = spMemo.content || "";
			if (scratchpadCtx && scratchpadCanvas && spMemo.drawing) {
				const img = new Image();
				img.onload = () => {
					scratchpadCanvas.width = img.width;
					scratchpadCanvas.height = img.height;
					scratchpadCtx.drawImage(img, 0, 0);
				};
				img.src = spMemo.drawing;
			}
			updateWordCount();
		} catch (err) {
			console.error("restoreScratchpadState error:", err);
			spMemo = { content: "", drawing: "" };
		}
	}

	function resizeScratchpadCanvas() {
		if (!scratchpadCanvas || !scratchpadBody || !scratchpadCtx) return;
		const rect = scratchpadBody.getBoundingClientRect();
		// Use the larger of visible height or scroll height so pen strokes
		// extend as far as the editor content
		const w = rect.width;
		const h = Math.max(rect.height, scratchpadBody.scrollHeight);
		const imgData = scratchpadCanvas.width > 0 && scratchpadCanvas.height > 0
			? scratchpadCtx.getImageData(0, 0, scratchpadCanvas.width, scratchpadCanvas.height)
			: null;
		scratchpadCanvas.width = w;
		scratchpadCanvas.height = h;
		if (imgData) scratchpadCtx.putImageData(imgData, 0, 0);
	}

	function setScratchpadTool(tool) {
		scratchpadTool = tool;
		if (!scratchpadBody) return;
		scratchpadBody.classList.remove("tool-text", "tool-pen", "tool-eraser");
		scratchpadBody.classList.add("tool-" + tool);
		document.querySelectorAll(".scratchpad-tool-btn").forEach(btn => {
			btn.classList.toggle("scratchpad-tool-active", btn.dataset.tool === tool);
		});
	}

	// Tool buttons
	document.querySelectorAll(".scratchpad-tool-btn").forEach(btn => {
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const tool = btn.dataset.tool;
			if (tool === "clear-drawing") {
				if (scratchpadCtx && scratchpadCanvas) {
					scratchpadCtx.clearRect(0, 0, scratchpadCanvas.width, scratchpadCanvas.height);
					saveCanvasDebounced();
				}
				return;
			}
			setScratchpadTool(tool);
		});
	});

	// Format buttons
	document.querySelectorAll(".sp-fmt-btn").forEach(btn => {
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const cmd = btn.dataset.cmd;
			if (cmd === "timestamp") {
				const now = new Date();
				const ts = `[${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}] `;
				document.execCommand("insertText", false, ts);
			} else if (cmd === "heading") {
				document.execCommand("formatBlock", false, "h3");
			} else if (cmd === "code") {
				const sel = window.getSelection();
				if (sel && sel.rangeCount > 0 && sel.toString().length > 0) {
					const range = sel.getRangeAt(0);
					const code = document.createElement("code");
					code.style.background = "rgba(255,255,255,0.1)";
					code.style.padding = "1px 4px";
					code.style.borderRadius = "3px";
					range.surroundContents(code);
				}
			} else {
				document.execCommand(cmd, false, null);
			}
			scratchpadEditor?.focus();
			updateWordCount();
			saveCanvasDebounced();
		});
	});

	// Pen color dots
	document.querySelectorAll(".sp-color-dot").forEach(dot => {
		dot.addEventListener("click", (e) => {
			e.stopPropagation();
			spPenColor = dot.dataset.color;
			document.querySelectorAll(".sp-color-dot").forEach(d => d.classList.remove("sp-color-active"));
			dot.classList.add("sp-color-active");
		});
	});

	// Copy button
	if (scratchpadCopyBtn) {
		scratchpadCopyBtn.addEventListener("click", () => {
			const text = scratchpadEditor?.textContent || "";
			navigator.clipboard.writeText(text).then(() => {
				scratchpadCopyBtn.textContent = "Copied!";
				setTimeout(() => { scratchpadCopyBtn.textContent = "Copy"; }, 1500);
			});
		});
	}

	// Send to canvas as sticky note
	if (scratchpadSendCanvasBtn) {
		scratchpadSendCanvasBtn.addEventListener("click", () => {
			const sel = window.getSelection();
			const text = (sel && sel.toString().trim()) || scratchpadEditor?.textContent?.trim() || "";
			if (!text) return;
			// Place near center of current viewport
			const cx = (window.innerWidth / 2 - canvasX) / canvasScale;
			const cy = (window.innerHeight / 2 - canvasY) / canvasScale;
			createTextTile(cx, cy, text);
			scratchpadSendCanvasBtn.textContent = "Sent!";
			setTimeout(() => { scratchpadSendCanvasBtn.textContent = "→ Canvas"; }, 1500);
			saveCanvasDebounced();
		});
	}

	// Drawing on scratchpad canvas
	if (scratchpadCanvas && scratchpadCtx) {
		scratchpadCanvas.addEventListener("pointerdown", (e) => {
			if (scratchpadTool !== "pen" && scratchpadTool !== "eraser") return;
			spDrawing = true;
			const rect = scratchpadCanvas.getBoundingClientRect();
			spLastX = e.clientX - rect.left;
			spLastY = e.clientY - rect.top;
			scratchpadCanvas.setPointerCapture(e.pointerId);
		});

		scratchpadCanvas.addEventListener("pointermove", (e) => {
			if (!spDrawing) return;
			const rect = scratchpadCanvas.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;

			scratchpadCtx.save();
			if (scratchpadTool === "eraser") {
				scratchpadCtx.globalCompositeOperation = "destination-out";
				scratchpadCtx.lineWidth = 20;
			} else {
				scratchpadCtx.globalCompositeOperation = "source-over";
				scratchpadCtx.strokeStyle = spPenColor;
				scratchpadCtx.lineWidth = 3;
			}
			scratchpadCtx.lineCap = "round";
			scratchpadCtx.lineJoin = "round";
			scratchpadCtx.beginPath();
			scratchpadCtx.moveTo(spLastX, spLastY);
			scratchpadCtx.lineTo(x, y);
			scratchpadCtx.stroke();
			scratchpadCtx.restore();

			spLastX = x;
			spLastY = y;
		});

		scratchpadCanvas.addEventListener("pointerup", () => {
			if (spDrawing) {
				spDrawing = false;
				saveCanvasDebounced();
			}
		});

		scratchpadCanvas.addEventListener("pointercancel", () => {
			spDrawing = false;
		});
	}

	function openScratchpad() {
		if (!scratchpadOverlay) return;
		isScratchpadOpen = true;
		scratchpadOverlay.style.display = "";
		scratchpadOverlay.classList.add("visible");
		// Always restore memo content into editor (even if empty, to clear stale DOM)
		if (scratchpadEditor) {
			scratchpadEditor.innerHTML = spMemo.content || "";
		}
		setScratchpadTool(scratchpadTool);
		updateWordCount();
		setTimeout(() => {
			resizeScratchpadCanvas();
			if (scratchpadTool === "text") scratchpadEditor?.focus();
		}, 50);
	}

	function closeScratchpad() {
		if (!scratchpadOverlay) return;
		isScratchpadOpen = false;
		saveMemo();
		scratchpadOverlay.classList.remove("visible");
		scratchpadOverlay.style.display = "none";
		// Immediate save — memo content must not be lost on quick app exit
		saveCanvasImmediate();
	}

	function toggleScratchpad() {
		if (isScratchpadOpen) closeScratchpad();
		else openScratchpad();
	}

	if (scratchpadCloseBtn) scratchpadCloseBtn.addEventListener("click", closeScratchpad);
	if (scratchpadBackdrop) scratchpadBackdrop.addEventListener("click", closeScratchpad);
	if (scratchpadDockBtn) {
		scratchpadDockBtn.addEventListener("mousedown", (e) => e.stopPropagation());
		scratchpadDockBtn.addEventListener("click", () => {
			toggleScratchpad();
		});
	}

	// Auto-save & word count on input
	if (scratchpadEditor) {
		scratchpadEditor.addEventListener("input", () => {
			updateWordCount();
			resizeScratchpadCanvas();
			saveCanvasDebounced();
		});
	}

	// Block all canvas shortcuts while scratchpad is open.
	// Only ESC and M (to close) are allowed through.
	window.addEventListener("keydown", (e) => {
		if (!isScratchpadOpen) return;

		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			closeScratchpad();
			return;
		}

		if ((e.key === "m" || e.key === "M") && !e.metaKey && !e.ctrlKey && !e.altKey) {
			const focused = document.activeElement;
			const isEditing = focused && (
				focused.isContentEditable ||
				focused.tagName === "INPUT" ||
				focused.tagName === "TEXTAREA"
			);
			if (!isEditing) {
				e.preventDefault();
				e.stopPropagation();
				closeScratchpad();
				return;
			}
		}

		// Let normal typing through inside the scratchpad, but stop
		// single-key shortcuts (T, N, V, S, W, P, 1-5, Space, etc.)
		// from reaching canvas handlers.
		const focused = document.activeElement;
		const isTyping = focused && (
			focused.isContentEditable ||
			focused.tagName === "INPUT" ||
			focused.tagName === "TEXTAREA"
		);
		if (!isTyping && !e.metaKey && !e.ctrlKey) {
			e.stopPropagation();
		}
	}, true);

	// M key to open memo (only when scratchpad is closed)
	window.addEventListener("keydown", (e) => {
		if (isScratchpadOpen) return;
		if ((e.key === "m" || e.key === "M") && !e.metaKey && !e.ctrlKey && !e.altKey) {
			const focused = document.activeElement;
			const isEditing = focused && (
				focused.isContentEditable ||
				focused.tagName === "INPUT" ||
				focused.tagName === "TEXTAREA" ||
				focused.closest?.("webview")
			);
			if (!isEditing) {
				e.preventDefault();
				openScratchpad();
				return;
			}
		}
	}, true);

	// -- Kanban board --
	const kanbanBoardEl = document.getElementById("kanban-board");

	function getKanbanStateForSave() {
		return {
			columns: kanbanState.columns,
			archived: kanbanState.archived,
			mode: kanbanState.mode || "free",
			zoneColumns: kanbanState.zoneColumns || null,
		};
	}

	function normalizeCard(raw) {
		return {
			id: raw && raw.id ? raw.id : genCardId(),
			title: (raw && (raw.title || raw.text)) || "",
			due: (raw && raw.due) || "",
			priority: (raw && raw.priority) || "",
			notes: (raw && raw.notes) || "",
			ai: (raw && raw.ai) || false,
			tileId: (raw && raw.tileId) || null,
			status: (raw && raw.status) || null,
		};
	}

	function restoreKanbanState(saved) {
		try {
			if (saved && Array.isArray(saved.columns) && saved.columns.length > 0) {
				// Filter out legacy "Done" column — its cards move to archived
				const archivedFromDone = [];
				const activeCols = [];
				for (const c of saved.columns) {
					const title = (c.title || "").toLowerCase();
					const id = (c.id || "").toLowerCase();
					const isDone = id === "col-done" || title === "done";
					const normalizedCards = Array.isArray(c.cards) ? c.cards.map(normalizeCard) : [];
					if (isDone) {
						archivedFromDone.push(...normalizedCards);
					} else {
						activeCols.push({
							id: c.id || `col-${Math.random().toString(36).slice(2, 8)}`,
							title: c.title || "Untitled",
							cards: normalizedCards,
						});
					}
				}
				// Ensure at least Todo + Doing exist
				if (activeCols.length === 0) {
					activeCols.push(
						{ id: "col-todo", title: "Todo", cards: [] },
						{ id: "col-doing", title: "Doing", cards: [] },
					);
				}
				const savedArchived = Array.isArray(saved.archived) ? saved.archived.map(normalizeCard) : [];

				// Restore zone columns — migrate cards if zone IDs were renamed
				let zoneColumns = null;
				if (saved.zoneColumns && Array.isArray(saved.zoneColumns)) {
					const currentZoneIds = new Set(ZONE_COLUMNS.map((z) => z.id));
					const restoredCols = saved.zoneColumns.map((zc) => ({
						id: zc.id,
						title: zc.title || "Untitled",
						cards: Array.isArray(zc.cards) ? zc.cards.map(normalizeCard) : [],
					}));

					// Check if saved IDs match current zone definitions
					const savedIds = new Set(restoredCols.map((c) => c.id));
					const allMatch = ZONE_COLUMNS.every((z) => savedIds.has(z.id));

					if (allMatch) {
						zoneColumns = restoredCols;
					} else {
						// Zone IDs changed — create fresh columns and migrate cards by position
						zoneColumns = createDefaultZoneColumns();
						const orphanCards = restoredCols.flatMap((c) => c.cards);
						if (orphanCards.length > 0) {
							// Put orphaned cards in the first zone column
							zoneColumns[0].cards.push(...orphanCards);
							console.log(`[kanban] Migrated ${orphanCards.length} cards from renamed zone columns`);
						}
					}
				}

				kanbanState = {
					columns: activeCols,
					archived: [...savedArchived, ...archivedFromDone],
					mode: saved.mode || "free",
					zoneColumns,
				};
			}
			renderKanban();
		} catch (err) {
			console.error("restoreKanbanState error:", err);
		}
	}

	function genCardId() {
		return `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	}

	// Satisfying "throw into trash" sound — synthesized via Web Audio
	// A downward whoosh (filtered noise) + a bright two-note chime
	function playTrashSound() {
		try {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) return;
			const ctx = new AC();
			const now = ctx.currentTime;

			// 1) Whoosh: filtered noise with downward sweep
			const noiseLen = Math.floor(ctx.sampleRate * 0.35);
			const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
			const noiseData = noiseBuf.getChannelData(0);
			for (let i = 0; i < noiseLen; i++) {
				noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
			}
			const noise = ctx.createBufferSource();
			noise.buffer = noiseBuf;

			const filter = ctx.createBiquadFilter();
			filter.type = "bandpass";
			filter.Q.value = 1.2;
			filter.frequency.setValueAtTime(3000, now);
			filter.frequency.exponentialRampToValueAtTime(400, now + 0.25);

			const noiseGain = ctx.createGain();
			noiseGain.gain.setValueAtTime(0.18, now);
			noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

			noise.connect(filter).connect(noiseGain).connect(ctx.destination);
			noise.start(now);
			noise.stop(now + 0.35);

			// 2) Bright chime: two quick ascending notes (C6 → E6)
			function chime(freq, startOffset, dur) {
				const osc = ctx.createOscillator();
				osc.type = "sine";
				osc.frequency.value = freq;
				const g = ctx.createGain();
				g.gain.setValueAtTime(0, now + startOffset);
				g.gain.linearRampToValueAtTime(0.18, now + startOffset + 0.01);
				g.gain.exponentialRampToValueAtTime(0.001, now + startOffset + dur);
				osc.connect(g).connect(ctx.destination);
				osc.start(now + startOffset);
				osc.stop(now + startOffset + dur + 0.02);
			}
			chime(1047, 0.15, 0.18); // C6
			chime(1319, 0.22, 0.22); // E6

			setTimeout(() => { try { ctx.close(); } catch {} }, 700);
		} catch (err) {
			// Fail silently — sound is not critical
		}
	}

	function findCard(cardId) {
		const allCols = getActiveColumns();
		for (const col of allCols) {
			const card = col.cards.find((c) => c.id === cardId);
			if (card) return { col, card };
		}
		return null;
	}

	const MS_PER_DAY = 86400000;

	function parseDueDate(due) {
		if (!due) return null;
		try {
			const d = new Date(due + "T00:00:00");
			if (isNaN(d.getTime())) return null;
			const now = new Date();
			now.setHours(0, 0, 0, 0);
			const mm = String(d.getMonth() + 1).padStart(2, "0");
			const dd = String(d.getDate()).padStart(2, "0");
			return { date: d, diffDays: Math.round((d.getTime() - now.getTime()) / MS_PER_DAY), label: `${mm}/${dd}` };
		} catch { return null; }
	}

	function formatDueBadge(due) {
		const p = parseDueDate(due);
		if (!p) return due || "";
		if (p.diffDays === 0) return `${p.label} (today)`;
		if (p.diffDays === 1) return `${p.label} (tmrw)`;
		if (p.diffDays < 0) return `${p.label} (${-p.diffDays}d late)`;
		if (p.diffDays <= 7) return `${p.label} (${p.diffDays}d)`;
		return p.label;
	}

	function getDueState(due) {
		const p = parseDueDate(due);
		if (!p) return "";
		if (p.diffDays < 0) return "overdue";
		if (p.diffDays <= 2) return "soon";
		return "";
	}

	function renderCardCollapsed(cardEl, card) {
		cardEl.innerHTML = "";
		cardEl.className = "kanban-card";
		if (card.priority) cardEl.classList.add(`kanban-priority-${card.priority}`);

		// Derive a display label: title > first line of notes > due date > placeholder
		let displayText = card.title;
		let isTitleFallback = false;
		if (!displayText && card.notes) {
			const firstLine = card.notes.split(/\r?\n/)[0].trim();
			if (firstLine) {
				displayText = firstLine;
				isTitleFallback = true;
			}
		}
		if (!displayText && card.due) {
			displayText = formatDueBadge(card.due);
			isTitleFallback = true;
		}
		if (!displayText) displayText = "(empty)";

		const titleRow = document.createElement("div");
		titleRow.className = "kanban-card-title-row";

		const titleEl = document.createElement("div");
		titleEl.className = "kanban-card-title";
		if (isTitleFallback) titleEl.classList.add("kanban-card-title-fallback");
		titleEl.textContent = displayText;
		titleRow.appendChild(titleEl);

		const deleteBtn = document.createElement("button");
		deleteBtn.className = "kanban-card-delete";
		deleteBtn.type = "button";
		deleteBtn.title = "Delete";
		deleteBtn.innerHTML = "&times;";
		deleteBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const col = getActiveColumns().find((c) => c.cards.some((cd) => cd.id === card.id));
			if (col) col.cards = col.cards.filter((c) => c.id !== card.id);
			renderKanban();
			saveCanvasDebounced();
		});
		titleRow.appendChild(deleteBtn);

		cardEl.appendChild(titleRow);

		// Show meta row if there's a due date, or if notes exist AND aren't already the title fallback
		const showDue = !!card.due && !!card.title;
		const showNotesIcon = !!card.notes && !!card.title;
		if (showDue || showNotesIcon) {
			const meta = document.createElement("div");
			meta.className = "kanban-card-meta";
			if (showDue) {
				const dueBadge = document.createElement("span");
				dueBadge.className = "kanban-due-badge";
				const state = getDueState(card.due);
				if (state) dueBadge.classList.add(`kanban-due-${state}`);
				dueBadge.textContent = formatDueBadge(card.due);
				meta.appendChild(dueBadge);
			}
			if (showNotesIcon) {
				const notesIcon = document.createElement("span");
				notesIcon.className = "kanban-notes-indicator";
				notesIcon.textContent = "\u2630";
				notesIcon.title = "Has notes";
				meta.appendChild(notesIcon);
			}
			if (card.ai) {
				const badge = createStatusBadge(card);
				meta.appendChild(badge);
			}
			cardEl.appendChild(meta);
		}
		// Show status badge even without other meta
		if (card.ai && !(showDue || showNotesIcon)) {
			const meta = document.createElement("div");
			meta.className = "kanban-card-meta";
			const badge = createStatusBadge(card);
			meta.appendChild(badge);
			cardEl.appendChild(meta);
		}
	}

	function createStatusBadge(card) {
		const badge = document.createElement("span");
		const status = card.status || (card.tileId ? "running" : "idle");
		badge.className = "kanban-status-badge kanban-status-" + status;
		const labels = { idle: "AI", running: "Running", done: "Done", error: "Error" };
		badge.textContent = labels[status] || "AI";
		return badge;
	}

	function renderCardExpanded(cardEl, card, col) {
		cardEl.innerHTML = "";
		cardEl.className = "kanban-card kanban-card-expanded";
		if (card.priority) cardEl.classList.add(`kanban-priority-${card.priority}`);

		const form = document.createElement("div");
		form.className = "kanban-card-form";

		const titleInput = document.createElement("input");
		titleInput.type = "text";
		titleInput.className = "kanban-field-title";
		titleInput.placeholder = "Task title";
		titleInput.value = card.title || "";
		form.appendChild(titleInput);

		const row = document.createElement("div");
		row.className = "kanban-field-row";

		const dueInput = document.createElement("input");
		dueInput.type = "date";
		dueInput.className = "kanban-field-due";
		dueInput.value = card.due || "";
		row.appendChild(dueInput);

		const prioSelect = document.createElement("div");
		prioSelect.className = "kanban-prio-group";
		const prios = [
			{ key: "", label: "—" },
			{ key: "low", label: "Low" },
			{ key: "mid", label: "Mid" },
			{ key: "high", label: "High" },
		];
		let currentPrio = card.priority || "";
		for (const p of prios) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "kanban-prio-btn";
			if (p.key) btn.classList.add(`kanban-prio-${p.key}`);
			if (currentPrio === p.key) btn.classList.add("kanban-prio-active");
			btn.textContent = p.label;
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				currentPrio = p.key;
				prioSelect.querySelectorAll(".kanban-prio-btn").forEach((b) =>
					b.classList.remove("kanban-prio-active"),
				);
				btn.classList.add("kanban-prio-active");
			});
			prioSelect.appendChild(btn);
		}
		row.appendChild(prioSelect);

		form.appendChild(row);

		const notesArea = document.createElement("textarea");
		notesArea.className = "kanban-field-notes";
		notesArea.placeholder = "Notes / details";
		notesArea.rows = 3;
		notesArea.value = card.notes || "";
		form.appendChild(notesArea);

		const actions = document.createElement("div");
		actions.className = "kanban-card-actions";

		const saveBtn = document.createElement("button");
		saveBtn.type = "button";
		saveBtn.className = "kanban-save-btn";
		saveBtn.textContent = "Save";
		actions.appendChild(saveBtn);

		const cancelBtn = document.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.className = "kanban-cancel-btn";
		cancelBtn.textContent = "Cancel";
		actions.appendChild(cancelBtn);

		// Run button — launches Claude Code with this task
		const runBtn = document.createElement("button");
		runBtn.type = "button";
		runBtn.className = "kanban-run-btn";
		runBtn.textContent = card.tileId ? "Jump" : "\u25B6 Run";
		runBtn.title = card.tileId ? "Pan to the running terminal" : "Launch Claude Code with this task";
		actions.appendChild(runBtn);

		form.appendChild(actions);
		cardEl.appendChild(form);

		function commit() {
			const newTitle = titleInput.value.trim();
			const newDue = dueInput.value || "";
			const newPrio = currentPrio;
			const newNotes = notesArea.value;
			const hasAny = !!(newTitle || newDue || newPrio || newNotes.trim());
			if (!hasAny) {
				col.cards = col.cards.filter((c) => c.id !== card.id);
			} else {
				card.title = newTitle;
				card.due = newDue;
				card.priority = newPrio;
				card.notes = newNotes;
			}
			expandedCardId = null;
			renderKanban();
			saveCanvasDebounced();
		}

		function cancel() {
			if (!card.title && !card.due && !card.priority && !card.notes) {
				// Was a new empty card — remove it
				col.cards = col.cards.filter((c) => c.id !== card.id);
			}
			expandedCardId = null;
			renderKanban();
		}

		saveBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			commit();
		});
		cancelBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			cancel();
		});

		runBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			// Save current edits first
			card.title = titleInput.value.trim();
			card.notes = notesArea.value;
			card.due = dueInput.value || "";
			card.priority = currentPrio;
			if (card.tileId) {
				// Already launched — jump to it
				const t = getTile(card.tileId);
				if (t) { closeScratchpad(); panToTile(t, true); }
			} else if (card.title || card.notes) {
				card.ai = true;
				expandedCardId = null;
				launchClaudeForCard(card, col);
				renderKanban();
				saveCanvasDebounced();
			}
		});

		cardEl.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				cancel();
			} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				commit();
			}
		});

		setTimeout(() => titleInput.focus(), 0);
	}

	let expandedCardId = null;

	const PTY_POLL_MS = 200;
	const CLAUDE_INIT_MS = 5000;
	const PTY_TIMEOUT_MS = 15000;

	/** Launch Claude Code in a terminal tile for a kanban card */
	function launchClaudeForCard(card, col) {
		// Build prompt from card content
		let prompt = `task name: ${card.title}`;
		if (card.notes) prompt += `\ntask description: ${card.notes}`;
		if (card.priority) prompt += `\npriority: ${card.priority}`;
		if (card.due) prompt += `\ndue: ${card.due}`;
		if (!prompt.trim()) return;

		// Find zone position for the terminal
		const zoneData = getZones().find((z) => z.id === col.id);
		const pos = zoneData
			? findOpenSpotInZone(zoneData)
			: { x: 100, y: 100 };

		// Get current workspace CWD
		const cwd = (workspaces[activeIndex] && workspaces[activeIndex].path) || undefined;

		// Create terminal tile
		const tile = createCanvasTile("term", pos.x, pos.y, {
			label: card.title || "AI Task",
			cwd,
		});
		spawnTerminalWebview(tile, false);

		// Link card to tile and set running status
		card.tileId = tile.id;
		card.status = "running";

		// Close memo (don't move the viewport — user stays where they are)
		closeScratchpad();

		// Wait for PTY session to be ready, then:
		// 1. Launch claude in interactive mode
		// 2. Wait for it to start up
		// 3. Send the task as input
		const checkInterval = setInterval(() => {
			if (!tile || !getTile(tile.id)) { clearInterval(checkInterval); return; }
			if (tile.ptySessionId) {
				clearInterval(checkInterval);
				window.shellApi.ptyWrite(tile.ptySessionId, "claude --dangerously-skip-permissions\n");
				setTimeout(() => {
					if (!tile.ptySessionId) return;
					const singleLine = prompt.replace(/[\r\n]+/g, " ").trim();
					// Send text first, then Enter separately after a short delay
					window.shellApi.ptyWrite(tile.ptySessionId, singleLine);
					setTimeout(() => {
						if (!tile.ptySessionId) return;
						window.shellApi.ptyWrite(tile.ptySessionId, "\r");
					}, 300);
				}, CLAUDE_INIT_MS);
			}
		}, PTY_POLL_MS);
		setTimeout(() => clearInterval(checkInterval), PTY_TIMEOUT_MS);

		saveCanvasDebounced();
	}

	/** Update kanban card status when its linked terminal exits */
	function updateKanbanCardStatus(tileId, status) {
		const allCols = [...kanbanState.columns, ...(kanbanState.zoneColumns || [])];
		for (const col of allCols) {
			for (const card of col.cards) {
				if (card.tileId === tileId) {
					card.status = status;
					renderKanban();
					saveCanvasDebounced();
					return;
				}
			}
		}
	}

	/** Format a single card as text */
	function formatCardForCopy(card) {
		let line = `- ${card.title || "(untitled)"}`;
		const tags = [];
		if (card.priority) tags.push(card.priority);
		if (card.due) tags.push(card.due);
		if (card.status) tags.push(card.status);
		if (tags.length) line += ` [${tags.join(", ")}]`;
		if (card.notes) line += `\n  ${card.notes.replace(/\n/g, "\n  ")}`;
		return line;
	}

	/** Format a single column as text */
	function formatColumnForCopy(col) {
		let text = `## ${col.title} (${col.cards.length})\n`;
		if (col.cards.length === 0) return text + "(empty)\n";
		text += col.cards.map(formatCardForCopy).join("\n");
		return text;
	}

	/** Format all columns as text */
	function formatKanbanForCopy(columns) {
		return columns.map(formatColumnForCopy).join("\n\n");
	}

	const COPY_FEEDBACK_MS = 1200;

	/** Copy text and flash button label */
	function copyWithFeedback(btn, text, originalLabel) {
		navigator.clipboard.writeText(text);
		btn.textContent = "Copied!";
		setTimeout(() => { btn.textContent = originalLabel; }, COPY_FEEDBACK_MS);
	}

	const ZONE_TILE_COLS = 4;
	const ZONE_TILE_W = 500;
	const ZONE_TILE_H = 400;
	const ZONE_TILE_PAD = 40;
	const ZONE_TILE_MAX_ROWS = 10;
	const ZONE_TILE_START_Y = 80;

	/** Find an open spot in a zone for placing a new tile */
	function findOpenSpotInZone(zone) {
		const existing = tiles.filter((t) => {
			const cx = t.x + t.width / 2;
			const cy = t.y + t.height / 2;
			return cx >= zone.x && cx <= zone.x + zone.width
				&& cy >= zone.y && cy <= zone.y + ZONE_H;
		});
		for (let row = 0; row < ZONE_TILE_MAX_ROWS; row++) {
			for (let c = 0; c < ZONE_TILE_COLS; c++) {
				const x = zone.x + ZONE_TILE_PAD + c * (ZONE_TILE_W + ZONE_TILE_PAD);
				const y = zone.y + ZONE_TILE_START_Y + row * (ZONE_TILE_H + ZONE_TILE_PAD);
				const overlaps = existing.some((t) =>
					x < t.x + t.width && x + ZONE_TILE_W > t.x &&
					y < t.y + t.height && y + ZONE_TILE_H > t.y
				);
				if (!overlaps) return { x, y };
			}
		}
		return { x: zone.x + ZONE_TILE_PAD, y: zone.y + ZONE_TILE_START_Y };
	}

	function getActiveColumns() {
		if (kanbanState.mode === "zone") {
			if (!kanbanState.zoneColumns) kanbanState.zoneColumns = createDefaultZoneColumns();
			return kanbanState.zoneColumns;
		}
		return kanbanState.columns;
	}

	function createDefaultZoneColumns() {
		return ZONE_COLUMNS.map((z) => ({ id: z.id, title: z.title, cards: [] }));
	}

	function switchKanbanMode(newMode) {
		kanbanState.mode = newMode;
		if (newMode === "zone" && !kanbanState.zoneColumns) {
			kanbanState.zoneColumns = createDefaultZoneColumns();
		}
		expandedCardId = null;
		renderKanban();
		saveCanvasDebounced();
	}

	function renderKanban() {
		if (!kanbanBoardEl) return;
		kanbanBoardEl.innerHTML = "";

		const mode = kanbanState.mode || "free";

		// Mode toggle bar
		const modeBar = document.createElement("div");
		modeBar.className = "kanban-mode-bar";

		const freeBtn = document.createElement("button");
		freeBtn.type = "button";
		freeBtn.className = "kanban-mode-btn" + (mode === "free" ? " kanban-mode-active" : "");
		freeBtn.textContent = "Free";
		freeBtn.addEventListener("click", () => switchKanbanMode("free"));
		modeBar.appendChild(freeBtn);

		const zoneBtn = document.createElement("button");
		zoneBtn.type = "button";
		zoneBtn.className = "kanban-mode-btn" + (mode === "zone" ? " kanban-mode-active" : "");
		zoneBtn.textContent = "Zone";
		zoneBtn.addEventListener("click", () => switchKanbanMode("zone"));
		modeBar.appendChild(zoneBtn);

		// Spacer to push copy button to the right
		const spacer = document.createElement("div");
		spacer.style.flex = "1";
		modeBar.appendChild(spacer);

		const copyAllBtn = document.createElement("button");
		copyAllBtn.type = "button";
		copyAllBtn.className = "kanban-mode-btn";
		copyAllBtn.textContent = "Copy All";
		copyAllBtn.title = "Copy all kanban content to clipboard";
		copyAllBtn.addEventListener("click", () => {
			copyWithFeedback(copyAllBtn, formatKanbanForCopy(activeCols), "Copy All");
		});
		modeBar.appendChild(copyAllBtn);

		kanbanBoardEl.appendChild(modeBar);

		// Columns container + trash drop zone
		const colsWrap = document.createElement("div");
		colsWrap.className = "kanban-columns" + (mode === "zone" ? " kanban-columns-zone" : "");

		const activeCols = getActiveColumns();

		for (const col of activeCols) {
			const colEl = document.createElement("div");
			colEl.className = "kanban-column";
			colEl.dataset.colId = col.id;

			// Zone mode: apply zone accent color
			const zoneDef = ZONE_COLUMNS.find((z) => z.id === col.id);
			if (mode === "zone" && zoneDef) {
				colEl.style.borderTopColor = zoneDef.color;
				colEl.classList.add("kanban-column-zone");
			}

			const header = document.createElement("div");
			header.className = "kanban-column-header";

			const title = document.createElement("div");
			title.className = "kanban-column-title";
			if (mode === "zone") {
				title.contentEditable = "false";
				if (zoneDef) title.style.color = zoneDef.color;
			} else {
				title.contentEditable = "true";
			}
			title.spellcheck = false;
			title.textContent = col.title;
			title.addEventListener("blur", () => {
				if (mode === "zone") return;
				const newTitle = title.textContent.trim() || "Untitled";
				col.title = newTitle;
				title.textContent = newTitle;
				saveCanvasDebounced();
			});
			title.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					title.blur();
				}
			});
			header.appendChild(title);

			const count = document.createElement("span");
			count.className = "kanban-column-count";
			count.textContent = String(col.cards.length);
			header.appendChild(count);

			if (col.cards.length > 0) {
				const copyColBtn = document.createElement("button");
				copyColBtn.type = "button";
				copyColBtn.className = "kanban-col-copy-btn";
				copyColBtn.textContent = "Copy";
				copyColBtn.title = `Copy ${col.title} cards`;
				copyColBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					copyWithFeedback(copyColBtn, formatColumnForCopy(col), "Copy");
				});
				header.appendChild(copyColBtn);
			}

			colEl.appendChild(header);

			const cardsEl = document.createElement("div");
			cardsEl.className = "kanban-cards";

			for (const card of col.cards) {
				const cardEl = document.createElement("div");
				cardEl.dataset.cardId = card.id;
				cardEl.draggable = true;

				const isExpanded = expandedCardId === card.id;
				if (isExpanded) {
					renderCardExpanded(cardEl, card, col);
				} else {
					renderCardCollapsed(cardEl, card);
				}

				if (!isExpanded) {
					cardEl.addEventListener("click", (e) => {
						if (e.target.closest(".kanban-card-delete")) return;
						expandedCardId = card.id;
						renderKanban();
					});
				}

				cardEl.addEventListener("dragstart", (e) => {
					cardEl.classList.add("kanban-card-dragging");
					if (e.dataTransfer) {
						e.dataTransfer.effectAllowed = "move";
						e.dataTransfer.setData("text/plain", card.id);
					}
				});
				cardEl.addEventListener("dragend", () => {
					cardEl.classList.remove("kanban-card-dragging");
					document.querySelectorAll(".kanban-drag-over")
						.forEach((el) => el.classList.remove("kanban-drag-over"));
				});

				cardsEl.appendChild(cardEl);
			}

			colEl.appendChild(cardsEl);

			colEl.addEventListener("dragover", (e) => {
				e.preventDefault();
				if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
				colEl.classList.add("kanban-drag-over");
			});
			colEl.addEventListener("dragleave", (e) => {
				if (e.target === colEl) colEl.classList.remove("kanban-drag-over");
			});
			colEl.addEventListener("drop", (e) => {
				e.preventDefault();
				colEl.classList.remove("kanban-drag-over");
				const cardId = e.dataTransfer?.getData("text/plain");
				if (!cardId) return;
				const found = findCard(cardId);
				if (!found) return;
				// Remove from source column
				found.col.cards = found.col.cards.filter((c) => c.id !== cardId);
				// Insert at drop position based on mouse Y
				const cardEls = colEl.querySelectorAll(".kanban-card");
				let insertIdx = col.cards.length;
				for (let i = 0; i < cardEls.length; i++) {
					const rect = cardEls[i].getBoundingClientRect();
					if (e.clientY < rect.top + rect.height / 2) {
						insertIdx = i;
						break;
					}
				}
				col.cards.splice(insertIdx, 0, found.card);
				renderKanban();
				saveCanvasDebounced();
			});

			const addBtn = document.createElement("button");
			addBtn.type = "button";
			addBtn.className = "kanban-add-card";
			addBtn.textContent = "+ Add task";
			addBtn.addEventListener("click", () => {
				const newCard = normalizeCard({});
				col.cards.push(newCard);
				expandedCardId = newCard.id;
				renderKanban();
			});
			colEl.appendChild(addBtn);

			colsWrap.appendChild(colEl);
		}

		kanbanBoardEl.appendChild(colsWrap);

		// Trash / archive drop zone + expandable archive list
		const archiveSection = document.createElement("div");
		archiveSection.className = "kanban-archive-section";

		const trash = document.createElement("div");
		trash.className = "kanban-trash";
		trash.title = "Drop here to archive";
		trash.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span class="kanban-trash-count">${kanbanState.archived.length}</span>`;

		trash.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			trash.classList.add("kanban-drag-over");
		});
		trash.addEventListener("dragleave", () => {
			trash.classList.remove("kanban-drag-over");
		});
		trash.addEventListener("drop", (e) => {
			e.preventDefault();
			trash.classList.remove("kanban-drag-over");
			const cardId = e.dataTransfer?.getData("text/plain");
			if (!cardId) return;
			const found = findCard(cardId);
			if (!found) return;
			found.col.cards = found.col.cards.filter((c) => c.id !== cardId);
			kanbanState.archived.push(found.card);
			if (expandedCardId === cardId) expandedCardId = null;
			playTrashSound();
			trash.classList.add("kanban-trash-drop-flash");
			setTimeout(() => trash.classList.remove("kanban-trash-drop-flash"), 400);
			renderKanban();
			saveCanvasDebounced();
		});

		// Click trash to toggle archive list
		if (kanbanState.archived.length > 0) {
			trash.style.cursor = "pointer";
			trash.addEventListener("click", () => {
				archiveSection.classList.toggle("kanban-archive-open");
			});
		}

		archiveSection.appendChild(trash);

		// Archive list (hidden by default, shown on click)
		if (kanbanState.archived.length > 0) {
			const archiveList = document.createElement("div");
			archiveList.className = "kanban-archive-list";

			for (const card of kanbanState.archived) {
				const row = document.createElement("div");
				row.className = "kanban-archive-item";

				const label = document.createElement("span");
				label.className = "kanban-archive-item-label";
				label.textContent = card.title || card.notes?.split(/\r?\n/)[0] || "(untitled)";
				row.appendChild(label);

				const restoreBtn = document.createElement("button");
				restoreBtn.type = "button";
				restoreBtn.className = "kanban-archive-restore";
				restoreBtn.textContent = "Restore";
				restoreBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					kanbanState.archived = kanbanState.archived.filter((c) => c.id !== card.id);
					// Restore to first active column
					const cols = getActiveColumns();
					if (cols.length > 0) cols[0].cards.push(card);
					renderKanban();
					saveCanvasDebounced();
				});
				row.appendChild(restoreBtn);

				const deleteBtn = document.createElement("button");
				deleteBtn.type = "button";
				deleteBtn.className = "kanban-archive-delete";
				deleteBtn.textContent = "Delete";
				deleteBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					kanbanState.archived = kanbanState.archived.filter((c) => c.id !== card.id);
					renderKanban();
					saveCanvasDebounced();
				});
				row.appendChild(deleteBtn);

				archiveList.appendChild(row);
			}

			archiveSection.appendChild(archiveList);
		}

		kanbanBoardEl.appendChild(archiveSection);
	}

	renderKanban();
}

async function checkFirstLaunchDialog() {
	const offered = await window.shellApi.hasOfferedPlugin();
	if (offered) return;

	const agents = await window.shellApi.getAgents();

	const dialog = document.getElementById("canvas-skill-dialog");
	const agentsContainer = document.getElementById("canvas-skill-agents");
	const skipBtn = document.getElementById("canvas-skill-skip");
	const installBtn = document.getElementById("canvas-skill-install");
	if (!dialog || !agentsContainer || !skipBtn || !installBtn) return;

	agentsContainer.innerHTML = "";
	const checkboxes = [];

	for (const agent of agents) {
		const row = document.createElement("label");
		row.className = "canvas-skill-agent-row";

		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.checked = agent.detected;
		checkbox.dataset.agentId = agent.id;
		checkboxes.push(checkbox);

		const name = document.createElement("span");
		name.className = "agent-name";
		name.textContent = agent.name;

		const badge = document.createElement("span");
		badge.className = agent.detected
			? "agent-badge detected"
			: "agent-badge not-found";
		badge.textContent = agent.detected ? "detected" : "not found";

		row.appendChild(checkbox);
		row.appendChild(name);
		row.appendChild(badge);
		agentsContainer.appendChild(row);
	}

	dialog.classList.remove("hidden");

	function closeDialog() {
		dialog.classList.add("hidden");
		window.shellApi.markPluginOffered();
	}

	skipBtn.addEventListener("click", closeDialog, { once: true });

	installBtn.addEventListener("click", async () => {
		for (const cb of checkboxes) {
			if (cb.checked) {
				await window.shellApi.installSkill(cb.dataset.agentId);
			}
		}
		closeDialog();
	}, { once: true });
}

init();

// -- Launch All toolbar --

(function initLaunchToolbar() {
	const toolSelect = document.getElementById("launch-tool-select");
	const customInput = document.getElementById("launch-custom-cmd");
	const launchBtn = document.getElementById("launch-all-btn");

	const TOOL_COMMANDS = {
		claude: "claude --dangerously-skip-permissions\n",
		codex: "codex\n",
	};

	function updateLaunchBtnState() {
		const hasTerms = tiles.some((t) => t.type === "term");
		if (hasTerms) {
			launchBtn.classList.remove("disabled");
		} else {
			launchBtn.classList.add("disabled");
		}
	}

	// Initial state check
	updateLaunchBtnState();

	// Observe tile-layer for child additions/removals to update button state
	const tileLayerEl = document.getElementById("tile-layer");
	if (tileLayerEl) {
		const observer = new MutationObserver(() => updateLaunchBtnState());
		observer.observe(tileLayerEl, { childList: true });
	}

	toolSelect.addEventListener("change", () => {
		customInput.style.display = toolSelect.value === "custom" ? "block" : "none";
	});

	async function launchAll() {
		if (launchBtn.classList.contains("disabled")) return;

		let cmd;
		if (toolSelect.value === "custom") {
			const raw = customInput.value.trim();
			if (!raw) return;
			cmd = raw + "\n";
		} else {
			cmd = TOOL_COMMANDS[toolSelect.value] || (toolSelect.value + "\n");
		}

		const termTiles = tiles.filter((t) => t.type === "term" && t.ptySessionId);
		if (termTiles.length === 0) return;
		for (const tile of termTiles) {
			await window.shellApi.ptyWrite(tile.ptySessionId, cmd);
		}

		// Visual pulse on success
		launchBtn.classList.add("launch-pulse");
		launchBtn.addEventListener("animationend", () => {
			launchBtn.classList.remove("launch-pulse");
		}, { once: true });
	}

	launchBtn.addEventListener("click", launchAll);

	window.addEventListener("keydown", (e) => {
		const isMac = navigator.platform.toUpperCase().includes("MAC");
		const mod = isMac ? e.metaKey : e.ctrlKey;
		if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
			e.preventDefault();
			launchAll();
		}
	});

	// -- Keyboard shortcut help modal --

	const shortcutModal = document.getElementById("shortcut-modal");
	const shortcutBody = shortcutModal.querySelector(".shortcut-modal-body");
	const shortcutCloseBtn = shortcutModal.querySelector(".shortcut-modal-close");
	const helpBtn = document.getElementById("help-shortcut-btn");

	const SHORTCUTS = [
		{ keys: "Space + drag", desc: "Pan canvas" },
		{ keys: "Delete / Backspace", desc: "Delete selected tiles" },
		{ keys: "\u2318C", desc: "Copy selected tiles" },
		{ keys: "\u2318V", desc: "Paste tiles" },
		{ keys: "\u2318G", desc: "Group selected tiles" },
		{ keys: "\u2318\u21E7G", desc: "Ungroup" },
		{ keys: "\u2318\u21E7L", desc: "Launch All" },
		{ keys: "Shift+Click", desc: "Multi-select" },
		{ keys: "Double-click canvas", desc: "New terminal" },
		{ keys: "Double-click title", desc: "Rename terminal" },
		{ keys: "Right-click", desc: "Context menu" },
		{ keys: "Arrow keys", desc: "Move selected tiles" },
		{ keys: "Shift + Arrow", desc: "Move tiles faster" },
		{ keys: "Long-press zone", desc: "Select all tiles in zone" },
		{ keys: "Escape", desc: "Clear selection" },
		{ keys: "V", desc: "Pointer (select/move)" },
		{ keys: "T", desc: "New terminal" },
		{ keys: "N", desc: "New sticky note" },
		{ keys: "W", desc: "New browser" },
		{ keys: "S", desc: "New shape" },
		{ keys: "P", desc: "Toggle pen mode" },
		{ keys: "B (pen mode)", desc: "Brush tool" },
		{ keys: "E (pen mode)", desc: "Eraser tool" },
		{ keys: "\u2318Z (pen mode)", desc: "Undo last stroke" },
		{ keys: "\u2318D", desc: "Duplicate focused tile" },
		{ keys: "\u2318+/\u2318-", desc: "Zoom in/out" },
		{ keys: "\u23180", desc: "Reset zoom to 100%" },
		{ keys: "\u2318J", desc: "Jump to zone" },
		{ keys: "\u2318K", desc: "Search tiles by name" },
		{ keys: "1-5", desc: "Jump to zone (no selection)" },
		{ keys: "\u2318\u21E7A", desc: "Auto-layout grid" },
		{ keys: "M", desc: "Toggle memo" },
	];

	// Populate rows
	for (const s of SHORTCUTS) {
		const row = document.createElement("div");
		row.className = "shortcut-row";
		const kbd = document.createElement("span");
		kbd.className = "shortcut-keys";
		kbd.textContent = s.keys;
		const desc = document.createElement("span");
		desc.className = "shortcut-desc";
		desc.textContent = s.desc;
		row.appendChild(kbd);
		row.appendChild(desc);
		shortcutBody.appendChild(row);
	}

	function showShortcutModal() {
		shortcutModal.classList.add("visible");
	}
	function hideShortcutModal() {
		shortcutModal.classList.remove("visible");
	}

	helpBtn.addEventListener("click", showShortcutModal);
	shortcutCloseBtn.addEventListener("click", hideShortcutModal);
	shortcutModal.addEventListener("click", (e) => {
		if (e.target === shortcutModal) hideShortcutModal();
	});
	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && shortcutModal.classList.contains("visible")) {
			hideShortcutModal();
		}
	});

	// -- Pen mode (dock UI) --

	const penDock = document.getElementById("pen-dock");
	const penBrushBtn = document.getElementById("pen-brush-btn");
	const penEraserBtn = document.getElementById("pen-eraser-btn");
	const penDockExpand = document.getElementById("pen-dock-expand");
	const penUndoBtn = document.getElementById("pen-undo-btn");
	const penClearBtn = document.getElementById("pen-clear-btn");

	let activePenDockTool = null; // "brush" | "eraser" | null

	function activatePenWithTool(tool) {
		if (!isPenMode()) {
			setPenMode(true);
		}
		activePenDockTool = tool;
		setPenTool(undefined, undefined, tool);
		penBrushBtn.classList.toggle("pen-dock-active", tool === "brush");
		penEraserBtn.classList.toggle("pen-dock-active", tool === "eraser");
		penDock.classList.add("pen-dock-open");
		canvasEl.classList.add("pen-mode");
	}

	function deactivatePen() {
		setPenMode(false);
		activePenDockTool = null;
		penBrushBtn.classList.remove("pen-dock-active");
		penEraserBtn.classList.remove("pen-dock-active");
		penDock.classList.remove("pen-dock-open");
		canvasEl.classList.remove("pen-mode");
	}

	// Color swatches
	for (const swatch of penDockExpand.querySelectorAll("[data-pen-color]")) {
		swatch.addEventListener("mousedown", (e) => e.stopPropagation());
		swatch.addEventListener("click", () => {
			for (const s of penDockExpand.querySelectorAll("[data-pen-color]")) {
				s.classList.toggle("draw-color-active", s === swatch);
			}
			setPenTool(swatch.dataset.penColor);
		});
	}

	// Size buttons
	for (const btn of penDockExpand.querySelectorAll("[data-pen-size]")) {
		btn.addEventListener("mousedown", (e) => e.stopPropagation());
		btn.addEventListener("click", () => {
			for (const b of penDockExpand.querySelectorAll("[data-pen-size]")) {
				b.classList.toggle("draw-size-active", b === btn);
			}
			setPenTool(undefined, parseInt(btn.dataset.penSize, 10));
		});
	}

	// Undo
	penUndoBtn.addEventListener("mousedown", (e) => e.stopPropagation());
	penUndoBtn.addEventListener("click", () => {
		undoStroke();
		redrawPenOverlay(canvasX, canvasY, canvasScale);
		saveCanvasDebounced();
	});

	// Clear
	penClearBtn.addEventListener("mousedown", (e) => e.stopPropagation());
	penClearBtn.addEventListener("click", () => {
		clearPenStrokes();
		redrawPenOverlay(canvasX, canvasY, canvasScale);
		saveCanvasDebounced();
	});

	// ── Unified Dock Tool Management ──
	const toolBtns = {
		pointer:  document.getElementById("tool-pointer-btn"),
		terminal: document.getElementById("tool-terminal-btn"),
		sticky:   document.getElementById("tool-sticky-btn"),
		browser:  document.getElementById("tool-browser-btn"),
		shape:    document.getElementById("tool-shape-btn"),
	};

	let activeDockTool = "pointer";

	function setActiveTool(tool) {
		activeDockTool = tool;

		// Update active class on all tool buttons
		for (const [key, btn] of Object.entries(toolBtns)) {
			if (btn) btn.classList.toggle("pen-dock-active", key === tool);
		}
		// Also update pen/eraser buttons
		penBrushBtn.classList.toggle("pen-dock-active", tool === "brush");
		penEraserBtn.classList.toggle("pen-dock-active", tool === "eraser");

		// Deactivate pen mode if switching away from brush/eraser
		if (tool !== "brush" && tool !== "eraser") {
			if (canvasEl.classList.contains("pen-mode")) {
				setPenMode(false);
				penDock.classList.remove("pen-dock-open");
				canvasEl.classList.remove("pen-mode");
			}
		}

		// Handle pen/eraser activation
		if (tool === "brush" || tool === "eraser") {
			setPenMode(true);
			setPenTool(undefined, undefined, tool);
			penDock.classList.add("pen-dock-open");
			canvasEl.classList.add("pen-mode");
			return;
		}

		// For creation tools, create tile at viewport center then revert to pointer
		if (tool === "terminal" || tool === "sticky" || tool === "browser" || tool === "shape") {
			const { cx, cy } = getViewportCenter();
			if (tool === "terminal") {
				const ws = workspaces[activeIndex];
				const cwd = ws ? ws.path : undefined;
				const tile = createCanvasTile("term", cx, cy, { cwd });
				spawnTerminalWebview(tile, true);
				saveCanvasImmediate();
			} else if (tool === "sticky") {
				createTextTile(cx, cy);
			} else if (tool === "browser") {
				const tile = createCanvasTile("browser", cx, cy);
				spawnBrowserWebview(tile, true);
				saveCanvasImmediate();
			} else if (tool === "shape") {
				createShapeTile(cx, cy);
			}
			// Revert to pointer after creation
			setTimeout(() => setActiveTool("pointer"), 200);
		}
	}

	// Wire up tool button clicks
	for (const [key, btn] of Object.entries(toolBtns)) {
		if (!btn) continue;
		btn.addEventListener("mousedown", (e) => e.stopPropagation());
		btn.addEventListener("click", () => setActiveTool(key));
	}

	// Layout button (not a mode toggle, fires action directly)
	const layoutBtn = document.getElementById("tool-layout-btn");
	if (layoutBtn) {
		layoutBtn.addEventListener("mousedown", (e) => e.stopPropagation());
		layoutBtn.addEventListener("click", () => {
			executeCanvasRpc("autoLayout", { algorithm: "grid", options: { columns: 3 } });
		});
	}

	// Override pen/eraser button behavior to use unified system
	penBrushBtn.addEventListener("mousedown", (e) => e.stopPropagation());
	penBrushBtn.addEventListener("click", () => {
		if (activeDockTool === "brush") {
			setActiveTool("pointer");
		} else {
			setActiveTool("brush");
		}
	});
	penEraserBtn.addEventListener("mousedown", (e) => e.stopPropagation());
	penEraserBtn.addEventListener("click", () => {
		if (activeDockTool === "eraser") {
			setActiveTool("pointer");
		} else {
			setActiveTool("eraser");
		}
	});

	// Pen mode keyboard shortcuts
	window.addEventListener("keydown", (e) => {
		if (isScratchpadOpen) return;
		// Tool shortcuts (only when not typing in input/contenteditable)
		if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
			const focused = document.activeElement;
			const isEditing = focused && (
				focused.isContentEditable ||
				focused.tagName === "INPUT" ||
				focused.tagName === "TEXTAREA" ||
				focused.closest?.("webview")
			);
			if (!isEditing) {
				const TOOL_KEYS = { v: "pointer", t: "terminal", n: "sticky", w: "browser", s: "shape" };
				if (TOOL_KEYS[e.key]) {
					e.preventDefault();
					setActiveTool(TOOL_KEYS[e.key]);
					return;
				}
			}
		}

		// P key = pen mode toggle, Escape = exit pen mode
		if ((e.key === "p" || (e.key === "Escape" && isPenMode())) && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
			const focused = document.activeElement;
			const isEditing = focused && (
				focused.isContentEditable ||
				focused.tagName === "INPUT" ||
				focused.tagName === "TEXTAREA" ||
				focused.closest("webview")
			);
			if (!isEditing) {
				e.preventDefault();
				if (e.key === "Escape") {
					deactivatePen();
				} else if (!isPenMode()) {
					activatePenWithTool("brush");
				} else {
					deactivatePen();
				}
				return;
			}
		}

		// E = eraser, B = brush (pen mode only)
		if (isPenMode() && (e.key === "e" || e.key === "b") && !e.metaKey && !e.ctrlKey) {
			const focused = document.activeElement;
			const isEditing = focused && (
				focused.isContentEditable ||
				focused.tagName === "INPUT" ||
				focused.tagName === "TEXTAREA" ||
				focused.closest("webview")
			);
			if (!isEditing) {
				e.preventDefault();
				activatePenWithTool(e.key === "e" ? "eraser" : "brush");
				return;
			}
		}

		// Cmd+Z: undo last pen stroke (when pen mode is active)
		if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey && isPenMode()) {
			e.preventDefault();
			undoStroke();
			redrawPenOverlay(canvasX, canvasY, canvasScale);
			saveCanvasDebounced();
			return;
		}
	});

	// -- Empty canvas hint --

	const emptyHint = document.getElementById("canvas-empty-hint");
	emptyHint.innerHTML = "Right-click to create &nbsp;|&nbsp; Double-click for terminal &nbsp;|&nbsp; Drag files to import &nbsp;|&nbsp; ? for shortcuts";

	function updateEmptyHint() {
		if (tiles.length === 0) {
			emptyHint.classList.add("visible");
		} else {
			emptyHint.classList.remove("visible");
		}
	}

	// Watch tile-layer for child changes to toggle the hint
	const tileLayerForHint = document.getElementById("tile-layer");
	if (tileLayerForHint) {
		new MutationObserver(updateEmptyHint).observe(tileLayerForHint, { childList: true });
	}

	// Initial check
	updateEmptyHint();

})();
