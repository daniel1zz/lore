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
 *   - AC_CITE_ID_PATTERN / AC_CITES_MAX — grammar and cap of `AcceptanceCriterion.cites`
 *     (baseline rule ids a criterion cites; existence is a service-layer warning)
 *   - specAcceptanceCriteriaSchema — spec.extra.acceptance_criteria array (max 50, unique id)
 *   - computeAcCoverage(criteria, tasks) — pure pass/fail/falsified(+attested) aggregation
 *     over tasks' evidence (single-pass over tasks/evidence — SPEC-070 AC-070-17, review
 *     finding F10: evidence is extracted+bucketed by ac_ref ONCE, not re-walked once
 *     per criterion; `falsified` is the fourth coverage dimension added by
 *     spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1, computed in
 *     the SAME pass, no second traversal)
 *   - AcCoverageFact / EvidenceRefLite / AcOracleGenerationSplit —
 *     computeAcCoverage's output row shapes. `AcCoverageFact.oracle_generation`
 *     is the ORACLE-GENERATION SPLIT (spec-the-defect-channel-cannot-be-honestly-
 *     maintained-an §M5, AC-DC-8): how many of a criterion's referencing evidence
 *     rows were recorded under its CURRENT oracle versus a RETIRED one, so a
 *     rewritten (e.g. polarity-REVERSED) command's stale-but-green evidence is
 *     visible instead of reading as ordinary coverage. Facts only — the split
 *     changes no existing count and no derived state (see below).
 *   - deriveAcCoverageState(fact) — the ONE fail-first coverage-precedence derivation
 *     (SPEC-070 AC-070-12, review finding F3) every rendering consumer shares. Widened
 *     to SEVEN states by spec-oracle-tier-falsifiability-a-criterion-never-observed-red
 *     M1 (`pass_unfalsified`, between `attested_pass` and `pass`, so an attested pass
 *     never degrades), M4 (`fail_superseded` — a `fail` whose only red evidence is
 *     strictly older than a runner-attested pass, by `recorded_at`), and M5
 *     (`not_measured` — a pass-only fact whose `falsified` fails runtime well-
 *     formedness, closing M1's fail-open on an absent/malformed count). See this
 *     function's own JSDoc for the complete seven-row table.
 *   - AC_COVERAGE_STATES / AcCoverageState / projectAcCoverageGlyph(state) /
 *     AC_COVERAGE_GLYPH_ALPHABET — SPEC-143 component C4: the ONE state-to-glyph
 *     projection, `switch`-exhaustive with a `never` arm so an eighth state fails
 *     `bun run typecheck` instead of rendering as some other state's glyph. Its
 *     GLOBAL uniqueness is not a claim: `scripts/check-ac-state-renderers.ts
 *     --rule glyph-projection` refuses a second projection anywhere outside this
 *     file, and imports `AC_COVERAGE_GLYPH_ALPHABET` rather than re-listing it.
 *   - isAcInDeclaredScope(declaredScope, acId) — the ONE declared-`ac_scope`
 *     membership predicate (adr-lore-verify-s-attested-evidence-scope-belongs-to-the-task
 *     §Public Interface), consumed by `lore verify`'s selection + refusals
 *   - resolveRecordedGoverningSpec(task, candidateSpecs, subjectLabel) — the ONE governing-spec lookup
 *     for an `--adhoc` task (SPEC-069 D2): reads the spec the task RECORDED in `extra.governing_spec`
 *     (BR-1495), never a search by criterion id; accepts a deprecated spec and a superseded criterion
 *     (BR-1494). `checkScopeDeclaredOnSpec` is the matching write-side check.
 *   - acFalsifierSchema / AcFalsifier — a DECLARED falsifier on a script-mode
 *     criterion (spec-falsifiability-reachability-a-feedable-checkpoint-an
 *     §D2) — a repo-relative path + literal find/replace + the EXACT exit
 *     code the mutation is declared to produce. Consumed ONLY by
 *     `VerifyRunnerService.verifyFalsifier`'s attested-red path.
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
import { ANY_RULE_ID_PATTERN } from "./baseline.js";
import {
  extractEvidence,
  resolveOracleGeneration,
  ORACLE_GENERATION_INITIAL,
  type OracleKind,
} from "./task-workflow.js";

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

// ─── Declared Falsifier (spec-falsifiability-reachability-a-feedable-
//     checkpoint-an §D2/D3/D4) ─────────────────────────────────────────────

/**
 * A DECLARED falsifier for a script-mode acceptance criterion — a named
 * source-file mutation the AC's author asserts will make `verify.command`
 * fail with an EXACT exit code (D4 — never "non-zero"). Declared via `lore ac
 * add`/`ac set --falsifier-*`, validated by the SAME `specAcceptanceCriteriaSchema`
 * call every other AC field goes through (D2 — "declared, not described in
 * prose").
 *
 * Consumed ONLY by the attested-red runner (`VerifyRunnerService.verifyFalsifier`,
 * `service/verify-runner-service.ts`) — ordinary `lore verify` execution
 * (`verifyPlan`/`verifyAdhocTask`) never reads this field, so declaring one
 * has zero effect on a criterion's normal green-path behavior.
 *
 * @invariant `path` is REPO-RELATIVE. The runner resolves it against a
 *   SCRATCH git worktree it creates for the run, never against the caller's
 *   `cwd` or the real working tree (D3) — an absolute path here would defeat
 *   that isolation by construction, so the runner always treats it as
 *   relative regardless of leading-slash shape.
 * @invariant `find` must be a literal substring actually present in `path`'s
 *   content at APPLY time. The runner refuses loud (never silently no-ops)
 *   when it is missing — a stale falsifier (the file changed since it was
 *   declared) is a declaration bug, not a pass.
 *
 * @example
 * acFalsifierSchema.parse({
 *   path: "packages/lore/tests/unit/service/attested-red.test.ts",
 *   find: "MAGIC_MARKER",
 *   replace: "",
 *   expected_exit_code: 7,
 * });
 */
export const acFalsifierSchema = z.object({
  path: z.string().min(1),
  find: z.string().min(1),
  replace: z.string(),
  expected_exit_code: z.number().int(),
});

/** Derived TypeScript type for one declared falsifier. */
export type AcFalsifier = z.infer<typeof acFalsifierSchema>;

// ─── Acceptance Criterion Schema ───────────────────────────────────────────

/**
 * Grammar of one CITABLE rule id: a business rule `BR-n` or an architecture standard rule `AS-n`
 * (positive integer, no leading zero). A debt entry `AD-n` is deliberately NOT citable (BR-980).
 */
export const AC_CITE_ID_PATTERN = /^(BR|AS)-[1-9][0-9]*$/;

/**
 * Grammar `cites[]` is SHAPE-checked against: any permanent rule id. `AD-n` passes the shape so the
 * write chokepoint (`ac-write-chokepoint.ts`) can refuse it with the citation-gate outcome
 * (`AC_CITE_REQUIRED`, exit 4) instead of an anonymous schema error; unknown families (`XX-1`) still fail here.
 */
export const AC_CITE_SHAPE_PATTERN = ANY_RULE_ID_PATTERN;

/** Upper bound on `AcceptanceCriterion.cites` length (baseline slice 1 §C4). */
export const AC_CITES_MAX = 10;

/**
 * The immutable record of a criterion being superseded by another spec's criterion (D15).
 * `spec` is the superseding spec's document id, `ac` its criterion id, `by`/`at` the actor and ISO time.
 */
export const supersededByRefSchema = z.object({
  spec: z.string().min(1),
  ac: z.string().min(1),
  reason: z.string().min(1).max(1000),
  by: z.string().min(1),
  at: z.string().min(1),
  /**
   * Id of the plan whose work made this retirement: the plan of the task the writing run held a claim on, recorded
   * in the same write. Absent = the writing run claimed no (single) plan task, or the retirement predates the field;
   * an absent value is never attributed to any plan (adr-an-acceptance-criterion-retires-with-the-feature-it).
   */
  retired_in_plan: z.string().min(1).optional(),
});

/** Derived type of {@link supersededByRefSchema}. */
export type SupersededByRef = z.infer<typeof supersededByRefSchema>;

/** True when a criterion carries the D15 superseded marker (the ONE predicate verify, set, rm and list share). */
export function isAcSuperseded(criterion: { readonly superseded_by?: SupersededByRef | undefined }): boolean {
  return criterion.superseded_by !== undefined;
}

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
      /**
       * A DECLARED falsifier (spec-falsifiability-reachability-a-feedable-
       * checkpoint-an §D2) — see {@link acFalsifierSchema}'s own JSDoc.
       * Optional and additive: a criterion with no `falsifier` parses
       * byte-identically to pre-this-field behavior (REGRESSION) and simply
       * cannot be run through the attested-red path
       * (`VerifyRunnerService.verifyFalsifier` refuses loud, naming the
       * missing declaration, rather than silently no-op'ing).
       */
      falsifier: acFalsifierSchema.optional(),
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
  /**
   * This criterion's ORACLE GENERATION (spec-the-defect-channel-cannot-be-honestly-
   * maintained-an §M5, AC-DC-8) — bumped by `AcService.setCriterion` whenever the
   * resulting script-mode `verify.command` DIFFERS from the stored one, so a rewritten
   * oracle is a new generation and every evidence row recorded against the previous
   * one is reportable as prior-generation ({@link AcCoverageFact.oracle_generation}).
   *
   * Optional and additive: ABSENT means {@link ORACLE_GENERATION_INITIAL} — the entire
   * pre-M5 back-catalogue — read through the ONE shared rule
   * {@link resolveOracleGeneration}, never as "unknown" and never throwing (this
   * module is browser-safe and its predicates are total). A criterion is therefore
   * never written with `oracle_generation: 1` gratuitously: an edit that changes no
   * command (a `--statement`-only edit, or re-setting the identical command) leaves
   * the field exactly as it found it, absent included, so such an edit stays
   * byte-identical to pre-M5 behavior (REGRESSION).
   *
   * ⛔ Only the script-mode `verify.command` drives it. An `ai` rubric or a `human`
   * note is not an oracle whose POLARITY can silently reverse — the measured defect
   * (spec §F3) is two mutually-exclusive ATTESTED passes under one AC id, which
   * requires an executed command.
   */
  oracle_generation: z.number().int().min(ORACLE_GENERATION_INITIAL).optional(),
  /**
   * Rule ids (`BR-<n>` business, `AS-<n>` architecture standard; never `AD-<n>`) this criterion cites (baseline slice 1 §C4). Optional
   * and additive: absent parses exactly as before (REGRESSION). Unique, at most
   * {@link AC_CITES_MAX}. Whether a cited id exists or is still live is NOT checked
   * here — that is a service-layer warning (`cites_dangling` / `cites_to_inactive`),
   * so a citation survives its rule being retired.
   */
  cites: z
    .array(z.string().regex(AC_CITE_SHAPE_PATTERN, "cites[] must match BR-<n> or AS-<n> with n >= 1"))
    .max(AC_CITES_MAX)
    .refine((ids) => new Set(ids).size === ids.length, "cites[] must be unique")
    .optional(),
  /**
   * D15 (spec-defect-clusters-round-2-part-b D15) — this criterion is SUPERSEDED by another spec's
   * criterion: `lore verify` skips it (listing it as superseded), and it is immutable (`ac set`, `ac rm`
   * and a second supersede are refused). Written ONLY by `AcService.supersedeCriterion`
   * (`lore ac supersede`); optional and additive, so every earlier criterion parses unchanged.
   */
  superseded_by: supersededByRefSchema.optional(),
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
  /**
   * The RAW `EvidenceEntry.ac_oracle_generation` stamp this ref was projected from
   * (§M5, AC-DC-8) — present iff the source row carried one, deliberately NOT
   * normalised to {@link ORACLE_GENERATION_INITIAL} here. Normalising at projection
   * time would erase the distinction between a pre-M5 row (no stamp) and a row
   * explicitly stamped generation 1, which is a real audit distinction even though
   * BOTH read as generation 1 for classification purposes (that read happens exactly
   * once, in {@link computeAcCoverage}'s split, via {@link resolveOracleGeneration}).
   */
  ac_oracle_generation?: number;
  /**
   * Present (and `true`) iff the source row ran a command that is NOT string-equal to its criterion's CURRENT
   * declared `verify.command` (AC-EI-1, spec-evidence-identity-an-attested-row-counts-only-for-the). Such a ref
   * stays in {@link AcCoverageFact.refs} for audit visibility but is counted in NEITHER the pass nor the fail
   * tallies, and {@link deriveAcCoverageState}'s supersession check ignores it. Set ONLY by
   * {@link computeAcCoverage} — the one site that compares commands — and only for a script-mode criterion
   * (an ai/human criterion declares no command, so there is nothing to compare). Absent on a hand-built ref
   * means "counted", the pre-AC-EI-1 reading.
   */
  other_command?: true;
}

