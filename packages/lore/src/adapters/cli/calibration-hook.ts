/**
 * Implicit calibration capture hook — shared adapter-level logic invoked by the
 * `approve` and `reject` CLI commands immediately after `ReviewService.approve` /
 * `ReviewService.reject` returns ok (SPEC-035 §3, D3).
 *
 * Public surface:
 *   runCalibrationHook(deps, params) — attempt to pair the human's approve/reject
 *     decision against the doc's latest AI review judgment and persist the
 *     outcome via `JudgmentService.recordCalibration`. Never throws, never
 *     returns a `Result` — every outcome (no-op, silent skip, success, failure)
 *     is handled internally per the partial-failure contract below.
 *
 * @invariant Calibration is a byproduct, never a gate: this function is called
 *   ONLY after the human's approve/reject has already succeeded, and nothing it
 *   does can undo that decision. It has no return value the caller can act on.
 * @invariant Silent no-op (no stderr output, no telemetry) when:
 *   (a) the doc has no judgment at all, or
 *   (b) the judgment's `doc_version` no longer matches the version the doc was
 *       at when the human made their decision (`actedOnVersion`) — the doc
 *       moved on since the judgment was made; the pending-review badge already
 *       communicates this staleness, so a second warning here would be noise.
 * @invariant A genuine IO failure (fetching the judgment OR writing the
 *   calibration record returns a LoreError) is NEVER silently dropped: it
 *   prints `warning: <approved|rejected>, but calibration record failed: <msg>`
 *   to stderr and records one telemetry event, while leaving the calling
 *   command's exit code untouched (still 0 — the human's decision stood).
 *
 * Side-effect class: IO (JudgmentService store calls, stderr write, telemetry.record)
 *
 * Source: SPEC-035 §3 D3
 */

import type { CalibrationOutcome, DocId, DocRecord, LoreError, ReviewDecision, Telemetry, TelemetryEvent } from "@lore/core";
import type { JudgmentService } from "../../service/judgment-service.js";
import { formatError } from "./utils.js";

/** Which human action triggered the hook — maps 1:1 to the CLI command name. */
export type HumanReviewAction = "approve" | "reject";

/**
 * Minimal dependency shape the hook needs — narrower than the full `App`
 * interface (Law of Demeter) so it stays unit-testable without constructing a
 * real App/SQLite store. `App` satisfies this structurally; callers pass `app`
 * directly.
 */
export interface CalibrationHookDeps {
  judgmentService: JudgmentService;
  telemetry: Telemetry;
}

export interface CalibrationHookParams {
  /** The doc AFTER the human action (the `ReviewService.approve/reject` return value). */
  updatedDoc: DocRecord;
  /**
   * The doc version the human was looking at WHEN THEY DECIDED — approve()
   * bumps `doc.version` by 1 as part of the transition, so this is
   * `updatedDoc.version - 1` for approve; reject() never bumps version, so
   * this is `updatedDoc.version` unchanged for reject. Callers compute this,
   * NOT this module (it has no independent way to know the pre-action version).
   */
  actedOnVersion: number;
  humanAction: HumanReviewAction;
  /** Resolved actor identity (same resolution the caller used for `--reviewer`). */
  actor: string;
  /** Optional `--calibration-note` value → `delta_reasons[0]` when present. */
  note?: string;
}

/** Pairs a human decision against the AI judge's decision into a calibration outcome. */
function pairCalibrationOutcome(
  humanAction: HumanReviewAction,
  aiDecision: ReviewDecision,
): CalibrationOutcome {
  if (humanAction === "approve") {
    return aiDecision === "approve" ? "confirmed" : "overridden";
  }
  return aiDecision === "reject" ? "confirmed" : "overridden";
}

/**
 * Attempt implicit calibration capture for one approve/reject action. See
 * module invariants above for the full skip/warn/succeed decision table.
 *
 * @example
 * const approveResult = await app.reviewService.approve(id, opts);
 * if (approveResult.ok) {
 *   await runCalibrationHook(app, {
 *     updatedDoc: approveResult.value,
 *     actedOnVersion: approveResult.value.version - 1,
 *     humanAction: "approve",
 *     actor: reviewer,
 *     note: args["calibration-note"],
 *   });
 * }
 */
export async function runCalibrationHook(
  deps: CalibrationHookDeps,
  params: CalibrationHookParams,
): Promise<void> {
  const { updatedDoc, actedOnVersion, humanAction, actor, note } = params;

  const judgmentResult = await deps.judgmentService.latestFor(updatedDoc.id as DocId);
  if (!judgmentResult.ok) {
    warnCalibrationFailure(deps.telemetry, humanAction, judgmentResult.error);
    return;
  }

  const judgment = judgmentResult.value;
  if (judgment === null) return; // no-op: nothing to calibrate against yet

  if (judgment.doc_version !== actedOnVersion) return; // silent skip: judgment is stale for this version

  const calibrationResult = await deps.judgmentService.recordCalibration({
    judgment,
    docType: updatedDoc.type,
    currentDocVersion: actedOnVersion,
    humanOutcome: pairCalibrationOutcome(humanAction, judgment.decision),
    deltaReasons: note !== undefined ? [note] : [],
    actor,
  });

  if (!calibrationResult.ok) {
    warnCalibrationFailure(deps.telemetry, humanAction, calibrationResult.error);
    return;
  }

  // reason: `calibrationResult.value.recorded === false` (version_mismatch /
  // not_latest_judgment) cannot occur on this path — we already pinned
  // `currentDocVersion === judgment.doc_version` above, and `judgment` is the
  // just-fetched latest judgment for this doc, so JudgmentService's own
  // re-checks of both conditions are guaranteed to pass. Nothing further to do.
}

/**
 * Print the partial-failure warning to stderr and record one telemetry event
 * — the shared tail of both failure branches in {@link runCalibrationHook}.
 */
function warnCalibrationFailure(
  telemetry: Telemetry,
  humanAction: HumanReviewAction,
  error: LoreError,
): void {
  const verb = humanAction === "approve" ? "approved" : "rejected";
  process.stderr.write(`warning: ${verb}, but calibration record failed: ${formatError(error)}\n`);

  const event: TelemetryEvent = {
    ts: new Date().toISOString(),
    service: "cli.calibration-hook",
    method: humanAction,
    ok: false,
    duration_ms: 0,
    error_code: error.code,
  };
  telemetry.record(event);
}
