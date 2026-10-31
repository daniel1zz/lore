// @spawns-external sleep a long-running child whose working directory the process scan must find
/**
 * @spec_ref spec-one-worktree-removal-test-for-the-guard-lore-done-and-a (D1: the process scan lives once, in lore)
 * @task task-single-worktree-removal-test-used-by-the-hook-lore-done
 *
 * The real process-scan port (moved out of the git-safety hook). HAPPY: a real child whose cwd is inside is found (lsof
 * path); NEGATIVE: a sibling directory sharing the worktree's name prefix does not count; ERROR: neither lsof nor a
 * readable /proc dir -> {ok:false}, never "nobody inside"; STATE: the caller's own pid/ancestry never counts (/proc path).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRealProcessScanPort } from "../../../src/adapters/real-process-scan-port.js";

let base = "";
let inside = "";
let sibling = "";

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "lore-procscan-")));
  inside = join(base, "wt");
  sibling = join(base, "wt-sibling");
  mkdirSync(inside);
  mkdirSync(sibling);
});

afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true });
});

/** Runs `fn` with PATH pointing at an empty directory, so `lsof` is ENOENT and the /proc fallback is exercised. */
function withoutLsof<T>(fn: () => T): T {
  const saved = process.env["PATH"];
  const empty = mkdtempSync(join(base, "emptybin-"));
  process.env["PATH"] = empty;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env["PATH"];
    else process.env["PATH"] = saved;
  }
}

describe("createRealProcessScanPort", () => {
  it("HAPPY: a real child process with its cwd inside the worktree is found, naming its command", () => {
    const child = spawn("sleep", ["30"], { cwd: inside, stdio: "ignore" });
    try {
      const result = createRealProcessScanPort({ cwd: process.cwd() }).processesInside([inside]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const hit = result.value.find((proc) => proc.pid === child.pid);
      expect(hit?.command).toContain("sleep");
    } finally {
      child.kill();
    }
  });

  it("NEGATIVE: a process in a sibling directory sharing the name prefix does not count", () => {
    const child = spawn("sleep", ["30"], { cwd: sibling, stdio: "ignore" });
    try {
      const result = createRealProcessScanPort({ cwd: process.cwd() }).processesInside([inside]);
      expect(result.ok && result.value.some((proc) => proc.pid === child.pid)).toBe(false);
    } finally {
      child.kill();
    }
  });

  it("STATE: /proc fallback finds a foreign cwd link inside, but never the caller's own pid", () => {
    const proc = join(base, "fake-proc");
    mkdirSync(join(proc, "9001"), { recursive: true });
    symlinkSync(inside, join(proc, "9001", "cwd"));
    mkdirSync(join(proc, String(process.pid)), { recursive: true });
    symlinkSync(inside, join(proc, String(process.pid), "cwd"));
    const result = withoutLsof(() => createRealProcessScanPort({ procDir: proc, cwd: process.cwd() }).processesInside([inside]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((p) => p.pid)).toEqual([9001]);
  });

  it("ERROR: no lsof and an unreadable /proc dir is not measurable, never `nobody inside`", () => {
    const result = withoutLsof(() => createRealProcessScanPort({ procDir: join(base, "no-such-proc"), cwd: process.cwd() }).processesInside([inside]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not readable");
  });

  it("BOUNDARY: an empty /proc yields an empty, measured list", () => {
    const empty = join(base, "empty-proc");
    mkdirSync(empty);
    const result = withoutLsof(() => createRealProcessScanPort({ procDir: empty, cwd: process.cwd() }).processesInside([inside]));
    expect(result).toEqual({ ok: true, value: [] });
  });
});
