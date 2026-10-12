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
 *                                             already-terminal task; ALSO refuses a
 *                                             `extra.red_first: true` task with no
 *                                             red evidence row (task-red-first-
 *                                             discipline-is-asked-for-in-prose-but-never),
 *                                             AND (opt-OUT default for every task that
 *                                             never declares red_first) a declared-
 *                                             ac_scope task with no red row and no
 *                                             `noNewTestsReason` declaration (task-a-
 *                                             non-empty-output-tail-can-be-hand-
 *                                             authored-prose-and-the)
 *   declareRedFirst(idOrSlug, opts, now?)  → sets extra.red_first: true (`lore
 *                                             red-first <task>`) — the ONLY writer
 *                                             for that flag (task-red-first-
 *                                             discipline-is-asked-for-in-prose-but-never)
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
 * @invariant `capture_attestation` (SPEC-143 AC-CT-2) is the ONE measured channel through
 *   which a PUBLIC write may reach `attestation`, and it does NOT weaken the invariant
 *   directly above: the `attestation` key itself is still refused on `addEvidence`, and
 *   the only producer of a `capture_attestation` is
 *   `adapters/evidence-capture.ts::captureOracleCommand`, which returns it INSEPARABLY
 *   paired with the `"runner"` label it earned by spawning the command in this same
 *   process (`CapturedProvenance`). {@link promoteCapturedAttestation} moves it into the
 *   `attestation` slot at the ONE point both `_addEvidenceImpl`s hand off to their shared
 *   append. WHY THE SPLIT IS REAL AND NOT A RENAMED BYPASS: a caller supplying
 *   `attestation` asserts a verdict it did not necessarily measure, whereas a caller
 *   supplying `capture_attestation` is forwarding numbers THIS process observed — and
 *   `appendEvidenceEntry` already forces `capture_source: "runner"` for any row carrying
 *   an attestation, so the incoherent pair (self-report label + measured attestation) is
 *   unrepresentable rather than merely refused. Measured defect this closes (2026-08-17):
 *   a `--capture` row said `runner` and carried NO attestation, so an implementer
 *   sincerely reported its pass as attested and had no second source to catch that with.
 * @invariant addEvidence rejects a self-reported `result: "fail"`/`"expected-fail"`
 *   carrying no `output_tail`, or one that is whitespace-only after trimming
 *   (spec-evidence-output-tail-integrity-a-self-reported-non-pass §D1/§D3,
 *   `rejectMissingNonPassOutputTail`, exported for PhaseWorkflowService's identical
 *   AC-ETI-6 guard) — a non-pass self-report's ONLY evidentiary value is its output.
 *   WRITE-PATH ONLY, same as the placeholder-command guard above:
 *   `recordVerifiedEvidence`/`appendEvidenceEntry` are deliberately EXEMPT — a
 *   runner-attested `fail` can legitimately carry an empty tail (silent nonzero
 *   exit, `--quiet` tool, or a timeout killed before flush), and binding this rule
 *   to the shared chokepoint would abort `lore verify` at that AC instead of
 *   reporting the failure. `"pass"` rows were, until task-a-non-empty-output-tail-
 *   can-be-hand-authored-prose-and-the, never bound (see the two invariants
 *   immediately below for the fix — the PASS-side asymmetry this closed).
 * @invariant addEvidence rejects EVERY self-reported `result: "pass"`
 *   (`rejectMissingPassOutputTail`) UNLESS `capture_source === "runner"` OR
 *   `oracle === "manual"` (task-raise-the-evidence-tail-guard-s-predicate-to-
 *   its-own, spec-falsifiability-reachability-a-feedable-checkpoint-an §D5,
 *   superseding task-a-non-empty-output-tail-can-be-hand-authored-prose-and-
 *   the's own predicate) — that predecessor task's "actual fix" (a bare
 *   `output_tail` non-empty check, exempting only `capture_source ===
 *   "runner"`) was ITSELF measured insufficient: 2 of 3 dispatched agents
 *   satisfied "non-empty" by hand-typing a plausible-looking summary, and
 *   both passed the guard it shipped. D5 removes the non-empty-tail escape
 *   entirely for every oracle but `"manual"` — the one kind `--capture`
 *   structurally can never reach (a manual/visual check has no capturable
 *   stdout), so it keeps a non-empty description as ITS OWN proof instead.
 * @invariant `capture_source` (`"runner"` | `"self-report"`, @lore/core's
 *   `CaptureSource`) is the discriminator distinguishing a runner-captured tail
 *   from a self-reported one (task-a-non-empty-output-tail-can-be-hand-authored-
 *   prose-and-the) — NEVER inferred from the tail's own shape/content (a
 *   shape-based guess is exactly the proxy measured to fail: a hand-authored
 *   summary containing a runner-summary-looking substring passes any shape check
 *   cleanly). REQUIRED on both {@link EvidenceInput} and {@link VerifiedEvidenceInput}
 *   (task-capture-source-is-optional-at-the-evidence-write-boundary) — every
 *   caller (`commands/evidence.ts`, `adapters/mcp/tools.ts`, `VerifyRunnerService`,
 *   `PhaseWorkflowService`) passes the value it can actually PROVE; omission is a
 *   compile error, not a runtime default. `appendEvidenceEntry` additionally
 *   FORCES `"runner"` whenever `attestation !== undefined` regardless of whatever
 *   the caller passed (an attested row is runner-captured by construction —
 *   SPEC-039's trusted-runner boundary already proves it) — a correctness
 *   override on a value the caller DID supply, not a fallback for one it omitted.
 *   Only a PRE-existing stored row (written before this invariant armed) can lack
 *   the field at all; such a row's ABSENT `capture_source` reads as `"self-report"`
 *   at any consumption site, never as "unknown, therefore fine"
 *   (adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the Q2).
 * @invariant addEvidence and recordVerifiedEvidence share ONE append implementation
 *   (private `appendEvidenceEntry`) — cap check, schema validation, ac_ref cross-entity
 *   validation, the §M5 oracle-generation stamp, and the writeTaskExtra commit path are
 *   never duplicated between them.
 * @invariant `ac_oracle_generation` is STAMPED by `appendEvidenceEntry`, never accepted
 *   from any caller (spec-the-defect-channel-cannot-be-honestly-maintained-an §M5,
 *   AC-DC-8) — the oracle generation in force for the row's `ac_ref` at record time,
 *   resolved from the referenced criterion (`resolveAcOracleGeneration`), so a later
 *   `verify.command` rewrite makes this row reportable as prior-generation
 *   (`computeAcCoverage`'s `oracle_generation` split) with NO row ever edited. Unlike
 *   `attestation` — which the trusted runner DOES supply and which only the public path
 *   rejects — this field is refused on BOTH paths (`EvidenceInput` and
 *   `VerifiedEvidenceInput` exclude it structurally; the shared chokepoint's
 *   `hasOwnProperty` check stops an `as`-cast candidate), and it is NEVER inferred from
 *   the command string or the tail's shape — the same rule `capture_source` follows.
 *   Present-iff-resolved: a row with no `ac_ref` carries no stamp, and a row whose
 *   `ac_ref` does not resolve is refused by the cross-entity check above, so no
 *   COMMITTED row is ever silently left unstamped. `VerifyRunnerService` needs no change
 *   of its own — its `recordVerifiedEvidence` port lands here, so every runner-attested
 *   row carries the stamp too.
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
 * @invariant `claim()` CAPTURES the session instance (`resolveClaimSessionId` over the
 *   injected `processEnv` → `extra.claim.session_id`) for EVERY caller — CLI, MCP, and
 *   HTTP alike, with no flag and no opt-in — and it is the ONLY method that does
 *   (task-two-concurrent-orchestrators-both-resolve-to-agent-main). The capture is
 *   independent of actor resolution and never merged into `by`: `resolveActor`'s session
 *   TIER is shadowed by an explicit name, which this project's own standing
 *   discipline gives every main-checkout run, so two concurrently-live
 *   orchestrators legitimately share one actor string. `by` therefore answers "who",
 *   `session_id` answers "which run", and `noAnchorOverlap` needs the second to be a
 *   cross-session mutex at all. Never sourced from `ClaimOpts` — a caller-declarable
 *   session id would be a forgeable proxy, the exact class of thing being retired.
 * @invariant `claim()` AUTO-CAPTURES `extra.claim.branch` from `opts.worktree`
 * (spec-multi-session-concurrency-queryable-ownership-checkout §Scope L0, AC-OWN-2)
 *   via the injected `detectBranch` port — ONLY when `opts.branch` is omitted; an
 *   explicit `--branch` always wins outright and skips detection. An unmeasurable
 *   branch (detached HEAD, non-repo/missing worktree path) leaves the field ABSENT,
 *   never a placeholder — "unmeasured" is never written as "unowned" (mirrors
 *   `compareClaimSessions`'s "not-measured ≠ known-absent" discipline). A CONFIRMED
 *   successful claim with both a worktree AND a measured `session_id` additionally
 *   binds that session for the AC-OWN-4 git-trailer mechanism via the injected
 *   `installClaimTrailerBinding` port — best-effort/advisory, never awaited into this
 *   method's own `Result`. Both ports default to `real-git-port.ts`'s real
 *   implementations (see the constructor's own JSDoc for why that file, an adapter,
 *   is imported directly here).
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
 *   contract. Refuses (VALIDATION_ERROR) with no RUNNER-ATTESTED passing
 *   (`result: "pass"` AND `attestation !== undefined`) evidence or a fresh foreign
 *   claim; an already-terminal task is an idempotent no-op, never an error — see
 *   `DoneResult`'s own JSDoc.
 * @invariant `done()`'s evidence floor requires ATTESTATION, not merely
 *   `result: "pass"` (adr-lore-done-requires-a-runner-attested-pass-the-sixth-false,
 *   the sixth false-oracle face — an unfiltered multi-file `lore evidence --result
 *   pass` records cleanly with no proof any file ran; `lore evidence` stays a
 *   self-report ledger BY DESIGN, so the fix closes the read side, at the ONE
 *   command that drives a task to its irreversible terminal state, not the write
 *   side). A self-reported-only pass (`attestation === undefined`, the shape every
 *   CLI/MCP `lore evidence` write produces — `recordVerifiedEvidence` is the SOLE
 *   `attestation` injection point, `VerifyRunnerService`-only) is refused with a
 *   message naming BOTH repairs: `lore verify <plan>` (attests it) and the escape
 *   hatch below. This floor is evaluated BEFORE the red-first and unfiltered-test-
 *   file-run floors below (so it can mask neither, per the existing "each floor
 *   independent" contract) but AFTER the already-terminal idempotent short-circuit
 *   (AC-4: idempotency must never regress retroactively against evidence authored
 *   before this floor armed).
 * @invariant `done()`'s audited escape hatch (`DoneOpts.overrideReason`) bypasses
 *   ONLY the attestation floor immediately above — never the red-first or
 *   unfiltered-test-file-run floors, which read `result`/`command` and are
 *   attestation-agnostic already. For verification `lore verify` structurally
 *   cannot perform (`--oracle manual` browser/visual checks; any oracle with no
 *   script-mode AC to bind to) — mirrors this repo's `lore approve
 *   --override-judgment`/`lore outline exempt --reason` shape: an explicit,
 *   mandatory free-text justification, written VERBATIM onto every lifecycle
 *   step's audit entry as `details.override_reason` (+ `details
 *   .attestation_overridden: true`) this call produces — never silent, never
 *   defaulted, no env-var form. A blank/whitespace-only reason is refused
 *   VALIDATION_ERROR here too (belt-and-suspenders — `commands/done.ts` already
 *   refuses it as a CLI usage error, exit 2, before this service is ever called;
 *   this second check protects any OTHER caller, e.g. a test or a future MCP tool,
 *   that constructs `DoneOpts` directly). `overrideReason` is silently IGNORED
 *   (never checked, never persisted) when an attested pass already satisfies the
 *   floor above — the escape hatch is for tasks that structurally cannot attest,
 *   not a blanket "always audit" switch.
 * @invariant `done()`'s red-first floor is OPT-IN ONLY (`extra.red_first: true`,
 *   set exclusively by `declareRedFirst`) — a task that never makes that call is
 *   entirely unaffected by IT, but is instead governed by the FOURTH, INDEPENDENT
 *   "no-new-tests" floor immediately below (task-a-non-empty-output-tail-can-be-
 *   hand-authored-prose-and-the): the red-first discipline inverted to opt-OUT.
 *   A task that has DECLARED `extra.ac_scope` at all — keyed on the declaration's
 *   PRESENCE, so an EXPLICITLY EMPTY `[]` arms it too (task-the-ac-scope-re-keying-
 *   left-the-red-first-floor-unarmed) — with zero `"expected-fail"`/`"fail"`
 *   evidence rows and NO `extra.red_first: true` declaration cannot archive without
 *   an explicit `DoneOpts.noNewTestsReason` (mandatory, non-blank, persisted
 *   verbatim onto every step's audit `details` as `no_new_tests_reason` +
 *   `no_new_tests_declared: true` — the SAME audited-escape shape as
 *   `overrideReason`). Mutually exclusive with the red-first floor by construction
 *   ({@link requiresNoNewTestsDeclaration} short-circuits `false` whenever
 *   `extra.red_first` is declared), so a task that DOES opt in keeps working
 *   BYTE-IDENTICALLY (AC6 control) — this floor never adds a SECOND requirement on
 *   top of that one.
 * @invariant `done()` also refuses over an UNMET unfiltered-test-file-run floor
 *   (task-every-ac-oracle-is-t-scoped-so-the-file-passes-is-attested) — a FIFTH,
 *   INDEPENDENT floor evaluated after the four above (so none can mask another). For EVERY declared test-file
 *   anchor (`extra.file_anchors`, filtered to {@link isTestFileAnchor} — a
 *   directory-scoped anchor names no single file and is unaffected), at least one
 *   `oracle:"test"` `result:"pass"` evidence row must run that exact file with no
 *   recognised case-name filter ({@link commandRunsFileUnfiltered}). A task
 *   declaring zero test-file anchors has nothing to attest and is a clean pass —
 *   mirrors the red-first floor's "never sets the flag → never reaches this check"
 *   shape. Rationale: a `-t`-scoped AC oracle attests only the ONE assertion it
 *   binds to, never that the file, taken as a whole, passes together (two tests
 *   sharing mutable fixture state can each pass individually under `-t` and fail
 *   when the file runs unfiltered — `knowledge-assessment-implementation-lore-ac-
 *   set-the-dangling-ac`'s finding).
 * @invariant `addEvidence` (self-reported `result: "pass"` only) and `release`
 *   (unconditionally) both refuse when the claim's recorded
 *   `extra.claim.worktree` has UNCOMMITTED tracked-file changes
 *   (task-lore-evidence-and-lore-release-accept-an-attestation-from) — a REAL
 *   `git status --porcelain` subprocess (`measureWorktreeCleanliness`,
 *   `checkUncommittedAttestationWorktree`), never an anchor-scoped proxy (see
 *   that section's own three-question review, immediately above the type
 *   `WorktreeCleanlinessStatus`, for why the narrower check was rejected).
 *   Absent preconditions (no recorded worktree; recorded path not a git
 *   working tree; `git` unavailable) are NEVER silently treated as clean —
 *   each is its own distinct `"not-measured-*"` status, and the call proceeds
 *   unaffected (no fabricated refusal). A claim recording NO worktree WHILE
 *   the calling CLI process is demonstrably inside a real git repository
 *   (`EvidenceInput.callerCwd`/`ReleaseOpts.callerCwd`, CLI-populated) is
 *   ALSO refused — the opt-in-hole close for `--worktree` being always
 *   explicit (SPEC-025/042).
 *
 * Side-effect class: IO (reads/writes via StoreInterface; emits telemetry;
 *   `addEvidence`'s `result:"pass"` path and `release` additionally shell a
 *   real `git status`/`git rev-parse` subprocess against the claim's
 *   recorded worktree / the caller's cwd — see the invariant immediately
 *   above).
 * Source: SPEC-025 §3 D2, D3, D5, D7, D8, D10; §4 AC-WF-1..11; §8.2, §8.3; SPEC-038 §4, §7 D4;
 *         SPEC-039 §2 D2, §4 AC-VRF-2; BUG-011 (anchor-overlap gate TOCTOU hardening);
 *         spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3, AC-WH-3;
 *         task-every-ac-oracle-is-t-scoped-so-the-file-passes-is-attested (the
 *         unfiltered-test-file-run floor); adr-lore-done-requires-a-runner-attested-
 *         pass-the-sixth-false / task-lore-done-accepts-an-unattested-self-reported-
 *         pass-as (the attested-pass floor + its audited escape hatch);
 *         task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the (`capture_source`,
 *         the PASS-tail requirement, and the no-new-tests opt-out floor) /
 *         adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the (proxy/
 *         silence/opt-in review this fix answers)
 */

import { spawnSync } from "node:child_process";
import { z } from "zod";
import { err, ok, hasClaimConflict, type ClaimHolder, type ClaimParty, type RunId, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import type { ActorSource } from "@lore/core/node";
import {
  evidenceEntrySchema,
  taskClaimSchema,
  isClaimStale,
  isClaimStaleForRun,
  isValidTransition,
  evaluateReadiness,
  buildTaskClaim,
  renewClaimForEvidence,
  deriveSessions,
  sessionIdDiscriminator,
  normalizeFileAnchors,
  extractFileAnchors,
  anchorsOverlap,
  computeAcScopeEdit,
  extractDeclaredAcScope,
  isTestFileAnchor,
  commandRunsFileUnfiltered,
  UNFILTERED_RUN_CASE_FILTER_DESCRIPTION,
  isInvalidated,
  unprobedFileAnchors,
  resolveOracleGeneration,
  resolveWrittenCaptureSource,
  rejectSelfLabelledRunnerUnattested,
  type PublicCaptureSource,
  type AcceptanceCriterion,
  type AcScopeEditOp,
  type ClaimRunLiveness,
  type EvidenceEntry,
  type TaskClaim,
  type ReadyRecord,
  type BlockerInfo,
  type ReadySession,
  type CaptureSource,
  type FileAnchorResolutionReport,
  type NonResolvingFileAnchor,
} from "@lore/core";
import type { DocId, DocRecord, DocStatus } from "@lore/core";
import { NoOpTelemetry, type Telemetry, type TelemetryEvent, type TaskWorkflowEventName } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";
// invariant: every plan-scoped task query in this file goes through the SHARED
//   `isPlanMember` predicate, never a bare `t.parent_id === planId` —
//   `extra.plan_id` is the DECLARED property, `parent_id` only a proxy a task's
//   `--parent` may deliberately diverge from (SPEC-065 D4;
//   task-plan-membership-is-extra-plan-id-but-the-last-task). This file used to
//   carry its own private byte-identical copy; that copy's retirement rationale
//   lives in `plan-membership.ts`'s SSOT note — do not reintroduce one
//   (task-three-byte-identical-copies-of-isplanmember-survive).
import { isPlanMember } from "./plan-membership.js";
import type { ArchiveIssueClosePort, IssueCloseItem } from "./issue-close-on-archive.js";
import {
  applyWorktreeRemoval,
  buildActiveClaimedPathSet,
  collectRecordedWorktrees,
  createRealWorktreeProbe,
  evaluateRecordedWorktree,
  resolveClaimHead,
  type RecordedWorktree,
  type WorktreeGitProbe,
  type WorktreeOutcome,
} from "./worktree-cleanup.js";
import type { WorktreeRemovalFactsPort } from "./worktree-removal-test.js";
import type { TaskCommitRange } from "./task-commit-range.js";
import { buildUpstreamSpecContext, buildAnchorGateContext, isNonPlanParentError } from "./checkpoint-registry.js";
import { compareClaimSessions, type SessionComparison, type SiblingClaimInfo } from "./gate-predicates.js";
import { collectFileAnchorResolution, type FileAnchorProbeContext } from "./anchor-resolution.js";
import type { GateDependencies } from "./gate-enforcer.js";
// reason: spec-multi-session-concurrency-queryable-ownership-checkout §Scope
// L0 (AC-OWN-2/AC-OWN-4) — the ONE deliberate exception to "services don't
// import adapters": branch detection / trailer binding are leaf IO
// capabilities with no OTHER service dependency, so there is no app.ts
// composition-root wiring to route the REAL implementation through (unlike
// `resolveDeclaredAcIds` et al., whose real implementations need
// CorpusService). See real-git-port.ts's own module doc for the full
// rationale and its precedent (`measureWorktreeCleanliness`'s pre-existing
// ad hoc `git` subprocess calls, already inline in THIS file below).
import {
  detectWorktreeBranch,
  bindClaimSessionForTrailer,
  unbindClaimSessionForTrailer,
  type BranchMeasurement,
} from "../adapters/real-git-port.js";

// ─── Public Types ──────────────────────────────────────────────────────────

/** Options for {@link TaskWorkflowService.claim}. */
export interface ClaimOpts {
  /** Resolved actor identity (CLI: the invoking identity from `resolveActor`). */
  by: string;
  /**
   * The harness run the invoking agent integration vouched for (spec-run-identity-slice-1 D6, BR-1040),
   * passed EXPLICITLY by the adapter — this service decides on identity, so it never reads ambient state.
   * `null`/absent = unattested claimant (an adapter that does not thread a run yet claims unattested).
   */
  harnessRun?: RunId | null;
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
   * Claim-scoped corpus authoring (spec-baseline-slice-2 §C8, AC-BLS2-8, issue #39) — the
   * baseline BRANCH (id or slug) this worktree session may write rules/cites/site maps under
   * in the main checkout's corpus. Persisted as `extra.claim.corpus_scope` (canonical slug);
   * `ForeignCorpusWriteGuard` reads it back from the lease. Requires `worktree` (a scope with no
   * worktree has no session to bind to) and must resolve to a baseline `branch` node. Explicit
   * per call — never carried forward on a refresh.
   */
  corpusScope?: string;
  /**
   * How `by` was resolved (spec claim-time-actor-identity-guard-zero-evidence-
   * release-advis, AC-IDENTITY-REJECT) — CLI: `resolveActorWithIdentitySource`'s
   * SPEC-071 session tier > worktree tier > OS-username-fallback
   * chain (`ActorSource`, `@lore/core/node`); MCP: `actorSourceOfName` of the
   * call's name source (`adapters/mcp/call-scope.ts`). `undefined` (a caller
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

/** One claim handled by {@link TaskWorkflowService.endRunClaims}. `worktree` is the measured path, or `not-measured`. */
export interface RunEndClaimOutcome {
  readonly task_slug: string;
  readonly action: "released" | "orphaned_dirty";
  readonly worktree: string;
}

/** Options for {@link TaskWorkflowService.release}. */
export interface ReleaseOpts {
  /** Resolved actor identity. */
  by: string;
  /** See {@link ClaimOpts.harnessRun} — decides who may release without `force` (BR-1043) and is recorded in history. */
  harnessRun?: RunId | null;
  /** Optional free-text reason (e.g. a failure summary), recorded in version history. */
  reason?: string;
  /** Release even when `by` is not the current holder. */
  force?: boolean;
  /** See {@link ClaimOpts.source}. */
  source?: string;
  /**
   * The CALLING process's own `process.cwd()` (task-lore-evidence-and-lore-
   * release-accept-an-attestation-from, opt-in review Q3) — `commands/
   * release.ts` is the sole production populator (a fresh CLI subprocess per
   * invocation inherits the caller's real shell cwd, mirroring `commands/
   * evidence.ts`'s identical `process.cwd()` precheck use). Used ONLY to
   * detect the Q3 opt-in-hole mismatch: a claim recording NO `worktree` while
   * THIS call plainly runs from inside a real git repository. Omitted (every
   * pre-existing direct-service caller, incl. every unit test in this
   * codebase) simply skips that ONE mismatch check — the primary whole-
   * worktree cleanliness predicate below is COMPLETELY UNAFFECTED by this
   * field's presence or absence, since it keys off the claim's OWN recorded
   * `worktree`, never this one. Not read from `process.cwd()` internally by
   * this service (mirrors `SeatService`'s explicit-`mainCwd`-over-ambient-read
   * convention) so the mismatch path stays trivially unit-testable without
   * mutating the real process's working directory.
   */
  callerCwd?: string;
}

/** Options for {@link TaskWorkflowService.done} / {@link PhaseWorkflowService.done}. */
export interface DoneOpts {
  /**
   * The run the caller explicitly carries (null/absent = unattested). Compared with a fresh claim's
   * `harness_run` to decide whether the caller is the holder (BR-1056); see {@link ClaimOpts.harnessRun}.
   */
  harnessRun?: RunId | null;
  /**
   * Resolved actor identity — recorded on EVERY lifecycle step's version history
   * entry and audit row this call produces, and checked against a fresh claim's
   * `by` (a fresh claim held by a DIFFERENT actor refuses the whole call).
   */
  by: string;
  /** See {@link ClaimOpts.source}. */
  source?: string;
  /**
   * Audited escape hatch for the attested-pass floor (adr-lore-done-requires-a-
   * runner-attested-pass-the-sixth-false) — a mandatory free-text justification
   * for archiving WITHOUT a runner-attested `result: "pass"` evidence row, for
   * verification `lore verify` structurally cannot perform (`--oracle manual`
   * browser/visual checks; any oracle with no script-mode AC to bind to).
   * Written VERBATIM to every lifecycle step's audit entry as
   * `details.override_reason` (+ `details.attestation_overridden: true`) — never
   * silent, never defaulted, no env-var form (mirrors `lore approve
   * --override-judgment`/`lore outline exempt --reason`'s audited-escape shape).
   * `commands/done.ts` refuses a blank/whitespace-only value as a CLI usage
   * error (exit 2) before this service is ever called; `done()` refuses it too
   * (VALIDATION_ERROR) as a belt-and-suspenders check for any OTHER caller that
   * constructs `DoneOpts` directly (see `done()`'s own JSDoc). IGNORED entirely
   * when an attested pass already satisfies the floor — this does not relax the
   * independent red-first / unfiltered-test-file-run floors below it.
   */
  overrideReason?: string;
  /**
   * Audited escape hatch for the NO-NEW-TESTS floor (task-a-non-empty-output-
   * tail-can-be-hand-authored-prose-and-the) — the red-first discipline INVERTED
   * to opt-OUT: a task that has DECLARED `extra.ac_scope` at all (an EXPLICITLY
   * EMPTY `[]` included — task-the-ac-scope-re-keying-left-the-red-first-floor-
   * unarmed) with ZERO
   * `"fail"`/`"expected-fail"` evidence rows and no `extra.red_first: true`
   * declaration (that path is the PRE-EXISTING, unaffected opt-in floor, see
   * {@link overrideReason}'s sibling check in `done()`'s JSDoc) cannot archive
   * without this mandatory, non-blank, free-text justification for why no new
   * RED test was recorded (CLI: `--declare-no-new-tests "<reason>"` — deliberately
   * NOT `--no-new-tests`, which citty's mri parser would parse as a boolean
   * negation and silently discard the value) — same audited shape as
   * `overrideReason` above (`lore approve --override-judgment`/`lore outline
   * exempt --reason`): written
   * VERBATIM to every lifecycle step's audit entry as `details.no_new_tests_reason`
   * (+ `details.no_new_tests_declared: true`), never silent, never defaulted, no
   * env-var form. `commands/done.ts` refuses a blank/whitespace-only value as a
   * CLI usage error (exit 2); `done()` refuses it too as a belt-and-suspenders
   * check. IGNORED entirely when this floor does not apply (no `ac_scope` KEY at
   * all, red_first already declared, or a red evidence row already exists) — never a
   * blanket "always audit" switch, mirroring {@link overrideReason}'s own
   * ignored-when-unneeded contract.
   */
  noNewTestsReason?: string;
  /**
   * The caller's harness session id (`CLAUDE_CODE_SESSION_ID` / `CLAUDE_SESSION_ID`, resolved by the CLI) — the
   * "mine" side of the worktree-removal test's owned-or-abandoned clause (spec-one-worktree-removal-test-for-the-
   * guard-lore-done-and-a D2). Absent = unknown: never the owner of anything.
   */
  callerSession?: string;
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
/**
 * A distinct, explicit VALUE {@link TaskWorkflowService}'s internal
 * `computePlanNowFullyTerminal` returns when the plan's `extra.plan_id`-based
 * (property) member set is EMPTY while the retired `parent_id`-based (proxy)
 * member set is NON-EMPTY — a contradiction, never conflated with "no members,
 * nothing to report" (ADR proxy/silence/opt-in review Q2,
 * task-plan-membership-is-extra-plan-id-but-the-last-task). Reported so a
 * caller can tell "this plan genuinely has zero real members" apart from
 * "something is filed here that does not consider itself a member" — NEVER
 * resolved by unioning the two sets, which would re-admit the exact
 * misattribution this fix removes.
 */
export interface PlanMembershipDisagreement {
  plan_slug: string;
  /**
   * Count of tasks whose `parent_id` points at this plan while their OWN
   * `extra.plan_id` does not — i.e. every doc the retired proxy-only query
   * would have (mis)counted as a member.
   */
  parent_id_only_count: number;
}

/**
 * {@link TaskWorkflowService.computePlanNowFullyTerminal}'s return facts — a
 * discriminated union (never two structurally-similar `{plan_slug}` shapes
 * distinguished only by which optional field is present) so "the advisory
 * fires" and "the two membership sources disagree" can never be confused with
 * each other while being threaded through to {@link DoneResult}.
 */
type PlanTerminalityFact =
  | { kind: "fully_terminal"; plan_slug: string }
  | ({ kind: "membership_disagreement" } & PlanMembershipDisagreement);

/** The `lore done` floors, by stable id (order = evaluation order). */
export type DoneFloorId = "attested-pass" | "red-first" | "no-new-tests" | "unfiltered-test-file";

/** One floor's refusal: the id plus the exact LoreError `done()` returns (`details.floor` set). */
export interface DoneFloorRefusal {
  floor: DoneFloorId;
  error: LoreError;
}

/** Builds a floor refusal, stamping `details.floor` so callers never parse the message. */
function doneFloorRefusal(
  floor: DoneFloorId,
  error: Extract<LoreError, { code: "VALIDATION_ERROR" }>,
): Result<{ refusal: DoneFloorRefusal }, never> {
  return ok({ refusal: { floor, error: { ...error, details: { floor } } } });
}

export interface DoneResult {
  task: DocRecord;
  already_done: boolean;
  transitions: DocStatus[];
  /**
   * Present ONLY when this call performed a real archive walk (never on the
   * `already_done: true` idempotent no-op branch) AND that walk made the
   * task's parent PLAN's every REAL child task (membership per `extra.plan_id`
   * — task-plan-membership-is-extra-plan-id-but-the-last-task) terminal
   * (`archived`/`deprecated`) while the plan itself is still non-terminal
   * (spec-plan-closure-must-be-loud-terminality-divergence-silent DD-2,
   * AC-CLOSURE-3). A pure FACT — no plan document is read-modify-written to
   * produce it, and `done()` never writes the plan (Invariant 1: `done`
   * announces, it never closes; the `plan-close` gate remains the sole path to
   * actually archiving the plan). `undefined` for: a non-last task, an
   * adhoc/planless task (no `plan`-typed parent), a plan that is already
   * terminal, or a `plan_membership_disagreement` (below) — mutually exclusive
   * with that field, since a disagreement means the property-based member set
   * is empty and "fully terminal" cannot also be true.
   */
  plan_now_fully_terminal?: { plan_slug: string };
  /**
   * Present ONLY when `computePlanNowFullyTerminal` detected the membership-
   * source disagreement described on {@link PlanMembershipDisagreement} for the
   * archived task's parent plan. See that type's JSDoc and ADR review Q2,
   * task-plan-membership-is-extra-plan-id-but-the-last-task.
   */
  plan_membership_disagreement?: PlanMembershipDisagreement;
  /**
   * Issue #106 / BR-961 — one outcome per worktree this task's claims recorded, from the cleanup
   * pass that runs AFTER a real archive walk (absent on the idempotent no-op branch). Never an
   * error: a kept / not-measured worktree is reported here and `done` still succeeds.
   */
  worktree_outcomes?: WorktreeOutcome[];
  /**
   * The post-archive GitHub issue step's lines (spec-archiving-the-work-that-resolves-a-defect-report-
   * closes D4) — present only after a real archive walk with the archive port wired; possibly empty.
   */
  issue_close?: IssueCloseItem[];
}

/**
 * Evidence input for {@link TaskWorkflowService.addEvidence} — recorded_at is set by the
 * service. `attestation` is structurally EXCLUDED (SPEC-039 §2 D2, §4 AC-VRF-2) — it is
 * runner-issued only, via {@link TaskWorkflowService.recordVerifiedEvidence} or (for a
 * row this process itself spawned and measured) the `capture_attestation` channel
 * documented on that field below. addEvidence
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
 *
 * `capture_source` (task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the)
 * is REQUIRED here (task-capture-source-is-optional-at-the-evidence-write-boundary) —
 * `Omit<…, "capture_source"> & { capture_source: CaptureSource }`, not inherited
 * `.optional()` from the base schema. Omission is now a compile error: the ONLY
 * way this field is silently missing is data written before this invariant armed
 * (read tolerance, `evidenceEntrySchema.capture_source` itself stays `.optional()`
 * — see that field's own JSDoc). Both production adapters (`commands/evidence.ts`,
 * `adapters/mcp/tools.ts`) already derive and pass a real value on every write —
 * the fix that used to defer this to "follow-up work" (a nullish-coalescing
 * self-report default in `appendEvidenceEntry`) is exactly the mechanism this
 * task removes: a required-for-correctness field defaulted to its own SAFE
 * value looks harmless and is exactly why it survived.
 */
export type EvidenceInput = Omit<
  EvidenceEntry,
  "recorded_at" | "attestation" | "result" | "capture_source" | "ac_oracle_generation"
> & {
  result: Exclude<EvidenceEntry["result"], "inconclusive">;
  /**
   * REQUIRED — see this type's own header comment. The value the caller can actually PROVE, never a convenient default.
   * `"runner-unattested"` is excluded: only the trusted runner mints it (via {@link VerifiedEvidenceInput}).
   */
  capture_source: PublicCaptureSource;
  /**
   * The attestation MEASURED by this process's own capture spawn (SPEC-143 AC-CT-2) —
   * distinct from the excluded `attestation` key, and refused-by-construction rather
   * than by trust: its only producer is
   * `adapters/evidence-capture.ts::captureOracleCommand`, which hands it back
   * INSEPARABLE from the `"runner"` label in one `CapturedProvenance` object that both
   * adapters splat whole. {@link promoteCapturedAttestation} moves it into the
   * `attestation` slot at the single point where either `_addEvidenceImpl` hands off to
   * its shared append.
   *
   * OPTIONAL, and its absence is meaningful rather than lenient: a self-reported row has
   * nothing to put here (no spawn happened), and a `"runner"`-labelled row written
   * BEFORE this channel existed cannot retroactively grow one. The false trust label
   * AC-CT-2 refuses is therefore still REPRESENTABLE in stored data on purpose — the
   * `lore done` refusal wording and the `capture_source` distributions exist precisely to
   * report on those legacy rows, and a hard refusal here would make them unconstructible
   * (measured: `tests/unit/service/done-attestation-refusal-wording.test.ts`'s
   * `unattestedRunnerPass` fixture is exactly that shape, deliberately). What this change
   * guarantees is narrower and checkable: no PRODUCTION CAPTURE PATH can mint one.
   */
  capture_attestation?: EvidenceEntry["attestation"];
  /** See {@link ClaimOpts.source}. */
  source?: string;
  /** See {@link ReleaseOpts.callerCwd} — same field, same Q3 mismatch use, `commands/evidence.ts` is this one's populator. Never persisted onto the written evidence entry (consumed pre-write only, see `_addEvidenceImpl`). */
  callerCwd?: string;
};

/**
 * Evidence input for {@link TaskWorkflowService.recordVerifiedEvidence} — the ONLY shape
 * that may carry `attestation` (SPEC-039 §2 D2). Never exported to any CLI/MCP surface;
 * `VerifyRunnerService.verifyPlan` is the sole production caller. `capture_source` is
 * REQUIRED here too (task-capture-source-is-optional-at-the-evidence-write-boundary) —
 * mirrors {@link EvidenceInput}'s own requiredness so `appendEvidenceEntry`'s shared
 * chokepoint never needs a fallback for either incoming shape. `VerifyRunnerService`
 * always spawns its own commands, so it passes `"runner"` — the value it can prove —
 * even though `appendEvidenceEntry` would additionally force `"runner"` from
 * `attestation` alone; the explicit pass documents the caller's own provenance claim
 * rather than relying on that downstream override.
 *
 * `ac_oracle_generation` is EXCLUDED here too (§M5, AC-DC-8) — unlike `attestation`,
 * which the trusted runner DOES supply, the generation is resolved by
 * `appendEvidenceEntry` from the referenced criterion for BOTH write paths, so neither
 * a CLI caller nor the runner may declare it. See that method's own resolution step.
 */
export type VerifiedEvidenceInput = Omit<
  EvidenceEntry,
  "recorded_at" | "capture_source" | "ac_oracle_generation"
> & {
  capture_source: CaptureSource;
};

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
  /**
   * Present ONLY when `holder` equals the conflicting task's OWN claim holder —
   * i.e. the two claims share an actor string and the conflict rests on the
   * SESSION dimension (task-two-concurrent-orchestrators-both-resolve-to-agent-main).
   * `"different-session"` = two measured, provably different sessions;
   * `"not-measured"` = at least one side recorded no session id, so this advisory
   * reports an overlap it could NOT clear rather than staying silent (the gate
   * refuses the same claim). ABSENT for an ordinary foreign-actor conflict, so
   * every pre-existing consumer sees a byte-identical entry.
   */
  session_verdict?: SessionComparison;
}

/**
 * One non-resolving declared anchor in {@link ReadyReport.anchor_resolution},
 * qualified by the task that declared it (task-a-mistyped-task-file-anchor-is-
 * stored-and-consulted, Required #2). The write-time advisory is seen by the
 * anchor's AUTHOR; this is what the DISPATCHER assigning concurrent work reads,
 * which is the half that addresses the actual failure mode.
 */
export interface TaskAnchorNonResolution extends NonResolvingFileAnchor {
  task_slug: string;
}

/**
 * `ready()`'s anchor-resolution report — a DISCRIMINATED UNION, never a bare
 * array, so `{probed: false}` (no filesystem port was supplied: MCP `lore_ready`,
 * HTTP `/ready`) can never be read as `{probed: true, unresolved: []}` (probed,
 * everything resolves). Keeping those two apart is the point: before this field,
 * "the gate found no conflict" was indistinguishable from "the gate could not
 * have found one".
 */
export type ReadyAnchorResolution = FileAnchorResolutionReport<TaskAnchorNonResolution>;

/** See {@link ReadyReport.counts}. */
export interface ReadyCounts {
  /** Rows with `ready === true`. */
  ready: number;
  /** Non-archived rows holding a claim (fresh or stale — see each record's `claim.stale`). */
  claimed: number;
  /** Rows whose task status is `archived`. */
  archived: number;
  /** `records.length`. */
  total: number;
}

/** Single derivation of {@link ReadyCounts}; shared by the task and phase `ready` paths. */
export function computeReadyCounts(records: readonly ReadyRecord[]): ReadyCounts {
  let ready = 0;
  let claimed = 0;
  let archived = 0;
  for (const r of records) {
    if (r.ready) ready += 1;
    if (r.task.status === "archived") archived += 1;
    else if (r.claim !== undefined) claimed += 1;
  }
  return { ready, claimed, archived, total: records.length };
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
  /**
   * Counts over `records`, so no consumer has to re-derive them (gh-177: `.records` also
   * carries archived rows, so `records.length` is NOT the ready count). `total` ===
   * `records.length`. `ready`/`claimed`/`archived` are NOT a partition: a ready task may
   * also be claimed, so their sum can exceed `total`.
   */
  counts: ReadyCounts;
  sessions: ReadySession[];
  anchor_conflicts: AnchorConflict[];
  /**
   * Every declared anchor across this plan's tasks that does NOT resolve on the
   * working tree — or an explicit "not probed" value when the caller supplied no
   * filesystem port. REQUIRED (never an absent key): an omitted field would
   * reintroduce exactly the silence this reports.
   */
  anchor_resolution: ReadyAnchorResolution;
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

/**
 * The stored lease as a {@link ClaimHolder} for core's `hasClaimConflict` (D6). `legacy` = the RAW stored claim
 * has no `harness_run` KEY at all (written before runs existed, BR-1042) — read from the raw value because
 * the parsed claim cannot tell an absent key from `null` (unattested).
 *
 * @param stale - Staleness the caller wants judged: claim paths pass the real staleness; release passes `false`
 *   (a stale holder still releases by its own identity — staleness only unlocks TAKEOVER by a claim).
 */
export function buildClaimHolder(doc: DocRecord, claim: TaskClaim, stale: boolean): ClaimHolder {
  const raw = doc.extra["claim"] as Record<string, unknown>;
  const legacy = !Object.hasOwn(raw, "harness_run");
  return { by: claim.by, harnessRun: (claim.harness_run ?? null) as RunId | null, legacy, stale };
}

/** The acting party of a claim/release: its name and the run it explicitly carries (null = unattested). */
export function buildClaimParty(opts: { by: string; harnessRun?: RunId | null }): ClaimParty {
  return { by: opts.by, harnessRun: opts.harnessRun ?? null };
}

/**
 * Replaces each record's `claim.stale` with the effective staleness resolved for its task (run end /
 * `orphaned_dirty`, BR-1058); a record whose task has no entry keeps core's TTL-only value.
 */
function applyEffectiveClaimStaleness(
  records: ReadyRecord[],
  staleByTask: ReadonlyMap<DocId, boolean>,
): ReadyRecord[] {
  return records.map((record) => {
    const stale = staleByTask.get(record.task.id);
    return record.claim !== undefined && stale !== undefined
      ? { ...record, claim: { ...record.claim, stale } }
      : record;
  });
}

/** `CLAIM_CONFLICT` naming the holder, the holding run (absent for a legacy claim) and the claim's age (BR-1040/BR-1043). */
export function buildClaimConflictError(
  docId: string,
  claim: TaskClaim,
  holder: ClaimHolder,
  nowIso: string,
): LoreError {
  return {
    code: "CLAIM_CONFLICT",
    id: docId,
    holder: claim.by,
    age_minutes: ageMinutesBetween(nowIso, claim.at),
    ...(holder.legacy ? {} : { holder_run: holder.harnessRun }),
  };
}

/**
 * The claim's effective staleness: TTL age, the holder run's end, and an `orphaned_dirty` mark
 * (BR-1058), via core's pure {@link isClaimStaleForRun}. The git and run lookups happen only when the
 * claim could be affected by them (an `orphaned_dirty` mark, or a holder run that has ended).
 *
 * Exported so the phase service and the claim gate judge staleness with the SAME function the task
 * service uses (ADR decision 5: tasks and phases must agree).
 *
 * @param store - run-end lookup source (`getRunEnd`).
 * @param ttlMinutes - claim TTL, the crash/kill fallback.
 * @param endedRuns - per-call memo of `run id -> ended`, so one `ready()` looks each run up once.
 * @returns ok(stale); err when the run lookup fails (never a silent "not stale").
 */
export async function resolveEffectiveClaimStaleness(
  store: StoreInterface,
  claim: TaskClaim,
  nowIso: string,
  ttlMinutes: number,
  endedRuns: Map<string, boolean>,
): Promise<Result<boolean, LoreError>> {
  let runEnded = false;
  const run = claim.harness_run ?? null;
  if (run !== null) {
    let known = endedRuns.get(run);
    if (known === undefined) {
      const endState = await store.getRunEnd(run as RunId);
      if (!endState.ok) return endState;
      known = endState.value !== null && endState.value.endedAt !== null;
      endedRuns.set(run, known);
    }
    runEnded = known;
  }
  if (claim.orphaned_dirty === undefined && !runEnded) {
    return ok(isClaimStale(claim, nowIso, ttlMinutes));
  }
  const cleanliness = measureWorktreeCleanliness(claim.orphaned_dirty?.worktree ?? claim.worktree);
  const liveness: ClaimRunLiveness = {
    runEnded,
    // reason: only a MEASURED clean worktree counts as clean — not-measured is `null`, never `true` (BR-1057).
    worktreeClean:
      cleanliness.status === "measured-clean" ? true : cleanliness.status === "measured-dirty" ? false : null,
  };
  return ok(isClaimStaleForRun(claim, nowIso, ttlMinutes, liveness));
}

/**
 * Effective staleness of every claimed doc in `docs`, keyed by doc id (see {@link resolveEffectiveClaimStaleness}).
 */
export async function resolveEffectiveStalenessByDoc(
  store: StoreInterface,
  docs: readonly DocRecord[],
  nowIso: string,
  ttlMinutes: number,
): Promise<Result<Map<DocId, boolean>, LoreError>> {
  const staleByDoc = new Map<DocId, boolean>();
  const endedRuns = new Map<string, boolean>();
  for (const doc of docs) {
    const claim = readClaim(doc);
    if (claim === undefined) continue;
    const stale = await resolveEffectiveClaimStaleness(store, claim, nowIso, ttlMinutes, endedRuns);
    if (!stale.ok) return stale;
    staleByDoc.set(doc.id, stale.value);
  }
  return ok(staleByDoc);
}

/**
 * Replaces each `siblingClaims[].stale` the registry builder computed from TTL alone with the run-aware
 * effective staleness (BR-1058): an `orphaned_dirty` claim never ages out, a clean ended-run claim does not
 * block. Done in the SERVICE layer so `checkpoint-registry.ts` stays untouched; siblings are matched by slug.
 * Shared by the task and phase claim gates so both agree.
 */
export async function applyEffectiveSiblingStaleness<C extends { siblingClaims?: SiblingClaimInfo[] }>(
  store: StoreInterface,
  anchorCtx: C,
  siblings: readonly DocRecord[],
  nowIso: string,
  ttlMinutes: number,
): Promise<Result<C, LoreError>> {
  const staleByDoc = await resolveEffectiveStalenessByDoc(store, siblings, nowIso, ttlMinutes);
  if (!staleByDoc.ok) return staleByDoc;
  const staleBySlug = new Map<string, boolean>();
  for (const sibling of siblings) {
    const stale = staleByDoc.value.get(sibling.id);
    if (stale !== undefined) staleBySlug.set(sibling.slug, stale);
  }
  return ok({
    ...anchorCtx,
    siblingClaims: (anchorCtx.siblingClaims ?? []).map((claim) => ({
      ...claim,
      stale: staleBySlug.get(claim.slug) ?? claim.stale,
    })),
  });
}

/** History wording for the run on a claim/release: the run id, or `unattested`. */
export function describeClaimRun(run: string | null | undefined): string {
  return run ?? "unattested";
}

/**
 * Whether `task` has ANY recorded claim at all (`extra.claim` is a non-null
 * value), independent of whether that claim parses as a valid {@link
 * TaskClaim} or records a `worktree` — task-the-uncommitted-worktree-guard-
 * treats-no-claim-at-all-as-a. This is the RAW presence check
 * `checkUncommittedAttestationWorktree` needs to tell "no claim was ever
 * taken" apart from "a claim exists but never recorded `--worktree`": both
 * states collapse to `readClaim(task)?.worktree === undefined`, which is
 * exactly the proxy collapse that shipped the defect (a task with NO claim
 * at all was treated as if it were "a claim that declined to declare a
 * worktree", firing the Q3 opt-in-hole mismatch refusal on every unclaimed
 * task called from inside a git repo — the orchestrator's routine post-merge
 * re-verification path). Deliberately checks the RAW `extra.claim` field,
 * not `readClaim(task) !== undefined` — a malformed claim object still means
 * "a claim was recorded" for this narrow purpose (there IS something in
 * `extra.claim`, even if it fails schema validation), so this predicate must
 * not itself re-collapse malformed-claim into no-claim.
 *
 * @param task - The already-resolved task DocRecord.
 * @returns `true` iff `task.extra.claim` is present and non-null.
 * @example
 * hasRecordedClaim({ extra: {} } as DocRecord); // => false
 * @example
 * hasRecordedClaim({ extra: { claim: { by: "alice", at: "…" } } } as DocRecord); // => true
 */
function hasRecordedClaim(task: DocRecord): boolean {
  const raw = task.extra["claim"];
  return raw !== undefined && raw !== null;
}

/** Reads and validates task.extra.verification_evidence. Returns [] when absent or malformed. */
function readEvidence(task: DocRecord): EvidenceEntry[] {
  const raw = task.extra["verification_evidence"];
  if (!Array.isArray(raw)) return [];
  const parsed = z.array(evidenceEntrySchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * Reads task.extra.red_first (task-red-first-discipline-is-asked-for-in-
 * prose-but-never). Mirrors `readClaim`/`readEvidence`'s "malformed → safe
 * default" contract — anything other than the literal boolean `true`
 * (absent, `false`, or a corrupted non-boolean value from a legacy row)
 * reads as "not declared", never a thrown error.
 */
function readRedFirstDeclared(task: DocRecord): boolean {
  return task.extra["red_first"] === true;
}

/** The two evidence `result` values that count as proof a RED run happened (SPEC red-first). */
function isRedRunResult(result: EvidenceEntry["result"]): boolean {
  return result === "expected-fail" || result === "fail";
}

/**
 * Classifies one stored row against the CAPTURE axis — the axis
 * {@link buildAttestationFloorRefusal} must describe truthfully, and the axis a
 * reader of the old refusal was wrongly sent to inspect.
 *
 * An ABSENT `capture_source` (only reachable on a row written before that field
 * became required — see the module @invariant) reads as `"self-report"`, NEVER as
 * "unknown, therefore runner-captured": the weaker class is the safe reading, and
 * the refusal must not credit a legacy row with a provenance nobody recorded.
 */
function isRunnerCaptured(entry: EvidenceEntry): boolean {
  return entry.capture_source === "runner";
}

/**
 * The two repairs `done()`'s attestation floor accepts, with each one's OWN
 * reachability precondition stated.
 *
 * ⛔ Shared by BOTH arms of {@link buildAttestationFloorRefusal} on purpose (SSOT):
 * the two arms previously duplicated this sentence, and a duplicated remedy is how
 * one arm silently keeps prescribing a route the other arm has learned is wrong.
 *
 * Repair (1) is stated WITH its precondition rather than unconditionally
 * (task-lore-done-s-attestation-refusal-calls-a-capture-source, Defect B measured
 * 2026-08-06): `lore verify <plan>` needs a plan, and the `--adhoc` branch
 * (`lore verify --task`) needs a NON-EMPTY `extra.ac_scope` to resolve a governing
 * spec from (`VerifyRunnerService`'s own two pre-flight refusals). For the task
 * class that hits this floor most often — an `--adhoc` task created with
 * `--ac-scope ""` — NEITHER is reachable, so repair (2) is its only route, and a
 * message that named only repair (1) sent that reader down a path that exits 4.
 * ⛔ Naming the limitation is WORDING; CLOSING it is not this text's job and is
 * tracked separately (task-an-ad-hoc-task-can-never-reach-the-attestation-path-that)
 * — do NOT "fix" that gap by weakening this floor.
 */
const ATTESTATION_FLOOR_REPAIRS =
  "Two repairs: (1) `lore verify <plan>` — the SOLE issuer of `attestation` — runs the " +
  "plan's declared script-mode acceptance criteria itself and attests the pass; for an " +
  "`--adhoc` task (no plan) the equivalent is `lore verify --task <task>`, which needs a " +
  "NON-EMPTY `extra.ac_scope` to resolve a governing spec from, so a task declaring an " +
  'EMPTY `ac_scope` can reach neither. (2) `lore done --override-attestation "<reason>"`, ' +
  "the audited escape hatch for verification `lore verify` structurally CANNOT perform " +
  "(a manual/browser oracle, or any task with no script-mode AC to bind to) — for the " +
  "EMPTY-`ac_scope` case above it is the only available route.";

/**
 * `done()`'s attestation-floor refusal message — the FIRST floor's text, for a task
 * holding no row that is BOTH `result: "pass"` AND `attestation !== undefined`
 * (adr-lore-done-requires-a-runner-attested-pass-the-sixth-false).
 *
 * ⛔ WORDING ONLY. This function decides NOTHING about whether a call is refused —
 * its caller already made that decision from the same predicate as before. Two
 * orthogonal axes exist and the message's ONE job is to keep them apart:
 *
 * | axis       | field            | what it proves                                        |
 * |------------|------------------|-------------------------------------------------------|
 * | capture    | `capture_source` | lore SPAWNED this command and cross-checked its exit  |
 * |            |                  | code against the declared result (`--capture`)         |
 * | provenance | `attestation`    | the COMMAND itself was runner-derived and approved    |
 * |            |                  | (SPEC-039's trusted-runner boundary; `lore verify`)    |
 *
 * The predecessor text called EVERY unattested row "SELF-REPORTED". Measured
 * 2026-08-03 and 10 further times since: the reader held rows whose stored
 * `capture_source` was `"runner"`, so the message named a value the rows did not
 * carry, and two full investigation rounds went into `capture_source` and
 * `dist/lore`'s mtime before the reader found the predicate reads a DIFFERENT
 * field. A confident wrong pointer is worse than a silence — it TERMINATES the
 * investigation instead of inviting one.
 *
 * Therefore the population is COUNTED from the rows themselves and only the
 * sub-populations that actually exist are named. An all-runner-captured task is
 * never told the word "self-report"; an all-self-reported task still is (deleting
 * the word would have fixed the misdirection by destroying true information);
 * a mixed task is told the mix, with per-population counts.
 *
 * @param slug - The task's slug, quoted verbatim into the message
 * @param evidence - Every stored row, already read+validated by `readEvidence`
 * @returns The refusal message. Callers own the `code`/`field`/`value` fields —
 *   those are the predicate's identity and this function must never influence them
 */
export function buildAttestationFloorRefusal(slug: string, evidence: readonly EvidenceEntry[]): string {
  const passRows = evidence.filter((e) => e.result === "pass");

  // ARM 2 — nothing to describe on the capture axis: the task holds no pass row
  // at all, so naming `capture_source` here would invent a population. Names the
  // shape it lacks and the field that shape must additionally carry.
  if (passRows.length === 0) {
    return (
      `Task "${slug}" holds no \`result:"pass"\` evidence row at all (${evidence.length} row(s) ` +
      `total; "expected-fail", "fail" and "inconclusive" never count, however many exist) — ` +
      "`lore done` requires at least one row that is BOTH `result:\"pass\"` AND carries " +
      "`attestation`, the runner-issued provenance record. " +
      ATTESTATION_FLOOR_REPAIRS
    );
  }

  const runnerCaptured = passRows.filter(isRunnerCaptured).length;
  const selfReported = passRows.length - runnerCaptured;
  const population =
    runnerCaptured > 0 && selfReported > 0
      ? `${runnerCaptured} runner-captured (\`capture_source:"runner"\`) + ` +
        `${selfReported} self-reported (\`capture_source:"self-report"\`)`
      : runnerCaptured > 0
        ? `all ${runnerCaptured} runner-captured (\`capture_source:"runner"\`)`
        : `all ${selfReported} self-reported (\`capture_source:"self-report"\`)`;

  // The WHY clause is emitted ONLY when the task actually holds a runner-captured
  // row — for an all-self-reported population there is no `--capture` claim to
  // disambiguate, and asserting one would be the same defect mirrored.
  const whyRunnerCaptureIsNotEnough =
    runnerCaptured > 0
      ? " ⛔ `attestation` is a DIFFERENT field from `capture_source`, so a " +
        '`capture_source:"runner"` row here is expected and is NOT the gap: `--capture` proves ' +
        "the exit code of a command the CALLER supplied (and a caller can supply one that " +
        "necessarily exits 0), while `attestation` proves that command's PROVENANCE — `lore " +
        "verify` derives the command from declared scope instead of accepting it."
      : "";

  return (
    `Task "${slug}" holds ${passRows.length} \`result:"pass"\` evidence row(s) — ${population} — ` +
    "but NOT ONE carries `attestation`, the runner-issued provenance record `lore done` " +
    `requires before archiving.${whyRunnerCaptureIsNotEnough} ${ATTESTATION_FLOOR_REPAIRS}`
  );
}

/**
 * The task's declared test-file anchors (task-every-ac-oracle-is-t-scoped-
 * so-the-file-passes-is-attested) still lacking an attested UNFILTERED
 * `result:pass` run — `done()`'s THIRD, independent evidence floor. Mirrors
 * `readRedFirstDeclared`/`isRedRunResult` immediately above: a small, pure,
 * synchronous predicate over already-read data, never a store call of its
 * own.
 *
 * A directory-scoped anchor (trailing `/`, SPEC-042 D4) is NOT a "test
 * file" — {@link isTestFileAnchor} excludes it — because it never names a
 * single file this floor could demand a specific unfiltered command for; a
 * task declaring only directory-scoped (or no) test-file anchors returns
 * `[]` here and is unaffected by this floor entirely (mirrors the "no test-
 * file anchors → nothing to attest" boundary this task's own oracle
 * requires).
 *
 * Only `oracle: "test"` evidence rows are candidates — an unfiltered
 * `tsc`/`lint`/`build` command could coincidentally NAME a test-file path as
 * an argument without that ever constituting a test PASS of that file, so
 * non-test oracles never even reach the command-matching check. Only
 * `result: "pass"` rows count — an unfiltered RED run (the exact fixture
 * this task's own AC-4 requires: two tests that each pass individually
 * under `-t` and fail when the file runs together) must NOT satisfy this
 * floor; it is proof the file does NOT yet pass unfiltered, the opposite of
 * what this floor attests.
 *
 * @returns Every anchor lacking a satisfying row, in declaration order —
 *   `[]` iff every declared test-file anchor is satisfied (or none exist).
 */
function findMissingUnfilteredTestFileRuns(task: DocRecord, evidence: EvidenceEntry[]): string[] {
  const testFileAnchors = extractFileAnchors(task).filter(isTestFileAnchor);
  if (testFileAnchors.length === 0) return [];

  const unfilteredPassingCommands = evidence
    .filter((entry) => entry.oracle === "test" && entry.result === "pass")
    .map((entry) => entry.command);

  return testFileAnchors.filter(
    (anchor) => !unfilteredPassingCommands.some((command) => commandRunsFileUnfiltered(command, anchor)),
  );
}

/**
 * `done()`'s FOURTH, independent floor (task-a-non-empty-output-tail-can-be-hand-
 * authored-prose-and-the) — the red-first floor's opt-IN behaviour, inverted to
 * opt-OUT for every task that never opted in. A task with zero rows satisfying
 * {@link isRedRunResult} and no explicit no-new-tests declaration cannot archive
 * silently just because it never called `lore red-first` — the exact hole T6
 * (this task's own motivating measurement) fell through.
 *
 * Deliberately MUTUALLY EXCLUSIVE with `readRedFirstDeclared`'s own floor
 * (`done()`'s pre-existing check immediately above this function's call site) —
 * a task that DID declare `extra.red_first: true` returns `false` here
 * unconditionally, leaving that EXISTING floor as the sole authority for it
 * (AC6 control: the opt-in path must keep working byte-identically, so this
 * function must never add a SECOND requirement on top of it).
 *
 * Scoped to a task that has DECLARED an `extra.ac_scope` at all (SPEC-038
 * §Design Decisions — the same declared-scope field `lore verify`'s
 * declared-scope selection already consumes), keyed on the DECLARATION'S
 * PRESENCE and never on the array's LENGTH. An absent key means no AC decision
 * has been made yet, which mirrors the sibling floors' own "nothing declared ->
 * nothing to check" shape ({@link findMissingUnfilteredTestFileRuns}'s "no
 * test-file anchors" boundary, the red-first floor's own "never sets the flag"
 * boundary).
 *
 * ⛔ An EXPLICITLY EMPTY scope (`[]`) ARMS this floor — do not "simplify" the
 * guard below back to `acScope === undefined || acScope.length === 0`
 * (task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed). Measured
 * history: this predicate originally short-circuited on both shapes, and then
 * `--ac-scope` became REQUIRED on the `--adhoc` branch (task-an-ad-hoc-task-can-
 * never-reach-the-attestation-path-that) with `--ac-scope ""` as the explicit-
 * empty declaration — making `[]` the DOMINANT ad-hoc shape and leaving this
 * floor unarmed for precisely the shape that re-keying created. Seven live tasks
 * were in that state when it was measured.
 *
 * The keying decision, recorded so it is not re-litigated blind: an empty scope
 * genuinely claims no criterion, so "which ACs went red" has no answer for it —
 * but this floor's question is "was this work done red-first AT ALL", which is
 * answerable either way, and an author who typed `--ac-scope ""` has already
 * been asked one AC question and answered it explicitly. The alternative the
 * governing task offered — keying on "this task touched source files" via
 * `extra.file_anchors` — was REJECTED: anchors are declared BEFORE the work and
 * are opt-in, a doc-only task legitimately anchors `.md` files, and it would arm
 * the floor for every absent-scope task at once (a far wider retroactive
 * refusal than the shape actually measured as broken). ⛔ Also rejected outright:
 * making `--ac-scope ""` synthesize a placeholder criterion — a fabricated id
 * would corrupt `lore verify`'s spec resolution to buy a predicate's
 * convenience.
 *
 * @param task - The already-resolved task DocRecord
 * @param evidence - `readEvidence(task)` — already read by the caller
 * @returns `true` iff this floor applies AND is currently UNSATISFIED (an
 *   explicit no-new-tests declaration, or a red evidence row, is required
 *   before archiving); `false` when the floor doesn't apply (no `ac_scope` key
 *   at all, or `extra.red_first: true` already governs this task) or is already
 *   satisfied by a genuine red row
 * @example
 * requiresNoNewTestsDeclaration(
 *   { extra: { ac_scope: ["AC-1"] } } as DocRecord,
 *   [],
 * ); // => true — declared AC, zero red rows, no red_first opt-in
 * @example
 * requiresNoNewTestsDeclaration({ extra: { ac_scope: [] } } as DocRecord, []);
 * // => true — an EXPLICITLY EMPTY declaration is a decision, and it arms this floor
 * @example
 * requiresNoNewTestsDeclaration({ extra: {} } as DocRecord, []); // => false — no ac_scope key at all
 */
function requiresNoNewTestsDeclaration(task: DocRecord, evidence: EvidenceEntry[]): boolean {
  if (readRedFirstDeclared(task)) return false;
  const acScope = extractDeclaredAcScope(task);
  if (acScope === undefined) return false;
  return !evidence.some((e) => isRedRunResult(e.result));
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

/** The env var names carrying the current agent session's id, in precedence order. */
const SESSION_ID_ENV_VARS = ["CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"] as const;

/**
 * Captures the SESSION INSTANCE for a claim about to be written
 * (task-two-concurrent-orchestrators-both-resolve-to-agent-main §Required fix 1)
 * — the sanitized discriminator of `$CLAUDE_CODE_SESSION_ID` (falling back to
 * `$CLAUDE_SESSION_ID`), read from an INJECTED env map so this stays a pure,
 * directly-testable function.
 *
 * Why this is NOT actor resolution: `resolveActorWithSource` has a session TIER
 * that is shadowed by an explicit name, and every main-checkout run in
 * this project carries one — so the only precedence tier carrying a
 * per-session discriminator is suppressed by the very discipline that fixed the
 * earlier OS-username collapse. Actor identity ("who") and session instance
 * ("which run") are different facts; this captures the second one independently
 * and never merges it into `by`.
 *
 * @param env - Environment map (`process.env` in production, injected at
 *   construction time — see {@link TaskWorkflowService}'s `processEnv` ctor arg).
 * @returns `ok(undefined)` when NO session id is present (unset, empty, or
 *   whitespace-only) — an honest "not measured", which the `noAnchorOverlap`
 *   gate treats as a refusal, never as "same session";
 *   `ok(<discriminator>)` when one is present and usable;
 *   `err(VALIDATION_ERROR)` when a session id IS set but sanitizes to the empty
 *   string. That last case fails LOUD rather than degrading to `undefined`: a
 *   silently-emptied capture would be indistinguishable from "no session env",
 *   which is precisely the conflation this whole mechanism removes.
 * @example
 * resolveClaimSessionId({ CLAUDE_CODE_SESSION_ID: "3DE02220-5d69-4b5a" });
 * // => { ok: true, value: "3de02220" }
 * @example
 * resolveClaimSessionId({}); // => { ok: true, value: undefined } (not measured)
 * @example
 * resolveClaimSessionId({ CLAUDE_SESSION_ID: "!!!" });
 * // => { ok: false, error: { code: "VALIDATION_ERROR", field: "claim.session_id", … } }
 */
export function resolveClaimSessionId(
  env: Record<string, string | undefined>,
): Result<string | undefined, LoreError> {
  let raw: string | undefined;
  for (const name of SESSION_ID_ENV_VARS) {
    const candidate = env[name];
    if (candidate !== undefined && candidate.trim() !== "") {
      raw = candidate;
      break;
    }
  }
  if (raw === undefined) return ok(undefined);
  try {
    return ok(sessionIdDiscriminator(raw));
  } catch {
    // reason: `sessionIdDiscriminator` is fail-loud by contract (an id with no
    // [a-z0-9-] characters). Translated to a Result here — never swallowed to
    // `undefined`, which would make an unusable session id indistinguishable
    // from an absent one and quietly re-open the not-measured hole.
    return err({
      code: "VALIDATION_ERROR",
      field: "claim.session_id",
      message:
        `The session id in $${SESSION_ID_ENV_VARS.join(" / $")} (${JSON.stringify(raw)}) contains no ` +
        "[a-z0-9-] characters, so it cannot be recorded as a session discriminator. Unset the " +
        "variable to claim with an explicitly UNMEASURED session, or set it to a usable id.",
      value: raw,
    });
  }
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
 * Rejects a self-reported non-pass evidence write (`result: "fail"` or
 * `"expected-fail"`) whose `output_tail` is absent or whitespace-only
 * (spec-evidence-output-tail-integrity-a-self-reported-non-pass §D1/§D3). A
 * non-pass row's ENTIRE evidentiary value is its captured output — with no
 * runner attestation to independently confirm the exit code, an empty tail
 * shows nothing about why the run came out that way.
 *
 * SELF-REPORT PATH ONLY — called from BOTH services' own `_addEvidenceImpl`,
 * never from the shared `appendEvidenceEntry`/`recordVerifiedEvidence` chokepoint
 * (see this module's own header invariant for the general split). A
 * runner-attested `fail` can legitimately carry an EMPTY tail
 * (`verify-executor.ts:150` yields `""` whenever the child wrote nothing to
 * stdout+stderr — a silent nonzero exit, a `--quiet` tool, or a timeout killed
 * before flush); binding this rule to the shared chokepoint instead would abort
 * `lore verify` at that AC (`verify-runner-service.ts:770` early-returns on a
 * failed record), converting a reportable failed AC into a partial-abort error.
 * This asymmetry mirrors `evidence-precheck.ts::findFilteredPassProofGap`'s own
 * documented reasoning for the same split (the runner independently observed
 * the exit code; `lore evidence` observed nothing) — do not harmonise the two.
 *
 * Exported (not module-private, unlike {@link rejectPlaceholderEvidenceCommand}
 * below) — `PhaseWorkflowService._addEvidenceImpl` is a PARALLEL implementation
 * that must reject a tail-less non-pass row identically (AC-ETI-6), so it
 * imports this SAME function rather than re-deriving the rule, mirroring the
 * {@link rejectBlankClaimWorktree}/{@link computeArchiveWalk} SSOT-export
 * precedent above.
 *
 * `pass` rows are NEVER bound by this rule (D2) — a filtered `pass` lacking
 * matched-count proof is already covered by the CLI-layer
 * `findFilteredPassRefusal` (`evidence-precheck.ts`); widening this guard to
 * `pass` would collide with that existing guard's own error vocabulary, so this
 * function deliberately uses its OWN message wording, never
 * `findFilteredPassRefusal`'s.
 *
 * @param result - `EvidenceInput.result` as received (never `"inconclusive"` —
 *   the caller has already rejected that above)
 * @param outputTail - `EvidenceInput.output_tail` as received, `undefined` when omitted
 * @returns `ok(undefined)` for `"pass"` (any tail, D2) or a non-pass row with a
 *   genuinely non-empty tail (D3 — tested after trimming); `err(VALIDATION_ERROR)`
 *   naming `output_tail` otherwise
 * @example
 * rejectMissingNonPassOutputTail("fail", undefined);
 * // => err({ code: "VALIDATION_ERROR", field: "output_tail", ... })
 * @example
 * rejectMissingNonPassOutputTail("fail", "\n");
 * // => err(...) — whitespace-only fails the D3 trim test
 * @example
 * rejectMissingNonPassOutputTail("pass", undefined); // => ok(undefined) — D2 control
 */
export function rejectMissingNonPassOutputTail(
  result: string,
  outputTail: string | undefined,
): Result<void, LoreError> {
  if (result !== "fail" && result !== "expected-fail") return ok(undefined);
  if (outputTail !== undefined && outputTail.trim().length > 0) return ok(undefined);
  return err({
    code: "VALIDATION_ERROR",
    field: "output_tail",
    message:
      `a self-reported result "${result}" must carry a non-empty output_tail — with no ` +
      "runner-observed exit code, the tail is the only evidence this run actually failed. " +
      "Capture the real failure output and retry with --output-tail (or --output-tail-file; " +
      "MCP: output_tail).",
    value: outputTail,
  });
}

/**
 * Rejects a self-reported `result: "pass"` row whose PREDICATE is weaker than
 * this function's own message (task-raise-the-evidence-tail-guard-s-predicate-
 * to-its-own, spec-falsifiability-reachability-a-feedable-checkpoint-an §D5,
 * G4) — the message has ALWAYS said "a hand-authored summary is not proof the
 * command actually ran"; until this task, the predicate behind it was only
 * `outputTail.trim().length > 0`. Measured 2026-08-10: 2 of 3 dispatched
 * agents given the rule "the tail must be non-empty and contain the runner's
 * summary line" satisfied it by WRITING the summary themselves — e.g.
 * `'Test Files 1 passed (1); Tests 6 passed (6); Duration 4.24s'` (one line
 * vitest never prints) and `'typecheck:core, typecheck:lore, ... all exit 0'`
 * (a sentence no runner emits) — both PASSED the old predicate. A guard whose
 * message overstates its predicate is worse than no guard: the pass reads as
 * confirmation of the stronger property.
 *
 * D5's fix: the observable property (`non-empty`) is replaced by the MECHANISM
 * (`capture_source: "runner"` — `commands/evidence.ts`'s `--capture`, or any
 * row where `attestation !== undefined`, see {@link
 * TaskWorkflowService.appendEvidenceEntry}'s own forcing logic) — a row this
 * call itself PROVED by observing a real spawn's exit code. Self-report
 * remains available under exactly ONE explicit, recorded justification:
 * `oracle === "manual"` — the sole kind `--capture` structurally can never
 * reach (`findCaptureFlagConflict` refuses `--capture` + `--oracle manual`;
 * there is nothing to spawn for a visual/manual check), so it keeps the
 * pre-existing "genuinely non-empty description" floor as ITS proof instead.
 * Every OTHER oracle kind (`tsc`/`lint`/`build`/`test`/`e2e`/`other`) CAN be
 * captured, so a hand-typed tail no longer substitutes for one — this is the
 * change that closes the measured defect above.
 *
 * ⛔ Back-catalogue (task's own §4): raising this predicate retroactively
 * makes every historical self-report `pass` row recorded before this landed
 * non-conforming to the NEW rule — those existing rows are NOT rewritten or
 * invalidated (the evidence log is append-only); this guard only gates NEW
 * writes going forward. Pre-existing unit/integration tests that used a
 * self-reported non-manual-oracle pass purely as SETUP fixture (not testing
 * this guard itself) were swept to construct `capture_source: "runner"`
 * fixtures instead — grep `task-raise-the-evidence-tail-guard-s-predicate-
 * to-its-own` across the test tree for the swept call sites — never by
 * weakening this predicate.
 *
 * SELF-REPORT PATH ONLY — called from `_addEvidenceImpl`, never from the shared
 * `appendEvidenceEntry`/`recordVerifiedEvidence` chokepoint, mirroring {@link
 * rejectMissingNonPassOutputTail}'s own documented split: a `recordVerifiedEvidence`
 * pass is attested (`attestation !== undefined`), which this function's own
 * `captureSource === "runner"` branch already exempts before ever reaching a
 * hand-authored-tail concern.
 *
 * @param result - `EvidenceInput.result` as received (never `"inconclusive"`)
 * @param outputTail - `EvidenceInput.output_tail` as received, `undefined` when omitted
 * @param captureSource - `EvidenceInput.capture_source` as received — REQUIRED on
 *   `EvidenceInput` (task-capture-source-is-optional-at-the-evidence-write-boundary),
 *   so a live caller never actually supplies `undefined`; the parameter type stays
 *   `CaptureSource | undefined` only for defensive robustness as a pure, independently
 *   exported function. Any non-`"runner"` value (including a hypothetical `undefined`)
 *   is treated identically to `"self-report"`, never silently exempted the way
 *   `"runner"` is
 * @param oracle - `EvidenceInput.oracle` as received — the ONE new input this D5 raise
 *   needs, since the sole surviving self-report escape (`"manual"`) is oracle-keyed
 * @returns `ok(undefined)` for any non-`"pass"` result (D2, unaffected — that's
 *   {@link rejectMissingNonPassOutputTail}'s job), a `captureSource === "runner"` pass
 *   (any tail, independently verified), or an `oracle === "manual"` self-report with a
 *   genuinely non-empty tail (its only available proof); `err(VALIDATION_ERROR)` naming
 *   `output_tail` AND `--capture` otherwise — including a NON-EMPTY hand-authored tail on
 *   any other oracle, which the pre-D5 predicate used to accept
 * @example
 * rejectMissingPassOutputTail("pass", "fabricated but non-empty", "self-report", "test");
 * // => err({ code: "VALIDATION_ERROR", field: "output_tail", ... }) — D5's fix; pre-D5 this was ok()
 * @example
 * rejectMissingPassOutputTail("pass", undefined, "self-report", "test");
 * // => err({ code: "VALIDATION_ERROR", field: "output_tail", ... })
 * @example
 * rejectMissingPassOutputTail("pass", undefined, "runner", "test");
 * // => ok(undefined) — a capture ran and produced nothing on stdout+stderr
 * @example
 * rejectMissingPassOutputTail("pass", "checked the login page by hand", "self-report", "manual");
 * // => ok(undefined) — manual is the one oracle --capture can never reach
 * @example
 * rejectMissingPassOutputTail("fail", undefined, "self-report", "test"); // => ok(undefined) — not this guard's result
 */
export function rejectMissingPassOutputTail(
  result: string,
  outputTail: string | undefined,
  captureSource: CaptureSource | undefined,
  oracle: string,
): Result<void, LoreError> {
  if (result !== "pass") return ok(undefined);
  if (captureSource === "runner") return ok(undefined);
  // D5's ONE surviving self-report escape — see this function's own module header.
  if (oracle === "manual" && outputTail !== undefined && outputTail.trim().length > 0) {
    return ok(undefined);
  }
  return err({
    code: "VALIDATION_ERROR",
    field: "output_tail",
    message:
      'a self-reported result "pass" is not provable by a hand-authored output_tail alone ' +
      "— a fabricated summary (even one embedding real-looking numbers) satisfies a bare " +
      "non-empty check exactly as well as a genuine one, which this rule exists because it " +
      "measurably happened. Retry with `--capture` (spawns --command itself and records ITS " +
      'OWN captured output, stamping capture_source: "runner" — the only proof this check ' +
      "accepts), or use --oracle manual for a check with nothing capturable (still needs a " +
      "genuine non-empty --output-tail/--output-tail-file describing exactly what was checked).",
    value: outputTail,
  });
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

/** Runner-measured git facts no public evidence write may declare (baseline slice 1 §C5). */
const CALLER_FORBIDDEN_GIT_STAMP_FIELDS = ["head_sha", "worktree_dirty"] as const;

/**
 * Returns the VALIDATION_ERROR refusing a caller-supplied `head_sha` / `worktree_dirty`
 * — top-level on the evidence input OR inside `capture_attestation` — or `undefined`
 * when neither is present. Presence (own key, any value, even `undefined`) is the
 * trigger, mirroring the sibling `attestation` / `ac_oracle_generation` guards: a
 * fail-loud refusal, never a silent strip.
 *
 * @param entry - the raw public evidence input (may be an `as EvidenceInput`-cast untyped object)
 * @returns the error to wrap in `err(...)`, or `undefined` when clean
 *
 * reason: exported so `PhaseWorkflowService._addEvidenceImpl` (a parallel
 * implementation outside this task's anchors) can adopt the SAME guard instead of a
 * mirrored copy — see the `promoteCapturedAttestation` SSOT precedent above.
 */
export function rejectCallerGitStamp(entry: EvidenceInput): LoreError | undefined {
  const raw = entry as unknown as Record<string, unknown>;
  const captured = raw["capture_attestation"];
  for (const field of CALLER_FORBIDDEN_GIT_STAMP_FIELDS) {
    const inCapture =
      typeof captured === "object" && captured !== null && Object.prototype.hasOwnProperty.call(captured, field);
    if (Object.prototype.hasOwnProperty.call(raw, field) || inCapture) {
      return {
        code: "VALIDATION_ERROR",
        field,
        message: `${field} is measured by the verify runner from git (not a valid evidence input field)`,
        value: inCapture ? (captured as Record<string, unknown>)[field] : raw[field],
      };
    }
  }
  return undefined;
}

/**
 * Moves a measured `capture_attestation` into the `attestation` slot the shared append
 * path reads (SPEC-143 AC-CT-2) — the ONE place the promotion happens, called by BOTH
 * `TaskWorkflowService._addEvidenceImpl` and `PhaseWorkflowService._addEvidenceImpl`
 * (imported, never mirrored — the same SSOT precedent {@link
 * rejectMissingNonPassOutputTail} and {@link rejectBlankClaimWorktree} already set for
 * that file).
 *
 * ⛔ ONE function rather than a "check it" + "copy it" pair, deliberately: a caller that
 * ran only half of such a pair would either drop the measurement (re-minting the false
 * trust label) or write it unvalidated. There is nothing to half-do here.
 *
 * TOTAL and non-destructive: an entry with no `capture_attestation` (every self-reported
 * write) comes back structurally unchanged, so this is on the identity path for every
 * pre-SPEC-143 caller. Nothing is inferred and no default is invented — a row gets an
 * attestation if and only if a capture measured one.
 *
 * The `capture_source` field is left exactly as the caller passed it: `appendEvidenceEntry`
 * already FORCES `"runner"` for any row carrying an attestation, so the incoherent
 * combination (self-report label + measured attestation) cannot survive the write even
 * if some future caller assembles it. That pre-existing override is why this function
 * needs no validation branch of its own.
 *
 * @param entry - the public evidence input, possibly carrying a measured capture attestation
 * @returns the same entry shaped for the shared append path, with `attestation` set iff a
 *   `capture_attestation` was measured
 * @example
 * promoteCapturedAttestation({ …, capture_source: "self-report" });
 * // => { …, capture_source: "self-report" }  (no attestation — nothing measured one)
 * @example
 * promoteCapturedAttestation({ …, capture_source: "runner",
 *   capture_attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 41, timed_out: false } });
 * // => { …, capture_source: "runner", attestation: { runner: "lore-cli", exit_code: 0, … } }
 */
export function promoteCapturedAttestation(entry: EvidenceInput): VerifiedEvidenceInput {
  const { capture_attestation: measured, ...rest } = entry;
  return {
    ...rest,
    ...(measured !== undefined ? { attestation: measured } : {}),
  };
}

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

// ─── Uncommitted-Worktree Attestation Guard ────────────────────────────────
// task-lore-evidence-and-lore-release-accept-an-attestation-from — refuses a
// self-reported `lore evidence --result pass` / `lore release` issued from a
// claim whose recorded worktree carries uncommitted tracked-file changes, so
// the corpus never records a verified-or-released task backed by no commit
// (2026-08-01 incident: 7 evidence rows + a release recorded while
// `git log main..<branch>` was EMPTY — the branch would have been deleted by
// the orchestrator's routine post-merge cleanup with nothing to merge).
//
// adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the — the
// three-question review THIS predicate answers:
//
//   Q1 Proxy — is `git status --porcelain` non-empty over the claim's
//     recorded worktree a proxy, or the property itself? It IS the property
//     ("is this attestation backed by committed state"), not a proxy for it.
//     A REJECTED alternative: scoping the check to only the task's DECLARED
//     `file_anchors`. Concrete input that satisfies that narrower check while
//     violating the real property: a task anchoring file `A`, whose
//     implementer actually edits UNDECLARED file `B` and leaves `B`
//     uncommitted — `A` alone is clean, the anchor-scoped check passes, and
//     the attestation is still backed by no commit (the exact
//     `noAnchorOverlap` blindness one layer down). Declared anchors are used
//     ONLY by {@link rankDirtyPathsByAnchors} to ORDER which paths a refusal
//     message names first — never to narrow which paths count as dirty.
//   Q2 Silence — three preconditions can be absent: no recorded
//     `extra.claim.worktree`; the recorded path is not inside a git working
//     tree; `git` itself is unavailable/times out. Each is recorded as a
//     DISTINCT `"not-measured-*"` {@link WorktreeCleanlinessStatus} value,
//     never silently folded into `"measured-clean"` — a caller scoring
//     attestation quality can always tell "verified clean" from "never
//     checked". The latter two preconditions share ONE value
//     (`"not-measured-not-a-repo"`) — see that type's own doc for why a
//     fourth value was not warranted.
//   Q3 Opt-in — `--worktree` is ALWAYS explicit (SPEC-025/042); a claim taken
//     WITHOUT one bypasses this predicate entirely by construction (the
//     predicate has nothing to measure). Route taken: closed at the CALLING
//     CLI layer, not left silent. `commands/evidence.ts`/`commands/
//     release.ts` populate `EvidenceInput.callerCwd`/`ReleaseOpts.callerCwd`
//     with their own `process.cwd()` (a fresh subprocess per invocation, so
//     this is always the real caller's directory — the identical fact
//     `commands/evidence.ts`'s own missing-oracle-file precheck already
//     documents). When a claim recorded NO worktree AND the call is running
//     from inside a REAL git repository, that mismatch is itself refused
//     loud ({@link buildNoWorktreeMismatchRefusal}) rather than silently
//     passed through as "nothing to check" — see `checkUncommittedAttestationWorktree`.
//     `callerCwd` omitted (every direct-service test caller in this codebase,
//     and any future non-CLI caller) simply skips this ONE escalation; the
//     primary cleanliness predicate is unaffected either way, since it keys
//     off the claim's own recorded worktree, never this field.
//
//   ⛔ CORRECTED 2026-08-02 (task-the-uncommitted-worktree-guard-treats-no-
//     claim-at-all-as-a) — the Q3 escalation above was ORIGINALLY keyed off
//     `readClaim(task)?.worktree === undefined` alone, which is `true` for
//     BOTH "a claim exists but recorded no worktree" (the intended Q3
//     target) AND "there is no claim at all" (a task nobody has ever
//     claimed, or one that was already released). That collapse fired the
//     Q3 mismatch refusal on every `lore evidence --result pass` issued
//     against an unclaimed task from inside a git repo — the orchestrator's
//     standard post-merge re-verification path — asserting a fact about a
//     claim that did not exist and prescribing a repair (re-claim the task)
//     that was wrong for that caller. Fixed by checking {@link
//     hasRecordedClaim} (the RAW `extra.claim` presence) FIRST: no claim at
//     all now returns `null` (proceed) unconditionally, before the Q3
//     mismatch check ever runs — the escalation below is reachable ONLY
//     when a claim genuinely exists and genuinely recorded no worktree.

/**
 * Distinct outcomes of measuring whether a claim's recorded worktree has
 * uncommitted tracked-file changes — see the module section header
 * immediately above for the full three-question review this type answers
 * (Q2 in particular: each value below is a DISTINCT, never-conflated state).
 */
export type WorktreeCleanlinessStatus =
  | "measured-clean"
  | "measured-dirty"
  | "not-measured-no-worktree"
  | "not-measured-not-a-repo";

/**
 * {@link measureWorktreeCleanliness}'s return shape. `paths` (git's raw
 * porcelain path column, one entry per dirty line, UNRANKED) is non-empty iff
 * `status === "measured-dirty"` — every other status carries `[]`.
 */
export interface WorktreeCleanlinessCheck {
  status: WorktreeCleanlinessStatus;
  paths: string[];
}

/** Wall-clock budget for the `git` subprocesses this guard shells — generous enough for a cold-cache `status --porcelain` on a large tree, bounded so a hung/unreachable filesystem (e.g. a stale network mount) cannot hang an evidence/release call indefinitely. */
const WORKTREE_GIT_TIMEOUT_MS = 10_000;

/**
 * Measures whether `worktree` (a claim's recorded `extra.claim.worktree`, or
 * `undefined` when the claim never recorded one) has uncommitted tracked-file
 * changes, via a REAL `git status --porcelain` subprocess — no fake/mocked
 * git state; this predicate exists specifically because a mocked check would
 * be exactly the kind of proxy adr-lore-s-mechanisms-validate-a-proxy-for-
 * the-property-not-the warns against. NEVER throws — every failure mode
 * (worktree path missing/deleted, path exists but is not a git working tree,
 * `git` absent from PATH, a killed/timed-out subprocess) degrades to
 * `"not-measured-not-a-repo"` rather than propagating an exception into a
 * caller that expects a plain `Result`-returning method.
 *
 * @param worktree - `TaskClaim.worktree` as read from the resolved task's
 *   current claim; `undefined` when the claim recorded none at all.
 * @returns `{status, paths}` — see {@link WorktreeCleanlinessCheck}.
 * @example
 * measureWorktreeCleanliness(undefined);
 * // => { status: "not-measured-no-worktree", paths: [] }
 * @example
 * measureWorktreeCleanliness("/does/not/exist");
 * // => { status: "not-measured-not-a-repo", paths: [] }
 */
export function measureWorktreeCleanliness(worktree: string | undefined): WorktreeCleanlinessCheck {
  if (worktree === undefined) {
    return { status: "not-measured-no-worktree", paths: [] };
  }

  try {
    const result = spawnSync("git", ["status", "--porcelain"], {
      cwd: worktree,
      encoding: "utf8",
      timeout: WORKTREE_GIT_TIMEOUT_MS,
    });
    if (result.error !== undefined || result.status !== 0) {
      return { status: "not-measured-not-a-repo", paths: [] };
    }

    // reason: deliberately naive porcelain-line parsing — no shell/diff-
    // grammar parser (mirrors evidence-precheck.ts's documented "no
    // shell-grammar parser" posture for extractCdPrefixTarget). Each normal
    // line is "XY <path>" (2 status chars + 1 space); a rename line is
    // "XY <old> -> <new>" and is kept verbatim as ONE string rather than
    // specially re-split — an acceptable narrow gap, not a silent one (the
    // rename still surfaces in the refusal message, just not re-ranked
    // against anchors as precisely as a plain path would be).
    const lines = result.stdout.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return { status: "measured-clean", paths: [] };
    }
    return { status: "measured-dirty", paths: lines.map((line) => line.slice(3).trim()) };
  } catch {
    return { status: "not-measured-not-a-repo", paths: [] };
  }
}

/**
 * `true` iff `cwd` sits inside ANY git working tree (main checkout or linked
 * worktree) — used ONLY for the Q3 opt-in-hole mismatch signal (module
 * section header above), never for the primary cleanliness predicate above.
 * NEVER throws — every failure mode degrades to `false` ("cannot prove this
 * is a repo" reads identically to "not a repo" for this narrow purpose).
 */
function isInsideGitRepo(cwd: string): boolean {
  try {
    const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      encoding: "utf8",
      timeout: WORKTREE_GIT_TIMEOUT_MS,
    });
    return result.error === undefined && result.status === 0 && result.stdout.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Orders `paths` (dirty entries from {@link measureWorktreeCleanliness}, in
 * git's own porcelain order) so any path overlapping one of the task's OWN
 * declared `file_anchors` is named FIRST in a refusal message — anchors rank
 * the message ONLY, they never narrow the predicate itself (Q1 above: the
 * predicate is whole-worktree porcelain, unconditionally). Reuses
 * {@link anchorsOverlap}'s already-tested segment-match (treating each dirty
 * path as a singleton anchor list) rather than re-deriving prefix-matching
 * logic — SSOT.
 *
 * @param paths - Dirty paths, in git's own porcelain order.
 * @param anchors - The task's `extractFileAnchors(task)` result; `[]` (an
 *   anchor-less task) is legal and returns `paths` completely unreordered.
 * @returns `paths` reordered: anchor-overlapping entries first (relative
 *   order preserved within each group), then every other entry.
 * @example
 * rankDirtyPathsByAnchors(["src/b.ts", "src/a.ts"], ["src/a.ts"]);
 * // => ["src/a.ts", "src/b.ts"]
 */
export function rankDirtyPathsByAnchors(paths: string[], anchors: string[]): string[] {
  if (anchors.length === 0) return paths;
  const anchored: string[] = [];
  const rest: string[] = [];
  for (const path of paths) {
    if (anchorsOverlap([path], anchors).overlaps) {
      anchored.push(path);
    } else {
      rest.push(path);
    }
  }
  return [...anchored, ...rest];
}

/**
 * How an operator repairs a `"measured-dirty"` refusal — appended verbatim so
 * the refusal always ends with the action, not just the diagnosis (house
 * rule). `-m` MUST precede `--`, or git reads the commit message itself as a
 * pathspec (an easy-to-mistype ordering, called out explicitly here rather
 * than left for the reader to discover the hard way).
 */
function buildDirtyWorktreeRepairHint(worktree: string, paths: string[]): string {
  const pathList = paths.join(" ");
  return (
    `From inside "${worktree}": \`git add ${pathList}\` then ` +
    `\`git commit -m "<message>" -- ${pathList}\` (note: -m must precede -- , ` +
    "or git reads the message as a pathspec) — then retry."
  );
}

/** Builds the `"measured-dirty"` refusal — the primary predicate's refusal path. */
function buildUncommittedWorktreeRefusal(opts: {
  actionLabel: string;
  taskSlug: string;
  worktree: string;
  rankedPaths: string[];
}): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "extra.claim.worktree",
    message:
      `Refused: ${opts.actionLabel} for task "${opts.taskSlug}" — its claim's recorded ` +
      `worktree "${opts.worktree}" has uncommitted change(s): ${opts.rankedPaths.join(", ")}. ` +
      "This would record a verified/released task backed by no commit " +
      "(task-lore-evidence-and-lore-release-accept-an-attestation-from). " +
      buildDirtyWorktreeRepairHint(opts.worktree, opts.rankedPaths),
    value: opts.rankedPaths,
  };
}

/** Builds the Q3 opt-in-hole mismatch refusal — see the module section header's Q3 paragraph. */
function buildNoWorktreeMismatchRefusal(opts: {
  actionLabel: string;
  taskSlug: string;
  callerCwd: string;
}): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "extra.claim.worktree",
    message:
      `Refused: ${opts.actionLabel} for task "${opts.taskSlug}" — its claim recorded NO ` +
      `worktree, but this call is running from inside a git repository ("${opts.callerCwd}"). ` +
      "SPEC-025/042 keep --worktree ALWAYS explicit, so a claim taken without it bypasses " +
      "this task's uncommitted-worktree refusal entirely " +
      "(task-lore-evidence-and-lore-release-accept-an-attestation-from, opt-in review Q3). " +
      `Re-claim with \`lore claim ${opts.taskSlug} --worktree "$PWD"\` from the actual working ` +
      "directory, then retry.",
    value: opts.callerCwd,
  };
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
   * Narrow port resolving the FULL declared acceptance criteria on a plan's parent
   * spec — the generation-carrying sibling of {@link resolveDeclaredAcIds}. A bare
   * `Set<string>` of ids cannot answer "what generation is that criterion in", so
   * {@link resolveAcOracleGeneration} (this service's SOLE consumer of this port)
   * needs the criterion OBJECTS, not just their ids. Implemented by
   * `CorpusService.resolveDeclaredAcCriteria` and injected here for the same
   * cross-service reason `resolveDeclaredAcIds` is (services don't cross-import).
   * Before this port existed, `resolveAcOracleGeneration` carried its own private
   * task→plan→spec traversal (deleted by
   * task-widen-the-declared-ac-port-to-carry-criteria-so-the) precisely because
   * neither injected port could carry more than an id set. Defaults to a
   * stub that always resolves `null` ("nothing declared"), same rationale as
   * `resolveDeclaredAcIds`'s own default — the default is only ever consulted when
   * an `ac_ref` is actually supplied to addEvidence for a plan-owned task.
   */
  private readonly resolveDeclaredAcCriteria: (
    planId: string,
  ) => Promise<Result<AcceptanceCriterion[] | null, LoreError>>;

  /**
   * The `--adhoc`-task sibling of {@link resolveDeclaredAcCriteria} — the
   * generation-carrying counterpart of {@link resolveAdhocGoverningAcIds}.
   * Implemented by `CorpusService.resolveDeclaredAcCriteriaForAdhocTask` and
   * injected here for the same reason. Its sole consumer is
   * {@link resolveAcOracleGeneration}. Defaults to a stub that always resolves an
   * EMPTY array — deliberately NOT a refusing stub like
   * `resolveAdhocGoverningAcIds`'s default: an unresolved criterion here degrades
   * to "no generation to stamp" (`ok(null)` from {@link resolveAcOracleGeneration}),
   * never a write-blocking refusal — refusing on a bad/absent `ac_scope` is
   * `resolveAdhocGoverningAcIds`'s job alone, in the cross-entity check a few lines
   * later in `appendEvidenceEntry`.
   */
  private readonly resolveAdhocGoverningAcCriteria: (
    task: DocRecord,
  ) => Promise<Result<AcceptanceCriterion[], LoreError>>;

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
   * @param processEnv - Environment snapshot the claim path captures
   *   `session_id` from (task-two-concurrent-orchestrators-both-resolve-to-agent-main),
   *   wired to `process.env` at `app.ts` composition time — the SAME injected-env
   *   discipline `VerifyRunnerService` uses. Defaults to `{}` (no session facts),
   *   deliberately NOT to `process.env`: an ambient default would make every unit
   *   test's gate verdict depend on whether the test process happens to run under
   *   a Claude Code session, i.e. a machine-dependent oracle. A bare
   *   `new TaskWorkflowService(store, telemetry, config)` therefore records no
   *   `session_id` — byte-identical to pre-fix behavior, the same optional-DI
   *   convention `gate` follows.
   * @param resolveDeclaredAcCriteria - task-widen-the-declared-ac-port-to-carry-
   *   criteria-so-the cross-entity port; production wiring is
   *   `corpusService.resolveDeclaredAcCriteria.bind(corpusService)` (app.ts). The
   *   SOLE consumer is {@link resolveAcOracleGeneration} — every existing `ac_ref`
   *   existence check keeps reading `resolveDeclaredAcIds` unchanged. Defaults to
   *   a stub resolving `null`, so every pre-existing bare construction that omits
   *   it keeps compiling and stamps no generation (byte-identical to before this
   *   port existed for a task never exercising `ac_ref`).
   * @param resolveAdhocGoverningAcCriteria - the ad-hoc sibling of
   *   `resolveDeclaredAcCriteria`; production wiring is
   *   `corpusService.resolveDeclaredAcCriteriaForAdhocTask.bind(corpusService)`
   *   (app.ts). Defaults to a stub resolving an empty array (see the field's own
   *   JSDoc for why this default is benign rather than refusing).
   * @param detectBranch - AC-OWN-2 injected port measuring a worktree's current
   *   git branch — `claim()` calls this ONLY when `opts.branch` is omitted AND
   *   `opts.worktree` is given (an explicit `--branch` always wins outright,
   *   skipping detection entirely). Defaults to the REAL implementation
   *   (`real-git-port.ts::detectWorktreeBranch`) — unlike the cross-service
   *   ports above, this capability needs no `app.ts` wiring (no other service
   *   dependency), so the default IS production behavior, not a benign stub.
   *   Tests inject a fake to avoid a real `git` subprocess, or rely on the
   *   real one against a throwaway `mkdtemp` repo (this service's own suite
   *   does both).
   * @param installClaimTrailerBinding - AC-OWN-4 injected port — best-effort,
   *   ADVISORY (see its own JSDoc): binds `opts.worktree` to the claim's
   *   captured session so a LATER commit made there carries the
   *   `Lore-Session:` git trailer. Defaults to the REAL implementation
   *   (`real-git-port.ts::bindClaimSessionForTrailer`) for the same
   *   no-app.ts-wiring-needed reason `detectBranch` does. Called ONLY when
   *   both a worktree AND a measured session_id are present — never awaited
   *   into `claim()`'s own `Result` (a hook-install/marker-write failure must
   *   never fail a claim).
   * @param releaseClaimTrailerBinding - AC-OWN-4 injected port — the release-side
   *   counterpart of `installClaimTrailerBinding` above, best-effort, ADVISORY
   *   (see its own JSDoc): clears the marker `installClaimTrailerBinding` wrote
   *   for the RELEASED claim's own `{worktree, session_id}`, so a LATER commit
   *   made in that worktree no longer carries the released claim's
   *   `Lore-Session:` trailer. Defaults to the REAL implementation
   *   (`real-git-port.ts::unbindClaimSessionForTrailer`) for the same
   *   no-app.ts-wiring-needed reason `installClaimTrailerBinding` is. Called
   *   from `_releaseImpl` ONLY on the CONFIRMED-release path, after
   *   `writeTaskExtra` succeeds, and ONLY when the claim BEING RELEASED
   *   carried both a worktree AND a measured session_id — never awaited into
   *   `release()`'s own `Result` (a marker-clear failure must never fail a
   *   release).
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
    private readonly processEnv: Record<string, string | undefined> = {},
    resolveDeclaredAcCriteria: (
      planId: string,
    ) => Promise<Result<AcceptanceCriterion[] | null, LoreError>> = async () => ok(null),
    resolveAdhocGoverningAcCriteria: (
      task: DocRecord,
    ) => Promise<Result<AcceptanceCriterion[], LoreError>> = async () => ok([]),
    private readonly detectBranch: (worktree: string) => Promise<BranchMeasurement> = detectWorktreeBranch,
    private readonly installClaimTrailerBinding: (
      worktree: string,
      sessionId: string,
    ) => Promise<void> = bindClaimSessionForTrailer,
    private readonly releaseClaimTrailerBinding: (
      worktree: string,
      sessionId: string,
    ) => Promise<void> = unbindClaimSessionForTrailer,
    // reason: issue #106 — the git/fs probe behind `done()`'s worktree cleanup; defaults to real git so every shipped surface cleans up without
    // `app.ts` wiring (same leaf-IO-port precedent as `detectBranch` above).
    private readonly worktreeProbe: WorktreeGitProbe = createRealWorktreeProbe(),
    // reason: the single worktree-removal test's facts (spec-one-worktree-removal-test-for-the-guard-lore-done-and-a);
    // wired by `app.ts` (a service never imports another service). ABSENT => `done`'s cleanup reports every recorded
    // worktree `not-measured`, never removes — no silent "safe" default.
    private readonly worktreeRemoval?: WorktreeRemovalFactsPort,
  ) {
    this.telemetry = telemetry;
    this.claimTtlMinutes = config.claimTtlMinutes;
    this.resolveDeclaredAcIds = resolveDeclaredAcIds;
    this.resolveAdhocGoverningAcIds = resolveAdhocGoverningAcIds;
    this.resolveDeclaredAcCriteria = resolveDeclaredAcCriteria;
    this.resolveAdhocGoverningAcCriteria = resolveAdhocGoverningAcCriteria;
  }

  /**
   * Hands the workflow service the post-archive step that closes the GitHub issues of the defect reports
   * the archived task resolves (spec-archiving-the-work-that-resolves-a-defect-report-closes D4). Wired by
   * `app.ts` (a service never imports another service); the SAME instance `CorpusService` holds. An unwired
   * service (every bare construction) runs no step: tests only.
   */
  setArchiveIssueClosePort(port: ArchiveIssueClosePort): void {
    this.archiveIssueClosePort = port;
  }

  private archiveIssueClosePort: ArchiveIssueClosePort | undefined;

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

    // Baseline slice 1 §C5 — `head_sha` / `worktree_dirty` are MEASURED by the runner
    // (`VerifyRunnerService`), never declared by a caller: a self-reported value would
    // let rule-state derivation treat an unmeasured claim as an anchored run.
    const gitStampRefusal = rejectCallerGitStamp(entry);
    if (gitStampRefusal !== undefined) return err(gitStampRefusal);

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

    // spec-evidence-output-tail-integrity-a-self-reported-non-pass §D1/§D3 —
    // fourth self-report-only guard, beside the two above and the
    // placeholder-command check below. Pure input-shape check (no store read),
    // so it runs here alongside the other input-only guards rather than after
    // resolveTask.
    const tailCheck = rejectMissingNonPassOutputTail(entry.result, entry.output_tail);
    if (!tailCheck.ok) return tailCheck;

    // spec-evidence-labels-and-reds-are-honest D1 (#48) — "runner-unattested" is
    // minted only by the trusted runner; a public caller may not self-label it.
    const selfLabelCheck = rejectSelfLabelledRunnerUnattested(entry.capture_source);
    if (!selfLabelCheck.ok) return selfLabelCheck;

    // task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the — the PASS-side
    // sibling of the guard immediately above (see that task's own JSDoc for the
    // asymmetry this closes). Exempts any row `capture_source: "runner"` already proved
    // via an actual capture.
    const passTailCheck = rejectMissingPassOutputTail(
      entry.result,
      entry.output_tail,
      entry.capture_source,
      entry.oracle,
    );
    if (!passTailCheck.ok) return passTailCheck;

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

    // task-lore-evidence-and-lore-release-accept-an-attestation-from — self-
    // reported PASS ONLY (a fail/expected-fail row carries no "this is
    // verified" claim that a commit needs to back). Reuses targetCheck.value
    // (already resolved above) rather than a third store read.
    if (entry.result === "pass") {
      const worktreeError = this.checkUncommittedAttestationWorktree(
        targetCheck.value,
        "`lore evidence --result pass`",
        entry.callerCwd,
      );
      if (worktreeError !== null) return err(worktreeError);
    }

    // reason: SPEC-143 AC-CT-2 — the ONE hand-off point where a measured capture
    // attestation becomes the row's `attestation`. Runs LAST, after every
    // self-report guard above, so a captured row is held to exactly the same
    // admission checks it always was; the promotion changes what gets WRITTEN, never
    // what gets ADMITTED. Shared with PhaseWorkflowService (SSOT — see
    // promoteCapturedAttestation's own JSDoc for why it is one function, not a pair).
    return this.appendEvidenceEntry(idOrSlug, promoteCapturedAttestation(entry), entry.recorded_by, now);
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
   *
   * @invariant `capture_source` is ALWAYS stamped on the written candidate — never
   *   omitted for a NEW row (task-a-non-empty-output-tail-can-be-hand-authored-prose-
   *   and-the; requiredness on `entry` itself pinned by
   *   task-capture-source-is-optional-at-the-evidence-write-boundary, `EvidenceInput`/
   *   `VerifiedEvidenceInput` both make it a compile-time-required field, so `entry
   *   .capture_source` is NEVER `undefined` here — no nullish-coalescing self-report
   *   default exists at this chokepoint, by construction, not by convention).
   *   `entry.attestation !== undefined` forces `"runner"` regardless of whatever
   *   `entry.capture_source` held (an attested row is runner-captured by
   *   construction — `recordVerifiedEvidence`'s only production caller,
   *   `VerifyRunnerService`, always spawns its own commands and passes `"runner"`
   *   itself anyway) — a correctness override on a value the caller DID supply,
   *   never a default standing in for one it omitted.
   */
  private async appendEvidenceEntry(
    idOrSlug: string,
    entry: VerifiedEvidenceInput,
    actor: string,
    now: () => string,
  ): Promise<Result<DocRecord, LoreError>> {
    // §M5 (AC-DC-8) — fail-loud, NOT a silent strip, and bound to the SHARED chokepoint
    // rather than the self-report path: `ac_oracle_generation` is resolved from the
    // referenced criterion below for BOTH write paths, so NEITHER a CLI caller NOR the
    // trusted runner may declare it (this is where it differs from `attestation`, which
    // the runner does supply). `EvidenceInput`/`VerifiedEvidenceInput` both exclude the
    // field at compile time; this runtime check is what actually stops an
    // `as EvidenceInput`-cast untyped candidate object — the exact shape CLI commands
    // assemble flag-derived candidates with — from smuggling it past the type system.
    if (Object.prototype.hasOwnProperty.call(entry, "ac_oracle_generation")) {
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_oracle_generation",
        message:
          "ac_oracle_generation is stamped by the evidence write path from the referenced " +
          "acceptance criterion (not a valid evidence input field)",
        value: (entry as Record<string, unknown>)["ac_oracle_generation"],
      });
    }

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

    // §M5 (AC-DC-8) — resolve the oracle generation in force for this row's `ac_ref`
    // BEFORE `now()` fires, so the time seam stays as tight to the write as it has
    // always been (see this method's `now` param JSDoc — the sequential-CAS
    // STALE_VERSION recipe depends on that ordering). `null` means "no criterion to
    // resolve against": either no `ac_ref` at all, or an `ac_ref` the cross-entity
    // check below is about to REFUSE — so no committed row is ever left unstamped by a
    // resolution failure. See `resolveAcOracleGeneration`'s own JSDoc.
    const generationResult =
      entry.ac_ref === undefined ? ok(null) : await this.resolveAcOracleGeneration(task, entry.ac_ref);
    if (!generationResult.ok) return generationResult;
    const acOracleGeneration = generationResult.value;

    const nowIso = now();
    // reason: NO fallback here by design (task-capture-source-is-optional-at-the-
    // evidence-write-boundary) — `entry.capture_source` is compile-time REQUIRED on
    // both `EvidenceInput` and `VerifiedEvidenceInput`, so this is a correctness
    // OVERRIDE for an attested row (proven runner-captured by construction), never a
    // default standing in for an omitted value. Reaching for a nullish-coalescing
    // self-report default here again reopens the exact silent-fallback defect this
    // task removed — the type refusing omission is the point, not an inconvenience.
    // `resolveWrittenCaptureSource` is the one copy shared with PhaseWorkflowService
    // and also refuses the contradictory "runner-unattested"+attestation row (#48).
    const captureSourceResult = resolveWrittenCaptureSource(entry);
    if (!captureSourceResult.ok) return captureSourceResult;
    const captureSource: CaptureSource = captureSourceResult.value;
    const candidate = {
      oracle: entry.oracle,
      command: entry.command,
      result: entry.result,
      recorded_at: nowIso,
      recorded_by: entry.recorded_by,
      capture_source: captureSource,
      ...(entry.output_tail !== undefined ? { output_tail: entry.output_tail } : {}),
      ...(entry.ac_ref !== undefined ? { ac_ref: entry.ac_ref } : {}),
      // §M5 (AC-DC-8) — present-iff-resolved, and validated by the same
      // `evidenceEntrySchema.safeParse` every other field goes through below.
      ...(acOracleGeneration !== null ? { ac_oracle_generation: acOracleGeneration } : {}),
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

  /**
   * The oracle generation in force for `acRef`'s declared criterion, right now
   * (spec-the-defect-channel-cannot-be-honestly-maintained-an §M5, AC-DC-8) — the value
   * {@link appendEvidenceEntry} stamps onto the row it is about to append, so a later
   * `verify.command` rewrite (`AcService.setCriterion`) leaves this row reportable as
   * PRIOR-generation without anyone editing it.
   *
   * Reads the criterion from the injected {@link resolveDeclaredAcCriteria} (plan-owned
   * task) / {@link resolveAdhocGoverningAcCriteria} (`--adhoc` task) ports — task-widen-
   * the-declared-ac-port-to-carry-criteria-so-the widened both ports to carry the full
   * criterion (not just its id) precisely so this method no longer needs a traversal of
   * its own. A prior version of this method owned a private task→plan→spec walk (deleted
   * by that task) because neither port could answer "what generation is that criterion
   * in" until they returned criterion OBJECTS instead of a bare id set.
   *
   * @param task - the resolved target task (already type-validated by the caller)
   * @param acRef - the row's `ac_ref`, verbatim
   * @returns `ok(<generation>)` when `acRef` names a criterion the port resolves;
   *   `ok(null)` when it does not, or when a plan-owned task has no parent at all
   *   (`task.parent_id === null`, checked before consulting the port — same short
   *   circuit the deleted traversal used to apply). `null` is NOT a silent
   *   fallback: every case that produces it is a case the pre-existing cross-entity
   *   `ac_ref` check in {@link appendEvidenceEntry} REFUSES a few lines later, with its
   *   own better-worded VALIDATION_ERROR naming the available ids — this method never
   *   needs to duplicate that message. `err` propagates either a store failure OR a
   *   VALIDATION_ERROR surfaced by the port itself (e.g. an `--adhoc` task with no
   *   declared `ac_scope`) — the SAME error {@link appendEvidenceEntry}'s later
   *   existence check would produce from the SAME underlying traversal, just surfaced
   *   one call earlier: `resolveDeclaredAcCriteria`/`resolveDeclaredAcIds` (and their
   *   ad-hoc siblings) share ONE walk in `CorpusService`, so the two can never disagree.
   */
  private async resolveAcOracleGeneration(
    task: DocRecord,
    acRef: string,
  ): Promise<Result<number | null, LoreError>> {
    let criteria: AcceptanceCriterion[];
    if (task.extra["adhoc"] === true) {
      const criteriaResult = await this.resolveAdhocGoverningAcCriteria(task);
      if (!criteriaResult.ok) return criteriaResult;
      criteria = criteriaResult.value;
    } else {
      if (task.parent_id === null) return ok(null);
      const criteriaResult = await this.resolveDeclaredAcCriteria(task.parent_id);
      if (!criteriaResult.ok) return criteriaResult;
      criteria = criteriaResult.value ?? [];
    }
    const criterion = criteria.find((c) => c.id === acRef);
    if (criterion === undefined) return ok(null);
    return ok(resolveOracleGeneration(criterion.oracle_generation));
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

    // reason: task-two-concurrent-orchestrators-both-resolve-to-agent-main —
    // captured BEFORE resolveTask for the same reason the blank-worktree check is:
    // an unusable session id is an environment defect, not a doc-lookup concern,
    // and must persist nothing regardless of whether the target task exists.
    const sessionIdResult = resolveClaimSessionId(this.processEnv);
    if (!sessionIdResult.ok) return sessionIdResult;
    const sessionId = sessionIdResult.value;

    const taskResult = await this.resolveTask(idOrSlug);
    if (!taskResult.ok) return taskResult;
    const task = taskResult.value;

    const scopeResult = await this.resolveCorpusScope(opts);
    if (!scopeResult.ok) return scopeResult;
    const corpusScope = scopeResult.value;

    // reason: SPEC-042 D5 seam pinning — nowIso is resolved BEFORE the gate call
    // (was previously resolved AFTER) so the anchor-overlap predicate's sibling
    // staleness and this method's OWN existing-claim staleness check below share
    // the exact same "now", within one claim() call.
    const nowIso = now();

    const gateResult = await this.enforceClaimGate(task, opts, nowIso, sessionId);
    if (!gateResult.ok) return gateResult;

    const existingClaim = readClaim(task);
    const claimant = buildClaimParty(opts);
    let carryForward = false;
    let inheritedDirtyWorktree: string | undefined;

    if (existingClaim !== undefined) {
      // reason: BR-1058 — staleness reads the holder run's end and an `orphaned_dirty` mark, measured lazily
      // HERE (no sweep). A failed lookup fails the claim loud; it never degrades to "not stale".
      const staleResult = await this.isClaimEffectivelyStale(existingClaim, nowIso, new Map());
      if (!staleResult.ok) return staleResult;
      const stale = staleResult.value;
      // reason: spec-run-identity-slice-1 D6 / invariant I2 — the ONE conflict predicate lives in core
      // (`hasClaimConflict`); both claim paths call it, never `existingClaim.by === opts.by`.
      const holder = buildClaimHolder(task, existingClaim, stale);
      const decision = hasClaimConflict(holder, claimant);
      if (decision.kind === "conflict" && opts.steal !== true) {
        return err(buildClaimConflictError(task.id, existingClaim, holder, nowIso));
      }
      // reason: SPEC-042 D2 — carry-forward applies ONLY to a same-holder FRESH
      // refresh. A stale takeover (even by the SAME `by`) or a different holder
      // (first acquire, steal) starts fresh with no inherited branch/machine/
      // worktree — staleness deliberately breaks session continuity.
      carryForward = decision.kind === "refresh";
      // reason: D4 — a `--steal` of an orphaned_dirty claim inherits uncommitted work; the output must name it.
      if (decision.kind === "conflict") inheritedDirtyWorktree = existingClaim.orphaned_dirty?.worktree;
    }

    // reason: AC-OWN-2 auto-capture (spec-multi-session-concurrency-queryable-
    // ownership-checkout §Scope L0, GAP-C) — an explicit opts.branch always
    // wins outright, skipping detection entirely. When absent AND a worktree
    // IS explicitly named, measure THAT worktree's own current branch via the
    // injected git port (never process.cwd() — mirrors why --worktree itself
    // stays always-explicit, SPEC-042 D2 review U2). An unmeasurable branch
    // (detached HEAD, non-repo path, deleted worktree) leaves `capturedBranch`
    // undefined — NEVER coerced to a placeholder — so buildTaskClaim's
    // existing omission/carry-forward rules apply exactly as they already do
    // for machine/worktree. "Unmeasured" must never be written as though it
    // meant "unowned" (this task's own governing distinction, mirroring
    // gate-predicates.ts::compareClaimSessions's "not-measured" branch).
    let capturedBranch = opts.branch;
    if (capturedBranch === undefined && opts.worktree !== undefined) {
      const measurement = await this.detectBranch(opts.worktree);
      if (measurement.status === "measured") {
        capturedBranch = measurement.branch;
      }
    }

    const builtClaim: TaskClaim = buildTaskClaim(
      existingClaim,
      {
        by: opts.by,
        at: nowIso,
        ...(capturedBranch !== undefined ? { branch: capturedBranch } : {}),
        ...(opts.machine !== undefined ? { machine: opts.machine } : {}),
        ...(opts.worktree !== undefined ? { worktree: opts.worktree } : {}),
        // reason: the session instance is captured HERE, from the injected env —
        // never taken from `opts`, because no caller (CLI flag, MCP arg, HTTP
        // body) may declare which session it is. A self-declared session id
        // would be exactly the kind of opt-in, forgeable proxy this mechanism
        // replaces (task-two-concurrent-orchestrators-both-resolve-to-agent-main
        // §Opt-in). `buildTaskClaim` never carries it forward.
        ...(sessionId !== undefined ? { session_id: sessionId } : {}),
        ...(corpusScope !== undefined ? { corpus_scope: corpusScope } : {}),
        // reason: BR-1040/BR-1042 — a new claim ALWAYS stores the key (null when unattested); only a legacy
        // claim lacks it, and a legacy claim is never written here without being replaced by this one.
        harness_run: claimant.harnessRun,
      },
      carryForward,
    );
    const newClaim: TaskClaim =
      inheritedDirtyWorktree !== undefined
        ? { ...builtClaim, inherited_dirty_worktree: inheritedDirtyWorktree }
        : builtClaim;
    const newExtra: Record<string, unknown> = { ...task.extra, claim: newClaim };

    const previousHolderRun = existingClaim === undefined ? undefined : existingClaim.harness_run;
    const takeoverNote =
      existingClaim !== undefined &&
      (existingClaim.by !== opts.by || (previousHolderRun !== undefined && (previousHolderRun ?? null) !== claimant.harnessRun))
        ? ` (previous holder: ${existingClaim.by}${previousHolderRun === undefined ? "" : `, run ${describeClaimRun(previousHolderRun)}`}; claiming run ${describeClaimRun(claimant.harnessRun)})`
        : claimant.harnessRun !== null
          ? ` (run ${claimant.harnessRun})`
          : "";
    const inheritedNote = inheritedDirtyWorktree !== undefined ? `; inherited dirty worktree ${inheritedDirtyWorktree}` : "";
    const summary = `Claimed by ${opts.by}${takeoverNote}${inheritedNote}`;

    // reason: issue #106 / BR-961 — the worktree HEAD at claim time is the "base" that defines a
    // task's OWN commits (branch commits beyond it). Recorded on the claim AUDIT row (which survives
    // `lore release`, unlike `extra.claim`). An unmeasurable HEAD is left ABSENT: cleanup then reports
    // `not-measured`, never guesses a base.
    // `--worktree` is a path OR a branch name (the dispatch protocol passes `git branch --show-current`),
    // so the base is resolved by `resolveClaimHead`, never by `headSha` alone (issue #180 retry).
    const claimBaseResolved =
      opts.worktree !== undefined
        ? resolveClaimHead(this.worktreeProbe, opts.worktree, this.worktreeProbe.currentWorkingDirectory())
        : undefined;
    const claimBase =
      claimBaseResolved === undefined
        ? undefined
        : claimBaseResolved.ok
          ? ({ ok: true, value: claimBaseResolved.value.sha } as const)
          : claimBaseResolved;
    const writeResult = await this.writeTaskExtra(task, newExtra, nowIso, opts.by, summary, "claim", {
      by: opts.by,
      steal: opts.steal === true,
      ...(existingClaim !== undefined ? { previous_holder: existingClaim.by } : {}),
      ...(previousHolderRun !== undefined ? { previous_run: previousHolderRun } : {}),
      harness_run: claimant.harnessRun,
      ...(inheritedDirtyWorktree !== undefined ? { inherited_dirty_worktree: inheritedDirtyWorktree } : {}),
      ...(opts.worktree !== undefined ? { worktree: opts.worktree } : {}),
      ...(claimBase !== undefined && claimBase.ok ? { base_sha: claimBase.value } : {}),
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
    const postWriteGateResult = await this.enforceClaimGate(task, opts, nowIso, sessionId);
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

    // reason: AC-OWN-4 (spec-multi-session-concurrency-queryable-ownership-
    // checkout §Scope L0) — best-effort, ADVISORY side effect of a CONFIRMED
    // successful claim (never on the CLAIM_CONFLICT/rollback paths above, so
    // a claim that ultimately doesn't stick never binds a trailer). Only
    // attempted when BOTH a worktree AND a measured session_id are present —
    // no worktree means nowhere to bind; no measured session means nothing
    // honest to stamp (never a placeholder, same "unmeasured ≠ unowned"
    // discipline the branch capture above follows). Never awaited into this
    // method's own Result — see installClaimTrailerBinding's own JSDoc.
    if (opts.worktree !== undefined && sessionId !== undefined) {
      await this.installClaimTrailerBinding(opts.worktree, sessionId);
    }

    return writeResult;
  }

  /**
   * Validates `opts.corpusScope` (claim-scoped corpus authoring, AC-BLS2-8) and returns the
   * canonical branch slug to persist, or `undefined` when no scope was declared. Fails loud:
   * a scope without a worktree, an unresolvable doc, or a non-branch node persists nothing —
   * a silently-dropped scope would read as "claimed with authority" to the caller.
   */
  private async resolveCorpusScope(opts: ClaimOpts): Promise<Result<string | undefined, LoreError>> {
    if (opts.corpusScope === undefined) return ok(undefined);
    if (opts.worktree === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "corpus_scope",
        message:
          "--corpus-scope requires --worktree: corpus-authoring authority binds to the worktree " +
          "session that holds the lease, so a scope with no worktree has nothing to authorize",
        value: opts.corpusScope,
      });
    }
    const resolved = await resolveDoc(this.store, opts.corpusScope);
    if (!resolved.ok) return resolved;
    const doc = resolved.value;
    if (doc.type !== "baseline" || doc.extra["node"] !== "branch") {
      return err({
        code: "VALIDATION_ERROR",
        field: "corpus_scope",
        message:
          `--corpus-scope must name a baseline branch node; '${opts.corpusScope}' is ` +
          (doc.type === "baseline" ? `a baseline ${String(doc.extra["node"])}` : `a ${doc.type}`),
        value: opts.corpusScope,
      });
    }
    return ok(doc.slug);
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
    const releaser = buildClaimParty(opts);
    // reason: BR-1043 — stale=false: a stale holder still releases by its own identity; staleness only
    // unlocks takeover by a CLAIM. Only a `refresh` verdict (same run, or by-name for a legacy / fully
    // unattested pair) is the holder.
    const holder = buildClaimHolder(task, existingClaim, false);
    const isHolder = hasClaimConflict(holder, releaser).kind === "refresh";
    if (!isHolder && opts.force !== true) {
      return err(buildClaimConflictError(task.id, existingClaim, holder, nowIso));
    }

    // task-lore-evidence-and-lore-release-accept-an-attestation-from —
    // UNCONDITIONAL (unlike addEvidence's `result === "pass"` scope, release
    // carries no comparable field to scope on, and the doc's own framing
    // calls release the MORE dangerous of the two: it is what makes the
    // worktree eligible for the orchestrator's routine cleanup). Checked
    // AFTER the holder/force authorization gate above — an unauthorized
    // release attempt fails for THAT reason first.
    const worktreeError = this.checkUncommittedAttestationWorktree(task, "`lore release`", opts.callerCwd);
    if (worktreeError !== null) return err(worktreeError);

    const newExtra: Record<string, unknown> = { ...task.extra };
    delete newExtra["claim"];

    const heldRunNote = holder.legacy ? "" : `, run ${describeClaimRun(holder.harnessRun)}`;
    const forcedNote = !isHolder
      ? ` (forced, previous holder: ${existingClaim.by}${heldRunNote}; releasing run ${describeClaimRun(releaser.harnessRun)})`
      : "";
    const runNote = isHolder && releaser.harnessRun !== null ? ` (run ${releaser.harnessRun})` : "";
    const reasonNote = opts.reason !== undefined ? `: ${opts.reason}` : "";
    const summary = `Released by ${opts.by}${runNote}${forcedNote}${reasonNote}`;

    const writeResult = await this.writeTaskExtra(task, newExtra, nowIso, opts.by, summary, "release", {
      by: opts.by,
      force: opts.force === true,
      previous_holder: existingClaim.by,
      ...(holder.legacy ? {} : { previous_run: holder.harnessRun }),
      harness_run: releaser.harnessRun,
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    });

    // reason: AC-OWN-4 second defect (task-the-lore-session-trailer-is-inert-
    // whenever-core-hookspath) — best-effort, ADVISORY side effect of a
    // CONFIRMED successful release (never on the CLAIM_CONFLICT/no-claim/
    // worktree-guard error returns above, so a release that never actually
    // lands never clears a marker). Only attempted when the RELEASED claim
    // itself carried BOTH a worktree and a measured session_id — pass
    // `existingClaim.session_id` (the RELEASED claim's own captured session),
    // NEVER `opts.by`'s/the releasing caller's current session: a `--force`
    // release by a different actor must not unbind using the releaser's own
    // session (releaseClaimTrailerBinding's compare-and-delete makes a
    // mismatched id a safe no-op — see that function's own JSDoc). Never
    // awaited into this method's own Result — see releaseClaimTrailerBinding's
    // own JSDoc.
    if (writeResult.ok && existingClaim.worktree !== undefined && existingClaim.session_id !== undefined) {
      await this.releaseClaimTrailerBinding(existingClaim.worktree, existingClaim.session_id);
    }

    return writeResult;
  }

  // ── run end (spec-run-only-write-identity-and-run-end-claim-release D4/D5) ─

  /** See {@link resolveEffectiveClaimStaleness}; binds this service's store and TTL. */
  private isClaimEffectivelyStale(
    claim: TaskClaim,
    nowIso: string,
    endedRuns: Map<string, boolean>,
  ): Promise<Result<boolean, LoreError>> {
    return resolveEffectiveClaimStaleness(this.store, claim, nowIso, this.claimTtlMinutes, endedRuns);
  }

  /** Effective staleness of every claimed task in `tasks`, keyed by task id (see {@link isClaimEffectivelyStale}). */
  private async resolveClaimStalenessByTask(
    tasks: readonly DocRecord[],
    nowIso: string,
  ): Promise<Result<Map<DocId, boolean>, LoreError>> {
    return resolveEffectiveStalenessByDoc(this.store, tasks, nowIso, this.claimTtlMinutes);
  }

  /**
   * Ends every claim held by `runId` (BR-1057): a claim whose recorded worktree is MEASURED clean, or whose
   * worktree was never recorded / cannot be measured, is released (the audit row records the ENDING run and
   * `worktree: "not-measured"` when nothing was measured — never "clean"); a claim whose worktree has
   * uncommitted changes is KEPT and marked `orphaned_dirty`, naming that worktree. Idempotent: a claim
   * already marked `orphaned_dirty` is left as it is.
   *
   * @param runId - The ended run.
   * @param reason - The end reason, recorded in version history and on the audit row.
   * @returns One outcome per handled claim, ordered by task slug.
   */
  async endRunClaims(
    runId: RunId,
    reason: string,
    now: () => string = defaultNow,
  ): Promise<Result<RunEndClaimOutcome[], LoreError>> {
    const tasksResult = await this.store.findMany({ type: "task" });
    if (!tasksResult.ok) return tasksResult;
    const outcomes: RunEndClaimOutcome[] = [];
    const held = tasksResult.value
      .filter((t) => readClaim(t)?.harness_run === runId)
      .sort((a, b) => a.slug.localeCompare(b.slug));
    for (const task of held) {
      const claim = readClaim(task);
      if (claim === undefined || claim.orphaned_dirty !== undefined) continue;
      const nowIso = now();
      const cleanliness = measureWorktreeCleanliness(claim.worktree);
      if (cleanliness.status === "measured-dirty" && claim.worktree !== undefined) {
        const orphaned: TaskClaim = { ...claim, orphaned_dirty: { worktree: claim.worktree, at: nowIso } };
        const written = await this.writeTaskExtra(
          task,
          { ...task.extra, claim: orphaned },
          nowIso,
          claim.by,
          `Claim orphaned_dirty: run ${runId} ended (${reason}) with uncommitted changes in ${claim.worktree}`,
          "claim",
          {
            by: claim.by,
            orphaned_dirty: true,
            worktree: claim.worktree,
            dirty_paths: cleanliness.paths,
            harness_run: runId,
            reason,
          },
        );
        if (!written.ok) return written;
        outcomes.push({ task_slug: task.slug, action: "orphaned_dirty", worktree: claim.worktree });
        continue;
      }
      const measuredWorktree = cleanliness.status === "measured-clean" ? claim.worktree : undefined;
      const newExtra: Record<string, unknown> = { ...task.extra };
      delete newExtra["claim"];
      const worktreeNote = measuredWorktree ?? "not-measured";
      const written = await this.writeTaskExtra(
        task,
        newExtra,
        nowIso,
        claim.by,
        `Released by run end: run ${runId} ended (${reason}); worktree ${worktreeNote}`,
        "release",
        {
          by: claim.by,
          force: false,
          run_end: true,
          previous_holder: claim.by,
          previous_run: runId,
          // reason: BR-1043 — a run-end release records the ENDING run, which is the holder itself.
          harness_run: runId,
          reason,
          worktree: worktreeNote,
          ...(measuredWorktree === undefined ? { worktree_cleanliness: cleanliness.status } : {}),
        },
      );
      if (!written.ok) return written;
      if (claim.worktree !== undefined && claim.session_id !== undefined) {
        await this.releaseClaimTrailerBinding(claim.worktree, claim.session_id);
      }
      outcomes.push({ task_slug: task.slug, action: "released", worktree: worktreeNote });
    }
    return ok(outcomes);
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
   *   - the task holds no RUNNER-ATTESTED `result: "pass"` evidence entry — i.e. no
   *     entry with BOTH `result: "pass"` AND `attestation !== undefined`
   *     (adr-lore-done-requires-a-runner-attested-pass-the-sixth-false). `"expected-
   *     fail"` (M1), `"fail"`, and `"inconclusive"` never count, regardless of how many
   *     of them exist; a SELF-REPORTED-ONLY pass (`attestation === undefined` — the
   *     shape every CLI/MCP `lore evidence` write produces) does not count either. The
   *     refusal message names both repairs: `lore verify <plan>` (attests a pass), or
   *     `opts.overrideReason` (the audited escape hatch below, for verification `lore
   *     verify` structurally cannot perform). This floor bypasses via `overrideReason`
   *     ONLY — never via a red-first or unfiltered-file-run row, which are independent;
   *   - `opts.overrideReason` IS supplied but is blank/whitespace-only — refused here
   *     as a defense-in-depth check (`commands/done.ts` already refuses this shape as a
   *     CLI usage error, exit 2, before this service is ever called);
   *   - the task declares `extra.red_first: true` (task-red-first-discipline-is-asked-
   *     for-in-prose-but-never) and holds no `"expected-fail"`/`"fail"` evidence entry —
   *     a SECOND, INDEPENDENT floor evaluated only for a task claiming red-first
   *     discipline, checked AFTER the `result:pass` floor above so neither floor can
   *     mask the other; a task that never sets the flag never reaches this check;
   *   - the task has DECLARED `extra.ac_scope` (the KEY being present is the trigger —
   *     an EXPLICITLY EMPTY `[]` arms this floor exactly as a populated array does,
   *     task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed) but NEITHER
   *     `extra.red_first: true` NOR a `"expected-fail"`/`"fail"` evidence entry
   *     (task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the) — a FOURTH,
   *     INDEPENDENT floor: the red-first floor above INVERTED to opt-OUT for every task
   *     that never called `lore red-first`. Mutually exclusive with the red-first floor
   *     by construction (a task WITH `extra.red_first: true` is governed by that floor
   *     alone — see {@link requiresNoNewTestsDeclaration}'s own JSDoc), so neither floor
   *     can ever double-fire on the same task. Bypasses via `opts.noNewTestsReason` ONLY
   *     (the SAME audited-escape shape as `overrideReason` — mandatory, non-blank,
   *     persisted verbatim); a task with NO `ac_scope` key at all never reaches this
   *     check, and the refusal message distinguishes the empty declaration from a
   *     populated one rather than rendering an empty id list;
   *   - `opts.noNewTestsReason` IS supplied but is blank/whitespace-only — refused here
   *     as a defense-in-depth check (`commands/done.ts` already refuses this shape as a
   *     CLI usage error, exit 2, before this service is ever called);
   *   - a declared test-file anchor (task-every-ac-oracle-is-t-scoped-so-the-file-
   *     passes-is-attested) holds no `oracle:"test"` `result:"pass"` evidence entry
   *     whose command runs that exact file with no case-name filter — a FIFTH,
   *     INDEPENDENT floor checked AFTER the four above, naming every unsatisfied
   *     anchor; a task declaring no test-file anchors never reaches this check;
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
   * @param opts - `{ by, source?, overrideReason?, noNewTestsReason? }` — see {@link
   *   DoneOpts.overrideReason} for the audited attestation-floor escape hatch and
   *   {@link DoneOpts.noNewTestsReason} for the audited no-new-tests escape hatch
   * @param now - Time seam (D10) — ONE reading shared by every step's timestamp
   * @returns `DoneResult` — see that type's own JSDoc
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task / no runner-attested passing
   *   evidence and no (or a blank) `overrideReason` / a red_first claim with no red
   *   evidence row / a declared ac_scope with no red_first opt-in, no red evidence
   *   row, and no (or a blank) `noNewTestsReason` / an unsatisfied test-file-anchor
   *   unfiltered-run floor / fresh foreign claim / illegal lifecycle step — the last
   *   one structurally unreachable given `computeArchiveWalk`'s own base-graph-only
   *   steps, kept as a fail-loud guard rather than a non-null assertion), STALE_VERSION
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

  /**
   * The four `lore done` floors as DATA — the single copy (spec-approval-and-plan-
   * closure-go-through-the-same-checks-on D5, issue #47). Pure over `task` + its
   * evidence: no write, no claim read. Floor order is the contract: attested-pass,
   * red-first, no-new-tests, unfiltered-test-file; the first failing floor wins.
   *
   * `escapes` carries the audited override reasons: an absent one means "not
   * requested". A blank-but-present reason is a usage error returned as `err` (NOT a
   * floor refusal). The override branches live here only because they gate floors 1
   * and 3 mid-sequence; {@link checkDoneFloors} always passes `{}`, so it never reads
   * them.
   *
   * @returns `ok({refusal})` — the first failing floor with its exact LoreError
   *   (`details.floor` set) or `null`, plus the override reasons actually consumed;
   *   `err` only for a blank override reason
   */
  private evaluateDoneFloors(
    task: DocRecord,
    escapes: { overrideReason?: string; noNewTestsReason?: string },
  ): Result<
    {
      refusal: DoneFloorRefusal | null;
      overrideReason?: string;
      noNewTestsReason?: string;
    },
    LoreError
  > {
    const evidence = readEvidence(task);
    // ⛔ WHAT SATISFIES THIS FLOOR CHANGED 2026-08-23 (SPEC-143 AC-CT-2), and the
    // comment that used to sit below asserted the opposite — it called a self-report
    // "the ONLY shape any CLI/MCP `lore evidence` write can produce", which stopped
    // being true the moment `--capture` started writing the attestation it had always
    // measured. Two shapes now clear this floor:
    //   • `lore verify`            — `recordVerifiedEvidence`, an AC-DECLARED command
    //   • `lore evidence --capture`— `promoteCapturedAttestation`, an agent-CHOSEN command
    // Both really spawned something and observed a real exit code, which is what this
    // floor tests. They are NOT equally strong, and the difference is readable ON the
    // row rather than inferred: only a verify row can carry `first_seen` (command
    // provenance), `completeness`/`executed_files` (SPEC-061), and
    // `execution_root`/`execution_mode` (SPEC-063). A consumer that needs the stronger
    // class must test for those fields — never re-derive it from `capture_source`,
    // which both shapes set to `"runner"`.
    const hasAttestedPass = evidence.some((e) => e.result === "pass" && e.attestation !== undefined);
    let overrideReason: string | undefined;
    if (!hasAttestedPass) {
      // reason: adr-lore-done-requires-a-runner-attested-pass-the-sixth-false — a
      // self-reported result:pass is not sufficient to archive. `escapes.overrideReason`
      // is the ONE audited bypass — checked here, not before this branch, so a task
      // that already holds an attested pass never even looks at it (never "always
      // audit"). A zero-length trimmed reason is refused identically to an absent
      // one, never silently treated as "no override requested".
      if (escapes.overrideReason === undefined || escapes.overrideReason.trim() === "") {
        if (escapes.overrideReason !== undefined) {
          return err({
            code: "VALIDATION_ERROR",
            field: "overrideReason",
            message:
              "--override-attestation requires a non-empty, non-whitespace reason — " +
              "the CLI usage-error check (exit 2) should have caught this before " +
              "reaching the service; a direct caller must supply a real reason too",
            value: escapes.overrideReason,
          });
        }
        // reason: the message is built by ONE pure function over the SAME rows
        // this predicate just read (task-lore-done-s-attestation-refusal-calls-a-
        // capture-source). `code`/`field`/`value` are the predicate's identity and
        // stay here, unchanged and unreachable from the builder — a wording fix
        // must not be able to move the error a caller matches on. `value` keeps
        // the per-row `{result, attested}` pair so a programmatic caller never has
        // to parse prose for what the message states in words.
        return doneFloorRefusal("attested-pass", {
          code: "VALIDATION_ERROR",
          field: "extra.verification_evidence",
          message: buildAttestationFloorRefusal(task.slug, evidence),
          value: evidence.map((e) => ({ result: e.result, attested: e.attestation !== undefined })),
        });
      }
      overrideReason = escapes.overrideReason;
    }

    // reason: the red-first floor (task-red-first-discipline-is-asked-for-in-
    // prose-but-never) — mirrors the result:pass floor immediately above,
    // evaluated ONLY when the task itself claims red-first discipline. A task
    // that never sets extra.red_first is completely unaffected (this branch
    // never fires); a task that DOES set it needs BOTH floors independently —
    // this one is reached only after the pass floor above already succeeded,
    // so it can never mask (or be masked by) that check.
    if (readRedFirstDeclared(task) && !evidence.some((e) => isRedRunResult(e.result))) {
      return doneFloorRefusal("red-first", {
        code: "VALIDATION_ERROR",
        field: "extra.verification_evidence",
        message:
          `Task "${task.slug}" declares extra.red_first but holds no "expected-fail"/"fail" ` +
          `evidence entry — lore done requires proof the test was actually run red before ` +
          `archiving a red-first claim (record one via \`lore evidence ${task.slug} --oracle ` +
          `<kind> --command "<cmd>" --result expected-fail\`)`,
        value: evidence.map((e) => e.result),
      });
    }

    // reason: the no-new-tests floor (task-a-non-empty-output-tail-can-be-hand-
    // authored-prose-and-the) — the red-first floor's opt-IN behaviour, inverted
    // to opt-OUT for every task that never called `lore red-first`. Mutually
    // exclusive with the floor immediately above by construction (`readRedFirstDeclared`
    // gates both — see `requiresNoNewTestsDeclaration`'s own JSDoc), so this can
    // never mask or double-require against that one; AC6 control: a task that DID
    // opt in keeps working byte-identically, since this branch returns false for it.
    let noNewTestsReason: string | undefined;
    if (requiresNoNewTestsDeclaration(task, evidence)) {
      if (escapes.noNewTestsReason === undefined || escapes.noNewTestsReason.trim() === "") {
        if (escapes.noNewTestsReason !== undefined) {
          return err({
            code: "VALIDATION_ERROR",
            field: "noNewTestsReason",
            message:
              "--declare-no-new-tests requires a non-empty, non-whitespace reason — the CLI " +
              "usage-error check (exit 2) should have caught this before reaching the " +
              "service; a direct caller must supply a real reason too",
            value: escapes.noNewTestsReason,
          });
        }
        const acScope = extractDeclaredAcScope(task) ?? [];
        // reason: the EMPTY declaration needs its own rendering (task-the-ac-
        // scope-re-keying-left-the-red-first-floor-unarmed) — the id-list form
        // would print `extra.ac_scope ()`, which reads like a rendering bug and
        // tells the author nothing about which of the two shapes fired. The
        // empty branch also has to answer the reasonable objection ("I declared
        // no criterion, why am I being asked about ACs?") at the moment it is
        // raised, so the refusal itself carries the floor's actual question.
        const scopeClause =
          acScope.length === 0
            ? "declares an EMPTY extra.ac_scope ([] — an explicit \"no criterion claimed\", " +
              "which is a decision and not a silence)"
            : `declares extra.ac_scope (${acScope.join(", ")})`;
        return doneFloorRefusal("no-new-tests", {
          code: "VALIDATION_ERROR",
          field: "extra.verification_evidence",
          message:
            `Task "${task.slug}" ${scopeClause} with no ` +
            `"expected-fail"/"fail" evidence entry and no extra.red_first opt-in — lore done ` +
            "requires proof a test was actually run red before archiving, or an explicit " +
            "declaration that this task legitimately adds no new test (record a red run via " +
            `\`lore evidence ${task.slug} --oracle <kind> --command "<cmd>" --result ` +
            'expected-fail`, or use the audited `--declare-no-new-tests "<reason>"` escape hatch)',
          value: evidence.map((e) => e.result),
        });
      }
      noNewTestsReason = escapes.noNewTestsReason;
    }

    // reason: the unfiltered-test-file-run floor (task-every-ac-oracle-is-t-
    // scoped-so-the-file-passes-is-attested) — a THIRD, independent floor,
    // checked only after BOTH floors above already succeeded, so none of the
    // three can mask another. A task declaring no test-file anchors returns
    // [] here and never fires this branch.
    const missingUnfilteredRuns = findMissingUnfilteredTestFileRuns(task, evidence);
    if (missingUnfilteredRuns.length > 0) {
      return doneFloorRefusal("unfiltered-test-file", {
        code: "VALIDATION_ERROR",
        field: "extra.verification_evidence",
        message:
          `Task "${task.slug}" declares test-file anchor(s) with no attested UNFILTERED ` +
          `result:pass run: ${missingUnfilteredRuns.join(", ")} — lore done requires, for ` +
          `EACH declared test-file anchor, at least one oracle:test result:pass evidence ` +
          `row whose command runs that file with no ${UNFILTERED_RUN_CASE_FILTER_DESCRIPTION} ` +
          `case filter (record one via \`lore evidence ${task.slug} --oracle test --command ` +
          `"<unfiltered file command>" --result pass\`)`,
        value: missingUnfilteredRuns,
      });
    }

    return ok({
      refusal: null,
      ...(overrideReason !== undefined ? { overrideReason } : {}),
      ...(noNewTestsReason !== undefined ? { noNewTestsReason } : {}),
    });
  }

  /**
   * Which `lore done` floor, if any, refuses `taskIdOrSlug` right now — WITHOUT
   * archiving or writing anything and WITHOUT any override. `done()` returns this same
   * `error` unchanged, so a caller that must not archive past a floor (plan-close
   * cascade, archive sweep) sees exactly what `lore done` would say. An
   * already-terminal task has nothing to check: `null`.
   *
   * @param taskIdOrSlug - Task document ULID or slug
   * @returns `ok({floor, error})` first failing floor (`error.details.floor === floor`),
   *   `ok(null)` when every floor is met
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task)
   */
  async checkDoneFloors(taskIdOrSlug: string): Promise<Result<DoneFloorRefusal | null, LoreError>> {
    const taskResult = await this.resolveTask(taskIdOrSlug);
    if (!taskResult.ok) return taskResult;
    const task = taskResult.value;
    if (task.status === "archived" || task.status === "deprecated") return ok(null);
    const evaluated = this.evaluateDoneFloors(task, {});
    if (!evaluated.ok) return evaluated;
    return ok(evaluated.value.refusal);
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

    const evaluated = this.evaluateDoneFloors(task, {
      ...(opts.overrideReason !== undefined ? { overrideReason: opts.overrideReason } : {}),
      ...(opts.noNewTestsReason !== undefined ? { noNewTestsReason: opts.noNewTestsReason } : {}),
    });
    if (!evaluated.ok) return evaluated;
    if (evaluated.value.refusal !== null) return err(evaluated.value.refusal.error);
    const { overrideReason, noNewTestsReason } = evaluated.value;

    const nowIso = now();
    const claim = readClaim(task);
    if (claim !== undefined) {
      // reason: BR-1056 — the holder is a RUN, not a name: two runs deriving the same name must not pass for
      // one holder. Staleness is the run-aware BR-1058 form, so an ended run's clean claim does not block.
      const staleResult = await this.isClaimEffectivelyStale(claim, nowIso, new Map());
      if (!staleResult.ok) return staleResult;
      const holder = buildClaimHolder(task, claim, staleResult.value);
      if (hasClaimConflict(holder, buildClaimParty(opts)).kind === "conflict") {
        const runNote = holder.legacy ? "" : ` (run ${describeClaimRun(holder.harnessRun)})`;
        return err({
          code: "VALIDATION_ERROR",
          field: "extra.claim",
          message:
            `Task "${task.slug}" is held by a fresh claim from "${claim.by}"${runNote} — lore done ` +
            `refuses to archive a task out from under an active session`,
          value: claim.by,
        });
      }
    }

    // reason: issue #180 — record WHERE the task's commits are (claim base_sha .. worktree HEAD) so
    // `lore assess` does not depend on the slug appearing in a merge message. Measured here, after every
    // floor passed and BEFORE the archive walk and the worktree cleanup below (cleanup may remove the
    // worktree this reads). One git call (`rev-parse HEAD`); the base comes from the claim audit row.
    const rangeRecorded = await this.recordCommitRange(task, nowIso, opts.by);
    if (!rangeRecorded.ok) return rangeRecorded;
    task = rangeRecorded.value;

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
        {
          // reason: exactOptionalPropertyTypes — conditionally spread rather than
          // pass `undefined` verbatim, since `overrideReason`/`noNewTestsReason`
          // are locals typed `string | undefined` while writeTaskStatus's own
          // optional fields reject an explicit `undefined` under this tsconfig
          // (mirrors the pre-existing `additionalCwds`/`corpusRoot` spread
          // precedent in evidence-precheck.ts).
          ...(overrideReason !== undefined ? { overrideReason } : {}),
          ...(noNewTestsReason !== undefined ? { noNewTestsReason } : {}),
        },
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
    const planFact = planFactResult.value;

    const worktreeOutcomes = await this.cleanupRecordedWorktrees(task, opts.by, now(), opts.callerSession ?? null);

    // spec-archiving-the-work-that-resolves-a-defect-report-closes D1/D4 — post-commit, never fatal: the
    // walk above is already committed, the step returns lines rather than an error.
    // spec-completing-an-adopted-report-s-own-task-closes-its-github D1 — `lore done` is the ONLY caller of
    // `onTaskCompleted`: completing a report's own task is what closes its issue; other archive paths do not.
    const issueClose =
      this.archiveIssueClosePort === undefined
        ? undefined
        : [
            ...(await this.archiveIssueClosePort.onArchived(task, opts.by)),
            ...(await this.archiveIssueClosePort.onTaskCompleted(task, opts.by)),
          ];

    return ok({
      task,
      already_done: false,
      transitions,
      worktree_outcomes: worktreeOutcomes,
      ...(issueClose !== undefined ? { issue_close: issueClose } : {}),
      ...(planFact?.kind === "fully_terminal"
        ? { plan_now_fully_terminal: { plan_slug: planFact.plan_slug } }
        : {}),
      ...(planFact?.kind === "membership_disagreement"
        ? {
            plan_membership_disagreement: {
              plan_slug: planFact.plan_slug,
              parent_id_only_count: planFact.parent_id_only_count,
            },
          }
        : {}),
    });
  }

  /**
   * Measures and writes `extra.commit_range` (see `task-commit-range.ts`). Never refuses `done` on
   * a measurement problem — an unmeasurable range is RECORDED as `not-measured` with its reason, so
   * `lore assess` can tell "not measured" from "no commits"; only a failed store write is an error.
   * The worktree is the current claim's, else the latest one the claim audit history recorded
   * (a released claim drops `extra.claim` but its audit row survives).
   */
  private async recordCommitRange(task: DocRecord, nowIso: string, by: string): Promise<Result<DocRecord, LoreError>> {
    const notMeasured = (reason: string): TaskCommitRange => ({ state: "not-measured", reason, recorded_at: nowIso });
    let range: TaskCommitRange;
    const recordedResult = await this.readRecordedWorktrees(task);
    if (!recordedResult.ok) {
      range = notMeasured(`claim history unreadable: ${recordedResult.error.code}`);
    } else {
      const currentWorktree = readClaim(task)?.worktree;
      const recorded =
        recordedResult.value.find((r) => r.path === currentWorktree) ?? recordedResult.value[recordedResult.value.length - 1];
      if (recorded === undefined) {
        range = notMeasured("no claim recorded a worktree, so there is no HEAD to measure");
      } else {
        const head = resolveClaimHead(this.worktreeProbe, recorded.path, this.worktreeProbe.currentWorkingDirectory());
        range = head.ok
          ? {
              state: "recorded",
              head: head.value.sha,
              head_source: head.value.source,
              ...(recorded.baseSha !== undefined ? { base: recorded.baseSha } : {}),
              worktree: recorded.path,
              recorded_at: nowIso,
            }
          : notMeasured(`worktree/branch ${recorded.path} HEAD unreadable: ${head.reason}`);
      }
    }
    return this.writeTaskExtra(
      task,
      { ...task.extra, commit_range: range },
      nowIso,
      by,
      range.state === "recorded"
        ? `lore done: recorded commit range ${range.base === undefined ? "(head only)" : range.base.slice(0, 12)}..${range.head.slice(0, 12)}`
        : `lore done: commit range not measured (${range.reason})`,
      "update",
      { by, commit_range: range },
    );
  }

  // ── Worktree cleanup (issue #106, BR-961 / BR-962) ──────────────────────────

  /**
   * Normalized paths recorded by the CURRENT claim of every task that is not yet terminal. A worktree
   * still named by such a claim belongs to live work (one orchestrator worktree is routinely claimed by
   * several sequential tasks), so cleanup of an archived sibling must never remove it.
   */
  private async collectActiveClaimedPaths(): Promise<Result<Set<string>, LoreError>> {
    const tasksResult = await this.store.findMany({ type: "task" });
    if (!tasksResult.ok) return tasksResult;
    const paths: string[] = [];
    for (const candidate of tasksResult.value) {
      if (candidate.status === "archived" || candidate.status === "deprecated") continue;
      const worktree = readClaim(candidate)?.worktree;
      if (worktree !== undefined) paths.push(worktree);
    }
    return ok(buildActiveClaimedPathSet(this.worktreeProbe, paths));
  }

  /** Worktrees `task`'s claims recorded (claim audit history, which survives release, + current claim). */
  private async readRecordedWorktrees(task: DocRecord): Promise<Result<RecordedWorktree[], LoreError>> {
    const auditResult = await this.store.queryAudit({ doc_id: task.id, action: "claim" });
    if (!auditResult.ok) return auditResult;
    return ok(collectRecordedWorktrees(auditResult.value, readClaim(task)?.worktree));
  }

  private async recordWorktreeCleanupAudit(
    task: DocRecord,
    by: string,
    nowIso: string,
    trigger: "done",
    outcomes: readonly WorktreeOutcome[],
  ): Promise<Result<void, LoreError>> {
    return this.store.appendAuditEntry({
      timestamp: nowIso,
      actor: by,
      session_id: `${trigger}-${task.id}`,
      action: "worktree-cleanup",
      doc_id: task.id,
      details: { by, trigger, worktree_cleanup: outcomes.map((o) => ({ ...o })) },
    });
  }

  /**
   * `done()`'s cleanup pass — runs AFTER the archive walk committed, so it can never fail archival: every
   * failure becomes a `not-measured` outcome the caller prints. Evaluates each recorded worktree
   * (BR-961 predicate), removes the `remove` ones, and stores the outcomes in one audit row
   * (`action: "worktree-cleanup"`, `trigger: "done"`).
   */
  private async cleanupRecordedWorktrees(
    task: DocRecord,
    by: string,
    nowIso: string,
    callerSession: string | null,
  ): Promise<WorktreeOutcome[]> {
    const unmeasurable = (reason: string): WorktreeOutcome[] => [
      { worktree: "(recorded worktrees)", decision: "not-measured", reason },
    ];
    const recordedResult = await this.readRecordedWorktrees(task);
    if (!recordedResult.ok) return unmeasurable(`claim history unreadable: ${recordedResult.error.code}`);
    if (recordedResult.value.length === 0) return [];

    const removal = this.worktreeRemoval;
    if (removal === undefined) {
      return recordedResult.value.map((r) => ({
        worktree: r.path,
        decision: "not-measured" as const,
        reason: "worktree-removal test not wired into this TaskWorkflowService",
      }));
    }
    const activeResult = await this.collectActiveClaimedPaths();
    if (!activeResult.ok) return unmeasurable(`active-claim scan failed: ${activeResult.error.code}`);

    const outcomes: WorktreeOutcome[] = [];
    for (const recorded of recordedResult.value) {
      const evaluation = await evaluateRecordedWorktree(this.worktreeProbe, removal, recorded, {
        callerSession,
        activeClaimedPaths: activeResult.value,
      });
      outcomes.push(applyWorktreeRemoval(this.worktreeProbe, evaluation));
    }
    const auditResult = await this.recordWorktreeCleanupAudit(task, by, nowIso, "done", outcomes);
    if (!auditResult.ok) {
      outcomes.push({ worktree: "(audit)", decision: "not-measured", reason: `cleanup outcome not audited: ${auditResult.error.code}` });
    }
    return outcomes;
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

  // ── Red-First Declaration (task-red-first-discipline-is-asked-for-in-prose-but-never) ──

  /**
   * Declares that `idOrSlug`'s tests were written RED FIRST — sets
   * `extra.red_first: true`. `done()` (see its own JSDoc) then demands ≥1
   * `"expected-fail"`/`"fail"` evidence row on this task, ALONGSIDE the
   * pre-existing `result: "pass"` floor, before it may archive.
   *
   * This is the ONLY writer for `extra.red_first` — deliberately no
   * create-time `lore create task --red-first` flag (the claim is typically
   * made AFTER a task already exists, once its tests are actually written —
   * exactly the ordering `lore red-first <task>` supports) and deliberately
   * no `lore set --red-first` (wholesale `extra` replace, the same reason
   * `file_anchors`/`ac_scope`/`claim`/`verification_evidence` each have a
   * dedicated writer instead).
   *
   * Read-modify-write via {@link writeTaskExtra} — every sibling `extra` key
   * (`claim`/`verification_evidence`/`ac_scope`/`file_anchors`) survives
   * byte-identical. Idempotent: declaring on an already-`true` task is a
   * normal successful write (still `red_first: true`, one more version/audit
   * row), never an error.
   *
   * @param idOrSlug - Task document ULID or slug
   * @param opts - `{ by, source? }`
   * @param now - Time seam (D10)
   * @returns The updated task DocRecord
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a task), STALE_VERSION
   */
  async declareRedFirst(
    idOrSlug: string,
    opts: AnchorMutationOpts,
    now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    const taskResult = await this.resolveTask(idOrSlug);
    if (!taskResult.ok) return taskResult;
    const task = taskResult.value;

    const nowIso = now();
    const newExtra: Record<string, unknown> = { ...task.extra, red_first: true };
    return this.writeTaskExtra(
      task,
      newExtra,
      nowIso,
      opts.by,
      `Declared red-first test discipline by ${opts.by}`,
      "update",
      { by: opts.by, red_first: true },
    );
  }

  // ── ready ────────────────────────────────────────────────────────────────

  /**
   * Computed readiness report for every task BELONGING to a plan. Zero writes (D3).
   *
   * Fetches: (1) the plan's parent doc, once, to derive the SPEC-032 §3.4
   * `upstream_unapproved` advisory (non-null iff the parent is a `spec`), (2) every
   * `type: "task"` doc corpus-wide, narrowed client-side to this plan's members via
   * `isPlanMember` (`extra.plan_id === plan.id` — the DECLARED property; `parent_id`
   * is a proxy `--parent` may deliberately diverge from, SPEC-065 D4, and a
   * `parent_id`-keyed query silently drops a diverged member from its own plan —
   * task-plan-membership-is-extra-plan-id-but-the-last-task. The store has no
   * extra-field filter, so this is corpus-wide + client-side, the SAME shape the
   * blocker-status lookup below already uses), (3) `blocks`-type links targeting
   * those tasks in one batch query (D7), (4) statuses/slugs for the referenced
   * blocker docs — then delegates to the pure `evaluateReadiness`. SPEC-042 D7
   * additionally derives `sessions` (this plan's FRESH claims grouped by
   * `deriveSessions`) and `anchor_conflicts` (fresh, foreign, anchor-overlapping
   * sibling pairs) — both PLAN-SCOPED, zero extra store IO (reuses the SAME `tasks`
   * array already fetched below).
   *
   * task-a-mistyped-task-file-anchor-is-stored-and-consulted additionally derives
   * `anchor_resolution` — every declared anchor across this plan's tasks that does
   * not resolve on the working tree — but ONLY when the caller injects an
   * `anchorProbe`; without one the field says `{probed: false}` rather than
   * pretending a clean scan. That advisory is the DISPATCHER's read of the same
   * fact the write-time CLI/MCP advisory shows the anchor's author.
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param now - Time seam (D10) — drives claim staleness computation
   * @param anchorProbe - OPTIONAL filesystem port + root, injected PER CALL by the
   *   adapter (the SAME placement `DriftCheckService.checkDrift`'s `probe`
   *   argument uses — this service must never construct one, it holds no fs seam).
   *   Omitted ⇒ `anchor_resolution` is `{probed: false, reason: "no-fs-probe"}`;
   *   an absent probe is REPORTED, never silently rendered as "nothing found".
   * @returns `ReadyReport` — `{records, sessions, anchor_conflicts,
   *   anchor_resolution}` (see that type's JSDoc for why the pre-SPEC-042 flat
   *   array became `.records`)
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a plan)
   */
  async ready(
    planIdOrSlug: string,
    now: () => string = defaultNow,
    anchorProbe?: FileAnchorProbeContext,
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

    // reason: task-plan-membership-is-extra-plan-id-but-the-last-task — plan
    // membership is `extra.plan_id`, not `parent_id` (see `isPlanMember`'s JSDoc).
    // `findMany` has no extra-field filter, so this is a corpus-wide `type: "task"`
    // scan narrowed client-side, rather than a `parent_id`-filtered store query.
    const allTasksResult = await this.store.findMany({ type: "task" });
    if (!allTasksResult.ok) return allTasksResult;

    const nowIso = now();
    // reason: task-a-task-cannot-be-retracted-supersedes-emits-a-repair AC3 —
    // a retracted (validity-invalidated) task is excluded from readiness
    // entirely, mirroring CorpusService.list()/search()'s D3 default
    // exclusion. `isInvalidated` is a type-agnostic pure predicate (never a
    // no-op check on `doc.type`) that reads false for every task that was
    // never invalidated, so this filter is a byte-identical no-op for every
    // pre-existing plan.
    const tasks = allTasksResult.value.filter(
      (t) => isPlanMember(t, plan.id) && !isInvalidated(t, nowIso),
    );

    if (tasks.length === 0) {
      return ok({
        records: [],
        counts: computeReadyCounts([]),
        sessions: [],
        anchor_conflicts: [],
        // reason: a task-less plan declares no anchors, so a supplied probe
        // legitimately found nothing — that is a PROBED empty result, distinct
        // from the no-probe case, which must still say so.
        anchor_resolution: this.computeAnchorResolution([], anchorProbe),
      });
    }

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

    const staleByTask = await this.resolveClaimStalenessByTask(tasks, nowIso);
    if (!staleByTask.ok) return staleByTask;
    const records = applyEffectiveClaimStaleness(
      evaluateReadiness(
        tasks,
        blocksLinks,
        blockerStatuses,
        nowIso,
        this.claimTtlMinutes,
        parentSpecStatus,
      ),
      staleByTask.value,
    );

    const { anchorConflicts, anchorlessSlugs } = this.computeAnchorAdvisories(tasks, nowIso, staleByTask.value);
    const recordsWithAnchorless = records.map((r) =>
      anchorlessSlugs.has(r.task.slug) ? { ...r, anchorless: true } : r,
    );

    return ok({
      records: recordsWithAnchorless,
      counts: computeReadyCounts(recordsWithAnchorless),
      sessions: deriveSessions(tasks, nowIso, this.claimTtlMinutes, staleByTask.value),
      anchor_conflicts: anchorConflicts,
      anchor_resolution: this.computeAnchorResolution(tasks, anchorProbe),
    });
  }

  /**
   * Derives {@link ReadyReport.anchor_resolution} over a plan's tasks
   * (task-a-mistyped-task-file-anchor-is-stored-and-consulted, Required #2).
   *
   * Probes the UNION of every task's declared anchors exactly once (dedup lives in
   * `collectFileAnchorResolution`), then re-attributes each finding to every task
   * that declared it — two tasks anchoring the same missing path each get their own
   * row, because the dispatcher's question is per-task, while the filesystem
   * question is per-path.
   *
   * ⛔ Reports on EVERY task's anchors, not only claimed ones: the whole point is to
   * be read BEFORE concurrent work is assigned, and a claim is exactly what has not
   * happened yet at that moment.
   *
   * @param tasks - This plan's member tasks, already fetched by `ready()` (zero
   *   extra store IO — same discipline as `computeAnchorAdvisories`).
   * @param anchorProbe - Injected port; `undefined` ⇒ an explicit unprobed report.
   * @returns The discriminated {@link ReadyAnchorResolution}.
   */
  private computeAnchorResolution(
    tasks: DocRecord[],
    anchorProbe: FileAnchorProbeContext | undefined,
  ): ReadyAnchorResolution {
    if (anchorProbe === undefined) return unprobedFileAnchors("no-fs-probe");

    const declaredByTask = tasks.map((task) => ({ task, anchors: extractFileAnchors(task) }));
    const distinctAnchors = [...new Set(declaredByTask.flatMap((entry) => entry.anchors))];
    const collected = collectFileAnchorResolution(distinctAnchors, anchorProbe);
    const findingByAnchor = new Map<string, NonResolvingFileAnchor>(
      collected.unresolved.map((row) => [row.anchor, row]),
    );

    const unresolved: TaskAnchorNonResolution[] = [];
    for (const { task, anchors } of declaredByTask) {
      for (const anchor of anchors) {
        const finding = findingByAnchor.get(anchor);
        if (finding !== undefined) unresolved.push({ task_slug: task.slug, ...finding });
      }
    }

    return { probed: true, root: collected.root, unresolved };
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
   * A retracted (validity-invalidated) task is excluded here too, same as
   * `ready(plan)` — task-a-task-cannot-be-retracted-supersedes-emits-a-repair
   * AC3.
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
    const nowIso = now();
    const openAdhocTasks = tasksResult.value.filter((t) => {
      // reason: task-a-task-cannot-be-retracted-supersedes-emits-a-repair
      // AC3 — a retracted ad-hoc task is excluded here too, same rationale
      // as ready()'s identical filter above.
      if (isInvalidated(t, nowIso)) return false;
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

    const staleByTask = await this.resolveClaimStalenessByTask(openAdhocTasks, nowIso);
    if (!staleByTask.ok) return staleByTask;
    const records = applyEffectiveClaimStaleness(
      evaluateReadiness(
        openAdhocTasks,
        blocksLinks,
        blockerStatuses,
        nowIso,
        this.claimTtlMinutes,
        null,
      ),
      staleByTask.value,
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
   * `tasks` holding a FRESH claim in a DIFFERENT SESSION (a different actor, or
   * the same actor in a provably-different / unmeasurable session — see
   * `compareClaimSessions`) whose anchors overlap.
   *
   * The session dimension is here, and not just in the gate, because this report
   * and the `task-claim` gate must never disagree: an advisory that printed "no
   * conflicts" while `lore claim` refused the very same pair would train
   * operators to distrust the refusal
   * (task-two-concurrent-orchestrators-both-resolve-to-agent-main). It reuses
   * `compareClaimSessions` (`gate-predicates.ts`) rather than re-comparing the
   * ids inline, so the two surfaces share ONE definition of "same session".
   *
   * `anchorless`: the SET of task slugs that hold a FRESH claim, declare NO
   * anchors themselves, while at least one OTHER task in `tasks` declares
   * non-empty anchors (D7, review U7 — silent on zero-adoption plans).
   */
  private computeAnchorAdvisories(
    tasks: DocRecord[],
    nowIso: string,
    staleByTask: ReadonlyMap<DocId, boolean>,
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
          if (staleByTask.get(other.id) ?? isClaimStale(otherClaim, nowIso, this.claimTtlMinutes)) continue;
          // reason: BR-1056 — same holder means same RUN. Two runs that share a derived name are TWO holders and
          // stay reported; only legacy / both-unattested claims fall back to the name (`hasClaimConflict`).
          const sameHolder =
            taskClaim !== undefined &&
            hasClaimConflict(
              buildClaimHolder(other, otherClaim, false),
              buildClaimParty({ by: taskClaim.by, harnessRun: (taskClaim.harness_run ?? null) as RunId | null }),
            ).kind === "refresh";
          if (sameHolder && taskClaim !== undefined && (taskClaim.harness_run ?? null) !== null) continue;
          const sameActor = sameHolder;
          const sessionVerdict = sameActor
            ? compareClaimSessions(taskClaim.session_id, otherClaim.session_id)
            : undefined;
          // reason: a shared actor string alone no longer clears the overlap —
          // only a PROVEN shared session does. `sameActor` with a
          // different/unmeasured session is reported, matching what the
          // `task-claim` gate would refuse for the same pair.
          if (sessionVerdict === "same-session") continue;
          const otherAnchors = extractFileAnchors(other);
          if (otherAnchors.length === 0) continue;
          const overlap = anchorsOverlap(taskAnchors, otherAnchors);
          if (overlap.overlaps) {
            anchorConflicts.push({
              task_slug: task.slug,
              holder: otherClaim.by,
              paths: overlap.pairs.map(([a]) => a),
              ...(sessionVerdict !== undefined ? { session_verdict: sessionVerdict } : {}),
            });
          }
        }
      }

      if (
        anyoneDeclaresAnchors &&
        taskAnchors.length === 0 &&
        taskClaim !== undefined &&
        !(staleByTask.get(task.id) ?? isClaimStale(taskClaim, nowIso, this.claimTtlMinutes))
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
   * Shared enforcement point for the uncommitted-worktree attestation guard
   * (task-lore-evidence-and-lore-release-accept-an-attestation-from) — see
   * the module section header above `WorktreeCleanlinessStatus` for the full
   * three-question review. Called from BOTH `_addEvidenceImpl` (self-reported
   * `result: "pass"` only) and `_releaseImpl` (unconditionally — the doc's
   * own framing: release is the MORE dangerous of the two, since it is what
   * makes the worktree eligible for cleanup).
   *
   * @param task - The already-resolved task DocRecord (never re-reads the
   *   store — callers already hold it from their own `resolveTask` call).
   * @param actionLabel - Rendered verbatim into the refusal message (e.g.
   *   `` `lore evidence --result pass` `` / `` `lore release` ``) so the two
   *   call sites never drift on wording independently.
   * @param callerCwd - See {@link ReleaseOpts.callerCwd} — `undefined` skips
   *   ONLY the Q3 mismatch escalation, never the primary predicate.
   * @returns `null` when the call may proceed (no claim at all; measured-
   *   clean; not-measured, either variant, per AC-3's "no fabricated
   *   refusal" control); a `VALIDATION_ERROR` `LoreError` otherwise.
   */
  private checkUncommittedAttestationWorktree(
    task: DocRecord,
    actionLabel: string,
    callerCwd: string | undefined,
  ): LoreError | null {
    const claim = readClaim(task);
    const worktree = claim?.worktree;

    if (worktree === undefined) {
      // reason: task-the-uncommitted-worktree-guard-treats-no-claim-at-all-
      // as-a — `claim?.worktree === undefined` is ALSO true when there is no
      // claim at all (never claimed, or already released). Check the RAW
      // claim presence FIRST: with nothing recorded, there is nothing to
      // measure and nothing to escalate — this is the fix, not a proxy for
      // it (hasRecordedClaim reads task.extra.claim directly, never through
      // readClaim's schema-validated result, so a malformed claim object
      // still counts as "recorded" here rather than re-collapsing into
      // no-claim).
      if (!hasRecordedClaim(task)) {
        return null;
      }
      // reason: Q3 opt-in-hole close — a claim that DOES exist but recorded
      // NO worktree bypasses the primary predicate entirely (nothing to
      // measure). Rather than a silent pass-through, escalate ONLY when this
      // call is demonstrably running from inside a real git repository
      // (callerCwd supplied AND it resolves as one) — that combination means
      // --worktree was simply never passed at claim time, not that this
      // corpus/session has nothing to do with git at all.
      if (callerCwd !== undefined && isInsideGitRepo(callerCwd)) {
        return buildNoWorktreeMismatchRefusal({ actionLabel, taskSlug: task.slug, callerCwd });
      }
      return null;
    }

    const check = measureWorktreeCleanliness(worktree);
    if (check.status !== "measured-dirty") return null;

    const ranked = rankDirtyPathsByAnchors(check.paths, extractFileAnchors(task));
    return buildUncommittedWorktreeRefusal({ actionLabel, taskSlug: task.slug, worktree, rankedPaths: ranked });
  }

  /**
   * Computes DD-2's `DoneResult.plan_now_fully_terminal`/`plan_membership_disagreement`
   * facts (spec-plan-closure-must-be-loud-terminality-divergence-silent, AC-CLOSURE-3;
   * membership fixed by task-plan-membership-is-extra-plan-id-but-the-last-task) — a
   * READ-ONLY check, never a write: `done()`'s own Invariant 1 forbids this service from
   * touching the plan document. Returns `ok(undefined)` for every case that does not
   * warrant either fact: `archivedTask.parent_id === null`, a parent that fails to
   * resolve or is not `type: "plan"` (adhoc tasks auto-parent to the root PRD —
   * `CorpusService._createImpl`'s adhoc block), a plan that is ALREADY terminal
   * (nothing left to announce), or a plan with ≥1 still-non-terminal REAL member.
   *
   * Plan membership is `extra.plan_id` (the DECLARED property `isPlanMember` reads),
   * NOT `parent_id` (a proxy `--parent` may deliberately diverge from, SPEC-065 D4) —
   * see `isPlanMember`'s own JSDoc. Because the store has no extra-field filter, this
   * reads every `type: "task"` doc corpus-wide and filters client-side (same "one
   * unfiltered findMany + client-side pick" shape `ready()`'s blocker-status lookup
   * already uses at the real plan sizes §8.3's rationale targets).
   *
   * Q2 (ADR proxy/silence/opt-in review): an EMPTY property-based member set must not
   * silently read the same as "nothing to report" when the retired `parent_id`-keyed
   * query would have found members — that is a contradiction, not a quiet non-event.
   * This is detected and reported as `{kind: "membership_disagreement", ...}`, a value
   * distinct from `ok(undefined)`, NEVER resolved by unioning the two member sets (a
   * union would re-admit the exact misattribution this fix removes).
   *
   * @param archivedTask - The task DocRecord AFTER `_doneImpl`'s walk wrote it to
   *   `"archived"` — its `parent_id` is unchanged by that walk (only `status`/
   *   `version`/`updated_at` are touched), so this reads that same field.
   * @returns `ok({kind: "fully_terminal", plan_slug})` when every REAL member of the
   *   parent plan is now terminal and the plan itself is not; `ok({kind:
   *   "membership_disagreement", plan_slug, parent_id_only_count})` when the property-
   *   based member set is empty but the proxy-based one is not; `ok(undefined)`
   *   otherwise; `err(...)` only on a genuine store failure reading the parent or
   *   corpus-wide tasks (propagated, not swallowed — a store error here must not
   *   silently masquerade as "no advisory").
   */
  private async computePlanNowFullyTerminal(
    archivedTask: DocRecord,
  ): Promise<Result<PlanTerminalityFact | undefined, LoreError>> {
    if (archivedTask.parent_id === null) return ok(undefined);

    const parentResult = await this.store.find(archivedTask.parent_id);
    if (!parentResult.ok) return parentResult;
    const plan = parentResult.value;
    if (plan === null || plan.type !== "plan") return ok(undefined);
    if (isTerminalStatus(plan.status)) return ok(undefined);

    const allTasksResult = await this.store.findMany({ type: "task" });
    if (!allTasksResult.ok) return allTasksResult;
    const allTasks = allTasksResult.value;

    const members = allTasks.filter((t) => isPlanMember(t, plan.id));

    if (members.length === 0) {
      const parentIdOnlyCount = allTasks.filter(
        (t) => t.parent_id === plan.id && !isPlanMember(t, plan.id),
      ).length;
      if (parentIdOnlyCount > 0) {
        return ok({
          kind: "membership_disagreement",
          plan_slug: plan.slug,
          parent_id_only_count: parentIdOnlyCount,
        });
      }
      return ok(undefined);
    }

    const allTerminal = members.every((t) => isTerminalStatus(t.status));
    if (!allTerminal) return ok(undefined);

    return ok({ kind: "fully_terminal", plan_slug: plan.slug });
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
   * @param candidateSessionId - The session instance `_claimImpl` captured for
   *   this claim (task-two-concurrent-orchestrators-both-resolve-to-agent-main).
   *   Threaded rather than re-captured so the PRE-write check, the claim record
   *   actually written, and the POST-write TOCTOU re-check all reason about ONE
   *   captured value — a second capture could disagree with the persisted claim.
   *   `undefined` ⇒ not measured, which makes a same-actor overlap a refusal.
   */
  private async enforceClaimGate(
    task: DocRecord,
    opts: ClaimOpts,
    nowIso: string,
    candidateSessionId: string | undefined,
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
      ctx = {
        ...buildUpstreamSpecContext(undefined),
        candidateBy: by,
        candidateAnchors: extractFileAnchors(task),
        siblingClaims: [],
        ...(candidateSessionId !== undefined ? { candidateSessionId } : {}),
      };
    } else {
      const bundleResult = await this.gate.getPlanBundle(task.parent_id);
      if (!bundleResult.ok) {
        if (!isNonPlanParentError(bundleResult.error)) return bundleResult;
        const siblingsResult = await this.findAdhocSiblingTasks();
        if (!siblingsResult.ok) return siblingsResult;
        const anchorCtx = await applyEffectiveSiblingStaleness(
          this.store,
          buildAnchorGateContext(by, task, siblingsResult.value, nowIso, this.claimTtlMinutes, candidateSessionId),
          siblingsResult.value,
          nowIso,
          this.claimTtlMinutes,
        );
        if (!anchorCtx.ok) return anchorCtx;
        ctx = { ...buildUpstreamSpecContext(undefined), ...anchorCtx.value };
      } else {
        const anchorCtx = await applyEffectiveSiblingStaleness(
          this.store,
          buildAnchorGateContext(by, task, bundleResult.value.tasks, nowIso, this.claimTtlMinutes, candidateSessionId),
          bundleResult.value.tasks,
          nowIso,
          this.claimTtlMinutes,
        );
        if (!anchorCtx.ok) return anchorCtx;
        ctx = { ...buildUpstreamSpecContext(bundleResult.value.spec), ...anchorCtx.value };
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
      // reason: BR-1056 — the gate's overlap test compares holders by RUN; passed explicitly, never ambient.
      candidateRun: opts.harnessRun ?? null,
      ...(opts.identitySource !== undefined ? { candidateIdentitySource: opts.identitySource } : {}),
      ...(opts.worktree !== undefined ? { candidateWorktree: opts.worktree } : {}),
      ...(opts.machine !== undefined ? { candidateMachine: opts.machine } : {}),
      // reason: AC-FR-8/D7 (task-derive-lore-feed-s-checkpoint-set-from-the-
      // registry-make) — `task.id` is the RESOLVED task doc's real id, threaded
      // ONLY for `GateEnforcer.enforce`'s own `gate_passed` audit `doc_id` (never
      // read by `checkTaskClaim`/`feedTaskClaim`; see `GateContext.targetDocId`).
      targetDocId: task.id,
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
   *
   * `escapes.overrideReason` (adr-lore-done-requires-a-runner-attested-pass-the-sixth-
   * false) — present iff this `done()` call used the audited attestation-floor escape
   * hatch; merged verbatim onto EVERY step's audit `details` this call produces as
   * `override_reason` + `attestation_overridden: true`, so a multi-step walk
   * (draft -> approved -> active -> archived) leaves the justification attached to
   * each individual audited step, not just the first. `undefined` (the common case —
   * an attested pass already satisfied the floor) adds neither key.
   *
   * `escapes.noNewTestsReason` (task-a-non-empty-output-tail-can-be-hand-authored-
   * prose-and-the) — the SAME per-step, every-step persistence, independent of
   * `overrideReason` (a walk can carry both, either, or neither key set, since the
   * two floors are evaluated independently in `_doneImpl`): present iff this call
   * used the audited no-new-tests escape hatch, merged onto every step's audit
   * `details` as `no_new_tests_reason` + `no_new_tests_declared: true`. `undefined`
   * (the common case — no `ac_scope` KEY at all, an opted-in red_first claim, or a
   * genuine red evidence row already satisfied the floor) adds neither key.
   */
  private async writeTaskStatus(
    task: DocRecord,
    newStatus: DocStatus,
    nowIso: string,
    actor: string,
    changeSummary: string,
    escapes: { overrideReason?: string; noNewTestsReason?: string } = {},
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
        ...(escapes.overrideReason !== undefined
          ? { override_reason: escapes.overrideReason, attestation_overridden: true }
          : {}),
        ...(escapes.noNewTestsReason !== undefined
          ? { no_new_tests_reason: escapes.noNewTestsReason, no_new_tests_declared: true }
          : {}),
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
