/**
 * Task execution workflow metadata — evidence, claim lease, computed readiness.
 * Pure, browser-safe module: no IO, no Date.now() calls (callers pass nowIso).
 *
 * Public surface:
 *   - evidenceEntrySchema / EvidenceEntry — one oracle verification record;
 *     `result` is `"pass" | "fail" | "inconclusive" | "expected-fail"` — the last
 *     two are non-green, non-special-cased-away values (see their own @invariant
 *     comments below) never counted as passing by any consumer
 *   - ATTESTATION_RUNNERS / AttestationRunner — enum of trusted runners allowed to
 *     write `EvidenceEntry.attestation` (SPEC-039 §2 D1)
 *   - taskClaimSchema / TaskClaim — advisory execution lease {by, at, branch?}
 *   - isClaimStale(claim, nowIso, ttlMinutes) — pure staleness check
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
 *
 * Side-effect class: pure
 *
 * Source: SPEC-025 §3 D1-D3, D9, D10; §8.2, §8.3; SPEC-039 §2 D1, D4; SPEC-039 §M2;
 *   SPEC-061 §Scope D2, D4; spec-workflow-hardening-evidence-red-vocabulary-claim-
 *   worktree §M1 (AC-WH-1, `"expected-fail"` result value)
 */

import { z } from "zod";
import { ok, err } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import type { DocId, DocRecord, DocStatus, DocSummary, LinkRecord } from "./types.js";
import type { CompletenessVerdict } from "./attestation-completeness.js";

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
 * previously lived as three independent literal-array copies (this file,
 * `adapters/mcp/tools.ts`, `adapters/cli/commands/evidence.ts`); all now import
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
 * One oracle verification record, appended to task.extra.verification_evidence.
 * Append-only — entries are never edited or removed, only added (up to the 50-entry cap
 * enforced by taskExtraSchema in schemas.ts).
 *
 * @invariant output_tail is capped at 4000 chars — bounds document growth (SPEC-025 §5 risk table).
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
 *   MCP `lore_evidence_add`) reject any input carrying this field with VALIDATION_ERROR
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
 *   (CLI `lore evidence`, MCP `lore_evidence_add`) reject any input carrying this value
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
 *   that the run happened. Every consumer that classifies evidence by exact-string
 *   comparison against `"pass"`/`"fail"` (`computeAcCoverage` in `acceptance.ts`,
 *   `evidence-panel.ts`'s pass/fail tallies, `doc-type-meta.ts`'s `evidence_pass`/
 *   `evidence_fail` counts) already excludes `"expected-fail"` from BOTH buckets by
 *   construction — mirrors `"inconclusive"`'s identical "satisfies neither filter, no
 *   special-casing needed" property. NEVER counted as passing/green anywhere.
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
 * // runner-issued (SPEC-039) — never constructed by CLI/MCP input directly
 * evidenceEntrySchema.parse({
 *   oracle: "test", command: "bun test", result: "pass",
 *   recorded_at: "2026-07-08T10:00:00.000Z", recorded_by: "alice",
 *   attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1234, timed_out: false },
 * });
 */
export const evidenceEntrySchema = z.object({
  oracle: z.enum(ORACLE_KINDS),
  command: z.string().min(1),
  result: z.enum(["pass", "fail", "inconclusive", "expected-fail"]),
  output_tail: z.string().max(4000).optional(),
  recorded_at: z.string(),
  recorded_by: z.string().min(1),
  /** Optional pointer to a declared acceptance criterion id (SPEC-038 §4). */
  ac_ref: z.string().optional(),
  /** Optional pointer to a phase checklist item id (SPEC-056 §Design Decisions D8) — see the field-level invariant above. */
  checklist_ref: z.string().optional(),
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
    })
    .optional(),
});

/** Derived TypeScript type for one verification evidence entry. */
export type EvidenceEntry = z.infer<typeof evidenceEntrySchema>;

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
 *
 * @example
 * taskClaimSchema.parse({
 *   by: "alice", at: "2026-07-02T10:00:00.000Z", branch: "feat/x",
 *   machine: "alices-mbp", worktree: "/repo/.worktrees/t1",
 * });
 */
