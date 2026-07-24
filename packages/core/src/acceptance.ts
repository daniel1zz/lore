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
 *   - computeAcCoverage(criteria, tasks) — pure pass/fail(+attested) aggregation over
 *     tasks' evidence (single-pass over tasks/evidence — SPEC-070 AC-070-17, review
 *     finding F10: evidence is extracted+bucketed by ac_ref ONCE, not re-walked once
 *     per criterion)
 *   - AcCoverageFact / EvidenceRefLite — computeAcCoverage's output row shapes
 *   - deriveAcCoverageState(fact) — the ONE fail-first coverage-precedence derivation
 *     (SPEC-070 AC-070-12, review finding F3) every rendering consumer shares
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
 */
export interface EvidenceRefLite {
  task_id: string;
  result: "pass" | "fail" | "inconclusive";
  attested?: boolean;
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
 *   `tasks` array yields `{pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0}`
 *   for every criterion — never throws, never omits a declared criterion.
 *
 * @example
 * computeAcCoverage(
 *   [{ id: "AC-1", statement: "...", verify: { mode: "script", oracle: "test", command: "bun test" } }],
 *   [taskWithAttestedEvidence],
 * );
 * // => [{ ac_id: "AC-1", mode: "script", pass: 1, fail: 0,
 * //      refs: [{ task_id: "...", result: "pass", attested: true }],
 * //      attested_pass: 1, attested_fail: 0 }]
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
 *   excluded from every AcCoverageFact" contract, preserved).
 */
export function computeAcCoverage(
  criteria: AcceptanceCriterion[],
  tasks: DocRecord[],
): AcCoverageFact[] {
  const refsByAcId = new Map<string, EvidenceRefLite[]>();
  for (const task of tasks) {
    for (const entry of extractEvidence(task)) {
      if (entry.ac_ref === undefined) continue;
      const ref: EvidenceRefLite = { task_id: task.id, result: entry.result };
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
 * `"fail"` — a loud failure signal always wins over any pass, attested or not.
 * Before this function existed, two INDEPENDENT precedence implementations
 * disagreed: `commands/ac.ts`'s `coverageBadge` was already fail-first (checked
 * `fact.fail > 0` before `fact.pass > 0`), but `task-feed-wiring.ts`'s
 * `deriveCoverageLabel` checked `attested_pass > 0` FIRST — a criterion with an
 * attested pass AND a later fail silently rendered `"attested_pass"` in the
 * task-start pack, masking the real failure behind a green badge.
 *
 * @param fact - One {@link computeAcCoverage} output row for a single criterion.
 * @returns `"fail"` (`fact.fail > 0`) \> `"attested_pass"` (no fail, `fact.attested_pass > 0`)
 *   \> `"pass"` (no fail, `fact.pass > 0`, no attested pass) \> `"none"` (no evidence at all).
 * @example
 * deriveAcCoverageState({ ac_id: "AC-1", mode: "script", pass: 1, fail: 1, refs: [], attested_pass: 0, attested_fail: 0 });
 * // => "fail" — a fail always wins, even alongside a pass
 */
export function deriveAcCoverageState(
  fact: AcCoverageFact,
): "fail" | "attested_pass" | "pass" | "none" {
  if (fact.fail > 0) return "fail";
  if (fact.attested_pass > 0) return "attested_pass";
  if (fact.pass > 0) return "pass";
  return "none";
}
