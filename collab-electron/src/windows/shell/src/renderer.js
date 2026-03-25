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
import { initZoneLayer, repositionZones, getTilesInZone, getZoneAtPoint, flashZone } from "./zone-renderer.js";
import { attachDrawing, restoreDrawing, clearDrawing } from "./draw-interactions.js";
import { createDrawToolbar } from "./draw-toolbar.js";
import { strokes as penStrokes, clearStrokes as clearPenStrokes, undoStroke, toJSON as penStrokesToJSON, fromJSON as penStrokesFromJSON } from "./pen-stroke-state.js";
import { initPenOverlay, redraw as redrawPenOverlay, togglePenMode, isPenMode, setPenMode, setPenTool } from "./pen-overlay.js";

// -- Dark mode --

function applyCanvasOpacity(percent) {
	const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
	document.documentElement.style.setProperty(
		"--canvas-opacity",
		String(clamped / 100),
	);
}

function initDarkMode() {
	const query = "(prefers-color-scheme: dark)";
	function sync() {
		document.documentElement.classList.toggle(
			"dark",
			window.matchMedia(query).matches,
		);
	}
	sync();
	window.matchMedia(query).addEventListener("change", () => {
		sync();
		drawGrid();
	});
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

const ZOOM_MIN = 0.33;
const ZOOM_MAX = 1;
const ZOOM_RUBBER_BAND_K = 400;
const CANVAS_DBLCLICK_SUPPRESS_MS = 500;
const CELL = 20;
const MAJOR = 80;
const CROSS_R = 4;

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

function showZoomIndicator() {
	const pct = Math.round(canvasScale * 100);
	zoomIndicatorEl.textContent = `${pct}%`;
	zoomIndicatorEl.classList.add("visible");
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
		const startCounterWidth =
			counterpart.getBoundingClientRect().width;
		const totalWidth = startWidth + startCounterWidth;
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

	// -- Canvas persistence --

	let saveTimer = null;

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
				imageData: t.imageData,
				zIndex: t.zIndex,
			})),
			viewport: {
				panX: canvasX,
				panY: canvasY,
				zoom: canvasScale,
			},
			groups: groupsToJSON(),
			penStrokes: penStrokesToJSON(),
		};
	}

	function saveCanvasDebounced() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			window.shellApi.canvasSaveState(getCanvasStateForSave());
		}, 500);
	}

	function saveCanvasImmediate() {
		clearTimeout(saveTimer);
		window.shellApi.canvasSaveState(getCanvasStateForSave());
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
	}

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
			wv.addEventListener("before-input-event", () => {});
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

	function createDrawTile(cx, cy, imageData, extra = {}) {
		const tile = createCanvasTile("draw", cx, cy, extra);
		const dom = tileDOMs.get(tile.id);
		if (!dom || !dom.drawCanvas || !dom.toolbarContainer) return tile;

		const toolbar = createDrawToolbar(dom.toolbarContainer, {
			onClear: () => {
				clearDrawing(dom.drawCanvas);
				tile.imageData = null;
				saveCanvasDebounced();
			},
		});

		attachDrawing(dom.drawCanvas, tile, {
			getColor: toolbar.getColor,
			getBrushSize: toolbar.getBrushSize,
			getTool: toolbar.getTool,
			onStrokeEnd: (dataURL) => {
				tile.imageData = dataURL;
				saveCanvasDebounced();
			},
		});

		if (imageData) {
			tile.imageData = imageData;
			// Wait for canvas to be sized before restoring
			requestAnimationFrame(() => restoreDrawing(dom.drawCanvas, imageData));
		}

		saveCanvasImmediate();
		return tile;
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

		// Drag from title bar AND from container border area
		attachDrag(dom.titleBar, tile, {
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
				// Collect tiles to move: selection + persistent group members
				const dragIds = new Set();
				if (isSelected(tile.id)) {
					for (const st of getSelectedTiles()) dragIds.add(st.id);
				}
				// Always include persistent group members of the dragged tile
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
			onFocus: (id, e) => focusCanvasTile(id, e),
			isSpaceHeld: () => spaceHeld,
			contentOverlay: dom.contentOverlay,
			isSelected: () => isSelected(tile.id),
		});
		attachResize(
			dom.container, tile, viewport,
			repositionAllTiles,
			getAllWebviews,
		);

		tileLayer.appendChild(dom.container);
		tileDOMs.set(tile.id, dom);
		positionTile(dom.container, tile, canvasX, canvasY, canvasScale);

		// Persist label changes triggered by inline rename (term tiles)
		dom.container.addEventListener("tile-label-change", () => {
			saveCanvasDebounced();
		});

		return tile;
	}

	function createTextTile(cx, cy, content = "", noteColor = "#FFF3B0", fontSize = 14) {
		const tile = createCanvasTile("text", cx, cy, { content, noteColor, fontSize });
		const dom = tileDOMs.get(tile.id);
		if (!dom) return;

		// Apply background color
		dom.container.style.setProperty("--sticky-color", noteColor);

		// Set initial content and wire up input handler
		const textEl = dom.contentArea.querySelector(".sticky-text");
		const FONT_SIZES = [10, 12, 14, 16, 20, 24, 32, 48];
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
				const idx = FONT_SIZES.indexOf(tile.fontSize || 14);
				const next = e.deltaY < 0
					? FONT_SIZES[Math.min(idx + 1, FONT_SIZES.length - 1)]
					: FONT_SIZES[Math.max(idx - 1, 0)];
				tile.fontSize = next;
				textEl.style.fontSize = next + "px";
				saveCanvasDebounced();
			}, { passive: false });
		}

		// Wire up A- / A+ buttons
		const fontDownBtn = dom.container.querySelector(".sticky-font-down");
		const fontUpBtn = dom.container.querySelector(".sticky-font-up");
		const adjustFont = (dir) => {
			const FONT_SIZES = [10, 12, 14, 16, 20, 24, 32, 48];
			const idx = FONT_SIZES.indexOf(tile.fontSize || 14);
			const next = dir > 0
				? FONT_SIZES[Math.min(idx + 1, FONT_SIZES.length - 1)]
				: FONT_SIZES[Math.max(idx - 1, 0)];
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

		deselectTile(id);
		removeTileFromGroup(id);
		const tile = getTile(id);
		if (tile) window.shellApi.trackEvent("tile_closed", { type: tile.type });
		removeTile(id);
		saveCanvasImmediate();
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

			wv.addEventListener("dom-ready", () => { });
		}

		saveCanvasImmediate();
	}

	function clearCanvas() {
		const tileIds = tiles.map((t) => t.id);
		for (const id of tileIds) {
			closeCanvasTile(id);
		}
		canvasX = 0;
		canvasY = 0;
		canvasScale = 1;
		updateCanvas();
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

	function panToTile(tile) {
		if (panAnimRaf) {
			cancelAnimationFrame(panAnimRaf);
			panAnimRaf = null;
		}

		const vw = canvasEl.clientWidth;
		const vh = canvasEl.clientHeight;
		const targetX = vw / 2 - (tile.x + tile.width / 2) * canvasScale;
		const targetY = vh / 2 - (tile.y + tile.height / 2) * canvasScale;
		const startX = canvasX;
		const startY = canvasY;
		const startTime = performance.now();
		const DURATION = 350;

		function easeOut(t) {
			return 1 - Math.pow(1 - t, 3);
		}

		function step(now) {
			const elapsed = now - startTime;
			const t = Math.min(elapsed / DURATION, 1);
			const e = easeOut(t);
			canvasX = startX + (targetX - startX) * e;
			canvasY = startY + (targetY - startY) * e;
			updateCanvas();

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

		const menuItems = [
			{ id: "new-terminal", label: "\uFF0B Terminal" },
			{ id: "new-text", label: "\uFF0B Text file" },
			{ id: "new-sticky", label: "\uFF0B Sticky note" },
			{ id: "new-browser", label: "\uFF0B Browser" },
			{ id: "new-draw", label: "\uFF0B Draw" },
		];
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

		if (selected === "new-terminal") {
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
		} else if (selected === "new-draw") {
			createDrawTile(cx, cy);
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
			} else if (savedTile.type === "draw") {
				createDrawTile(
					savedTile.x, savedTile.y,
					savedTile.imageData || null,
					{
						id: savedTile.id,
						width: savedTile.width,
						height: savedTile.height,
						zIndex: savedTile.zIndex,
					},
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

	window.addEventListener("keydown", (e) => {
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
				const newTile = createCanvasTile(src.type, newX, newY, extra);
				if (src.type === "term") {
					spawnTerminalWebview(newTile, false);
				}
				else if (src.type === "draw") {
					const dom = tileDOMs.get(newTile.id);
					if (dom && dom.drawCanvas && dom.toolbarContainer) {
						const toolbar = createDrawToolbar(dom.toolbarContainer, {
							onClear: () => {
								clearDrawing(dom.drawCanvas);
								newTile.imageData = null;
								saveCanvasDebounced();
							},
						});
						attachDrawing(dom.drawCanvas, newTile, {
							getColor: toolbar.getColor,
							getBrushSize: toolbar.getBrushSize,
							getTool: toolbar.getTool,
							onStrokeEnd: (dataURL) => {
								newTile.imageData = dataURL;
								saveCanvasDebounced();
							},
						});
						if (src.imageData) {
							newTile.imageData = src.imageData;
							requestAnimationFrame(() => restoreDrawing(dom.drawCanvas, src.imageData));
						}
					}
				}
				selectTile(newTile.id);
			}
			repositionAllTiles();
			syncSelectionVisuals();
			saveCanvasDebounced();
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

	function handleCanvasRpc(request) {
		const { requestId, method, params } = request;

		try {
			let result;
			switch (method) {
				case "tileList": {
					result = {
						tiles: tiles.map((t) => ({
							id: t.id,
							type: t.type,
							filePath: t.filePath,
							folderPath: t.folderPath,
							position: { x: t.x, y: t.y },
							size: { width: t.width, height: t.height },
						})),
					};
					break;
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
					result = { tileId: tile.id };
					break;
				}
				case "tileRemove": {
					const tile = getTile(params.tileId);
					if (!tile) {
						window.shellApi.canvasRpcResponse({
							requestId,
							error: { code: 3, message: "Tile not found" },
						});
						return;
					}
					closeCanvasTile(params.tileId);
					result = {};
					break;
				}
				case "tileMove": {
					const tile = getTile(params.tileId);
					if (!tile) {
						window.shellApi.canvasRpcResponse({
							requestId,
							error: { code: 3, message: "Tile not found" },
						});
						return;
					}
					tile.x = params.position.x;
					tile.y = params.position.y;
					snapToGrid(tile);
					repositionAllTiles();
					saveCanvasImmediate();
					result = {};
					break;
				}
				case "tileResize": {
					const tile = getTile(params.tileId);
					if (!tile) {
						window.shellApi.canvasRpcResponse({
							requestId,
							error: { code: 3, message: "Tile not found" },
						});
						return;
					}
					tile.width = params.size.width;
					tile.height = params.size.height;
					snapToGrid(tile);
					repositionAllTiles();
					saveCanvasImmediate();
					result = {};
					break;
				}
				case "viewportGet": {
					result = {
						pan: { x: canvasX, y: canvasY },
						zoom: canvasScale,
					};
					break;
				}
				case "viewportSet": {
					if (params.pan) {
						canvasX = params.pan.x;
						canvasY = params.pan.y;
					}
					if (params.zoom !== undefined) {
						canvasScale = params.zoom;
					}
					updateCanvas();
					saveCanvasDebounced();
					result = {};
					break;
				}
				default: {
					window.shellApi.canvasRpcResponse({
						requestId,
						error: {
							code: -32601,
							message: `Unknown method: ${method}`,
						},
					});
					return;
				}
			}
			window.shellApi.canvasRpcResponse({ requestId, result });
		} catch (err) {
			window.shellApi.canvasRpcResponse({
				requestId,
				error: {
					code: -32603,
					message: err.message || "Internal error",
				},
			});
		}
	}

	window.shellApi.onCanvasRpcRequest(handleCanvasRpc);

	// -- beforeunload save --

	window.addEventListener("beforeunload", () => {
		saveCanvasImmediate();
	});
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
		{ keys: "Right-click \u2192 Draw", desc: "New draw tile (freehand)" },
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
		{ keys: "P", desc: "Toggle pen mode" },
		{ keys: "B (pen mode)", desc: "Brush tool" },
		{ keys: "E (pen mode)", desc: "Eraser tool" },
		{ keys: "\u2318Z (pen mode)", desc: "Undo last stroke" },
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

	function updatePenModeUI(active) {
		if (active) {
			activatePenWithTool(activePenDockTool || "brush");
		} else {
			deactivatePen();
		}
	}

	// Pen icon: click to activate, click again to deactivate
	penBrushBtn.addEventListener("mousedown", (e) => e.stopPropagation());
	penBrushBtn.addEventListener("click", () => {
		if (isPenMode() && activePenDockTool === "brush") {
			deactivatePen();
		} else {
			activatePenWithTool("brush");
		}
	});

	penEraserBtn.addEventListener("mousedown", (e) => e.stopPropagation());
	penEraserBtn.addEventListener("click", () => {
		if (isPenMode() && activePenDockTool === "eraser") {
			deactivatePen();
		} else {
			activatePenWithTool("eraser");
		}
	});

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

	// Pen mode keyboard shortcuts
	window.addEventListener("keydown", (e) => {
		// P key = toggle pen mode, Escape = exit pen mode
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
				if (e.key === "Escape" || isPenMode()) {
					deactivatePen();
				} else {
					activatePenWithTool("brush");
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
