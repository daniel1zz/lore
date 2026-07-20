/**
 * Trusted-runner spawn executor (SPEC-039 §2 D6) — bun-only, NOT vitest-reachable.
 *
 * reason: This module calls `Bun.spawn` and `process.kill` directly, mirroring why
 * `adapters/cli/loader.ts` is kept separate from `utils.ts` (loader.ts imports
 * `bun:sqlite` transitively via app.ts and is only ever loaded by the compiled CLI
 * binary, never by vitest). `verify-spawn.ts` carries every PURE piece of this
 * feature (spec building, result derivation) precisely so vitest can cover that
 * logic without ever importing this file. Only `app.ts` (bun-only composition root)
 * and this repo's `.bun.test.ts` integration suite import this module directly.
 *
 * Public surface:
 *   - executeVerifySpawnSpec(spec) — runs one VerifySpawnSpec to completion
 *   - VerifyExecutionResult — {exitCode, outputTail, durationMs, timedOut}
 *
 * Invariants:
 *   - Detached process group (SPEC-039 §2 D6, ⚠ NEW behavior — no existing precedent
 *     in this codebase): `Bun.spawn(..., { detached: true })` calls POSIX `setsid()`,
 *     making the spawned `sh` the leader of its OWN new process group (pgid === pid).
 *     `../ai/claude-cli-provider.ts`'s watchdog sends a single `proc.kill("SIGTERM")`
 *     to the direct child ONLY — adequate for the `claude` CLI binary, which does not
 *     fork descendants. A `verify.script.command` is an arbitrary shell one-liner
 *     (npm-script trust tier, SPEC-039 §1) that MAY fork children (`npm test` →
 *     jest/vitest worker processes, `make` → sub-make, etc.); killing only the
 *     top-level `sh` would leave those orphaned and still running/holding resources.
 *     `process.kill(-pid, signal)` (negative pid = process GROUP) reaches the whole
 *     tree in one call — verified empirically against Bun 1.3.10 during this task's
 *     implementation (spawn with `detached: true`, then `process.kill(-proc.pid, ...)`
 *     successfully terminated a `sleep` grandchild).
 *   - Timeout escalation: on `spec.timeoutMs` elapsed with the process still running,
 *     SIGTERM is sent to the group; if the process is STILL alive `spec.killGraceMs`
 *     (always 5000 per verify-spawn.ts) later, SIGKILL is sent to the group. SIGKILL
 *     cannot be caught, blocked, or ignored on POSIX, so this is a hard upper bound on
 *     how long a hung/TERM-trapping verify command can occupy the runner (SPEC-039 §3).
 *   - Both kill attempts are wrapped in try/catch and swallow errors silently by
 *     design: if the process already exited naturally between the timer firing and
 *     the kill call running, `process.kill(-pid, ...)` throws ESRCH (no such process
 *     group) — this is an expected race (the process's own exit vs. our scheduled
 *     kill), not a failure condition worth surfacing.
 *   - Launch failure (binary/shell missing, permission denied) is caught around
 *     `Bun.spawn` itself and mapped to `err({code: "STORE_ERROR", ...})` — DISTINCT
 *     from a non-zero exit (which is normal `VerifyExecutionResult` data, not an
 *     error — SPEC-039 §3 "非零 exit → evidence result=fail... fail 是数据,不是错误").
 *     `STORE_ERROR` is this codebase's general infra-failure code (see
 *     `migration-service.ts`'s "cannot read source directory" precedent) — no
 *     SPEC-039-specific LoreError variant exists (core is out of this task's scope).
 *   - `outputTail` is stdout+stderr CONCATENATED then tail-truncated to the last 4000
 *     chars (matches `evidenceEntrySchema.output_tail`'s cap) via `@lore/core`'s
 *     code-point-safe `tailChars` (BUG-001 fix, `packages/core/src/truncate.ts`) — the
 *     SAME helper `adapters/cli/commands/evidence.ts` and `commands/handoff.ts` use,
 *     never a locally re-implemented copy.
 *   - Never throws. Every path returns `Result<VerifyExecutionResult, LoreError>`.
 *   - `spec.env` (SPEC-039 §M2, when present) REPLACES the spawned process's
 *     environment entirely — `Bun.spawn({ env })` does not merge with `process.env`.
 *     Absent `spec.env` inherits the full parent env (pre-M2-hardening behavior /
 *     `verify.env.passthrough_all: true`).
 *
 * Side-effect class: IO (Bun.spawn, process.kill, stdin/stdout/stderr pipes)
 *
 * Source: SPEC-039 §2 D6; §3; §4 AC-VRF-5, AC-VRF-6; §M2 (env allowlist)
 */

