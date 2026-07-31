/** @spec_ref AC-IC-6 */
/**
 * Unit tests for the PURE report-issue concurrency-outcome classifier
 * (`@lore/core`'s `issue-report.ts`, spec-report-issue-has-no-specified-
 * concurrency-contract-ac-072 D6): given a pair of `{exitCode, stderr}`
 * observations it returns the D2 verdict, with ZERO spawns — the whole point
 * of D6 is that the decision table is testable without a process, so the
 * 50-run e2e harness can CALL this function instead of re-implementing the
 * rule and quietly disagreeing with it.
 *
 * Every non-template stderr fixture below is a VERBATIM capture from a real
 * run of the pre-change build (measured 2026-07-31 in this worktree, 20
 * natural pairs + 3 forced-contention pairs):
 *   - `PRE_CHANGE_BARE_STORE_ERROR` — what the contended report write printed
 *     before this slice landed (exit 1, no source field, no retry line).
 *   - `MEASURED_DLOPEN_STDERR` — the compiled-binary native-module load race
 *     (1 of 20 natural pairs), which the spec's Contract Details require the
 *     harness to distinguish from a contract violation or it reports a false
 *     RED.
 *
 * Six-dimension coverage:
 *   HAPPY:      both invocations exit 0; one exits 0 + the other refuses with
 *               the declared code and template (either order).
 *   NEGATIVE:   two non-zero exits; a non-zero exit whose code is not the
 *               declared one; a loser carrying the declared code but a
 *               non-conforming message.
 *   BOUNDARY:   template match keyed on three INDEPENDENT parts — dropping
 *               any single one (headline / source line / retry line) must
 *               stop matching; a zero bound and a multi-line-prefixed stderr.
 *   ERROR:      `isWriteContentionFailure` over the real SQLITE_BUSY shape vs
 *               unrelated store failures.
 *   STATE:      forced-contention (control) classifier — detected with one or
 *               both invocations refused, undetected when both succeed.
 *   REGRESSION: the measured pre-change stderr classifies as NON-conforming
 *               (so removing the enforcement can never pass), and the
 *               measured dlopen stderr classifies as not-attributable.
 */

import { describe, expect, it } from "vitest";
import {
  classifyConcurrencyOutcome,
  classifyForcedContentionOutcome,
  formatWriteContentionStderr,
  isWriteContentionFailure,
  matchesWriteContentionTemplate,
  UNKNOWN_CONTENDING_SOURCE,
  WRITE_CONTENTION_EXIT_CODE,
} from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CORPUS_PATH = "/tmp/lore-upstream-ic1/.lore/lore.db";
const BOUND_MS = 2000;
const RETRY_COMMAND = "lore report-issue --title 'A' --description 'd' --expected 'exit 0' --actual 'exit 4'";

/** The declared 3-part stderr, rendered by the production formatter itself. */
function declaredStderr(overrides?: { source?: string }): string {
  return formatWriteContentionStderr({
    operation: "report-issue",
    corpusPath: CORPUS_PATH,
    boundMs: BOUND_MS,
    source: overrides?.source ?? UNKNOWN_CONTENDING_SOURCE,
    retryCommand: RETRY_COMMAND,
  });
}

/** VERBATIM pre-change output of a contended report write (exit 1). */
const PRE_CHANGE_BARE_STORE_ERROR = "Error: Storage failure: database is locked\n";

/** VERBATIM compiled-binary native-module load race (trimmed stack tail). */
const MEASURED_DLOPEN_STDERR = `
 ERROR  dlopen(/$bunfs/root/index-vrkyg1eb.node, 0x0001): tried: '/$bunfs/root/index-vrkyg1eb.node' (no such file), '/System/Volumes/Preboot/Cryptexes/OS/$bunfs/root/index-vrkyg1eb.node' (no such file)

    at dlopen (unknown)
    at <anonymous> (/$bunfs/root/index.js:931:46915)
`;

/** A locked-database refusal from a layer OTHER than the report write: an uncaught startup crash. */
const STARTUP_UNCAUGHT_LOCK_CRASH = `
 ERROR  database is locked

    at <anonymous> (/$bunfs/root/index.js:520:1234)
`;

/**
 * VERBATIM capture of the per-command STARTUP corpus write losing a race
 * (measured: 1 of 50 natural pairs in this worktree). `loadLoreApp()` caught it
 * and rendered a generic STORE_ERROR plus SPEC-073's report-issue hint — the
 * hint is what marks it as the CLI startup path rather than the report write.
 */
const MEASURED_STARTUP_PHASE_LOCK_ERROR =
  "Error: Storage failure: database is locked\n" +
  "If, after re-checking your own input, you still judge this a lore defect: run " +
  "`lore report-issue --title <short-title> --expected <what-you-expected> " +
  "--actual <what-happened>` to file it.\n";

