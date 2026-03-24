import { computeGroupBounds, getBorderColor } from "./group-state.js";

/** @type {HTMLDivElement | null} */
let layerEl = null;

/** @type {Map<string, {el: HTMLDivElement, labelEl: HTMLElement}>} */
const groupDOMs = new Map();

/**
 * Create (or locate) the group-layer container.
 * @param {HTMLElement} _canvasEl - #panel-viewer element
 */
export function initGroupLayer(_canvasEl) {
	layerEl = document.getElementById("group-layer");
}

/**
 * Render / update group boundary rectangles.
 * @param {import('./group-state.js').TileGroup[]} groups
 * @param {import('./canvas-state.js').Tile[]} tilesArr
 * @param {number} panX
 * @param {number} panY
 * @param {number} zoom
 */
export function renderGroups(groups, tilesArr, panX, panY, zoom) {
	if (!layerEl) return;

	const activeIds = new Set();

	for (const group of groups) {
		activeIds.add(group.id);
		const bounds = computeGroupBounds(group, tilesArr);
		if (!bounds) {
			// No visible tiles — hide DOM if it exists
			const existing = groupDOMs.get(group.id);
			if (existing) existing.el.style.display = "none";
			continue;
		}

		let entry = groupDOMs.get(group.id);
		if (!entry) {
			const el = document.createElement("div");
			el.className = "tile-group-boundary";
			el.dataset.groupId = group.id;

			const label = document.createElement("div");
			label.className = "tile-group-label";
			label.contentEditable = "true";
			label.spellcheck = false;
			label.textContent = group.label;
			label.addEventListener("mousedown", (e) => e.stopPropagation());
			label.addEventListener("input", () => {
				group.label = label.textContent || "Group";
			});
			label.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					label.blur();
				}
			});
			el.appendChild(label);

			const ungroupBtn = document.createElement("button");
			ungroupBtn.className = "tile-group-ungroup-btn";
			ungroupBtn.innerHTML = "\u00d7";
			ungroupBtn.title = "Ungroup tiles";
			ungroupBtn.addEventListener("mousedown", (e) => e.stopPropagation());
			ungroupBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				el.dispatchEvent(new CustomEvent("group-ungroup", {
					bubbles: true,
					detail: { groupId: group.id },
				}));
			});
			el.appendChild(ungroupBtn);

			layerEl.appendChild(el);
			entry = { el, labelEl: label };
			groupDOMs.set(group.id, entry);
		}

		// Update label text if changed externally
		const labelEl = entry.labelEl;
		if (labelEl !== document.activeElement && labelEl.textContent !== group.label) {
			labelEl.textContent = group.label;
		}

		const borderColor = getBorderColor(group.color);
		const el = entry.el;

		el.style.display = "";
		el.style.left = `${bounds.x * zoom + panX}px`;
		el.style.top = `${bounds.y * zoom + panY}px`;
		el.style.width = `${bounds.width * zoom}px`;
		el.style.height = `${bounds.height * zoom}px`;
		el.style.background = group.color;
		el.style.borderColor = borderColor;
	}

	// Remove DOMs for groups that no longer exist
	for (const [id, entry] of groupDOMs) {
		if (!activeIds.has(id)) {
			entry.el.remove();
			groupDOMs.delete(id);
		}
	}
}

export function cleanupGroupLayer() {
	for (const [, entry] of groupDOMs) {
		entry.el.remove();
	}
	groupDOMs.clear();
}
