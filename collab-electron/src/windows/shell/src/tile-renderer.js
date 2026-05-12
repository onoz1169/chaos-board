/**
 * Creates the DOM structure for a tile.
 * @param {import('./canvas-state.js').Tile} tile
 * @param {object} callbacks
 * @param {(id: string) => void} callbacks.onClose
 * @param {(id: string, e?: MouseEvent) => void} callbacks.onFocus
 * @param {((id: string) => void)|null} [callbacks.onOpenInViewer]
 * @param {((id: string, url: string) => void)|null} [callbacks.onNavigate]
 */
const STICKY_COLOR = "#2a2a2a";

/** Appends the four connection handles (top/right/bottom/left) to a tile container. */
function appendConnectionHandles(container) {
  for (const edge of ["top", "right", "bottom", "left"]) {
    const handle = document.createElement("div");
    handle.className = "tile-conn-handle";
    handle.dataset.edge = edge;
    container.appendChild(handle);
  }
}

/** Adds mouseenter/mouseleave hover class toggling to a tile container. */
function addHoverListeners(container) {
  container.addEventListener("mouseenter", () => container.classList.add("tile-hovered"));
  container.addEventListener("mouseleave", () => container.classList.remove("tile-hovered"));
}

function buildShapeSVG(shapeType, fill, border) {
  const sw = 2;
  switch (shapeType) {
    case "circle":
      return `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><ellipse cx="50" cy="50" rx="48" ry="48" fill="${fill}" stroke="${border}" stroke-width="${sw}"/></svg>`;
    case "diamond":
      return `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="50,2 98,50 50,98 2,50" fill="${fill}" stroke="${border}" stroke-width="${sw}"/></svg>`;
    case "triangle":
      return `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="50,4 96,96 4,96" fill="${fill}" stroke="${border}" stroke-width="${sw}"/></svg>`;
    case "arrow-right":
      return `<svg viewBox="0 0 100 60" preserveAspectRatio="none"><polygon points="0,15 70,15 70,0 100,30 70,60 70,45 0,45" fill="${fill}" stroke="${border}" stroke-width="${sw}"/></svg>`;
    case "line":
      return `<svg viewBox="0 0 100 20" preserveAspectRatio="none"><line x1="2" y1="10" x2="98" y2="10" stroke="${border}" stroke-width="3" stroke-linecap="round"/></svg>`;
    case "rect":
    default:
      return `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="1" y="1" width="98" height="98" rx="4" fill="${fill}" stroke="${border}" stroke-width="${sw}"/></svg>`;
  }
}

