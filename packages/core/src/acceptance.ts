/**
 * Structured acceptance criteria — AC-as-code schema + oracle binding.
 * Pure, browser-safe module: no IO, no Date.now()/Math.random() calls.
 *
 * Public surface:
 *   - AC_VERIFY_MODES / AcVerifyMode — the three verify-union discriminants
 *   - SCRIPT_ORACLES / ScriptOracle — oracle kinds usable when verify.mode === "script"
 *   - acceptanceCriterionSchema / AcceptanceCriterion — one AC declaration (script mode
 *     carries an optional `timeout_ms`, consumed by `lore verify`'s spawn executor —
 *     SPEC-039 §2 D9)
 *   - specAcceptanceCriteriaSchema — spec.extra.acceptance_criteria array (max 50, unique id)
 *   - computeAcCoverage(criteria, tasks) — pure pass/fail/falsified(+attested) aggregation
 *     over tasks' evidence (single-pass over tasks/evidence — SPEC-070 AC-070-17, review
 *     finding F10: evidence is extracted+bucketed by ac_ref ONCE, not re-walked once
 *     per criterion; `falsified` is the fourth coverage dimension added by
 *     spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1, computed in
 *     the SAME pass, no second traversal)
 *   - AcCoverageFact / EvidenceRefLite — computeAcCoverage's output row shapes
 *   - deriveAcCoverageState(fact) — the ONE fail-first coverage-precedence derivation
 *     (SPEC-070 AC-070-12, review finding F3) every rendering consumer shares. Widened
 *     to SEVEN states by spec-oracle-tier-falsifiability-a-criterion-never-observed-red
 *     M1 (`pass_unfalsified`, between `attested_pass` and `pass`, so an attested pass
 *     never degrades), M4 (`fail_superseded` — a `fail` whose only red evidence is
 *     strictly older than a runner-attested pass, by `recorded_at`), and M5
 *     (`not_measured` — a pass-only fact whose `falsified` fails runtime well-
 *     formedness, closing M1's fail-open on an absent/malformed count). See this
 *     function's own JSDoc for the complete seven-row table.
 *   - isAcInDeclaredScope(declaredScope, acId) — the ONE declared-`ac_scope`
 *     membership predicate (adr-lore-verify-s-attested-evidence-scope-belongs-to-the-task
 *     §Public Interface), consumed by `lore verify`'s selection + refusals
 *   - resolveGoverningSpecByAcScope(declaredAcScope, candidateSpecs, subjectLabel) —
 *     the ONE governing-spec search for a doc with no structural plan/spec link
 *     (an `--adhoc` task, SPEC-069 D2) — finds the single spec whose declared
 *     acceptance_criteria fully covers declaredAcScope, refusing loud on zero or
 *     multiple matches. Shared by `VerifyRunnerService.verifyAdhocTask` and
 *     `CorpusService.resolveDeclaredAcIdsForAdhocTask` so the two surfaces can
 *     never disagree about which spec governs a given ad-hoc task.
 *
 * Invariants:
 *   - `id` format is `^AC-[A-Z0-9]+(-[A-Z0-9]+)*$` — matches every corpus-observed
 *     format (AC-33-1, AC-ASSESS-10, AC-AUDIT-ACTOR, AC-EXPORT-COLLISION-1).
 *   - specAcceptanceCriteriaSchema enforces unique `id` across the array via
 *     superRefine (Zod has no built-in array-uniqueness validator) — same pattern
 *     as `planExtraSchema`'s `phases[].name` uniqueness check in schemas.ts.
 *   - computeAcCoverage never mutates its inputs and performs no presentation
 *     pre-aggregation (badges, text rendering) — that is each consumer's job (D6).
 *     An `ac_ref` on an evidence entry that names an id absent from `criteria` is
 *     silently excluded from every AcCoverageFact (cross-entity validation that an
 *     ac_ref points at a *declared* id is T3's job — TaskWorkflowService.addEvidence
 *     — not this pure aggregator's).
 *   - `attested` / `attested_pass` / `attested_fail` are derived in exactly ONE
 *     place — this function's body — from `entry.attestation` presence (SPEC-039
 *     §2 D8); no other module re-derives "was this evidence runner-attested".
 *
 * Side-effect class: pure
 *
 * Source: SPEC-038 §3 (schema), §7 D1-D3, D6; SPEC-039 §2 D8, D9; SPEC-061 §Scope D5
 */

import { z } from "zod";
import { ok, err } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import type { DocRecord } from "./types.js";
import { extractEvidence, type OracleKind } from "./task-workflow.js";

// ─── Verify Modes ──────────────────────────────────────────────────────────

/** The three ways an acceptance criterion's verification can be declared. */
export const AC_VERIFY_MODES = ["script", "ai", "human"] as const;

/** Derived TypeScript union for an acceptance criterion's `verify.mode`. */
export type AcVerifyMode = (typeof AC_VERIFY_MODES)[number];

