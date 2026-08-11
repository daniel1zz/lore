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
 * ⛔ The two NON-DEROGATORY terminal states (`superseded`, `duplicate`,
 * spec-the-defect-channel-cannot-be-honestly-maintained-an §M3) each REQUIRE a
 * pointer to the doc that supersedes/absorbs the report. Without one,
 * "superseded" degrades into a silent trash can operationally indistinguishable
 * from `rejected` — which IS the defect §M3 fixes, not a lesser version of it.
 * The requirement is DECLARED here (the `pointer` field of the reach table) and
 * enforced by the field's single writer, `adapters/cli/commands/issue.ts`.
 *
 * ⛔ The VOCABULARY (the member tokens themselves, `IssueResolution`,
 * `TerminalIssueResolution`) is NOT defined here — it lives in
 * `@lore/core`'s `issue-resolution-vocab.ts` and is imported + re-exported
 * below. This module owns the LOGIC over that vocabulary (the reach/pointer
 * table, `computeIssueResolution`, `hasIssueReport`), never the token list. The
 * vocabulary moved to `@lore/core` because `packages/dashboard/src/**` may
 * import `@lore/core` ONLY and therefore could not reach a union defined in this
 * server-only tree: it kept a hand mirror in `src/lib/api.ts` that was a SECOND
 * construction site of the member set (AC-DC-9 went RED on it, 2026-08-11).
 * Consumers keep importing every name below from THIS module — the re-exports
 * are what make the relocation invisible to them.
 *
 * Public surface:
 *   - `IssueResolution` / `TerminalIssueResolution` — re-exported from
 *     `@lore/core`; the 8-state computed resolution (`open | resolving` plus the
 *     six TERMINAL states).
 *   - `TERMINAL_ISSUE_RESOLUTIONS` — the SSOT member set of terminal
 *     resolutions as a `ReadonlySet` (spec-the-defect-channel-cannot-be-honestly-
 *     maintained-an §M1), built from `@lore/core`'s single member-array literal:
 *     `commands/issues.ts`'s `--open`/`--resolved` filter AND
 *     `IssueReportService`'s open-report-cap narrowing both IMPORT it from here.
 *     A second construction of that member set anywhere under `packages/**` is a
 *     RED test (AC-DC-9), because the copies that existed before this SSOT
 *     drifted in exactly the way that made a resolved report keep occupying cap
 *     quota.
 *   - `TERMINAL_RESOLUTION_REACH` / `TerminalResolutionReach` — per terminal
 *     state, the ROUTE that reaches it and the pointer it REQUIRES. This is
 *     what lets the cap refusal render a remedy that works instead of a
 *     hand-authored list of verbs that can silently rot (§M1's structured
 *     refusal payload).
 *   - `EXPLICIT_TERMINAL_RESOLUTIONS` / `ExplicitTerminalResolution` — the
 *     hand-settable subset (`route === "issue-resolve"`), DERIVED from the
 *     reach table rather than re-listed: `lore issue resolve --state` accepts
 *     exactly these, and `fixed`/`closed` are structurally unreachable there.
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
 *   - `TERMINAL_ISSUE_RESOLUTIONS` is the SSOT member set and every consumer
 *     IMPORTS it; it is DERIVED from `@lore/core`'s
 *     `TERMINAL_ISSUE_RESOLUTION_MEMBERS`, never re-listed here. Its two further
 *     derived views (`EXPLICIT_TERMINAL_RESOLUTIONS`, the
 *     `ExplicitTerminalResolution` type) are computed from
 *     `TERMINAL_RESOLUTION_REACH`, never re-listed — see those symbols' own docs.
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

import {
  TERMINAL_ISSUE_RESOLUTION_MEMBERS,
  type DocStatus,
  type IssueResolution,
  type TerminalIssueResolution,
} from "@lore/core";

/**
 * The resolution vocabulary, RE-EXPORTED rather than redefined
 * (spec-the-defect-channel-cannot-be-honestly-maintained-an §M1, AC-DC-9).
 *
 * `IssueResolution` is the 8-state computed resolution and
 * `TerminalIssueResolution` its 6-state terminal subset; both are DERIVED in
 * `@lore/core`'s `issue-resolution-vocab.ts` from the one member-array literal
 * that exists for them repo-wide. ⛔ Do NOT restate either union here (nor
 * anywhere else under `packages/**`) — the tokens had two construction sites
 * before this relocation and a repo-wide scan now asserts they have exactly one
 * (`tests/unit/service/terminal-resolution-ssot.test.ts`).
 *
 * They are re-exported from this module because every server-side consumer
 * (`commands/issues.ts`, `commands/issue.ts`, `commands/status.ts`,
 * `issue-report-service.ts`, `issue-reports-routes.ts`,
 * `upstream-context-flow.ts`) reads the vocabulary and the computation from ONE
 * import site — the relocation must not fan a second `@lore/core` import out
 * across all of them.
 *
 * What each state MEANS: `rejected`/`wontfix`/`superseded`/`duplicate` are
 * explicit terminal states (written by the downstream `lore issue resolve` verb)
 * OR — for `rejected` only — a recorded review-workflow rejection (D2, no
 * explicit write required); `fixed` is reachable ONLY via a `resolves` edge to a
 * terminal (`active`/`archived`) source doc — never hand-set; `closed` is the
 * issue task's OWN doc status reaching `archived` with no traceable fix source
 * ever recorded. {@link computeIssueResolution} is the one implementation of
 * that precedence.
 */
