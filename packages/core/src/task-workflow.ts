/**
 * Task execution workflow metadata — evidence, claim lease, computed readiness.
 * Pure, browser-safe module: no IO, no Date.now() calls (callers pass nowIso).
 *
 * Public surface:
 *   - EVIDENCE_RESULTS / EvidenceResult — the `EvidenceEntry.result` vocabulary
 *     SSOT (mirrors ORACLE_KINDS' "tuple + derived type, no independent literal-
 *     array copies" shape)
 *   - evidenceEntrySchema / EvidenceEntry — one oracle verification record;
 *     `result` is `"pass" | "fail" | "inconclusive" | "expected-fail"` — the last
 *     two are non-green, non-special-cased-away values (see their own @invariant
 *     comments below) never counted as passing by any consumer
 *   - CAPTURE_SOURCES / CaptureSource — `EvidenceEntry.capture_source`'s vocabulary
 *     (`"runner" | "self-report"`, task-a-non-empty-output-tail-can-be-hand-
 *     authored-prose-and-the) — the REQUIRED discriminator distinguishing a tail
 *     the CLI itself spawned and captured from one the caller typed or read from
 *     a self-authored file; see the field-level @invariant on evidenceEntrySchema
 *   - classifyEvidenceResult(value) — narrows an untrusted string to
 *     {@link EvidenceResult}, THROWING {@link UnknownEvidenceResultError} for any
 *     value outside the vocabulary — never a silent default bucket
 *   - tallyEvidenceResults(rows) — the ONE exhaustive pass/fail/expected-fail/
 *     inconclusive counter every consumer that partitions evidence by outcome
 *     must call, instead of hand-rolling `.filter((e) => e.result === "pass")`
 *     style partitions that silently drop the non-green values into neither
 *     bucket (task-two-more-evidence-consumers-erase-an-expected-fail-row-doc)
 *   - ATTESTATION_RUNNERS / AttestationRunner — enum of trusted runners allowed to
 *     write `EvidenceEntry.attestation` (SPEC-039 §2 D1)
 *   - ORACLE_GENERATION_INITIAL / resolveOracleGeneration(declared) — the ONE
 *     "absent means generation 1" read rule shared by `AcceptanceCriterion
 *     .oracle_generation` (acceptance.ts) and `EvidenceEntry.ac_oracle_generation`
 *     (spec-the-defect-channel-cannot-be-honestly-maintained-an §M5, AC-DC-8)
 *   - taskClaimSchema / TaskClaim — advisory execution lease
 *     {by, at, branch?, machine?, worktree?, session_id?} — `session_id` is the
 *     captured SESSION INSTANCE, a peer of machine/worktree and never part of
 *     `by` (task-two-concurrent-orchestrators-both-resolve-to-agent-main)
 *   - isClaimStale(claim, nowIso, ttlMinutes) — pure staleness check
 *   - isClaimStaleForRun(claim, nowIso, ttlMinutes, liveness) — staleness that also reads the holder's run end
 *     and an `orphaned_dirty` mark (BR-1057/BR-1058); the caller supplies the measured facts
 *   - resolveTargetTask(tasks, opts) — pure host-task resolution for `lore verify`:
 *     explicit override > sole fresh claim > ambiguity error (SPEC-039 §2 D4)
 *   - isApprovedVerifyCommand(task, command) — pure command-provenance check: has this
 *     exact command been recorded before on this task's evidence history? (SPEC-039 §M2)
 *   - evaluateReadiness(...) — computed readiness report over blocks-links + statuses
 *   - ReadyRecord — flat per-task readiness record (D9: flat array, no phase grouping here)
 *
 * Invariants:
 *   - No IO, no wall-clock reads. Every function that needs "now" takes nowIso as a parameter.
 *   - evaluateReadiness never mutates its inputs.
 *   - A blocker is satisfied iff its status is "archived" (D3). Any other status keeps
 *     the blocked task unready.
 *   - Readiness itself is never stored — this module is consulted at read time only.
 *   - tallyEvidenceResults never drops a row: every input row's `result` lands in
 *     exactly one of the four returned counts (their sum always equals
 *     `rows.length`) — the exhaustive-partition property that removes the
 *     hand-rolled-two-bucket-filter defect class this module's callers used to
 *     each re-derive independently.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-025 §3 D1-D3, D9, D10; §8.2, §8.3; SPEC-039 §2 D1, D4; SPEC-039 §M2;
 *   SPEC-061 §Scope D2, D4; spec-workflow-hardening-evidence-red-vocabulary-claim-
 *   worktree §M1 (AC-WH-1, `"expected-fail"` result value);
 *   task-two-more-evidence-consumers-erase-an-expected-fail-row-doc (EVIDENCE_RESULTS
 *   extraction + classifyEvidenceResult/tallyEvidenceResults, the shared classifier
 *   `doc-type-meta.ts`/`evidence-panel.ts`/`phase-workflow-service.ts` now call
 *   instead of each hand-rolling their own pass/fail partition)
 */

import { z } from "zod";
import { ok, err } from "./errors.js";
import { CAPTURE_TAIL_CHARS } from "./context-variables.js";
import type { Result, LoreError } from "./errors.js";
import type { DocId, DocRecord, DocStatus, DocSummary, LinkRecord } from "./types.js";
import type { CompletenessVerdict } from "./attestation-completeness.js";
import { isTerminalStatus } from "./lifecycle.js";
import { MAX_FILE_ANCHORS, extractFileAnchors, normalizeFileAnchors } from "./file-anchors.js";

/**
 * `attestation.completeness`'s value set, mirrored here (not re-derived) from
 * `attestation-completeness.ts::CompletenessVerdict` so `evidenceEntrySchema`
 * has a concrete Zod enum to validate against (SPEC-061 §Scope D2/D4).
 * `satisfies readonly CompletenessVerdict[]` pins the "every listed literal is
 * a real CompletenessVerdict member" direction at the declaration itself.
 */
const COMPLETENESS_VERDICTS = [
  "complete",
  "under_match",
  "zero_match",
  "unknown_runner",
] as const satisfies readonly CompletenessVerdict[];

// Type-level exhaustiveness gate, other direction: every CompletenessVerdict
// member must appear in COMPLETENESS_VERDICTS. Combined with the `satisfies`
// above, the two enums cannot silently drift apart — mirrors acceptance.ts's
// `_scriptOraclesCoverAllButManual` precedent (never read at runtime; its
// sole purpose is to fail `tsc` on drift).
type _CompletenessVerdictsCoverAll = [CompletenessVerdict] extends [
  (typeof COMPLETENESS_VERDICTS)[number],
]
  ? true
  : never;
const _completenessVerdictsCoverAll: _CompletenessVerdictsCoverAll = true;
void _completenessVerdictsCoverAll;

// ─── Evidence Schema ───────────────────────────────────────────────────────

/**
 * Oracle kinds an evidence entry may record. SSOT for this enum — the taxonomy
 * previously lived as independent literal-array copies (this file,
 * `adapters/cli/commands/evidence.ts`, and a since-removed adapter); all now import
 * this tuple instead of redeclaring it (SPEC-038 §7 D3, AC-ACODE-8).
 *
 * @invariant `acceptance.ts`'s `SCRIPT_ORACLES` is a type-checked subset of this
 *   tuple (every kind except `"manual"`) — see that file's exhaustiveness gate.
 */
export const ORACLE_KINDS = ["tsc", "test", "lint", "build", "e2e", "manual", "other"] as const;

/** Derived TypeScript union for {@link EvidenceEntry.oracle}. */
export type OracleKind = (typeof ORACLE_KINDS)[number];

/**
 * Trusted-runner identities allowed to write {@link EvidenceEntry.attestation}
 * (SPEC-039 §2 D1). A tuple enum — not a bare `z.literal("lore-cli")` — mirroring
 * {@link ORACLE_KINDS}'s shape so a future remote/CI runner can be added here
 * without repeating the three-independent-copies mistake ORACLE_KINDS itself
 * consolidated away (SPEC-038 §7 D3).
 */
export const ATTESTATION_RUNNERS = ["lore-cli"] as const;

/** Derived TypeScript union for {@link EvidenceEntry.attestation}'s `runner` field. */
export type AttestationRunner = (typeof ATTESTATION_RUNNERS)[number];

/**
 * `EvidenceEntry.result` vocabulary. SSOT for this enum — mirrors
 * {@link ORACLE_KINDS}'s "tuple + derived type, no independent literal-array
 * copies" precedent (SPEC-038 §7 D3). Every consumer that partitions evidence
 * by outcome imports {@link tallyEvidenceResults} (built on this tuple) instead
 * of redeclaring the four literals or hand-rolling a `.filter((e) => e.result
 * === "pass")`-style two-bucket partition — the latter silently drops
 * `"expected-fail"`/`"inconclusive"` rows into NEITHER bucket, making a task
 * with a deliberate RED pin byte-identical to a task with no evidence at all
 * (task-two-more-evidence-consumers-erase-an-expected-fail-row-doc, the second
 * consecutive session two consumers were missed by this exact defect).
 */
export const EVIDENCE_RESULTS = ["pass", "fail", "inconclusive", "expected-fail"] as const;

/** Derived TypeScript union for {@link EvidenceEntry.result}. */
export type EvidenceResult = (typeof EVIDENCE_RESULTS)[number];

/**
 * `EvidenceEntry.capture_source` vocabulary (task-a-non-empty-output-tail-can-
 * be-hand-authored-prose-and-the) — mirrors {@link ORACLE_KINDS}/{@link
 * EVIDENCE_RESULTS}'s "tuple + derived type, no independent literal-array
 * copies" precedent. `"runner"` means this row's `output_tail` came from an
 * actual child-process spawn this exact call performed (`lore evidence
 * --capture`) OR from a `recordVerifiedEvidence`-attested row (`lore verify`
 * always spawns its own commands) — never from text the caller typed or read
 * from a file it authored. `"self-report"` means the tail (if any) was
 * supplied via `--output-tail`/`--output-tail-file` with no independent
 * confirmation it reflects a real run. Deliberately a STRUCTURAL discriminator
 * (which write path/mechanism produced the row), never inferred from the
 * tail's own shape/content — a shape-based guess is exactly the proxy
 * measured to fail twice (hand-authored prose containing a runner-summary-
 * looking substring passed a shape check cleanly).
 */
export const CAPTURE_SOURCES = ["runner", "self-report", "runner-unattested"] as const;

/** Derived TypeScript union for {@link EvidenceEntry.capture_source}. */
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

/**
 * The label the trusted runner stamps on a row it wrote itself that proves
 * NOTHING (green control failed / could not launch). Spawned by lore, therefore
 * not `"self-report"`; carries no attestation, therefore not `"runner"`.
 * Every consumer references this constant, never the bare literal
 * (spec-evidence-labels-and-reds-are-honest D1, issue #48, BR-1073).
 */