export function createTileDOM(tile, callbacks) {
  // -- Shape tile --
  if (tile.type === "shape") {
    const container = document.createElement("div");
    container.className = "canvas-tile shape-tile";
    container.dataset.tileId = tile.id;
    container.dataset.tileType = "shape";
    container.setAttribute("role", "region");

    const svgWrap = document.createElement("div");
    svgWrap.className = "shape-svg-wrap";
    svgWrap.innerHTML = buildShapeSVG(tile.shapeType || "rect", tile.shapeColor || "rgba(80,140,255,0.25)", tile.shapeBorder || "rgba(80,140,255,0.8)");
    container.appendChild(svgWrap);

    // Thin toolbar shown on hover
    const toolbar = document.createElement("div");
    toolbar.className = "shape-toolbar";

    const SHAPES = [
      { id: "rect", label: "▭" },
      { id: "circle", label: "○" },
      { id: "diamond", label: "◇" },
      { id: "triangle", label: "△" },
      { id: "arrow-right", label: "→" },
      { id: "line", label: "─" },
    ];
    for (const s of SHAPES) {
      const btn = document.createElement("button");
      btn.className = "shape-pick-btn" + (s.id === (tile.shapeType || "rect") ? " active" : "");
      btn.textContent = s.label;
      btn.title = s.id;
      btn.addEventListener("mousedown", (e) => e.stopPropagation());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        tile.shapeType = s.id;
        svgWrap.innerHTML = buildShapeSVG(s.id, tile.shapeColor || "rgba(80,140,255,0.25)", tile.shapeBorder || "rgba(80,140,255,0.8)");
        toolbar.querySelectorAll(".shape-pick-btn").forEach(b => b.classList.toggle("active", b.title === s.id));
        container.dispatchEvent(new CustomEvent("shape-change", { bubbles: true }));
      });
      toolbar.appendChild(btn);
    }

    // Color swatches
    const COLORS = [
      { fill: "rgba(80,140,255,0.25)", border: "rgba(80,140,255,0.8)" },
      { fill: "rgba(60,180,100,0.25)", border: "rgba(60,180,100,0.8)" },
      { fill: "rgba(220,80,80,0.25)", border: "rgba(220,80,80,0.8)" },
      { fill: "rgba(200,180,120,0.25)", border: "rgba(200,180,120,0.8)" },
      { fill: "rgba(160,120,220,0.25)", border: "rgba(160,120,220,0.8)" },
      { fill: "rgba(255,255,255,0.1)", border: "rgba(255,255,255,0.5)" },
    ];
    const sep = document.createElement("span");
    sep.className = "shape-toolbar-sep";
    toolbar.appendChild(sep);
    for (const c of COLORS) {
      const swatch = document.createElement("button");
      swatch.className = "shape-color-btn";
      swatch.style.background = c.border;
      swatch.addEventListener("mousedown", (e) => e.stopPropagation());
      swatch.addEventListener("click", (e) => {
        e.stopPropagation();
        tile.shapeColor = c.fill;
        tile.shapeBorder = c.border;
        svgWrap.innerHTML = buildShapeSVG(tile.shapeType || "rect", c.fill, c.border);
        container.dispatchEvent(new CustomEvent("shape-change", { bubbles: true }));
      });
      toolbar.appendChild(swatch);
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "tile-action-btn tile-close-btn shape-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close";
    closeBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); callbacks.onClose(tile.id); });
    toolbar.appendChild(closeBtn);

    container.appendChild(toolbar);

    // Editable text label inside the shape
    const textEl = document.createElement("div");
    textEl.className = "shape-text";
    textEl.contentEditable = "true";
    textEl.spellcheck = false;
    textEl.dataset.placeholder = "...";
    if (tile.content) textEl.textContent = tile.content;
    textEl.addEventListener("mousedown", (e) => e.stopPropagation());
    textEl.addEventListener("click", (e) => { e.stopPropagation(); textEl.focus(); });
    textEl.addEventListener("focus", () => textEl.classList.add("editing"));
    textEl.addEventListener("blur", () => textEl.classList.remove("editing"));
    textEl.addEventListener("input", () => {
      tile.content = textEl.textContent;
      container.dispatchEvent(new CustomEvent("shape-change", { bubbles: true }));
    });
    container.appendChild(textEl);

    const contentOverlay = document.createElement("div");
    contentOverlay.className = "tile-content-overlay";
    container.appendChild(contentOverlay);

    addHoverListeners(container);

    // Double-click to edit text (bypasses overlay)
    container.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      contentOverlay.style.pointerEvents = "none";
      textEl.focus();
      const restore = () => {
        contentOverlay.style.pointerEvents = "";
        textEl.removeEventListener("blur", restore);
      };
      textEl.addEventListener("blur", restore);
    });

    appendConnectionHandles(container);

    return {
      container, titleBar: container, titleText: null,
      contentArea: svgWrap, contentOverlay, closeBtn, textEl,
      urlInput: undefined, navBack: undefined, navForward: undefined, navReload: undefined,
    };
  }

  // -- Sticky note tile --
  if (tile.type === "text") {
    const container = document.createElement("div");
    container.className = "canvas-tile";
    container.dataset.tileId = tile.id;
    container.dataset.tileType = tile.type;
    container.setAttribute("role", "region");
    container.style.setProperty("--sticky-color", STICKY_COLOR);

    const titleBar = document.createElement("div");
    titleBar.className = "tile-title-bar";

    const btnGroup = document.createElement("div");
    btnGroup.className = "tile-btn-group";

    const fontDownBtn = document.createElement("button");
    fontDownBtn.className = "tile-action-btn sticky-font-down";
    fontDownBtn.textContent = "A−";
    fontDownBtn.title = "Decrease font size";
    fontDownBtn.setAttribute("aria-label", "Decrease font size");
    fontDownBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    btnGroup.appendChild(fontDownBtn);

    const fontUpBtn = document.createElement("button");
    fontUpBtn.className = "tile-action-btn sticky-font-up";
    fontUpBtn.textContent = "A+";
    fontUpBtn.title = "Increase font size";
    fontUpBtn.setAttribute("aria-label", "Increase font size");
    fontUpBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    btnGroup.appendChild(fontUpBtn);

    const closeBtn = document.createElement("button");
    closeBtn.className = "tile-action-btn tile-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close tile";
    closeBtn.setAttribute("aria-label", "Close tile");
    closeBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      callbacks.onClose(tile.id);
    });
    btnGroup.appendChild(closeBtn);
    titleBar.appendChild(btnGroup);

    const contentArea = document.createElement("div");
    contentArea.className = "tile-content";

    const textEl = document.createElement("div");
    textEl.className = "sticky-text";
    textEl.contentEditable = "true";
    textEl.setAttribute("placeholder", "メモ...");
    textEl.dataset.placeholder = "Type here...";
    textEl.addEventListener("focus", () => textEl.classList.add("editing"));
    textEl.addEventListener("blur", () => textEl.classList.remove("editing"));
    // When editing (focused), stop propagation so typing and text selection work.
    // When not editing, let mousedown bubble to drag handlers so the note is draggable.
    textEl.addEventListener("mousedown", (e) => {
      if (textEl.classList.contains("editing")) {
        e.stopPropagation();
      }
    });
    // Double-click to start editing
    textEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      textEl.focus();
    });
    contentArea.appendChild(textEl);

    // contentOverlay is placed outside contentArea so it does not cover the
    // contenteditable sticky-text element. For sticky notes the overlay sits
    // as a sibling of contentArea inside the container (same as standard tiles).
    const contentOverlay = document.createElement("div");
    contentOverlay.className = "tile-content-overlay";
    // Sticky notes are edited directly via contenteditable. The overlay must
    // never intercept pointer events — dragging is handled solely by titleBar.
    contentOverlay.style.pointerEvents = "none";

    container.appendChild(titleBar);
    container.appendChild(contentArea);
    container.appendChild(contentOverlay);


    addHoverListeners(container);
    appendConnectionHandles(container);

    return {
      container,
      titleBar,
      titleText: null,
      contentArea,
      contentOverlay,
      closeBtn,
      urlInput: undefined,
      navBack: undefined,
      navForward: undefined,
      navReload: undefined,
    };
  }

  // -- Standard tile --
  const container = document.createElement("div");
  container.className = "canvas-tile";
  container.dataset.tileId = tile.id;
  container.dataset.tileType = tile.type;
  container.setAttribute("role", "region");

  const titleBar = document.createElement("div");
  titleBar.className = "tile-title-bar";

  const titleText = document.createElement("span");
  titleText.className = "tile-title-text";
  const label = getTileLabel(tile);
  const parentSpan = document.createElement("span");
  parentSpan.className = "tile-title-parent";
  parentSpan.textContent = label.parent;
  const nameSpan = document.createElement("span");
  nameSpan.className = "tile-title-name";
  nameSpan.textContent = label.name;
  titleText.appendChild(parentSpan);
  titleText.appendChild(nameSpan);
  if (tile.filePath) titleText.title = tile.filePath;
  if (tile.folderPath) titleText.title = tile.folderPath;
  // For term tiles, add a status dot before the title text
  if (tile.type === "term") {
    const statusDot = document.createElement("span");
    statusDot.className = "tile-term-status";
    statusDot.title = "Running";
    titleBar.appendChild(statusDot);
  }

  titleBar.appendChild(titleText);

  // For term tiles, add a pencil icon and allow inline rename
  if (tile.type === "term") {
    titleText.title = "Double-click to rename";
    const renameIcon = document.createElement("span");
    renameIcon.className = "tile-rename-icon";
    renameIcon.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>`;
    renameIcon.title = "Rename terminal";
    renameIcon.addEventListener("mousedown", (e) => e.stopPropagation());
    titleText.appendChild(renameIcon);

    function startRename() {
      const currentName = titleText.querySelector(".tile-title-name")?.textContent || "Terminal";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "tile-label-input";
      input.value = currentName;
      titleText.style.display = "none";
      titleBar.insertBefore(input, titleText.nextSibling);
      input.focus();
      input.select();

      let editDone = false;

      function commitEdit() {
        if (editDone) return;
        editDone = true;
        const newName = input.value.trim();
        if (newName) {
          tile.label = newName;
        } else {
          tile.label = undefined;
        }
        input.remove();
        titleText.style.display = "";
        // Refresh displayed text — re-add child spans and the rename icon
        titleText.textContent = "";
        const ps = document.createElement("span");
        ps.className = "tile-title-parent";
        ps.textContent = "";
        const ns = document.createElement("span");
        ns.className = "tile-title-name";
        ns.textContent = tile.label || "Terminal";
        titleText.appendChild(ps);
        titleText.appendChild(ns);
        titleText.appendChild(renameIcon);
        // Notify consumer to save (custom event)
        titleBar.dispatchEvent(new CustomEvent("tile-label-change", { bubbles: true, detail: { id: tile.id } }));
      }

      function cancelEdit() {
        if (editDone) return;
        editDone = true;
        input.remove();
        titleText.style.display = "";
      }

      input.addEventListener("mousedown", (ev) => ev.stopPropagation());
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); commitEdit(); }
        if (ev.key === "Escape") { ev.preventDefault(); cancelEdit(); }
      });
      input.addEventListener("blur", commitEdit);
    }

    titleText.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      startRename();
    });
    renameIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      startRename();
    });
  }

  // For browser tiles, add nav controls and a URL input to the title bar
  let urlInput;
  let navBack;
  let navForward;
  let navReload;
  if (tile.type === "browser") {
    const navGroup = document.createElement("div");
    navGroup.className = "tile-nav-group";

    navBack = document.createElement("button");
    navBack.className = "tile-nav-btn";
    navBack.title = "Back";
    navBack.setAttribute("aria-label", "Back");
    navBack.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>`;
    navBack.disabled = true;
    navBack.addEventListener("mousedown", (e) => e.stopPropagation());

    navForward = document.createElement("button");
    navForward.className = "tile-nav-btn";
    navForward.title = "Forward";
    navForward.setAttribute("aria-label", "Forward");
    navForward.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>`;
    navForward.disabled = true;
    navForward.addEventListener("mousedown", (e) => e.stopPropagation());

    navReload = document.createElement("button");
    navReload.className = "tile-nav-btn";
    navReload.title = "Reload";
    navReload.setAttribute("aria-label", "Reload");
    navReload.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3v4h-4"/><path d="M12.36 10a5 5 0 1 1-.96-5.36L13 7"/></svg>`;
    navReload.addEventListener("mousedown", (e) => e.stopPropagation());

    navGroup.appendChild(navBack);
    navGroup.appendChild(navForward);
    navGroup.appendChild(navReload);
    titleBar.appendChild(navGroup);
    urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "tile-url-input";
    urlInput.placeholder = "Enter URL...";
    urlInput.value = tile.url || "";
    if (tile.url) urlInput.readOnly = true;
    let dragOccurred = false;
    urlInput.addEventListener("mousedown", (e) => {
      dragOccurred = false;
      if (urlInput.readOnly) return;
      e.stopPropagation();
    });
    urlInput.addEventListener("mousemove", () => {
      dragOccurred = true;
    });
    urlInput.addEventListener("click", () => {
      if (urlInput.readOnly && !dragOccurred) {
        urlInput.readOnly = false;
        urlInput.select();
      }
    });
    urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (url && callbacks.onNavigate) callbacks.onNavigate(tile.id, url);
        urlInput.readOnly = true;
        urlInput.blur();
      }
      if (e.key === "Escape") {
        urlInput.value = tile.url || "";
        urlInput.readOnly = true;
        urlInput.blur();
      }
    });
    urlInput.addEventListener("blur", () => {
      if (!urlInput.readOnly) {
        urlInput.value = tile.url || "";
        urlInput.readOnly = true;
      }
      window.getSelection()?.removeAllRanges();
    });
    titleText.style.display = "none";
  }

  const btnGroup = document.createElement("div");
  btnGroup.className = "tile-btn-group";

  const copyablePath = tile.filePath || tile.folderPath;
  if (copyablePath) {
    const copySvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M5 11H3.5A1.5 1.5 0 0 1 2 9.5V3.5A1.5 1.5 0 0 1 3.5 2h6A1.5 1.5 0 0 1 11 3.5V5"/></svg>`;
    const checkSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#4caf50" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.5 12 13 4"/></svg>`;
    const copyBtn = document.createElement("button");
    copyBtn.className = "tile-action-btn tile-copy-path-btn";
    copyBtn.innerHTML = copySvg;
    copyBtn.title = "Copy path";
    copyBtn.setAttribute("aria-label", "Copy path");
    copyBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(copyablePath);
      copyBtn.innerHTML = checkSvg;
      setTimeout(() => { copyBtn.innerHTML = copySvg; }, 1000);
    });
    btnGroup.appendChild(copyBtn);
  }

  if (tile.filePath && callbacks.onOpenInViewer) {
    const viewBtn = document.createElement("button");
    viewBtn.className = "tile-action-btn tile-view-btn";
    viewBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s3-5.5 7-5.5S15 8 15 8s-3 5.5-7 5.5S1 8 1 8z"/><circle cx="8" cy="8" r="2.5"/></svg>`;
    viewBtn.title = "Open in viewer";
    viewBtn.setAttribute("aria-label", "Open in viewer");
    viewBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    viewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      callbacks.onOpenInViewer(tile.id);
    });
    btnGroup.appendChild(viewBtn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.className = "tile-action-btn tile-close-btn";
  closeBtn.innerHTML = "&times;";
  closeBtn.title = "Close tile";
  closeBtn.setAttribute("aria-label", "Close tile");
  closeBtn.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onClose(tile.id);
  });
  btnGroup.appendChild(closeBtn);
  titleBar.appendChild(btnGroup);

  const contentArea = document.createElement("div");
  contentArea.className = "tile-content";

  const contentOverlay = document.createElement("div");
  contentOverlay.className = "tile-content-overlay";

  if (urlInput) titleBar.insertBefore(urlInput, btnGroup);

  container.appendChild(titleBar);
  container.appendChild(contentArea);
  contentArea.appendChild(contentOverlay);

  addHoverListeners(container);
  appendConnectionHandles(container);

  return { container, titleBar, titleText, contentArea, contentOverlay, closeBtn, urlInput, navBack, navForward, navReload };
}