/**
 * The per-criterion ORACLE-GENERATION SPLIT on an {@link AcCoverageFact} (spec-the-
 * defect-channel-cannot-be-honestly-maintained-an §M5, AC-DC-8) — how many of the
 * criterion's referencing evidence rows were recorded under its CURRENT oracle
 * generation versus a RETIRED (strictly older) one.
 *
 * Facts only, no rendering (D6) — each consumer renders its own badge/column.
 *
 * @invariant `current_refs + prior_refs === refs.length`, always. `prior_refs` is
 *   defined as the STRICTLY-older count and `current_refs` as its COMPLEMENT, so the
 *   two are total over `refs` by construction and a stamp that is somehow NEWER than
 *   the criterion's own generation (unreachable through this codebase's write paths —
 *   generations are monotonic and stamped from the criterion in force — so only a
 *   hand-edited doc or fixture can produce one) can never open a silent third bucket
 *   that no field reports.
 * @invariant Additive and never counted as coverage: `pass`/`fail`/`attested_pass`/
 *   `attested_fail`/`falsified` are UNCHANGED by this split, and
 *   {@link deriveAcCoverageState} does not read it at all — supersession here is
 *   REPORTED, never enforced, and no evidence row is deleted, edited, or hidden to
 *   produce it (the append-only invariant the whole evidence log rests on).
 */
