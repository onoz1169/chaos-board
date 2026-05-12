import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { COLLAB_DIR } from "./paths";
import { atomicWriteFileSync } from "./files";

export interface TaskItem {
  id: string;
  title: string;
  done: boolean;
  doneAt?: string;
  due?: string;
  parent?: string;
  notes?: string;
}

export interface TaskList {
  id: string;
  title: string;
  tasks: TaskItem[];
}

export interface TasksData {
  version: 1;
  lists: TaskList[];
}

const TASKS_PATH = join(COLLAB_DIR, "tasks.json");

const DEFAULT_DATA: TasksData = {
  version: 1,
  lists: [{ id: "default", title: "タスク", tasks: [] }],
};

export function loadTasks(): TasksData {
  try {
    if (!existsSync(TASKS_PATH)) return structuredClone(DEFAULT_DATA);
    const raw = readFileSync(TASKS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as TasksData;
    if (!parsed.version || !Array.isArray(parsed.lists)) return structuredClone(DEFAULT_DATA);
    return parsed;
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
}

export function saveTasks(data: TasksData): void {
  mkdirSync(COLLAB_DIR, { recursive: true });
  atomicWriteFileSync(TASKS_PATH, JSON.stringify(data, null, 2));
}
