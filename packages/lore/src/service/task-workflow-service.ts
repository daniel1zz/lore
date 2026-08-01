/**
 * TaskWorkflowService — evidence, claim lease, and computed readiness for task docs.
 *
 * Owns task.extra.claim and task.extra.verification_evidence exclusively. Writes go
 * directly through StoreInterface (never through CorpusService — cross-service calls
 * are forbidden by service/CLAUDE.md, and this service never touches content/title/
 * status so CorpusService's approved→draft demotion invariant is unreachable from
 * here by construction). Own telemetry wiring restores parity with CorpusService.
 *
 * Public surface:
 *   addEvidence(idOrSlug, entry, now?)     → append one SELF-REPORTED oracle verification record
 *   recordVerifiedEvidence(idOrSlug, entry, nowIso) → append a RUNNER-ATTESTED record —
 *                                             the SOLE injection point for `attestation`
 *                                             (SPEC-039 §2 D2); NOT registered on any
 *                                             CLI/MCP surface, VerifyRunnerService-only
 *   claim(idOrSlug, opts, now?)            → acquire/refresh/steal the advisory lease
 *   release(idOrSlug, opts, now?)          → clear the advisory lease
 *   done(idOrSlug, opts, now?)             → evidence-validated atomic lifecycle walk
 *                                             to `archived` (spec-workflow-hardening-
 *                                             evidence-red-vocabulary-claim-worktree
 *                                             §M3, AC-WH-3); idempotent on an
 *                                             already-terminal task
 *   ready(planIdOrSlug, now?)              → computed readiness report (zero writes)
 *   readyAdhoc(now?)                       → OPEN ad-hoc (planless) task listing (zero
 *                                             writes, SPEC-069 D2) — the `--adhoc`
 *                                             counterpart to `ready()`, corpus-wide
 *                                             rather than plan-scoped
 *
 * @invariant All public methods return Promise<Result<T, LoreError>> — no thrown exceptions.
 * @invariant Every write carries the read version as a CAS guard (store.update's
 *   expected_version) — a concurrent writer wins the race, the loser gets STALE_VERSION.
 * @invariant Every successful write bumps the task's version and appends one VersionRecord
 *   (action: "update") so `lore log` shows who claimed/released/added evidence and when.
 * @invariant addEvidence/claim/release/recordVerifiedEvidence touch ONLY extra.claim /
 *   extra.verification_evidence — never content, title, or status. Bounded exception
 *   (SPEC-069 §Design Decisions D4/D5): when the evidence recorder IS the current
 *   fresh-OR-stale claim holder, `appendEvidenceEntry` folds a `renewClaimForEvidence`-
 *   refreshed `extra.claim` (same `at` as the evidence's `recorded_at`) into the SAME
 *   CAS write as the evidence append — still `extra.claim` only, never a second write,
 *   never content/title/status. A foreign holder's claim is left byte-identical.
 * @invariant ready() performs zero writes — readiness is computed, never stored (D3).
 * @invariant addEvidence's optional `ac_ref` is cross-entity validated via a
 *   constructor-injected port (CorpusService owns the actual graph walk — this
 *   service never gains that responsibility itself, SPEC-038 §7 D4) — `resolveDeclaredAcIds`
 *   (plan→spec walk) for a plan-owned task, `resolveAdhocGoverningAcIds` (ac_scope→spec
 *   search, task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref) for an
 *   `--adhoc` one (`task.extra.adhoc === true`) — the branch that decides which port
 *   to consult. An `ac_ref` naming an id absent from the port's result (or, plan-owned
 *   only, a `null` result meaning "parent spec has no structured AC") fails loud with
 *   VALIDATION_ERROR before any write. Evidence with no `ac_ref` never invokes either
 *   port — fully backward-compatible with pre-SPEC-038 callers. The same cross-entity
 *   check applies to `recordVerifiedEvidence` (shared implementation, see below).
 * @invariant addEvidence rejects a placeholder/probe `command` (task task-reject-
 *   placeholder-command-strings-at-evidence-write-time) — trimmed length < 3 and
 *   not in `ALLOWED_SHORT_EVIDENCE_COMMANDS` fails loud with VALIDATION_ERROR
 *   BEFORE any write (`rejectPlaceholderEvidenceCommand`). WRITE-PATH ONLY: the
 *   shared `evidenceEntrySchema.command` stays `z.string().min(1)` deliberately
 *   untouched, so a task whose evidence log already holds a historical placeholder
 *   entry (recorded before this guard existed) still reads back EVERY entry
 *   (`readEvidence`'s array-level `safeParse` is all-or-nothing — tightening the
 *   shared schema would have silently zeroed that task's whole evidence array).
 *   `recordVerifiedEvidence` is deliberately EXEMPT — its `command` is
 *   runner-attested, never hand-typed.
 * @invariant `attestation` is runner-issued ONLY (SPEC-039 §2 D2, anti-spoofing) — the
 *   public `EvidenceInput` type (addEvidence) structurally EXCLUDES the field, but a
 *   caller can still smuggle it past the type system with an `as EvidenceInput`
 *   assertion on an untyped object (the exact shape `adapters/cli/commands/*.ts`
 *   assembles candidate objects in). `addEvidence` therefore runs an EXPLICIT runtime
 *   `hasOwnProperty` check on the raw input and fails loud with VALIDATION_ERROR — it
 *   never silently strips the key. `recordVerifiedEvidence` is the only method that
 *   accepts `attestation`, and it is never wired to a CLI/MCP surface (VerifyRunnerService
 *   is its sole caller, bound in app.ts the same way `resolveDeclaredAcIds` is bound).
 * @invariant addEvidence and recordVerifiedEvidence share ONE append implementation
 *   (private `appendEvidenceEntry`) — cap check, schema validation, ac_ref cross-entity
 *   validation, and the writeTaskExtra commit path are never duplicated between them.
 * @invariant `claim()` is write-then-verify, not just gate-then-write (BUG-011 TOCTOU
 *   hardening) — the pre-write `enforceClaimGate` call's sibling-claim snapshot can go
 *   stale in the gap before this method's own CAS write commits (per-doc CAS alone
 *   cannot protect a CROSS-row invariant like "no two anchor-overlapping siblings both
 *   hold a fresh claim"). After a successful write, `claim()` re-runs the identical
 *   gate check against a FRESH read; a conflict now detected self-rolls-back the just-
 *   written claim (`rollbackClaim`, CAS-guarded) and returns the same anchor-overlap
 *   gate error a pre-write rejection would have. Two racing claims may both roll back
 *   (accepted residual — loud, retriable; see `rollbackClaim`'s JSDoc for why a
 *   deterministic tiebreak was rejected). No lock table / daemon / mutex row was added.
 *
 * @invariant `done()` is the ONLY method that writes `status` (every other method here
 *   touches `extra` exclusively via `writeTaskExtra` — see that method's own
 *   @invariant). It walks {@link computeArchiveWalk}'s canonical multi-step path to
 *   `"archived"` ONE STEP AT A TIME via the sibling `writeTaskStatus` (own CAS write,
 *   own versions row, own audit entry per step — AC-WH-3's "one audit row per
 *   lifecycle step"), never the type-scoped single-hop `draft -> archived` shortcut
 *   `DRAFT_TO_ARCHIVED_ALLOWED_TYPES` (`packages/core/src/schemas.ts`) grants task
 *   docs — that shortcut belongs to the ARCHIVE-SWEEP mechanism (spec-lifecycle-
 *   archival-plan-close-cascade-deterministic §D3), a DIFFERENT, REJECTED alternative
 *   for `done` (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree
 *   §Overview "(c)"). "Atomic" describes the caller's experience (one command) not a
 *   single store transaction — see `done()`'s own JSDoc for the mid-walk-failure
 *   contract. Refuses (VALIDATION_ERROR) with no passing (`result: "pass"`) evidence
 *   or a fresh foreign claim; an already-terminal task is an idempotent no-op, never
 *   an error — see `DoneResult`'s own JSDoc.
 *
 * Side-effect class: IO (reads/writes via StoreInterface; emits telemetry).
 * Source: SPEC-025 §3 D2, D3, D5, D7, D8, D10; §4 AC-WF-1..11; §8.2, §8.3; SPEC-038 §4, §7 D4;
 *         SPEC-039 §2 D2, §4 AC-VRF-2; BUG-011 (anchor-overlap gate TOCTOU hardening);
 *         spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3, AC-WH-3
 */

import { z } from "zod";
import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import type { ActorSource } from "@lore/core/node";
import {
  evidenceEntrySchema,
  taskClaimSchema,
  isClaimStale,
  isValidTransition,
  evaluateReadiness,
  buildTaskClaim,
  renewClaimForEvidence,
  deriveSessions,
  normalizeFileAnchors,
  extractFileAnchors,
  anchorsOverlap,
  computeAcScopeEdit,
  extractDeclaredAcScope,
  type AcScopeEditOp,
  type EvidenceEntry,
  type TaskClaim,
  type ReadyRecord,
  type BlockerInfo,
  type ReadySession,
} from "@lore/core";
import type { DocId, DocRecord, DocStatus } from "@lore/core";
import { NoOpTelemetry, type Telemetry, type TelemetryEvent, type TaskWorkflowEventName } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";
import { buildUpstreamSpecContext, buildAnchorGateContext, isNonPlanParentError } from "./checkpoint-registry.js";
import type { GateDependencies } from "./gate-enforcer.js";

// ─── Public Types ──────────────────────────────────────────────────────────

/** Options for {@link TaskWorkflowService.claim}. */
export interface ClaimOpts {
  /** Resolved actor identity (CLI: --by > $LORE_ACTOR > OS username). */
  by: string;
  /** Optional git branch where the work is happening (SPEC-025 non-goal: no worktree paths). */
  branch?: string;
  /**
   * Optional machine identity (SPEC-042 D2) — CLI auto-captures `os.hostname()`;
   * MCP callers pass it explicitly. Feeds the D1 session-grouping key.
   */
  machine?: string;
  /**
   * Optional worktree path (SPEC-042 D2) — ALWAYS explicit, never auto-captured
   * from `process.cwd()` (review U2: an orchestrator's cwd would describe the
   * dispatcher, not the worktree the work happens in). Feeds the D1
   * session-grouping key.
   */
  worktree?: string;
  /**
   * How `by` was resolved (spec claim-time-actor-identity-guard-zero-evidence-
   * release-advis, AC-IDENTITY-REJECT) — CLI: `resolveActorWithIdentitySource`'s
   * `--by` flag > `$LORE_ACTOR` > SPEC-071 session tier > OS-username-fallback
   * chain (`ActorSource`, `@lore/core/node`); MCP: always `"explicit"` (`by` is
   * a required, always-explicit tool argument, SPEC-024). `undefined` (a caller
   * that never resolved/threaded one — e.g. a hand-built test `ClaimOpts`)
   * behaves identically to any non-`"os-fallback"` value: `actorIdentityGuard`
   * (`gate-predicates.ts`) is a vacuous pass. GATE-CONTEXT-ONLY — never
   * persisted onto the written `TaskClaim` (spec §Scope: "OUT: storing
   * identity source on the doc").
   */
  identitySource?: ActorSource;
  /** Override even a fresh (non-stale) claim held by someone else. */
  steal?: boolean;
  /**
   * Caller-surface discriminator (e.g. "cli", "mcp") embedded in the emitted telemetry
   * event's meta.source. Not part of SPEC-025 §8.2's literal ClaimOpts shape — added
   * because TaskWorkflowService's ratified constructor has no App/callerSurface
   * dependency, so AC-WF-11's "carrying the caller-surface source discriminator"
   * can only be satisfied by the caller passing it through explicitly.
   */
  source?: string;
}

/** Options for {@link TaskWorkflowService.release}. */
export interface ReleaseOpts {
  /** Resolved actor identity. */
  by: string;
  /** Optional free-text reason (e.g. a failure summary), recorded in version history. */
  reason?: string;
  /** Release even when `by` is not the current holder. */
  force?: boolean;
  /** See {@link ClaimOpts.source}. */
  source?: string;
}

/** Options for {@link TaskWorkflowService.done} / {@link PhaseWorkflowService.done}. */
export interface DoneOpts {
  /**
   * Resolved actor identity — recorded on EVERY lifecycle step's version history
   * entry and audit row this call produces, and checked against a fresh claim's
   * `by` (a fresh claim held by a DIFFERENT actor refuses the whole call).
   */
  by: string;
  /** See {@link ClaimOpts.source}. */
  source?: string;
}

