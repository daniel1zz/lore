// @spawns-external sh runs short shell scripts (a hung grandchild, an exit code) under the process-group runner
/**
 * Tests for run-process-group.ts (task-skill-implement-tg-24): a hung child is killed with its whole
 * process group and the timeout fails loud, so no test leaves a child behind.
 * Coverage: HAPPY (exit 0 / output) / NEGATIVE (non-zero exit) / BOUNDARY (daemonised grandchild
 * after a normal exit) / ERROR (timeout rejects, ENOENT rejects) / STATE (live-group registry drains) /
 * REGRESSION (control: `spawnSync`'s timeout leaves the grandchild alive, which is the 5-hour orphan).
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { ProcessGroupTimeoutError, killLiveProcessGroups, runProcessGroup } from "./run-process-group";

const ENV = { PATH: process.env["PATH"] ?? "" };

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Starts `sh -c 'sleep 300 & echo $!; wait'` and returns the grandchild (sleep) pid it printed. */
const GRANDCHILD_SCRIPT = "sleep 300 & echo $!; wait";

describe("runProcessGroup", () => {
  it("HAPPY: collects stdout and a zero exit code", async () => {
    const result = await runProcessGroup("/bin/sh", ["-c", "echo hello"], { cwd: "/tmp", env: ENV, timeoutMs: 10_000 });
    expect(result).toMatchObject({ stdout: "hello\n", exitCode: 0 });
  });

  it("NEGATIVE: reports a non-zero exit code and stderr", async () => {
    const result = await runProcessGroup("/bin/sh", ["-c", "echo oops >&2; exit 3"], { cwd: "/tmp", env: ENV, timeoutMs: 10_000 });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("oops");
  });

  it("ERROR: a hung child rejects with ProcessGroupTimeoutError AND its grandchild is dead", async () => {
    const caught: unknown = await runProcessGroup("/bin/sh", ["-c", GRANDCHILD_SCRIPT], {
      cwd: "/tmp",
      env: ENV,
      timeoutMs: 1_500,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(ProcessGroupTimeoutError);
    const grandchildPid = Number((caught as ProcessGroupTimeoutError).stdoutTail.trim());
    expect(grandchildPid).toBeGreaterThan(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(isAlive(grandchildPid)).toBe(false);
  });

  it("BOUNDARY: a grandchild left running after a NORMAL exit is killed too", async () => {
    const result = await runProcessGroup("/bin/sh", ["-c", "sleep 300 & echo $!"], { cwd: "/tmp", env: ENV, timeoutMs: 10_000 });
    const pid = Number(result.stdout.trim());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(isAlive(pid)).toBe(false);
  });

  it("ERROR: a missing executable rejects instead of resolving with a fake exit code", async () => {
    await expect(
      runProcessGroup("/nonexistent/binary", [], { cwd: "/tmp", env: ENV, timeoutMs: 5_000 }),
    ).rejects.toThrow(/ENOENT/);
  });

  it("STATE: killLiveProcessGroups is idempotent when nothing is live", () => {
    expect(() => {
      killLiveProcessGroups();
      killLiveProcessGroups();
    }).not.toThrow();
  });

  it("REGRESSION (control): spawnSync's own timeout leaves the grandchild alive — the orphan this helper exists to prevent", () => {
    const result = spawnSync("/bin/sh", ["-c", GRANDCHILD_SCRIPT], { encoding: "utf8", timeout: 1_000, env: ENV });
    const pid = Number(String(result.stdout).trim());
    try {
      expect(pid).toBeGreaterThan(1);
      expect(isAlive(pid)).toBe(true);
    } finally {
      if (pid > 1) process.kill(pid, "SIGKILL");
    }
  });
});
