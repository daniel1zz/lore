/**
 * `recordIssueVerdict` — the GitHub-only write behind `lore issue resolve`
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries D6, AC-GS-6): one comment carrying the reason and
 * pointer, then the close with a `state_reason`, then the `resolution:<verdict>` label with every other `resolution:*`
 * label removed. Nothing here touches the corpus.
 *
 * Public surface:
 *   - `IssueVerdictPort` — the four GitHub calls the sequence needs, each its own typed `Result`.
 *   - `GhIssueVerdictWriter` — the `GhRunner`-backed port (`new GhIssueVerdictWriter(runner)`).
 *   - `VerdictState` / `VERDICT_STATES` — the four verdicts `resolve` accepts, read from the SSOT terminal set.
 *   - `verdictMarker`, `buildVerdictComment` — the hidden marker and the comment body.
 *   - `recordIssueVerdict` — runs the sequence and reports which steps landed.
 *
 * Invariants:
 *   - Steps run in order comment -> close -> label and STOP at the first failing call; the steps after it are
 *     reported `skipped`, never attempted. The failing call's own error is returned for the caller's exit code.
 *   - Idempotent re-run: a comment already carrying `<!-- lore-resolve:<state> -->` is not re-posted; an issue already
 *     closed with the wanted `state_reason` is not re-closed; label convergence makes no write when already converged.
 *   - A comment listing that cannot be read is a FAILED comment step (posting blind could duplicate), never "no comments".
 *
 * Side-effect class: IO (GitHub via the injected port).
 *
 * Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries D6, AC-GS-6.
 */

import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import { z } from "zod";

import type { GhRunner } from "./gh-runner.js";
import { parseNextPage, splitHttpResponse } from "./github-intake-port.js";
import { EXPLICIT_TERMINAL_RESOLUTIONS, type ExplicitTerminalResolution } from "./issue-resolution.js";
import { GhResolutionLabelPort } from "./resolution-label-port.js";
import { resolutionToLabel, type GithubIssueRef } from "./resolution-projector.js";

/** The verdicts a maintainer may record by hand; derived from the SSOT, never re-listed. */
export type VerdictState = ExplicitTerminalResolution;

/** {@link VerdictState} as an ordered list, for refusal messages and help text. */
export const VERDICT_STATES: readonly VerdictState[] = [...EXPLICIT_TERMINAL_RESOLUTIONS];

/** GitHub `state_reason` a verdict closes with: `duplicate` for a duplicate, `not_planned` for every other verdict. */
export function closeReasonOf(state: VerdictState): "duplicate" | "not_planned" {
  return state === "duplicate" ? "duplicate" : "not_planned";
}

/** The hidden marker that makes a re-run recognise its own comment. */
export function verdictMarker(state: VerdictState): string {
  return `<!-- lore-resolve:${state} -->`;
}

/**
 * The comment body: the reason, the optional pointer line, then the hidden marker.
 *
 * @param pointerNote - e.g. `Duplicate of #3`; `undefined` when no pointer was given
 */
export function buildVerdictComment(state: VerdictState, reason: string, pointerNote: string | undefined): string {
  const lines = [reason, ...(pointerNote !== undefined ? ["", pointerNote] : []), "", verdictMarker(state)];
  return lines.join("\n");
}

/** The GitHub calls {@link recordIssueVerdict} makes. */
export interface IssueVerdictPort {
  /** Every comment body on the issue (all pages). */
  listCommentBodies(ref: GithubIssueRef): Promise<Result<readonly string[], LoreError>>;
  /** Posts one comment. */
  postComment(ref: GithubIssueRef, body: string): Promise<Result<void, LoreError>>;
  /** Closes the issue with `state_reason`. */
  closeWithReason(ref: GithubIssueRef, reason: "duplicate" | "not_planned"): Promise<Result<void, LoreError>>;
  /** Converges the issue to exactly the one `resolution:*` label `label`. */
  convergeLabel(ref: GithubIssueRef, label: string): Promise<Result<void, LoreError>>;
}

const CommentListSchema = z.array(z.object({ body: z.string().nullable().optional() }).passthrough());

/** Entries per comments request — GitHub's documented maximum. */
const COMMENT_PAGE_SIZE = 100;

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // reason: relocated — the caller's safeParse turns it into a VALIDATION_ERROR
  }
}

/** The `gh`-backed {@link IssueVerdictPort}. */
export class GhIssueVerdictWriter implements IssueVerdictPort {
  private readonly runner: GhRunner;
  private readonly labelPort: GhResolutionLabelPort;

  constructor(runner: GhRunner) {
    this.runner = runner;
    this.labelPort = new GhResolutionLabelPort(runner);
  }

