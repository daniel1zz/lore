/**
 * The issue-resolution VOCABULARY — the one and only construction site of the
 * `IssueResolution` member tokens anywhere under `packages/**`.
 *
 * Public surface:
 *   - `NON_TERMINAL_ISSUE_RESOLUTION_MEMBERS` / `NonTerminalIssueResolution` —
 *     the two states in which a filed report still needs triage eyes.
 *   - `TERMINAL_ISSUE_RESOLUTION_MEMBERS` / `TerminalIssueResolution` — the six
 *     states in which it does not (and, per
 *     spec-the-defect-channel-cannot-be-honestly-maintained-an §M1, no longer
 *     occupies open-report cap quota).
 *   - `ISSUE_RESOLUTION_MEMBERS` / `IssueResolution` — the whole 8-state
 *     vocabulary, DERIVED by spreading the two halves above.
 *
 * Invariants:
 *   - ⛔ VOCABULARY ONLY: types and frozen const arrays. No logic, no reach
 *     table, no derivation from stored `extra`. Everything that COMPUTES a
 *     resolution, and the route/pointer table that says how each terminal state
 *     is reached, lives in `packages/lore/src/service/issue-resolution.ts` —
 *     which imports this module and re-exports these names, so its consumers
 *     (`commands/issues.ts`, `commands/issue.ts`, `commands/status.ts`,
 *     `issue-report-service.ts`, `issue-reports-routes.ts`,
 *     `upstream-context-flow.ts`, `corpus-service.ts`) keep one import site.
 *   - ⛔ ZERO imports, by design. This module sits in the browser-safe
 *     `@lore/core` barrel (`index.ts`), whose transitive closure must never
 *     top-level-import a Node builtin: Vite's dev-mode `fs` stub throws on
 *     named-export access at module-LOAD time and blanks the `@lore/dashboard`
 *     SPA before React mounts. An import-free file cannot ever regress that.
 *     Static oracle: `packages/lore/tests/unit/core/barrel-isolation.test.ts`;
 *     runtime oracle: the dashboard Playwright suite.
 *   - ⛔ EXACTLY ONE array literal in this file names the terminal tokens
 *     (`TERMINAL_ISSUE_RESOLUTION_MEMBERS`). A repo-wide scan over
 *     `packages/**` asserts that no second set/array literal anywhere
 *     co-constructs them (`packages/lore/tests/unit/service/
 *     terminal-resolution-ssot.test.ts`, AC-DC-9) — which is why
 *     `ISSUE_RESOLUTION_MEMBERS` below is assembled by SPREADING the two halves
 *     instead of re-listing all eight tokens, and why `IssueResolution` is a
 *     union of the two derived types rather than a hand-written 8-arm union.
 *
 * Why this vocabulary lives in `@lore/core` rather than beside the computation
 * it feeds: `packages/dashboard/src/**` may import `@lore/core` ONLY (never
 * `@lore/core/node`, never `packages/lore/src/**` — `packages/dashboard/
 * CLAUDE.md`). While the union lived in the server-only service tree, the
 * dashboard's SHIPPED bundle had nowhere browser-safe to import it from and
 * carried a hand-written mirror in `src/lib/api.ts`. Measured 2026-08-11, that
 * mirror silently lagged the server union by THREE members while
 * `bun run typecheck` exited 0, and `resolutionBadgeVariant`'s switch — being
 * exhaustive over the WRONG union — returned `undefined`, which CVA's
 * `defaultVariants` painted as `fixed` styling: a non-derogatory `superseded`
 * report rendered as a success. Relocating the vocabulary here is what makes
 * those switches exhaustive over the REAL union, so the same drift now fails to
 * compile inside `packages/dashboard/src/**` itself instead of being caught (or
 * missed) by a test-tree assertion.
 *
 * Side-effect class: pure.
 *
 * Source: spec-the-defect-channel-cannot-be-honestly-maintained-an §M1 (one
 *   terminal-resolution SSOT) and §M3 (the two non-derogatory terminal states);
 *   spec-issue-closure-loop-computed-resolution-agent-reachable §D2 (what each
 *   state MEANS and how it is reached — that spec's mechanism lives in the
 *   service module, not here).
 */

/**
 * The states in which a filed issue report still needs triage eyes: `open` (no
 * signal yet) and `resolving` (a `resolves` edge exists but its source doc has
 * not reached a terminal lifecycle status).
 *
 * Enumerable at runtime — not merely a type — so every consumer that must
 * iterate the WHOLE vocabulary (a badge mapper, a filter, a parity oracle) reads
 * it from here. A previous arrangement expressed these two only inside a type
 * union, which forced a dashboard test to re-list them by hand as a third
 * mirror.
 *
 * @example
 *   NON_TERMINAL_ISSUE_RESOLUTION_MEMBERS.includes("open") // => true
 */