/**
 * Oracle kinds usable when `verify.mode === "script"` — every {@link OracleKind}
 * (task-workflow.ts SSOT) except `"manual"`, since a script-mode AC is by
 * definition not a manual oracle.
 *
 * @invariant Explicit literal tuple (not derived via `.filter()`), paired with the
 *   type-level exhaustiveness assertion below: adding a new kind to `ORACLE_KINDS`
 *   (task-workflow.ts) without deciding whether it belongs here fails
 *   `bun run typecheck` — a compile-time forcing function, not a runtime check
 *   (SPEC-038 §7 D3).
 */
export const SCRIPT_ORACLES = ["tsc", "test", "lint", "build", "e2e", "other"] as const;

/** Derived TypeScript union for `verify.oracle` in script mode. */
export type ScriptOracle = (typeof SCRIPT_ORACLES)[number];

/**
 * Type-level exhaustiveness gate: {@link OracleKind} must equal exactly
 * `SCRIPT_ORACLES ∪ {"manual"}`. If a new oracle kind is ever added to
 * `ORACLE_KINDS` without a matching update here, `OracleKind` is no longer
 * assignable to the target union, `_ScriptOraclesCoverAllButManual` collapses to
 * `never`, and the assignment on the next line fails to typecheck.
 */
type _ScriptOraclesCoverAllButManual = [OracleKind] extends [ScriptOracle | "manual"]
  ? true
  : never;
// reason: type-only exhaustiveness assertion (SPEC-038 §7 D3) — this binding is
// never read at runtime; its sole purpose is to fail `tsc` when the two enums
// drift apart. Do not remove as "unused".
const _scriptOraclesCoverAllButManual: _ScriptOraclesCoverAllButManual = true;
void _scriptOraclesCoverAllButManual;

// ─── Acceptance Criterion Schema ───────────────────────────────────────────

/**
 * One structured acceptance criterion declared on a spec.
 *
 * @example
 * acceptanceCriterionSchema.parse({
 *   id: "AC-ACODE-1",
 *   statement: "acceptanceCriterionSchema rejects malformed input",
 *   verify: { mode: "script", oracle: "test", command: "bunx vitest run packages/core" },
 * });
 *
 * @example
 * // script mode with an explicit spawn timeout (SPEC-039 §2 D9) — omitted means
 * // `lore verify` falls back to config's `verify.default_timeout_ms`
 * acceptanceCriterionSchema.parse({
 *   id: "AC-VRF-3",
 *   statement: "lore verify produces attested pass evidence on exit 0",
 *   verify: { mode: "script", oracle: "test", command: "bun test", timeout_ms: 60000 },
 * });
 */
export const acceptanceCriterionSchema = z.object({
  id: z.string().regex(
    /^AC-[A-Z0-9]+(-[A-Z0-9]+)*$/,
    "AC id must match AC-<SEGMENT>(-<SEGMENT>)*, e.g. AC-ACODE-1",
  ),
  statement: z.string().min(1).max(2000),
  verify: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("script"),
      oracle: z.enum(SCRIPT_ORACLES),
      command: z.string().min(1).max(1000),
      /**
       * Per-AC spawn timeout in ms, consumed by `lore verify`'s executor
       * (SPEC-039 §2 D9). Optional — absence falls back to config's
       * `verify.default_timeout_ms` (300000 by default). `cwd`/`env` overrides
       * remain out of scope for this reservation (SPEC-039 §2).
       */
      timeout_ms: z.number().int().positive().optional(),
    }),
    z.object({
      mode: z.literal("ai"),
      rubric: z.string().min(1).max(2000),
    }),
    z.object({
      mode: z.literal("human"),
      note: z.string().max(500).optional(),
    }),
  ]),
  /**
   * SPEC-055 — the PRD requirement ids this criterion covers (`R-##`). Optional and
   * additive: a criterion with no `requirement_refs` is valid (REGRESSION — every
   * pre-SPEC-055 AC parses unchanged). Authored via `lore ac add --covers <R-id>`
   * (repeatable); consumed by the `lore status --check-requirements` completeness oracle,
   * which gathers these across a PRD's descendant specs. Format-unconstrained here (the
   * requirement inventory is the authority on which ids exist — an unknown ref simply
   * covers nothing).
   */
  requirement_refs: z.array(z.string()).optional(),
});

/** Derived TypeScript type for one acceptance criterion declaration. */
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;

/**
 * `spec.extra.acceptance_criteria` — an array of {@link AcceptanceCriterion}, capped
 * at 50 entries, with `id` uniqueness enforced across the array.
 *
 * @invariant Uniqueness cannot be expressed as a plain Zod array shape — same
 *   superRefine pattern as `planExtraSchema`'s `phases[].name` check (schemas.ts).
 */
export const specAcceptanceCriteriaSchema = z
  .array(acceptanceCriterionSchema)
  .max(50)
  .superRefine((criteria, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < criteria.length; i++) {
      const entry = criteria[i];
      if (!entry) continue;
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "acceptance_criteria[].id must be unique",
          path: [i, "id"],
        });
      }
      seen.add(entry.id);
    }
  });

// ─── AC Coverage ────────────────────────────────────────────────────────────

