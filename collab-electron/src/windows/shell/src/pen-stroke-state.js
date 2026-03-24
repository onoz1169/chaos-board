/**
 * @typedef {Object} StrokePoint
 * @property {number} x - Canvas X coordinate
 * @property {number} y - Canvas Y coordinate
 * @property {number} pressure - Pen pressure (0-1), 0.5 for mouse
 */

/**
 * @typedef {Object} Stroke
 * @property {string} id - Unique stroke ID
 * @property {StrokePoint[]} points - Array of points
 * @property {string} color - Stroke color (e.g. '#222222')
 * @property {number} size - Base brush size (1-20)
 * @property {'brush'|'eraser'} tool - Tool used
 * @property {{ minX: number, minY: number, maxX: number, maxY: number }} bounds - Bounding box (canvas coords)
 */

/** @type {Stroke[]} */
export const strokes = [];

let idCounter = 0;

/**
 * Create a new stroke and add it to the array.
 * @param {string} color
 * @param {number} size
 * @param {'brush'|'eraser'} tool
 * @returns {Stroke}
 */
export function beginStroke(color, size, tool) {
    idCounter++;
    const stroke = {
        id: `stroke-${Date.now()}-${idCounter}`,
        points: [],
        color,
        size,
        tool,
        bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    };
    strokes.push(stroke);
    return stroke;
}

/**
 * Add a point to a stroke and update its bounding box.
 * @param {Stroke} stroke
 * @param {number} x - Canvas X
 * @param {number} y - Canvas Y
 * @param {number} pressure
 */
export function addPoint(stroke, x, y, pressure) {
    stroke.points.push({ x, y, pressure });
    if (x < stroke.bounds.minX) stroke.bounds.minX = x;
    if (x > stroke.bounds.maxX) stroke.bounds.maxX = x;
    if (y < stroke.bounds.minY) stroke.bounds.minY = y;
    if (y > stroke.bounds.maxY) stroke.bounds.maxY = y;
}

/**
 * Remove a stroke by ID.
 * @param {string} id
 */
export function removeStroke(id) {
    const idx = strokes.findIndex(s => s.id === id);
    if (idx !== -1) strokes.splice(idx, 1);
}

/**
 * Clear all strokes.
 */
export function clearStrokes() {
    strokes.length = 0;
}

/**
 * Get strokes whose bounding box intersects the given viewport bounds (canvas coords).
 * Used for viewport culling to skip off-screen strokes.
 * @param {number} minX
 * @param {number} minY
 * @param {number} maxX
 * @param {number} maxY
 * @returns {Stroke[]}
 */
export function getVisibleStrokes(minX, minY, maxX, maxY) {
    // Add padding for stroke width
    const pad = 30;
    return strokes.filter(s =>
        s.bounds.maxX + pad >= minX &&
        s.bounds.minX - pad <= maxX &&
        s.bounds.maxY + pad >= minY &&
        s.bounds.minY - pad <= maxY
    );
}

/**
 * Serialize strokes to JSON-safe array.
 * @returns {object[]}
 */
export function toJSON() {
    return strokes.map(s => ({
        id: s.id,
        points: s.points,
        color: s.color,
        size: s.size,
        tool: s.tool,
        bounds: s.bounds,
    }));
}

/**
 * Restore strokes from JSON array.
 * @param {object[]} data
 */
export function fromJSON(data) {
    strokes.length = 0;
    if (!Array.isArray(data)) return;
    for (const s of data) {
        strokes.push({
            id: s.id || `stroke-${Date.now()}-${++idCounter}`,
            points: s.points || [],
            color: s.color || '#222222',
            size: s.size || 5,
            tool: s.tool || 'brush',
            bounds: s.bounds || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
        });
    }
}

/**
 * Undo the last stroke. Returns the removed stroke or null.
 * @returns {Stroke|null}
 */
export function undoStroke() {
    return strokes.pop() || null;
}
