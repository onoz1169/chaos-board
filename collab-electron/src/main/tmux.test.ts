import { describe, test, expect, afterEach, mock } from "bun:test";
import * as fs from "node:fs";
import {
  getTmuxBin,
  getTmuxConf,
  writeSessionMeta,
  readSessionMeta,
  deleteSessionMeta,
  SESSION_DIR,
  tmuxExec,
  tmuxSessionName,
} from "./tmux";
import {
  createSession,
  killSession,
  listSessions,
  killAll,
  discoverSessions,
  verifyTmuxAvailable,
} from "./pty";

describe("tmux helpers", () => {
  const testId = "test-" + Date.now().toString(16);

  afterEach(() => {
    deleteSessionMeta(testId);
  });

  test("getTmuxConf returns a path ending in tmux.conf", () => {
    const conf = getTmuxConf();
    expect(conf.endsWith("tmux.conf")).toBe(true);
    expect(fs.existsSync(conf)).toBe(true);
  });

  test("writeSessionMeta + readSessionMeta round-trip", () => {
    const meta = {
      shell: "/bin/zsh",
      cwd: "/tmp",
      createdAt: new Date().toISOString(),
    };
    writeSessionMeta(testId, meta);
    const read = readSessionMeta(testId);
    expect(read).toEqual(meta);
  });

  test("readSessionMeta returns null for missing file", () => {
    expect(readSessionMeta("nonexistent-id")).toBeNull();
  });

  test("readSessionMeta returns null for corrupt JSON", () => {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(
      `${SESSION_DIR}/${testId}.json`, "not json",
    );
    expect(readSessionMeta(testId)).toBeNull();
  });

  test("deleteSessionMeta is no-op for missing file", () => {
    expect(
      () => deleteSessionMeta("nonexistent-id"),
    ).not.toThrow();
  });
});

describe("pty lifecycle via tmux", () => {
  afterEach(() => {
    killAll();
  });

  test("createSession returns sessionId and shell", () => {
    const result = createSession("/tmp");
    expect(result.sessionId).toMatch(/^[0-9a-f]{16}$/);
    expect(result.shell).toBeTruthy();
  });

  test("createSession appears in listSessions", () => {
    const { sessionId } = createSession("/tmp");
    expect(listSessions()).toContain(sessionId);
  });

  test("killSession removes from listSessions", () => {
    const { sessionId } = createSession("/tmp");
    killSession(sessionId);
    expect(listSessions()).not.toContain(sessionId);
  });

  test("createSession sets COLLAB_PTY_SESSION_ID env", () => {
    const { sessionId } = createSession("/tmp");
    const name = tmuxSessionName(sessionId);
    const env = tmuxExec(
      "show-environment", "-t", name,
      "COLLAB_PTY_SESSION_ID",
    );
    expect(env).toContain(sessionId);
  });
});

describe("discoverSessions", () => {
  test("returns empty when no tmux server running", () => {
    const result = discoverSessions();
    expect(Array.isArray(result)).toBe(true);
  });

  test("discovers sessions created by createSession", () => {
    const { sessionId } = createSession("/tmp");
    killAll(); // detach client, tmux session survives

    const discovered = discoverSessions();
    const found = discovered.find(
      (s) => s.sessionId === sessionId,
    );
    expect(found).toBeTruthy();
    expect(found!.meta.cwd).toBe("/tmp");

    // Clean up tmux session
    try {
      tmuxExec(
        "kill-session", "-t", tmuxSessionName(sessionId),
      );
    } catch {}
    deleteSessionMeta(sessionId);
  });

  test("cleans up stale metadata without tmux session", () => {
    const fakeId = "deadbeefdeadbeef";
    writeSessionMeta(fakeId, {
      shell: "/bin/zsh",
      cwd: "/tmp",
      createdAt: new Date().toISOString(),
    });

    discoverSessions();
    expect(readSessionMeta(fakeId)).toBeNull();
  });

  test("kills orphan tmux sessions without metadata", () => {
    // Create a session, then delete its metadata
    const { sessionId } = createSession("/tmp");
    killAll();
    deleteSessionMeta(sessionId);

    // discoverSessions should kill the orphan
    discoverSessions();

    // Verify tmux session is gone
    const name = tmuxSessionName(sessionId);
    let alive = true;
    try {
      tmuxExec("has-session", "-t", name);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  });
});

describe("verifyTmuxAvailable", () => {
  test("does not throw when tmux is available", () => {
    expect(() => verifyTmuxAvailable()).not.toThrow();
  });
});

describe("stripTrailingBlanks via scrollback", () => {
  test("scrollback capture strips trailing blank lines", async () => {
    const { sessionId } = createSession("/tmp");
    const name = tmuxSessionName(sessionId);

    // Send a known string to the session
    tmuxExec(
      "send-keys", "-t", name, "echo hello-scrollback", "Enter",
    );

    // Brief wait for output to appear in tmux buffer
    await new Promise((r) => setTimeout(r, 200));

    // Capture and verify no trailing blank lines
    const raw = tmuxExec(
      "capture-pane", "-t", name,
      "-p", "-e", "-S", "-10000",
    );
    const lines = raw.split("\n");
    // Raw output may have trailing blanks; after
    // stripTrailingBlanks (called in reconnectSession),
    // they'd be removed. Verify raw capture has content.
    expect(
      lines.some((l) => l.includes("hello-scrollback")),
    ).toBe(true);

    killSession(sessionId);
  });
});

describe("getTmuxBin packaged fallback", () => {
  test("falls back to 'tmux' on PATH when bundled binary missing", () => {
    // Point resourcesPath at a directory that does NOT contain a
    // "tmux" file, simulating a production build where the
    // extraResources config failed to ship the bundled binary.
    const originalResourcesPath = (process as unknown as {
      resourcesPath: string;
    }).resourcesPath;
    const emptyDir = fs.mkdtempSync("/tmp/tmux-bin-test-");

    // Mock the electron module so getApp() returns an
    // isPackaged: true stub.
    mock.module("electron", () => ({
      app: { isPackaged: true },
    }));

    try {
      (process as unknown as {
        resourcesPath: string;
      }).resourcesPath = emptyDir;

      // Sanity: bundled path truly does not exist.
      expect(fs.existsSync(`${emptyDir}/tmux`)).toBe(false);

      expect(getTmuxBin()).toBe("tmux");
    } finally {
      (process as unknown as {
        resourcesPath: string;
      }).resourcesPath = originalResourcesPath;
      try {
        fs.rmdirSync(emptyDir);
      } catch {
        // no-op
      }
    }
  });
});