export const RUNNER_UNATTESTED_CAPTURE_SOURCE = "runner-unattested" satisfies CaptureSource;

/** Labels a PUBLIC write path (`lore evidence`) may carry — the runner-only label is excluded. */
export type PublicCaptureSource = Exclude<CaptureSource, typeof RUNNER_UNATTESTED_CAPTURE_SOURCE>;

/**
 * The ONE reader-side bucketing of a row's `capture_source`, shared by every
 * distribution/count surface (`lore status`, `lore assess`). An ABSENT value
 * (a legacy row) reads as `"self-report"`, never as "unknown, therefore fine".
 * `"runner-unattested"` is its own bucket — NOT attested, NOT self-reported.
 * The `never` default makes a future `CAPTURE_SOURCES` member a compile error here.
 */
export function classifyCaptureSource(captureSource: CaptureSource | undefined): CaptureSource {
  if (captureSource === undefined) return "self-report";
  switch (captureSource) {
    case "runner":
    case "self-report":
    case "runner-unattested":
      return captureSource;
    default: {
      const unreachable: never = captureSource;
      return unreachable;
    }
  }
}

/**
 * The ONE place the evidence writers decide a row's stored `capture_source`
 * (shared by `TaskWorkflowService` and `PhaseWorkflowService`, which may not
 * import each other).
 *
 * - `"runner-unattested"` + an attestation is a contradiction (the label says
 *   NOT attested) → `VALIDATION_ERROR`, nothing written.
 * - any other label + an attestation → `"runner"` (an attested row is proven
 *   runner-captured by construction).
 * - no attestation → the caller's label, verbatim.
 */
export function resolveWrittenCaptureSource(entry: {
  readonly capture_source: CaptureSource;
  readonly attestation?: unknown;
}): Result<CaptureSource, LoreError> {
  if (entry.attestation === undefined) return ok(entry.capture_source);
  if (entry.capture_source === RUNNER_UNATTESTED_CAPTURE_SOURCE) {
    return err({
      code: "VALIDATION_ERROR",
      field: "capture_source",
      message:
        `capture_source "${RUNNER_UNATTESTED_CAPTURE_SOURCE}" says the row carries no attestation, ` +
        'but one was supplied — a row is either attested ("runner") or unattested, never both.',
      value: entry.capture_source,
    });
  }
  return ok("runner");
}

/**
 * Refuses a PUBLIC write path's attempt to self-label a row
 * `"runner-unattested"` — that label is minted only by the trusted runner
 * (`VerifyRunnerService`) via `recordVerifiedEvidence`. Checked against the raw
 * value because the compile-time type can be bypassed with a cast.
 */
export function rejectSelfLabelledRunnerUnattested(captureSource: string): Result<void, LoreError> {
  if (captureSource !== RUNNER_UNATTESTED_CAPTURE_SOURCE) return ok(undefined);
  return err({
    code: "VALIDATION_ERROR",
    field: "capture_source",
    message:
      `capture_source "${RUNNER_UNATTESTED_CAPTURE_SOURCE}" is runner-issued; ` +
      "not a valid value for a caller-supplied evidence row.",
    value: captureSource,
    rule: "BR-1180",
  });
}

// ─── Oracle Generations (spec-the-defect-channel-cannot-be-honestly- ────────
// ─── maintained-an §M5, AC-DC-8) ────────────────────────────────────────────

/**
 * The oracle generation EVERY acceptance criterion starts in, and the value both
 * an absent `AcceptanceCriterion.oracle_generation` (`acceptance.ts`) and an
 * absent {@link EvidenceEntry.ac_oracle_generation} are read as — i.e. the whole
 * pre-M5 back-catalogue is generation 1, never "unknown".
 *
 * Lives HERE rather than beside the criterion schema it primarily describes
 * purely because of import direction: `acceptance.ts` already imports this
 * module ({@link extractEvidence}, {@link OracleKind}), so the reverse edge
 * would be a cycle. One constant, imported by both schemas — never a `1`
 * literal repeated in two `.min()` calls.
 */
export const ORACLE_GENERATION_INITIAL = 1;

/**
 * The ONE read rule for an oracle generation, shared by every consumer of either
 * spelling (`AcceptanceCriterion.oracle_generation` on the declaring side,
 * {@link EvidenceEntry.ac_oracle_generation} on the recorded side) — M5's
 * "absent means generation 1" stated exactly once, as code.
 *
 * TOTAL by construction: `undefined` (the pre-M5 back-catalogue) and any value
 * that is not a well-formed generation both read as
 * {@link ORACLE_GENERATION_INITIAL}. The second case is NOT a silent fallback
 * standing in for a required value — both Zod schemas constrain the field to an
 * integer ≥ 1, so the only inputs that can reach it are hand-built test
 * fixtures, exactly the premise `acceptance.ts`'s `isWellFormedFalsifiedCount`
 * (M5 of spec-oracle-tier-falsifiability-a-criterion-never-observed-red) was
 * built on: a `number` annotation is a compile-time claim the runtime does not
 * enforce. Named consequence, in the fail-CLOSED direction: a row whose stamp is
 * malformed reads as the INITIAL generation, so it is reported as
 * PRIOR-generation (flagged) for any criterion that has advanced — never
 * silently as current.
 *
 * @param declared - the stored generation, or `undefined` when the field is absent
 * @returns `declared` when it is an integer ≥ {@link ORACLE_GENERATION_INITIAL};
 *   {@link ORACLE_GENERATION_INITIAL} otherwise
 * @example
 * resolveOracleGeneration(undefined); // => 1 (the pre-M5 back-catalogue)
 * resolveOracleGeneration(3);         // => 3
 * resolveOracleGeneration(0);         // => 1 (not a well-formed generation)
 */
export function resolveOracleGeneration(declared: number | undefined): number {
  return isWellFormedOracleGeneration(declared) ? declared : ORACLE_GENERATION_INITIAL;
}

/**
 * Runtime well-formedness check behind {@link resolveOracleGeneration} — a
 * POSITIVE test ("is this usable as a generation"), deliberately not a list of
 * bad values: a "not a finite number" phrasing would leave a finite `0`/negative
 * matching no rule at all, the exact fail-open shape this predicate's sibling in
 * `acceptance.ts` was written to close.
 */
function isWellFormedOracleGeneration(value: number | undefined): value is number {
  return Number.isInteger(value) && (value as number) >= ORACLE_GENERATION_INITIAL;
}

// ─── SPEC-143 C1 — StateStamp + the immutable arming cutoff ─────────────────
// ─── (browser-safe: pure data, no git, no store, no clock) ──────────────────

/**
 * The identity of the state a verdict was measured against — SPEC-143 C1's
 * value object, and the missing half of every verdict this corpus stores today.
 *
 * Two coordinates because code state and corpus state move INDEPENDENTLY: a
 * peer can land a commit without writing a doc, and can write a doc without
 * touching the tree. One coordinate would make one of those invisible.
 *
 * - `head_sha` + `worktree_dirty` — the code state, the attestation's own
 *   coordinates (R13, user decision 2026-10-17: NO tree digest; a tree dirty at
 *   either read is never stamped, so `worktree_dirty` is the literal `false`).
 * - `corpus_rev` — the corpus state, `MAX(audit.id)`. Free to read: `audit.id`
 *   is `INTEGER PRIMARY KEY AUTOINCREMENT`, so `SELECT MAX(id)` is a rightmost
 *   B-tree descent, and the audit hash chain already commits the content behind
 *   that integer. OPTIONAL: the runner has no audit port and never invents one.
 *
 * ⛔ NEVER an mtime: git rewrites mtimes, so they are unusable as identity.
 * ⛔ PRESENT-IFF-COMPUTED. The stamp is `.optional()` on
 * {@link EvidenceEntry.attestation} for the same load-bearing reason
 * `attestation` itself is (see that field's invariant): `extractEvidence` parses
 * a task's WHOLE evidence array in one call, so a required field would
 * fail-close every array holding one pre-SPEC-143 row and silently zero that
 * task's entire evidence log. An ABSENT stamp is a FACT with a name —
 * `gate-predicates.ts::StampClass` classifies it `unbound` or `legacy_unbound`
 * against the corpus's arming row (`stamp-binding.ts::classifyStampAxis`) — never a default-to-current.
 *
 * @example
 * stateStampSchema.parse({
 *   head_sha: "7ab1d742c0f9e1b6a3d5c8e2f4b7a9d0c1e3f5a7",
 *   worktree_dirty: false,
 * });
 */
export const stateStampSchema = z.object({
  /** Full 40-hex git HEAD the runner read BEFORE and AFTER the command and found identical. */
  head_sha: z.string().regex(/^[0-9a-f]{40}$/, "head_sha must be a 40-hex git sha"),
  /**
   * ALWAYS `false`: a tree dirty at either read is demoted to `unbound`/`dirty_tree`
   * (see {@link STAMP_UNBOUND_REASONS}), never stamped, so a stamp can only certify a
   * committed tree. A literal makes "stamped on a dirty tree" unrepresentable.
   */
  worktree_dirty: z.literal(false),
  /**
   * `MAX(audit.id)` at capture time. OPTIONAL: the RUNNER has no audit port and must not
   * invent one; the per-row `recorded_corpus_rev` ({@link evidenceEntrySchema}) is written server-side.
   */
  corpus_rev: z.number().int().min(0).optional(),
});

/**
 * Why the runner demoted an attested run to `unbound` instead of stamping it (SPEC-143
 * AC-CT-5, R13). `state_moved`: the pre-run and post-run stamps differ. `dirty_tree`: the
 * tree was dirty at either read.
 */
export const STAMP_UNBOUND_REASONS = ["state_moved", "dirty_tree"] as const;

/** One member of {@link STAMP_UNBOUND_REASONS}. */
export type StampUnboundReason = (typeof STAMP_UNBOUND_REASONS)[number];

/** Derived TypeScript type for one state stamp — see {@link stateStampSchema}. */
export type StateStamp = z.infer<typeof stateStampSchema>;

