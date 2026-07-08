/**
 * Bun-only integration tests for verify-executor.ts's REAL Bun.spawn behavior —
 * SIGTERM-honored-immediately vs SIGTERM-ignored-then-SIGKILLed, and a genuine
 * Bun.spawn launch failure. These are the ONLY behaviors in this module that
 * require an actually-spawned process to observe (timing, signal delivery,
 * process-group kill) — everything else (spec building, pass/fail derivation)
 * is covered by the pure, vitest-run `verify-spawn.test.ts`.
 *
 * reason: this is the ONE intentionally slow (~5+ real seconds) test file in the
 * repo — mirrors the "reason:" comment convention already used in
 * `tests/integration/ai-timeout.bun.test.ts`. Do not proliferate real-spawn tests
 * elsewhere; the SIGKILL-escalation path can only be observed by actually waiting
 * out the fixed 5000ms killGraceMs (SPEC-039 §2 D6 — not configurable per-AC or
 * per-config, see verify-spawn.ts).
 *
 * Exit codes below were verified empirically against this exact Bun runtime
 * (Bun 1.3.10, macOS arm64) before being pinned as literals — not guessed:
 *   - SIGTERM → exitCode 143 (128 + SIGTERM's signal number 15)
 *   - SIGKILL → exitCode 137 (128 + SIGKILL's signal number 9)
 *
 * Six-dimension notes (deliberately NOT full six-dimension coverage — see
 * verify-spawn.test.ts for that; this file's sole purpose is pinning the two
 * REAL-process behaviors that can't be tested any other way):
 *   ERROR: launch failure (AC-VRF-6)
 *   STATE: SIGTERM-honored vs SIGTERM-ignored-then-SIGKILLed (AC-VRF-5)
 *
 * @spec_ref AC-VRF-5 AC-VRF-6
 */

import { describe, it, expect } from "bun:test";
import { executeVerifySpawnSpec } from "../../src/service/verify-executor.js";
import type { VerifySpawnSpec } from "../../src/service/verify-spawn.js";

describe("verify-executor — real spawn behavior (AC-VRF-5, AC-VRF-6)", () => {
  it("honors SIGTERM immediately (no grace-period wait) and reports a launch failure distinctly, in one combined fast test", async () => {
    // Part A (AC-VRF-5): `exec sleep 5` replaces the shell with `sleep` directly
    // (same PID), so SIGTERM is delivered straight to `sleep`, which has no trap
    // and terminates immediately — the 5000ms killGraceMs escalation is never
    // reached.
    const spec: VerifySpawnSpec = {
      cmd: ["sh", "-c", "exec sleep 5"],
      cwd: process.cwd(),
      timeoutMs: 200,
      killGraceMs: 5000,
    };
    const result = await executeVerifySpawnSpec(spec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.timedOut).toBe(true);
    // Empirically verified against this exact Bun runtime: SIGTERM reports exit
    // code 143 (128 + signal 15) — not a guess, and distinct from 0 or SIGKILL's 137.
    expect(result.value.exitCode).toBe(143);
    // Well under 1s beyond the 200ms timeout — proves SIGTERM alone killed it,
    // without ever needing the 5000ms grace-period escalation.
    expect(result.value.durationMs).toBeLessThan(2000);

    // Part B (AC-VRF-6): a nonexistent binary as cmd[0] directly (bypassing
    // `sh -c`, which would just make `sh` itself exit 127 normally — NOT a
    // launch failure) forces Bun.spawn itself to throw synchronously.
    const badSpec: VerifySpawnSpec = {
      cmd: ["this-binary-definitely-does-not-exist-xyz-123"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      killGraceMs: 5000,
    };
    const badResult = await executeVerifySpawnSpec(badSpec);
    expect(badResult.ok).toBe(false);
    if (badResult.ok) return;
    expect(badResult.error.code).toBe("STORE_ERROR");
    if (badResult.error.code !== "STORE_ERROR") return;
    expect(badResult.error.message).toContain("failed to launch");
  }, 10_000);

  it("escalates to SIGKILL after the full killGraceMs when the process ignores SIGTERM", async () => {
    // reason: the ONE intentionally slow test in the repo (~5+ real seconds) —
    // SPEC-039 §2 D6 fixes killGraceMs at 5000ms (not configurable), so pinning
    // the SIGTERM-ignored-then-SIGKILLed escalation path requires actually
    // waiting out that grace period in real time. `trap '' TERM` makes the
    // process ignore SIGTERM entirely; SIGKILL (sent killGraceMs later) cannot
    // be caught, blocked, or ignored on POSIX, so it is the only way this
    // process ever terminates before its natural 10s `sleep` completes.
    const spec: VerifySpawnSpec = {
      cmd: ["sh", "-c", "trap '' TERM; sleep 10"],
      cwd: process.cwd(),
      timeoutMs: 200,
      killGraceMs: 5000,
    };
    const result = await executeVerifySpawnSpec(spec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.timedOut).toBe(true);
    // Comfortably above the 200ms timeout + 5000ms grace period (proves the
    // full SIGTERM->SIGKILL escalation actually elapsed), but well under the
    // 10s natural `sleep` completion (proves SIGKILL — not natural exit —
    // ended it).
    expect(result.value.durationMs).toBeGreaterThan(5000);
    expect(result.value.durationMs).toBeLessThan(9000);
    // Empirically verified against this exact Bun runtime: SIGKILL reports
    // exit code 137 (128 + signal 9) — distinct from Test 1 Part A's SIGTERM
    // exit code (143), pinning that escalation actually reached SIGKILL rather
    // than merely repeating the SIGTERM outcome.
    expect(result.value.exitCode).toBe(137);
    expect(result.value.exitCode).not.toBe(143);
  }, 15_000);
});
