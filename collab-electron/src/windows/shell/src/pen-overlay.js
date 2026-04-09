import { strokes, beginStroke, addPoint, getVisibleStrokes, clearStrokes, undoStroke, removeStrokes } from "./pen-stroke-state.js";

/** @type {boolean} */
let penModeActive = false;

/** @type {HTMLCanvasElement|null} */
let overlayCanvas = null;

/** @type {CanvasRenderingContext2D|null} */
let ctx = null;

// Current drawing tool state (set from outside via setPenTool)
let currentColor = "#ffffff";
let currentSize = 3;
let currentTool = "brush"; // "brush" | "eraser"

// Active stroke state
let activeStroke = null;
let lastX = 0;
let lastY = 0;

// Marquee selection state
let marquee = null; // { startX, startY, endX, endY } in canvas coords
/** @type {Set<string>} */
let selectedStrokeIds = new Set();

/**
 * Initialize the pen overlay. Call once after DOM is ready.
 * Creates the overlay canvas element inside the given parent.
 *
 * @param {HTMLElement} parentEl - The canvas container (panel-viewer element)
 * @param {object} opts
 * @param {() => void} opts.onStrokeEnd - Called after each stroke completes (for save)
 */
export function initPenOverlay(parentEl, opts) {
    overlayCanvas = document.createElement("canvas");
    overlayCanvas.id = "pen-overlay-canvas";
    overlayCanvas.className = "pen-overlay-canvas";
    overlayCanvas.style.touchAction = "none";
    parentEl.appendChild(overlayCanvas);

    // Resize to fill parent
    function resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = parentEl.clientWidth;
        const h = parentEl.clientHeight;
        overlayCanvas.width = w * dpr;
        overlayCanvas.height = h * dpr;
        overlayCanvas.style.width = w + "px";
        overlayCanvas.style.height = h + "px";
        ctx = overlayCanvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    new ResizeObserver(resize).observe(parentEl);

    // Pointer events
    overlayCanvas.addEventListener("pointerdown", (e) => {
        if (!penModeActive) return;
        e.preventDefault();
        e.stopPropagation();
        overlayCanvas.setPointerCapture(e.pointerId);

        const cx = (e.offsetX - _vp.panX) / _vp.zoom;
        const cy = (e.offsetY - _vp.panY) / _vp.zoom;

        // Shift+drag with eraser = marquee select
        if (e.shiftKey && currentTool === "eraser") {
            marquee = { startX: cx, startY: cy, endX: cx, endY: cy };
            selectedStrokeIds.clear();
            return;
        }

        const pressure = e.pointerType === "pen" ? e.pressure : 0.5;
        activeStroke = beginStroke(
            currentTool === "eraser" ? "#000000" : currentColor,
            currentTool === "eraser" ? currentSize * 5 : currentSize,
            currentTool
        );
        addPoint(activeStroke, cx, cy, pressure);
        lastX = cx;
        lastY = cy;
    });

    overlayCanvas.addEventListener("pointermove", (e) => {
        if (!penModeActive) return;

        // Marquee drag
        if (marquee) {
            e.preventDefault();
            e.stopPropagation();
            marquee.endX = (e.offsetX - _vp.panX) / _vp.zoom;
            marquee.endY = (e.offsetY - _vp.panY) / _vp.zoom;
            redraw(_vp.panX, _vp.panY, _vp.zoom);
            return;
        }

        if (!activeStroke) return;
        e.preventDefault();
        e.stopPropagation();

        const pressure = e.pointerType === "pen" ? e.pressure : 0.5;
        const cx = (e.offsetX - _vp.panX) / _vp.zoom;
        const cy = (e.offsetY - _vp.panY) / _vp.zoom;

        addPoint(activeStroke, cx, cy, pressure);

        // Draw just this segment immediately for real-time feedback
        drawStrokeSegment(activeStroke, activeStroke.points.length - 2);

        lastX = cx;
        lastY = cy;
    });

    function endStroke(e) {
        // Marquee release: find intersecting strokes
        if (marquee) {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const r = { minX: Math.min(marquee.startX, marquee.endX), minY: Math.min(marquee.startY, marquee.endY),
                        maxX: Math.max(marquee.startX, marquee.endX), maxY: Math.max(marquee.startY, marquee.endY) };
            selectedStrokeIds.clear();
            for (const s of strokes) {
                if (s.bounds.maxX >= r.minX && s.bounds.minX <= r.maxX &&
                    s.bounds.maxY >= r.minY && s.bounds.minY <= r.maxY) {
                    selectedStrokeIds.add(s.id);
                }
            }
            marquee = null;
            redraw(_vp.panX, _vp.panY, _vp.zoom);
            return;
        }

        if (!activeStroke) return;
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        // Remove strokes with fewer than 2 points (just a click)
        if (activeStroke.points.length < 2) {
            const idx = strokes.indexOf(activeStroke);
            if (idx !== -1) strokes.splice(idx, 1);
        }
        activeStroke = null;
        // Full redraw to clean up any rendering artifacts
        redraw(_vp.panX, _vp.panY, _vp.zoom);
        if (opts.onStrokeEnd) opts.onStrokeEnd();
    }

    overlayCanvas.addEventListener("pointerup", endStroke);
    overlayCanvas.addEventListener("pointerleave", endStroke);
    overlayCanvas.addEventListener("pointercancel", endStroke);

    // Delete selected strokes
    document.addEventListener("keydown", (e) => {
        if (!penModeActive || selectedStrokeIds.size === 0) return;
        if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            removeStrokes(selectedStrokeIds);
            selectedStrokeIds.clear();
            redraw(_vp.panX, _vp.panY, _vp.zoom);
            if (opts.onStrokeEnd) opts.onStrokeEnd();
        }
        if (e.key === "Escape") selectedStrokeIds.clear(), redraw(_vp.panX, _vp.panY, _vp.zoom);
    });
}