/**
 * One oracle verification record, appended to task.extra.verification_evidence.
 * Append-only — entries are never edited or removed, only added (up to the 50-entry cap
 * enforced by taskExtraSchema in schemas.ts).
 *
 * @invariant output_tail is capped at CAPTURE_TAIL_CHARS — bounds document growth (SPEC-025 §5 risk table).
 * @invariant recorded_at is an ISO 8601 string set by the caller's time seam (D10), never
 *   generated inside this schema.
 * @invariant ac_ref is unconstrained format here (a free string) — validating that it
 *   names a *declared* acceptance criterion id is cross-entity and belongs to
 *   `TaskWorkflowService.addEvidence` (SPEC-038 §4 D4), not this schema layer.
 * @invariant `checklist_ref` (SPEC-056 §Design Decisions D8) is the phase-doc-typed
 *   sibling of `ac_ref` — an optional pointer to a `phase.extra.checklist[].id`
 *   instead of a spec-declared AC id. Also unconstrained format at this layer;
 *   cross-entity validation that it names an existing checklist item on the TARGET
 *   phase belongs to `PhaseWorkflowService`'s shared evidence-append path, mirroring
 *   `ac_ref`'s division of labor. ADDITIVE field — every pre-SPEC-056 evidence entry
 *   (which never carries it) still parses unchanged (REGRESSION).
 * @invariant `attestation` is runner-issued ONLY — public write paths (CLI `lore evidence`,
 *   alike) reject any input carrying this field with VALIDATION_ERROR
 *   (SPEC-039 §4 D2); `TaskWorkflowService.recordVerifiedEvidence` is the sole injection
 *   point. Staying `.optional()` here is load-bearing, not a style choice: {@link extractEvidence}
 *   parses the WHOLE `verification_evidence` array in one `z.array(evidenceEntrySchema)`
 *   call — making `attestation` required would fail-close every array containing a
 *   pre-SPEC-039 legacy entry, silently zeroing out all existing evidence for that task
 *   (SPEC-039 §9, evidence-based correction of the original draft).
 * @invariant `attestation.first_seen` (SPEC-039 §M2, command-provenance annotation) is
 *   set `true` by `VerifyRunnerService` iff {@link isApprovedVerifyCommand} returned
 *   `false` for this command at execution time — i.e. this run was the first time (or
 *   the first time after a change) this exact command string was executed for this
 *   task. Omitted (never `false`) for a previously-seen command.
 * @invariant `result: "inconclusive"` (SPEC-061 §Scope D2) is RUNNER-ISSUED ONLY, the
 *   same restriction §M2 already places on `attestation` itself — public write paths
 *   (CLI `lore evidence`) reject any input carrying this value
 *   loud (`TaskWorkflowService._addEvidenceImpl`'s explicit runtime check, mirroring its
 *   pre-existing `attestation` `hasOwnProperty` guard). It marks a `script:test` AC whose
 *   process exited 0 but whose declared test-file path arguments were NOT all matched by
 *   the runner (zero-match or under-match — a false-positive-attestation guard, SPEC-061)
 *   — never `"pass"` for that outcome, regardless of the real exit code. `computeAcCoverage`
 *   (`acceptance.ts`) never counts an `inconclusive` entry as `attested_pass`/`attested_fail`
 *   — it satisfies neither `=== "pass"` nor `=== "fail"` filter by construction, no special
 *   casing needed there.
 * @invariant `result: "expected-fail"` (spec-workflow-hardening-evidence-red-vocabulary-
 *   claim-worktree §M1) is the OPPOSITE restriction from `"inconclusive"`: it is
 *   SELF-REPORTED ONLY (a normal `lore evidence`/`lore_evidence_add` input value, never
 *   runner-issued), recording a RED-phase oracle run that fails BY DESIGN — a test
 *   written before its implementation lands, executed to confirm it fails for the
 *   right reason. It exists so a session never has to launder a deliberate RED result
 *   into a semantically-dishonest `"pass"` (the failure was expected, not a bug) or a
 *   confusing bare `"fail"` (indistinguishable from a real regression) just to record
 *   that the run happened. `computeAcCoverage`'s (`acceptance.ts`) `pass`/`fail`/
 *   `attested_pass`/`attested_fail` filters exclude `"expected-fail"` from BOTH
 *   buckets by exact-string construction — mirroring `"inconclusive"`'s identical
 *   property — but that module's `refs[]` still carries the raw value through for
 *   audit visibility, so nothing is actually lost there. `doc-type-meta.ts`'s
 *   `evidence_pass`/`evidence_fail` and `evidence-panel.ts`'s pass/fail tallies used
 *   to ALSO exclude it from both buckets, but with NO surviving raw-value channel —
 *   an `"expected-fail"`-only task rendered byte-identical to a task with zero
 *   evidence at all (task-two-more-evidence-consumers-erase-an-expected-fail-row-doc).
 *   Both now call {@link tallyEvidenceResults} and surface the excluded count in a
 *   dedicated field (`evidence_expected_fail` / `expected_fail_count`) instead of
 *   letting it vanish. NEVER counted as passing/green anywhere, but never silently
 *   erased either.
 * @invariant `attestation.completeness`/`attestation.executed_files` (SPEC-061 §Scope D4)
 *   are BOTH optional and present-iff-computed: only a `script:test` AC whose process
 *   exited 0 ever gets a completeness verdict computed at all (`VerifyRunnerService`); every
 *   other oracle kind, and every non-zero exit, leaves both fields absent — byte-identical
 *   to pre-SPEC-061 attestation objects (REGRESSION). `executed_files` is additionally
 *   present-iff-PARSED — a `completeness: "unknown_runner"` verdict (the runner's stdout
 *   carried no recognised summary line) never has an `executed_files` count to report.
 * @invariant `attestation.execution_root`/`attestation.execution_mode` (SPEC-063 §Design
 *   Decisions D3) are the directory `lore verify` actually spawned the command in and
 *   which of `verify-execution-root.ts::resolveVerifyExecutionRoot`'s two resolution
 *   paths produced it — closing the false-attestation vector where a linked git
 *   worktree's `lore verify` silently executed AC commands against the MAIN checkout
 *   instead of the worktree's own tree. Both optional and present-iff-computed: an
 *   evidence entry recorded before this change carries neither field and still parses
 *   (REGRESSION, AC-063-5); a run under this change always sets both together, on
 *   EVERY resolution (including `"corpus_root"`), so the field's mere absence always
 *   means "recorded before SPEC-063," never "this run happened to use the corpus root."
 * @invariant `capture_source` (task-a-non-empty-output-tail-can-be-hand-authored-
 *   prose-and-the) is REQUIRED for every NEW self-reported write (`TaskWorkflowService.
 *   _addEvidenceImpl` refuses a candidate lacking it) and ALWAYS forced to `"runner"`
 *   for any attested write (`appendEvidenceEntry` overrides whatever the caller passed
 *   whenever `attestation !== undefined` — an attested row is runner-captured by
 *   construction, SPEC-039's trusted-runner boundary already proves it). Staying
 *   `.optional()` HERE is load-bearing for the exact same reason `attestation` is
 *   (see that field's own invariant above): `extractEvidence`/`readEvidence` parse the
 *   WHOLE array in one call, so a required field would fail-close every array holding
 *   one pre-this-change legacy entry, silently zeroing a task's entire evidence log.
 *   A historical entry's ABSENT `capture_source` is read as `"self-report"` by any
 *   consumer that needs a concrete value (never "unknown, therefore fine") — never
 *   silently defaulted at the SCHEMA layer, only at the READ/aggregation layer that
 *   actually needs to classify old rows.
 * @invariant `ac_oracle_generation` (spec-the-defect-channel-cannot-be-honestly-
 *   maintained-an §M5, AC-DC-8) is the oracle generation that was in force for
 *   `ac_ref`'s declared criterion AT THE MOMENT THIS ROW WAS RECORDED — the recorded
 *   half of `AcceptanceCriterion.oracle_generation` (`acceptance.ts`), which
 *   `AcService.setCriterion` bumps whenever a script-mode `verify.command` is
 *   rewritten. It exists so `computeAcCoverage` can report evidence produced by a
 *   RETIRED oracle as prior-generation: the measured defect (spec §F3) is an AC whose
 *   command REVERSED POLARITY, leaving two mutually-exclusive attested passes that
 *   `deriveAcCoverageState` reads as ordinary green, because `fail_superseded` keys on
 *   a FAIL superseded by a newer attested pass and structurally cannot see two PASSES
 *   of opposite polarity.
 *   STAMPED BY THE WRITE PATH, NEVER SUPPLIED BY THE CALLER — the same restriction
 *   `attestation` carries, enforced the same way: both `EvidenceInput` and
 *   `VerifiedEvidenceInput` (`service/task-workflow-service.ts`) structurally exclude
 *   the field, and the shared `appendEvidenceEntry` chokepoint additionally runs an
 *   explicit `hasOwnProperty` check on the raw input so an `as EvidenceInput` cast
 *   cannot smuggle it past the type system. It is resolved from the REFERENCED
 *   CRITERION, never inferred from the command string or the tail's shape (the same
 *   reason `capture_source` is never shape-inferred).
 *   PRESENT-IFF-RESOLVED: a row with no `ac_ref` has no criterion to resolve against
 *   and carries no stamp at all; a row whose `ac_ref` cannot be resolved is REFUSED by
 *   the pre-existing cross-entity `ac_ref` check and never committed, so no committed
 *   row is ever left silently unstamped by a resolution failure. Staying `.optional()`
 *   here is load-bearing for the same reason `attestation`/`capture_source` are (see
 *   their own invariants above): `extractEvidence` parses the WHOLE array in one call,
 *   so a required field would fail-close every array holding one pre-M5 row and
 *   silently zero that task's entire evidence log. An ABSENT stamp is read as
 *   {@link ORACLE_GENERATION_INITIAL} by {@link resolveOracleGeneration} — the one
 *   shared read rule, never a per-consumer default.
 *
 * @example
 * evidenceEntrySchema.parse({
 *   oracle: "tsc", command: "bun run typecheck", result: "pass",
 *   recorded_at: "2026-07-02T10:00:00.000Z", recorded_by: "alice",
 * });
 *
 * @example
 * evidenceEntrySchema.parse({
 *   oracle: "test", command: "bunx vitest run packages/core", result: "pass",
 *   recorded_at: "2026-07-02T10:00:00.000Z", recorded_by: "alice", ac_ref: "AC-ACODE-1",
 * });
 *
 * @example
 * // runner-issued (SPEC-039) — never constructed by CLI input directly
 * evidenceEntrySchema.parse({
 *   oracle: "test", command: "bun test", result: "pass",
 *   recorded_at: "2026-07-08T10:00:00.000Z", recorded_by: "alice",
 *   attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1234, timed_out: false },
 * });
 */
