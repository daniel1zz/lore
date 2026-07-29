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
 *   - `IssueResolution` — the 6-state computed resolution
 *     (`open | resolving | fixed | closed | rejected | wontfix`).
 *   - `computeIssueResolution` — derives the resolution from, highest
 *     precedence first: (a) any explicit terminal state recorded at
 *     `extra.issue_report.resolution` (D3), (b) the `resolves` in-edges
 *     pointing at the issue plus each source doc's lifecycle status (D2
 *     `fixed`/`resolving`), (c) a recorded review-workflow rejection (D2
 *     `rejected` reached WITHOUT D3 — the caller supplies this as a plain
 *     boolean since the audit trail it comes from lives outside this
 *     store-free module), (d) the issue task's OWN doc status being
 *     `archived` (D2 `closed` — an upstream maintainer terminated it with no
 *     traceable fix source ever recorded, the shape of every report closed
 *     BEFORE this mechanism existed).
 *   - `hasIssueReport` — defensive `extra.issue_report` presence predicate;
 *     the SAME guard `CorpusService.link`'s write-time validation (D1b) uses
 *     to reject a `resolves` edge whose target isn't an issue task.
 *
 * Invariants:
 *   - Precedence, highest first: explicit terminal state (D3) > resolves-edge
 *     computation (`fixed`/`resolving`) > recorded review rejection
 *     (`rejected`) > archived doc status (`closed`) > `open`. A `resolves`
 *     edge landing on an already-terminal issue never overrides it, and ANY
 *     resolves edge (even one that computes `resolving`, not yet `fixed`)
 *     outranks both the review-rejection signal and the archived-doc-status
 *     signal — a fix already in flight is more informative than either.
 *     There is no path in this module that returns `fixed` from an explicit
 *     write; `fixed` is reachable ONLY through a `resolves` edge whose
 *     source doc has reached `active`/`archived` (spec's "no hand-set fixed
 *     anywhere in the system").
 *   - `hasRecordedReviewRejection` exists because `ReviewService.reject`
 *     (SPEC-005) deliberately never transitions a doc OFF `draft` — the
 *     audit trail, not `doc.status`, is the sole record of a rejection, so a
 *     review-rejected report is indistinguishable from an untouched one by
 *     status alone. This module stays store-free, so it cannot query that
 *     audit trail itself; the caller (`flows/upstream-context-flow.ts`'s
 *     `UpstreamPort.getResolution`, D6/D7) does that lookup and passes the
 *     boolean result in. Without this, a review-rejected report would
 *     compute `open` (or `closed`, once archived) while still carrying a
 *     rejection reason — the exact self-contradicting row §20 F3/F4 forbid.
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
 * issue resolve` verb) OR — for `rejected` only — a recorded review-workflow
 * rejection (D2, no explicit write required); `fixed` is reachable ONLY via
 * a `resolves` edge to a terminal (`active`/`archived`) source doc — never
 * hand-set; `closed` is the issue task's OWN doc status reaching `archived`
 * with no traceable fix source ever recorded.
 */
export type IssueResolution = "open" | "resolving" | "fixed" | "closed" | "rejected" | "wontfix";

/**
 * Minimal issue-task shape `computeIssueResolution` needs: its `extra` bag,
 * plus (optionally) its own current lifecycle `status` — needed ONLY for
 * D2's `closed` state (an issue archived with no resolves in-edge and no
 * explicit terminal state). `status` is optional so pre-existing callers
 * that predate this field keep compiling unmodified; omitting it simply
 * makes `closed` unreachable for that caller (degrades to the pre-existing
 * `open` result), never a crash.
 */
export interface IssueTaskLike {
  extra?: unknown;
  status?: DocStatus;
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
 *      (`rejected`/`wontfix`) — wins over everything below.
 *   2. `fixed` — at least one `resolvesInEdges` entry whose joined
 *      `sourceDocs` status is `active` or `archived`.
 *   3. `resolving` — at least one `resolvesInEdges` entry exists, but no
 *      joined source doc is terminal. (2) and (3) together mean ANY
 *      `resolvesInEdges` entry outranks both (4) and (5) below — a fix
 *      already in flight is more informative than either signal.
 *   4. `rejected` — no `resolvesInEdges` entry, and `hasRecordedReviewRejection`
 *      is `true` (a `ReviewService.reject` audit entry exists for this doc;
 *      SPEC-005 never moves the doc's own status off `draft`, so this
 *      boolean is the ONLY signal for this case — see this module's header).
 *   5. `closed` — no `resolvesInEdges` entry, no recorded review rejection,
 *      and `issue.status === "archived"`.
 *   6. `open` — none of the above.
 *
 * @param issue - the issue task; only `extra` and (optionally) `status` are read
 * @param resolvesInEdges - every `resolves` edge whose `to` is this issue
 *   (join key: `from_id`)
 * @param sourceDocs - the resolved `from` docs referenced by
 *   `resolvesInEdges`, each carrying its current lifecycle `status`. A
 *   `from_id` with no matching entry here is treated as non-terminal (not a
 *   crash) — the caller is expected to pass every referenced doc, but a
 *   partial list degrades safely rather than throwing.
 * @param hasRecordedReviewRejection - `true` iff the caller has independently
 *   confirmed a review-workflow rejection audit entry exists for this issue
 *   doc (D2; the audit-log lookup itself happens OUTSIDE this store-free
 *   module — see `flows/upstream-context-flow.ts::getResolution`). Defaults
 *   to `false` so every pre-existing caller that predates this parameter
 *   keeps compiling and behaving unchanged.
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
 *   computeIssueResolution({extra: {}, status: "archived"}, [], []) // => "closed"
 *   computeIssueResolution({extra: {}, status: "archived"}, [], [], true) // => "rejected"
 *     // (recorded review rejection outranks the archived-doc-status signal)
 */
export function computeIssueResolution(
  issue: IssueTaskLike,
  resolvesInEdges: ReadonlyArray<ResolvesInEdgeLike>,
  sourceDocs: ReadonlyArray<ResolutionSourceDocLike>,
  hasRecordedReviewRejection = false,
): IssueResolution {
  const explicitState = readExplicitResolutionState(issue.extra);
  if (explicitState !== undefined) {
    return explicitState;
  }

  if (resolvesInEdges.length === 0) {
    if (hasRecordedReviewRejection) {
      return "rejected";
    }
    if (issue.status === "archived") {
      return "closed";
    }
    return "open";
  }

  const statusBySourceId = new Map(sourceDocs.map((doc) => [doc.id, doc.status]));
  const hasTerminalSource = resolvesInEdges.some((edge) => {
    const status = statusBySourceId.get(edge.from_id);
    return status === "active" || status === "archived";
  });

  return hasTerminalSource ? "fixed" : "resolving";
}