export const taskClaimSchema = z.object({
  by: z.string().min(1),
  at: z.string(),
  branch: z.string().optional(),
  /** Auto-captured by the CLI as `os.hostname()`; explicit-only over MCP (SPEC-042 D2). */
  machine: z.string().optional(),
  /** ALWAYS explicit — never auto-captured from `process.cwd()` (SPEC-042 D2, review U2). */
  worktree: z.string().optional(),
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
 * @param previous - The task's current claim, or `undefined` if none.
 * @param input - The new claim-capture attempt.
 * @param carryForward - Whether to merge `previous`'s branch/machine/worktree
 *   forward when `input` omits them.
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

  return {
    by: input.by,
    at: input.at,
    ...(branch !== undefined ? { branch } : {}),
    ...(machine !== undefined ? { machine } : {}),
    ...(worktree !== undefined ? { worktree } : {}),
  };
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
 *   `machine`/`worktree` preserved verbatim from `claim` — on a same-holder
 *   match; `null` when the claim is absent or held by a different actor.
 *   Never mutates `claim`.
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
 * @invariant Deliberately `["approved"]` ONLY — `"active"` is NOT included, even
 *   though an `active` doc has moved past `approved` in the SPEC-002 lifecycle
 *   (`draft → in-review → approved → active → archived`). A spec can be
 *   `active`-but-being-revised; only `approved` is stable enough to clear an
 *   upstream gate. If a future caller needs `active` to also clear a gate, that is
 *   a new, deliberate product decision requiring its own spec amendment — not a
 *   default to fall into here.
 */
export const UPSTREAM_APPROVED_STATUSES: ReadonlySet<string> = new Set(["approved"]);

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
 * the array/type guards in {@link extractEvidence} / {@link extractClaim} ever run.
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
 * Extracts and validates the claim from a task's extra field.
 * Returns undefined when absent or malformed (defensive — extra is untyped storage).
 * Exported for reuse by `doc-type-meta.ts::deriveTypeMeta` (SPEC-036 §2 D3) — single
 * extraction point, not re-derived at the call site.
 */
export function extractClaim(task: DocRecord): TaskClaim | undefined {
  const raw = safeTaskExtra(task)["claim"];
  if (raw === undefined || raw === null) return undefined;
  const parsed = taskClaimSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
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
 *      via {@link extractClaim} + {@link isClaimStale}. Exactly one fresh claim →
 *      that task. Zero or more-than-one → `VALIDATION_ERROR` listing the
 *      candidate slugs (or, when zero, prompting for `--task`) — ambiguity is
 *      fail-loud, never a silent first-match guess (SPEC-039 §3).
 *
 * @param tasks - Candidate tasks (typically a plan's children via getPlanBundle)
 * @param opts.explicitTaskIdOrSlug - `--task` CLI flag / MCP `task` param, when given
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
      });
    }
    return ok(match);
  }

  const freshlyClaimed = tasks.filter((task) => {
    const claim = extractClaim(task);
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

  return err({ code: "VALIDATION_ERROR", field: "task", message, value: candidateSlugs });
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
): ReadyRecord[] {
  return tasks.map((task) => {
    const incomingBlockers = blocksLinks.filter((link) => link.to_id === task.id);
    const unmetBlockers: Array<{ id: DocId; slug: string; status: DocStatus }> = [];
    for (const link of incomingBlockers) {
      const blocker = blockerStatuses.get(link.from_id);
      // reason: a blocker referenced by a link but absent from blockerStatuses (e.g. the
      // blocker doc was hard-removed from the corpus — soft-delete would still resolve)
      // is treated as an unmet blocker with status "draft" so the task is conservatively
      // reported not-ready rather than silently passing. Fail-loud-by-omission, not by throw,
      // since this is a pure read-side function with no Result channel.
      const status = blocker?.status ?? "draft";
      if (status !== "archived") {
        unmetBlockers.push({ id: link.from_id, slug: blocker?.slug ?? link.from_id, status });
      }
    }

    const isTerminal = task.status === "archived" || task.status === "deprecated";
    const ready = !isTerminal && unmetBlockers.length === 0;

    const evidence = extractEvidence(task);
    const claim = extractClaim(task);
    const phase = task.extra["phase"];

    const record: ReadyRecord = {
      task: toDocSummary(task),
      ready,
      unmet_blockers: unmetBlockers,
      evidence_count: evidence.length,
    };

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