export type { IssueResolution, TerminalIssueResolution };

/** How a terminal resolution is REACHED — the axis the cap refusal's remedy lines are derived from. */
export type TerminalResolutionRoute = "issue-resolve" | "resolves-link" | "review-archive";

/**
 * A REQUIRED pointer: which CLI flag supplies it, the key it is persisted under
 * inside `extra.issue_report.resolution`, and the noun phrase describing WHAT it
 * must name.
 *
 * `names` lives here rather than in the refusal messages so a third
 * pointer-carrying state cannot inherit another state's wording by falling
 * through a `state === "duplicate" ? … : …` ternary — every refusal that has to
 * describe the pointer reads this field.
 */
export interface TerminalResolutionPointer {
  readonly flag: string;
  readonly extra_key: string;
  readonly names: string;
}

/**
 * One terminal state's reachability facts. `pointer: null` is an EXPLICIT "this
 * state takes no pointer" rather than an absent field, so every consumer reads
 * the same shape and a missing declaration cannot read as "no pointer needed".
 */
export interface TerminalResolutionReach {
  readonly route: TerminalResolutionRoute;
  readonly pointer: TerminalResolutionPointer | null;
}

/**
 * Per terminal state: the route that reaches it and the pointer it requires.
 *
 * `as const satisfies` is load-bearing, not decoration: `as const` preserves each
 * `route` as a LITERAL type (which is what makes
 * {@link ExplicitTerminalResolution} derivable instead of re-listed), while
 * `satisfies Record<TerminalIssueResolution, …>` makes a member added to
 * `@lore/core`'s {@link TERMINAL_ISSUE_RESOLUTION_MEMBERS} without an entry here
 * a COMPILE error. ⛔ Do not widen it to a plain `Record<...>` annotation — that
 * silently destroys the first half. ⛔ This table is LOGIC, not vocabulary: it
 * stays in this server-only module (its `--superseded-by`/`--duplicate-of` flags
 * and `extra` keys are CLI facts) and is deliberately NOT relocated to
 * `@lore/core` alongside the member tokens.
 */
const TERMINAL_RESOLUTION_REACH = {
  rejected: { route: "issue-resolve", pointer: null },
  wontfix: { route: "issue-resolve", pointer: null },
  superseded: {
    route: "issue-resolve",
    pointer: {
      flag: "--superseded-by",
      extra_key: "superseded_by",
      names: "the doc that supersedes this report",
    },
  },
  duplicate: {
    route: "issue-resolve",
    pointer: {
      flag: "--duplicate-of",
      extra_key: "duplicate_of",
      names: "the doc this report duplicates",
    },
  },
  fixed: { route: "resolves-link", pointer: null },
  closed: { route: "review-archive", pointer: null },
} as const satisfies Record<TerminalIssueResolution, TerminalResolutionReach>;

/**
 * The terminal states a caller may write by hand — derived from the reach table
 * rather than re-listed, so `lore issue resolve --state fixed` is refused by the
 * TYPE SYSTEM's own arithmetic and not by a remembered exclusion.
 */
export type ExplicitTerminalResolution = {
  [K in TerminalIssueResolution]: (typeof TERMINAL_RESOLUTION_REACH)[K]["route"] extends "issue-resolve" ? K : never;
}[TerminalIssueResolution];

/**
 * The SSOT terminal-resolution member set as a membership set: a report in one of
 * these states no longer needs triage eyes, and (§M1) no longer occupies
 * open-report cap quota. Built from `@lore/core`'s single
 * {@link TERMINAL_ISSUE_RESOLUTION_MEMBERS} literal — this is a VIEW of that one
 * declaration, never a second listing of it.
 *
 * `closed` is terminal for the SAME reason `fixed`/`rejected`/`wontfix` are: an
 * issue archived with no traceable fix source (the shape of every report closed
 * BEFORE the computed-resolution mechanism existed) needs no further triage.
 *
 * @example
 *   TERMINAL_ISSUE_RESOLUTIONS.has("superseded") // => true
 *   TERMINAL_ISSUE_RESOLUTIONS.has("resolving")  // => false (a fix in flight still needs eyes)
 */