/**
 * One evidence reference contributing to an {@link AcCoverageFact}.
 *
 * @invariant `attested` follows this module's "present-iff-true" convention
 *   (mirroring `ReadyRecord.claim`/`.phase` in task-workflow.ts) — set to `true`
 *   only when the source evidence entry carries `attestation`; omitted (not
 *   `false`) for self-reported entries, including all pre-SPEC-039 legacy data.
 * @invariant `result` includes `"inconclusive"` (SPEC-061 §Scope D2/D5) — a
 *   runner-issued outcome for a `script:test` AC whose command's declared
 *   test-file paths were not all matched by the runner (zero/under-match).
 *   {@link computeAcCoverage}'s `pass`/`fail`/`attested_pass`/`attested_fail`
 *   filters below match the exact strings `"pass"`/`"fail"` — an
 *   `"inconclusive"` ref satisfies neither, so it is counted in NEITHER
 *   bucket with NO special-casing required (it still appears in `refs`, for
 *   audit visibility).
 * @invariant `result` also includes `"expected-fail"` (spec-workflow-hardening-
 *   evidence-red-vocabulary-claim-worktree §M1, AC-WH-1) — a SELF-REPORTED
 *   (never runner-issued) value recording a deliberate RED-phase oracle run
 *   that fails by design, before its implementation lands. Mirrors
 *   `"inconclusive"`'s exact same "satisfies neither `pass`/`fail` filter"
 *   property below — an `"expected-fail"` ref is counted in NEITHER bucket,
 *   NO special-casing required, and is NEVER counted as passing/green by this
 *   or any other consumer of the evidence log.
 * @invariant `recorded_at` (spec-oracle-tier-falsifiability-a-criterion-never-
 *   observed-red M4) is OPTIONAL, not required — a required field would repeat
 *   exactly the mistake `not_measured` (M5) exists to fix: a compile-time claim
 *   the runtime cannot actually guarantee, especially for hand-built test
 *   fixtures. `computeAcCoverage` populates it unconditionally from the source
 *   `EvidenceEntry.recorded_at` (itself schema-required — `task-workflow.ts`'s
 *   `evidenceEntrySchema`), so every ref built by the real aggregator carries
 *   one; `deriveAcCoverageState`'s supersession check (`fail_superseded`)
 *   defends itself against a ref that does not, per the three fail-closed
 *   tie-breaks in that function's own JSDoc. Same ISO 8601 string convention
 *   `EvidenceEntry.recorded_at` uses (string comparison, no `Date` parsing —
 *   mirrors `session.ts::deriveLastActivityAt`'s `updated_at` comparison).
 */
export interface EvidenceRefLite {
  task_id: string;
  result: "pass" | "fail" | "inconclusive" | "expected-fail";
  attested?: boolean;
  recorded_at?: string;
}

/**
 * Pure pass/fail(+attested) coverage facts for one declared acceptance criterion,
 * aggregated over a set of tasks' `verification_evidence[].ac_ref`. No presentation
 * pre-aggregation (badges, checkmarks) — renderers live with each consumer (D6).
 */
export interface AcCoverageFact {
  ac_id: string;
  mode: AcVerifyMode;
  pass: number;
  fail: number;
  refs: EvidenceRefLite[];
  /** Subset of `pass` whose evidence carries runner attestation (SPEC-039 §2 D8). */
  attested_pass: number;
  /** Subset of `fail` whose evidence carries runner attestation (SPEC-039 §2 D8). */
  attested_fail: number;
  /**
   * The fourth coverage dimension (spec-oracle-tier-falsifiability-a-criterion-never-
   * observed-red M1, governed by adr-falsifiability-moves-from-the-task-tier-to-the-
   * oracle-tier): count of `ac_ref` rows whose `result` is `"expected-fail"` or
   * `"fail"` — i.e. this oracle was, at least once, OBSERVED to be able to go red.
   * Computed in the same single pass over `refs` that derives `pass`/`fail`/
   * `attested_pass`/`attested_fail` above — no second traversal, no new store
   * round-trip. Always present (never omitted), including `0` for a criterion with
   * evidence but no red observation, and for a criterion with no evidence at all
   * (matching the "always-present" convention `pass`/`fail`/`attested_*` already use).
   *
   * This mechanism answers the three questions
   * adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the requires every new
   * deterministic mechanism to answer in its own doc or JSDoc:
   *
   * - **Proxy**: `falsified > 0` proves this oracle CAN go red — a proxy for, not
   *   proof of, "this oracle correctly discriminates the feature it claims to test".
   *   Concrete input satisfying the proxy while violating the property: an author
   *   records one `expected-fail` row against a throwaway, unrelated-to-the-criterion
   *   assertion (e.g. `expect(false).toBe(true)`), then restores the real assertion —
   *   `falsified` reads `1`, yet the real oracle body was never shown to be able to
   *   fail. Named, load-bearing, and explicitly ACCEPTED by the governing ADR ("M1
   *   proves an oracle CAN fail, never that it fails on the RIGHT input... Mutation-
   *   based discrimination proof was considered and rejected for this slice").
   * - **Silence**: `falsified === 0` is a real, computed zero — never conflated with
   *   "not measured". It renders as a state DISTINCT from plain `"pass"` (see
   *   {@link deriveAcCoverageState}'s `"pass_unfalsified"`) rather than silently
   *   collapsing into the same value as a criterion that WAS observed red. An absent
   *   `refs` array (`pass === 0`) and a present-but-never-red one (`pass > 0`,
   *   `falsified === 0`) are two different, distinguishable readings.
   *   ⛔ CORRECTED (M5, spec-oracle-tier-falsifiability-a-criterion-never-observed-red):
   *   this bullet, as written above, claimed there were only TWO distinguishable
   *   readings of a pass-only fact — that claim is FALSE, and M5 is the measured
   *   proof. `falsified` is typed `number` (required, never optional) on
   *   {@link AcCoverageFact}, but a type annotation is a compile-time claim the
   *   runtime does not enforce — a hand-built fixture (a test's own fact literal,
   *   never `computeAcCoverage`'s own output, which always computes a well-formed
   *   non-negative integer) can carry `falsified: undefined`/`null`/`NaN`/a negative
   *   number despite the type. Before M5, that malformed value satisfied neither
   *   `falsified === 0` NOR `falsified > 0`'s exhaustive-looking pair, so it fell
   *   through {@link deriveAcCoverageState}'s pass-only branch into `"pass"` — the
   *   SAME optimistic misread the `"none"` vs `"pass_unfalsified"` split exists to
   *   prevent, just on the field this dimension itself owns. `deriveAcCoverageState`
   *   now reads THREE distinguishable pass-only states, not two: a genuine zero
   *   (`"pass_unfalsified"`), a genuine positive count (`"pass"`), and a malformed
   *   count (`"not_measured"`) — see that function's own JSDoc for the well-formedness
   *   predicate and its rank in the precedence.
   * - **Opt-in**: unconditional — every criterion with ≥1 evidence entry gets a
   *   `falsified` count with no author action required, and the derived state is
   *   REPORT-ONLY (governing ADR §"Report-only first…"): nothing gates or blocks on
   *   it, so it binds the whole corpus (82.0% of 700 criteria measured
   *   `pass_unfalsified` on 2026-08-07) without constraining anyone who hasn't opted
   *   into a future blocking form.
   */
  falsified: number;
}

