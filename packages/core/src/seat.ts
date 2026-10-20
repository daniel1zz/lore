/**
 * Two-tier worktree seat model — pure predicates + naming (SPEC-057 §Public
 * Interface). Pure, browser-safe module: no IO, no `Date.now()`/`Math.random()`
 * calls, no git access. `SeatService` (`packages/lore/src/service/seat-service.ts`)
 * is the ONLY caller that touches git; everything a decision depends on is
 * computed here from plain data the caller already resolved.
 *
 * Public surface:
 *   - sanitizeBranchSegment(input) — lowercase + collapse-to-kebab sanitizer,
 *     the cross-language SSOT half shared with `assets/hooks/session-start-resume.mjs`'s
 *     hand-maintained twin regex (golden-fixture parity, AC-S-5).
 *   - seatBranchName(planSlug) / parseSeatBranch(branch) — naming round-trip
 *     for a seat's git branch (`plan/<sanitized-slug>`).
 *   - classifySessionLocation(facts) — 4-class equivalence-class table over
 *     already-resolved git facts (main / seat / task_under_seat / detached).
 *   - assertSeatEntryReady(report) — pure entry predicate over a narrow
 *     `ReadyReport`-shaped projection (anchor_conflicts only).
 *   - deriveResumeHint(handoffs, seatPlanId?) — seat-scoped or corpus-global
 *     newest-handoff pointer, symmetric to `deriveSessions` (session.ts).
 *
 * Invariants:
 *   - `GitFacts.parentSeatBranch` is a FACT the CALLER (hook/CLI git-plumbing)
 *     has already resolved via git ancestry — this module never derives it,
 *     never shells out, never walks a worktree tree itself.
 *   - `classifySessionLocation` is a total function over the 2×2×(resolved|not)
 *     fact space — every legal `GitFacts` combination maps to exactly one of
 *     the four classes; there is no "unclassified" escape hatch.
 *   - `assertSeatEntryReady`/`deriveResumeHint` never read a wall clock and
 *     never throw — same D10 time-seam / no-silent-fallback discipline as
 *     `session.ts::deriveSessions` and `task-workflow.ts::evaluateReadiness`.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-057 §Module Boundary, §Public Interface, §Design Decisions D1/D3/D5.
 */

import { err, ok } from "./errors.js";
import type { LoreError, Result } from "./errors.js";

// ─── Branch naming (AC-S-1, AC-S-5) ────────────────────────────────────────

const SEAT_BRANCH_PREFIX = "plan/";

/**
 * Lowercases `input`, collapses every run of characters outside `[a-z0-9-]`
 * to a single `-`, then strips leading/trailing `-`. This is the TS half of
 * a deliberately-duplicated cross-language sanitizer pair (SPEC-057 §Structure)
 * — the hook's inline `.mjs` regex chain
 * (`assets/hooks/session-start-resume.mjs`, actor-slug derivation) is the
 * other, hand-maintained twin. Both are pinned against the SAME golden
 * fixture (`packages/lore/tests/fixtures/seat-branch-sanitize.golden.json`)
 * so divergence between the two copies breaks a test, not production.
 *
 * @param input - Raw branch-segment candidate (a plan title, slug, or branch name).
 * @returns The sanitized kebab segment; may be `""` for an input with no
 *   `[a-z0-9-]` characters at all (BOUNDARY — callers composing a branch name
 *   from this must treat an empty result as their own validation concern;
 *   this function itself never throws).
 * @example
 * sanitizeBranchSegment("Feature_ABC"); // => "feature-abc"
 * @example
 * sanitizeBranchSegment("release/2.0.1"); // => "release-2-0-1"
 */