export interface AcOracleGenerationSplit {
  /** The criterion's current generation, resolved through {@link resolveOracleGeneration}. */
  current: number;
  /** Refs recorded under {@link current} (the complement of {@link prior_refs}). */
  current_refs: number;
  /** Refs recorded under a STRICTLY older generation — evidence produced by a retired oracle. */
  prior_refs: number;
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
   * The D15 supersession mark of the criterion this fact describes, copied VERBATIM by
   * {@link computeAcCoverage} (present iff the criterion carries one). {@link deriveAcCoverageState} reads it
   * through {@link isAcSuperseded} — the same predicate `lore verify`, `ac set|rm` and the `lore done` ac_scope
   * floor use — and answers `"superseded"` BEFORE any evidence row is looked at: a superseded criterion is
   * retired, so it is never unverified (`none`) and never green (`pass`). Optional on the type because many
   * call sites hand-build facts; absent means "not superseded".
   */
  superseded_by?: SupersededByRef;
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
  /**
   * The current-vs-retired oracle split for this criterion (§M5, AC-DC-8) — see
   * {@link AcOracleGenerationSplit}'s own JSDoc for the contract.
   *
   * OPTIONAL on the type, ALWAYS populated by {@link computeAcCoverage} — the exact
   * convention {@link EvidenceRefLite.recorded_at} already uses in this module, and for
   * the same reason: a hand-built fact literal (a test fixture, never this aggregator's
   * output) must stay constructible, and an ABSENT split must read as "not computed"
   * rather than as a computed all-zero one. ⛔ A consumer that needs the split must
   * therefore branch on its PRESENCE — never `?? 0` a missing one into a number, which
   * would silently report "no retired-oracle evidence" for a fact that was never
   * measured at all.
   */
  oracle_generation?: AcOracleGenerationSplit;
  /**
   * How many evidence rows tagged with this criterion ran a command NOT string-equal to its CURRENT declared
   * `verify.command` (AC-EI-1; BR-40; no normalisation, any `result`). Those rows are counted here and
   * nowhere else: never in `pass`/`fail`/`attested_pass`/`attested_fail`, so they cannot hold or lift the
   * coverage state. Rendered on every surface that renders the state (`lore ac list` text and `--json`,
   * `lore status`, the spec mirror, `lore assess`'s AC table) — each reads THIS field, never re-compares.
   *
   * OPTIONAL on the type, ALWAYS populated by {@link computeAcCoverage} (same convention as
   * {@link oracle_generation}): ABSENT on a hand-built fact means "not computed", and a renderer must not
   * print a measured zero for it.
   */
  other_command?: number;
  /**
   * Test-file paths the criterion's CURRENT script command names that exist under no plausible root
   * right now (spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-6; baseline AS-17).
   * ABSENT means "not checked" (the caller had no filesystem context) — never "nothing missing"; a
   * checked-and-clean criterion carries `[]`. A non-empty list makes {@link deriveAcCoverageState}
   * answer `"not_measured"` for any fact that is not a fail: evidence recorded against a file that
   * is gone proves nothing about the code today. Set by `AcService.listCriteria`, not by
   * {@link computeAcCoverage} (which is pure and reads no filesystem).
   */
  oracle_file_missing?: readonly string[];
  /**
   * The criterion was declared with the D8 `--allow-missing-path` escape (a red-first oracle the next task writes).
   * Read ONLY by {@link deriveAcCoverageState}'s one missing-oracle rule: declared + no `pass` on record -> `"none"`.
   * Set by `AcService.listCriteria` beside {@link oracle_file_missing}; ABSENT = not declared.
   */
  allow_missing_declared?: boolean;
  /**
   * How many `pass` evidence rows tagged with this criterion RAN one of its missing oracle files (TG-22;
   * `evidenceRanMissingOracle`, same normalised-location comparison, execution root included). Set by
   * `AcService.listCriteria` beside {@link oracle_file_missing}; ABSENT = not computed = no such pass.
   * INFORMATION ONLY since AC-EI-2: {@link deriveAcCoverageState} no longer reads it (TG-22's narrowing was
   * removed — a missing oracle is not measured whatever earlier passes ran).
   */
  passes_ran_missing_oracle?: number;
  /**
   * Segments of the criterion's CURRENT script command the missing-oracle extractor could not classify
   * (AC-EI-2 half 5; AS-17): neither a recognised runner, an interpreter naming a file, nor a benign shell
   * builtin. Their paths were NOT checked — listed here so "not checked" is never read as "checked clean".
   * ABSENT = not computed; `[]` = every segment understood. Set by `AcService.listCriteria`.
   */
  oracle_paths_unchecked?: readonly string[];
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
 *   falsified: 0, oracle_generation: {current: <the criterion's own generation>,
 *   current_refs: 0, prior_refs: 0}}` for every criterion — never throws, never omits a
 *   declared criterion. `oracle_generation` is ALWAYS populated here (it is optional only
 *   on the TYPE, for hand-built fixtures — see that field's own JSDoc).
 *
 * @example
 * computeAcCoverage(
 *   [{ id: "AC-1", statement: "...", verify: { mode: "script", oracle: "test", command: "bun test" } }],
 *   [taskWithAttestedEvidence],
 * );
 * // => [{ ac_id: "AC-1", mode: "script", pass: 1, fail: 0,
 * //      refs: [{ task_id: "...", result: "pass", attested: true }],
 * //      attested_pass: 1, attested_fail: 0, falsified: 0,
 * //      oracle_generation: { current: 1, current_refs: 1, prior_refs: 0 } }]
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
  // reason: AC-EI-1 — the ONE place an evidence row's command is compared with its criterion's CURRENT
  // declared command. Only script-mode criteria declare a command; ai/human criteria are absent from this
  // map, so none of their rows is ever classified other_command.
  const declaredCommandByAcId = new Map<string, string>();
  for (const criterion of criteria) {
    if (criterion.verify.mode === "script") declaredCommandByAcId.set(criterion.id, criterion.verify.command);
  }
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
      // reason: carried RAW (present-iff-stamped), never normalised here — see
      // `EvidenceRefLite.ac_oracle_generation`'s own JSDoc. §M5, AC-DC-8.
      if (entry.ac_oracle_generation !== undefined) {
        ref.ac_oracle_generation = entry.ac_oracle_generation;
      }
      const declaredCommand = declaredCommandByAcId.get(entry.ac_ref);
      if (declaredCommand !== undefined && entry.command !== declaredCommand) {
        ref.other_command = true;
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
    // §M5, AC-DC-8 — read from the SAME per-criterion `refs` bucket the five counts
    // below read, with no extra pass over `tasks`. `prior_refs` is the STRICTLY-older
    // count and `current_refs` its complement, so the pair is total over `refs` (see
    // `AcOracleGenerationSplit`'s invariant).
    const currentGeneration = resolveOracleGeneration(criterion.oracle_generation);
    const priorGenerationRefs = refs.filter(
      (r) => resolveOracleGeneration(r.ac_oracle_generation) < currentGeneration,
    ).length;
    // AC-EI-1: only rows that ran the criterion's CURRENT command are tallied below; the rest are the
    // `other_command` tally. `refs`, `falsified` and the generation split deliberately still read ALL rows —
    // refs for audit visibility, falsified because a red observed under any command shows the criterion's
    // oracle family can go red (the red-first protocol records its red under the pre-implementation command),
    // the generation split to keep BR-40's retired-oracle report and its `current + prior === refs.length`
    // invariant.
    const counted = refs.filter((r) => r.other_command !== true);
    return {
      ac_id: criterion.id,
      mode: criterion.verify.mode,
      pass: counted.filter((r) => r.result === "pass").length,
      fail: counted.filter((r) => r.result === "fail").length,
      refs,
      attested_pass: counted.filter((r) => r.result === "pass" && r.attested === true).length,
      attested_fail: counted.filter((r) => r.result === "fail" && r.attested === true).length,
      falsified: refs.filter((r) => r.result === "expected-fail" || r.result === "fail").length,
      other_command: refs.length - counted.length,
      oracle_generation: {
        current: currentGeneration,
        current_refs: refs.length - priorGenerationRefs,
        prior_refs: priorGenerationRefs,
      },
      ...(isAcSuperseded(criterion) ? { superseded_by: criterion.superseded_by as SupersededByRef } : {}),
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
 * | 0 | `"superseded"` | the criterion carries the D15 supersession mark ({@link isAcSuperseded}); evidence is not read |
 * | 1 | `"fail"` | `fail > 0` AND NOT superseded |
 * | 2 | `"fail_superseded"` | `fail > 0` AND superseded (see below) |
 * | 3 | `"attested_pass"` | `fail === 0` AND `attested_pass > 0` |
 * | 4 | `"not_measured"` | `fail === 0`, `attested_pass === 0`, `pass > 0`, `falsified` NOT a well-formed non-negative integer |
 * | 5 | `"pass_unfalsified"` | `fail === 0`, `attested_pass === 0`, `pass > 0`, `falsified === 0` |
 * | 6 | `"pass"` | `fail === 0`, `attested_pass === 0`, `pass > 0`, `falsified > 0` |
 * | 7 | `"none"` | `pass === 0` AND `fail === 0` |
 *
 * **AC-TG-6 / AC-EI-2 — missing oracle file (between rows 2 and 3)**: when {@link AcCoverageFact.oracle_file_missing}
 * is non-empty and `fail === 0`, the state is `"not_measured"` BEFORE rows 3-7 are tried — whether the criterion has passes
 * (whichever files they ran; TG-22's narrowing is removed) or NO evidence at all (EI-6: "whenever" means whenever). ONE exception (AC-TG-6): an AC declared red-first ({@link AcCoverageFact.allow_missing_declared}) with no pass on record ({@link hasPassOnRecord}) is `"none"`. A real `fail`
 * still outranks it (rows 1-2); a criterion whose oracle files all exist and has no evidence stays `"none"` (row 7).
 *
 * This is the COMPLETE return set — `"inconclusive"`/`"expected-fail"` are
 * badge-layer residuals `commands/ac.ts::coverageBadge` derives from `fact.refs`
 * ONLY after THIS function has already returned `"none"` (rendering `⚑?`/`⚑R`);
 * they are never members of this function's own return type.
 *
 * ⛔ {@link AcCoverageFact.oracle_generation} (the §M5 current-vs-retired oracle
 * split) is deliberately NOT read here, and adding an eighth state for it would be a
 * BEHAVIOUR change, not an extension: these seven states and their precedence are
 * pinned by other ACs and by a live-corpus old-vs-new comparison, so §M5 is additive
 * REPORTING — a consumer that wants to surface retired-oracle evidence reads the split
 * beside this verdict, never through it.
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
/**
 * The ONE predicate for "this criterion has a pass on record" under a missing oracle (AC-EI-2): ANY `pass` row,
 * whatever command it ran or how that command spelled its paths. Used by `lore done`'s missing-oracle floor (rows = the
 * task's evidence tagged with the AC). {@link deriveAcCoverageState} no longer needs it (EI-6: a missing oracle is
 * not_measured with or without a pass), so the display state is a superset of the archive refusal, never narrower.
 *
 * @param rows - evidence rows or refs of ONE criterion; only `result` is read
 * @returns `true` when any row's `result` is `"pass"`
 * @example
 *   hasPassOnRecord([{ result: "fail" }, { result: "pass" }]) // => true
 *   hasPassOnRecord([]) // => false
 */
export function hasPassOnRecord(rows: ReadonlyArray<{ readonly result: string }>): boolean {
  return rows.some((row) => row.result === "pass");
}

export function deriveAcCoverageState(fact: AcCoverageFact): AcCoverageState {
  // reason: row 0 — a superseded criterion (D15) is retired: whatever evidence it holds, it is neither unverified nor
  // green. Checked FIRST and through the one shared predicate, so no reader can count it by reading raw pass/fail.
  if (isAcSuperseded(fact)) return "superseded";
  if (fact.fail > 0) {
    return isSupersededByNewerAttestedPass(fact.refs) ? "fail_superseded" : "fail";
  }
  // AC-TG-6: the oracle file is gone, so no earlier pass (attested or not) may render as passing.
  // AC-EI-2: regardless of which files earlier passes ran (TG-22's narrowing removed; passes_ran_missing_oracle is information only).
  const missing = fact.oracle_file_missing;
  // reason: EI-6 — AC-EI-2 says "whenever any extracted path is missing", so the check does NOT depend on evidence: a criterion with
  // zero rows and a missing oracle is not measured too (it was `none`, which read as "nothing wrong"). A PRESENT oracle with no
  // evidence still falls through to `none`. A real `fail` already returned above.
  // ONE rule (AC-TG-6 + AC-EI-2): a missing oracle the AC DECLARED red-first (--allow-missing-path) with no pass on record is
  // `none` (the test is not written yet; nothing was claimed, so nothing is unmeasured). Any other missing oracle - undeclared,
  // or declared but with a pass on record (it vanished, or the pass ran a different file) - is `not_measured`.
  if (missing !== undefined && missing.length > 0) {
    // reason: `pass` excludes other-command rows (EI-1), so "a pass on record" also reads `refs` via hasPassOnRecord - the same
    // predicate `lore done`'s missing-oracle floor uses; a pass that ran a DIFFERENT file is still a pass on record.
    if (fact.allow_missing_declared === true && fact.pass === 0 && !hasPassOnRecord(fact.refs)) return "none";
    return "not_measured";
  }
  if (fact.attested_pass > 0) return "attested_pass";
  if (fact.pass > 0) {
    if (!isWellFormedFalsifiedCount(fact.falsified)) return "not_measured";
    return fact.falsified === 0 ? "pass_unfalsified" : "pass";
  }
  return "none";
}

// ─── SPEC-143 C4: the ONE state-to-glyph projection ────────────────────────

/**
 * The seven states {@link deriveAcCoverageState} can return, in PRECEDENCE ORDER
 * (row 1 first) — the same order as that function's own seven-row table.
 *
 * Declared as a value (not only as a type) so a consumer can ENUMERATE the states
 * without transcribing them: {@link AC_COVERAGE_GLYPH_ALPHABET} is derived from this
 * array by mapping {@link projectAcCoverageGlyph} over it, which is what lets
 * `scripts/check-ac-state-renderers.ts` import the alphabet instead of keeping its own
 * copy (SPEC-143 AC-CT-1 R9: a guard holding a duplicate list silently guards a stale
 * alphabet the moment the projection changes a glyph).
 *
 * ⛔ Adding a member here is a BEHAVIOUR change, not an extension — see
 * {@link deriveAcCoverageState}'s own note on why `oracle_generation` did not become an
 * eighth state. An eighth member also fails the build at
 * {@link projectAcCoverageGlyph}'s `never` arm until that switch handles it, which is
 * the point: the compiler, not a reviewer, is what refuses a silently-unrendered state.
 */
export const AC_COVERAGE_STATES = [
  "superseded",
  "fail",
  "fail_superseded",
  "attested_pass",
  "not_measured",
  "pass_unfalsified",
  "pass",
  "none",
] as const;

/**
 * One of {@link deriveAcCoverageState}'s seven return values — the named form of what
 * used to be an inline seven-member union repeated at every consumer that wanted to
 * annotate it (`commands/ac.ts::withCoverageState` still spells it
 * `ReturnType<typeof deriveAcCoverageState>`, which is the same set).
 */
export type AcCoverageState = (typeof AC_COVERAGE_STATES)[number];

/**
 * Projects one {@link AcCoverageState} to the SINGLE glyph that renders it — SPEC-143
 * component C4, the only state-to-glyph projection in this codebase.
 *
 * WHY THIS EXISTS AT ALL, stated as the defect it removes: before it,
 * `packages/lore/src/service/outline-service.ts::acCoveragePrefix` re-derived its own
 * three-glyph verdict straight from `fact.fail > 0` / `fact.pass > 0`, so `"fail"` and
 * `"fail_superseded"` BOTH printed `✘` and `"attested_pass"`, `"not_measured"`,
 * `"pass_unfalsified"` and `"pass"` all printed `✔`. Two live criteria carrying
 * attested passes (SPEC-136 AC-OX-1 and AC-OX-6) therefore rendered as failures in the
 * exported spec body. Rendering was not injective, which is the first corpus property
 * the project's North Star names.
 *
 * INJECTIVITY IS THE CONTRACT: the seven arms return seven PAIRWISE-DISTINCT glyphs.
 * That is not asserted here in prose — it is measured by
 * `packages/core/tests/unit/ac-coverage-glyph.test.ts` (which enumerates all seven
 * through real facts and compares the glyph set size to 7) and its global uniqueness is
 * measured by `scripts/check-ac-state-renderers.ts --rule glyph-projection`, which
 * refuses a SECOND projection anywhere outside this file.
 *
 * ⛔ The glyphs are deliberately CONTINUOUS with the three the old renderer used —
 * `fail` keeps `✘`, `pass` keeps `✔`, `none` keeps `·` — so the four newly-distinct
 * states are the only rendering that changes. `⚑` (attested) and `⚠` (a malformed
 * `falsified` count) match `commands/ac.ts::coverageBadge`'s existing badge vocabulary
 * for the same two states; `⊘` (superseded) and `○` (green but never observed red) are
 * new and carry no prior meaning in this codebase.
 *
 * ⛔ A branded `AcCoverageGlyph` return type was considered and REJECTED (SPEC-143 C4,
 * R2): it has zero discriminating power over the one real defect, because
 * `acCoveragePrefix` never named the type — its own bare string-literal union return
 * type was exactly what made it invisible to a type-level guard. The guard is the site
 * scan, not the type.
 *
 * @param state - Any {@link deriveAcCoverageState} output.
 * @returns The one glyph for that state; the seven results are pairwise distinct.
 * @throws {Error} Only when reached with a value outside {@link AcCoverageState} at
 *   RUNTIME — which the `never` arm has already refused at COMPILE time, so this can
 *   only fire on an unvalidated cast. Deliberately loud: the alternative is a state
 *   rendering as some other state's glyph, which is the exact class of lie this
 *   projection exists to remove.
 * @example
 * projectAcCoverageGlyph("fail_superseded"); // => "⊘" — never the plain "✘" of "fail"
 * @example
 * projectAcCoverageGlyph(deriveAcCoverageState(fact)); // the only supported call shape
 */
export function projectAcCoverageGlyph(state: AcCoverageState): string {
  switch (state) {
    case "superseded":
      return "⊖";
    case "fail":
      return "✘";
    case "fail_superseded":
      return "⊘";
    case "attested_pass":
      return "⚑";
    case "not_measured":
      return "⚠";
    case "pass_unfalsified":
      return "○";
    case "pass":
      return "✔";
    case "none":
      return "·";
    default: {
      // reason: the exhaustiveness arm SPEC-143 AC-CT-1 pins with a compile-failure
      // fixture — widening `AcCoverageState` by one member makes this assignment
      // TS2322 ("not assignable to type 'never'") and breaks `bun run typecheck`
      // before any renderer can silently fall through to a default glyph.
      const unhandled: never = state;
      throw new Error(`projectAcCoverageGlyph: unhandled AcCoverageState ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The glyph ALPHABET {@link projectAcCoverageGlyph} emits, DERIVED by projecting every
 * member of {@link AC_COVERAGE_STATES} — never a second hand-written list.
 *
 * ⛔ This is the export `scripts/check-ac-state-renderers.ts` imports for RULE 2's
 * glyph-yielding condition (SPEC-143 AC-CT-1 R9). Because it is derived, changing a
 * glyph in the switch above changes what the scan looks for in the SAME edit; a
 * re-listed copy inside the scan would have kept guarding the old alphabet, which is
 * this spec's own guarded-vs-guardian drift reproduced inside the guard.
 *
 * Order matches {@link AC_COVERAGE_STATES} (precedence order), and the entries are
 * pairwise distinct — the property `packages/core/tests/unit/ac-coverage-glyph.test.ts`
 * measures.
 */
