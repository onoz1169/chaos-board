/**
 * Create a drawing toolbar inside the given container.
 *
 * @param {HTMLElement} container - The toolbar container element
 * @param {object} opts
 * @param {() => void} opts.onClear - Called when user clicks Clear
 * @returns {{ getColor: () => string, getBrushSize: () => number, getTool: () => 'brush'|'eraser', destroy: () => void }}
 */
export function createDrawToolbar(container, opts) {
  let currentColor = "#222222";
  let currentSize = 5;
  let currentTool = "brush";

  const bar = document.createElement("div");
  bar.className = "draw-toolbar-container";

  // --- Helper: prevent drag on mousedown ---
  function noDrag(el) {
    el.addEventListener("mousedown", (e) => e.stopPropagation());
  }

  // --- Tool buttons ---
  const brushBtn = document.createElement("button");
  brushBtn.className = "draw-tool-btn draw-tool-active";
  brushBtn.textContent = "Pen";
  noDrag(brushBtn);

  const eraserBtn = document.createElement("button");
  eraserBtn.className = "draw-tool-btn";
  eraserBtn.textContent = "Eraser";
  noDrag(eraserBtn);

  function setTool(tool) {
    currentTool = tool;
    brushBtn.classList.toggle("draw-tool-active", tool === "brush");
    eraserBtn.classList.toggle("draw-tool-active", tool === "eraser");
  }

  brushBtn.addEventListener("click", () => setTool("brush"));
  eraserBtn.addEventListener("click", () => setTool("eraser"));

  bar.appendChild(brushBtn);
  bar.appendChild(eraserBtn);

  // --- Separator ---
  function addSep() {
    const sep = document.createElement("div");
    sep.className = "draw-toolbar-separator";
    bar.appendChild(sep);
  }

  addSep();

  // --- Color palette ---
  const colors = ["#ffffff", "#222222", "#ef4444", "#3b82f6", "#22c55e", "#eab308"];
  const swatches = [];

  for (const hex of colors) {
    const swatch = document.createElement("div");
    swatch.className = "draw-color-swatch";
    if (hex === currentColor) swatch.classList.add("draw-color-active");
    swatch.style.background = hex;
    noDrag(swatch);
    swatch.addEventListener("click", () => {
      currentColor = hex;
      for (const s of swatches) {
        s.classList.toggle("draw-color-active", s === swatch);
      }
    });
    swatches.push(swatch);
    bar.appendChild(swatch);
  }

  addSep();

  // --- Brush size buttons ---
  const sizes = [
    { label: "S", value: 2 },
    { label: "M", value: 5 },
    { label: "L", value: 12 },
  ];
  const sizeBtns = [];

  for (const s of sizes) {
    const btn = document.createElement("button");
    btn.className = "draw-size-btn";
    if (s.value === currentSize) btn.classList.add("draw-size-active");
    btn.textContent = s.label;
    noDrag(btn);
    btn.addEventListener("click", () => {
      currentSize = s.value;
      for (const b of sizeBtns) {
        b.classList.toggle("draw-size-active", b === btn);
      }
    });
    sizeBtns.push(btn);
    bar.appendChild(btn);
  }

  addSep();

  // --- Clear button ---
  const clearBtn = document.createElement("button");
  clearBtn.className = "draw-clear-btn";
  clearBtn.textContent = "Clear";
  noDrag(clearBtn);
  clearBtn.addEventListener("click", () => {
    if (opts && opts.onClear) opts.onClear();
  });
  bar.appendChild(clearBtn);

  // --- Mount ---
  container.appendChild(bar);

  return {
    getColor: () => currentColor,
    getBrushSize: () => currentSize,
    getTool: () => currentTool,
    destroy: () => {
      bar.remove();
    },
  };
}
