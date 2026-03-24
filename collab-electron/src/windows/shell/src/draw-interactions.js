/**
 * Attach freehand drawing behavior to a canvas element.
 * Supports Apple Pencil (via Sidecar) with pressure sensitivity.
 *
 * @param {HTMLCanvasElement} canvasEl - The canvas to draw on
 * @param {import('./canvas-state.js').Tile} tile - The tile data object
 * @param {object} opts
 * @param {() => string} opts.getColor - Returns current brush color
 * @param {() => number} opts.getBrushSize - Returns current brush size (1-20)
 * @param {() => 'brush'|'eraser'} opts.getTool - Returns current tool
 * @param {(dataURL: string) => void} opts.onStrokeEnd - Called after each stroke with canvas data URL
 */
export function attachDrawing(canvasEl, tile, opts) {
  const ctx = canvasEl.getContext('2d');

  // --- Canvas sizing with ResizeObserver ---
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const dpr = window.devicePixelRatio || 1;
      const rect = entry.contentRect;
      const newWidth = Math.round(rect.width * dpr);
      const newHeight = Math.round(rect.height * dpr);

      if (canvasEl.width === newWidth && canvasEl.height === newHeight) {
        return;
      }

      // Save current content before resize
      let savedData = null;
      try {
        savedData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
      } catch (_) {
        // Canvas may be empty or zero-sized
      }

      canvasEl.width = newWidth;
      canvasEl.height = newHeight;

      // Restore saved content
      if (savedData) {
        ctx.putImageData(savedData, 0, 0);
      }
    }
  });
  resizeObserver.observe(canvasEl);

  // --- Stroke state ---
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  let lastMidX = 0;
  let lastMidY = 0;

  function getCanvasPoint(e) {
    const rect = canvasEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (e.clientX - rect.left) * dpr,
      y: (e.clientY - rect.top) * dpr,
    };
  }

  function getLineWidth(e) {
    const baseBrushSize = opts.getBrushSize();
    const dpr = window.devicePixelRatio || 1;
    const scaled = baseBrushSize * dpr;

    if (e.pointerType === 'pen' && e.pressure > 0) {
      return scaled * (0.3 + e.pressure * 1.4);
    }
    return scaled;
  }

  function applyStyle(e) {
    const tool = opts.getTool();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = opts.getColor();
    }

    ctx.lineWidth = getLineWidth(e);
  }

  // --- Pointer event handlers ---
  function onPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    canvasEl.setPointerCapture(e.pointerId);

    isDrawing = true;
    const pt = getCanvasPoint(e);
    lastX = pt.x;
    lastY = pt.y;
    lastMidX = pt.x;
    lastMidY = pt.y;

    applyStyle(e);

    // Draw a dot for single taps
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle =
      opts.getTool() === 'eraser' ? 'rgba(0,0,0,1)' : opts.getColor();
    if (opts.getTool() === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    }
    ctx.fill();
  }

  function onPointerMove(e) {
    e.preventDefault();
    if (!isDrawing) return;

    const pt = getCanvasPoint(e);
    const midX = (lastX + pt.x) / 2;
    const midY = (lastY + pt.y) / 2;

    applyStyle(e);

    ctx.beginPath();
    ctx.moveTo(lastMidX, lastMidY);
    ctx.quadraticCurveTo(lastX, lastY, midX, midY);
    ctx.stroke();

    lastX = pt.x;
    lastY = pt.y;
    lastMidX = midX;
    lastMidY = midY;
  }

  function onPointerEnd(e) {
    e.preventDefault();
    if (!isDrawing) return;

    isDrawing = false;

    // Draw final segment to the last point
    const pt = getCanvasPoint(e);
    applyStyle(e);
    ctx.beginPath();
    ctx.moveTo(lastMidX, lastMidY);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();

    // Reset composite operation
    ctx.globalCompositeOperation = 'source-over';

    opts.onStrokeEnd(canvasEl.toDataURL());
  }

  canvasEl.addEventListener('pointerdown', onPointerDown);
  canvasEl.addEventListener('pointermove', onPointerMove);
  canvasEl.addEventListener('pointerup', onPointerEnd);
  canvasEl.addEventListener('pointerleave', onPointerEnd);
}

/**
 * Restore a saved drawing from a data URL.
 * @param {HTMLCanvasElement} canvasEl
 * @param {string} dataURL
 */
export function restoreDrawing(canvasEl, dataURL) {
  if (!dataURL) return;

  const ctx = canvasEl.getContext('2d');
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
  };
  img.src = dataURL;
}

/**
 * Clear the entire canvas.
 * @param {HTMLCanvasElement} canvasEl
 */
export function clearDrawing(canvasEl) {
  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
}