/**
 * Computes per-AC evidence coverage: for each declared criterion, counts how many
 * evidence entries (across all given tasks) reference it via `ac_ref`, split by
 * pass/fail, and further split by whether the evidence was runner-attested
 * (SPEC-039 `lore verify`) versus self-reported.
 *
 * @param criteria - Declared acceptance criteria (typically a spec's
 *   `extra.acceptance_criteria`)
 * @param tasks - Task documents whose `extra.verification_evidence[]` may carry
 *   `ac_ref` pointers into `criteria` (typically a plan's child tasks)
 * @returns One {@link AcCoverageFact} per input criterion, in input order. An empty
 *   `tasks` array yields `{pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0,
 *   falsified: 0}` for every criterion — never throws, never omits a declared criterion.
 *
 * @example
 * computeAcCoverage(
 *   [{ id: "AC-1", statement: "...", verify: { mode: "script", oracle: "test", command: "bun test" } }],
 *   [taskWithAttestedEvidence],
 * );
 * // => [{ ac_id: "AC-1", mode: "script", pass: 1, fail: 0,
 * //      refs: [{ task_id: "...", result: "pass", attested: true }],
 * //      attested_pass: 1, attested_fail: 0, falsified: 0 }]
 *
 * @remarks Single-pass over `tasks`/their evidence (SPEC-070 AC-070-17, review
 *   finding F10) — the PREVIOUS implementation re-called `extractEvidence(task)`
 *   (a `z.array(...).safeParse` over the WHOLE evidence array) once PER CRITERION
 *   PER TASK, so a task's evidence was re-parsed `criteria.length` times. This
 *   version extracts+parses each task's evidence exactly ONCE, bucketing every ref
 *   by `entry.ac_ref` into a `Map`, then reads each declared criterion's bucket —
 *   output is unchanged (same refs, same order: tasks then their evidence entries,
 *   in input order) for every criterion, declared or not — an `ac_ref` naming an
 *   UNDECLARED id still lands in the map but is never read back out (D6's "silently
 *   excluded from every AcCoverageFact" contract, preserved). `falsified` (the
 *   fourth coverage dimension, spec-oracle-tier-falsifiability-a-criterion-never-
 *   observed-red M1) is read from the SAME per-criterion `refs` bucket the other
 *   four counts already read — no additional pass over `tasks`.
 */
export function computeAcCoverage(
  criteria: AcceptanceCriterion[],
  tasks: DocRecord[],
): AcCoverageFact[] {
  const refsByAcId = new Map<string, EvidenceRefLite[]>();
  for (const task of tasks) {
    for (const entry of extractEvidence(task)) {
      if (entry.ac_ref === undefined) continue;
      // reason: `recorded_at` is populated unconditionally in this SAME pass (M4,
      // spec-oracle-tier-falsifiability-a-criterion-never-observed-red) — the
      // source EvidenceEntry.recorded_at is schema-required, so this is never a
      // second traversal or a new store round-trip, just one more field read off
      // the entry already in hand. `EvidenceRefLite.recorded_at` stays OPTIONAL on
      // the TYPE (defending hand-built fixtures, per that field's own JSDoc) even
      // though this real aggregator always supplies it.
      const ref: EvidenceRefLite = { task_id: task.id, result: entry.result, recorded_at: entry.recorded_at };
      if (entry.attestation !== undefined) {
        ref.attested = true;
      }
      const bucket = refsByAcId.get(entry.ac_ref);
      if (bucket === undefined) {
        refsByAcId.set(entry.ac_ref, [ref]);
      } else {
        bucket.push(ref);
      }
    }
  }

  return criteria.map((criterion) => {
    const refs = refsByAcId.get(criterion.id) ?? [];
    return {
      ac_id: criterion.id,
      mode: criterion.verify.mode,
      pass: refs.filter((r) => r.result === "pass").length,
      fail: refs.filter((r) => r.result === "fail").length,
      refs,
      attested_pass: refs.filter((r) => r.result === "pass" && r.attested === true).length,
      attested_fail: refs.filter((r) => r.result === "fail" && r.attested === true).length,
      falsified: refs.filter((r) => r.result === "expected-fail" || r.result === "fail").length,
    };
  });
}