const OK = { exitCode: 0, stderr: "" };

// ─── AC-IC-6: the decision table ─────────────────────────────────────────────

describe("report-issue concurrency classifier (AC-IC-6, pure — no spawn)", () => {
  it("classifies conforming and non-conforming pairs", () => {
    const refused = { exitCode: WRITE_CONTENTION_EXIT_CODE, stderr: declaredStderr() };

    // HAPPY: both invocations landed their write.
    expect(classifyConcurrencyOutcome(OK, OK)).toEqual({
      outcome: "conforming",
      shape: "both_succeeded",
    });

    // HAPPY: exactly one won; the loser refused with the declared code AND template.
    expect(classifyConcurrencyOutcome(OK, refused)).toEqual({
      outcome: "conforming",
      shape: "one_refused_loudly",
    });
    // STATE: verdict is symmetric in the pair's order.
    expect(classifyConcurrencyOutcome(refused, OK)).toEqual({
      outcome: "conforming",
      shape: "one_refused_loudly",
    });

    // NEGATIVE: two non-zero exits are a failure even when BOTH carry the
    // declared code and template (the AC names this case explicitly).
    expect(classifyConcurrencyOutcome(refused, refused).outcome).toBe("non_conforming");

    // NEGATIVE: the loser used a code other than the declared one.
    expect(
      classifyConcurrencyOutcome(OK, { exitCode: 4, stderr: declaredStderr() }).outcome,
    ).toBe("non_conforming");

    // NEGATIVE + REGRESSION: the measured PRE-CHANGE behaviour (exit 1, bare
    // store error). If the enforcement is ever removed, this is what a
    // contended run prints — it must classify non-conforming so the harness
    // goes RED instead of quietly excluding it.
    expect(
      classifyConcurrencyOutcome(OK, { exitCode: 1, stderr: PRE_CHANGE_BARE_STORE_ERROR }).outcome,
    ).toBe("non_conforming");

    // ERROR: declared code, non-conforming message (no source/retry parts).
    expect(
      classifyConcurrencyOutcome(OK, {
        exitCode: WRITE_CONTENTION_EXIT_CODE,
        stderr: "Error: something went wrong\n",
      }).outcome,
    ).toBe("non_conforming");

    // REGRESSION: the compiled-binary dlopen race is NOT attributable to the
    // write contract — the run never had two competing writers.
    expect(classifyConcurrencyOutcome(OK, { exitCode: 1, stderr: MEASURED_DLOPEN_STDERR })).toEqual({
      outcome: "not_attributable",
      reason: "native_module_load_race",
      detail: expect.stringContaining("dlopen"),
    });
    // …in either position, and even when both invocations hit it.
    expect(classifyConcurrencyOutcome({ exitCode: 1, stderr: MEASURED_DLOPEN_STDERR }, OK)).toMatchObject({
      outcome: "not_attributable",
      reason: "native_module_load_race",
    });

    // A locked-database refusal carrying POSITIVE evidence of another layer —
    // an uncaught stack trace, or (measured) the CLI startup path's own hint —
    // comes from the per-command startup corpus write, which the spec's
    // Contract Details forbid attributing to this contract.
    expect(
      classifyConcurrencyOutcome(OK, { exitCode: 1, stderr: STARTUP_UNCAUGHT_LOCK_CRASH }),
    ).toEqual({
      outcome: "not_attributable",
      reason: "contention_outside_report_write",
      detail: expect.stringContaining("locked"),
    });
    expect(
      classifyConcurrencyOutcome(OK, { exitCode: 1, stderr: MEASURED_STARTUP_PHASE_LOCK_ERROR }),
    ).toEqual({
      outcome: "not_attributable",
      reason: "contention_outside_report_write",
      detail: expect.stringContaining("locked"),
    });
    // …and the SAME store-error text WITHOUT that evidence stays non-conforming:
    // that is the pre-contract report-write shape, asserted three lines above.
    expect(
      classifyConcurrencyOutcome(OK, {
        exitCode: 1,
        stderr: MEASURED_STARTUP_PHASE_LOCK_ERROR.replace("<short-title>", "my-title"),
      }).outcome,
    ).toBe("non_conforming");
  });

  it("BOUNDARY: template matching needs all three declared parts independently", () => {
    const full = declaredStderr();
    expect(matchesWriteContentionTemplate(full)).toBe(true);

    const lines = full.trimEnd().split("\n");
    expect(lines).toHaveLength(3);

    // Dropping ANY single part stops the match — the three conditions are
    // independent, never one remembered contiguous substring.
    for (let dropped = 0; dropped < lines.length; dropped++) {
      const partial = lines.filter((_, i) => i !== dropped).join("\n");
      expect(matchesWriteContentionTemplate(partial)).toBe(false);
    }

    // An empty / whitespace-only source field is NOT a named contender.
    expect(matchesWriteContentionTemplate(full.replace(UNKNOWN_CONTENDING_SOURCE, ""))).toBe(false);
    // A real identity (session/pid/host) matches just as well as the literal.
    expect(matchesWriteContentionTemplate(declaredStderr({ source: "pid:48213@fable.local" }))).toBe(true);

    // Extra leading noise on the stream does not break the match (the parts
    // are matched per-line, not as a whole-buffer prefix).
    expect(matchesWriteContentionTemplate(`warning: something advisory\n${full}`)).toBe(true);

    // A zero bound still renders and matches (BOUNDARY on the number itself).
    expect(
      matchesWriteContentionTemplate(
        formatWriteContentionStderr({
          operation: "report-issue",
          corpusPath: CORPUS_PATH,
          boundMs: 0,
          source: UNKNOWN_CONTENDING_SOURCE,
          retryCommand: RETRY_COMMAND,
        }),
      ),
    ).toBe(true);

    expect(matchesWriteContentionTemplate("")).toBe(false);
    expect(matchesWriteContentionTemplate(PRE_CHANGE_BARE_STORE_ERROR)).toBe(false);
  });

  it("ERROR: isWriteContentionFailure separates SQLITE_BUSY contention from other store failures", () => {
    // The measured shape: bun:sqlite SQLiteError, code SQLITE_BUSY, errno 5.
    expect(isWriteContentionFailure({ message: "database is locked", code: "SQLITE_BUSY" })).toBe(true);
    // Message alone (a wrapped/re-thrown error that lost its code).
    expect(isWriteContentionFailure({ message: "database is locked" })).toBe(true);
    expect(isWriteContentionFailure({ message: "database table is locked: docs" })).toBe(true);
    // Code alone (a driver that reports the code but an empty message).
    expect(isWriteContentionFailure({ code: "SQLITE_BUSY" })).toBe(true);

    // NOT contention: unrelated store failures must keep their generic path.
    expect(isWriteContentionFailure({ message: "no such table: docs", code: "SQLITE_ERROR" })).toBe(false);
    expect(isWriteContentionFailure({ message: "disk I/O error", code: "SQLITE_IOERR" })).toBe(false);
    expect(isWriteContentionFailure({})).toBe(false);
    expect(isWriteContentionFailure({ message: "" })).toBe(false);
    // errno 5 alone is NOT a signal (POSIX EIO collides with SQLITE_BUSY's errno).
    expect(isWriteContentionFailure({ message: "read error", errno: 5 })).toBe(false);
  });

  it("STATE: forced-contention control classifier reports detection, not the winner's fate", () => {
    const refused = { exitCode: WRITE_CONTENTION_EXIT_CODE, stderr: declaredStderr() };

    // The declared loud failure on ONE invocation is detection; the other
    // invocation's status is deliberately unconstrained.
    expect(classifyForcedContentionOutcome(OK, refused)).toEqual({ outcome: "detected", refused: 1 });
    expect(classifyForcedContentionOutcome(refused, OK)).toEqual({ outcome: "detected", refused: 1 });
    expect(classifyForcedContentionOutcome(refused, refused)).toEqual({ outcome: "detected", refused: 2 });
    // A dlopen crash on one side does not hide a real loud failure on the other.
    expect(
      classifyForcedContentionOutcome({ exitCode: 1, stderr: MEASURED_DLOPEN_STDERR }, refused).outcome,
    ).toBe("detected");

    // BOTH succeeded → the fixture created no contention: fails the criterion.
    expect(classifyForcedContentionOutcome(OK, OK)).toEqual({
      outcome: "undetected",
      detail: expect.stringContaining("both invocations succeeded"),
    });

    // REGRESSION: pre-change output (exit 1, bare store error) is NOT the
    // declared loud failure — the control must stay RED until enforcement lands.
    expect(
      classifyForcedContentionOutcome(
        { exitCode: 1, stderr: PRE_CHANGE_BARE_STORE_ERROR },
        { exitCode: 1, stderr: PRE_CHANGE_BARE_STORE_ERROR },
      ).outcome,
    ).toBe("undetected");

    // No loud failure and no explanation but a dlopen race → not attributable.
    expect(
      classifyForcedContentionOutcome(
        { exitCode: 1, stderr: MEASURED_DLOPEN_STDERR },
        { exitCode: 1, stderr: MEASURED_DLOPEN_STDERR },
      ),
    ).toEqual({
      outcome: "not_attributable",
      reason: "native_module_load_race",
      detail: expect.stringContaining("dlopen"),
    });
  });
});
