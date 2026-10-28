/**
 * Implicit calibration capture hook — surface-neutral shared calling-layer module
 * invoked after a human's approve/reject decision succeeds, regardless of which
 * adapter (CLI, HTTP dashboard) carried that decision (SPEC-035 §3 D3,
 * SPEC-033 F1). Pairs the human decision against the doc's latest AI review
 * judgment (if any whose `doc_version` matches the version the human just acted
 * on) and records a `confirmed`/`overridden` calibration outcome via
 * `JudgmentService.recordCalibration`.
 *
 * Public surface:
 *   runCalibrationHook(deps, params) — attempt to pair the human's approve/reject
 *     decision against the doc's latest AI review judgment and persist the
 *     outcome. Never throws, never returns a `Result` — every outcome (no-op,
 *     silent skip, success, failure) is handled internally per the
 *     partial-failure contract below.
 *
 * @invariant Services still never cross-import (SPEC-001 §3 "no cross-service
 *   calls"). This module is NOT a service — it lives in `flows/`, a thin
 *   sequencing helper one level above the service layer, owned by no single
 *   adapter. Every adapter that adjudicates documents (CLI `approve`/`reject`,
 *   HTTP `/api/dashboard/docs/:id/approve|reject`, and any future
 *   adjudication surface) calls THIS SAME function with its own
 *   `{judgmentService, telemetry}` — never a re-implementation, never a copy.
 *   The product is human-friendly AND AI-friendly: adjudication on ANY surface
 *   must feed the SAME calibration loop, or that surface silently starves the
 *   Wilson-bound calibration stats of real data.
 * @invariant Calibration is a byproduct, never a gate: this function is called
 *   ONLY after the human's approve/reject has already succeeded, and nothing it
 *   does can undo that decision. Its `Promise<void>` return carries no signal a
 *   caller could use to reverse the decision.
 * @invariant Silent no-op (no stderr output, no telemetry, no `onWarning` call)
 *   when:
 *   (a) the doc has no judgment at all, or
 *   (b) the judgment's `doc_version` no longer matches the version the doc was
 *       at when the human made their decision (`actedOnVersion`) — the doc
 *       moved on since the judgment was made; the pending-review badge already
 *       communicates this staleness, so a second warning here would be noise.
 * @invariant A genuine IO failure (fetching the judgment OR writing the
 *   calibration record returns a LoreError) is NEVER silently dropped: it
 *   prints `warning: <approved|rejected>, but calibration record failed: <msg>`
 *   to stderr, records one telemetry event, and (when the caller supplied one)
 *   invokes `onWarning(message)` so an HTTP caller can surface it in its own
 *   response shape (e.g. `{ warnings: string[] }`) — while leaving the calling
 *   command's outcome (exit code / HTTP status) untouched. `onWarning` is
 *   strictly additive: omitting it (every pre-SPEC-033 CLI call site) preserves
 *   the exact prior stderr+telemetry-only behavior byte-for-byte.
 *
 * Side-effect class: IO (JudgmentService store calls, stderr write, telemetry.record,
 *   optional onWarning callback)
 *
 * Source: SPEC-035 §3 D3; SPEC-033 F1 (hoist to surface-neutral flows/)
 */

import type { WarnSink } from "../service/warn-sink.js";
import type { CalibrationOutcome, DocId, DocRecord, LoreError, ReviewDecision, Telemetry, TelemetryEvent } from "@lore/core";
import type { JudgmentService } from "../service/judgment-service.js";
import { formatError } from "../adapters/cli/utils.js";

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
  /** Where the partial-failure line `warning: <approved|rejected>, but calibration record failed: ...` goes (the run's stderr). */
  warn: WarnSink;
  /**
   * Optional partial-failure observer (SPEC-033 F1) — called with the same
   * human-readable message that is printed to stderr, ONLY on a genuine IO
   * failure branch (never on a silent no-op/skip). Omit for CLI call sites
   * (stderr is the sole channel there); the HTTP adapter passes one to collect
   * the message into their own response's `warnings: string[]`.
   */
  onWarning?: (message: string) => void;
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
  /** Optional `--calibration-note` / `calibration_note` value → `delta_reasons[0]` when present. */
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
    warnCalibrationFailure(deps, humanAction, judgmentResult.error);
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
    warnCalibrationFailure(deps, humanAction, calibrationResult.error);
    return;
  }

  // reason: `calibrationResult.value.recorded === false` (version_mismatch /
  // not_latest_judgment) cannot occur on this path — we already pinned
  // `currentDocVersion === judgment.doc_version` above, and `judgment` is the
  // just-fetched latest judgment for this doc, so JudgmentService's own
  // re-checks of both conditions are guaranteed to pass. Nothing further to do.
}

/**
 * Print the partial-failure warning to stderr, record one telemetry event, and
 * (when supplied) invoke `deps.onWarning` — the shared tail of both failure
 * branches in {@link runCalibrationHook}.
 */
function warnCalibrationFailure(
  deps: Pick<CalibrationHookDeps, "telemetry" | "onWarning" | "warn">,
  humanAction: HumanReviewAction,
  error: LoreError,
): void {
  const verb = humanAction === "approve" ? "approved" : "rejected";
  // reason: formatError lives in adapters/cli/utils.ts (the app-wide LoreError → string
  // SSOT used by all 30+ CLI commands) — reused here rather than duplicated, even though
  // this module lives outside adapters/cli, because it is a pure formatting function with
  // no CLI-only side effects (no process.exit, no stdout write).
  const message = `${verb}, but calibration record failed: ${formatError(error)}`;
  /** @lore-site BR-288 */
  deps.warn(`warning: ${message}`);

  const event: TelemetryEvent = {
    ts: new Date().toISOString(),
    service: "cli.calibration-hook",
    method: humanAction,
    ok: false,
    duration_ms: 0,
    error_code: error.code,
  };
  deps.telemetry.record(event);

  deps.onWarning?.(message);
}
