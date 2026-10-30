/**
 * Corpus-only task classification (BR-1509).
 *
 * Purpose: decide whether a plan's task changes no code, so the milestone review gives it nothing to measure instead of
 *   charging it as `unlanded`.
 * Public surface: isCorpusOnlyTask, findCorpusOnlyTaskSlugs, noCodeSecurityJudgment, CorpusOnlyTaskFacts, NO_CODE_REASON.
 * Invariants:
 *   - A task is corpus-only iff ALL hold: no file anchors, no claim in its history named a branch or a worktree, no landing
 *     record. Any one failing keeps the task an ordinary task (no landing record then means `unlanded`).
 *   - The landing record's `kind` label is never read here (#517): only the presence of a landing record counts.
 * Side-effect class: pure, except findCorpusOnlyTaskSlugs (reads claim audit rows through the injected reader).
 *
 * @spec_ref spec-a-corpus-only-task-has-nothing-to-measure-and-a-closed (AC-AQ-1, BR-1509)
 */

import { ok, type DimensionJudgment, type DocId, type LoreError, type MilestoneFactRow, type Result } from "@lore/core";
import { readTaskLanding } from "./task-commit-range.js";

/** The sentence naming why regression and security have nothing to measure; one text for both dimensions. */
export const NO_CODE_REASON = "no task of this plan changes code";

/** What {@link isCorpusOnlyTask} reads about one task. */
export interface CorpusOnlyTaskFacts {
  /** The task's `extra.file_anchors` as stored (any shape: only a non-empty array of strings counts as anchored). */
  readonly file_anchors: unknown;
  /** The task's `claim` audit rows (every claim ever made on it, released or not). */
  readonly claim_rows: readonly { readonly details?: Readonly<Record<string, unknown>> | undefined }[];
  /** The task's current `extra.claim`, when it is claimed now. */
  readonly current_claim: Readonly<Record<string, unknown>> | undefined;
  /** Whether the task has a parsed `extra.landing` record. */
  readonly has_landing: boolean;
}

/**
 * Whether the task changes no code.
 *
 * @param facts - the task's anchors, claim history and landing presence
 * @returns `true` iff it is corpus-only (BR-1509)
 */
export function isCorpusOnlyTask(facts: CorpusOnlyTaskFacts): boolean {
  if (facts.has_landing) return false;
  if (Array.isArray(facts.file_anchors) && facts.file_anchors.length > 0) return false;
  const namesWorkingCopy = (record: Readonly<Record<string, unknown>> | undefined): boolean =>
    record !== undefined && (typeof record["branch"] === "string" || typeof record["worktree"] === "string");
  if (namesWorkingCopy(facts.current_claim)) return false;
  return !facts.claim_rows.some((row) => namesWorkingCopy(row.details));
}

/** The slice of `AuditService` the loader reads: the claim audit rows of one task. */
export interface ClaimAuditReader {
  readonly query: (filters: { doc_id: DocId; action: "claim" }) => Promise<Result<readonly { readonly details?: Readonly<Record<string, unknown>> | undefined }[], LoreError>>;
}

/** One task of the plan as the loader reads it. */
export interface CorpusOnlyCandidate {
  readonly id: DocId;
  readonly slug: string;
  readonly extra: Readonly<Record<string, unknown>>;
}

/**
 * The slugs of the plan's corpus-only tasks, measured from each task's anchors, claim audit rows and landing record.
 *
 * @param tasks - the plan's tasks
 * @param audit - the claim audit reader
 * @returns the corpus-only slugs; `err` when a claim history cannot be read (never read as "no claim")
 */
export async function findCorpusOnlyTaskSlugs(tasks: readonly CorpusOnlyCandidate[], audit: ClaimAuditReader): Promise<Result<Set<string>, LoreError>> {
  const slugs = new Set<string>();
  for (const task of tasks) {
    const landing = readTaskLanding(task.extra as Record<string, unknown>);
    // reason: a task with a landing record is decided without reading its claims; only a task with none can be corpus-only.
    if (landing !== undefined) continue;
    const rows = await audit.query({ doc_id: task.id, action: "claim" });
    if (!rows.ok) return rows;
    const claim = task.extra["claim"];
    const current = typeof claim === "object" && claim !== null ? (claim as Readonly<Record<string, unknown>>) : undefined;
    if (isCorpusOnlyTask({ file_anchors: task.extra["file_anchors"], claim_rows: rows.value, current_claim: current, has_landing: false })) slugs.add(task.slug);
  }
  return ok(slugs);
}

/**
 * The one regression fact row of a plan whose every task is corpus-only.
 *
 * @param noCodeTasks - the corpus-only tasks, named in the detail
 * @returns an `na` row naming that no task changes code
 */
export function noCodeRegressionRow(noCodeTasks: readonly string[]): MilestoneFactRow {
  return { subject: "no-code", verdict: "na", detail: `${NO_CODE_REASON}: ${noCodeTasks.join(", ")}` };
}

/**
 * The security judgment of a plan whose every task is corpus-only.
 *
 * @param noCodeTasks - the corpus-only tasks, named in the reason
 * @returns `na`, never `pass`
 */
export function noCodeSecurityJudgment(noCodeTasks: readonly string[]): DimensionJudgment {
  return { verdict: "na", reason: `${NO_CODE_REASON} (${noCodeTasks.join(", ")})`, reference: "BR-1509" };
}
