/**
 * Plan acceptance view — the pure rules behind bootstrap's `complete N (...)` line and `lore checks stats`'s
 * time-to-accepted and anomaly list (spec-plans-close-themselves-level-triggered-reconciliation-of §"Plan progress",
 * §"Self-measurement", §"Error"; BR-1379, AC-PCR-6).
 *
 * Purpose: turn the complete-and-not-accepted plans (classified by the review trigger service, never re-derived here)
 *   plus their last batch error into the summary line, the anomaly list and the age text.
 * Public surface: {@link BATCH_ERROR_AUDIT_ACTION}, {@link ANOMALY_AFTER_MS}, {@link CompletePlanView},
 *   {@link BatchErrorView}, {@link summarizeComplete}, {@link formatCompleteLines}, {@link findAnomalies},
 *   {@link formatAge}, {@link parseBatchError}.
 * Invariants:
 *   - `awaiting owner` plans count in `complete N` and `awaiting owner K`, and are NEVER anomalies (the only exemption).
 *   - `awaiting review M` is every other complete plan (it needs a review, a filing retry, a close or a settle).
 *   - `oldest` is the age of the earliest `completeAt` among complete plans, `-` when there is none.
 *   - The summary is exactly one line; the last error, when one exists, is a separate second line.
 * Side-effect class: pure.
 */

import type { AuditEntry } from "@lore/core";

/** The audit action of an errored batch attempt: not a review, never counted toward once-per-fingerprint. */
export const BATCH_ERROR_AUDIT_ACTION = "milestone-batch-error";

/** A plan complete, not accepted and not awaiting its owner for longer than this is an anomaly. */
export const ANOMALY_AFTER_MS = 24 * 3_600_000;

/** One review-batch error as recorded in its audit row. */
export interface BatchErrorView {
  readonly plan: string;
  readonly stage: string;
  readonly message: string;
  readonly at: string;
}

/** A complete, unarchived plan as the acceptance view sees it. */
export interface CompletePlanView {
  readonly plan: string;
  readonly planId: string;
  /** When the plan became complete (its stored `progress.at`). */
  readonly completeAt: string;
  /** True while its retired-AC owner decision is unresolved. */
  readonly awaitingOwner: boolean;
  readonly lastError?: BatchErrorView;
}

/** The counts behind the one-line summary. */
export interface CompleteSummary {
  readonly complete: number;
  readonly awaitingReview: number;
  readonly awaitingOwner: number;
  readonly oldestAgeMs: number | null;
  /** The most recent batch error across the complete plans, if any. */
  readonly lastError?: BatchErrorView;
}

/**
 * Parse one `milestone-batch-error` audit row.
 *
 * @returns the error view, or `undefined` when the row's details do not carry the recorded fields
 */
export function parseBatchError(entry: AuditEntry): BatchErrorView | undefined {
  const details = entry.details;
  const plan = details?.["plan"];
  const stage = details?.["stage"];
  const message = details?.["message"];
  if (typeof plan !== "string" || typeof stage !== "string" || typeof message !== "string") return undefined;
  return { plan, stage, message, at: typeof details?.["at"] === "string" ? details["at"] : entry.timestamp };
}

/** `5m`, `3h`, `2d`: the largest whole unit. */
export function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d`;
}

/**
 * Count the complete plans for the summary line.
 *
 * @param plans - complete, unarchived plans
 * @param nowMs - the current time
 */
export function summarizeComplete(plans: readonly CompletePlanView[], nowMs: number): CompleteSummary {
  const times = plans.map((p) => Date.parse(p.completeAt));
  const lastError = plans
    .map((p) => p.lastError)
    .filter((e): e is BatchErrorView => e !== undefined)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  return {
    complete: plans.length,
    awaitingReview: plans.filter((p) => !p.awaitingOwner).length,
    awaitingOwner: plans.filter((p) => p.awaitingOwner).length,
    oldestAgeMs: times.length === 0 ? null : nowMs - Math.min(...times),
    ...(lastError !== undefined ? { lastError } : {}),
  };
}

/** The bootstrap lines: the summary, then (only when a batch error exists) one indented error line. */
export function formatCompleteLines(summary: CompleteSummary): string[] {
  const oldest = summary.oldestAgeMs === null ? "-" : formatAge(summary.oldestAgeMs);
  const lines = [`complete ${String(summary.complete)} (awaiting review ${String(summary.awaitingReview)}, awaiting owner ${String(summary.awaitingOwner)}, oldest ${oldest})`];
  if (summary.lastError !== undefined) {
    const message = summary.lastError.message.length > 120 ? `${summary.lastError.message.slice(0, 117)}...` : summary.lastError.message;
    lines.push(`  last review error: ${summary.lastError.plan} ${summary.lastError.stage}: ${message}`);
  }
  return lines;
}

/**
 * The anomalies: complete, not accepted, not awaiting an unresolved owner decision, for more than 24 h.
 *
 * @returns the plans, oldest first
 */
export function findAnomalies(plans: readonly CompletePlanView[], nowMs: number): CompletePlanView[] {
  return plans
    .filter((p) => !p.awaitingOwner && nowMs - Date.parse(p.completeAt) > ANOMALY_AFTER_MS)
    .sort((a, b) => a.completeAt.localeCompare(b.completeAt));
}