// ─── AC Coverage Precedence (SPEC-070 AC-070-12, review finding F3) ────────

/**
 * The fail-first coverage-precedence VERDICT for one declared criterion's
 * {@link AcCoverageFact} — the SINGLE precedence implementation this codebase uses
 * to turn raw pass/fail/attested counts into a rendering-ready state. Every
 * consumer that needs a coverage label (the `lore feed task-start` pack's
 * `AcceptanceView.coverage`, `lore ac list`'s coverage badge) derives it from THIS
 * function — never re-implements its own ordering.
 *
 * FAIL-FIRST (the deliberate semantic fix this function codifies, not a
 * refactor-only extraction): a criterion with BOTH failing AND passing evidence is
 * `"fail"` (or its M4 sibling `"fail_superseded"`, below) — a loud failure signal
 * always wins over any pass, attested or not. `"pass_unfalsified"`
 * (spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1) is checked
 * AFTER `attested_pass` and BEFORE the plain `"pass"` fallback — so a criterion with
 * an attested pass NEVER degrades to `"pass_unfalsified"` even when it was also
 * never observed red (AC-FALS-3); only a NON-attested pass with zero falsified
 * evidence reads as `"pass_unfalsified"` instead of plain `"pass"` (AC-FALS-2).
 * Before this function existed, two INDEPENDENT precedence implementations
 * disagreed: `commands/ac.ts`'s `coverageBadge` was already fail-first (checked
 * `fact.fail > 0` before `fact.pass > 0`), but `task-feed-wiring.ts`'s
 * `deriveCoverageLabel` checked `attested_pass > 0` FIRST — a criterion with an
 * attested pass AND a later fail silently rendered `"attested_pass"` in the
 * task-start pack, masking the real failure behind a green badge.
 *
 * ⛔ **The complete SEVEN-row precedence table (M4 + M5, binding — see the
 * governing spec's Design section, §"The seven-value precedence, after M4 and M5",
 * for the authoritative statement this function implements verbatim). Read TOP TO
 * BOTTOM; the FIRST matching row wins:**
 *
 * | # | State | Condition |
 * |---|---|---|
 * | 1 | `"fail"` | `fail > 0` AND NOT superseded |
 * | 2 | `"fail_superseded"` | `fail > 0` AND superseded (see below) |
 * | 3 | `"attested_pass"` | `fail === 0` AND `attested_pass > 0` |
 * | 4 | `"not_measured"` | `fail === 0`, `attested_pass === 0`, `pass > 0`, `falsified` NOT a well-formed non-negative integer |
 * | 5 | `"pass_unfalsified"` | `fail === 0`, `attested_pass === 0`, `pass > 0`, `falsified === 0` |
 * | 6 | `"pass"` | `fail === 0`, `attested_pass === 0`, `pass > 0`, `falsified > 0` |
 * | 7 | `"none"` | `pass === 0` AND `fail === 0` |
 *
 * This is the COMPLETE return set — `"inconclusive"`/`"expected-fail"` are
 * badge-layer residuals `commands/ac.ts::coverageBadge` derives from `fact.refs`
 * ONLY after THIS function has already returned `"none"` (rendering `⚑?`/`⚑R`);
 * they are never members of this function's own return type.
 *
 * **M4 — `"fail_superseded"` (rank 2)**: SUPERSEDED means the newest ATTESTED pass
 * ref is STRICTLY newer than the newest `"fail"` ref, by `recorded_at`. Reduces an
 * APPEND-ONLY LOG (evidence rows accumulate forever) into a precedence built for a
 * SIMULTANEOUS SET — without this, one honest historical `fail` row pinned a
 * criterion to `"fail"` permanently, even after a later attested pass proved the
 * defect fixed (`task-one-honest-historical-fail-row-pins-a-criterion-to-state`).
 * `falsified`'s OWN counting is UNTOUCHED — it answers a different, deliberately
 * historical question ("was this oracle ever observed able to go red") and stays
 * monotonic; only `state`'s time semantics change (AC-FALS-15). Three fail-closed
 * tie-breaks, delegated to {@link isSupersededByNewerAttestedPass} — each one a
 * deliberate choice toward `"fail"` whenever the comparison is ambiguous:
 *   - Equal `recorded_at` does NOT supersede (a tie keeps `"fail"`).
 *   - A `"fail"` ref with an absent/non-string `recorded_at` is UNUSABLE and treated
 *     as the NEWEST possible fail (cannot be superseded by anything).
 *   - A `"pass"` ref with an absent/non-string `recorded_at` is UNUSABLE and treated
 *     as the OLDEST possible pass (cannot supersede anything); an UNATTESTED pass
 *     never supersedes, however new — only `attested === true` refs are considered.
 * Named residual: a criterion whose `fail` is real and current, followed by an
 * attested pass produced against a DIFFERENT tree, still reads `"fail_superseded"`
 * — supersession proves recency, never that the same code was under test (the same
 * class of proxy gap `falsified`'s own governing ADR names and accepts).
 *
 * **M5 — `"not_measured"` (rank 4, NOT above `"fail"`/`"attested_pass"`)**: a
 * malformed `falsified` (`undefined`/`null`/`NaN`/negative — a hand-built test
 * fixture is exactly where a `number`-typed field's runtime guarantee does not
 * hold; {@link computeAcCoverage}'s own output is always well-formed) invalidates
 * EXACTLY the discrimination `falsified` powers, and nothing else — ranks 1-3 and 7
 * never read the field, so their inputs stay independently valid. Ranking it higher
 * would suppress a true `"fail"` behind a fixture defect, inverting the fail-first
 * rule M4 preserves. `"not_measured"` is also NOT more favourable than `"pass"`: it
 * is a distinct non-committal reading, never a silent substitution for either
 * neighbour — rows 4-6 are TOTAL over every possible `falsified` value (no input
 * with `pass > 0` and no fail/attested-pass falls through to `"none"`).
 *
 * @param fact - One {@link computeAcCoverage} output row for a single criterion.
 * @returns One of the seven states in the precedence table above.
 * @example
 * deriveAcCoverageState({ ac_id: "AC-1", mode: "script", pass: 1, fail: 1, refs: [], attested_pass: 0, attested_fail: 0, falsified: 1 });
 * // => "fail" — a fail wins over a pass, and there is no attested pass to supersede it
 * @example
 * deriveAcCoverageState({ ac_id: "AC-2", mode: "script", pass: 1, fail: 0, refs: [], attested_pass: 0, attested_fail: 0, falsified: 0 });
 * // => "pass_unfalsified" — green, but this oracle was never observed to be able to fail
 * @example
 * deriveAcCoverageState({ ac_id: "AC-3", mode: "script", pass: 1, fail: 0, refs: [], attested_pass: 1, attested_fail: 0, falsified: 0 });
 * // => "attested_pass" — an attested pass never degrades to "pass_unfalsified" (AC-FALS-3),
 * //    even though falsified is also 0 here — attested_pass is checked first
 * @example
 * deriveAcCoverageState({
 *   ac_id: "AC-4", mode: "script", pass: 1, fail: 1, attested_pass: 1, attested_fail: 0, falsified: 1,
 *   refs: [
 *     { task_id: "t1", result: "fail", recorded_at: "2026-08-01T00:00:00.000Z" },
 *     { task_id: "t2", result: "pass", attested: true, recorded_at: "2026-08-02T00:00:00.000Z" },
 *   ],
 * });
 * // => "fail_superseded" (M4) — the attested pass is strictly newer than the fail
 * @example
 * deriveAcCoverageState({ ac_id: "AC-5", mode: "script", pass: 1, fail: 0, refs: [], attested_pass: 0, attested_fail: 0, falsified: undefined as unknown as number });
 * // => "not_measured" (M5) — falsified fails runtime well-formedness despite the type claim
 */