export const evidenceEntrySchema = z.object({
  oracle: z.enum(ORACLE_KINDS),
  command: z.string().min(1),
  result: z.enum(EVIDENCE_RESULTS),
  output_tail: z.string().max(CAPTURE_TAIL_CHARS).optional(),
  recorded_at: z.string(),
  recorded_by: z.string().min(1),
  /** Optional pointer to a declared acceptance criterion id (SPEC-038 §4). */
  ac_ref: z.string().optional(),
  /** Optional pointer to a phase checklist item id (SPEC-056 §Design Decisions D8) — see the field-level invariant above. */
  checklist_ref: z.string().optional(),
  /** Discriminates a runner-captured tail from a self-reported one — see the field-level invariant above. */
  capture_source: z.enum(CAPTURE_SOURCES).optional(),
  /** The oracle generation in force for `ac_ref`'s criterion when this row was recorded (§M5) — see the field-level invariant above. */
  ac_oracle_generation: z.number().int().min(ORACLE_GENERATION_INITIAL).optional(),
  /**
   * `MAX(audit.id)` when this row was written (SPEC-143 AC-CT-3). SERVER-WRITTEN by the evidence
   * write chokepoint, never caller-supplied (the write paths refuse the key); it dates the row
   * against the corpus's arming audit row. OPTIONAL and present-iff-written: rows recorded before
   * this field existed carry none and are dated by the (doc_id, details.version) audit join.
   */
  recorded_corpus_rev: z.number().int().min(0).optional(),
  /**
   * Marks a row the milestone review's stale refresh wrote (BR-1372, spec-lean-governance Part D). A refresh row is
   * REPLACED by the next refresh of the same `ac_ref` + runner on the same task instead of appended, so repeated
   * batches never grow the log (Bazel action cache: one entry per action key). Present-iff-true; written only by the
   * trusted runner path (`VerifiedEvidenceInput`), never by a self-report.
   */
  milestone_refresh: z.literal(true).optional(),
  /**
   * `true` on a pass row `lore integrate` recorded after the oracle failed once and passed on its single re-run (AC-DCS2-4).
   * Present-iff-true; written only by `lore integrate` through the trusted runner path, never by a self-report. A flaky row counts
   * as evidence but is shown next to the row by `lore get` and `lore done`.
   */
  flaky: z.literal(true).optional(),
  /**
   * Why the flaky-tests ledger issue could not be filed or commented (AC-DCS2-4): present only on a `flaky` row whose ledger write
   * failed (no tracker configured, no network, a refusal). The landing still proceeds; the failure is recorded here, never dropped.
   */
  ledger_error: z.string().min(1).optional(),
  /** Runner-issued attestation metadata (SPEC-039 §2 D1) — see the field-level invariant above. */
  attestation: z
    .object({
      runner: z.enum(ATTESTATION_RUNNERS),
      exit_code: z.number().int(),
      duration_ms: z.number().int().min(0),
      timed_out: z.boolean(),
      /**
       * true iff this command was NEW/CHANGED relative to the task's evidence
       * history at the time it ran — i.e. it required command-provenance
       * approval (SPEC-039 §M2). OPTIONAL and OMITTED (never `false`) for a
       * previously-seen command — mirrors this module's "present-iff-true"
       * convention for `ReadyRecord.upstream_unapproved`/`anchorless`. Absent
       * on every pre-M2 attestation (additive field, REGRESSION-safe).
       */
      first_seen: z.boolean().optional(),
      /**
       * Completeness verdict for a `script:test` AC whose process exited 0
       * (SPEC-061 §Scope D4) — see the field-level invariant above. Absent
       * for every other oracle kind and every non-zero exit.
       */
      completeness: z.enum(COMPLETENESS_VERDICTS).optional(),
      /**
       * Count of test files the runner reported as actually executed
       * (SPEC-061 §Scope D4) — present iff {@link parseExecutedUnits} (in
       * `attestation-completeness.ts`) successfully parsed a count; absent
       * whenever `completeness` is `"unknown_runner"` or unset entirely.
       */
      executed_files: z.number().int().min(0).optional(),
      /**
       * The directory `lore verify` actually spawned this command in
       * (SPEC-063 §Design Decisions D3) — the `root` half of
       * `verify-execution-root.ts::resolveVerifyExecutionRoot`'s result,
       * always threaded onto every attestation `VerifyRunnerService` records
       * under SPEC-063 (both `corpus_root` and `worktree` resolutions), so a
       * past record can be audited for which tree it measured. OPTIONAL and
       * present-iff-computed — an evidence entry recorded before this change
       * carries neither field and still parses (REGRESSION, AC-063-5).
       */
      execution_root: z.string().min(1).optional(),
      /**
       * Which resolution path produced {@link execution_root} — see
       * `verify-execution-root.ts::VerifyExecutionMode`. Always present
       * alongside `execution_root` (never one without the other) on evidence
       * recorded under SPEC-063.
       */
      execution_mode: z.enum(["corpus_root", "worktree"]).optional(),
      /**
       * The state this attested run was measured against (SPEC-143 C1) — see
       * {@link stateStampSchema}. OPTIONAL and PRESENT-IFF-COMPUTED: every
       * pre-SPEC-143 attestation carries none and still parses (REGRESSION),
       * and its ABSENCE is classified against the corpus's arming row by
       * `stamp-binding.ts::classifyStampAxis` (`legacy_unbound` at or below the
       * cutoff, `unbound` above it) rather than read as "current".
       * ⛔ Written by the runner only, on the same terms as the enclosing
       * `attestation` object: `VerifyRunnerService` stamps it around the
       * command (SPEC-143 AC-CT-5), and no public write path may supply it.
       */
      state_stamp: stateStampSchema.optional(),
      /**
       * Present iff the runner READ a stamp before and after the command and refused to
       * certify it (SPEC-143 AC-CT-5): `state_moved` or `dirty_tree`. Mutually exclusive
       * with `state_stamp`. Absent when git could not answer (nothing measured, so no
       * reason is invented). Runner-issued only, like the enclosing `attestation`.
       */
      stamp_unbound_reason: z.enum(STAMP_UNBOUND_REASONS).optional(),
      /**
       * Full 40-hex git HEAD the runner measured this attested run at (baseline slice 1
       * §C5) — lets rule-state derivation decide ancestry without trusting the caller.
       * Read BEFORE and AFTER the command (SPEC-143 AC-CT-5); when the two differ the
       * runner omits it and sets `stamp_unbound_reason: "state_moved"`
       * (`verify-runner-service.ts::decideStampOutcome`), so it is never the post-run read alone.
       * OPTIONAL and present-iff-computed: pre-slice attestations carry none and still
       * parse (REGRESSION). ⛔ Runner-issued only, on the same terms as the enclosing
       * `attestation` object — no public write path may supply it.
       */
      head_sha: z.string().regex(/^[0-9a-f]{40}$/, "head_sha must be a 40-hex git sha").optional(),
      /**
       * Whether the working tree was dirty when the runner measured this run (baseline
       * slice 1 §C5). A dirty run's `head_sha` does not describe the measured code, so
       * consumers must treat it as unknown. Same optionality and runner-only rule as
       * `head_sha`.
       */
      worktree_dirty: z.boolean().optional(),
      /**
       * The integration branch's head when a pass was recorded on a NO-BRANCH claim (corpus-only work proven at main's
       * head): the pass counts only when `head_sha` equals it. Written by the evidence write path, never by a caller.
       */
      main_head: z.string().regex(/^[0-9a-f]{40}$/, "main_head must be a 40-hex git sha").optional(),
      /**
       * The landing commit (`extra.landing.landing_commit`) of the landing `lore integrate` recorded this row for (AC-DCS1-27 (b)):
       * a pass `lore done` counts for a code oracle without comparing trees while it names the task's newest landing. Written by
       * `lore integrate` only (never by a public write path, like the enclosing `attestation`); absent on every other row.
       */
      recorded_at_landing: z.string().regex(/^[0-9a-f]{40}$/, "recorded_at_landing must be a 40-hex git sha").optional(),
    })
    .optional(),
});

/** Derived TypeScript type for one verification evidence entry. */
export type EvidenceEntry = z.infer<typeof evidenceEntrySchema>;

// ─── Evidence Result Classifier (task-two-more-evidence-consumers-erase-an- ─
// ─── expected-fail-row-doc) — the shared partition every result-tallying ────
// ─── consumer must call instead of hand-rolling its own filter ─────────────

/**
 * Thrown by {@link classifyEvidenceResult} for any value outside
 * {@link EVIDENCE_RESULTS} — the fail-loud counterpart to a silent default
 * bucket. Carries the offending raw value for the caller/log to inspect.
 */
export class UnknownEvidenceResultError extends Error {
  readonly value: unknown;

  constructor(value: unknown) {
    super(`Unrecognised evidence result: ${JSON.stringify(value)}`);
    this.name = "UnknownEvidenceResultError";
    this.value = value;
  }
}

/**
 * Type guard narrowing an untrusted value to {@link EvidenceResult}.
 *
 * @param value - Any value, typically an already-parsed `EvidenceEntry.result`
 *   or a defensively-typed `string` read from a less-trusted source.
 * @returns `true` iff `value` is exactly one of {@link EVIDENCE_RESULTS}.
 */
export function isEvidenceResult(value: unknown): value is EvidenceResult {
  return typeof value === "string" && (EVIDENCE_RESULTS as readonly string[]).includes(value);
}

/**
 * Narrows an untrusted string to {@link EvidenceResult} — the shared
 * classifier every consumer that partitions evidence by outcome calls instead
 * of a hand-rolled `.filter((e) => e.result === "pass")`-style comparison.
 *
 * In practice this never throws when called on an already-`evidenceEntrySchema`-
 * parsed `EvidenceEntry.result` (Zod already narrowed it at the storage
 * boundary) — the throw path exists for defensive re-validation of a value
 * that bypassed that boundary (a hand-built fixture, a less-trusted read), so
 * a future fifth vocabulary value — or plain data corruption — fails loud at
 * the ONE classification site instead of silently landing in whichever
 * bucket a hand-rolled `else` happened to pick.
 *
 * @param value - The raw `result` string to classify.
 * @returns The narrowed {@link EvidenceResult}.
 * @throws {UnknownEvidenceResultError} if `value` is not one of {@link EVIDENCE_RESULTS}.
 * @example
 * classifyEvidenceResult("pass"); // => "pass"
 * @example
 * classifyEvidenceResult("bogus"); // throws UnknownEvidenceResultError
 */
export function classifyEvidenceResult(value: string): EvidenceResult {
  if (isEvidenceResult(value)) return value;
  throw new UnknownEvidenceResultError(value);
}

/**
 * Exhaustive 4-bucket count over {@link EVIDENCE_RESULTS} — every returned
 * count sums to the input length; no row is ever dropped. `expected_fail`/
 * `inconclusive` use underscores (not the hyphenated wire literal) to stay
 * valid identifiers — mirrors `AttestationSummary`'s snake_case field
 * convention (`evidence-panel.ts`).
 */
export interface EvidenceResultTally {
  pass: number;
  fail: number;
  expected_fail: number;
  inconclusive: number;
}

/**
 * Tallies a set of evidence-like rows into the exhaustive 4-bucket
 * {@link EvidenceResultTally} — the ONE partition every consumer that counts
 * evidence by outcome calls, instead of independently re-deriving
 * `.filter((e) => e.result === "pass")`/`"fail"` pairs that silently drop
 * `"expected-fail"`/`"inconclusive"` rows into neither bucket (the exact
 * defect task-two-more-evidence-consumers-erase-an-expected-fail-row-doc
 * removes from `doc-type-meta.ts` and `evidence-panel.ts`).
 *
 * @param rows - Any rows carrying a `result` field — `EvidenceEntry[]`,
 *   `EvidenceRefLite[]` (`acceptance.ts`), or an equivalent shape. Accepts the
 *   narrow structural type (not `EvidenceEntry[]`) so `acceptance.ts`'s
 *   `EvidenceRefLite[]` (which carries no `oracle`/`command`/`recorded_at`)
 *   can be tallied without a throwaway cast.
 * @returns Counts for all four vocabulary values; `pass + fail + expected_fail
 *   + inconclusive === rows.length` always.
 * @throws {UnknownEvidenceResultError} if any row's `result` is outside
 *   {@link EVIDENCE_RESULTS} — never silently bucketed.
 * @example
 * tallyEvidenceResults([{ result: "expected-fail" }]);
 * // => { pass: 0, fail: 0, expected_fail: 1, inconclusive: 0 }
 * @example
 * tallyEvidenceResults([]);
 * // => { pass: 0, fail: 0, expected_fail: 0, inconclusive: 0 }
 */