// Cached viewport for use in pointer handlers
const _vp = { panX: 0, panY: 0, zoom: 1 };

/**
 * Redraw all visible strokes. Call on every viewport change (pan/zoom).
 * @param {number} panX
 * @param {number} panY
 * @param {number} zoom
 */
export function redraw(panX, panY, zoom) {
    _vp.panX = panX;
    _vp.panY = panY;
    _vp.zoom = zoom;

    if (!ctx || !overlayCanvas) return;

    const w = overlayCanvas.clientWidth;
    const h = overlayCanvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    if (!penModeActive && strokes.length === 0) return;

    // Viewport bounds in canvas coords (for culling)
    const minCX = -panX / zoom;
    const minCY = -panY / zoom;
    const maxCX = (w - panX) / zoom;
    const maxCY = (h - panY) / zoom;

    const visible = getVisibleStrokes(minCX, minCY, maxCX, maxCY);

    for (const stroke of visible) {
        drawFullStroke(stroke);
        // Highlight selected strokes
        if (selectedStrokeIds.has(stroke.id)) {
            ctx.save();
            ctx.strokeStyle = "#ff4444";
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            const b = stroke.bounds;
            const sx = b.minX * zoom + panX - 4, sy = b.minY * zoom + panY - 4;
            const sw = (b.maxX - b.minX) * zoom + 8, sh = (b.maxY - b.minY) * zoom + 8;
            ctx.strokeRect(sx, sy, sw, sh);
            ctx.restore();
        }
    }

    // Draw marquee rectangle
    if (marquee) {
        ctx.save();
        ctx.strokeStyle = "#4488ff";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        const mx = marquee.startX * zoom + panX, my = marquee.startY * zoom + panY;
        const mw = (marquee.endX - marquee.startX) * zoom, mh = (marquee.endY - marquee.startY) * zoom;
        ctx.strokeRect(mx, my, mw, mh);
        ctx.restore();
    }
}

/**
 * Draw a complete stroke with bezier smoothing.
 */
function drawFullStroke(stroke) {
    const pts = stroke.points;
    if (pts.length < 2) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (stroke.tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
    } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = stroke.color;
    }

    // Draw with varying width based on pressure
    for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];

        const pressure = p1.pressure || 0.5;
        const lineWidth = stroke.size * (0.3 + pressure * 1.4) * _vp.zoom;

        ctx.beginPath();
        ctx.lineWidth = lineWidth;

        if (stroke.tool !== "eraser") {
            ctx.strokeStyle = stroke.color;
        }

        // Transform canvas coords to screen coords
        const sx0 = p0.x * _vp.zoom + _vp.panX;
        const sy0 = p0.y * _vp.zoom + _vp.panY;
        const sx1 = p1.x * _vp.zoom + _vp.panX;
        const sy1 = p1.y * _vp.zoom + _vp.panY;

        if (i === 1) {
            ctx.moveTo(sx0, sy0);
            ctx.lineTo(sx1, sy1);
        } else {
            // Quadratic bezier through midpoints for smoothing
            const prev = pts[i - 2];
            const spx = prev.x * _vp.zoom + _vp.panX;
            const spy = prev.y * _vp.zoom + _vp.panY;
            const midX0 = (spx + sx0) / 2;
            const midY0 = (spy + sy0) / 2;
            const midX1 = (sx0 + sx1) / 2;
            const midY1 = (sy0 + sy1) / 2;
            ctx.moveTo(midX0, midY0);
            ctx.quadraticCurveTo(sx0, sy0, midX1, midY1);
        }

        ctx.stroke();
    }

    ctx.restore();
}

/**
 * Draw a single segment of the active stroke for real-time feedback.
 */
function drawStrokeSegment(stroke, segIdx) {
    const pts = stroke.points;
    if (segIdx < 0 || segIdx >= pts.length - 1) return;

    const p0 = pts[segIdx];
    const p1 = pts[segIdx + 1];

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (stroke.tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
    } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = stroke.color;
    }

    const pressure = p1.pressure || 0.5;
    ctx.lineWidth = stroke.size * (0.3 + pressure * 1.4) * _vp.zoom;

    const sx0 = p0.x * _vp.zoom + _vp.panX;
    const sy0 = p0.y * _vp.zoom + _vp.panY;
    const sx1 = p1.x * _vp.zoom + _vp.panX;
    const sy1 = p1.y * _vp.zoom + _vp.panY;

    ctx.beginPath();
    ctx.moveTo(sx0, sy0);
    ctx.lineTo(sx1, sy1);
    ctx.stroke();

    ctx.restore();
}

/** Toggle pen mode on/off. */
export function togglePenMode() {
    penModeActive = !penModeActive;
    if (overlayCanvas) {
        overlayCanvas.classList.toggle("pen-mode-active", penModeActive);
    }
    return penModeActive;
}

/** Get pen mode state. */
export function isPenMode() {
    return penModeActive;
}

/** Set pen mode explicitly. */
export function setPenMode(active) {
    penModeActive = active;
    if (overlayCanvas) {
        overlayCanvas.classList.toggle("pen-mode-active", penModeActive);
    }
}

/** Update current pen tool settings. */
export function setPenTool(color, size, tool) {
    if (color !== undefined) currentColor = color;
    if (size !== undefined) currentSize = size;
    if (tool !== undefined) currentTool = tool;
}

/** Get current pen settings. */
export function getPenSettings() {
    return { color: currentColor, size: currentSize, tool: currentTool };
}
