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
 *     `@lore/core`; the 9-state computed resolution (`open | resolving |
 *     adopted` plus the six TERMINAL states).
 *   - `TERMINAL_ISSUE_RESOLUTIONS` — the SSOT member set of terminal
 *     resolutions as a `ReadonlySet` (spec-the-defect-channel-cannot-be-honestly-
 *     maintained-an §M1), built from `@lore/core`'s single member-array literal:
 *     `commands/issues.ts`'s `--open`/`--resolved` filter imports it. ⛔
 *     `adopted` is NOT a member (§M7) — it stays visible under `--resolved`'s
 *     complement (it has an owner, but the claim itself is still undecided). A
 *     second construction of the TERMINAL member set anywhere under
 *     `packages/**` is a RED test (AC-DC-9), because the copies that existed
 *     before this SSOT drifted.
 *   - `TERMINAL_RESOLUTION_REACH` / `TerminalResolutionReach` — per terminal
 *     state, the ROUTE that reaches it and the pointer it REQUIRES. This is
 *     what lets a reader project a non-derogatory state's pointer off the
 *     extra_key the state ITSELF declares, rather than a hand-authored key
 *     pair that can silently drift from the state it names.
 *   - `EXPLICIT_TERMINAL_RESOLUTIONS` / `ExplicitTerminalResolution` — the
 *     hand-settable TERMINAL subset (`route === "issue-resolve"`), DERIVED from
 *     the reach table rather than re-listed: `fixed`/`closed` are structurally
 *     unreachable there.
 *   - `EXPLICIT_RESOLUTIONS` / `ExplicitResolution` /
 *     `reachOfExplicitResolution` / `ADOPTED_RESOLUTION_POINTER` — the WIDER
 *     hand-settable set `lore issue resolve --state` actually accepts:
 *     `EXPLICIT_TERMINAL_RESOLUTIONS` plus §M7's `adopted`, whose pointer
 *     (`--adopted-by`) additionally REQUIRES the resolved doc's type to be
 *     `plan` or `task` — the one pointer requirement with a type constraint,
 *     because an owner that cannot itself do work defeats the point of §M7.
 *   - `isDanglingAdoption` — §M7's dangling-claim predicate (AC-DC-16): given
 *     a report's COMPUTED resolution and its `adopted_by` owner's current
 *     status, is this an abandoned adoption? `commands/status.ts`'s
 *     `adopted_abandoned_count` field calls this once per filed report;
 *     store-free like every other export here.
 *   - `computeIssueResolution` — derives the resolution; see that function's
 *     own JSDoc for the full 7-step precedence (§M7 inserted `adopted` between
 *     resolves-edge computation and the review-rejection/`closed` fallback,
 *     rather than at the top with the other explicit states — a `resolves`
 *     edge landing later must be able to promote an `adopted` report to
 *     `fixed`/`resolving`).
 *   - `hasIssueReport` — defensive `extra.issue_report` presence predicate;
 *     the SAME guard `CorpusService.link`'s write-time validation (D1b) uses
 *     to reject a `resolves` edge whose target isn't an issue task.
 *
 * Invariants:
 *   - `TERMINAL_ISSUE_RESOLUTIONS` is the SSOT member set and every consumer
 *     IMPORTS it; it is DERIVED from `@lore/core`'s
 *     `TERMINAL_ISSUE_RESOLUTION_MEMBERS`, never re-listed here. Its further
 *     derived views (`EXPLICIT_TERMINAL_RESOLUTIONS`/`ExplicitTerminalResolution`,
 *     `EXPLICIT_RESOLUTIONS`/`ExplicitResolution`) are computed from it or from
 *     `TERMINAL_RESOLUTION_REACH`, never re-listed — see those symbols' own docs.
 *   - Precedence, highest first: explicit TERMINAL state (D3) > resolves-edge
 *     computation (`fixed`/`resolving`) > explicit `adopted` (§M7) > recorded
 *     review rejection (`rejected`) > archived doc status (`closed`) > `open`.
 *     A `resolves` edge landing on an already-terminal issue never overrides
 *     it, and ANY resolves edge (even one that computes `resolving`, not yet
 *     `fixed`) outranks `adopted`, the review-rejection signal, AND the
 *     archived-doc-status signal — a fix already in flight is more
 *     informative than any of them. There is no path in this module that
 *     returns `fixed` from an explicit write; `fixed` is reachable ONLY
 *     through a `resolves` edge whose source doc has reached
 *     `active`/`archived` (spec's "no hand-set fixed anywhere in the
 *     system").
 *   - `hasRecordedReviewRejection` exists because `ReviewService.reject`
 *     (SPEC-005) deliberately never transitions a doc OFF `draft` — the
 *     audit trail, not `doc.status`, is the sole record of a rejection, so a
 *     review-rejected report is indistinguishable from an untouched one by
 *     status alone. This module stays store-free, so it cannot query that
 *     audit trail itself; a caller with an audit read (D6/D7) does that
 *     lookup and passes the boolean result in — the now-deleted SQLite
 *     `UpstreamPort.getResolution` (P4, spec-the-defect-channel-reaches-no-
 *     machine-but-its-own-github) was one such caller;
 *     `commands/issues.ts`'s LOCAL branch is NOT (its own header names this
 *     as a residual gap). Without this, a review-rejected report would
 *     compute `open` (or `closed`, once archived) while still carrying a
 *     rejection reason — the exact self-contradicting row §20 F3/F4 forbid.
 *   - Both exported functions read `extra` defensively (the same null/array/
 *     typeof guard shape every defensive `extra.issue_report` reader in this
 *     codebase uses — `issue-report.ts`'s own module invariant documents why
 *     `extra.issue_report` stays untyped `extra` passthrough) — a malformed
 *     or legacy `extra` degrades to "no signal" rather than throwing.
 *
 * Side-effect class: pure.
 *
 * Source: spec-issue-closure-loop-computed-resolution-agent-reachable §D1, §D2.
 */