export function tallyEvidenceResults(rows: readonly { result: string }[]): EvidenceResultTally {
  const tally: EvidenceResultTally = { pass: 0, fail: 0, expected_fail: 0, inconclusive: 0 };
  for (const row of rows) {
    const classified = classifyEvidenceResult(row.result);
    switch (classified) {
      case "pass":
        tally.pass += 1;
        break;
      case "fail":
        tally.fail += 1;
        break;
      case "expected-fail":
        tally.expected_fail += 1;
        break;
      case "inconclusive":
        tally.inconclusive += 1;
        break;
      default: {
        // Exhaustiveness gate — a fifth EVIDENCE_RESULTS member fails `tsc`
        // here, never silently falls through uncounted.
        const _exhaustive: never = classified;
        void _exhaustive;
      }
    }
  }
  return tally;
}

// ─── Claim Schema ──────────────────────────────────────────────────────────

/**
 * Advisory execution lease on a task, stored at task.extra.claim.
 * Expiry is computed read-side via {@link isClaimStale} against a config TTL —
 * there is no daemon, no heartbeat (D2).
 *
 * @invariant `machine`/`worktree` are ADDITIVE fields (SPEC-042 §Design Decisions
 *   D2) — explicit-only, never auto-captured from `process.cwd()`/ambient state
 *   by this schema or by {@link buildTaskClaim}. An honest absent field beats a
 *   confidently-wrong captured value (review U2). Legacy claims written before
 *   this field existed remain valid (both optional).
 * @invariant `session_id` is the SESSION INSTANCE ("which run"), a THIRD captured
 *   execution fact beside `machine`/`worktree` — never a component of `by`
 *   ("who"). It exists because two concurrently-live sessions in ONE checkout
 *   legitimately share an actor string (this project's own discipline gives
 *   every main-checkout run the name `agent:main-orchestrator`), which used to
 *   collapse them into one derived session and disable `noAnchorOverlap`
 *   entirely (task-two-concurrent-orchestrators-both-resolve-to-agent-main).
 *   ABSENT is legal and load-bearing: every claim written before this field
 *   existed has none, and absence must read as NOT-MEASURED — never as
 *   "same session" (see `gate-predicates.ts::compareClaimSessions`).
 *
 * @example
 * taskClaimSchema.parse({
 *   by: "alice", at: "2026-07-02T10:00:00.000Z", branch: "feat/x",
 *   machine: "alices-mbp", worktree: "/repo/.worktrees/t1", session_id: "3de02220",
 * });
 */
export const taskClaimSchema = z.object({
  by: z.string().min(1),
  at: z.string(),
  branch: z.string().optional(),
  /** Auto-captured by the CLI as `os.hostname()`; explicit-only elsewhere (SPEC-042 D2). */
  machine: z.string().optional(),
  /** ALWAYS explicit — never auto-captured from `process.cwd()` (SPEC-042 D2, review U2). */
  worktree: z.string().optional(),
  /**
   * Sanitized session discriminator (`sessionIdDiscriminator`, `session-actor.ts`)
   * of `$CLAUDE_CODE_SESSION_ID`/`$CLAUDE_SESSION_ID`, captured at claim time by
   * `TaskWorkflowService.claim` for EVERY caller with no flag or opt-in. Absent
   * ⇒ this claim's session was never measured (legacy row, or a caller with no
   * session env) — NOT "the same session as yours".
   */
  session_id: z.string().optional(),
  /**
   * Claim-scoped corpus authoring (spec-baseline-slice-2 §C8, AC-BLS2-8, issue #39):
   * the slug of the ONE baseline branch this worktree session may write (rules, cites,
   * site maps) into the MAIN checkout's corpus. A LEASE FACT declared on the claiming
   * call and read back by `ForeignCorpusWriteGuard` — never an argv flag re-read later.
   * Absent ⇒ no corpus-authoring intent; a worktree session's baseline writes stay refused.
   * Like `worktree`, NEVER carried forward on a refresh (see {@link buildTaskClaim}).
   */
  corpus_scope: z.string().min(1).optional(),
  /**
   * The harness run that took this lease (spec-run-identity-slice-1 D6, BR-1040/BR-1352). Every claim written now
   * carries one (the store refuses a claim without a run); the schema still ACCEPTS an absent or null value only so a
   * claim written before runs existed can be read, shown and expired by the schema upgrade (`lore migrate schema`).
   * Compared by run only, never by `by`. Never carried forward on a refresh — the refreshing claimant's own run is
   * recorded.
   */
  harness_run: z.string().nullable().optional(),
  /**
   * Set when the holder's run ENDED while this claim's recorded worktree still had uncommitted changes
   * (spec-run-only-write-identity-and-run-end-claim-release D4, BR-1057): the claim is kept, not released,
   * and names the worktree whose work it protects. Exempt from age-based staleness (BR-1058) — it ends
   * only by `--steal` or when that worktree becomes clean. Never carried forward onto a new claim.
   */
  orphaned_dirty: z.object({ worktree: z.string().min(1), at: z.string() }).optional(),
  /**
   * Set on the claim written by a `--steal` of an `orphaned_dirty` claim: the dirty worktree the stealer
   * inherits (D4 — "whose output names the dirty worktree it inherits"). Informational; never decides anything.
   */
  inherited_dirty_worktree: z.string().min(1).optional(),
  /**
   * Set on the claim written by a takeover of a claim whose run had ended (#457, AC-RV-10): the ended run's id, so the
   * output names it. Informational; never decides anything.
   */
  took_over_ended_run: z.string().min(1).optional(),
  /**
   * The commit the claimed work started from: a branch claim's `base_sha`, or main's head for a no-branch claim.
   * Carried forward on a same-holder refresh (the work did not restart). The landing predicate (`landing.ts`) reads it.
   */
  start_head: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  /**
   * The newest tip of the claimed branch lore measured: at every evidence capture on the branch and at release.
   * The newest write wins, so a branch the harness removed without a release still has its last known tip.
   */
  end_tip: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  /**
   * The files the claim declares it will touch (`lore claim --write-set`, plus every edit-time `lore anchor declare`).
   * It judges OVERLAP only (the task-claim gate and the ready report); the oracle set never shrinks to it. Absent ⇒ the
   * task's approved anchors are the write set ({@link effectiveWriteSet}). No count cap: the 50-anchor cap bounds approved anchors.
   */
  write_set: z.array(z.string().min(1)).optional(),
  /**
   * When `lore finish` ended the claim's run of oracles (AC-DCS1-15). The claim stays held, marked finished, until `lore done` or
   * `lore land`. Both finished fields are written together, only by `lore finish`, and are in force only while the branch tip
   * equals `finished_commit` ({@link isFinishedInForce}); a later commit makes the claim an ordinary one again.
   */
  finished_at: z.string().optional(),
  /** The commit `lore finish` ran every oracle on (its `preRunHead`): the code the recorded rows are bound to. */
  finished_commit: z.string().regex(/^[0-9a-f]{40}$/).optional(),
}).refine((claim) => claim.branch === undefined || claim.start_head !== undefined, {
  // reason: after the one-time back-fill an open branch claim always has a sha start (no unmeasured variant, no read-time default).
  message: "a branch claim needs a sha start_head",
  path: ["start_head"],
}).refine((claim) => (claim.finished_at === undefined) === (claim.finished_commit === undefined), {
  // reason: finished_at and finished_commit describe one event; one without the other is a corrupt record, never a partial finish.
  message: "finished_at and finished_commit are written together",
  path: ["finished_commit"],
});

/** Derived TypeScript type for a task claim lease. */
export type TaskClaim = z.infer<typeof taskClaimSchema>;

/** Caller-supplied fields for {@link buildTaskClaim} — one claim-capture attempt. */
export interface ClaimCaptureInput {
  by: string;
  at: string;
  branch?: string;
  machine?: string;
  worktree?: string;
  /** See {@link taskClaimSchema}'s `session_id` — NEVER carried forward (see {@link buildTaskClaim}). */
  session_id?: string;
  /** See {@link taskClaimSchema}'s `corpus_scope` — explicit-only, NEVER carried forward. */
  corpus_scope?: string;
  /** See {@link taskClaimSchema}'s `harness_run` — the claimant's own run; NEVER carried forward. */
  harness_run?: string | null;
  /** See {@link taskClaimSchema}'s `start_head` — a carried-forward value wins over this one. */
  start_head?: string;
  /** See {@link taskClaimSchema}'s `write_set` — an omitted value on a same-holder refresh keeps the recorded set. */
  write_set?: readonly string[];
}

/**
 * Builds the {@link TaskClaim} a `claim()` write should persist, applying
 * SPEC-042 D2's carry-forward refresh rule.
 *
 * On a SAME-HOLDER FRESH refresh (`carryForward: true`), `branch`/`machine`/
 * `worktree` MERGE FORWARD from `previous` — an omitted field in `input`
 * inherits `previous`'s value; an explicitly re-passed field overrides it. On
 * any other transition (first acquire, steal, stale takeover, or a different
 * holder) — `carryForward: false` — the result carries ONLY the fields present
 * in `input`; nothing is inherited from `previous`, even when
 * `previous.by === input.by` (a stale takeover by the same actor still starts
 * fresh, SPEC-042 D2 — staleness breaks session continuity by design).
 *
 * Callers decide `carryForward` (typically
 * `existing !== undefined && !isClaimStale(existing, nowIso, ttl) && existing.by === input.by`)
 * — this function has no wall-clock access and cannot compute staleness itself
 * (module invariant: no IO, no wall-clock reads).
 *
 * `session_id` is the ONE field EXEMPT from carry-forward, in BOTH directions of
 * the `carryForward` flag: the result carries `input.session_id` or nothing.
 * Inheriting it would fabricate the exact evidence the field exists to supply —
 * a second session refreshing a same-`by` claim (the observed two-orchestrator
 * topology) would silently adopt the FIRST session's id and read back as "same
 * session" to `noAnchorOverlap`, re-opening the hole
 * (task-two-concurrent-orchestrators-both-resolve-to-agent-main §Silence). A
 * same-session refresh loses nothing: the capture re-reads the same env var and
 * re-supplies the identical id.
 *
 * @param previous - The task's current claim, or `undefined` if none.
 * @param input - The new claim-capture attempt.
 * @param carryForward - Whether to merge `previous`'s branch/machine/worktree
 *   forward when `input` omits them. Never applies to `session_id`.
 * @returns The `TaskClaim` to persist.
 *
 * @example
 * // same-holder fresh refresh — branch/machine/worktree inherited
 * buildTaskClaim(
 *   { by: "alice", at: "T0", branch: "b1", machine: "A", worktree: "/w" },
 *   { by: "alice", at: "T1" },
 *   true,
 * );
 * // => { by: "alice", at: "T1", branch: "b1", machine: "A", worktree: "/w" }
 *
 * @example
 * // stale takeover by the SAME actor — starts fresh, nothing inherited
 * buildTaskClaim(
 *   { by: "alice", at: "T0", branch: "b1", machine: "A", worktree: "/w" },
 *   { by: "alice", at: "T1" },
 *   false,
 * );
 * // => { by: "alice", at: "T1" }
 *
 * @example
 * // session_id is never inherited, even on a same-holder fresh refresh
 * buildTaskClaim(
 *   { by: "alice", at: "T0", session_id: "aaaa1111" },
 *   { by: "alice", at: "T1" },
 *   true,
 * );
 * // => { by: "alice", at: "T1" } — the refreshing session measured none, so none is recorded
 */