export function getTileLabel(tile) {
  if (tile.type === "shape") return { parent: "", name: tile.shapeType || "rect" };
  if (tile.type === "term") return { parent: "", name: tile.label || "Terminal" };
  if (tile.type === "browser") {
    if (tile.url) {
      try { return { parent: "", name: new URL(tile.url).hostname }; }
      catch { return { parent: "", name: tile.url }; }
    }
    return { parent: "", name: "Browser" };
  }
  if (tile.type === "graph") {
    if (tile.folderPath) return splitFilepath(tile.folderPath);
    return { parent: "", name: "Graph" };
  }
  if (tile.type === "calendar") return { parent: "", name: "Calendar" };
  if (tile.filePath) return splitFilepath(tile.filePath);
  return { parent: "", name: tile.type };
}

export function splitFilepath(path) {
  const parts = path.split("/");
  const name = parts.pop() || path;
  const parent = parts.length > 0 ? parts.join("/") + "/" : "";
  return { parent, name };
}

export function updateTileTitle(dom, tile) {
  const label = getTileLabel(tile);
  const titleText = dom.titleText;
  titleText.textContent = "";
  const parentSpan = document.createElement("span");
  parentSpan.className = "tile-title-parent";
  parentSpan.textContent = label.parent;
  const nameSpan = document.createElement("span");
  nameSpan.className = "tile-title-name";
  nameSpan.textContent = label.name;
  titleText.appendChild(parentSpan);
  titleText.appendChild(nameSpan);
  titleText.title = tile.filePath || tile.folderPath || "";
}

/**
 * Positions a tile container in screen coordinates.
 * @param {HTMLElement} container
 * @param {import('./canvas-state.js').Tile} tile
 * @param {number} panX
 * @param {number} panY
 * @param {number} zoom
 */
export function positionTile(container, tile, panX, panY, zoom) {
  const sx = tile.x * zoom + panX;
  const sy = tile.y * zoom + panY;

  container.style.left = `${sx}px`;
  container.style.top = `${sy}px`;
  container.style.width = `${tile.width}px`;
  container.style.height = `${tile.height}px`;
  container.style.transform = `scale(${zoom})`;
  container.style.transformOrigin = "top left";
  container.style.zIndex = String(tile.zIndex);
}

/**
 * Positions all tile containers.
 * @param {Map<string, {container: HTMLElement}>} tileDOMs
 * @param {import('./canvas-state.js').Tile[]} tiles
 * @param {number} panX
 * @param {number} panY
 * @param {number} zoom
 */
export function positionAllTiles(tileDOMs, tiles, panX, panY, zoom) {
  for (const tile of tiles) {
    const dom = tileDOMs.get(tile.id);
    if (dom) positionTile(dom.container, tile, panX, panY, zoom);
  }
}