/**
 * {@link TaskWorkflowService.done}'s return shape (spec-workflow-hardening-evidence-red-
 * vocabulary-claim-worktree §M3, AC-WH-3).
 *
 * `already_done: true` marks the IDEMPOTENT NO-OP branch — `idOrSlug` was ALREADY at a
 * terminal status (`archived`/`deprecated`) before this call; `task` is the doc
 * UNCHANGED (no write happened) and `transitions` is `[]`. `already_done: false` marks a
 * real walk: `transitions` lists every status stepped through, IN ORDER, ending in
 * `"archived"` — one entry per audited write {@link TaskWorkflowService.done}'s own
 * JSDoc describes.
 */
export interface DoneResult {
  task: DocRecord;
  already_done: boolean;
  transitions: DocStatus[];
  /**
   * Present ONLY when this call performed a real archive walk (never on the
   * `already_done: true` idempotent no-op branch) AND that walk made the
   * task's parent PLAN's every child task terminal (`archived`/`deprecated`)
   * while the plan itself is still non-terminal (spec-plan-closure-must-be-
   * loud-terminality-divergence-silent DD-2, AC-CLOSURE-3). A pure FACT — no
   * plan document is read-modify-written to produce it, and `done()` never
   * writes the plan (Invariant 1: `done` announces, it never closes; the
   * `plan-close` gate remains the sole path to actually archiving the plan).
   * `undefined` for: a non-last task, an adhoc/planless task (no `plan`-typed
   * parent), or a plan that is already terminal.
   */
  plan_now_fully_terminal?: { plan_slug: string };
}

/**
 * Evidence input for {@link TaskWorkflowService.addEvidence} — recorded_at is set by the
 * service. `attestation` is structurally EXCLUDED (SPEC-039 §2 D2, §4 AC-VRF-2) — it is
 * runner-issued only, via {@link TaskWorkflowService.recordVerifiedEvidence}. addEvidence
 * additionally runs a runtime check against the raw input object (not just this type) so
 * an `as EvidenceInput` cast on an untyped candidate cannot smuggle the field past the
 * type system — see the class-level @invariant. `result` is likewise narrowed to EXCLUDE
 * `"inconclusive"` (SPEC-061 §Scope D2) — that outcome is the attestation-completeness
 * guard's own runner-issued verdict, written only via {@link TaskWorkflowService.recordVerifiedEvidence};
 * `_addEvidenceImpl`'s runtime check (mirroring the `attestation` guard) is what actually
 * stops an `as EvidenceInput`-cast candidate from smuggling it past this type exclusion.
 * `result` DOES include `"expected-fail"` (spec-workflow-hardening-evidence-red-vocabulary-
 * claim-worktree §M1, AC-WH-1) — the opposite of `"inconclusive"`: a NORMAL self-reported
 * value (RED-phase evidence, fails by design), accepted here with no special guard, stored
 * verbatim, never counted as passing by any downstream consumer.
 */
export type EvidenceInput = Omit<EvidenceEntry, "recorded_at" | "attestation" | "result"> & {
  result: Exclude<EvidenceEntry["result"], "inconclusive">;
  /** See {@link ClaimOpts.source}. */
  source?: string;
};

/**
 * Evidence input for {@link TaskWorkflowService.recordVerifiedEvidence} — the ONLY shape
 * that may carry `attestation` (SPEC-039 §2 D2). Never exported to any CLI/MCP surface;
 * `VerifyRunnerService.verifyPlan` is the sole production caller.
 */
export type VerifiedEvidenceInput = Omit<EvidenceEntry, "recorded_at">;

/** Options for {@link TaskWorkflowService.setAnchors}/`addAnchors`/`removeAnchors` (SPEC-042 D3). */
export interface AnchorMutationOpts {
  /** Resolved actor identity — recorded in version history + audit, same shape as {@link ClaimOpts.by}. */
  by: string;
  /** See {@link ClaimOpts.source}. */
  source?: string;
}

/**
 * One anchor-overlap advisory entry in {@link ReadyReport.anchor_conflicts}
 * (SPEC-042 D7) — `task_slug` is the task IN THIS REPORT the conflict applies
 * to; `holder`/`paths` describe the fresh foreign sibling claim it collides
 * with. Pointers only, never task body content.
 */
export interface AnchorConflict {
  task_slug: string;
  holder: string;
  paths: string[];
}

/**
 * `TaskWorkflowService.ready`'s return shape (SPEC-042 D7) — the pre-SPEC-042
 * flat `ReadyRecord[]` becomes `.records` (D7's "keep ReadyRecord flat-array
 * contract intact" is about EACH record staying flat/non-nested, not about the
 * top-level return type — see this method's own JSDoc for why a genuine
 * wrapper object was chosen over bolting extra properties onto an array:
 * `JSON.stringify` on an array silently DROPS non-index properties, which
 * would have silently broken `lore ready --json` / `lore_ready`'s promise to
 * surface `sessions`/`anchor_conflicts`). `sessions`/`anchor_conflicts` are
 * PLAN-SCOPED (this plan's tasks only) — contrast with `SessionService.
 * bootstrap`'s `active_sessions`, which is corpus-wide over every active plan.
 */
export interface ReadyReport {
  records: ReadyRecord[];
  sessions: ReadySession[];
  anchor_conflicts: AnchorConflict[];
}

// ─── Internal Helpers ──────────────────────────────────────────────────────

const defaultNow = (): string => new Date().toISOString();