export function deriveAcCoverageState(
  fact: AcCoverageFact,
): "fail" | "fail_superseded" | "attested_pass" | "not_measured" | "pass_unfalsified" | "pass" | "none" {
  if (fact.fail > 0) {
    return isSupersededByNewerAttestedPass(fact.refs) ? "fail_superseded" : "fail";
  }
  if (fact.attested_pass > 0) return "attested_pass";
  if (fact.pass > 0) {
    if (!isWellFormedFalsifiedCount(fact.falsified)) return "not_measured";
    return fact.falsified === 0 ? "pass_unfalsified" : "pass";
  }
  return "none";
}

/**
 * Runtime well-formedness check for {@link AcCoverageFact.falsified} (M5,
 * spec-oracle-tier-falsifiability-a-criterion-never-observed-red) — a POSITIVE test
 * ("is this usable") rather than a list of bad values, deliberately: a "not a
 * finite number" phrasing was rejected during the governing spec's review because
 * it leaves a finite NEGATIVE `falsified` matching no row of the precedence table
 * at all (still `pass > 0`, which also excludes `"none"`) — the exact fail-open
 * shape M5 exists to close. `Number.isInteger` accepts `unknown` at the type level
 * ({@link https://www.typescriptlang.org/} lib.es2015.core.d.ts), so this compiles
 * and behaves correctly even though `falsified`'s declared type is the non-optional
 * `number` — the whole point being that a hand-built fixture's ACTUAL runtime value
 * can violate that declared type.
 *
 * @param falsified - `AcCoverageFact.falsified`, declared `number` but not
 *   runtime-guaranteed to BE one (M5's own premise).
 * @returns `true` for any non-negative integer (`0`, `1`, `2`, …); `false` for
 *   `undefined`, `null`, `NaN`, a non-integer, or a negative number.
 */