  async listCommentBodies(ref: GithubIssueRef): Promise<Result<readonly string[], LoreError>> {
    const bodies: string[] = [];
    let page = 1;
    for (;;) {
      const response = await this.runner.run([
        "api",
        `repos/${ref.repo}/issues/${ref.issueNumber}/comments?per_page=${COMMENT_PAGE_SIZE}&page=${page}`,
        "-i",
      ]);
      if (!response.ok) return err(response.error);
      const split = splitHttpResponse(response.value.stdout);
      const parsed = CommentListSchema.safeParse(parseJsonSafely(split.body));
      if (!parsed.success) {
        return err({
          code: "VALIDATION_ERROR",
          field: "gh_comments_response",
          message: `gh returned a comments payload this module could not parse (page ${page}): ${parsed.error.message}`,
          value: response.value.stdout,
        });
      }
      bodies.push(...parsed.data.map((entry) => entry.body ?? ""));
      const nextPage = parseNextPage(split.linkHeader);
      if (nextPage === undefined) return ok(bodies);
      if (nextPage <= page) {
        return err({
          code: "VALIDATION_ERROR",
          field: "gh_comments_response",
          message: `GitHub's Link header pointed at page ${nextPage} after page ${page}; refusing to loop.`,
          value: nextPage,
        });
      }
      page = nextPage;
    }
  }

  async postComment(ref: GithubIssueRef, body: string): Promise<Result<void, LoreError>> {
    const posted = await this.runner.run(["api", `repos/${ref.repo}/issues/${ref.issueNumber}/comments`, "-X", "POST", "-f", `body=${body}`]);
    if (!posted.ok) return err(posted.error);
    return ok(undefined);
  }

  async closeWithReason(ref: GithubIssueRef, reason: "duplicate" | "not_planned"): Promise<Result<void, LoreError>> {
    const closed = await this.runner.run([
      "api",
      `repos/${ref.repo}/issues/${ref.issueNumber}`,
      "-X",
      "PATCH",
      "-f",
      "state=closed",
      "-f",
      `state_reason=${reason}`,
    ]);
    if (!closed.ok) return err(closed.error);
    return ok(undefined);
  }

  convergeLabel(ref: GithubIssueRef, label: string): Promise<Result<void, LoreError>> {
    return this.labelPort.setLabel(ref, label);
  }
}

/** What one step did. */
export type VerdictStepOutcome = "posted" | "already present" | "done" | "already closed" | "converged" | "failed" | "skipped";

/** The three steps' outcomes plus the first failure, if any. */
export interface VerdictReport {
  readonly comment: VerdictStepOutcome;
  readonly close: VerdictStepOutcome;
  readonly label: VerdictStepOutcome;
  /** The first failing call's error; absent when every step landed. */
  readonly failure?: LoreError;
}

/** The facts of the listed issue the sequence needs. */
export interface VerdictTarget {
  readonly ref: GithubIssueRef;
  /** GitHub state from the live listing. */
  readonly state: string;
  readonly stateReason: string | null | undefined;
}

/**
 * Runs comment -> close -> label for one verdict.
 *
 * @param port - the GitHub calls
 * @param target - the listed issue's ref and current state
 * @param state - the verdict
 * @param reason - non-blank reason text (the caller validated it)
 * @param pointerNote - optional pointer line for the comment
 * @returns which steps landed; `failure` carries the first failing call's error
 */
export async function recordIssueVerdict(
  port: IssueVerdictPort,
  target: VerdictTarget,
  state: VerdictState,
  reason: string,
  pointerNote: string | undefined,
): Promise<VerdictReport> {
  const marker = verdictMarker(state);
  const existing = await port.listCommentBodies(target.ref);
  if (!existing.ok) return { comment: "failed", close: "skipped", label: "skipped", failure: existing.error };

  let comment: VerdictStepOutcome = "already present";
  if (!existing.value.some((body) => body.includes(marker))) {
    const posted = await port.postComment(target.ref, buildVerdictComment(state, reason, pointerNote));
    if (!posted.ok) return { comment: "failed", close: "skipped", label: "skipped", failure: posted.error };
    comment = "posted";
  }

  const wanted = closeReasonOf(state);
  let close: VerdictStepOutcome = "already closed";
  if (!(target.state === "closed" && target.stateReason === wanted)) {
    const closed = await port.closeWithReason(target.ref, wanted);
    if (!closed.ok) return { comment, close: "failed", label: "skipped", failure: closed.error };
    close = "done";
  }

  const labelled = await port.convergeLabel(target.ref, resolutionToLabel(state));
  if (!labelled.ok) return { comment, close, label: "failed", failure: labelled.error };
  return { comment, close, label: "converged" };
}