import {
  TERMINAL_ISSUE_RESOLUTION_MEMBERS,
  type DocStatus,
  type IssueResolution,
  type IssueStatus,
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
 * `issue-reports-routes.ts`) reads the vocabulary and the computation from ONE
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

/** How a terminal resolution is REACHED — the route `lore issue resolve` (or a `resolves` link, or an archive) uses to set it. */
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
 *
 * `allowed_doc_types` is OPTIONAL and, when present, narrows WHICH doc types the
 * resolved pointer target may have — checked by the CLI AFTER existence and
 * self-reference (§M3's `superseded`/`duplicate` pointers take no such
 * constraint, so it stays `undefined` for them; §M7's `adopted` REQUIRES a live
 * `plan` or `task`, because an adopt verb that accepted any doc would let a
 * caller free quota by "owning" the claim with, say, another issue report —
 * accountable to nothing).
 */
export interface TerminalResolutionPointer {
  readonly flag: string;
  readonly extra_key: string;
  readonly names: string;
  readonly allowed_doc_types?: readonly string[];
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
 * these states no longer needs triage eyes. Built from `@lore/core`'s single
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
 * §M7's `adopted` pointer reach — NOT part of {@link TERMINAL_RESOLUTION_REACH}
 * (that table's `satisfies Record<TerminalIssueResolution, …>` binding is what
 * gives AC-DC-9's "one construction site" its compile-time teeth, and `adopted`
 * is deliberately NOT terminal — see `issue-resolution-vocab.ts`). Declared here
 * as its own constant rather than folded into that table, so widening the
 * terminal record's key type is never required to add a non-terminal
 * explicit-writable state.
 *
 * `allowed_doc_types: ["plan", "task"]` is the part with no M3 precedent: a
 * `superseded`/`duplicate` pointer accepts ANY existing doc, but an `adopted`
 * pointer with no type constraint would let a caller free quota by pointing at,
 * say, another issue report — "owned" by nothing that can actually do work.
 */
export const ADOPTED_RESOLUTION_POINTER: TerminalResolutionPointer = {
  flag: "--adopted-by",
  extra_key: "adopted_by",
  names: "the plan or task that now owns this claim",
  allowed_doc_types: ["plan", "task"],
};

/**
 * Every EXPLICIT-WRITABLE resolution — {@link ExplicitTerminalResolution} plus
 * §M7's `adopted` — the states `lore issue resolve --state` may persist and
 * {@link readExplicitResolutionState} recognises inside a stored `extra`.
 *
 * A wider union than {@link ExplicitTerminalResolution} on purpose: `adopted` is
 * hand-settable (`route === "issue-resolve"`, same as `rejected`/`superseded`/
 * etc.) but is NOT terminal, so it cannot be derived from
 * {@link TERMINAL_RESOLUTION_REACH} the way the four terminal explicit states
 * are.
 */
export type ExplicitResolution = ExplicitTerminalResolution | "adopted";

/**
 * The SSOT explicit-writable member set as a membership set — every value
 * `lore issue resolve --state` accepts. Built by extending
 * {@link EXPLICIT_TERMINAL_RESOLUTIONS} with `adopted`, never by re-listing the
 * four terminal ones.
 *
 * @example
 *   EXPLICIT_RESOLUTIONS.has("adopted")    // => true
 *   EXPLICIT_RESOLUTIONS.has("duplicate")  // => true
 *   EXPLICIT_RESOLUTIONS.has("fixed")      // => false (computed only, never hand-set)
 */
export const EXPLICIT_RESOLUTIONS: ReadonlySet<ExplicitResolution> = new Set<ExplicitResolution>([
  ...EXPLICIT_TERMINAL_RESOLUTIONS,
  "adopted",
]);

/**
 * The reach facts for any explicit-writable resolution, terminal or `adopted` —
 * the union {@link reachOfTerminalResolution} does not cover. `lore issue
 * resolve`'s CLI wiring reads pointer requirements through THIS function, never
 * through `reachOfTerminalResolution` directly, so `adopted`'s reach never needs
 * a special-cased second call site.
 *
 * @param state - any explicit-writable resolution
 * @returns that state's route plus its required pointer (`null` when it takes none)
 * @example
 *   reachOfExplicitResolution("adopted").pointer?.flag        // => "--adopted-by"
 *   reachOfExplicitResolution("superseded").pointer?.flag     // => "--superseded-by"
 */
export function reachOfExplicitResolution(state: ExplicitResolution): TerminalResolutionReach {
  if (state === "adopted") {
    return { route: "issue-resolve", pointer: ADOPTED_RESOLUTION_POINTER };
  }
  return reachOfTerminalResolution(state);
}

/**
 * Everything {@link isDanglingAdoption} needs about ONE issue report's
 * `adopted` claim: its COMPUTED resolution (never the raw stored field —
 * see that predicate's own JSDoc for why) and its owner's CURRENT lifecycle
 * status, or `undefined` when the owner doc no longer resolves.
 */
export interface AdoptionAbandonmentCheckInput {
  readonly computedResolution: IssueResolution;
  readonly ownerStatus: DocStatus | undefined;
}

/**
 * §M7's dangling-claim predicate (spec-the-defect-channel-cannot-be-honestly-
 * maintained-an §M7, AC-DC-16) — a corpus-wide count is `lore status`'s
 * `adopted_abandoned_count` field's job (`commands/status.ts`'s
 * `collectAdoptedAbandonedMembers`, which calls this predicate per report);
 * this function is the ONE decidable-from-stored-fields judgment both that
 * enumerator and this AC's oracle exercise.
 *
 * TWO conjuncts, both decidable, NEITHER guessed:
 *   1. `computedResolution === "adopted"` — NOT the raw stored
 *      `resolution.state` field. `computeIssueResolution`'s own precedence
 *      already demotes a report to `fixed`/`resolving` the moment a
 *      `resolves` edge lands, EVEN IF the stored field still literally says
 *      `adopted` (nobody bothered re-resolving it) — so this conjunct alone
 *      subsumes BOTH "the stored state is adopted" AND "the report carries
 *      no terminal resolution" from the governing spec's three-conjunct
 *      prose: a report a real fix has since landed on computes something
 *      other than `adopted` and is correctly excluded here.
 *   2. `ownerStatus` is `"archived"` or `"deprecated"` — the owner doc
 *      reached a terminal lifecycle status. A LIVE owner (any other status,
 *      including one this function has never heard of) excludes the report:
 *      the claim is still being worked, not abandoned. `undefined` (the
 *      owner doc no longer resolves — deleted) ALSO excludes it: this
 *      predicate asserts "archived without a fix", never "vanished".
 *
 * ⛔ "the defect was not actually fixed" is deliberately NOT a third
 * conjunct — no stored field records that, and guessing would make this
 * predicate a judgment call rather than a fact.
 *
 * @example
 *   isDanglingAdoption({computedResolution: "adopted", ownerStatus: "archived"})   // => true
 *   isDanglingAdoption({computedResolution: "adopted", ownerStatus: "deprecated"}) // => true
 *   isDanglingAdoption({computedResolution: "adopted", ownerStatus: "draft"})      // => false (live owner)
 *   isDanglingAdoption({computedResolution: "adopted", ownerStatus: undefined})    // => false (owner vanished, not abandoned)
 *   isDanglingAdoption({computedResolution: "fixed", ownerStatus: "archived"})     // => false (a real fix landed — conjunct 1 fails)
 */
export function isDanglingAdoption(input: AdoptionAbandonmentCheckInput): boolean {
  if (input.computedResolution !== "adopted") {
    return false;
  }
  return input.ownerStatus === "archived" || input.ownerStatus === "deprecated";
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
 * Defensive reader for an explicit resolution
 * (`extra.issue_report.resolution.state`), written only by the downstream
 * `lore issue resolve --state <explicit resolution>` verb (D3 +
 * spec-the-defect-channel-cannot-be-honestly-maintained-an §M3/§M7, out of this
 * module's scope — this reader just consumes the shape that verb writes).
 *
 * Recognised values come from {@link EXPLICIT_RESOLUTIONS}, never a local list:
 * when §M3 added `superseded`/`duplicate` (and §M7 later added `adopted`), the
 * set widened here automatically, and a hand-written comparison chain would
 * have kept computing `open` for a report that WAS explicitly resolved — the
 * exact class of silent under-reporting §M1's cap defect was made of.
 *
 * ⛔ Returning `adopted` here does NOT mean {@link computeIssueResolution}
 * returns it unconditionally — `adopted`'s precedence sits BELOW resolves-edge
 * computation (a fix actually landing outranks an adoption placeholder), unlike
 * the four terminal explicit states, which win over everything. See that
 * function's own precedence list.
 *
 * @param extra - the issue task's raw `extra` field
 * @returns the recorded {@link ExplicitResolution} when present and
 *   well-shaped; `undefined` otherwise (absent, malformed, a computed-only
 *   state someone hand-wrote, or any other value)
 */
function readExplicitResolutionState(extra: unknown): ExplicitResolution | undefined {
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
  return (EXPLICIT_RESOLUTIONS as ReadonlySet<string>).has(state) ? (state as ExplicitResolution) : undefined;
}

/**
 * D2 — pure computed-resolution derivation. Never mutates, never reads a
 * clock or a store; the caller supplies every doc up front.
 *
 * Precedence (highest first):
 *   1. An explicit TERMINAL state at `extra.issue_report.resolution.state`
 *      (any member of {@link EXPLICIT_TERMINAL_RESOLUTIONS}, i.e.
 *      `rejected`/`wontfix`/`superseded`/`duplicate`) — wins over everything
 *      below, INCLUDING a resolves-edge. A hand-recorded terminal verdict is
 *      final by construction; nothing computed can override it.
 *   2. `fixed` — at least one `resolvesInEdges` entry whose joined
 *      `sourceDocs` status is `active` or `archived`.
 *   3. `resolving` — at least one `resolvesInEdges` entry exists, but no
 *      joined source doc is terminal. (2) and (3) together mean ANY
 *      `resolvesInEdges` entry outranks everything below, INCLUDING an
 *      explicit `adopted` state (§M7) — a fix already in flight, even one not
 *      yet landed, is more informative than an adoption placeholder or either
 *      of the fallback signals in (5)/(6). This is WHY `adopted` sits below
 *      resolves-edge computation rather than above it like the terminal
 *      states in (1): a `resolves` edge added to a report that was
 *      `adopted` earlier must be able to promote it to `fixed`/`resolving`
 *      without anyone re-running `lore issue resolve` (AC-DC-16's dangling-
 *      claim census depends on exactly this — a report cannot be BOTH
 *      genuinely fixed and counted as an abandoned adoption).
 *   4. `adopted` — an explicit `adopted` state (§M7) at
 *      `extra.issue_report.resolution.state`, and no `resolvesInEdges` entry
 *      exists. Non-terminal: does NOT join {@link TERMINAL_ISSUE_RESOLUTIONS},
 *      so `--resolved`'s complement keeps showing it as unfinished.
 *   5. `rejected` — no `resolvesInEdges` entry, no explicit `adopted` state,
 *      and `hasRecordedReviewRejection` is `true` (a `ReviewService.reject`
 *      audit entry exists for this doc; SPEC-005 never moves the doc's own
 *      status off `draft`, so this boolean is the ONLY signal for this case —
 *      see this module's header).
 *   6. `closed` — no `resolvesInEdges` entry, no explicit `adopted` state, no
 *      recorded review rejection, and `issue.status === "archived"`.
 *   7. `open` — none of the above.
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
 *   module — the now-deleted SQLite `UpstreamPort.getResolution` was one such
 *   caller). Defaults to `false` so every pre-existing caller that predates
 *   this parameter keeps compiling and behaving unchanged.
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
 *   computeIssueResolution(
 *     {extra: {issue_report: {resolution: {state: "adopted", adopted_by: "task-x"}}}},
 *     [],
 *     [],
 *   ) // => "adopted" (no resolves edge yet)
 *   computeIssueResolution(
 *     {extra: {issue_report: {resolution: {state: "adopted", adopted_by: "task-x"}}}},
 *     [{from_id: "spec-1"}],
 *     [{id: "spec-1", status: "archived"}],
 *   ) // => "fixed" (a fix actually landed — outranks the adoption placeholder)
 */
export function computeIssueResolution(
  issue: IssueTaskLike,
  resolvesInEdges: ReadonlyArray<ResolvesInEdgeLike>,
  sourceDocs: ReadonlyArray<ResolutionSourceDocLike>,
  hasRecordedReviewRejection = false,
): IssueResolution {
  const explicitState = readExplicitResolutionState(issue.extra);

  // Rule 1 — an explicit TERMINAL state wins over everything, including a
  // resolves-edge. `adopted` is deliberately excluded from this early return:
  // it falls through to rule 2 so a later resolves-edge can still promote it.
  if (explicitState !== undefined && explicitState !== "adopted") {
    return explicitState;
  }

  // Rule 2/3 — ANY resolves-edge outranks `adopted` (rule 4) and the
  // fallback signals below it (rules 5/6): a fix in flight is more
  // informative than an adoption placeholder.
  if (resolvesInEdges.length > 0) {
    const statusBySourceId = new Map(sourceDocs.map((doc) => [doc.id, doc.status]));
    const hasTerminalSource = resolvesInEdges.some((edge) => {
      const status = statusBySourceId.get(edge.from_id);
      return status === "active" || status === "archived";
    });
    return hasTerminalSource ? "fixed" : "resolving";
  }

  // Rule 4 — the explicit `adopted` placeholder, no fix in flight.
  if (explicitState === "adopted") {
    return "adopted";
  }

  if (hasRecordedReviewRejection) {
    return "rejected";
  }
  if (issue.status === "archived") {
    return "closed";
  }
  return "open";
}

// ─── deriveIssueStatus: the displayed status (GitHub state x carriers) ──────
//
// ⛔ The corpus stores no issue status. This is the ONE function that turns a live
// GitHub listing row plus the carriers (tasks/plans naming it in `extra.issues`)
// into the status shown by `lore issues`, the dashboard, MCP and HTTP. It replaces
// `computeIssueResolution` for every consumer migrated to the carrier model
// (the legacy function above stays only until its last consumer is migrated).
// Source: adr-github-owns-issue-report-state-the-corpus-owns-only-the (status table),
//   spec-github-owns-issue-report-state-no-mirror-task-work-carries D4, AC-GS-3.

/** The GitHub facts of one listed issue that status derivation reads. */
export interface ListedIssue {
  /** `open` | `closed` (GitHub's native state). */
  readonly state: string;
  /** GitHub's `state_reason`; `null`/`undefined` when GitHub gives none. */
  readonly state_reason?: string | null | undefined;
  /** Label names on the issue. */
  readonly labels?: readonly string[] | undefined;
}

/** What one carrier (a task or plan naming the issue in `extra.issues`) contributes. */
export interface CarrierFact {
  readonly type: "task" | "plan";
  /** The carrier doc's lifecycle status. */
  readonly status: DocStatus;
  /** True when the carrier is invalidated (`isInvalidated`) at the read instant. */
  readonly invalidated: boolean;
  /** True when a task carrier holds an open claim; always false for plans. */
  readonly hasOpenClaim: boolean;
}

/** Label prefix of the verdict labels maintainers write. */
const RESOLUTION_LABEL_PREFIX = "resolution:";

/**
 * Verdicts a `not_planned` close can carry as a label. Derived from the hand-settable
 * terminal set minus `duplicate` (which has its own state_reason), so no second list of
 * the tokens exists here.
 */
const NOT_PLANNED_VERDICTS: readonly ExplicitTerminalResolution[] = [...EXPLICIT_TERMINAL_RESOLUTIONS].filter(
  (state) => state !== "duplicate",
);

const isDeadCarrier = (c: CarrierFact): boolean => c.invalidated || c.status === "deprecated";

/**
 * The displayed status of one listed issue; total over GitHub state x carriers.
 *
 * Precedence (ADR status table):
 *   - OPEN issue: labels are ignored (a stray verdict label never rejects an open issue).
 *     An archived carrier wins (`fixed (close pending)`), then a live carrier
 *     (`resolving` when a task carrier holds a claim, else `adopted`), then carriers that
 *     are all dead (`adopted (abandoned)`), else `open`.
 *   - CLOSED issue: the verdict wins over carriers. `duplicate` (state_reason or label),
 *     then a `not_planned` close with a verdict label (that verdict) or without
 *     (`closed (no verdict)`); otherwise it was closed as completed: `fixed` ONLY when an
 *     archived carrier exists, else `closed (unverified)`.
 *   - ⛔ `fixed` is never read from the `resolution:fixed` label or from state_reason
 *     alone: it is a joined fact.
 *   - A closed issue with no `state_reason` is read as completed (GitHub's close default).
 *
 * @example
 *   deriveIssueStatus({ state: "open" }, [])                                  // => "open"
 *   deriveIssueStatus({ state: "closed", state_reason: "completed" }, [])    // => "closed (unverified)"
 */
export function deriveIssueStatus(issue: ListedIssue, carriers: readonly CarrierFact[]): IssueStatus {
  const alive = carriers.filter((c) => !isDeadCarrier(c));
  const archived = alive.some((c) => c.status === "archived");

  if (issue.state !== "closed") {
    if (archived) return "fixed (close pending)";
    const live = alive.filter((c) => c.status !== "archived");
    if (live.length > 0) return live.some((c) => c.type === "task" && c.hasOpenClaim) ? "resolving" : "adopted";
    return carriers.length > 0 ? "adopted (abandoned)" : "open";
  }

  const labels = new Set(issue.labels ?? []);
  const labelled = (verdict: string): boolean => labels.has(`${RESOLUTION_LABEL_PREFIX}${verdict}`);
  if (issue.state_reason === "duplicate" || labelled("duplicate")) return "duplicate";
  if (issue.state_reason === "not_planned") {
    const verdict = NOT_PLANNED_VERDICTS.find(labelled);
    return verdict ?? "closed (no verdict)";
  }
  return archived ? "fixed" : "closed (unverified)";
}