export const NON_TERMINAL_ISSUE_RESOLUTION_MEMBERS = ["open", "resolving"] as const;

/** A resolution in which the report still needs triage eyes. */
export type NonTerminalIssueResolution = (typeof NON_TERMINAL_ISSUE_RESOLUTION_MEMBERS)[number];

/**
 * ⛔ THE one construction site of the terminal-issue-resolution member set
 * (spec-the-defect-channel-cannot-be-honestly-maintained-an §M1, AC-DC-9). Every
 * consumer — the `lore issues` listing filter, `IssueReportService`'s cap
 * narrowing, `lore issue resolve --state`'s validator, the cap refusal's
 * `quota_freeing_states`, the dashboard's two badge switches — derives from THIS
 * array or from a view built out of it.
 *
 * ⛔ Adding a member here is a three-line change with two compile-time
 * obligations, both of which fail LOUD rather than defaulting: the service's
 * `TERMINAL_RESOLUTION_REACH` is `satisfies Record<TerminalIssueResolution, …>`
 * (so a new state with no declared route/pointer does not compile), and the
 * dashboard's `resolutionBadgeVariant` switches are `never`-checked with no
 * `default:` (so a new state with no declared badge tone does not compile
 * either). ⛔ Do NOT re-list these tokens in a second set or array anywhere
 * under `packages/**` — a repo-wide scan asserts this is the only such literal
 * (`packages/lore/tests/unit/service/terminal-resolution-ssot.test.ts`). The two
 * copies that existed before this SSOT drifted in exactly the way that made a
 * resolved report keep occupying cap quota.
 *
 * Order is HAND-SETTABLE FIRST (`route === "issue-resolve"`, per the service's
 * reach table), then the two computed-only states: it is the order the
 * `--state` help text and the cap refusal's remedy table render in, and the
 * actionable verbs belong at the top of a refusal a caller is reading to get
 * unblocked.
 *
 * @example
 *   TERMINAL_ISSUE_RESOLUTION_MEMBERS.includes("superseded") // => true
 *   TERMINAL_ISSUE_RESOLUTION_MEMBERS.includes("resolving")  // => false
 */
export const TERMINAL_ISSUE_RESOLUTION_MEMBERS = [
  "rejected",
  "wontfix",
  "superseded",
  "duplicate",
  "fixed",
  "closed",
] as const;

/** A terminal resolution — a state in which a report no longer needs triage eyes and no longer occupies cap quota. */
export type TerminalIssueResolution = (typeof TERMINAL_ISSUE_RESOLUTION_MEMBERS)[number];

/**
 * Every computed resolution state a filed issue report can be in: the two
 * non-terminal states plus every member of
 * {@link TERMINAL_ISSUE_RESOLUTION_MEMBERS}.
 *
 * Declared as a union of the two DERIVED half-types rather than as a
 * hand-written 8-arm union, so it cannot disagree with the two member arrays —
 * and so this file still contains exactly one array literal naming the terminal
 * tokens (AC-DC-9's repo-wide uniqueness scan).
 *
 * What each state means and how it is REACHED is the service module's contract,
 * not this one's: `rejected`/`wontfix`/`superseded`/`duplicate` are explicitly
 * written by `lore issue resolve --state` (or, for `rejected` only, implied by a
 * recorded review-workflow rejection); `fixed` is reachable ONLY via a `resolves`
 * edge to a terminal source doc and is never hand-set; `closed` is the issue
 * task's own doc status reaching `archived` with no traceable fix source. See
 * `computeIssueResolution` in `packages/lore/src/service/issue-resolution.ts`.
 */
export type IssueResolution = NonTerminalIssueResolution | TerminalIssueResolution;

/**
 * The WHOLE vocabulary as an ordered, enumerable list — non-terminal states
 * first, then the terminal ones in their hand-settable-first order.
 *
 * ⛔ Assembled by SPREADING the two member arrays, never by re-listing tokens: a
 * literal here would be a second construction site of the terminal set (AC-DC-9)
 * and could silently drift from the union. Consumed by the dashboard as
 * `ISSUE_RESOLUTIONS` (`packages/dashboard/src/lib/api.ts` re-exports this exact
 * array — reference-identical, never a copy).
 *
 * @example
 *   ISSUE_RESOLUTION_MEMBERS.length // => 8
 *   ISSUE_RESOLUTION_MEMBERS[0]     // => "open"
 */
export const ISSUE_RESOLUTION_MEMBERS = [
  ...NON_TERMINAL_ISSUE_RESOLUTION_MEMBERS,
  ...TERMINAL_ISSUE_RESOLUTION_MEMBERS,
] as const satisfies readonly IssueResolution[];