import { err, ok, tailChars } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import type { VerifySpawnSpec, VerifyExecutionResult } from "./verify-spawn.js";

export type { VerifyExecutionResult } from "./verify-spawn.js";

/** Truncate to the last N chars — keeps the most recent (most relevant) output. */
const OUTPUT_TAIL_MAX_CHARS = 4000;

/**
 * Best-effort signal to the WHOLE process group led by `pid` (SPEC-039 §2 D6).
 * Swallows ESRCH (group already gone — the process beat our timer to its own exit).
 */
function killGroupSafely(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // reason: expected race — the process (and its group) may have already exited
    // naturally between the timer firing and this call running. Not an error.
  }
}

/**
 * Run one verify spawn spec to completion: spawn detached, capture merged
 * stdout+stderr, enforce `timeoutMs` via a SIGTERM→(killGraceMs)→SIGKILL escalation
 * to the whole process group, and report exit code / duration / timeout flag.
 *
 * @param spec - Spawn parameters from `buildVerifySpawnSpec` (verify-spawn.ts)
 * @returns `ok(VerifyExecutionResult)` for any completed run (pass, fail, or
 *   timed-out — all are DATA, not errors); `err({code: "STORE_ERROR"})` only when
 *   the process failed to LAUNCH at all (ENOENT/EACCES) — no evidence should ever be
 *   recorded for that case (AC-VRF-6)
 */
export async function executeVerifySpawnSpec(
  spec: VerifySpawnSpec,
): Promise<Result<VerifyExecutionResult, LoreError>> {
  const t0 = performance.now();

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([...spec.cmd], {
      cwd: spec.cwd,
      // SPEC-039 §2 D6 — new process group so a timeout kill reaches forked
      // descendants too (see module header for the full rationale).
      detached: true,
      stdout: "pipe",
      stderr: "pipe",
      // reason: SPEC-039 §M2 env-allowlist hardening — `spec.env` (when present) is
      // an already-filtered map (`resolveVerifyEnv`, verify-spawn.ts) that REPLACES
      // (never merges with) the child's environment; Bun.spawn does NOT inherit
      // process.env when `env` is explicitly passed (verified empirically against
      // Bun 1.3.10 — an unlisted var reads back empty in the child). `spec.env`
      // absent (undefined) means "inherit the full parent env" — the pre-hardening
      // behavior, reached via `verify.env.passthrough_all: true` or a hand-built
      // VerifySpawnSpec that omits the field entirely (e.g. this file's own
      // .bun.test.ts fixtures).
      ...(spec.env !== undefined ? { env: spec.env } : {}),
    });
  } catch (e) {
    return err({
      code: "STORE_ERROR",
      message: `verify command failed to launch: ${e instanceof Error ? e.message : String(e)}`,
      ...(e instanceof Error ? { cause: e } : {}),
    });
  }

  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const termTimer = setTimeout(() => {
    timedOut = true;
    killGroupSafely(proc.pid, "SIGTERM");
    // SPEC-039 §2 D6 escalation — if the process traps/ignores SIGTERM and is still
    // alive killGraceMs later, force-kill the whole group. SIGKILL cannot be caught.
    killTimer = setTimeout(() => {
      killGroupSafely(proc.pid, "SIGKILL");
    }, spec.killGraceMs);
  }, spec.timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ]);
  clearTimeout(termTimer);
  if (killTimer !== undefined) clearTimeout(killTimer);

  const durationMs = Math.round(performance.now() - t0);
  const outputTail = tailChars(stdout + stderr, OUTPUT_TAIL_MAX_CHARS);

  return ok({ exitCode, outputTail, durationMs, timedOut });
}
