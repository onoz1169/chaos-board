import { existsSync } from "node:fs";
import { writeFile, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COLLAB_DIR } from "./paths";
import type { CalendarEvent } from "./calendar-api";

const CALENDAR_CACHE_FILE = join(COLLAB_DIR, "calendar-cache.json");

export async function writeCalendarCache(
  events: CalendarEvent[],
  timeMin: string,
  timeMax: string,
): Promise<void> {
  if (!existsSync(COLLAB_DIR)) await mkdir(COLLAB_DIR, { recursive: true });
  const payload = { updated: new Date().toISOString(), timeMin, timeMax, events };
  const tmp = join(tmpdir(), `cal-cache-${Date.now()}.json`);
  await writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
  await rename(tmp, CALENDAR_CACHE_FILE);
}