function isWellFormedFalsifiedCount(falsified: number): boolean {
  return Number.isInteger(falsified) && falsified >= 0;
}

/**
 * Whether a `fail > 0` fact's failing evidence has been SUPERSEDED by a
 * strictly-newer runner-attested pass (M4, spec-oracle-tier-falsifiability-
 * a-criterion-never-observed-red) — see {@link deriveAcCoverageState}'s own JSDoc
 * for the three fail-closed tie-breaks this function implements. Only called when
 * `fact.fail > 0` (the caller's contract), so an empty `refs`/no fail refs at all
 * would be a caller-contract violation, not a real input this function special-
 * cases — it degrades to `false` (not superseded) rather than throwing, matching
 * every other defensive read in this module.
 *
 * @param refs - `AcCoverageFact.refs` — the full evidence-reference list for one
 *   criterion.
 * @returns `true` iff the newest ATTESTED pass ref's `recorded_at` is strictly
 *   greater (plain string comparison — the same "ISO 8601 compares chronologically
 *   as a string" convention `session.ts::deriveLastActivityAt` already uses, no
 *   `Date` parsing) than the newest fail ref's `recorded_at`.
 */
function isSupersededByNewerAttestedPass(refs: readonly EvidenceRefLite[]): boolean {
  const failRefs = refs.filter((r) => r.result === "fail");
  // A fail ref with an unusable recorded_at is treated as the newest possible
  // fail (tie-break 2) — one such ref makes supersession impossible regardless
  // of any other fail ref's timestamp, so short-circuit immediately.
  if (failRefs.some((r) => !isUsableRecordedAt(r.recorded_at))) return false;
  const newestFailAt = maxRecordedAt(failRefs);
  if (newestFailAt === null) return false; // defensive: caller-contract violation, never real data

  // An unusable-timestamp attested pass is EXCLUDED entirely (tie-break 3),
  // never substituted with a sentinel — the same effect, since an excluded ref
  // can never win the max. An unattested pass never enters this filter at all
  // (tie-break 4).
  const attestedPassRefs = refs.filter(
    (r) => r.result === "pass" && r.attested === true && isUsableRecordedAt(r.recorded_at),
  );
  const newestAttestedPassAt = maxRecordedAt(attestedPassRefs);
  if (newestAttestedPassAt === null) return false;

  return newestAttestedPassAt > newestFailAt; // strict: equal timestamps do NOT supersede (tie-break 1)
}

/** Type guard: `recorded_at` is USABLE for the M4 supersession comparison iff it is a string (absent/non-string is the documented UNUSABLE case). */
function isUsableRecordedAt(value: string | undefined): value is string {
  return typeof value === "string";
}

/** Max `recorded_at` (plain string comparison) across refs with a usable one; `null` when none qualify. */
function maxRecordedAt(refs: readonly EvidenceRefLite[]): string | null {
  let latest: string | null = null;
  for (const ref of refs) {
    if (!isUsableRecordedAt(ref.recorded_at)) continue;
    if (latest === null || ref.recorded_at > latest) latest = ref.recorded_at;
  }
  return latest;
}

// ─── Declared-Scope Membership (adr-lore-verify-s-attested-evidence-scope…) ──

/**
 * Whether one acceptance-criterion id falls inside a task's/phase's DECLARED
 * `ac_scope` — the SINGLE membership decision `lore verify`'s selection and both
 * of its scope refusals are built from (`VerifyRunnerService.verifyPlan`), and
 * the one place the "exact string equality" rule for scope ids is stated.
 *
 * A boolean query, per CQS: no `Result`, no store, no config (ADR §Public
 * Interface — "a pure predicate beside `computeAcCoverage`").
 *
 * @param declaredScope - the doc's declared ids, read via
 *   `extractDeclaredAcScope` (`phase.ts`). The caller MUST have already
 *   distinguished ABSENT (`undefined`) from EMPTY (`[]`) before calling: this
 *   predicate takes an array, so it cannot tell "nobody declared a scope" from
 *   "an author declared that this doc claims nothing" — and those two states
 *   have DIFFERENT refusals (AC-VS-3 vs AC-VS-5). Passing `[]` here simply
 *   answers `false` for every id.
 * @param acId - one declared criterion's id (or one `--ac`-named id)
 * @returns `true` iff `declaredScope` contains `acId` by EXACT string equality
 *   — no trimming, no case folding, matching how `acScopeArraySchema` stores ids
 *   verbatim and how `assertScopeFreeze` compares them. Normalising here would
 *   silently change which stored ids an evidence `ac_ref` matches.
 *
 * @example
 * isAcInDeclaredScope(["AC-VS-1", "AC-VS-2"], "AC-VS-2"); // => true
 * isAcInDeclaredScope(["AC-VS-1"], "ac-vs-1");            // => false (exact match only)
 * isAcInDeclaredScope([], "AC-VS-1");                     // => false (claims nothing)
 */
export function isAcInDeclaredScope(declaredScope: readonly string[], acId: string): boolean {
  return declaredScope.includes(acId);
}

