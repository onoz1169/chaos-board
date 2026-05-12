import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as crypto from "node:crypto";
import { COLLAB_DIR } from "./paths";

const STATE_DIR = COLLAB_DIR;
const STATE_FILE = join(STATE_DIR, "canvas-state.json");

interface TileState {
  id: string;
  type: "term" | "note" | "code" | "image" | "graph" | "browser";
  x: number;
  y: number;
  width: number;
  height: number;
  filePath?: string;
  folderPath?: string;
  url?: string | null;
  workspacePath?: string;
  ptySessionId?: string;
  zIndex: number;
}

interface CanvasState {
  version: 1;
  tiles: TileState[];
  viewport: {
    panX: number;
    panY: number;
    zoom: number;
  };
  zoneLabels?: Record<string, string>;
  zonePositions?: Record<string, { x: number; y: number }>;
}

export async function loadState(): Promise<CanvasState | null> {
  try {
    const raw = await readFile(STATE_FILE, "utf-8");
    const state = JSON.parse(raw) as CanvasState;
    if (state.version !== 1) return null;
    return state;
  } catch {
    return null;
  }
}

export async function saveState(state: CanvasState): Promise<void> {
  if (!existsSync(STATE_DIR)) {
    await mkdir(STATE_DIR, { recursive: true });
  }

  // Preserve scratchpad content and drawing independently
  const stateAny = state as Record<string, unknown>;
  const sp = stateAny.scratchpad as { content?: string; drawing?: string } | undefined;
  if (sp && existsSync(STATE_FILE)) {
    try {
      const existing = JSON.parse(await readFile(STATE_FILE, "utf-8"));
      if (!sp.content && existing.scratchpad?.content) {
        sp.content = existing.scratchpad.content;
      }
      if (!sp.drawing && existing.scratchpad?.drawing) {
        sp.drawing = existing.scratchpad.drawing;
      }
      // Detect blank PNG (transparent canvas toDataURL) — preserve existing drawing
      if (sp.drawing && existing.scratchpad?.drawing
          && sp.drawing.length < 1000 && existing.scratchpad.drawing.length > 1000) {
        sp.drawing = existing.scratchpad.drawing;
      }
      // Preserve kanban cards if new state has empty columns but existing has data
      const kanban = stateAny.kanban as { columns?: unknown[]; zoneColumns?: unknown[] | null } | undefined;
      if (kanban && existing.kanban) {
        const hasCards = (cols: unknown[] | null | undefined) =>
          Array.isArray(cols) && cols.some((c: any) => Array.isArray(c.cards) && c.cards.length > 0);
        if (!hasCards(kanban.columns) && hasCards(existing.kanban.columns)) {
          kanban.columns = existing.kanban.columns;
        }
        if (!hasCards(kanban.zoneColumns) && hasCards(existing.kanban.zoneColumns)) {
          kanban.zoneColumns = existing.kanban.zoneColumns;
        }
      }
    } catch { /* ignore read errors */ }
  }

  const tmp = join(
    tmpdir(),
    `canvas-state-${crypto.randomUUID()}.json`,
  );
  const json = JSON.stringify(state, null, 2);
  await writeFile(tmp, json, "utf-8");
  await rename(tmp, STATE_FILE);
}

export async function loadScratchpadContent(): Promise<string> {
  try {
    const raw = await readFile(STATE_FILE, "utf-8");
    const state = JSON.parse(raw) as Record<string, unknown>;
    const sp = state.scratchpad as { content?: string } | undefined;
    return sp?.content ?? "";
  } catch {
    return "";
  }
}

export async function saveScratchpadContent(content: string): Promise<void> {
  if (!existsSync(STATE_DIR)) {
    await mkdir(STATE_DIR, { recursive: true });
  }
  let state: Record<string, unknown> = {};
  if (existsSync(STATE_FILE)) {
    try {
      state = JSON.parse(await readFile(STATE_FILE, "utf-8"));
    } catch { /* start fresh */ }
  }
  const sp = (state.scratchpad ?? {}) as Record<string, unknown>;
  sp.content = content;
  state.scratchpad = sp;
  const tmp = join(tmpdir(), `canvas-state-${crypto.randomUUID()}.json`);
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
  await rename(tmp, STATE_FILE);
}