export function buildTaskClaim(
  previous: TaskClaim | undefined,
  input: ClaimCaptureInput,
  carryForward: boolean,
): TaskClaim {
  const base = carryForward ? previous : undefined;
  const branch = input.branch ?? base?.branch;
  const machine = input.machine ?? base?.machine;
  const worktree = input.worktree ?? base?.worktree;
  // reason: deliberately NOT `input.session_id ?? base?.session_id` — see the
  // carry-forward exemption paragraph in this function's own doc. A future
  // session "fixing the inconsistency" by adding the `??` re-opens the defect.
  const sessionId = input.session_id;
  // reason: corpus_scope is authorization intent, so like session_id it is NOT inherited
  // from `previous`: a refresh that omits it drops the scope rather than silently
  // re-granting write authority nobody re-declared (foreign-corpus-write-guard.ts header,
  // "a claim REFRESH must keep declaring intent explicitly").
  const corpusScope = input.corpus_scope;
  // reason: a same-holder refresh continues the same work, so the start it recorded first stays the start.
  const startHead = base?.start_head ?? input.start_head;
  const endTip = base?.end_tip;
  // reason: a same-holder refresh continues the same work, so the files it declared (at claim and at edit time) stay declared.
  const writeSet = input.write_set ?? base?.write_set;
  // reason: AC-DCS1-18 — a same-holder refresh continues the same work, so a finished mark stays; whether it is still in force is
  // decided by the branch tip ({@link isFinishedInForce}), never by dropping the mark here.
  const finishedAt = base?.finished_at;
  const finishedCommit = base?.finished_commit;

  return {
    by: input.by,
    at: input.at,
    ...(branch !== undefined ? { branch } : {}),
    ...(machine !== undefined ? { machine } : {}),
    ...(worktree !== undefined ? { worktree } : {}),
    ...(sessionId !== undefined ? { session_id: sessionId } : {}),
    ...(corpusScope !== undefined ? { corpus_scope: corpusScope } : {}),
    // reason: BR-1040 — a refresh records the REFRESHING run, never `?? base?.harness_run`; the store refuses a claim
    // that carries none (BR-1352).
    ...(input.harness_run !== undefined ? { harness_run: input.harness_run } : {}),
    ...(startHead !== undefined ? { start_head: startHead } : {}),
    ...(endTip !== undefined ? { end_tip: endTip } : {}),
    ...(writeSet !== undefined ? { write_set: [...writeSet] } : {}),
    ...(finishedAt !== undefined && finishedCommit !== undefined ? { finished_at: finishedAt, finished_commit: finishedCommit } : {}),
  };
}

/**
 * Validates and normalizes the entries of a claim write set with the anchor grammar (repo-relative POSIX path, a trailing `/`
 * for a directory, `path#Symbol`), WITHOUT the 50-entry cap: that cap bounds a task's approved anchors, never a claim's write
 * set. Duplicates after normalization are dropped, first occurrence wins.
 *
 * @example
 * normalizeWriteSet(["./src/a.ts", "src/a.ts", "tests/"]) // => ok(["src/a.ts", "tests/"])
 */
export function normalizeWriteSet(entries: readonly string[]): Result<string[], LoreError> {
  const normalized: string[] = [];
  for (let from = 0; from < entries.length; from += MAX_FILE_ANCHORS) {
    // reason: the grammar check lives in normalizeFileAnchors; it is fed one cap-sized slice at a time so that only the cap is not applied.
    const slice = normalizeFileAnchors(entries.slice(from, from + MAX_FILE_ANCHORS));
    if (!slice.ok) return slice;
    for (const entry of slice.value) if (!normalized.includes(entry)) normalized.push(entry);
  }
  return ok(normalized);
}

/**
 * The files a task is judged to touch for overlap: its held claim's declared write set, else its approved anchors.
 * Both overlap computations (the task-claim gate's sibling context and the ready report's anchor conflicts) call this and
 * nothing else, so they cannot disagree.
 *
 * @example
 * effectiveWriteSet(taskWithClaimWriteSet) // => the claim's write_set
 * effectiveWriteSet(taskHoldingNoClaim)    // => its file_anchors
 */
export function effectiveWriteSet(task: DocRecord): string[] {
  const claim = extractHeldClaim(task);
  if (claim === undefined) return extractFileAnchors(task);
  return claim.write_set ?? extractFileAnchors(task);
}

/**
 * Whether `claim` is finished and the finish still holds: it carries a finished commit and the branch tip measured now equals
 * it (AC-DCS1-18). A later commit moves the tip and makes the claim an ordinary one again (lease, overlap and run end); an
 * unmeasured tip (`undefined`) is never "finished". The ONE predicate behind the lease, staleness, run-end and overlap paths.
 *
 * @param claim - the held claim
 * @param tip - where the claim's branch ends now, as measured by the caller (`undefined` when it cannot be measured)
 * @example
 * isFinishedInForce({ by: "a", at: "t", finished_at: "t", finished_commit: "a".repeat(40) }, "a".repeat(40)); // => true
 * isFinishedInForce({ by: "a", at: "t", finished_at: "t", finished_commit: "a".repeat(40) }, "b".repeat(40)); // => false
 */
export function isFinishedInForce(claim: TaskClaim, tip: string | undefined): boolean {
  return claim.finished_commit !== undefined && tip !== undefined && tip === claim.finished_commit;
}

/**
 * The claim marked finished at `commit`: the finish event `lore finish` writes (with its rows) in one corpus write. Pure.
 *
 * @example
 * markClaimFinished({ by: "a", at: "t" }, "a".repeat(40), "t2").finished_commit // "aaa…a"
 */
export function markClaimFinished(claim: TaskClaim, commit: string, atIso: string): TaskClaim {
  return { ...claim, finished_at: atIso, finished_commit: commit, end_tip: commit };
}

/**
 * The claim with its tip updated to `sha`; the newest write wins. Pure: returns a new claim.
 *
 * @example
 * recordClaimTip({ by: "a", at: "t" }, "0".repeat(40)).end_tip // "000…0"
 */
export function recordClaimTip(claim: TaskClaim, sha: string): TaskClaim {
  return { ...claim, end_tip: sha };
}

// ─── Claim Staleness ───────────────────────────────────────────────────────

/**
 * Returns true when a claim's age exceeds the TTL — i.e. the lease is stale and
 * claimable without `--steal` (AC-WF-4).
 *
 * Boundary semantics: age exactly equal to `ttlMinutes` is NOT stale (strict `>`
 * comparison) — the claim remains fresh until the instant it crosses the threshold.
 *
 * @param claim - The claim to evaluate
 * @param nowIso - Caller-supplied current time (D10 time seam — never Date.now() here)
 * @param ttlMinutes - TTL in minutes (workflow.claim_ttl_minutes config value)
 * @returns true when the claim's age in minutes is strictly greater than ttlMinutes
 *
 * @example
 * isClaimStale({ by: "alice", at: "2026-07-02T08:00:00.000Z" }, "2026-07-02T10:01:00.000Z", 120)
 * // => true (121 minutes elapsed > 120 TTL)
 */
export function isClaimStale(claim: TaskClaim, nowIso: string, ttlMinutes: number): boolean {
  const ageMs = new Date(nowIso).getTime() - new Date(claim.at).getTime();
  return ageMs > ttlMinutes * 60_000;
}

/**
 * What a caller measured about a claim's holder, for {@link isClaimStaleForRun}. `worktreeClean` is
 * `true` only for a MEASURED clean worktree; `null` = not measured (no recorded worktree, not a repo,
 * git unavailable) — never conflated with clean (BR-1057's "never recorded as clean").
 */
export interface ClaimRunLiveness {
  readonly runEnded: boolean;
  readonly worktreeClean: boolean | null;
  /**
   * `true` only when nothing is left to protect: the recorded directory no longer exists, or the claim recorded no
   * worktree at all. A directory that exists but cannot be read is NOT gone (it stays protected, BR-1057).
   */
  readonly worktreeGone: boolean;
}

/**
 * Staleness of a claim once the holder's run end is taken into account (BR-1058):
 *   - an `orphaned_dirty` claim is exempt from age: stale iff its worktree is now MEASURED clean;
 *   - a claim whose run ended and whose worktree is MEASURED clean, or gone (missing, or never recorded), is stale
 *     at once; an ended run's worktree that still exists and is dirty stays protected (BR-1057);
 *   - anything else (open run, unreadable worktree, ended run with a dirty worktree) falls back to
 *     {@link isClaimStale}'s TTL — the crash/kill fallback.
 *
 * Pure: the caller does the git and run lookups and passes the facts in (module invariant: no IO).
 *
 * @example
 * isClaimStaleForRun({ by: "a", at: "2026-07-02T10:00:00.000Z" }, "2026-07-02T10:01:00.000Z", 120, { runEnded: true, worktreeClean: true, worktreeGone: false });
 * // => true (ended run, clean worktree) although only 1 minute old
 */
export function isClaimStaleForRun(
  claim: TaskClaim,
  nowIso: string,
  ttlMinutes: number,
  liveness: ClaimRunLiveness,
): boolean {
  // reason: an orphaned-dirty claim's dirty work is gone with its directory, so a gone worktree ends it too (#457).
  if (claim.orphaned_dirty !== undefined) return liveness.worktreeClean === true || liveness.worktreeGone === true;
  if (liveness.runEnded && (liveness.worktreeClean === true || liveness.worktreeGone === true)) return true;
  return isClaimStale(claim, nowIso, ttlMinutes);
}

// ─── Evidence-Triggered Claim Renewal (SPEC-069 §Design Decisions D4/D5) ────