export const AC_COVERAGE_GLYPH_ALPHABET: readonly string[] = AC_COVERAGE_STATES.map(projectAcCoverageGlyph);

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
function isSupersededByNewerAttestedPass(allRefs: readonly EvidenceRefLite[]): boolean {
  // AC-EI-1: a row that ran another command is neither a failure to supersede nor a superseding pass.
  const refs = allRefs.filter((r) => r.other_command !== true);
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

/** One declared ac_scope id that is satisfied by supersession, with the mark that satisfies it. */
export interface SupersededScopeEntry {
  readonly ac_id: string;
  readonly superseded_by: SupersededByRef;
}

/** Result of {@link partitionDeclaredScopeBySupersession}: ids retired by supersession vs ids still owed evidence. */
export interface DeclaredScopeSupersession {
  /** Declared ids whose criterion is superseded (D15), in declared order. */
  readonly superseded: readonly SupersededScopeEntry[];
  /** Declared ids with no superseded criterion — including ids that match no resolved criterion at all. */
  readonly live: readonly string[];
}

/**
 * Splits a task's declared `ac_scope` into ids satisfied by supersession and ids still live — the pure half of the
 * `lore done` ac_scope floor's supersession rule, reading the one shared {@link isAcSuperseded} predicate.
 * An id matching no criterion in `criteria` stays `live` (fail closed: an unresolvable id is never assumed retired).
 *
 * @param declaredScope - the task's declared ac_scope ids (caller has separated absent from empty)
 * @param criteria - the governing spec's criteria
 * @returns the two partitions, each in declared order; `superseded.length + live.length === declaredScope.length`
 * @example
 * partitionDeclaredScopeBySupersession(["AC-1", "AC-2"], criteria); // => { superseded: [{ac_id: "AC-1", ...}], live: ["AC-2"] }
 */
export function partitionDeclaredScopeBySupersession(
  declaredScope: readonly string[],
  criteria: readonly AcceptanceCriterion[],
): DeclaredScopeSupersession {
  const superseded: SupersededScopeEntry[] = [];
  const live: string[] = [];
  for (const acId of declaredScope) {
    const criterion = criteria.find((c) => c.id === acId);
    if (criterion !== undefined && isAcSuperseded(criterion)) {
      superseded.push({ ac_id: acId, superseded_by: criterion.superseded_by as SupersededByRef });
    } else {
      live.push(acId);
    }
  }
  return { superseded, live };
}

// ─── Governing-Spec Resolution through the RECORDED spec ────────────────────

/**
 * One resolved "this spec governs that task" match — the spec doc plus its
 * already-schema-parsed acceptance criteria (avoids a second `safeParse` by the
 * caller).
 */
export interface GoverningSpecMatch {
  spec: DocRecord;
  criteria: AcceptanceCriterion[];
}

/**
 * The spec an ad-hoc task RECORDED as governing its criteria (`extra.governing_spec`, a spec id or
 * slug), or `undefined` when none is recorded. The single reader of that field.
 */
export function extractGoverningSpecRef(task: DocRecord): string | undefined {
  const raw = task.extra["governing_spec"];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/** The refusal for an ad-hoc task that has no recorded governing spec; names the command that records one. */
export function governingSpecMissingError(taskSlug: string): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "governing_spec",
    message:
      `ad-hoc task "${taskSlug}" records no governing spec, so its criteria cannot be resolved ` +
      `(an --adhoc task has no plan/spec link) — record one with 'lore scope spec ${taskSlug} <spec>' ` +
      "(on create: --spec <spec>).",
    value: taskSlug,
    rule: "BR-1495",
  };
}

