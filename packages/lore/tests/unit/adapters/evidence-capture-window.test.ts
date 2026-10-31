/**
 * Tests for `captureOracleCommand`'s capture WINDOW — the configurable timeout and
 * the loud, distinguishable timeout outcome.
 *
 * Defect (task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a): the
 * window was the module constant `CAPTURE_TIMEOUT_MS = 10 * 60 * 1000`, documented
 * as "Deliberately NOT caller-configurable". A legitimately-scoped oracle — this
 * repo's OWN mandated worktree oracle `bun run test:changed <base>`, measured at
 * ~624s on a `@lore/core` edit selecting 482 files — therefore could not be
 * captured AT ALL, and the only honest fallback (`--output-tail-file` with the real
 * log) records `capture_source: "self-report"`, which `lore done` refuses (its attestation
 * floor has no escape). The disciplined path terminated in the degraded record.
 *
 * ⛔ NOT a timeout-tuning fix. Raising 600 to 1200 moves the cliff; the roots are
 * (a) the window is now owned by config (`workflow.evidence.capture_timeout_ms`,
 * `@lore/core`'s `LoreConfigSchema` — the ONLY place the 600s number exists), and
 * (b) a timeout is now MEASURED and reported as its own outcome rather than
 * inferred and hedged.
 *
 * ⛔ The measurement that reshaped (b) — three probes of Node's own `spawnSync`
 * (macOS, node 24) with `shell: true` and a 300ms timeout:
 *
 *     `sleep 5`                            → status null, signal SIGTERM, error.code ETIMEDOUT
 *     `trap 'exit 0' TERM; sleep 5 & wait` → status 0,    signal null,    error.code ETIMEDOUT
 *     `trap 'exit 3' TERM; sleep 5 & wait` → status 3,    signal null,    error.code ETIMEDOUT
 *
 * Two consequences the pre-fix code got wrong. FIRST: `error` is ALWAYS set on a
 * timeout, so the pre-fix `spawnResult.error !== undefined` branch fired first and
 * rendered every timeout as `--capture failed to spawn --command: spawnSync
 * /bin/sh ETIMEDOUT` — a SPAWN FAILURE ("your command is malformed / the binary is
 * missing"), naming neither the window, nor the elapsed time, nor any repair. The
 * carefully-worded `"possibly the 600s capture timeout"` string on the
 * `status === null` branch was therefore UNREACHABLE for a real timeout — the
 * governing task's item 2 ("the word possibly is the defect") understates it: the
 * hedged message was dead code and the message operators actually saw told them the
 * wrong causal story. SECOND: a timed-out child can exit with status 0 or 3 (rows 2
 * and 3), so `status === null` is not a sound timeout predicate on its own.
 *
 * Hence `timedOut` keys on TWO INDEPENDENT conditions (this repo's standing
 * contiguous-substring / lone-signal lesson): `error.code === "ETIMEDOUT"` OR
 * monotonic `elapsedMs >= timeoutMs`. Row 3 is what the elapsed conjunct exists
 * for — it holds even if a platform stops setting ETIMEDOUT.
 *
 * Six-dimension coverage:
 *   HAPPY      — a command inside the window still returns a runner-labelled tail,
 *                and now also reports `elapsedMs` (margin observability)
 *   NEGATIVE   — the timeout refusal contains NO hedging word and is NOT worded as
 *                a spawn failure; a timed-out capture never returns `ok: true`
 *   BOUNDARY   — both directions of the knob on the SAME command: a tiny window
 *                refuses, a generous window lets it through (an inert knob verified
 *                in one direction only is indistinguishable from a working one —
 *                knowledge-retro-a-silently-inert-cli-flag-is-the-fifth-false);
 *                `output_tail` truncation still lands exactly at 4000
 *   ERROR      — a genuinely unspawnable command still reports as a spawn failure,
 *                NOT as a timeout (the two outcomes must not collapse)
 *   STATE      — a timed-out child that exits 0 (trap row 2) is STILL a timeout and
 *                never a successful capture, even though its status matches a
 *                declared `pass`
 *   REGRESSION — a nonzero exit INSIDE the window is still the exit-code-mismatch
 *                refusal / a genuine `fail` capture, never relabelled as a timeout
 *
 * @spec_ref task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a
 */

