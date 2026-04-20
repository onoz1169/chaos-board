---
title: Bundled tmux fallback and packaging gap
date: 2026-04-20
---

# tmux bundling

## Summary

Production builds of Chaos Board ship without a bundled `tmux` binary under
`Contents/Resources/`. As a result, the Electron main process fails to spawn
tmux (ENOENT), terminal tiles immediately render "Session ended", and no
interactive shell is available. The issue is silent on developer machines
because a system tmux is typically on `PATH`, so spawning still succeeds there.
It only surfaces on clean installs of the packaged `.app`.

## Root cause

Two independent gaps combine to produce the bug:

1. The `extraResources` block in `collab-electron/package.json` does not
   include the tmux binary. electron-builder therefore never copies a tmux
   executable into `Contents/Resources/` of the packaged app.
2. The `package` npm script references `scripts/package.sh`, but that script
   is not committed to this repository. Whoever produces a production build
   must currently copy a static `tmux` binary into `Resources/` by hand before
   electron-builder runs. That manual step is easy to forget and is not
   documented anywhere except this file.

## Runtime fallback

To prevent a hard failure when the bundled binary is missing, the main
process picks the tmux executable dynamically. See
`collab-electron/src/main/tmux.ts` (`getTmuxBin()`):

- Compute the expected bundled path under `process.resourcesPath`.
- If `fs.existsSync(bundledPath)` is true, return that absolute path.
- Otherwise return the string `"tmux"` so `spawn` resolves it against
  the user's `PATH`.

This keeps the app usable on any machine that already has tmux installed
system-wide (Homebrew, MacPorts, etc.), but it is a safety net, not a fix.

## What to fix properly

Both gaps must be closed:

1. Add the binary to `extraResources` in `collab-electron/package.json`:

   ```json
   "extraResources": [
     { "from": "resources/tmux", "to": "tmux" }
   ]
   ```

2. Commit `scripts/package.sh` (or an equivalent step in CI) that fetches
   or builds a static tmux binary, places it at `collab-electron/resources/tmux`,
   and chmods it executable before electron-builder runs. A reproducible
   source for the binary (version-pinned tarball URL or build recipe) should
   live next to the script.

Once both are in place, the runtime fallback in `tmux.ts` can remain as
defence in depth but should never trigger in a properly packaged build.

## Symptom checklist for debugging

Use this checklist to confirm the bug on a reported install:

1. Opening a terminal tile immediately shows "Session ended" with no prompt.
2. `ls "/Applications/Chaos Board.app/Contents/Resources/tmux"` returns
   "No such file or directory".
3. The Electron main process log records an `ENOENT` error on the tmux
   `spawn` call (visible via `Console.app` or when launching the binary
   directly from a terminal).

If all three match, the fix is to rebuild with `extraResources` updated and
a real tmux binary staged under `collab-electron/resources/`.
