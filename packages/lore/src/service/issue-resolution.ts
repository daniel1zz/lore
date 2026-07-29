/**
 * Pure computation for the `resolves` link type and computed issue-report
 * resolution (spec-issue-closure-loop-computed-resolution-agent-reachable,
 * D1/D2). All exports here are total, side-effect-free functions over
 * already-typed inputs (no IO, no store, no `Date.now()`) — deliberately
 * kept store-free so `computeIssueResolution` stays testable under vitest
 * without `bun:sqlite`; the caller (a future store-backed orchestrator, out
 * of this module's scope) supplies every doc it needs, this module never
 * re-fetches anything itself.
 *
 * Public surface:
 *   - `IssueResolution` — the 5-state computed resolution
 *     (`open | resolving | fixed | rejected | wontfix`).
 *   - `computeIssueResolution` — derives the resolution from (a) any
 *     explicit terminal state recorded at `extra.issue_report.resolution`,
 *     and, absent that, (b) the `resolves` in-edges pointing at the issue
 *     plus each source doc's lifecycle status.
 *   - `hasIssueReport` — defensive `extra.issue_report` presence predicate;
 *     the SAME guard `CorpusService.link`'s write-time validation (D1b) uses
 *     to reject a `resolves` edge whose target isn't an issue task.
 *
 * Invariants:
 *   - An explicit terminal state (`rejected`/`wontfix`, written only by the
 *     downstream `lore issue resolve` verb — out of this module's scope)
 *     ALWAYS wins over edge computation — a `resolves` edge landing on an
 *     already-terminal issue never overrides it. There is no path in this
 *     module that returns `fixed` from an explicit write; `fixed` is
 *     reachable ONLY through a `resolves` edge whose source doc has reached
 *     `active`/`archived` (spec's "no hand-set fixed anywhere in the
 *     system").
 *   - Both exported functions read `extra` defensively (mirrors
 *     `issue-report.ts::readReporterProject`'s guard shape, duplicated
 *     rather than imported — that module's own invariant already documents
 *     why `extra.issue_report` stays untyped `extra` passthrough) — a
 *     malformed or legacy `extra` degrades to "no signal" rather than
 *     throwing.
 *
 * Side-effect class: pure.
 *
 * Source: spec-issue-closure-loop-computed-resolution-agent-reachable §D1, §D2.
 */

import type { DocStatus } from "@lore/core";

/**
 * Computed resolution states for a filed issue report (D2). `rejected`/
 * `wontfix` are explicit terminal states (written by the downstream `lore
 * issue resolve` verb); `fixed` is reachable ONLY via a `resolves` edge to a
 * terminal (`active`/`archived`) source doc — never hand-set.
 */
export type IssueResolution = "open" | "resolving" | "fixed" | "rejected" | "wontfix";

/** Minimal issue-task shape `computeIssueResolution` needs: just its `extra` bag. */
export interface IssueTaskLike {
  extra?: unknown;
}

/**
 * A `resolves` in-edge pointing at the issue task. Only `from_id` matters —
 * it is the join key against `sourceDocs`.
 */
export interface ResolvesInEdgeLike {
  from_id: string;
}

/** A resolves-edge source doc's identity + lifecycle status. */
export interface ResolutionSourceDocLike {
  id: string;
  status: DocStatus;
}

/**
 * Defensive `extra.issue_report` presence predicate — used by
 * `CorpusService.link`'s D1b write-time validation to decide whether a
 * `resolves` edge's target qualifies as an issue task. Presence-only: it
 * does not validate the inner shape of `issue_report` (that stays untyped
 * `extra` passthrough, per `issue-report.ts`'s own module invariant).
 *
 * @param extra - a doc's raw `extra` field (untyped storage)
 * @returns `true` iff `extra.issue_report` is a non-null, non-array object
 * @example
 *   hasIssueReport({issue_report: {reporter_project: "x"}}) // => true
 *   hasIssueReport({issue_report: {}})                      // => true (presence only)
 *   hasIssueReport({issue_report: "not-an-object"})         // => false
 *   hasIssueReport({})                                      // => false
 *   hasIssueReport(null)                                    // => false
 */