/**
 * Resolves an ad-hoc task's criteria through the spec it recorded (`extra.governing_spec`) and nothing
 * else — the ONE governing-spec lookup every reader shares (evidence `--ac`, `lore verify --task`,
 * `check-ac-ref-integrity`, AC coverage). There is no search by criterion id: an id is unique only
 * within one spec, so a bare-id lookup breaks when a later spec reuses the id (issue #496).
 *
 * The recorded spec is accepted whatever its status (a deprecated or invalidated spec still governs
 * the history that cites it) and every criterion it declares is returned, superseded ones included
 * (BR-1494): an archived task's evidence must stay addressable.
 *
 * @param task - The ad-hoc task.
 * @param candidateSpecs - Every `spec`-typed doc (caller-fetched).
 * @param subjectLabel - Human-readable subject for the refusal, e.g. `ad-hoc task "slug"`.
 * @returns `ok({spec, criteria})`; `criteria` is empty when the spec declares none.
 * @throws (as `Result`) VALIDATION_ERROR field `governing_spec` — none recorded, or the recorded id/slug
 *   names no spec in `candidateSpecs`.
 */
export function resolveRecordedGoverningSpec(
  task: DocRecord,
  candidateSpecs: readonly DocRecord[],
  subjectLabel: string,
): Result<GoverningSpecMatch, LoreError> {
  const ref = extractGoverningSpecRef(task);
  if (ref === undefined) return err(governingSpecMissingError(task.slug));
  const spec = candidateSpecs.find((candidate) => candidate.id === ref || candidate.slug === ref);
  if (spec === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "governing_spec",
      message: `${subjectLabel} records governing spec "${ref}", which is not a spec in this corpus — re-record it with 'lore scope spec ${task.slug} <spec>'.`,
      value: ref,
      rule: "BR-1495",
    });
  }
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  return ok({ spec, criteria: parsed.success ? parsed.data : [] });
}

