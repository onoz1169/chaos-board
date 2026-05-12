import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as crypto from "node:crypto";
import { COLLAB_DIR } from "./paths";

const MEMOS_FILE = join(COLLAB_DIR, "memos.json");

export interface Memo {
  id: string;
  name: string;
  content: string;
}

export interface MemosData {
  version: 1;
  memos: Memo[];
  activeId: string;
}

function makeId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function defaultData(): MemosData {
  const id = makeId();
  return { version: 1, memos: [{ id, name: "メモ", content: "" }], activeId: id };
}

export async function loadMemos(): Promise<MemosData> {
  try {
    const raw = await readFile(MEMOS_FILE, "utf-8");
    const data = JSON.parse(raw) as MemosData;
    if (data.version !== 1 || !Array.isArray(data.memos) || data.memos.length === 0) {
      return defaultData();
    }
    return data;
  } catch {
    return defaultData();
  }
}

export async function saveMemos(data: MemosData): Promise<void> {
  if (!existsSync(COLLAB_DIR)) {
    await mkdir(COLLAB_DIR, { recursive: true });
  }
  const tmp = join(tmpdir(), `memos-${makeId()}.json`);
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmp, MEMOS_FILE);
}