export function sanitizeBranchSegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Builds a seat's git branch name from a plan slug: `plan/<sanitized-slug>`.
 * Does NOT strip a caller-supplied `plan-` prefix — `planSlug` is composed
 * verbatim (through {@link sanitizeBranchSegment}) into the branch, so a
 * caller wanting a shorter branch (e.g. dropping a doc slug's own `plan-`
 * type prefix) must do that stripping itself before calling this function
 * (see `SeatService`'s private `deriveShortPlanSlug` helper).
 *
 * @param planSlug - The (unsanitized) plan identifier to embed in the branch.
 * @returns `plan/<sanitizeBranchSegment(planSlug)>`.
 * @example
 * seatBranchName("plan-session-layer"); // => "plan/plan-session-layer"
 * @example
 * seatBranchName("Plan_Session/Layer"); // => "plan/plan-session-layer"
 */
export function seatBranchName(planSlug: string): string {
  return `${SEAT_BRANCH_PREFIX}${sanitizeBranchSegment(planSlug)}`;
}

/**
 * Recovers the plan-slug remainder from a well-formed seat branch, or `null`
 * when `branch` is not a seat branch (no `plan/` prefix, or an empty
 * remainder after it — `"plan/"` itself is degenerate, never a valid seat).
 *
 * @param branch - Candidate branch name.
 * @returns The slug remainder after `plan/`, or `null`.
 * @example
 * parseSeatBranch("plan/plan-session-layer"); // => "plan-session-layer"
 * @example
 * parseSeatBranch("feat/x_y"); // => null
 * @example
 * parseSeatBranch("plan/"); // => null — degenerate, empty remainder
 */
export function parseSeatBranch(branch: string): string | null {
  if (!branch.startsWith(SEAT_BRANCH_PREFIX)) return null;
  const rest = branch.slice(SEAT_BRANCH_PREFIX.length);
  return rest.length > 0 ? rest : null;
}

// ─── Session location classification (AC-S-1, 4-class table) ──────────────

/**
 * Git facts `classifySessionLocation` classifies. `parentSeatBranch` is a
 * fact the CALLER (hook/CLI git-plumbing) has already resolved via git
 * ancestry walking — this module never derives it itself (module @invariant).
 */
export interface GitFacts {
  /** Current branch name, or `null` when HEAD is detached. */
  branch: string | null;
  /** `true` iff the session is running inside a linked (non-main) git worktree. */
  isLinkedWorktree: boolean;
  /**
   * The seat branch this worktree was created UNDER, when resolvable via git
   * ancestry (a task/subagent worktree nested under a seat worktree). `null`
   * when not linked, not nested, or the ancestry couldn't be resolved.
   */
  parentSeatBranch: string | null;
}

/** The four session-location equivalence classes (SPEC-057 §Public Interface). */
export type SessionLocationClass = "main" | "seat" | "task_under_seat" | "detached";

/**
 * Classifies a session's location from already-resolved {@link GitFacts} —
 * total over the fact space, four classes:
 *   - `"main"` — not a linked worktree at all (the main checkout), regardless
 *     of which branch is checked out there.
 *   - `"detached"` — a linked worktree in detached HEAD (`branch: null`).
 *     Wins over a resolved `parentSeatBranch` (detached takes precedence —
 *     an unresolvable current branch means the session cannot be confidently
 *     placed in any seat lineage, whatever ancestry the caller separately found).
 *   - `"seat"` — a linked worktree whose OWN branch is itself a seat branch.
 *   - `"task_under_seat"` — a linked worktree with a resolvable branch that is
 *     NOT itself a seat branch, but was created under a resolved parent seat.
 *
 * A linked worktree with a resolvable non-seat branch AND an unresolved
 * `parentSeatBranch` also classifies as `"detached"` — the caller could not
 * establish seat lineage, so the session's scope narrows the SAME way an
 * actually-detached HEAD does (both routes ultimately feed
 * {@link deriveResumeHint}'s corpus-global + `seat_unresolved` fallback at
 * the call site; there is no fifth, "unknown lineage" class to invent).
 *
 * @param facts - Already-resolved git facts (see {@link GitFacts}).
 * @returns One of the four {@link SessionLocationClass} values.
 * @example
 * classifySessionLocation({ branch: "main", isLinkedWorktree: false, parentSeatBranch: null }); // => "main"
 * @example
 * classifySessionLocation({ branch: "plan/plan-a", isLinkedWorktree: true, parentSeatBranch: null }); // => "seat"
 * @example
 * classifySessionLocation({ branch: "worktree-agent-x", isLinkedWorktree: true, parentSeatBranch: "plan/plan-a" }); // => "task_under_seat"
 * @example
 * classifySessionLocation({ branch: null, isLinkedWorktree: true, parentSeatBranch: "plan/plan-a" }); // => "detached" — detached wins
 */
export function classifySessionLocation(facts: GitFacts): SessionLocationClass {
  if (!facts.isLinkedWorktree) return "main";
  if (facts.branch === null) return "detached";
  if (parseSeatBranch(facts.branch) !== null) return "seat";
  if (facts.parentSeatBranch !== null) return "task_under_seat";
  return "detached";
}

// ─── Seat entry predicate (AC-S-1) ─────────────────────────────────────────

/**
 * Narrow projection of `ReadyReport`
 * (`packages/lore/src/service/task-workflow-service.ts`) — only the field
 * {@link assertSeatEntryReady} reads. Declared locally rather than imported
 * because `@lore/core` must never depend on `packages/lore/src/**` (AC-MR-B1);
 * the real predicate accepts anything structurally compatible with this shape.
 */
export interface SeatReadyReportLike {
  anchor_conflicts: Array<{ task_slug: string; holder: string; paths: string[] }>;
}

/**
 * Pure entry predicate for `SeatService.enter` (D5 — ALL entry decisions live
 * in pure predicates, `SeatService` itself is thin orchestration only,
 * GateEnforcer precedent). A plan with zero open anchor conflicts is ready to
 * enter; any open conflict blocks entry, naming every conflicting
 * task/holder/path pair in the error so a caller can act on it without a
 * second lookup.
 *
 * @param report - The plan-scoped readiness projection (see {@link SeatReadyReportLike}).
 * @returns `ok(undefined)` when ready; `err(VALIDATION_ERROR)` naming every
 *   conflict otherwise.
 * @example
 * assertSeatEntryReady({ anchor_conflicts: [] }); // => { ok: true, value: undefined }
 * @example
 * assertSeatEntryReady({
 *   anchor_conflicts: [{ task_slug: "task-a", holder: "agent:other", paths: ["src/a.ts"] }],
 * }); // => { ok: false, error: { code: "VALIDATION_ERROR", ... } }
 */
export function assertSeatEntryReady(report: SeatReadyReportLike): Result<void, LoreError> {
  if (report.anchor_conflicts.length === 0) return ok(undefined);

  const detail = report.anchor_conflicts
    .map((c) => `${c.task_slug} held by ${c.holder} (${c.paths.join(", ")})`)
    .join("; ");

  return err({
    code: "VALIDATION_ERROR",
    field: "gate:seat-entry:anchor-conflict",
    message: `Seat entry blocked: open anchor conflict(s) — ${detail}`,
    value: report.anchor_conflicts,
    rule: "BR-369",
  });
}

// ─── Resume hint derivation (AC-S-1) ───────────────────────────────────────

/**
 * Pointer to one handoff {@link deriveResumeHint} scans — the fields it
 * actually reads (a narrower projection of `bootstrapLatestHandoffSchema`,
 * `session.ts`).
 */
export interface HandoffPointer {
  handoff_slug: string;
  plan_id: string | null;
  plan_slug: string | null;
  /** ISO-8601 timestamp — comparable lexicographically, same convention every other timestamp field in this codebase uses. */
  at: string;
}

/** The resume pointer {@link deriveResumeHint} returns — mirrors `bootstrapResumeHintSchema` (`session.ts`). */
export interface ResumeHint {
  plan_slug: string | null;
  handoff_slug: string;
}

/**
 * Derives the resume pointer a fresh session should surface — seat-scoped
 * when `seatPlanId` is given, corpus-global otherwise (D3, symmetric to
 * `deriveSessions`'s pure-computation shape). Pure: no wall-clock reads, no
 * IO; `handoffs` is caller-supplied in whatever order, this function does
 * its own newest-by-`at` scan.
 *
 * @param handoffs - Candidate handoff pointers.
 * @param seatPlanId - When given, scopes the scan to handoffs whose
 *   `plan_id` matches — a plan with NO matching handoff returns `null` (a
 *   fact; there is deliberately no silent corpus-global fallback). When
 *   omitted, scans every handoff (corpus-global — byte-identical to the
 *   pre-seat, non-scoped derivation).
 * @returns The newest matching handoff's pointer, or `null` when the
 *   candidate set (after scoping) is empty.
 * @example
 * deriveResumeHint(handoffs, "plan-a-id"); // => newest handoff for plan-a-id only
 * @example
 * deriveResumeHint(handoffs); // => newest handoff across every plan
 * @example
 * deriveResumeHint(handoffs, "plan-with-no-handoffs"); // => null
 */
export function deriveResumeHint(
  handoffs: HandoffPointer[],
  seatPlanId?: string,
): ResumeHint | null {
  const candidates =
    seatPlanId !== undefined ? handoffs.filter((h) => h.plan_id === seatPlanId) : handoffs;

  if (candidates.length === 0) return null;

  let newest = candidates[0]!;
  for (const candidate of candidates) {
    if (candidate.at > newest.at) newest = candidate;
  }

  return { plan_slug: newest.plan_slug, handoff_slug: newest.handoff_slug };
}