import { describe, it, expect } from "vitest";
import {
  captureOracleCommand,
  CAPTURE_TAIL_CHARS,
  DEFAULT_CAPTURE_TIMEOUT_MS,
} from "../../../src/adapters/evidence-capture.js";
import * as precheck from "../../../src/adapters/cli/evidence-precheck.js";

/** Hedging vocabulary the timeout message must never contain (governing task item 2). */
const HEDGE_WORDS = ["possibly", "maybe", "perhaps", "probably", "might be"];

function messageOf(outcome: ReturnType<typeof captureOracleCommand>): string {
  if (outcome.ok) throw new Error("expected a refusal, got a successful capture");
  const error = outcome.error;
  if (!("message" in error)) throw new Error(`error has no message: ${JSON.stringify(error)}`);
  return error.message;
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("captureOracleCommand window — HAPPY", () => {
  it("CAPWIN-H1: a command well inside an explicit window still captures with capture_source runner", () => {
    const outcome = captureOracleCommand({
      command: "echo inside-the-window",
      cwd: process.cwd(),
      declaredResult: "pass",
      timeoutMs: 30_000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.provenance.capture_source).toBe("runner");
    expect(outcome.value.observedExitCode).toBe(0);
    expect(outcome.value.outputTail).toContain("inside-the-window");
  });

  it("CAPWIN-H2: a successful capture reports elapsedMs, making the margin to the window observable on EVERY capture", () => {
    const outcome = captureOracleCommand({
      command: "echo margin",
      cwd: process.cwd(),
      declaredResult: "pass",
      timeoutMs: 30_000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(typeof outcome.value.elapsedMs).toBe("number");
    expect(outcome.value.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(outcome.value.elapsedMs).toBeLessThan(30_000);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("captureOracleCommand window — NEGATIVE", () => {
  it("CAPWIN-N1: exceeding the window refuses — never a successful capture, so the caller records NOTHING", () => {
    const outcome = captureOracleCommand({
      command: "sleep 5",
      cwd: process.cwd(),
      declaredResult: "pass",
      timeoutMs: 300,
    });

    expect(outcome.ok).toBe(false);
  });

  it("CAPWIN-N2: the timeout message carries NO hedging word — the runner knows it timed out and says so", () => {
    const message = messageOf(
      captureOracleCommand({
        command: "sleep 5",
        cwd: process.cwd(),
        declaredResult: "pass",
        timeoutMs: 300,
      }),
    );

    for (const hedge of HEDGE_WORDS) {
      expect(message.toLowerCase()).not.toContain(hedge);
    }
  });

  it("CAPWIN-N3: the timeout message is NOT worded as a spawn failure — the pre-fix message said 'failed to spawn' for every timeout", () => {
    const message = messageOf(
      captureOracleCommand({
        command: "sleep 5",
        cwd: process.cwd(),
        declaredResult: "pass",
        timeoutMs: 300,
      }),
    );

    expect(message).not.toContain("failed to spawn");
    // …and it IS identifiable as a timeout, on a lone token (not a remembered phrase)
    expect(message.toLowerCase()).toContain("timed out");
  });

  it("CAPWIN-N4: the timeout message states BOTH the configured window and the observed elapsed time, plus the config knob to raise it", () => {
    const outcome = captureOracleCommand({
      command: "sleep 5",
      cwd: process.cwd(),
      declaredResult: "pass",
      timeoutMs: 300,
    });
    const message = messageOf(outcome);

    // the configured window, as a number the operator set
    expect(message).toContain("300");
    // the knob, named exactly, so the repair needs no doc lookup
    expect(message).toContain("workflow.evidence.capture_timeout_ms");
    // an elapsed measurement is present as a millisecond figure
    expect(message).toMatch(/\d+ms/);
  });

  it("CAPWIN-N5: the timeout refusal is field-tagged 'capture' with VALIDATION_ERROR, so the CLI maps it to the same exit 4 as every other capture refusal", () => {
    const outcome = captureOracleCommand({
      command: "sleep 5",
      cwd: process.cwd(),
      declaredResult: "pass",
      timeoutMs: 300,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("VALIDATION_ERROR");
    expect("field" in outcome.error ? outcome.error.field : undefined).toBe("capture");
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("captureOracleCommand window — BOUNDARY", () => {
  it("CAPWIN-B1: BOTH directions of the window on the SAME command — 300ms refuses, 30s captures (proves the knob is not inert, and not stuck-refusing)", () => {
    const tooSmall = captureOracleCommand({
      command: "sleep 1",
      cwd: process.cwd(),
      declaredResult: "pass",
      timeoutMs: 300,
    });
    const generous = captureOracleCommand({
      command: "sleep 1",
      cwd: process.cwd(),
      declaredResult: "pass",
      timeoutMs: 30_000,
    });

    expect(tooSmall.ok).toBe(false);
    expect(generous.ok).toBe(true);
    if (generous.ok) expect(generous.value.provenance.capture_source).toBe("runner");
  });

  it("CAPWIN-B2: DEFAULT_CAPTURE_TIMEOUT_MS is 1200000 (raised 2026-08-11 — see config.ts evidence.capture_timeout_ms JSDoc) — an omitted timeoutMs preserves the configured window exactly", () => {
    expect(DEFAULT_CAPTURE_TIMEOUT_MS).toBe(1_200_000);

    const outcome = captureOracleCommand({
      command: "echo default-window",
      cwd: process.cwd(),
      declaredResult: "pass",
    });
    expect(outcome.ok).toBe(true);
  });

  it("CAPWIN-B3: output_tail truncation still lands at exactly 4000 chars under an explicit window (CONTROL — unchanged by this fix)", () => {
    const outcome = captureOracleCommand({
      // 5000 'x' chars — comfortably over the 4000 ceiling
      command: `printf 'x%.0s' $(seq 1 5000)`,
      cwd: process.cwd(),
      declaredResult: "pass",
      timeoutMs: 30_000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outputTail.length).toBe(CAPTURE_TAIL_CHARS);
    expect(CAPTURE_TAIL_CHARS).toBe(4000);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("captureOracleCommand window — ERROR", () => {
  it("CAPWIN-E1: a nonexistent command inside the window is a shell exit-code outcome, NOT a timeout (the two outcomes never collapse)", () => {
    const outcome = captureOracleCommand({
      command: "this-command-does-not-exist-anywhere-12345",
      cwd: process.cwd(),
      declaredResult: "fail",
      timeoutMs: 30_000,
    });

    // RE-BASELINED (issue #53, BR-1077, BR-152; spec D10). ORIGINAL assertion:
    //   `expect(outcome.value.observedExitCode).not.toBe(0)` — "the shell reports 127;
    //   declared `fail` matches a nonzero exit, so this captures" (i.e. an exit-127
    //   command not found was ACCEPTED as a measured fail). That is the defect: a
    //   missing binary is not a red. captureOracleCommand is UNCHANGED (it still
    //   reports the observed outcome, D10); the precheck now decides, so the outcome
    //   is fed through findCapturedRedProofGap and refused, naming 127.
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.observedExitCode).toBe(127);

    const gapFn = (precheck as unknown as { findCapturedRedProofGap?: (i: unknown) => { code: string; message: string } | null })
      .findCapturedRedProofGap;
    expect(
      typeof gapFn,
      "findCapturedRedProofGap is not exported from evidence-precheck.ts yet (paired implement task adds it)",
    ).toBe("function");
    const refusal = (gapFn as (i: unknown) => { code: string; message: string } | null)({
      oracle: "test",
      result: "fail",
      capture: true,
      exitCode: outcome.value.observedExitCode,
      outputTail: outcome.value.outputTail,
    });
    expect(refusal, "exit 127 must be refused as a red").not.toBeNull();
    expect(refusal?.code).toBe("VALIDATION_ERROR");
    expect(refusal?.message).toContain("127");
  });

  it("CAPWIN-E2: an unspawnable cwd is still reported as a spawn failure, never as a timeout", () => {
    const outcome = captureOracleCommand({
      command: "echo hi",
      cwd: "/nonexistent-directory-for-capture-window-test-12345",
      declaredResult: "pass",
      timeoutMs: 30_000,
    });

    expect(outcome.ok).toBe(false);
    const message = messageOf(outcome);
    expect(message.toLowerCase()).not.toContain("timed out");
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("captureOracleCommand window — STATE", () => {
  it("CAPWIN-S1: a timed-out child that EXITS 0 is still a timeout, never a runner-attested pass (measured spawnSync row 2)", () => {
    // A SIGTERM handler that exits 0: `spawnSync` reports status 0 / signal null.
    // Keying the timeout on `status === null` alone would have recorded this as a
    // clean runner-attested PASS for an oracle that never finished.
    const outcome = captureOracleCommand({
      command: "trap 'exit 0' TERM; sleep 5 & wait",
      cwd: process.cwd(),
      declaredResult: "pass",
      timeoutMs: 300,
    });

    expect(outcome.ok).toBe(false);
    expect(messageOf(outcome).toLowerCase()).toContain("timed out");
  });

  it("CAPWIN-S2: a timed-out child that EXITS 3 is still a timeout, never a genuine `fail` capture (measured spawnSync row 3 — the elapsed conjunct's reason to exist)", () => {
    const outcome = captureOracleCommand({
      command: "trap 'exit 3' TERM; sleep 5 & wait",
      cwd: process.cwd(),
      declaredResult: "fail",
      timeoutMs: 300,
    });

    expect(outcome.ok).toBe(false);
    expect(messageOf(outcome).toLowerCase()).toContain("timed out");
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("captureOracleCommand window — REGRESSION", () => {
  it("CAPWIN-R1: declared/observed exit-code mismatch INSIDE the window still refuses with the pre-existing result-mismatch wording, not the timeout wording", () => {
    const outcome = captureOracleCommand({
      command: "exit 3",
      cwd: process.cwd(),
      declaredResult: "pass",
      timeoutMs: 30_000,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect("field" in outcome.error ? outcome.error.field : undefined).toBe("result");
    const message = messageOf(outcome);
    expect(message).toContain("observed exit code 3");
    expect(message.toLowerCase()).not.toContain("timed out");
  });

  it("CAPWIN-R2: a genuine nonzero exit inside the window captures as a runner `fail` row, byte-identical to pre-fix behavior", () => {
    const outcome = captureOracleCommand({
      command: "echo boom >&2; exit 1",
      cwd: process.cwd(),
      declaredResult: "fail",
      timeoutMs: 30_000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.provenance.capture_source).toBe("runner");
    expect(outcome.value.observedExitCode).toBe(1);
    expect(outcome.value.outputTail).toContain("boom");
  });

  it("CAPWIN-R3: stderr is still captured alongside stdout (never discarded) under an explicit window", () => {
    const outcome = captureOracleCommand({
      command: "echo to-stdout; echo to-stderr >&2",
      cwd: process.cwd(),
      declaredResult: "pass",
      timeoutMs: 30_000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.outputTail).toContain("to-stdout");
    expect(outcome.value.outputTail).toContain("to-stderr");
  });
});
