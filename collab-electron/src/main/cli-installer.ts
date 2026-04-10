import { app } from "electron";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const INSTALL_DIR = join(homedir(), ".local", "bin");
const INSTALL_PATH = join(INSTALL_DIR, "collab");
const COLLAB_DIR = join(homedir(), ".chaos-board");
const HINT_MARKER = join(COLLAB_DIR, "cli-path-hinted");

function getCliSource(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "collab-cli.sh");
  }
  return join(app.getAppPath(), "scripts", "collab-cli.sh");
}

export function installCli(): void {
  const source = getCliSource();
  if (!existsSync(source)) {
    console.warn(
      "[cli-installer] CLI source not found:", source,
    );
    return;
  }

  mkdirSync(INSTALL_DIR, { recursive: true });
  copyFileSync(source, INSTALL_PATH);
  chmodSync(INSTALL_PATH, 0o755);

  if (!existsSync(HINT_MARKER)) {
    const pathEnv = process.env["PATH"] ?? "";
    if (!pathEnv.split(":").includes(INSTALL_DIR)) {
      console.log(
        `[cli-installer] collab installed to ${INSTALL_PATH}. ` +
        `Add ~/.local/bin to your PATH to use it from any terminal:\n` +
        `  export PATH="$HOME/.local/bin:$PATH"`,
      );
      mkdirSync(COLLAB_DIR, { recursive: true });
      writeFileSync(HINT_MARKER, "", "utf-8");
    }
  }
}