/**
 * Refreshes a task's claim when the evidence recorder IS the current holder —
 * a session still producing evidence is alive, so TTL takeover should only
 * ever hit an actually-dead session (SPEC-069 D5, closes window W3). Matches
 * on `claim.by === actor` REGARDLESS of staleness (fresh OR stale) —
 * deliberately NOT gated by {@link isClaimStale}: a holder still actively
 * recording evidence is alive by construction, independent of how long ago
 * `claim.at` was set. This mirrors `claim()`'s own same-holder refresh
 * semantics ({@link buildTaskClaim}'s `carryForward` path).
 *
 * A foreign holder or an absent claim is left untouched (returns `null`) —
 * evidence never implicitly ACQUIRES a claim; only an already-held claim by
 * the SAME actor gets renewed (D5 — implicit acquisition via evidence would
 * break claim explicitness).
 *
 * @param claim - The task's current claim, or `undefined` if none.
 * @param actor - The evidence entry's `recorded_by` actor.
 * @param nowIso - Caller-supplied current time (D10 time seam). MUST be the
 *   exact same instant the caller stamps onto the triggering evidence entry's
 *   `recorded_at` — never a second, independently-captured timestamp — so a
 *   renewal and its triggering evidence entry always carry an identical
 *   instant (SPEC-069 §Module Boundary: "F2 must reuse the already-captured
 *   nowIso — never invoke the now() thunk twice").
 * @returns A NEW `TaskClaim` object with `at` set to `nowIso` — `branch`/
 *   `machine`/`worktree`/`session_id` preserved verbatim from `claim` — on a
 *   same-holder match; `null` when the claim is absent or held by a different
 *   actor. Never mutates `claim`. An evidence append deliberately does NOT
 *   re-capture the session instance: this renews an EXISTING lease (whose
 *   recorded session is whoever acquired it) rather than acquiring a new one —
 *   only `claim()` captures `session_id`
 *   (task-two-concurrent-orchestrators-both-resolve-to-agent-main).
 *
 * @example
 * renewClaimForEvidence({ by: "alice", at: "T0", branch: "b1" }, "alice", "T1");
 * // => { by: "alice", at: "T1", branch: "b1" }
 *
 * @example
 * renewClaimForEvidence({ by: "alice", at: "T0" }, "bob", "T1");
 * // => null (foreign holder — untouched, no renewal)
 *
 * @example
 * renewClaimForEvidence(undefined, "alice", "T1");
 * // => null (no claim to renew)
 */
export function renewClaimForEvidence(
  claim: TaskClaim | undefined,
  actor: string,
  nowIso: string,
): TaskClaim | null {
  if (claim === undefined || claim.by !== actor) return null;
  return { ...claim, at: nowIso };
}

// ─── Readiness ─────────────────────────────────────────────────────────────

/**
 * Upstream spec statuses that count as "approved enough" to clear an upstream gate.
 * SSOT for BOTH this module's `evaluateReadiness` (`upstream_unapproved` advisory)
 * AND `packages/lore/src/service/gate-predicates.ts`'s `upstreamApproved` write-path
 * gate — previously two independent `new Set(["approved"])` literals kept in sync
 * only by a comment cross-referencing each other (a duplication that could silently
 * drift). `gate-predicates.ts` cannot define this itself and have `@lore/core` import
 * it back — `@lore/core` is the leaf of the dependency graph and must not depend on
 * `@lore/lore` — so the shared fact lives here and the service layer imports it.
 *
 * @invariant Exactly `{"approved", "active"}` — `active` is past `approved` in the
 *   SPEC-002 lifecycle (`draft → in-review → approved → active → archived`), so it
 *   clears the gate too (spec-an-active-spec-counts-as-approved-for-claiming-its-tasks,
 *   BR-104 as modified, BR-111; resolves #52). Reason it is safe: a spec is a record
 *   (`packages/core/src/doc-standing.ts`), and a settled spec is locked — it cannot be
 *   "active but being revised". Revising one means `lore reopen` (back to `draft`,
 *   which is refused again) or writing a new spec. `draft`, `in-review`, `archived`
 *   and `deprecated` still refuse.
 */
export const UPSTREAM_APPROVED_STATUSES: ReadonlySet<string> = new Set(["approved", "active"]);

/**
 * Flat per-task readiness record (D9 — grouping by phase is a CLI presentation
 * concern, not part of this data shape).
 */
export interface ReadyRecord {
  task: DocSummary;
  /** task.extra.phase, when present (SPEC-023 phase grouping). */
  phase?: string;
  /** true iff task.status is not terminal AND every blocker is archived (D3). */
  ready: boolean;
  /** Blockers whose status is not yet "archived" — empty when ready is true. */
  unmet_blockers: Array<{ id: DocId; slug: string; status: DocStatus }>;
  /**
   * Blockers that are NOT archived but count as met because their work landed on the plan's declared
   * integration branch (`plan.extra.integration_branch`) — "met on <branch>, not on main". Present iff
   * non-empty (the module's present-iff-true convention). Such a blocker never appears in `unmet_blockers`.
   */
  met_on_integration?: Array<{ id: DocId; slug: string; status: DocStatus; branch: string }>;
  /** Present iff task.extra.claim is set; annotated with computed staleness/age. */
  claim?: TaskClaim & { stale: boolean; age_minutes: number };
  /**
   * Result + timestamp of the most recently appended evidence entry, if any.
   * `result` is reported VERBATIM — an `"expected-fail"` entry (spec-workflow-
   * hardening-evidence-red-vocabulary-claim-worktree §M1) surfaces here exactly as
   * recorded, never coerced toward `"pass"`/`"fail"`; it does not affect `ready`
   * (readiness is blocker-status-driven only, D3 — evidence is advisory here).
   */
  latest_evidence?: { result: "pass" | "fail" | "inconclusive" | "expected-fail"; recorded_at: string };
  /** Total number of verification_evidence entries recorded on the task. */
  evidence_count: number;
  /**
   * true iff the plan's parent doc is a spec whose status is not "approved"
   * (SPEC-032 §3.4). Advisory only — never affects `ready`. Omitted (not `false`)
   * when the plan has no spec parent (top-level or prd-parented) or the parent
   * spec is approved, matching this module's "present-iff-true" convention for
   * `claim`/`phase`.
   */
  upstream_unapproved?: boolean;
  /**
   * true iff this task holds a FRESH claim, declares NO `file_anchors` itself,
   * AND at least one sibling task in the same plan DOES declare non-empty
   * anchors (SPEC-042 D7, review U7). Advisory only — never affects `ready`.
   * Omitted (not `false`) when the condition doesn't hold, matching this
   * module's "present-iff-true" convention for `claim`/`phase`/
   * `upstream_unapproved`. A zero-adoption plan (no task anywhere declares
   * anchors) produces NO marker on any record — partial adoption is the risk
   * this advisory targets, not the absence of the feature entirely.
   * Computed by `TaskWorkflowService.ready` (not this pure module — it needs
   * plan-wide anchor comparison `evaluateReadiness` doesn't otherwise do).
   */
  anchorless?: boolean;
}

/**
 * Minimal blocker identity needed to render {@link ReadyRecord.unmet_blockers}.
 *
 * @invariant This is a deliberate widening of SPEC-025 §8.2's literal
 *   `ReadonlyMap<DocId, DocStatus>` signature to `ReadonlyMap<DocId, BlockerInfo>`.
 *   AC-WF-7 requires `unmet_blockers[].slug` in the output, which cannot be produced
 *   from a status-only map. See task-workflow-service.ts `ready()` for how the map
 *   is populated (one additional findMany, per §8.3 "one findMany for blocker statuses").
 */
export interface BlockerInfo {
  slug: string;
  status: DocStatus;
}

/**
 * Defensive `extra` accessor — `task.extra` is typed `Record<string, unknown>`, but a
 * corrupted/legacy store row (or a fuzzed test fixture, AC-36-10) may hand this a
 * `null`/non-object value at runtime. Indexing directly into that would throw before
 * the array/type guards in {@link extractEvidence} / {@link readClaimRecord} ever run.
 * Duplicated (not imported) from `doc-type-meta.ts`'s identical `safeExtra` helper to
 * avoid a reverse dependency — `doc-type-meta.ts` already depends on this file.
 */
function safeTaskExtra(task: DocRecord): Record<string, unknown> {
  const extra: unknown = task.extra;
  return extra !== null && typeof extra === "object" && !Array.isArray(extra)
    ? (extra as Record<string, unknown>)
    : {};
}

/**
 * Extracts the verification_evidence array from a task's extra field.
 * Returns [] when absent or malformed (defensive — extra is untyped storage).
 * Exported for reuse by `doc-type-meta.ts::deriveTypeMeta` (SPEC-036 §2 D3) — single
 * extraction point, not re-derived at the call site.
 */