/** Reads and validates task.extra.claim. Returns undefined when absent or malformed. */
function readClaim(task: DocRecord): TaskClaim | undefined {
  const raw = task.extra["claim"];
  if (raw === undefined || raw === null) return undefined;
  const parsed = taskClaimSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Reads and validates task.extra.verification_evidence. Returns [] when absent or malformed. */
function readEvidence(task: DocRecord): EvidenceEntry[] {
  const raw = task.extra["verification_evidence"];
  if (!Array.isArray(raw)) return [];
  const parsed = z.array(evidenceEntrySchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * Zero-evidence release advisory text (spec claim-time-actor-identity-guard-
 * zero-evidence-release-advis, AC-RELEASE-ADVISORY) — the SAME string every
 * surface (`commands/release.ts` stderr line + `--json` `warnings[]`, MCP
 * `lore_release`'s `warnings[]`) renders, so the three never independently
 * drift on wording. Advisory-ONLY (SPEC-025 evidence discipline is enforced
 * only by implementer prompts today — exploration/spike tasks legitimately
 * release with zero evidence) — never blocks the release write itself.
 */
export const ZERO_EVIDENCE_RELEASE_WARNING =
  "Released with zero verification evidence recorded — exploration/spike tasks may " +
  "legitimately have none; if this was meant to be verified work, run `lore evidence` " +
  "before releasing next time.";

/**
 * `true` when `task` carries NO `verification_evidence` entries at all (spec
 * claim-time-actor-identity-guard-zero-evidence-release-advis, AC-RELEASE-
 * ADVISORY) — the release advisory's sole trigger condition. PURE read over a
 * `DocRecord` already in hand (`release()`'s own return value — `release()`
 * never touches `extra.verification_evidence`, so the PRE- and POST-release
 * doc read identically here) — zero extra store calls, callable from any
 * adapter (CLI/MCP) on whichever `DocRecord` a successful `claim`/`release`
 * call returned, task OR phase (a phase doc uses the identical `extra`
 * field). Exported (not `release()`-internal) so the CLI (`commands/
 * release.ts`) and MCP (`lore_release`) can apply the SAME check to render
 * their own surface-specific warning without re-deriving the evidence-empty
 * rule independently.
 *
 * @param task - The DocRecord a `claim`/`release` call returned.
 * @returns `true` iff `task.extra.verification_evidence` is absent, malformed, or `[]`.
 * @example
 * hasZeroReleaseEvidence({ extra: {} } as DocRecord); // => true
 * @example
 * hasZeroReleaseEvidence({
 *   extra: { verification_evidence: [{ oracle: "test", result: "pass", command: "x", recorded_at: "T0" }] },
 * } as DocRecord); // => false
 */
export function hasZeroReleaseEvidence(task: DocRecord): boolean {
  return readEvidence(task).length === 0;
}

/** Computes age in whole minutes between two ISO timestamps (nowIso - atIso). */
function ageMinutesBetween(nowIso: string, atIso: string): number {
  return Math.floor((new Date(nowIso).getTime() - new Date(atIso).getTime()) / 60_000);
}

/**
 * Rejects an explicitly-passed `--worktree` that is empty or whitespace-only
 * (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M2, AC-WH-2).
 * `undefined` (flag omitted) is legal and passes through untouched — only a
 * PRESENT-but-blank value is rejected, because that value would otherwise
 * satisfy "the flag was explicitly declared" (SPEC-042 D2's ALWAYS-explicit
 * requirement) while persisting a string that defeats SPEC-042 D1 session
 * derivation and `noAnchorOverlap`'s `(by, machine, worktree)` grouping key —
 * every fresh claim with a blank worktree would silently group together
 * regardless of which actual worktree each session runs in. Exported (not
 * module-private) because `PhaseWorkflowService.claim` duplicates the same
 * claim shape and must share this ONE validation instead of re-deriving it
 * (SSOT — see that module's own `_claimImpl`).
 *
 * @param worktree - `ClaimOpts.worktree` as received, before any other claim logic runs
 * @returns `ok(undefined)` when omitted or non-blank; `err(VALIDATION_ERROR)` naming
 *   the `worktree` field when present but blank
 */
export function rejectBlankClaimWorktree(worktree: string | undefined): Result<void, LoreError> {
  if (worktree !== undefined && worktree.trim() === "") {
    return err({
      code: "VALIDATION_ERROR",
      field: "worktree",
      message: "--worktree must not be empty or whitespace-only",
      value: worktree,
    });
  }
  return ok(undefined);
}

/**
 * Computes the canonical sanctioned lifecycle path from `from` to `"archived"`, used by
 * {@link TaskWorkflowService.done} and (via re-export) `PhaseWorkflowService.done`
 * (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3) — mirrors the
 * `rejectBlankClaimWorktree` SSOT-export precedent above rather than duplicating this
 * logic per-service.
 *
 * Every returned status is one step of the walk; each is a sanctioned edge in the BASE
 * `VALID_TRANSITIONS` graph (`packages/core/src/schemas.ts`) — deliberately NOT the
 * type-scoped `draft -> archived` single-hop shortcut `DRAFT_TO_ARCHIVED_ALLOWED_TYPES`
 * grants `task`/`knowledge` docs (that shortcut serves the ARCHIVE-SWEEP mechanism,
 * spec-lifecycle-archival-plan-close-cascade-deterministic §D3 — a DIFFERENT, REJECTED
 * alternative for `done`, see that spec's §Overview "(c)"). `done()` re-validates each
 * step against `isValidTransition` immediately before writing it (belt-and-suspenders —
 * a future edit to `VALID_TRANSITIONS` that silently removes one of these edges fails
 * loud there, not here).
 *
 * Skips the `in-review` review-workflow detour when `from` is `"draft"` — the base graph
 * already permits `draft -> approved` directly, and `lore done` is not a human review
 * action.
 *
 * @param from - The document's CURRENT status (never `"archived"`/`"deprecated"` in
 *   practice — `done()`'s own idempotent-no-op branch short-circuits before this is
 *   called in that case; both cases return `[]` here anyway, defensively)
 * @returns Ordered array of statuses to walk through, ending in `"archived"`; `[]` when
 *   `from` is already terminal
 */
export function computeArchiveWalk(from: DocStatus): DocStatus[] {
  switch (from) {
    case "draft":
    case "in-review":
      return ["approved", "active", "archived"];
    case "approved":
      return ["active", "archived"];
    case "active":
      return ["archived"];
    case "archived":
    case "deprecated":
      return [];
  }
}

/** Terminal document statuses — mirrors DD-1's `plan-terminality` drift definition
 *  (spec-plan-closure-must-be-loud-terminality-divergence-silent). Kept local to this
 *  file (not imported from `tree-check-service.ts`) — SRP: this is `done()`'s own
 *  read-only fact computation, not the drift detector. */
function isTerminalStatus(status: DocStatus): boolean {
  return status === "archived" || status === "deprecated";
}

/**
 * Rejects any candidate task anchor containing `#` — the SPEC code-anchor grammar's
 * delimiter (`path[#Symbol]`, SPEC-045 §Design Decisions D1/D6) is not valid on a
 * TASK's `file_anchors`, which is always a plain repo-relative path/dir scope.
 * Applied at the task-anchor AUTHORING seams that can introduce NEW state
 * (`setAnchors`/`addAnchors` — CLI `--anchor` at create time is validated by
 * `CorpusService._createImpl`'s existing file_anchors branch, which has no `#`
 * either since `normalizeFileAnchors` never special-cases it; this guard is the
 * dedicated check named by SPEC-045 D6 for the two RMW mutation verbs). Deliberately
 * NOT applied to `removeAnchors` — a removal candidate never creates new stored
 * state, and a stored legacy `#`-carrying entry (however it got there) must stay
 * removable.
 */
function rejectHashInTaskAnchors(anchors: string[]): Result<void, LoreError> {
  const offending = anchors.find((a) => a.includes("#"));
  if (offending !== undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "file_anchors",
      message:
        `task file_anchors must not contain "#" — that is the SPEC code-anchor grammar ` +
        `(path[#Symbol], SPEC-045), not valid on a task's file_anchors: "${offending}"`,
      value: offending,
    });
  }
  return ok(undefined);
}

/**
 * Genuine short commands exempted from {@link rejectPlaceholderEvidenceCommand}'s
 * 3-character floor — real runnable commands that happen to be under 3 characters.
 * Deliberately a closed, explicit list (never inferred from a heuristic like "looks
 * like a known binary") — widening it is a conscious decision, not a side effect.
 */
const ALLOWED_SHORT_EVIDENCE_COMMANDS: ReadonlySet<string> = new Set([
  "ls",
  "go",
  "sh",
  "cd",
  "hg",
  "bc",
  "dd",
  "df",
  "du",
  "ps",
  "rm",
  "cp",
  "mv",
  "ln",
  "id",
  "wc",
]);

/**
 * Rejects an `addEvidence` `command` that looks like a placeholder/probe string
 * rather than a runnable command (task task-reject-placeholder-command-strings-
 * at-evidence-write-time) — a 2026-07-29 incident recorded 3 evidence entries
 * with commands `"x"`/`"x3"`/`"x4"` (all `result: "pass"`) on a real task while
 * an agent was debugging shell quoting; evidence is append-only, so those
 * entries can never be removed, and an auditor cannot distinguish them from
 * real oracle runs except by reading the command text.
 *
 * WRITE-PATH ONLY, called from `_addEvidenceImpl` (the self-reported addEvidence
 * path), never from the shared `appendEvidenceEntry`/`recordVerifiedEvidence`
 * path — see this module's own header invariant for why `recordVerifiedEvidence`
 * is deliberately exempt (its `command` is runner-attested, not hand-typed).
 * Deliberately does NOT tighten the shared `evidenceEntrySchema.command`
 * (`@lore/core`, `z.string().min(1)`): `readEvidence`'s `z.array(...).safeParse`
 * is all-or-nothing — tightening the shared schema would silently zero an
 * ENTIRE task's evidence array on next read the moment it already holds one
 * placeholder entry recorded before this guard existed. This check therefore
 * only ever screens the ONE new entry being appended, never re-validates
 * history — a task carrying a historical `"x"` entry keeps reading it back
 * intact, and can keep receiving new (non-placeholder) evidence.
 *
 * Rule (conservative — must not false-positive on real short commands): the
 * TRIMMED command is rejected when it is shorter than 3 characters AND is not
 * in {@link ALLOWED_SHORT_EVIDENCE_COMMANDS}. Rejects `"x"` (trimmed length 1)
 * and `"x3"`/`"x4"` (trimmed length 2, neither allowlisted). Accepts `"ls"`
 * (allowlisted), `"tsc"`, `"make"`, `"bun test"` (all 3+ chars).
 *
 * @param command - The raw `EvidenceInput.command` as received (untrimmed)
 * @returns `ok(undefined)` when the command passes; `err(VALIDATION_ERROR)`
 *   naming both the offending value and the rule when it looks like a
 *   placeholder
 * @example
 * rejectPlaceholderEvidenceCommand("x"); // => err({ code: "VALIDATION_ERROR", field: "command", ... })
 * @example
 * rejectPlaceholderEvidenceCommand("ls"); // => ok(undefined) — allowlisted
 * @example
 * rejectPlaceholderEvidenceCommand("tsc"); // => ok(undefined) — 3+ chars
 */
function rejectPlaceholderEvidenceCommand(command: string): Result<void, LoreError> {
  const trimmed = command.trim();
  if (trimmed.length >= 3 || ALLOWED_SHORT_EVIDENCE_COMMANDS.has(trimmed)) {
    return ok(undefined);
  }
  const allowlist = Array.from(ALLOWED_SHORT_EVIDENCE_COMMANDS).sort().join(", ");
  return err({
    code: "VALIDATION_ERROR",
    field: "command",
    message:
      `evidence command "${command}" looks like a placeholder, not a runnable command — a ` +
      `trimmed command shorter than 3 characters is rejected unless it is one of the ` +
      `allowlisted short commands (${allowlist})`,
    value: command,
  });
}

// ─── TaskWorkflowService ───────────────────────────────────────────────────

export class TaskWorkflowService {
  private readonly telemetry: Telemetry;
  /**
   * Public (not just internal) so CLI badge rendering (`lore list` / `lore tree`,
   * AC-WF-9) can call the pure `isClaimStale(claim, nowIso, ttl)` helper from
   * @lore/core with the same TTL this service uses — single source of truth,
   * no second TTL value threaded through App.
   */
  readonly claimTtlMinutes: number;

  /**
   * Narrow port resolving the AC ids declared on a plan's parent spec — implemented
   * by `CorpusService.resolveDeclaredAcIds` and injected here (never imported
   * directly: services don't cross-import — SPEC-038 §7 D4). Defaults to a stub that
   * always resolves `null` ("nothing declared") so every pre-SPEC-038 caller that
   * constructs this service without the 4th arg keeps compiling and behaving
   * identically — the default is only ever consulted when an `ac_ref` is actually
   * supplied to addEvidence, which no pre-SPEC-038 caller does.
   */
  private readonly resolveDeclaredAcIds: (
    planId: string,
  ) => Promise<Result<Set<string> | null, LoreError>>;

  /**
   * Narrow port resolving the AC ids declared on an `--adhoc` task's OWN governing
   * spec — the ad-hoc sibling of {@link resolveDeclaredAcIds} (task-an-ad-hoc-task-
   * s-attested-evidence-cannot-carry-ac-ref). Implemented by `CorpusService.
   * resolveDeclaredAcIdsForAdhocTask` and injected here for the SAME reason
   * `resolveDeclaredAcIds` is (services don't cross-import): an ad-hoc task's
   * `parent_id` is structurally the root PRD (SPEC-069 D2), so `resolveDeclaredAcIds`'s
   * plan-type requirement can never be satisfied for it — this port resolves via
   * the task's own declared `ac_scope` instead of a plan→spec walk. Defaults to a
   * stub that always refuses (`VALIDATION_ERROR`) so every pre-existing caller that
   * constructs this service without this arg keeps compiling and behaving
   * identically — the default is only ever consulted when an `ac_ref` is actually
   * supplied to addEvidence for an `--adhoc` task, which no pre-existing caller does.
   */
  private readonly resolveAdhocGoverningAcIds: (
    task: DocRecord,
  ) => Promise<Result<Set<string>, LoreError>>;

  /**
   * @param store - Storage abstraction (same instance passed to CorpusService)
   * @param telemetry - Telemetry sink (own wiring — D8; defaults to NoOp)
   * @param config - `{ claimTtlMinutes }` — see resolveClaimTtlMinutes in @lore/core
   * @param resolveDeclaredAcIds - SPEC-038 §7 D4 cross-entity port; production wiring
   *   is `corpusService.resolveDeclaredAcIds.bind(corpusService)` (app.ts). Tests can
   *   inject a stub without a 3-hop CorpusService fixture.
   * @param gate - OPTIONAL gate-enforcement dependency bundle (retro follow-up item 8,
   *   defense-in-depth) — `{enforcer, getPlanBundle}`, see `GateDependencies` JSDoc
   *   (`./gate-enforcer.js`) for why both are bundled as one. When present, `claim`
   *   runs the `task-claim` checkpoint (the task's plan's ancestor spec must be
   *   approved) before writing the lease. Absent (the default) → ungated,
   *   byte-identical to pre-GateEnforcer behavior — keeps every bare
   *   `new TaskWorkflowService(store, telemetry, config)` unit test construction green.
   * @param resolveAdhocGoverningAcIds - task-an-ad-hoc-task-s-attested-evidence-
   *   cannot-carry-ac-ref cross-entity port; production wiring is
   *   `corpusService.resolveDeclaredAcIdsForAdhocTask.bind(corpusService)` (app.ts).
   *   Defaults to an always-refusing stub (see the field's own JSDoc) — every
   *   pre-existing bare construction that omits it keeps compiling unchanged.
   */
  constructor(
    private readonly store: StoreInterface,
    telemetry: Telemetry = new NoOpTelemetry(),
    config: { claimTtlMinutes: number },
    resolveDeclaredAcIds: (
      planId: string,
    ) => Promise<Result<Set<string> | null, LoreError>> = async () => ok(null),
    private readonly gate?: GateDependencies,
    resolveAdhocGoverningAcIds: (
      task: DocRecord,
    ) => Promise<Result<Set<string>, LoreError>> = async () =>
      err({
        code: "VALIDATION_ERROR",
        field: "ac_ref",
        message:
          "ac_ref validation for an --adhoc task requires the resolveAdhocGoverningAcIds port, " +
          "not wired on this TaskWorkflowService instance",
      }),
  ) {
    this.telemetry = telemetry;
    this.claimTtlMinutes = config.claimTtlMinutes;
    this.resolveDeclaredAcIds = resolveDeclaredAcIds;
    this.resolveAdhocGoverningAcIds = resolveAdhocGoverningAcIds;
  }

  // ── addEvidence ───────────────────────────────────────────────────────────

  /**
   * Appends one oracle verification record to task.extra.verification_evidence.
   * Fails loud (VALIDATION_ERROR, doc unchanged) when the array already holds 50
   * entries (AC-WF-2) or the entry itself fails schema validation.
   *
   * @param idOrSlug - Task document ULID or slug
   * @param entry - Evidence fields minus recorded_at (set here from `now()`)
   * @param now - Time seam (D10); defaults to `() => new Date().toISOString()`
   * @returns The updated task DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task / cap reached / bad entry), STALE_VERSION
   */
  async addEvidence(
    idOrSlug: string,
    entry: EvidenceInput,
    now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._addEvidenceImpl(idOrSlug, entry, now);
    this.recordEvent("task.evidence_added", startMs, result, entry.source, {
      oracle: entry.oracle,
      result: entry.result,
    });
    return result;
  }

  /**
   * SOLE injection point for `EvidenceEntry.attestation` (SPEC-039 §2 D2). NOT
   * registered on any CLI/MCP surface — the only production caller is
   * `VerifyRunnerService.verifyPlan`, bound in `app.ts` the same way
   * `resolveDeclaredAcIds` is bound onto this service's own port. Shares
   * `appendEvidenceEntry`'s cap-check / schema-validation / ac_ref cross-entity
   * validation / writeTaskExtra commit path with {@link addEvidence} — no
   * duplicated implementation (SPEC-039 task anchor: "share the impl internals,
   * do not duplicate").
   *
   * @param idOrSlug - Task document ULID or slug
   * @param entry - Full evidence fields INCLUDING attestation, minus recorded_at
   * @param nowIso - Caller-supplied current time (D10) — a resolved ISO string, not a
   *   `() => string` thunk, since `VerifyRunnerService.verifyPlan` resolves "now" once
   *   per call, before looping over acceptance criteria.
   * @returns The updated task DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task / cap reached / bad entry / bad ac_ref), STALE_VERSION
   */
  async recordVerifiedEvidence(
    idOrSlug: string,
    entry: VerifiedEvidenceInput,
    nowIso: string,
  ): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    // reason: appendEvidenceEntry takes a `now` THUNK (not a resolved string) so it can
    // invoke it at the exact same point _addEvidenceImpl always has — after resolveTask
    // + the cap check, immediately before building the candidate object (D10 time-seam
    // ordering the STALE_VERSION sequential-CAS test recipe, SPEC-025 §7, depends on).
    // recordVerifiedEvidence's own public contract stays a plain resolved `nowIso: string`
    // (VerifyRunnerService resolves "now" once per verifyPlan() call) — trivially wrapped
    // here rather than widening the public signature back to a thunk.
    const result = await this.appendEvidenceEntry(idOrSlug, entry, entry.recorded_by, () => nowIso);
    this.recordEvent("task.evidence_added", startMs, result, undefined, {
      oracle: entry.oracle,
      result: entry.result,
      attested: entry.attestation !== undefined,
    });
    return result;
  }

  private async _addEvidenceImpl(
    idOrSlug: string,
    entry: EvidenceInput,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    // SPEC-039 §4 D2 — fail-loud, NOT a silent strip: any raw input object carrying
    // an `attestation` key at all (regardless of value) is rejected before any other
    // validation runs. `attestation` is runner-issued only; the sole injection point
    // is `recordVerifiedEvidence`. A caller can force this key past EvidenceInput's
    // compile-time exclusion with an `as EvidenceInput` cast on an untyped candidate
    // object (the exact pattern CLI commands assemble flag-derived candidates with) —
    // this runtime check is what actually stops it, not the type alone.
    if (Object.prototype.hasOwnProperty.call(entry, "attestation")) {
      return err({
        code: "VALIDATION_ERROR",
        field: "attestation",
        message: "attestation is runner-issued; use lore verify (not a valid addEvidence input field)",
        value: (entry as Record<string, unknown>)["attestation"],
      });
    }

    // SPEC-061 §Scope D2 — mirrors the attestation guard directly above: "inconclusive"
    // is a RUNNER-ISSUED result (the attestation-completeness guard's own verdict,
    // written only via `recordVerifiedEvidence`), never a self-reported value. Checked
    // against the raw value (not gated behind EvidenceInput's compile-time type, which a
    // caller can bypass with an `as EvidenceInput` cast on an untyped candidate object —
    // same bypass vector the attestation check above defends against).
    if ((entry.result as string) === "inconclusive") {
      return err({
        code: "VALIDATION_ERROR",
        field: "result",
        message:
          "result \"inconclusive\" is runner-issued; use lore verify (not a valid addEvidence input value)",
        value: entry.result,
      });
    }

    // task-fix-ordering-regression-placeholder-command-guard-preempts — resolve
    // and doc-type-validate the target BEFORE the placeholder-command check so a
    // wrong-doc-type call (e.g. `lore evidence` against a PLAN) still surfaces
    // "Expected a task document", not a command-format complaint. Regression: the
    // placeholder check used to run first and, since it validates only the raw
    // `command` string (never the target doc), any short filler command on a
    // non-task doc reported the placeholder error instead of the doc-type error —
    // the LESS actionable message won by accident of ordering. `appendEvidenceEntry`
    // below re-resolves the same doc; a duplicate store read is acceptable here,
    // correctness over one extra read (see the task's own exit condition: the
    // wrong-doc-type message must win, and this call must never let a wrong-type
    // target retry into phase-dispatch handling).
    const targetCheck = await this.resolveTask(idOrSlug);
    if (!targetCheck.ok) return targetCheck;

    // task-reject-placeholder-command-strings-at-evidence-write-time — see
    // rejectPlaceholderEvidenceCommand's own JSDoc for the incident this defends
    // against and why it is scoped to THIS self-reported path only (never the
    // shared appendEvidenceEntry both addEvidence and recordVerifiedEvidence use).
    const placeholderCheck = rejectPlaceholderEvidenceCommand(entry.command);
    if (!placeholderCheck.ok) return placeholderCheck;

    return this.appendEvidenceEntry(idOrSlug, entry, entry.recorded_by, now);
  }

  /**
   * Shared append implementation for {@link addEvidence} (self-reported, never carries
   * `attestation` by construction of its caller) and {@link recordVerifiedEvidence}
   * (runner-attested, SPEC-039 §2 D2 sole injection point) — cap check, schema
   * validation, ac_ref cross-entity validation, and the writeTaskExtra commit path all
   * live here exactly once.
   *
   * @param now - Time seam thunk (D10), invoked HERE (after resolveTask + the cap
   *   check, immediately before building the candidate) — NOT pre-resolved by the
   *   caller. This exact ordering is load-bearing: the sequential-CAS STALE_VERSION
   *   test recipe (SPEC-025 §7) simulates a concurrent writer via a side effect
   *   inside the injected `now()` callback, which only works if `now()` fires AFTER
   *   the version has been read (resolveTask) but BEFORE the write. `recordVerifiedEvidence`
   *   wraps its already-resolved `nowIso` string in a trivial `() => nowIso` thunk to
   *   satisfy this signature without changing its own public contract.
   */
  private async appendEvidenceEntry(
    idOrSlug: string,
    entry: VerifiedEvidenceInput,
    actor: string,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    const taskResult = await this.resolveTask(idOrSlug);
    if (!taskResult.ok) return taskResult;
    const task = taskResult.value;

    const existing = readEvidence(task);
    if (existing.length >= 50) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.verification_evidence",
        message: "Evidence log is full (50 entries max) — cannot append a 51st entry",
        value: existing.length,
      });
    }

    const nowIso = now();
    const candidate = {
      oracle: entry.oracle,
      command: entry.command,
      result: entry.result,
      recorded_at: nowIso,
      recorded_by: entry.recorded_by,
      ...(entry.output_tail !== undefined ? { output_tail: entry.output_tail } : {}),
      ...(entry.ac_ref !== undefined ? { ac_ref: entry.ac_ref } : {}),
      ...(entry.attestation !== undefined ? { attestation: entry.attestation } : {}),
    };
    const parsedEntry = evidenceEntrySchema.safeParse(candidate);
    if (!parsedEntry.success) {
      const issue = parsedEntry.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `evidence.${issue.path.join(".")}` : "evidence",
        message: issue !== undefined ? issue.message : "Invalid evidence entry",
        value: candidate,
      });
    }

    // Cross-entity ac_ref validation (SPEC-038 §4, §7 D4) — only when an ac_ref was
    // actually supplied. Pre-SPEC-038 evidence (no ac_ref) never reaches this branch.
    if (parsedEntry.data.ac_ref !== undefined) {
      if (task.extra["adhoc"] === true) {
        // task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref — an
        // --adhoc task's parent is structurally the root PRD (SPEC-069 D2), so
        // the plan-owned branch below (which hard-requires the resolved parent
        // to be a `plan`) can NEVER succeed for it. Resolves the governing spec
        // via the task's own declared ac_scope instead, through the injected
        // `resolveAdhocGoverningAcIds` port (→ `CorpusService.
        // resolveDeclaredAcIdsForAdhocTask` → shared `resolveGoverningSpecByAcScope`,
        // the SAME search `VerifyRunnerService.verifyAdhocTask` runs) — the two
        // surfaces can never disagree about which spec governs this task.
        const declaredResult = await this.resolveAdhocGoverningAcIds(task);
        if (!declaredResult.ok) return declaredResult;
        const declared = declaredResult.value;
        if (!declared.has(parsedEntry.data.ac_ref)) {
          const available = declared.size > 0 ? Array.from(declared).sort().join(", ") : "(none)";
          return err({
            code: "VALIDATION_ERROR",
            field: "ac_ref",
            message: `ac_ref "${parsedEntry.data.ac_ref}" is not declared on the resolved governing spec. Available ids: ${available}`,
            value: parsedEntry.data.ac_ref,
          });
        }
      } else {
        if (task.parent_id === null) {
          return err({
            code: "VALIDATION_ERROR",
            field: "ac_ref",
            message: `ac_ref "${parsedEntry.data.ac_ref}" cannot be validated — task has no parent plan`,
            value: parsedEntry.data.ac_ref,
          });
        }
        const declaredResult = await this.resolveDeclaredAcIds(task.parent_id);
        if (!declaredResult.ok) return declaredResult;
        const declared = declaredResult.value;
        if (declared === null || !declared.has(parsedEntry.data.ac_ref)) {
          const available =
            declared !== null && declared.size > 0
              ? Array.from(declared).sort().join(", ")
              : "(none — parent spec has no structured acceptance_criteria)";
          return err({
            code: "VALIDATION_ERROR",
            field: "ac_ref",
            message: `ac_ref "${parsedEntry.data.ac_ref}" is not declared on the parent spec. Available ids: ${available}`,
            value: parsedEntry.data.ac_ref,
          });
        }
      }
    }

    // SPEC-069 §Design Decisions D4/D5 (W3 fix) — an evidence recorder who IS the
    // current claim holder (fresh OR stale) is demonstrably alive; fold the renewed
    // claim into this SAME CAS write so a still-working session's TTL never falsely
    // expires between evidence appends. `renewClaimForEvidence` reuses `nowIso`
    // captured above — NEVER a second `now()` invocation (would break the
    // STALE_VERSION sequential-CAS test recipe, which relies on single-fire).
    const renewedClaim = renewClaimForEvidence(readClaim(task), actor, nowIso);
    const newExtra: Record<string, unknown> = {
      ...task.extra,
      verification_evidence: [...existing, parsedEntry.data],
      ...(renewedClaim !== null ? { claim: renewedClaim } : {}),
    };

    return this.writeTaskExtra(
      task,
      newExtra,
      nowIso,
      actor,
      `Evidence added: ${entry.oracle} ${entry.result}`,
      "evidence",
      {
        oracle: entry.oracle,
        command: entry.command,
        result: entry.result,
        ...(renewedClaim !== null ? { claim_renewed: true } : {}),
      },
    );
  }

  // ── claim ────────────────────────────────────────────────────────────────

  /**
   * Acquires, refreshes, or steals the advisory execution lease on a task.
   * Semantics (SPEC-025 §8.3):
   *   - No existing claim → acquired.
   *   - Existing claim held by the same `by` → refreshed (`at` updated).
   *   - Existing claim is stale (age > TTL) → claimable without `--steal`.
   *   - Existing claim is fresh and held by someone else → CLAIM_CONFLICT unless `steal`.
   *
   * @param idOrSlug - Task document ULID or slug
   * @param opts - `{ by, branch?, steal?, source? }`
   * @param now - Time seam (D10)
   * @returns The updated task DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task), CLAIM_CONFLICT, STALE_VERSION
   */
  async claim(
    idOrSlug: string,
    opts: ClaimOpts,
    now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._claimImpl(idOrSlug, opts, now);
    this.recordEvent("task.claimed", startMs, result, opts.source, {
      by: opts.by,
      steal: opts.steal === true,
    });
    return result;
  }

  private async _claimImpl(
    idOrSlug: string,
    opts: ClaimOpts,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    // reason: AC-WH-2 — validated BEFORE resolveTask so a blank --worktree
    // fails loud and persists nothing regardless of whether the target task
    // exists (this is an opts-shape defect, not a doc-lookup concern).
    const worktreeCheck = rejectBlankClaimWorktree(opts.worktree);
    if (!worktreeCheck.ok) return worktreeCheck;

    const taskResult = await this.resolveTask(idOrSlug);
    if (!taskResult.ok) return taskResult;
    const task = taskResult.value;

    // reason: SPEC-042 D5 seam pinning — nowIso is resolved BEFORE the gate call
    // (was previously resolved AFTER) so the anchor-overlap predicate's sibling
    // staleness and this method's OWN existing-claim staleness check below share
    // the exact same "now", within one claim() call.
    const nowIso = now();

    const gateResult = await this.enforceClaimGate(task, opts, nowIso);
    if (!gateResult.ok) return gateResult;

    const existingClaim = readClaim(task);
    let carryForward = false;

    if (existingClaim !== undefined) {
      const stale = isClaimStale(existingClaim, nowIso, this.claimTtlMinutes);
      const sameHolder = existingClaim.by === opts.by;
      if (!stale && !sameHolder && opts.steal !== true) {
        return err({
          code: "CLAIM_CONFLICT",
          id: task.id,
          holder: existingClaim.by,
          age_minutes: ageMinutesBetween(nowIso, existingClaim.at),
        });
      }
      // reason: SPEC-042 D2 — carry-forward applies ONLY to a same-holder FRESH
      // refresh. A stale takeover (even by the SAME `by`) or a different holder
      // (first acquire, steal) starts fresh with no inherited branch/machine/
      // worktree — staleness deliberately breaks session continuity.
      carryForward = !stale && sameHolder;
    }

    const newClaim: TaskClaim = buildTaskClaim(
      existingClaim,
      {
        by: opts.by,
        at: nowIso,
        ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
        ...(opts.machine !== undefined ? { machine: opts.machine } : {}),
        ...(opts.worktree !== undefined ? { worktree: opts.worktree } : {}),
      },
      carryForward,
    );
    const newExtra: Record<string, unknown> = { ...task.extra, claim: newClaim };

    const summary =
      existingClaim !== undefined && existingClaim.by !== opts.by
        ? `Claimed by ${opts.by} (previous holder: ${existingClaim.by})`
        : `Claimed by ${opts.by}`;

    const writeResult = await this.writeTaskExtra(task, newExtra, nowIso, opts.by, summary, "claim", {
      by: opts.by,
      steal: opts.steal === true,
      ...(existingClaim !== undefined ? { previous_holder: existingClaim.by } : {}),
    });
    if (!writeResult.ok) return writeResult;

    // reason: BUG-011 TOCTOU hardening (write-then-verify, no new lock infra) —
    // `enforceClaimGate` above reads sibling claims via a FRESH `getPlanBundle` snapshot
    // taken BEFORE this method's own CAS write, so that snapshot can go stale in the
    // read-write gap: a concurrent claim on an anchor-overlapping sibling task can land
    // in that exact gap, and NEITHER writer's pre-write check would ever observe the
    // other (per-doc CAS only serializes writes to the SAME row — it says nothing about
    // the cross-row "no two anchor-overlapping siblings both hold a fresh claim"
    // invariant SPEC-042 established). Re-running the IDENTICAL gate check immediately
    // after our own write commits closes this: the store serializes all writes on one
    // connection, so whichever of two racing claims commits SECOND will, in this
    // post-write re-check's fresh read, always observe the FIRST writer's claim already
    // persisted (a read strictly after your own write is ordered after every write that
    // preceded it) — so the later committer always detects the conflict here and
    // self-rolls-back below. The earlier committer's own post-write check may or may not
    // observe the later write depending on exact timing; if it does, BOTH sides roll
    // back. That double-rollback is an ACCEPTED residual (loud VALIDATION_ERROR,
    // trivially retriable by either side) — see `rollbackClaim`'s own JSDoc for why a
    // deterministic tiebreak was evaluated and rejected in favor of this simpler,
    // symmetric design. A narrow window still remains AFTER this post-write check
    // returns clean (a third claim landing in the instant between this read and the
    // caller observing success) — documented, not eliminated: closing it fully would
    // need a corpus-level lock/daemon, explicitly out of scope (task anchor: "⛔
    // 不引入 daemon/锁表/mutex 行").
    const postWriteGateResult = await this.enforceClaimGate(task, opts, nowIso);
    if (!postWriteGateResult.ok) {
      const rollbackResult = await this.rollbackClaim(writeResult.value, existingClaim, opts.by, now);
      if (!rollbackResult.ok) {
        // reason: never swallow a rollback failure — the caller must be told the doc was
        // left in the CONFLICTING (not rolled back) claim state and needs to inspect/
        // release it manually. A STALE_VERSION here means a THIRD write (e.g. a release,
        // or an evidence append by the holder) landed between our own write and this
        // rollback attempt — a genuinely rare double-race with no automatic retry policy
        // anywhere in this service; surfaced loud rather than retried silently.
        return err({
          code: "VALIDATION_ERROR",
          field: "gate:task-claim:anchor-overlap",
          message:
            `Post-write anchor-overlap conflict detected on task "${task.slug}" AND the ` +
            `automatic self-rollback failed (${rollbackResult.error.code}) — its claim was ` +
            `left in the conflicting state. Manually inspect/release "${task.slug}".`,
          value: { conflict: postWriteGateResult.error, rollback_error: rollbackResult.error },
        });
      }
      return postWriteGateResult;
    }

    return writeResult;
  }

  /**
   * BUG-011 self-rollback: restores `extra.claim` to its value immediately BEFORE the
   * just-committed write — `preClaim` (the same-holder claim being refreshed, or a
   * stale/foreign claim being taken over) when one existed, or removed entirely when
   * this was a fresh acquire. CAS-guarded against `written.version` (the version the
   * just-committed claim write produced) via {@link writeTaskExtra}'s own CAS, so a
   * THIRD concurrent write landing in this narrow window fails loud (`STALE_VERSION`)
   * rather than silently clobbering it — see `_claimImpl`'s caller for how that failure
   * is surfaced.
   *
   * A deterministic tiebreak (e.g. "lowest doc id always wins, so only the loser ever
   * rolls back") was considered and rejected for this task: it would require the
   * WINNING side to also re-verify post-write (to confirm it's still the winner after
   * whatever else may have changed), which is the identical IO cost this write-then-
   * verify design already pays — the only thing a tiebreak would save is the rare
   * double-rollback case, at the cost of a second comparison axis (id ordering) that
   * has no other role in this module. Both losers retrying their own `lore claim` is
   * simpler, loud, and already the documented accepted residual.
   */
  private async rollbackClaim(
    written: DocRecord,
    preClaim: TaskClaim | undefined,
    by: string,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    const rollbackExtra: Record<string, unknown> = { ...written.extra };
    if (preClaim !== undefined) {
      rollbackExtra["claim"] = preClaim;
    } else {
      delete rollbackExtra["claim"];
    }
    return this.writeTaskExtra(
      written,
      rollbackExtra,
      now(),
      by,
      `Self-rollback by ${by}: anchor-overlap conflict detected after write (BUG-011 TOCTOU guard)`,
      "release",
      { by, rollback: true },
    );
  }

  // ── release ──────────────────────────────────────────────────────────────

  /**
   * Clears the advisory execution lease on a task.
   * Holder-or-`--force` gate: a non-holder release without `force: true` is rejected
   * with CLAIM_CONFLICT. `reason` (if given) lands in the version history entry.
   *
   * @param idOrSlug - Task document ULID or slug
   * @param opts - `{ by, reason?, force?, source? }`
   * @param now - Time seam (D10)
   * @returns The updated task DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task / no active claim), CLAIM_CONFLICT, STALE_VERSION
   */
  async release(
    idOrSlug: string,
    opts: ReleaseOpts,
    now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._releaseImpl(idOrSlug, opts, now);
    this.recordEvent("task.released", startMs, result, opts.source, {
      by: opts.by,
      force: opts.force === true,
    });
    return result;
  }

  private async _releaseImpl(
    idOrSlug: string,
    opts: ReleaseOpts,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    const taskResult = await this.resolveTask(idOrSlug);
    if (!taskResult.ok) return taskResult;
    const task = taskResult.value;

    const existingClaim = readClaim(task);
    if (existingClaim === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.claim",
        message: "Task has no active claim to release",
        value: task.id,
      });
    }

    const nowIso = now();
    const isHolder = existingClaim.by === opts.by;
    if (!isHolder && opts.force !== true) {
      return err({
        code: "CLAIM_CONFLICT",
        id: task.id,
        holder: existingClaim.by,
        age_minutes: ageMinutesBetween(nowIso, existingClaim.at),
      });
    }

    const newExtra: Record<string, unknown> = { ...task.extra };
    delete newExtra["claim"];

    const forcedNote = !isHolder ? ` (forced, previous holder: ${existingClaim.by})` : "";
    const reasonNote = opts.reason !== undefined ? `: ${opts.reason}` : "";
    const summary = `Released by ${opts.by}${forcedNote}${reasonNote}`;

    return this.writeTaskExtra(task, newExtra, nowIso, opts.by, summary, "release", {
      by: opts.by,
      force: opts.force === true,
      previous_holder: existingClaim.by,
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    });
  }

  // ── done ─────────────────────────────────────────────────────────────────

  /**
   * Evidence-validated, atomic-from-the-caller's-perspective lifecycle walk to
   * `"archived"` (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3,
   * AC-WH-3) — closes the gap the EXECUTE loop (claim → evidence → release) leaves: a
   * released task stays `draft`, which readiness's `blocks`-link computation never
   * treats as "met" (only `archived`/`deprecated` are terminal).
   *
   * Refuses (VALIDATION_ERROR) when:
   *   - the task holds no `result: "pass"` evidence entry — `"expected-fail"` (M1),
   *     `"fail"`, and `"inconclusive"` never count, regardless of how many of them exist;
   *   - a FRESH claim (same `isClaimStale` freshness test `claim()`/`ready()` use) is
   *     held by a DIFFERENT actor than `opts.by` — a STALE claim, or a fresh claim held
   *     by `opts.by` itself, never blocks.
   *
   * An ALREADY-terminal task (`status` is `archived` or `deprecated`) is an IDEMPOTENT
   * NO-OP: returns `{already_done: true, transitions: [], task}` with the doc completely
   * UNCHANGED — never an error. A second `lore done` call after a first one succeeded
   * must never fail.
   *
   * Otherwise walks {@link computeArchiveWalk}'s canonical multi-step path ONE STEP AT A
   * TIME, each step its own CAS-guarded {@link writeTaskStatus} write (own version bump,
   * own versions row, own audit entry — "one audit row per lifecycle step", AC-WH-3).
   * "Atomic from the caller's perspective" means ONE COMMAND, not one store transaction:
   * a mid-walk failure (e.g. `STALE_VERSION` from a concurrent writer) surfaces loud
   * immediately, leaving the doc at whatever intermediate status the last successful
   * step reached — the caller can safely retry `lore done`, which re-validates
   * evidence/claim against the doc's CURRENT status and resumes the walk (never
   * re-running an already-committed step, since `computeArchiveWalk` is re-derived from
   * the freshly-read `task.status` each call).
   *
   * @param idOrSlug - Task document ULID or slug
   * @param opts - `{ by, source? }`
   * @param now - Time seam (D10) — ONE reading shared by every step's timestamp
   * @returns `DoneResult` — see that type's own JSDoc
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task / no passing evidence / fresh
   *   foreign claim / illegal lifecycle step — the last one structurally unreachable
   *   given `computeArchiveWalk`'s own base-graph-only steps, kept as a fail-loud guard
   *   rather than a non-null assertion), STALE_VERSION
   */
  async done(
    idOrSlug: string,
    opts: DoneOpts,
    now: () => string = defaultNow,
  ): Promise<Result<DoneResult, LoreError>> {
    const startMs = Date.now();
    const result = await this._doneImpl(idOrSlug, opts, now);
    this.recordEvent("task.done", startMs, result, opts.source, {
      by: opts.by,
      already_done: result.ok ? result.value.already_done : false,
    });
    return result;
  }

  private async _doneImpl(
    idOrSlug: string,
    opts: DoneOpts,
    now: () => string,
  ): Promise<Result<DoneResult, LoreError>> {
    const taskResult = await this.resolveTask(idOrSlug);
    if (!taskResult.ok) return taskResult;
    let task = taskResult.value;

    // reason: idempotent no-op BEFORE any evidence/claim validation — a second `lore
    // done` on an already-archived task must succeed even if, say, its evidence log
    // somehow no longer holds a pass (it can't be edited post-archival in practice, but
    // this ordering makes that irrelevant rather than a latent footgun).
    if (task.status === "archived" || task.status === "deprecated") {
      return ok({ task, already_done: true, transitions: [] });
    }

    const evidence = readEvidence(task);
    if (!evidence.some((e) => e.result === "pass")) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.verification_evidence",
        message:
          `Task "${task.slug}" holds no result:pass evidence entry — lore done requires ` +
          `at least one passing oracle verification before archiving ("expected-fail", ` +
          `"fail", and "inconclusive" entries never count)`,
        value: evidence.map((e) => e.result),
      });
    }

    const nowIso = now();
    const claim = readClaim(task);
    if (claim !== undefined && claim.by !== opts.by && !isClaimStale(claim, nowIso, this.claimTtlMinutes)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.claim",
        message:
          `Task "${task.slug}" is held by a fresh claim from "${claim.by}" — lore done ` +
          `refuses to archive a task out from under an active session`,
        value: claim.by,
      });
    }

    const walk = computeArchiveWalk(task.status);
    const transitions: DocStatus[] = [];
    for (const nextStatus of walk) {
      if (!isValidTransition(task.status, nextStatus)) {
        return err({
          code: "VALIDATION_ERROR",
          field: "status",
          message: `Illegal lifecycle step ${task.status} -> ${nextStatus} while archiving "${task.slug}"`,
          value: { from: task.status, to: nextStatus },
        });
      }
      const stepResult = await this.writeTaskStatus(
        task,
        nextStatus,
        nowIso,
        opts.by,
        `lore done: ${task.status} → ${nextStatus}`,
      );
      if (!stepResult.ok) return stepResult;
      task = stepResult.value;
      transitions.push(nextStatus);
    }

    // reason: DD-2 fact computation runs ONLY after a real walk (never the
    // idempotent-no-op branch above, which returns before this point) — an
    // already-terminal task on a second `lore done` call produces no fresh
    // "last task" signal since nothing changed this call.
    const planFactResult = await this.computePlanNowFullyTerminal(task);
    if (!planFactResult.ok) return planFactResult;

    return ok({
      task,
      already_done: false,
      transitions,
      ...(planFactResult.value !== undefined ? { plan_now_fully_terminal: planFactResult.value } : {}),
    });
  }

  // ── Anchor Mutations (SPEC-042 D3) ──────────────────────────────────────────

  /**
   * Declaratively REPLACES a task's `file_anchors` (the `lore_anchor_set` MCP
   * shape, SPEC-042 D9). Read-modify-write via {@link writeTaskExtra} —
   * `extra.claim`/`extra.verification_evidence` are preserved untouched
   * (AC-S3-5 regression), never routed through `CorpusService.set` (D3 — a
   * wholesale-`extra` replace would silently delete those other services' owned
   * state).
   *
   * @param idOrSlug - Task document ULID or slug
   * @param anchors - Candidate raw anchor strings — validated + normalized via
   *   `normalizeFileAnchors` (`@lore/core`); a validation failure aborts the
   *   write before any store call.
   * @param opts - `{ by, source? }`
   * @param now - Time seam (D10)
   * @returns The updated task DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task / bad anchor entry), STALE_VERSION
   */
  async setAnchors(
    idOrSlug: string,
    anchors: string[],
    opts: AnchorMutationOpts,
    now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._setAnchorsImpl(idOrSlug, anchors, opts.by, now);
    this.recordEvent("task.anchors_updated", startMs, result, opts.source, { count: anchors.length });
    return result;
  }

  private async _setAnchorsImpl(
    idOrSlug: string,
    anchors: string[],
    by: string,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    const taskResult = await this.resolveTask(idOrSlug);
    if (!taskResult.ok) return taskResult;
    const task = taskResult.value;

    const hashRejectResult = rejectHashInTaskAnchors(anchors);
    if (!hashRejectResult.ok) return hashRejectResult;

    const normalizedResult = normalizeFileAnchors(anchors);
    if (!normalizedResult.ok) return normalizedResult;

    return this.commitAnchors(task, normalizedResult.value, by, now);
  }

  /**
   * Read-modify-write UNION: appends `anchors` to the task's existing
   * `file_anchors`, validated + normalized + deduplicated together (the
   * `lore anchor add` command, D3).
   *
   * @param idOrSlug - Task document ULID or slug
   * @param anchors - Candidate raw anchor strings to add.
   * @param opts - `{ by, source? }`
   * @param now - Time seam (D10)
   * @returns The updated task DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task / bad anchor entry / >50 total), STALE_VERSION
   */
  async addAnchors(
    idOrSlug: string,
    anchors: string[],
    opts: AnchorMutationOpts,
    now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._addAnchorsImpl(idOrSlug, anchors, opts.by, now);
    this.recordEvent("task.anchors_updated", startMs, result, opts.source, { count: anchors.length });
    return result;
  }

  private async _addAnchorsImpl(
    idOrSlug: string,
    anchors: string[],
    by: string,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    const taskResult = await this.resolveTask(idOrSlug);
    if (!taskResult.ok) return taskResult;
    const task = taskResult.value;

    const hashRejectResult = rejectHashInTaskAnchors(anchors);
    if (!hashRejectResult.ok) return hashRejectResult;

    const existing = extractFileAnchors(task);
    const normalizedResult = normalizeFileAnchors([...existing, ...anchors]);
    if (!normalizedResult.ok) return normalizedResult;

    return this.commitAnchors(task, normalizedResult.value, by, now);
  }

  /**
   * Read-modify-write DIFFERENCE: removes `anchors` from the task's existing
   * `file_anchors` (the `lore anchor rm` command, D3). `anchors` is itself
   * normalized before comparison (so `"./src/a"` matches a stored `"src/a"`) —
   * a malformed removal candidate fails loud the same way an add/set would,
   * rather than silently matching nothing.
   *
   * @param idOrSlug - Task document ULID or slug
   * @param anchors - Candidate raw anchor strings to remove.
   * @param opts - `{ by, source? }`
   * @param now - Time seam (D10)
   * @returns The updated task DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task / bad anchor entry), STALE_VERSION
   */
  async removeAnchors(
    idOrSlug: string,
    anchors: string[],
    opts: AnchorMutationOpts,
    now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._removeAnchorsImpl(idOrSlug, anchors, opts.by, now);
    this.recordEvent("task.anchors_updated", startMs, result, opts.source, { count: anchors.length });
    return result;
  }

  private async _removeAnchorsImpl(
    idOrSlug: string,
    anchors: string[],
    by: string,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    const taskResult = await this.resolveTask(idOrSlug);
    if (!taskResult.ok) return taskResult;
    const task = taskResult.value;

    const normalizedRemovalResult = normalizeFileAnchors(anchors);
    if (!normalizedRemovalResult.ok) return normalizedRemovalResult;
    const toRemove = new Set(normalizedRemovalResult.value);

    const existing = extractFileAnchors(task);
    const remaining = existing.filter((a) => !toRemove.has(a));

    return this.commitAnchors(task, remaining, by, now);
  }

  /**
   * Shared commit path for the three anchor-mutation verbs above — writes
   * `extra.file_anchors` via {@link writeTaskExtra}, preserving every other
   * `extra` key (`claim`/`verification_evidence`) untouched (AC-S3-5 regression).
   */
  private async commitAnchors(
    task: DocRecord,
    newAnchors: string[],
    by: string,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    const nowIso = now();
    const newExtra: Record<string, unknown> = { ...task.extra, file_anchors: newAnchors };
    return this.writeTaskExtra(
      task,
      newExtra,
      nowIso,
      by,
      `File anchors updated by ${by} (${newAnchors.length} entries)`,
      "anchors",
      { by, count: newAnchors.length },
    );
  }

  // ── Declared AC Scope Mutations (spec-declared-scope-attestation-contract) ──

  /**
   * Read-modify-write UNION on a task's `extra.ac_scope` — the `lore scope add`
   * command's task-tier half.
   *
   * The merge computation and every invariant guarding it (including the
   * `assertScopeFreeze` evidence-freeze check) live in the shared pure
   * `computeAcScopeEdit` (`@lore/core`), which `PhaseWorkflowService.addAcScope`
   * calls too — this method never re-derives scope semantics, exactly as the
   * anchor verbs above never re-derive `normalizeFileAnchors`'s rules.
   *
   * @param idOrSlug - Task document ULID or slug
   * @param acIds - Candidate AC ids to declare, verbatim (no trim/case folding)
   * @param opts - `{ by, source? }` — same shape the anchor verbs take
   * @param now - Time seam (D10)
   * @returns The updated task DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task / blank id / >50-id cap),
   *   STALE_VERSION
   */
  async addAcScope(
    idOrSlug: string,
    acIds: string[],
    opts: AnchorMutationOpts,
    now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    return this.editAcScope(idOrSlug, "add", acIds, opts, now);
  }

  /**
   * Read-modify-write DIFFERENCE on a task's `extra.ac_scope` — the
   * `lore scope rm` command's task-tier half.
   *
   * @invariant Removing the LAST declared id stores an EMPTY ARRAY, never an
   *   absent key — an explicit un-declaration ("this task claims nothing") is a
   *   different authorial state from "nobody ever declared a scope", and
   *   `lore verify` refuses the two with different messages. `computeAcScopeEdit`
   *   returns `[]` and this method writes it through verbatim.
   * @invariant An id that already carries evidence (`verification_evidence[].ac_ref`)
   *   CANNOT be removed — `computeAcScopeEdit`'s `assertScopeFreeze` call refuses
   *   with `VALIDATION_ERROR` (exit 4) before any store write.
   *
   * @param idOrSlug - Task document ULID or slug
   * @param acIds - Candidate AC ids to un-declare
   * @param opts - `{ by, source? }`
   * @param now - Time seam (D10)
   * @returns The updated task DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task / blank id / evidenced
   *   id removal), STALE_VERSION
   */
  async removeAcScope(
    idOrSlug: string,
    acIds: string[],
    opts: AnchorMutationOpts,
    now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    return this.editAcScope(idOrSlug, "rm", acIds, opts, now);
  }

  /**
   * Shared resolve → compute → commit path for {@link addAcScope}/{@link removeAcScope}.
   *
   * reason: the audit action is the GENERIC `"update"`, not a bespoke
   * `"scope"` label, because `AuditService.verify`'s completeness join accepts
   * only actions listed in `VERSION_ACTION_AUDIT_FAMILY` (`audit-service.ts`)
   * for a versions row stamped `"update"` — an unlisted label would make every
   * scope write read as a MISSING audit entry and break `lore audit --verify`,
   * which `hooks/pre-push` runs. `details.scope_op` carries the add/rm
   * distinction instead, so nothing is lost.
   */
  private async editAcScope(
    idOrSlug: string,
    op: AcScopeEditOp,
    acIds: string[],
    opts: AnchorMutationOpts,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    // reason: no `this.recordEvent(...)` here, unlike every sibling verb. The
    // telemetry event NAME is a closed union (`TaskWorkflowEventName`,
    // `@lore/core`'s telemetry module) with no scope member, and that module is
    // outside this task's declared file anchors. Reusing
    // `"task.anchors_updated"` would write a FALSE row into the telemetry sink
    // — worse than silence, and indistinguishable afterwards from a real anchor
    // edit. The durable observability path IS wired: `writeTaskExtra` below
    // appends an audit entry carrying `details.scope_op`, queryable via
    // `lore audit`. Adding a `task.scope_updated` member is the follow-up for
    // whichever task owns that module.
    return this._editAcScopeImpl(idOrSlug, op, acIds, opts.by, now);
  }

  private async _editAcScopeImpl(
    idOrSlug: string,
    op: AcScopeEditOp,
    acIds: string[],
    by: string,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    const taskResult = await this.resolveTask(idOrSlug);
    if (!taskResult.ok) return taskResult;
    const task = taskResult.value;

    const prev = extractDeclaredAcScope(task) ?? [];
    const editResult = computeAcScopeEdit(prev, op, acIds, readEvidence(task));
    if (!editResult.ok) return editResult;
    const next = editResult.value;

    const nowIso = now();
    const newExtra: Record<string, unknown> = { ...task.extra, ac_scope: next };
    return this.writeTaskExtra(
      task,
      newExtra,
      nowIso,
      by,
      `Declared ac_scope ${op === "add" ? "extended" : "reduced"} by ${by} (${next.length} id(s))`,
      "update",
      { by, scope_op: op, count: next.length },
    );
  }

  // ── ready ────────────────────────────────────────────────────────────────

  /**
   * Computed readiness report for every task under a plan. Zero writes (D3).
   *
   * Fetches: (1) the plan's parent doc, once, to derive the SPEC-032 §3.4
   * `upstream_unapproved` advisory (non-null iff the parent is a `spec`), (2) the
   * plan's child tasks, (3) `blocks`-type links targeting those tasks in one batch
   * query (D7), (4) statuses/slugs for the referenced blocker docs — then delegates
   * to the pure `evaluateReadiness`. SPEC-042 D7 additionally derives `sessions`
   * (this plan's FRESH claims grouped by `deriveSessions`) and `anchor_conflicts`
   * (fresh, foreign, anchor-overlapping sibling pairs) — both PLAN-SCOPED, zero
   * extra store IO (reuses the SAME `tasks` array already fetched below).
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param now - Time seam (D10) — drives claim staleness computation
   * @returns `ReadyReport` — `{records, sessions, anchor_conflicts}` (see that
   *   type's JSDoc for why the pre-SPEC-042 flat array became `.records`)
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a plan)
   */
  async ready(
    planIdOrSlug: string,
    now: () => string = defaultNow,
  ): Promise<Result<ReadyReport, LoreError>> {
    const planResult = await resolveDoc(this.store, planIdOrSlug);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;

    if (plan.type !== "plan") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a plan document; got type '${plan.type}'`,
        value: plan.type,
      });
    }

    // reason: SPEC-032 §3.4 — a task under a plan whose parent spec isn't approved
    // is still computed-ready per blockers, but every record carries an advisory
    // flag. `null` (not "draft") when the plan has no spec parent (top-level, or
    // parented under a prd) — evaluateReadiness treats null as "nothing to warn about".
    let parentSpecStatus: DocStatus | null = null;
    if (plan.parent_id !== null) {
      const parentResult = await this.store.find(plan.parent_id);
      if (!parentResult.ok) return parentResult;
      if (parentResult.value !== null && parentResult.value.type === "spec") {
        parentSpecStatus = parentResult.value.status;
      }
    }

    const tasksResult = await this.store.findMany({ parent_id: plan.id, type: "task" });
    if (!tasksResult.ok) return tasksResult;
    const tasks = tasksResult.value;

    if (tasks.length === 0) return ok({ records: [], sessions: [], anchor_conflicts: [] });

    const nowIso = now();

    const taskIds = tasks.map((t) => t.id);
    const linksResult = await this.store.findLinksByToIds(taskIds, "blocks");
    if (!linksResult.ok) return linksResult;
    const blocksLinks = linksResult.value;

    const blockerIds = new Set(blocksLinks.map((l) => l.from_id));
    const blockerStatuses = new Map<DocId, BlockerInfo>();
    if (blockerIds.size > 0) {
      // reason: StoreFilters has no id-in-list predicate — D7 only adds a link batch
      // query, not a doc batch query. One unfiltered findMany + client-side pick keeps
      // this at "one findMany for blocker statuses" per §8.3, which is acceptable at
      // the real plan sizes (tens of tasks) D3's rationale targets.
      const allDocsResult = await this.store.findMany({});
      if (!allDocsResult.ok) return allDocsResult;
      for (const doc of allDocsResult.value) {
        if (blockerIds.has(doc.id)) {
          blockerStatuses.set(doc.id, { slug: doc.slug, status: doc.status });
        }
      }
    }

    const records = evaluateReadiness(
      tasks,
      blocksLinks,
      blockerStatuses,
      nowIso,
      this.claimTtlMinutes,
      parentSpecStatus,
    );

    const { anchorConflicts, anchorlessSlugs } = this.computeAnchorAdvisories(tasks, nowIso);
    const recordsWithAnchorless = records.map((r) =>
      anchorlessSlugs.has(r.task.slug) ? { ...r, anchorless: true } : r,
    );

    return ok({
      records: recordsWithAnchorless,
      sessions: deriveSessions(tasks, nowIso, this.claimTtlMinutes),
      anchor_conflicts: anchorConflicts,
    });
  }

  /**
   * Computed readiness-style listing for OPEN (non-terminal) ad-hoc tasks
   * (SPEC-069 §Design Decisions D2, AC-069-7) — the `--adhoc` counterpart to
   * `ready(plan)`: a planless task can never be "ready under a plan" (it has
   * no `plan_id`), and must not become INVISIBLE to `lore ready` just because
   * of that — the whole point of D2 was giving ad-hoc work a first-class,
   * discoverable home instead of a silently-parked one.
   *
   * Reuses the SAME pure `evaluateReadiness` (`@lore/core`) `ready()`
   * delegates to (blocks-links + terminal-status computation) — an ad-hoc
   * task's readiness fields are byte-identical in SHAPE to a plan task's,
   * only the SOURCE SET differs (every corpus-wide `extra.adhoc === true`
   * task, not one plan's children). `parentSpecStatus` is always `null` here
   * (no plan → no upstream-spec advisory is possible for this listing).
   *
   * "Open" = not yet terminal — `task.status` is neither `archived` nor
   * `deprecated` — the SAME terminal-state notion `formatReadyLine`'s "done"
   * bucket and `evaluateReadiness`'s own `isTerminal` check already use;
   * filtered HERE (before `evaluateReadiness` runs) rather than post-hoc, so
   * a closed ad-hoc task never appears in this listing at all.
   *
   * @invariant SPEC-072 review-gate carve-out — a foreign-authored issue
   *   report (`extra.issue_report` present, written by `lore report-issue`
   *   against an upstream corpus) is EXCLUDED here while its status is
   *   `draft` or `in-review`: PRD §20 F3's user-approved boundary and
   *   AC-072-1 both require the report to sit in pending review, invisible
   *   to `--adhoc`, until a human/AI reviewer approves it. This is a
   *   NARROWER carve-out than SPEC-069 D2's own stated design intent (an
   *   ad-hoc task "must not become invisible just because" of status) —
   *   D2's visibility guarantee is intentionally PRESERVED for self-authored
   *   ad-hoc tasks (no `extra.issue_report`), which still surface in draft.
   *   Once approved (or in any status past `in-review`), an issue-report
   *   task is indistinguishable from any other open ad-hoc task.
   *
   * Zero writes (D3, same invariant `ready()` carries).
   *
   * @param now - Time seam — drives claim staleness computation, same as `ready()`
   * @returns every OPEN ad-hoc task's `ReadyRecord` (unsorted — call-site
   *   ordering is `findMany`'s own `updated_at DESC, id ASC`, unchanged here)
   */
  async readyAdhoc(now: () => string = defaultNow): Promise<Result<ReadyRecord[], LoreError>> {
    const tasksResult = await this.store.findMany({ type: "task" });
    if (!tasksResult.ok) return tasksResult;
    const openAdhocTasks = tasksResult.value.filter((t) => {
      if (t.extra?.["adhoc"] !== true) return false;
      if (t.status === "archived" || t.status === "deprecated") return false;
      // reason: foreign-authored issue reports are review-gated (SPEC-072,
      // PRD §20 F3) — a draft/in-review report stays out of --adhoc until a
      // reviewer approves it, even though a self-authored ad-hoc task in the
      // same status is intentionally visible (SPEC-069 D2).
      const isUnreviewedIssueReport =
        t.extra?.["issue_report"] !== undefined &&
        (t.status === "draft" || t.status === "in-review");
      if (isUnreviewedIssueReport) return false;
      return true;
    });

    if (openAdhocTasks.length === 0) return ok([]);

    const nowIso = now();

    const taskIds = openAdhocTasks.map((t) => t.id);
    const linksResult = await this.store.findLinksByToIds(taskIds, "blocks");
    if (!linksResult.ok) return linksResult;
    const blocksLinks = linksResult.value;

    const blockerIds = new Set(blocksLinks.map((l) => l.from_id));
    const blockerStatuses = new Map<DocId, BlockerInfo>();
    if (blockerIds.size > 0) {
      // reason: same "one unfiltered findMany + client-side pick" tradeoff
      // ready()'s identical block above documents — StoreFilters has no
      // id-in-list predicate.
      const allDocsResult = await this.store.findMany({});
      if (!allDocsResult.ok) return allDocsResult;
      for (const doc of allDocsResult.value) {
        if (blockerIds.has(doc.id)) {
          blockerStatuses.set(doc.id, { slug: doc.slug, status: doc.status });
        }
      }
    }

    const records = evaluateReadiness(
      openAdhocTasks,
      blocksLinks,
      blockerStatuses,
      nowIso,
      this.claimTtlMinutes,
      null,
    );

    return ok(records);
  }

  /**
   * Computes SPEC-042 D7's `anchor_conflicts` + `anchorless` advisories over a
   * plan's tasks. Pure computation over already-fetched data (no extra store
   * IO) — a private helper rather than a `@lore/core` export because it's used
   * ONLY by `ready()`'s plan-scoped report, unlike `deriveSessions` (shared with
   * `SessionService.bootstrap`'s corpus-wide scope).
   *
   * `anchor_conflicts`: for each task declaring ≥1 anchor, every OTHER task in
   * `tasks` holding a FRESH claim by a DIFFERENT actor (different from the
   * declaring task's OWN current holder, when it has one) whose anchors overlap.
   *
   * `anchorless`: the SET of task slugs that hold a FRESH claim, declare NO
   * anchors themselves, while at least one OTHER task in `tasks` declares
   * non-empty anchors (D7, review U7 — silent on zero-adoption plans).
   */
  private computeAnchorAdvisories(
    tasks: DocRecord[],
    nowIso: string,
  ): { anchorConflicts: AnchorConflict[]; anchorlessSlugs: Set<string> } {
    const anyoneDeclaresAnchors = tasks.some((t) => extractFileAnchors(t).length > 0);
    const anchorConflicts: AnchorConflict[] = [];
    const anchorlessSlugs = new Set<string>();

    for (const task of tasks) {
      const taskAnchors = extractFileAnchors(task);
      const taskClaim = readClaim(task);

      if (taskAnchors.length > 0) {
        for (const other of tasks) {
          if (other.id === task.id) continue;
          const otherClaim = readClaim(other);
          if (otherClaim === undefined) continue;
          if (isClaimStale(otherClaim, nowIso, this.claimTtlMinutes)) continue;
          if (taskClaim !== undefined && taskClaim.by === otherClaim.by) continue;
          const otherAnchors = extractFileAnchors(other);
          if (otherAnchors.length === 0) continue;
          const overlap = anchorsOverlap(taskAnchors, otherAnchors);
          if (overlap.overlaps) {
            anchorConflicts.push({
              task_slug: task.slug,
              holder: otherClaim.by,
              paths: overlap.pairs.map(([a]) => a),
            });
          }
        }
      }

      if (
        anyoneDeclaresAnchors &&
        taskAnchors.length === 0 &&
        taskClaim !== undefined &&
        !isClaimStale(taskClaim, nowIso, this.claimTtlMinutes)
      ) {
        anchorlessSlugs.add(task.slug);
      }
    }

    return { anchorConflicts, anchorlessSlugs };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /** Resolves idOrSlug and validates it is a task document. */
  private async resolveTask(idOrSlug: string): Promise<Result<DocRecord, LoreError>> {
    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;
    if (doc.type !== "task") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a task document; got type '${doc.type}'`,
        value: doc.type,
      });
    }
    return ok(doc);
  }

  /**
   * Computes DD-2's `DoneResult.plan_now_fully_terminal` fact (spec-plan-closure-
   * must-be-loud-terminality-divergence-silent, AC-CLOSURE-3) — a READ-ONLY check,
   * never a write: `done()`'s own Invariant 1 forbids this service from touching the
   * plan document. Returns `undefined` (not an error) for every case that does not
   * warrant the advisory: `archivedTask.parent_id === null`, a parent that fails to
   * resolve or is not `type: "plan"` (adhoc tasks auto-parent to the root PRD —
   * `CorpusService._createImpl`'s adhoc block), a plan that is ALREADY terminal
   * (nothing left to announce), or a plan with ≥1 still-non-terminal child task.
   *
   * @param archivedTask - The task DocRecord AFTER `_doneImpl`'s walk wrote it to
   *   `"archived"` — its `parent_id` is unchanged by that walk (only `status`/
   *   `version`/`updated_at` are touched), so this reads that same field.
   * @returns `ok({ plan_slug })` when every child task under the parent plan is now
   *   terminal and the plan itself is not; `ok(undefined)` otherwise; `err(...)` only
   *   on a genuine store failure reading the parent or siblings (propagated, not
   *   swallowed — a store error here must not silently masquerade as "no advisory").
   */
  private async computePlanNowFullyTerminal(
    archivedTask: DocRecord,
  ): Promise<Result<{ plan_slug: string } | undefined, LoreError>> {
    if (archivedTask.parent_id === null) return ok(undefined);

    const parentResult = await this.store.find(archivedTask.parent_id);
    if (!parentResult.ok) return parentResult;
    const plan = parentResult.value;
    if (plan === null || plan.type !== "plan") return ok(undefined);
    if (isTerminalStatus(plan.status)) return ok(undefined);

    const siblingsResult = await this.store.findMany({ parent_id: plan.id, type: "task" });
    if (!siblingsResult.ok) return siblingsResult;
    const siblings = siblingsResult.value;

    const allTerminal = siblings.length > 0 && siblings.every((t) => isTerminalStatus(t.status));
    if (!allTerminal) return ok(undefined);

    return ok({ plan_slug: plan.slug });
  }

  /**
   * Gates `task`'s claim (retro follow-up item 8, defense-in-depth; SPEC-042 D5
   * anchor-overlap extension) — resolves the task's parent plan's ancestor spec
   * AND sibling claims via the injected `getPlanBundle` port (the SAME
   * plan→parent-spec traversal `ready()`'s `upstream_unapproved` advisory and
   * `lore gate task-claim` both use — `bundle.tasks` already returns every
   * sibling, zero extra IO) and enforces the `task-claim` checkpoint. A
   * `parent_id === null` task (schema-illegal for a real task — SPEC-025's
   * `createDocInputSchema` requires `parent_id` — but tolerated here for legacy/
   * corrupted rows) is routed through the SAME checkpoint via a synthetic "no
   * spec parent, no siblings" context rather than a second hardcoded pass,
   * mirroring `gate.ts`'s `runTaskClaimGate` identical handling of this edge
   * case.
   *
   * **SPEC-069 ad-hoc gap fix (task-fix-spec-069-gap-adhoc-task-claim-
   * structurally-impossible)**: a task with a NON-null `parent_id` that resolves
   * but is not `type: "plan"` — every `--adhoc` task (SPEC-069 §Design Decisions
   * D2), auto-parented to the root PRD — used to hard-fail here via
   * `getPlanBundle`'s "Expected a plan document" error, making such a task
   * structurally unclaimable. `isNonPlanParentError` (`checkpoint-registry.ts`)
   * detects this SPECIFIC, structural failure shape (parent resolved, wrong
   * type) and routes it through the SAME "no governing plan" vacuous-pass
   * `upstreamApproved` gets for `parent_id === null` — but, UNLIKE that legacy
   * branch, `noAnchorOverlap` is still evaluated against REAL siblings
   * (`findAdhocSiblingTasks`, every OTHER corpus-wide `extra.adhoc === true`
   * task) rather than an empty list: SPEC-042 requires this predicate to run
   * UNCONDITIONALLY, and a permanently-empty sibling set would silently make it
   * unable to ever fire for the entire `--adhoc` channel. Every OTHER
   * `getPlanBundle` failure (an unresolvable/soft-deleted parent, a store
   * error) still propagates as a hard failure, unchanged.
   *
   * A no-op (`ok(undefined)`) when this service wasn't constructed with a
   * `gate` dependency (see constructor JSDoc).
   *
   * @param task - The task `claim()` is about to write a lease onto.
   * @param opts - The FULL `claim()` opts — `.by` feeds `noAnchorOverlap`'s
   *   "different actor" test; `.identitySource`/`.worktree`/`.machine` (spec
   *   claim-time-actor-identity-guard-zero-evidence-release-advis, AC-
   *   IDENTITY-REJECT) feed `actorIdentityGuard`'s collision-signature test —
   *   all read straight from `opts`, no extra IO.
   * @param nowIso - The SAME "now" `_claimImpl` resolved before calling this
   *   (D5 seam pinning) — drives sibling claim staleness, never re-resolved here.
   */
  private async enforceClaimGate(
    task: DocRecord,
    opts: ClaimOpts,
    nowIso: string,
  ): Promise<Result<void, LoreError>> {
    if (this.gate === undefined) {
      return ok(undefined);
    }

    // reason: check disable BEFORE the getPlanBundle IO below — mirrors gate.ts's
    // isGateDisabledByConfig-before-runTaskClaimGate order. Without this early-out, a
    // disabled task-claim gate could still be blocked by a broken ancestor-spec lookup
    // (e.g. a soft-deleted parent plan), violating "disabled === byte-identical to
    // pre-GateEnforcer behavior" (adversarial review, retro item 8 follow-up).
    if (!this.gate.enforcer.isEnabled("task-claim")) {
      return ok(undefined);
    }

    const by = opts.by;
    let ctx: ReturnType<typeof buildUpstreamSpecContext> &
      Partial<ReturnType<typeof buildAnchorGateContext>>;
    if (task.parent_id === null) {
      ctx = { ...buildUpstreamSpecContext(undefined), candidateBy: by, candidateAnchors: extractFileAnchors(task), siblingClaims: [] };
    } else {
      const bundleResult = await this.gate.getPlanBundle(task.parent_id);
      if (!bundleResult.ok) {
        if (!isNonPlanParentError(bundleResult.error)) return bundleResult;
        const siblingsResult = await this.findAdhocSiblingTasks();
        if (!siblingsResult.ok) return siblingsResult;
        const anchorCtx = buildAnchorGateContext(by, task, siblingsResult.value, nowIso, this.claimTtlMinutes);
        ctx = { ...buildUpstreamSpecContext(undefined), ...anchorCtx };
      } else {
        const anchorCtx = buildAnchorGateContext(by, task, bundleResult.value.tasks, nowIso, this.claimTtlMinutes);
        ctx = { ...buildUpstreamSpecContext(bundleResult.value.spec), ...anchorCtx };
      }
    }

    return this.gate.enforcer.enforce("task-claim", {
      ...ctx,
      targetIdOrSlug: task.slug,
      anchorOverlapEnabled: this.gate.enforcer.isTaskClaimAnchorOverlapEnabled(),
      actorIdentityEnabled: this.gate.enforcer.isTaskClaimActorIdentityEnabled(),
      // reason: `exactOptionalPropertyTypes` — `GateContext`'s optional string
      // fields reject an EXPLICIT `undefined` value on a present key, so an
      // omitted `opts.*` field must omit the ctx key entirely rather than
      // assign it `undefined` (mirrors this codebase's established
      // `...(x !== undefined ? {y: x} : {})` pattern elsewhere).
      ...(opts.identitySource !== undefined ? { candidateIdentitySource: opts.identitySource } : {}),
      ...(opts.worktree !== undefined ? { candidateWorktree: opts.worktree } : {}),
      ...(opts.machine !== undefined ? { candidateMachine: opts.machine } : {}),
    });
  }

  /**
   * Corpus-wide `extra.adhoc === true` task scan — the `noAnchorOverlap`
   * sibling universe for a task with no governing plan (SPEC-069 ad-hoc gap
   * fix, see `enforceClaimGate`'s JSDoc). Mirrors `readyAdhoc`'s identical
   * `store.findMany({type: "task"})` + `extra.adhoc === true` filter, MINUS
   * its open/issue-report narrowing — anchor-overlap must consider every
   * ad-hoc task holding a claim regardless of status; `buildAnchorGateContext`
   * already discounts a stale claim (`isClaimStale`) and skips the candidate
   * task itself (matched by id), so no further filtering belongs here.
   *
   * PUBLIC (not just an `enforceClaimGate` internal) because `gate.ts`'s
   * `runTaskClaimGate` (the `lore gate task-claim` pre-flight CLI command)
   * needs the IDENTICAL sibling universe to reach the same verdict `claim()`
   * itself would for the same target/actor — the same "one shared ctx-builder,
   * two call sites" precedent `buildAnchorGateContext`/`buildUpstreamSpecContext`
   * already establish (see `checkpoint-registry.ts`'s module header).
   *
   * @returns every task doc (any status) with `extra.adhoc === true`,
   *   INCLUDING the candidate task if it happens to be one — `buildAnchorGateContext`
   *   filters it out by id, the same way `getPlanBundle`'s own `tasks[]` includes
   *   the candidate and relies on that same self-filter.
   */
  async findAdhocSiblingTasks(): Promise<Result<DocRecord[], LoreError>> {
    const tasksResult = await this.store.findMany({ type: "task" });
    if (!tasksResult.ok) return tasksResult;
    return ok(tasksResult.value.filter((t) => t.extra?.["adhoc"] === true));
  }

  /**
   * Shared write path for addEvidence/claim/release: CAS-guarded store.update on
   * `extra` only, followed by one insertVersion snapshot carrying `change_summary`,
   * followed by one audit entry (SPEC-035 §2 — closes the TaskWorkflowService audit
   * coverage gap). Never touches content/title/status (D8 bound).
   *
   * `auditDetails` always gets `version: newVersion` merged in (SPEC-035 §2 — every
   * audit writer stamps the version its action produced) — the caller only supplies
   * the action-specific fields (oracle/command/result for evidence; by/steal/
   * previous_holder for claim; by/force/previous_holder/reason for release). The
   * resulting audit `action` string ("claim"/"release"/"evidence") intentionally
   * does NOT equal the versions row's own `action` ("update", from the insertVersion
   * call above) — `AuditService.verify`'s join key is `(doc_id, version)`, not a
   * literal action-string match, precisely so this label divergence still satisfies
   * the completeness oracle. See audit-service.ts's class-level @invariant.
   */
  private async writeTaskExtra(
    task: DocRecord,
    newExtra: Record<string, unknown>,
    nowIso: string,
    actor: string,
    changeSummary: string,
    // "update" is the generic member the ac_scope verbs pass — see
    // `editAcScope`'s own reason comment for why a bespoke label was rejected
    // (`VERSION_ACTION_AUDIT_FAMILY`, `audit-service.ts`).
    auditAction: "claim" | "release" | "evidence" | "anchors" | "update",
    auditDetails: Record<string, unknown>,
  ): Promise<Result<DocRecord, LoreError>> {
    const newVersion = task.version + 1;
    const updateResult = await this.store.update(
      task.id,
      { extra: newExtra, updated_at: nowIso, version: newVersion },
      { expected_version: task.version },
    );
    if (!updateResult.ok) return updateResult;

    const versionResult = await this.store.insertVersion({
      doc_id: task.id,
      version: newVersion,
      content: updateResult.value.content,
      extra: updateResult.value.extra,
      status: updateResult.value.status,
      title: updateResult.value.title,
      action: "update",
      created_at: nowIso,
      created_by: actor,
      change_summary: changeSummary,
      // SPEC-072 D1/D2 — this write path (claim/release/evidence) never
      // touches slug (D8 bound: only `extra`); carry the current value.
      slug: updateResult.value.slug,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: nowIso,
      actor,
      session_id: `${auditAction}-${task.id}`,
      action: auditAction,
      doc_id: task.id,
      details: { ...auditDetails, version: newVersion },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updateResult.value);
  }

  /**
   * Shared write path for ONE {@link done} lifecycle step — CAS-guarded store.update on
   * `status` only, followed by one insertVersion snapshot and one audit entry. This is
   * the ONLY write path in this service touching `status` — {@link writeTaskExtra}
   * (claim/release/evidence/anchors) touches `extra` exclusively; the two partition the
   * doc's mutable surface between them and are never combined into one write.
   *
   * The audit entry's `action` is deliberately `"update"` (NOT a new `"done"` label) —
   * `AuditService.verify`'s completeness join keys off `VERSION_ACTION_AUDIT_FAMILY`
   * (`audit-service.ts`, out of this task's declared file anchors), which recognizes
   * `"update"` but has no `"done"` member; `details.status_from`/`details.status_to`
   * disambiguate this call from a plain `lore set --status` write for any audit-log
   * reader, mirroring the `archive-cascade`/`archive-sweep` precedent's OWN comment in
   * `corpus-service.ts` for why the versions-row action and the audit-entry action can
   * diverge under this exact-version join.
   */
  private async writeTaskStatus(
    task: DocRecord,
    newStatus: DocStatus,
    nowIso: string,
    actor: string,
    changeSummary: string,
  ): Promise<Result<DocRecord, LoreError>> {
    const newVersion = task.version + 1;
    const updateResult = await this.store.update(
      task.id,
      { status: newStatus, updated_at: nowIso, version: newVersion },
      { expected_version: task.version },
    );
    if (!updateResult.ok) return updateResult;

    const versionResult = await this.store.insertVersion({
      doc_id: task.id,
      version: newVersion,
      content: updateResult.value.content,
      extra: updateResult.value.extra,
      status: updateResult.value.status,
      title: updateResult.value.title,
      action: "update",
      created_at: nowIso,
      created_by: actor,
      change_summary: changeSummary,
      slug: updateResult.value.slug,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: nowIso,
      actor,
      session_id: `done-${task.id}`,
      action: "update",
      doc_id: task.id,
      details: {
        by: actor,
        status_from: task.status,
        status_to: newStatus,
        version: newVersion,
        done: true,
      },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updateResult.value);
  }

  /**
   * Records exactly one telemetry event per successful write (AC-WF-11).
   * Never throws — delegates to Telemetry.record() which swallows IO errors.
   * Failed writes do not emit an event (the AC scopes emission to "successful ... write").
   *
   * `eventName` accepts `"task.done"` in addition to `TaskWorkflowEventName`'s own
   * members (`@lore/core`'s `telemetry.ts`, out of this task's declared file anchors) —
   * widened locally rather than editing that SSOT type, since `TelemetryEvent.method`
   * itself is `z.string()` (unconstrained at the schema level; `TaskWorkflowEventName`
   * only exists to exhaustively check THIS service's own call sites at compile time).
   */
  private recordEvent<T>(
    eventName: TaskWorkflowEventName | "task.done",
    startMs: number,
    result: Result<T, LoreError>,
    source: string | undefined,
    meta: Record<string, unknown>,
  ): void {
    if (!result.ok) return;
    const event: TelemetryEvent = {
      ts: new Date().toISOString(),
      service: "TaskWorkflowService",
      method: eventName,
      ok: true,
      duration_ms: Date.now() - startMs,
      meta: source !== undefined ? { ...meta, source } : meta,
    };
    this.telemetry.record(event);
  }
}