export const TERMINAL_ISSUE_RESOLUTIONS: ReadonlySet<IssueResolution> = new Set<IssueResolution>(
  TERMINAL_ISSUE_RESOLUTION_MEMBERS,
);

/**
 * The same member set as an ORDERED, TYPED list — the view a consumer needs when
 * it must iterate terminal states and call {@link reachOfTerminalResolution} on
 * each (a `ReadonlySet<IssueResolution>` iterates as the wider union, which does
 * not type-check as a reach-table key).
 *
 * ⛔ An ALIAS of `@lore/core`'s {@link TERMINAL_ISSUE_RESOLUTION_MEMBERS}
 * (reference-identical), not a copy: one declaration, three views — this list for
 * iteration, {@link TERMINAL_ISSUE_RESOLUTIONS} for membership, and the core
 * array itself for anything browser-side. The alias is kept because
 * `issue-report-service.ts` imports this name from this module; a consumer that
 * needs only the vocabulary should import the core name directly.
 */
export const TERMINAL_ISSUE_RESOLUTION_LIST: readonly TerminalIssueResolution[] = TERMINAL_ISSUE_RESOLUTION_MEMBERS;

/**
 * The hand-settable subset of {@link TERMINAL_ISSUE_RESOLUTIONS} — exactly the
 * values `lore issue resolve --state` accepts, and the values
 * {@link readExplicitResolutionState} recognises inside a stored `extra`.
 *
 * @example
 *   EXPLICIT_TERMINAL_RESOLUTIONS.has("duplicate") // => true
 *   EXPLICIT_TERMINAL_RESOLUTIONS.has("fixed")     // => false (computed only, never hand-set)
 */
export const EXPLICIT_TERMINAL_RESOLUTIONS: ReadonlySet<ExplicitTerminalResolution> = new Set(
  TERMINAL_ISSUE_RESOLUTION_MEMBERS.filter(
    (member): member is ExplicitTerminalResolution => TERMINAL_RESOLUTION_REACH[member].route === "issue-resolve",
  ),
);

/**
 * The reach facts for one terminal state. A function rather than a direct table
 * read so callers get the WIDENED {@link TerminalResolutionReach} type (the
 * table's own `as const` value type is a union of six literal object types,
 * which a caller iterating over states cannot destructure).
 *
 * @param state - any terminal resolution
 * @returns that state's route plus its required pointer (`null` when it takes none)
 * @example
 *   reachOfTerminalResolution("superseded").pointer?.flag // => "--superseded-by"
 *   reachOfTerminalResolution("fixed").route              // => "resolves-link"
 */
export function reachOfTerminalResolution(state: TerminalIssueResolution): TerminalResolutionReach {
  return TERMINAL_RESOLUTION_REACH[state];
}

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
 * `lore issue resolve --state <explicit terminal state>` verb (D3 +
 * spec-the-defect-channel-cannot-be-honestly-maintained-an §M3, out of this
 * module's scope — this reader just consumes the shape that verb writes).
 *
 * Recognised values come from {@link EXPLICIT_TERMINAL_RESOLUTIONS}, never a
 * local list: when §M3 added `superseded`/`duplicate`, the set widened here
 * automatically, and a hand-written comparison chain would have kept computing
 * `open` for a report that WAS explicitly resolved — the exact class of silent
 * under-reporting §M1's cap defect was made of.
 *
 * @param extra - the issue task's raw `extra` field
 * @returns the recorded {@link ExplicitTerminalResolution} when present and
 *   well-shaped; `undefined` otherwise (absent, malformed, a computed-only
 *   state someone hand-wrote, or any other value)
 */
function readExplicitResolutionState(extra: unknown): ExplicitTerminalResolution | undefined {
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
  if (typeof state !== "string") return undefined;
  return (EXPLICIT_TERMINAL_RESOLUTIONS as ReadonlySet<string>).has(state)
    ? (state as ExplicitTerminalResolution)
    : undefined;
}

/**
 * D2 — pure computed-resolution derivation. Never mutates, never reads a
 * clock or a store; the caller supplies every doc up front.
 *
 * Precedence (highest first):
 *   1. An explicit terminal state at `extra.issue_report.resolution.state`
 *      (any member of {@link EXPLICIT_TERMINAL_RESOLUTIONS}, i.e.
 *      `rejected`/`wontfix`/`superseded`/`duplicate`) — wins over everything
 *      below.
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