// ─── Governing-Spec Resolution by Declared ac_scope ────────────────────────

/**
 * One resolved "this spec governs that ac_scope" match — the spec doc plus its
 * already-schema-parsed acceptance criteria (avoids a second `safeParse` by the
 * caller).
 */
export interface GoverningSpecMatch {
  spec: DocRecord;
  criteria: AcceptanceCriterion[];
}

/**
 * Finds the ONE spec, among `candidateSpecs`, whose `acceptance_criteria` fully
 * covers `declaredAcScope` — the SINGLE governing-spec search shared by every
 * surface that needs to resolve which spec governs a doc with NO structural
 * plan/spec link (an `--adhoc` task, SPEC-069 §Design Decisions D2, whose parent
 * is the corpus root PRD by construction). Both `VerifyRunnerService.verifyAdhocTask`
 * (`lore verify --task <adhoc-task>`) and `CorpusService.resolveDeclaredAcIdsForAdhocTask`
 * (`lore evidence`'s `ac_ref` cross-entity validation) call this EXACT function —
 * extracted here (task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref) so
 * the two surfaces can never disagree about which spec governs a given ad-hoc task.
 *
 * `AC-*` ids are unique only WITHIN one spec's declared criteria
 * (`specAcceptanceCriteriaSchema`'s `superRefine`), never enforced globally — this
 * function therefore NEVER guesses: zero or multiple fully-covering specs both
 * refuse loud rather than picking one arbitrarily, which could silently attest a
 * real command (or store a real evidence `ac_ref`) against the wrong spec's
 * acceptance criteria.
 *
 * @param declaredAcScope - The doc's non-empty declared `ac_scope`. The caller
 *   MUST have already distinguished ABSENT (`undefined`, via `extractDeclaredAcScope`,
 *   phase.ts) and EMPTY (`[]`) from a real scope — this function does not
 *   special-case an empty array beyond treating it as "covered by every
 *   candidate spec" (`[].every(...)` is vacuously true), which would silently
 *   "resolve" to whichever spec happens to be scanned first whenever ≥1
 *   candidate exists. Callers must never pass an empty array in.
 * @param candidateSpecs - Every `spec`-typed doc to search (caller-fetched, e.g.
 *   `corpusService.listFull({type: "spec"}).docs` or `store.findMany({type: "spec"})`).
 * @param subjectLabel - Human-readable subject for error messages, e.g.
 *   `ad-hoc task "my-task-slug"` — keeps each caller's refusal worded for its
 *   own context without duplicating the search/ambiguity logic itself.
 * @returns `ok({spec, criteria})` for the ONE fully-covering spec.
 * @throws (as `Result`) VALIDATION_ERROR field `ac_scope` — zero candidate specs
 *   fully cover `declaredAcScope` ("matches no"), or more than one does
 *   ("ambiguous", naming every matched spec's slug).
 *
 * @example
 * resolveGoverningSpecByAcScope(["AC-1"], [specA, specB], 'ad-hoc task "t"');
 * // => ok({ spec: specA, criteria: [...] }) when only specA declares AC-1 in full
 */
export function resolveGoverningSpecByAcScope(
  declaredAcScope: readonly string[],
  candidateSpecs: readonly DocRecord[],
  subjectLabel: string,
): Result<GoverningSpecMatch, LoreError> {
  const declaredSet = new Set(declaredAcScope);
  const matches: GoverningSpecMatch[] = [];
  for (const candidate of candidateSpecs) {
    const parsed = specAcceptanceCriteriaSchema.safeParse(candidate.extra["acceptance_criteria"]);
    if (!parsed.success || parsed.data.length === 0) continue;
    const specIds = new Set(parsed.data.map((c) => c.id));
    const coversAll = [...declaredSet].every((id) => specIds.has(id));
    if (coversAll) matches.push({ spec: candidate, criteria: parsed.data });
  }

  if (matches.length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "ac_scope",
      message:
        `${subjectLabel}'s declared ac_scope (${[...declaredAcScope].join(", ")}) matches no ` +
        "spec's acceptance_criteria in full — cannot infer a governing spec without a " +
        "structural plan/spec link (SPEC-069 D2). Ensure ac_scope names AC ids that all " +
        "exist on exactly one spec.",
      value: [...declaredAcScope],
    });
  }
  if (matches.length > 1) {
    return err({
      code: "VALIDATION_ERROR",
      field: "ac_scope",
      message:
        `${subjectLabel}'s declared ac_scope (${[...declaredAcScope].join(", ")}) matches ` +
        `${matches.length} specs (${matches.map((m) => m.spec.slug).join(", ")}) — ambiguous. ` +
        "Never guess which spec governs a task; narrow the declared ac_scope to AC ids " +
        "unique to a single spec.",
      value: matches.map((m) => m.spec.slug),
    });
  }

  const matched = matches[0];
  if (matched === undefined) {
    // Unreachable — `matches.length` is exactly 1 here (both the zero- and
    // multi-match branches above already returned). Guards
    // `noUncheckedIndexedAccess` without an unsafe non-null assertion.
    return err({
      code: "STORE_ERROR",
      message: "internal error: governing-spec match lost between length check and read",
    });
  }
  return ok(matched);
}