export function extractEvidence(task: DocRecord): EvidenceEntry[] {
  const raw = safeTaskExtra(task)["verification_evidence"];
  if (!Array.isArray(raw)) return [];
  const parsed = z.array(evidenceEntrySchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * Reads the claim RECORDED on a row's `extra` field — what was stored, whoever it belongs to and
 * whatever the row's status. Returns undefined when absent or malformed (defensive — extra is untyped
 * storage). Use it for "what claim is on this row" questions (history, display, a row's own lifecycle
 * verbs). For "who holds / is working on this task now" use {@link extractHeldClaim}: a terminal task
 * holds nothing, however its stored claim reads.
 * Exported for reuse by `doc-type-meta.ts::deriveTypeMeta` (SPEC-036 §2 D3).
 */
export function readClaimRecord(task: DocRecord): TaskClaim | undefined {
  const raw = safeTaskExtra(task)["claim"];
  if (raw === undefined || raw === null) return undefined;
  const parsed = taskClaimSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The ONE definition of "this task holds a claim": its status is not terminal (no outgoing transition in
 * the lifecycle graph, `isTerminalStatus` — the authority the dashboard badge uses) AND it carries a valid
 * `extra.claim`. A terminal row's stored claim stays as history ({@link readClaimRecord}); it is not a held
 * claim, so archived rows need no migration. Every reader of "who is working on this now" goes through this.
 *
 * @example
 * extractHeldClaim({ status: "archived", type: "task", extra: { claim: { by: "a", at: "…" } } } as DocRecord); // => undefined
 */
export function extractHeldClaim(task: DocRecord): TaskClaim | undefined {
  if (isTerminalStatus(task.status, task.type)) return undefined;
  return readClaimRecord(task);
}

// ─── Command Provenance (SPEC-039 M2 trust-hardening) ──────────────────────

/**
 * Checks whether `command` already appears verbatim in a task's recorded
 * evidence history — the "known/accepted" ledger the `lore verify` command-
 * provenance approval gate consults before executing a script-mode AC's
 * command for real. A command absent from this history is "new or changed"
 * and requires explicit approval (interactive confirmation or an explicit
 * override flag) before the runner will execute it.
 *
 * @invariant Compares the command string EXACTLY (no normalization/trimming)
 *   — a single changed character (e.g. a flag added to a test command) makes
 *   the command "new" by design; silent fuzzy-matching would defeat the
 *   point of the gate.
 * @invariant Reads whatever evidence snapshot `task` carries at call time.
 *   `VerifyRunnerService` calls this once per AC against the SAME
 *   plan-bundle task snapshot fetched at the start of a `verifyPlan` run —
 *   two ACs sharing an identical, genuinely-new command within one run both
 *   evaluate as "new" (the snapshot is not updated mid-run); this is a
 *   documented, deliberate simplification, not a bug (SPEC-039 §M2).
 *
 * @param task - Full task DocRecord (its extra.verification_evidence is read via {@link extractEvidence})
 * @param command - The exact command string about to be executed (criterion.verify.command)
 * @returns true iff some prior evidence entry on this task recorded this EXACT command string
 *
 * @example
 * isApprovedVerifyCommand(task, "bun test") // true iff a prior evidence entry's command === "bun test"
 */
export function isApprovedVerifyCommand(task: DocRecord, command: string): boolean {
  return extractEvidence(task).some((entry) => entry.command === command);
}

// ─── Target Task Resolution (SPEC-039 §2 D4) ───────────────────────────────

/**
 * Resolves which task `lore verify` should record evidence against, out of a
 * plan's task set. Pure — takes all state as parameters, performs no IO, reads
 * no wall clock.
 *
 * Resolution order:
 *   1. `opts.explicitTaskIdOrSlug` is set → match it by `id` or `slug` among
 *      `tasks`; no match → `VALIDATION_ERROR` (an explicit override never falls
 *      through to claim-based heuristics, even if it would resolve ambiguity).
 *   2. Otherwise, filter `tasks` down to those holding a fresh (non-stale) claim
 *      via {@link readClaimRecord} + {@link isClaimStale}. Exactly one fresh claim →
 *      that task. Zero or more-than-one → `VALIDATION_ERROR` listing the
 *      candidate slugs (or, when zero, prompting for `--task`) — ambiguity is
 *      fail-loud, never a silent first-match guess (SPEC-039 §3).
 *
 * @param tasks - Candidate tasks (typically a plan's children via getPlanBundle)
 * @param opts.explicitTaskIdOrSlug - `--task` CLI flag, when given
 * @param opts.nowIso - Caller-supplied current time (D10 time seam — never Date.now() here)
 * @param opts.ttlMinutes - Claim TTL in minutes, forwarded to {@link isClaimStale}
 * @returns `ok(task)` on unambiguous resolution; `err(VALIDATION_ERROR)` otherwise
 *
 * @example
 * resolveTargetTask([taskA, taskB], { nowIso: "2026-07-08T10:00:00.000Z", ttlMinutes: 120 })
 * // taskA holds the sole fresh claim → ok(taskA)
 *
 * @example
 * resolveTargetTask([taskA, taskB], {
 *   explicitTaskIdOrSlug: "task-b-slug", nowIso: "2026-07-08T10:00:00.000Z", ttlMinutes: 120,
 * })
 * // explicit override wins regardless of claim state → ok(taskB)
 */
export function resolveTargetTask(
  tasks: DocRecord[],
  opts: { explicitTaskIdOrSlug?: string; nowIso: string; ttlMinutes: number },
): Result<DocRecord, LoreError> {
  const { explicitTaskIdOrSlug, nowIso, ttlMinutes } = opts;

  if (explicitTaskIdOrSlug !== undefined) {
    const match = tasks.find(
      (task) => task.id === explicitTaskIdOrSlug || task.slug === explicitTaskIdOrSlug,
    );
    if (match === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "task",
        message: `no task matching "${explicitTaskIdOrSlug}" among this plan's tasks`,
        value: explicitTaskIdOrSlug,
        rule: "BR-162",
      });
    }
    return ok(match);
  }

  const freshlyClaimed = tasks.filter((task) => {
    const claim = extractHeldClaim(task);
    return claim !== undefined && !isClaimStale(claim, nowIso, ttlMinutes);
  });

  if (freshlyClaimed.length === 1) {
    // reason: array access after an exact-length-1 filter check is always defined;
    // non-null assertion documents that invariant rather than widening the return
    // type to `DocRecord | undefined` for a case TypeScript cannot narrow on its own.
    return ok(freshlyClaimed[0]!);
  }

  const candidateSlugs = freshlyClaimed.map((task) => task.slug);
  const message =
    freshlyClaimed.length === 0
      ? "no task in this plan has a fresh claim — pass --task to select one explicitly"
      : `ambiguous target task — ${freshlyClaimed.length} tasks have a fresh claim (${candidateSlugs.join(", ")}); pass --task to disambiguate`;

  return err({ code: "VALIDATION_ERROR", field: "task", message, value: candidateSlugs, rule: "BR-162" });
}

/**
 * Builds the lightweight DocSummary projection of a task DocRecord.
 *
 * @invariant Deliberately omits `meta` — this projection backs `ReadyRecord.task`
 *   (`lore ready`, SPEC-025), which has never rendered type-differentiated metadata.
 *   Wiring `deriveTypeMeta` here is out of scope for SPEC-036 §2 D3 (CorpusService's
 *   projection is the one this spec upgrades); `tags`/`priority` are added only to
 *   satisfy DocSummary's now-required fields.
 */
function toDocSummary(doc: DocRecord): DocSummary {
  return {
    id: doc.id,
    slug: doc.slug,
    type: doc.type,
    title: doc.title,
    status: doc.status,
    updated_at: doc.updated_at,
    tags: doc.tags,
    priority: doc.priority,
  };
}

/**
 * Computes readiness for a set of tasks against their `blocks` links.
 * Pure — takes all state as parameters, performs no IO, reads no wall clock.
 *
 * Readiness rule (D3): a task is ready iff its status is not "archived" or
 * "deprecated" AND every blocker (doc on the `from` side of a `blocks` link
 * targeting the task) has status "archived".
 *
 * @param tasks - Task documents to evaluate (typically all children of one plan)
 * @param blocksLinks - `blocks`-type links where `to_id` is one of `tasks`' ids
 * @param blockerStatuses - Map from blocker DocId to its {slug, status}; see
 *   {@link BlockerInfo} for why this widens the §8.2 literal signature
 * @param nowIso - Caller-supplied current time (D10 — never Date.now() here)
 * @param ttlMinutes - Claim TTL in minutes, forwarded to {@link isClaimStale}
 * @param parentSpecStatus - Status of the plan's parent spec, or `null` when the
 *   plan has no spec parent (top-level plan, or parented under a prd instead).
 *   Defaults to `null` so pre-existing call sites that don't care about the
 *   spec-approval advisory keep compiling (SPEC-032 §3.4). When non-null and
 *   not `"approved"`, every returned record carries `upstream_unapproved: true` —
 *   this NEVER changes `ready` (advisory only, consistent with D3's no-daemon ethos).
 * @param landedOnIntegration - Blocker id → integration branch it landed on (computed by the service from
 *   git; this module stays pure). A listed, unarchived blocker counts as met and is reported in
 *   `met_on_integration`. Defaults to empty, so every pre-existing caller keeps "met only when archived".
 * @returns One ReadyRecord per input task, in input order
 *
 * @example
 * evaluateReadiness(
 *   [taskA, taskB],
 *   [{ from_id: taskA.id, to_id: taskB.id, link_type: "blocks", ... }],
 *   new Map([[taskA.id, { slug: taskA.slug, status: "draft" }]]),
 *   "2026-07-02T10:00:00.000Z",
 *   120,
 * );
 * // taskB.ready === false (taskA is an unarchived blocker)
 */
export function evaluateReadiness(
  tasks: DocRecord[],
  blocksLinks: LinkRecord[],
  blockerStatuses: ReadonlyMap<DocId, BlockerInfo>,
  nowIso: string,
  ttlMinutes: number,
  parentSpecStatus: DocStatus | null = null,
  landedOnIntegration: ReadonlyMap<DocId, string> = new Map(),
): ReadyRecord[] {
  return tasks.map((task) => {
    const incomingBlockers = blocksLinks.filter((link) => link.to_id === task.id);
    const unmetBlockers: Array<{ id: DocId; slug: string; status: DocStatus }> = [];
    const metOnIntegration: Array<{ id: DocId; slug: string; status: DocStatus; branch: string }> = [];
    for (const link of incomingBlockers) {
      const blocker = blockerStatuses.get(link.from_id);
      // reason: a blocker referenced by a link but absent from blockerStatuses (e.g. the
      // blocker doc was hard-removed from the corpus — soft-delete would still resolve)
      // is treated as an unmet blocker with status "draft" so the task is conservatively
      // reported not-ready rather than silently passing. Fail-loud-by-omission, not by throw,
      // since this is a pure read-side function with no Result channel.
      const status = blocker?.status ?? "draft";
      if (status !== "archived") {
        // reason: a blocker whose work landed on the plan's integration branch is met for readiness only —
        // its status stays unarchived (`lore done` judges landing against main), so it is reported apart
        // from archived blockers rather than silently dropped. Only a blocker the caller proved landed
        // (`landedOnIntegration`) qualifies; absence from the map keeps the original blocked behaviour.
        const branch = landedOnIntegration.get(link.from_id);
        if (branch !== undefined && blocker !== undefined) {
          metOnIntegration.push({ id: link.from_id, slug: blocker.slug, status, branch });
        } else {
          unmetBlockers.push({ id: link.from_id, slug: blocker?.slug ?? link.from_id, status });
        }
      }
    }

    const isTerminal = task.status === "archived" || task.status === "deprecated";
    const ready = !isTerminal && unmetBlockers.length === 0;

    const evidence = extractEvidence(task);
    // reason: a terminal task holds no claim (extractHeldClaim) — the ready record reports who holds it now.
    const claim = extractHeldClaim(task);
    const phase = task.extra["phase"];

    const record: ReadyRecord = {
      task: toDocSummary(task),
      ready,
      unmet_blockers: unmetBlockers,
      evidence_count: evidence.length,
    };

    if (metOnIntegration.length > 0) {
      record.met_on_integration = metOnIntegration;
    }

    if (typeof phase === "string") {
      record.phase = phase;
    }

    if (parentSpecStatus !== null && !UPSTREAM_APPROVED_STATUSES.has(parentSpecStatus)) {
      record.upstream_unapproved = true;
    }

    if (claim !== undefined) {
      record.claim = {
        ...claim,
        stale: isClaimStale(claim, nowIso, ttlMinutes),
        age_minutes: Math.floor(
          (new Date(nowIso).getTime() - new Date(claim.at).getTime()) / 60_000,
        ),
      };
    }

    const lastEvidence = evidence[evidence.length - 1];
    if (lastEvidence !== undefined) {
      record.latest_evidence = { result: lastEvidence.result, recorded_at: lastEvidence.recorded_at };
    }

    return record;
  });
}