export function hasIssueReport(extra: unknown): boolean {
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) {
    return false;
  }
  const issueReport = (extra as Record<string, unknown>)["issue_report"];
  return issueReport !== null && typeof issueReport === "object" && !Array.isArray(issueReport);
}

/**
 * Defensive reader for an explicit terminal resolution
 * (`extra.issue_report.resolution.state`), written only by the downstream
 * `lore issue resolve --state rejected|wontfix` verb (D3, out of this
 * module's scope — this reader just consumes the shape that verb will
 * write).
 *
 * @param extra - the issue task's raw `extra` field
 * @returns `"rejected"` | `"wontfix"` when present and well-shaped,
 *   `undefined` otherwise (absent, malformed, or any other value)
 */
function readExplicitResolutionState(extra: unknown): "rejected" | "wontfix" | undefined {
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) {
    return undefined;
  }
  const issueReport = (extra as Record<string, unknown>)["issue_report"];
  if (issueReport === null || typeof issueReport !== "object" || Array.isArray(issueReport)) {
    return undefined;
  }
  const resolution = (issueReport as Record<string, unknown>)["resolution"];
  if (resolution === null || typeof resolution !== "object" || Array.isArray(resolution)) {
    return undefined;
  }
  const state = (resolution as Record<string, unknown>)["state"];
  return state === "rejected" || state === "wontfix" ? state : undefined;
}

/**
 * D2 — pure computed-resolution derivation. Never mutates, never reads a
 * clock or a store; the caller supplies every doc up front.
 *
 * Precedence (highest first):
 *   1. An explicit terminal state at `extra.issue_report.resolution.state`
 *      (`rejected`/`wontfix`) — wins over any edge computation.
 *   2. `fixed` — at least one `resolvesInEdges` entry whose joined
 *      `sourceDocs` status is `active` or `archived`.
 *   3. `resolving` — at least one `resolvesInEdges` entry exists, but no
 *      joined source doc is terminal.
 *   4. `open` — no `resolvesInEdges` entry and no explicit terminal state.
 *
 * @param issue - the issue task (only its `extra` bag is read)
 * @param resolvesInEdges - every `resolves` edge whose `to` is this issue
 *   (join key: `from_id`)
 * @param sourceDocs - the resolved `from` docs referenced by
 *   `resolvesInEdges`, each carrying its current lifecycle `status`. A
 *   `from_id` with no matching entry here is treated as non-terminal (not a
 *   crash) — the caller is expected to pass every referenced doc, but a
 *   partial list degrades safely rather than throwing.
 * @returns the computed `IssueResolution`
 * @example
 *   computeIssueResolution({extra: {}}, [], []) // => "open"
 *   computeIssueResolution(
 *     {extra: {}},
 *     [{from_id: "spec-1"}],
 *     [{id: "spec-1", status: "draft"}],
 *   ) // => "resolving"
 *   computeIssueResolution(
 *     {extra: {}},
 *     [{from_id: "spec-1"}],
 *     [{id: "spec-1", status: "archived"}],
 *   ) // => "fixed"
 *   computeIssueResolution(
 *     {extra: {issue_report: {resolution: {state: "wontfix"}}}},
 *     [{from_id: "spec-1"}],
 *     [{id: "spec-1", status: "archived"}],
 *   ) // => "wontfix" (explicit state wins over the terminal-source edge)
 */
export function computeIssueResolution(
  issue: IssueTaskLike,
  resolvesInEdges: ReadonlyArray<ResolvesInEdgeLike>,
  sourceDocs: ReadonlyArray<ResolutionSourceDocLike>,
): IssueResolution {
  const explicitState = readExplicitResolutionState(issue.extra);
  if (explicitState !== undefined) {
    return explicitState;
  }

  if (resolvesInEdges.length === 0) {
    return "open";
  }

  const statusBySourceId = new Map(sourceDocs.map((doc) => [doc.id, doc.status]));
  const hasTerminalSource = resolvesInEdges.some((edge) => {
    const status = statusBySourceId.get(edge.from_id);
    return status === "active" || status === "archived";
  });

  return hasTerminalSource ? "fixed" : "resolving";
}
