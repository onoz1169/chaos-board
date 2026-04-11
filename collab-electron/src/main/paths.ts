import { join } from "node:path";
import { homedir } from "node:os";

const BASE = join(homedir(), ".chaos-board");

export const COLLAB_DIR = BASE;