/**
 * The declared-scope check for an ad-hoc task (BR-1495): every id in `scopeIds` must be declared on
 * `spec` (superseded criteria count as declared, BR-1494).
 *
 * @returns `ok(undefined)`, or VALIDATION_ERROR field `ac_scope` naming the undeclared ids and the
 *   ids the spec does declare (exit 4).
 */
export function checkScopeDeclaredOnSpec(
  scopeIds: readonly string[],
  spec: DocRecord,
  subjectLabel: string,
): Result<undefined, LoreError> {
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  const declared = parsed.success ? parsed.data.map((c) => c.id) : [];
  const declaredSet = new Set(declared);
  const undeclared = scopeIds.filter((id) => !declaredSet.has(id));
  if (undeclared.length === 0) return ok(undefined);
  return err({
    code: "VALIDATION_ERROR",
    field: "ac_scope",
    message:
      `${subjectLabel}: ac_scope id(s) ${undeclared.join(", ")} are not declared on spec "${spec.slug}". ` +
      `Declared ids: ${declared.length > 0 ? declared.join(", ") : "(none)"}.`,
    value: undeclared,
    rule: "BR-1495",
  });
}

// ─── Mode-foreign criterion detail (ONE validator for `ac add` and `ac set`) ──

/** Which mode-specific criterion details a caller supplied (presence only, never the values). */
export interface CriterionDetailPresence {
  readonly oracle?: boolean;
  readonly command?: boolean;
  readonly timeout_ms?: boolean;
  readonly falsifier?: boolean;
  readonly rubric?: boolean;
  readonly note?: boolean;
}

