/**
 * Real process-liveness probe (spec-multi-session-concurrency-queryable-
 * ownership-checkout §Scope L0, AC-OWN-5) — leaf IO answering "what is
 * `pid`'s CURRENT observed process start time, if it exists at all". Shells
 * `ps -o lstart= -p <pid>` — chosen over `ps -o etime=`/`etimes=` because
 * elapsed-time output changes on every call (unusable as a stable identity:
 * `session-liveness.ts::deriveLivenessVerdict`'s pid-reuse defence needs an
 * UNCHANGING fact to compare against a LATER re-probe of the same pid).
 * `lstart` (BSD/macOS `ps` and Linux procps-ng `ps` both support it) instead
 * prints the process's actual start date/time, identical across repeated
 * queries for as long as that specific process lives.
 *
 * Public surface:
 *   - ProcessStartTimeProbe — the injectable port type (`SessionService`'s
 *     constructor DI — mirrors `real-git-port.ts::BranchMeasurement`'s
 *     "leaf IO behind an injectable port, real default implementation"
 *     precedent).
 *   - probeProcessStartTime(pid) — the real implementation.
 *
 * Invariants:
 *   - NEVER throws/rejects — an absent pid, a spawn-level fault (`ps` missing
 *     from PATH), or unparseable `ps` output all degrade uniformly to `null`
 *     ("this pid cannot be confirmed alive"), mirroring `detectWorktreeBranch`'s
 *     "every failure path collapses to one honest not-measured value"
 *     (`real-git-port.ts`).
 *   - A non-positive or non-integer `pid` is rejected BEFORE spawning `ps` —
 *     `ps -p 0` / a negative pid have platform-dependent meanings (process
 *     group, self) that would silently probe the WRONG thing.
 *
 * Side-effect class: IO (child_process subprocess).
 *
 * Source: spec-multi-session-concurrency-queryable-ownership-checkout §Scope L0, AC-OWN-5.
 */

import { spawn } from "node:child_process";

/** Injectable port: probes `pid`'s current OS-observed start time, or `null` when it cannot be confirmed alive. */
export type ProcessStartTimeProbe = (pid: number) => Promise<string | null>;

interface PsRunResult {
  exitCode: number;
  stdout: string;
}

// reason: `ps` reads the process table, never the directory it runs in; a fixed root keeps the child independent of
// the calling process's working directory (nothing below an entry reads the cwd, AS-26).
const PS_CWD = "/";

/** Runs `ps -o lstart= -p <pid>` and captures its exit code + stdout — NEVER rejects (mirrors `real-git-port.ts::runGit`). */
function runPs(pid: number): Promise<PsRunResult> {
  return new Promise((resolve) => {
    const child = spawn("ps", ["-o", "lstart=", "-p", String(pid)], { cwd: PS_CWD, stdio: ["ignore", "pipe", "ignore"] });

    let stdout = "";
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.once("error", () => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: -1, stdout: "" });
    });

    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: exitCode ?? -1, stdout });
    });
  });
}

/**
 * @param pid - Process id to probe.
 * @returns An ISO-8601 timestamp of `pid`'s process start time when it
 *   currently exists and `ps`'s output parses as a valid date; `null`
 *   otherwise (no such process, `ps` unavailable, or unparseable output).
 * @example
 * await probeProcessStartTime(1); // => e.g. "2026-07-16T15:57:00.000Z" (a long-lived pid)
 * @example
 * await probeProcessStartTime(999999); // => null (no such process, on most machines)
 */
export const probeProcessStartTime: ProcessStartTimeProbe = async (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return null;

  const { exitCode, stdout } = await runPs(pid);
  if (exitCode !== 0) return null;

  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};