/** A supplied detail that belongs to a different verify mode than the criterion's own. */
export interface ModeForeignDetail {
  readonly flag: string;
  readonly belongsTo: AcVerifyMode;
}

/** Fixed check order, so a caller passing several wrong details gets one deterministic refusal. */
const MODE_DETAIL_ORDER: ReadonlyArray<readonly [keyof CriterionDetailPresence, string, AcVerifyMode]> = [
  ["oracle", "--oracle", "script"],
  ["command", "--command", "script"],
  ["timeout_ms", "--timeout-ms", "script"],
  ["falsifier", "--falsifier-*", "script"],
  ["rubric", "--rubric", "ai"],
  ["note", "--note", "human"],
];

/**
 * The first supplied criterion detail that does not belong to `mode`, or `undefined`.
 * SSOT shared by `ac add` (before the criterion is built) and `ac set` (against the stored
 * criterion's mode) — a detail the target mode cannot hold must be refused, never dropped.
 */
export function findModeForeignDetail(mode: AcVerifyMode, supplied: CriterionDetailPresence): ModeForeignDetail | undefined {
  for (const [key, flag, belongsTo] of MODE_DETAIL_ORDER) {
    if (supplied[key] === true && belongsTo !== mode) return { flag, belongsTo };
  }
  return undefined;
}

/** The refusal text for a {@link ModeForeignDetail}; identical on `add` and `set`. */
export function modeForeignDetailMessage(acId: string, found: ModeForeignDetail, mode: AcVerifyMode): string {
  return `${found.flag} only applies to a "${found.belongsTo}"-mode criterion — "${acId}" is mode "${mode}"`;
}
