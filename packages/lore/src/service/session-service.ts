/**
 * SessionService — SPEC-041 S1 (bootstrap pointer-set) + S2 (lossless handoff) + resume
 * + L0 ownership read surfaces (spec-multi-session-concurrency-queryable-ownership-checkout
 * §Scope L0, AC-OWN-1/AC-OWN-5).
 *
 * Public surface:
 *   bootstrap(by, now?)       → BootstrapReport — the volatile session pointer-set
 *                                (plans, claims, queue, gates, handoffs). READ-ONLY.
 *   writeHandoff(input, now?) → creates a `knowledge`/`handoff` doc via the injected
 *                                `createHandoffDoc` port; four-way parent resolution.
 *   resume(opts, now?)        → ResumeResult — newest-wins or direct handoff targeting,
 *                                age/TTL warning, multi-actor surfacing. READ-ONLY.
 *   getActiveSessions(now?)   → ReadySession[] — the SAME corpus-wide derivation
 *                                `bootstrap`'s `active_sessions` uses, exposed as its
 *                                OWN query (`lore territory`/`lore session list|show`
 *                                consume it without paying for `bootstrap`'s unrelated
 *                                assembly). READ-ONLY.
 *   recordOwnHeartbeat(sessionId, pid, machine, now?) → void — AC-OWN-5's ONLY write:
 *                                records THIS process's OS-probed `{pid, started_at}`
 *                                as `sessionId`'s current heartbeat. A COMMAND, never
 *                                hidden inside a query method (CQS) — the CLI adapter
 *                                calls it explicitly before querying.
 *   deriveSessionLiveness(sessions, currentMachine) → SessionLivenessRecord[] — joins
 *                                each session with a probed liveness verdict
 *                                (`session-liveness.ts::deriveLivenessVerdict`), NEVER
 *                                from claim age. READ-ONLY.
 *
 * @invariant `bootstrap`, `resume`, `getActiveSessions`, and `deriveSessionLiveness`
 *   perform ZERO store mutations — no insert/update/softDelete/addLink/removeLink/
 *   insertVersion/appendAuditEntry/insertJudgment/insertCalibrationRecord call, ever
 *   (SPEC-041 §4 AC-SL-2, extended to the two new L0 queries by the same rule). All
 *   four only ever call `store.find`/`findMany`/`findLinksByToIds` (plus, for
 *   `deriveSessionLiveness`, the injected heartbeat-read/process-probe PORTS — leaf
 *   IO, never the store). `recordOwnHeartbeat` is the ONE exception, and it writes
 *   nowhere near the store either — its target is a tmpdir sidecar file behind
 *   `writeHeartbeatPort`, never a corpus document.
 * @invariant `writeHandoff` never writes through `store` directly — every doc it
 *   creates goes through the constructor-injected `createHandoffDoc` port
 *   (`CorpusService.createHandoffDoc`, bound in `app.ts`), mirroring the
 *   `GateEnforcer`/`resolveDeclaredAcIds` injected-port pattern used elsewhere in this
 *   codebase specifically so services never cross-import each other
 *   (service/CLAUDE.md "Service per concern, no cross-service calls").
 * @invariant Stateless — the only state is the injected `StoreInterface` + the scalar
 *   config bundle passed at construction. All persistent state lives in the store.
 * @invariant `bootstrap`'s `active_sessions` is CORPUS-GLOBAL — derived over
 *   every claim-bearing task regardless of parent type or plan status
 *   (task-active-sessions-derives-only-over-active-plans-tasks-with Required
 *   #1; measured pre-fix: unconditionally `[]` in a corpus with zero active
 *   plans, and never included an `--adhoc` task, SPEC-069 D2). A group whose
 *   own freshest claim activity has aged past the ttl is still REPORTED,
 *   flagged `stale: true` (Required #2's recorded decision — candidate (a);
 *   see `bootstrap()`'s own inline comment for the full weighing against (b)
 *   claim-refresh-on-evidence and (c) an explicit "unknown" marker). Staleness
 *   is NEVER treated as death here — a `stale: true` row still names a
 *   claimant a consumer must not act destructively against on timestamp alone.
 *   `TaskWorkflowService.ready`'s plan-scoped `sessions[]` is UNTOUCHED by any
 *   of this — it stays keyed to one plan's own members, unchanged.
 *
 * Source: SPEC-041 §3 D1-D5; task-active-sessions-derives-only-over-active-plans-tasks-with.
 */

import { pickArchitectureRoot, pickBaselineRoot, pickStrategyDocument } from "./navigation-roots.js";
import {
  err,
  ok,
  evaluateReadiness,
  extractHeldClaim,
  isClaimStale,
  knowledgeExtraSchema,
  handoffExtraSchema,
  renderHandoffContent,
  bootstrapReportSchema,
  deriveSessions,
  deriveLastActivityAt,
  isActivePlan,
  deriveResumeHint,
  parseSeatBranch,
  isInvalidated,
  computeArchiveCandidates,
  mergeTrailIntoChangedFiles,
} from "@lore/core";
import {
  parseRunId,
  type SessionTrail,
} from "@lore/core/node";
import { claimNamesWorktree, makeDirectoryResolver } from "./seat-claim-match.js";
import type {
  BootstrapReport,
  BootstrapSeatClaim,
  BlockerInfo,
  CreateDocInput,
  DocId,
  DocRecord,
  HandoffExtra,
  HandoffPointer,
  LinkRecord,
  LoreError,
  ReadySession,
  Result,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";
import type { GateCheckpoint } from "./checkpoint-registry.js";
import { computeArmedGates } from "./checkpoint-registry.js";
import { isPlanMember } from "./plan-membership.js";
import { resolveMessageAddressByRun } from "./holder-message-address.js";
import { computeRuleDiffSinceClaim, renderRuleDiff } from "./resume-rule-diff.js";
import { deriveLivenessVerdict, type LivenessVerdict } from "./session-liveness.js";
import { probeProcessStartTime, type ProcessStartTimeProbe } from "../adapters/process-probe-port.js";
import {
  type WriteSessionHeartbeat,
  type ReadSessionHeartbeat,
} from "../adapters/session-heartbeat-port.js";
import { realpathNative, type RealpathPort } from "../adapters/real-realpath-port.js";

const defaultNow = (): string => new Date().toISOString();

/**
 * Who is writing a handoff, as the ADAPTER verified it: the attested run (`cc:<session>[:<agent>]`), or
 * `null` when the caller has none. The adapter resolves it (CLI: verified invocation identity; MCP: the
 * call's verified `harness_run`); the service only reads the trail that run points at.
 */
export interface HandoffCaller {
  readonly run: string | null;
}

/**
 * Port reading one session's trail. `null` = no trail directory for that session. May throw the trail
 * reader's typed errors for a malformed file; `writeHandoff` turns that into "not measured" with the reason.
 */
export type ReadHandoffTrail = (sessionId: string) => SessionTrail | null;

/** Thrown by the default trail port: no state base was wired, so no trail can be read. */
export class TrailPortNotWiredError extends Error {
  constructor(readonly sessionId: string) {
    super(`no session-trail reader wired (SessionServiceDeps.readTrail) — cannot read the trail of session ${sessionId}`);
    this.name = "TrailPortNotWiredError";
  }
}

/**
 * Default port: nothing wired. The real reader needs the state base (`stateBase(env, home)`, which this service must
 * not read from the process, AS-26), so `app.ts` supplies it as `SessionServiceDeps.readTrail`; a bare construction
 * gets this typed refusal, which `withTrailChangedFiles` reports as "not measured" with the reason — never a guess.
 */
const readHandoffTrailUnwired: ReadHandoffTrail = (sessionId) => {
  throw new TrailPortNotWiredError(sessionId);
};

/** Truncates `title` to at most `maxChars`, appending an ellipsis marker when cut. */
function truncateTitle(title: string, maxChars = 120): string {
  return title.length > maxChars ? `${title.slice(0, maxChars - 1)}…` : title;
}

/** Ascending `created_at` comparator — the deterministic ordering `bootstrap` uses for "first PRD" / pending-queue sampling. */
function byCreatedAtAsc(a: DocRecord, b: DocRecord): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  return 0;
}

/**
 * Extracts a Zod-valid `HandoffExtra` from `doc`, or `null` when `doc` isn't a
 * `knowledge` doc with `extra.sub_type === "handoff"` and a valid `extra.handoff`.
 * The single extraction point both `bootstrap` and `resume` use for handoff docs.
 */
function extractHandoffExtra(doc: DocRecord): HandoffExtra | null {
  if (doc.type !== "knowledge") return null;
  const parsed = knowledgeExtraSchema.safeParse(doc.extra);
  if (!parsed.success || parsed.data.sub_type !== "handoff" || parsed.data.handoff === undefined) {
    return null;
  }
  return parsed.data.handoff;
}

/**
 * Constructor dependency bundle for {@link SessionService}.
 *
 * @invariant `createHandoffDoc` is the ONLY way `writeHandoff` persists a document —
 *   production wiring is `corpusService.createHandoffDoc.bind(corpusService)` (`app.ts`).
 * @invariant `isCheckpointEnabled` is OPTIONAL (undefined in bare test construction,
 *   mirroring every other optional-DI service in this codebase) — defaults to
 *   "everything enabled" (bootstrap's own fallback), the SAME default
 *   `resolveGateEnabled(undefined, checkpoint)` and `GateEnforcer.isEnabled` already
 *   apply when no config is wired. Production wiring is
 *   `gateEnforcer.isEnabled.bind(gateEnforcer)` (`app.ts`) — reusing `GateEnforcer`'s
 *   OWN enablement decision rather than re-deriving `workflow.gates.*` from a second
 *   raw `LoreConfig` reference, so the two can never drift.
 */
/**
 * SPEC-057 §Design Decisions D2 — the seat signal `bootstrap` accepts when the
 * calling session opened inside a resolvable seat/task-under-seat worktree
 * (supplied by the SessionStart hook via `lore bootstrap --seat-branch
 * --seat-worktree`, or by an in-process caller).
 *
 * @invariant `worktree` is currently UNCONSULTED by `bootstrap`'s own
 *   resolution — ancestry walking from a nested task-worktree up to its
 *   PARENT seat's branch is the hook/CLI layer's job, done BEFORE this method
 *   is ever called (module-level binding note); `branch` arriving here is
 *   ALREADY the resolved seat branch. Kept on the signal for completeness/
 *   future extension rather than dropped from the shape entirely.
 */
export interface BootstrapSeatSignal {
  readonly branch: string;
  readonly worktree: string;
}

export interface SessionServiceDeps {
  /** Task claim lease TTL in minutes — forwarded to `isClaimStale`/`evaluateReadiness`. */
  readonly claimTtlMinutes: number;
  /** Handoff staleness TTL in minutes — `resume`'s `ttl_warning` threshold. */
  readonly handoffTtlMinutes: number;
  /** Internal creation seam — `CorpusService.createHandoffDoc`, bound. See module invariants. */
  readonly createHandoffDoc: (input: CreateDocInput) => Promise<Result<DocRecord, LoreError>>;
  /** Per-checkpoint gate enablement port — `GateEnforcer.isEnabled`, bound. See module invariants. */
  readonly isCheckpointEnabled?: (checkpoint: GateCheckpoint) => boolean;
  /** Session-trail reader over the invocation's state base (`app.ts` wires `readSessionTrail(id, stateBase(env, home))`); absent -> {@link TrailPortNotWiredError}. */
  readonly readTrail?: ReadHandoffTrail;
}

/** One resolved handoff, as `resume` returns it — pointer fields plus the full rendered content (the one deliberate pointers-only exception, D5). */
export interface ResumeHandoffRecord {
  readonly handoff_slug: string;
  readonly plan_slug: string | null;
  readonly by: string;
  readonly at: string;
  readonly age_minutes: number;
  /** `true` when `age_minutes` exceeds `workflow.handoff_ttl_minutes` (default 10080 = 7 days). */
  readonly ttl_warning: boolean;
  /** Mirrors `extra.handoff.degraded` — a git-only capture with no recorded decisions. */
  readonly degraded: boolean;
  /** Deterministic re-render of `extra.handoff` via `renderHandoffContent` — the SSOT projection, not `doc.content` read verbatim. */
  readonly content: string;
}

/** Live readiness snapshot for the plan a resumed handoff (or `--plan` target) is scoped to. Reuses the same `evaluateReadiness` computation `lore ready` uses. */
export interface ResumeReadinessPointer {
  readonly plan_slug: string;
  readonly total: number;
  readonly ready: number;
  readonly claimed: number;
  readonly done: number;
}

/**
 * `SessionService.resume`'s result. `found: false` (both `handoff`/`handoffs` absent,
 * `readiness: null`) is a FACT, not an error — "no handoff recorded yet" is a
 * legitimate corpus state (D5: "(no handoff recorded)", exit 0 at the CLI layer).
 */
export interface ResumeResult {
  readonly found: boolean;
  /** Present iff `found` and `multi_actor` is `false` — the single newest-wins (or direct-targeted) record. */
  readonly handoff?: ResumeHandoffRecord;
  /** Present iff `found` and `multi_actor` is `true` — newest PER actor, newest-first. */
  readonly handoffs?: ResumeHandoffRecord[];
  /** `true` iff `--by` was omitted, no explicit `--handoff` was given, and the candidate set spans >1 actor (D5 — divergent state is surfaced, never silently collapsed). */
  readonly multi_actor: boolean;
  /** `null` when no single plan context applies (empty result, or a multi-actor result spanning ambiguous plan scope). */
  readonly readiness: ResumeReadinessPointer | null;
}

/**
 * One {@link ReadySession} joined with its probed {@link LivenessVerdict}
 * (`deriveSessionLiveness`, AC-OWN-5) — `stale` (claim-age, when present) and
 * `liveness` (process-probed) are two INDEPENDENT facts, carried side by side,
 * never merged into one: the AC's own "claim age must not influence the
 * verdict" clause would be unfalsifiable if the two were collapsed into a
 * single field.
 */
export interface SessionLivenessRecord extends ReadySession {
  readonly liveness: LivenessVerdict;
}

export class SessionService {
  /**
   * @param probeProcessStartTimePort - AC-OWN-5 injected port measuring a
   *   pid's current OS-observed start time. Defaults to the REAL
   *   implementation (`adapters/process-probe-port.ts::probeProcessStartTime`)
   *   — leaf IO needing no `app.ts` wiring (mirrors `TaskWorkflowService`'s
   *   `detectBranch` ctor-DI precedent). Tests inject a fake to avoid a real
   *   `ps` subprocess.
   * @param writeHeartbeatPort - AC-OWN-5 injected port persisting a session's
   *   own heartbeat, built by `app.ts` over the invocation's temp directory
   *   (`adapters/session-heartbeat-port.ts::createWriteSessionHeartbeat`).
   *   Absent => no heartbeat is recorded (advisory data; every bare test construction).
   * @param readHeartbeatPort - AC-OWN-5 injected port reading a session's
   *   recorded heartbeat (`createReadSessionHeartbeat`). Absent => every
   *   session reads "unmeasured".
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly deps: SessionServiceDeps,
    private readonly probeProcessStartTimePort: ProcessStartTimeProbe = probeProcessStartTime,
    private readonly writeHeartbeatPort?: WriteSessionHeartbeat,
    private readonly readHeartbeatPort?: ReadSessionHeartbeat,
    private readonly realpathPort: RealpathPort = realpathNative,
    private readonly readTrailPort: ReadHandoffTrail = deps.readTrail ?? readHandoffTrailUnwired,
  ) {}

  // ── Seat claims (session-start injection) ─────────────────────────────────

  /**
   * The unfinished claims recorded for the seat (the linked worktree this
   * session sits in) — the ONLY claim-derived data the session-start injection
   * carries (spec-session-start-injection-carries-only-the-session-s-own D1,
   * D3, D11, D12). READ-ONLY: writes nothing.
   *
   * A task matches when its `extra.claim.worktree` EQUALS `seat.branch`, OR is
   * an ABSOLUTE path that resolves to the same directory as `seat.worktree`
   * (D11: `claim.worktree` holds either form today — issue #158). Tasks whose
   * status is `archived`/`deprecated` are excluded here (D3; BR-331's
   * archived-claim noise in the full report is deliberately not inherited).
   *
   * Path comparison (D12): both sides go through the injected `realpath` port
   * (macOS `/tmp` vs `/private/tmp`). A path that no longer exists (ENOENT —
   * e.g. `lore done` already removed the worktree) falls back, EXPLICITLY, to
   * `path.resolve` of the string; any other realpath failure is surfaced as a
   * `STORE_ERROR`, never swallowed. A non-absolute `claim.worktree` (a branch
   * name, `.`, `foo`) is compared as a branch only and never as a path; an
   * empty string matches nothing.
   *
   * @param seat - `{branch, worktree}` — the same signal type `bootstrap` takes.
   * @returns `ok(BootstrapSeatClaim[])` sorted by `claimed_at` ascending; `stale`
   *   uses the same `claimTtlMinutes` as `bootstrap`. `err` only on a store read
   *   failure or a non-ENOENT realpath failure.
   * @example
   * await sessionService.seatClaims({ branch: "feat-x", worktree: "/repo/.claude/worktrees/x" });
   */
  async seatClaims(seat: BootstrapSeatSignal): Promise<Result<BootstrapSeatClaim[], LoreError>> {
    const nowIso = defaultNow();
    const allDocsResult = await this.store.findMany({});
    if (!allDocsResult.ok) return allDocsResult;
    const allDocs = allDocsResult.value;
    const slugById = new Map<DocId, string>(allDocs.map((d) => [d.id, d.slug]));

    try {
      const resolveDirectory = makeDirectoryResolver(this.realpathPort);
      const resolvedDirectory = resolveDirectory(seat.worktree);
      const matched: BootstrapSeatClaim[] = [];
      for (const task of allDocs) {
        if (task.type !== "task") continue;
        const claim = extractHeldClaim(task);
        const recorded = claim?.worktree;
        if (claim === undefined || recorded === undefined || recorded === "") continue;
        if (!claimNamesWorktree(recorded, { branch: seat.branch, resolvedDirectory }, resolveDirectory)) continue;
        const declaredPlanId = task.extra["plan_id"];
        matched.push({
          task_slug: task.slug,
          plan_slug: typeof declaredPlanId === "string" ? (slugById.get(declaredPlanId) ?? "(unknown)") : "(unknown)",
          claimed_at: claim.at,
          stale: isClaimStale(claim, nowIso, this.deps.claimTtlMinutes),
        });
      }
      matched.sort((a, b) => (a.claimed_at < b.claimed_at ? -1 : a.claimed_at > b.claimed_at ? 1 : 0));
      return ok(matched);
    } catch (cause) {
      return err({
        code: "STORE_ERROR",
        message: `seatClaims: could not resolve a worktree path: ${cause instanceof Error ? cause.message : String(cause)}`,
        ...(cause instanceof Error ? { cause } : {}),
      });
    }
  }

  // ── Bootstrap (S1) ────────────────────────────────────────────────────────

  /**
   * Assembles the S1 volatile pointer-set for a fresh session: root PRD, active
   * plans + task readiness, the pending-review queue, the caller's own claims, armed
   * gate checkpoints, latest handoffs per plan, and a resume hint — corpus-wide by
   * default, or SEAT-SCOPED when `seat` is given (SPEC-057 §Design Decisions D2/D3).
   * READ-ONLY — see module invariants. Still git-free: `seat` is caller-resolved data,
   * never derived here (SessionService's documented git-free invariant, D6).
   *
   * @invariant spec-session-start-handoff-neutrality D3 — a handoff doc that is
   *   `archived`/`deprecated`, or invalidated per `extra.validity`
   *   (`isInvalidated`, SPEC-043's SSOT predicate), is excluded from BOTH
   *   `latest_handoffs` and `resume_hint` at the single `handoffPairs`
   *   derivation site below — archiving/invalidating a handoff is an
   *   effective cleanup action everywhere it surfaces.
   *
   * @param by - The requesting actor's identity — filters `my_claims` to this actor.
   * @param now - Caller-supplied current-time seam (never `Date.now()` directly),
   *   mirroring `TaskWorkflowService.ready`'s `now` parameter shape.
   * @param seat - Optional seat signal (SPEC-057 D2). Absent → `resume_hint` is the
   *   corpus-global newest handoff, BYTE-IDENTICAL to pre-SPEC-057 behavior
   *   (REGRESSION-anchored to `session-service.test.ts`'s frozen-baseline suite).
   *   Present and `seat.branch` resolves to a live plan → `resume_hint` scopes to that
   *   plan's own newest handoff (`null` when it has none — never a silent corpus-global
   *   fallback). Present but unresolvable (not a seat-branch pattern, or no matching
   *   plan) → degrades to the corpus-global newest handoff AND sets
   *   `seat_unresolved: true` on the returned report.
   * @returns `ok(BootstrapReport)` — always a fact, never an error; an empty corpus
   *   produces `root: null` + empty arrays, not a failure (AC-SL-10).
   * @example
   * const result = await sessionService.bootstrap("alice");
   * if (result.ok) console.log(result.value.active_plans.length);
   * @example
   * // Seat-scoped resume hint:
   * await sessionService.bootstrap("alice", undefined, { branch: "plan/plan-a", worktree: "/repo-seat-plan-a" });
   */
  async bootstrap(
    by: string,
    now: () => string = defaultNow,
    seat?: BootstrapSeatSignal,
  ): Promise<Result<BootstrapReport, LoreError>> {
    const nowIso = now();

    const allDocsResult = await this.store.findMany({});
    if (!allDocsResult.ok) return allDocsResult;
    const allDocs = allDocsResult.value;

    const slugById = new Map<DocId, string>(allDocs.map((d) => [d.id, d.slug]));

    // reason: D2 pins bootstrap's root resolution to "first PRD by created_at,
    // deterministic" — deliberately NOT an error for >1 PRDs (unlike writeHandoff's
    // stricter parent-resolution rule below, D3) — bootstrap is an advisory snapshot,
    // not a write path that needs disambiguation.
    // AC-BLS3-3: with a baseline root, `root` names it and the PRD moves to `strategy`; with none,
    // `root` is the PRD and `strategy` stays ABSENT (byte-identical to before). One ordering SSOT:
    // navigation-roots.ts (created_at ASC).
    const firstPrd = pickStrategyDocument(allDocs);
    const baselineRoot = pickBaselineRoot(allDocs);
    const toRootRef = (d: DocRecord): { slug: string; title: string } => ({ slug: d.slug, title: truncateTitle(d.title) });
    const navigationRoot = baselineRoot ?? firstPrd;
    const root = navigationRoot !== undefined ? toRootRef(navigationRoot) : null;
    const strategy = baselineRoot !== undefined && firstPrd !== undefined ? toRootRef(firstPrd) : undefined;
    // `architecture` is ADDITIVE (`root` stays the business root for every `data.root` consumer);
    // `null` = no architecture root in this corpus, reported explicitly rather than omitted.
    const architectureDoc = pickArchitectureRoot(allDocs);
    const architecture =
      architectureDoc !== undefined
        ? { tree: "architecture" as const, id: architectureDoc.id, ...toRootRef(architectureDoc) }
        : null;

    // Active (non-terminal) plans + per-plan task readiness counts. Batched: ONE
    // findLinksByToIds across every active plan's tasks (below) instead of the
    // per-plan N+1 this loop used to issue via computeTaskCounts's own fetch
    // (SPEC review M5) — evaluateReadiness already filters its `blocksLinks`
    // input per-task internally, so passing the full cross-plan batch to each
    // plan's computeTaskCounts call is safe; no manual per-plan slice needed.
    const plans = allDocs.filter((d) => d.type === "plan");
    const activePlanEntries: Array<{ plan: DocRecord; tasks: DocRecord[] }> = [];
    for (const plan of plans) {
      if (!isActivePlan(plan)) continue;
      // reason: membership is `extra.plan_id` ({@link isPlanMember}), NEVER the
      // `parent_id` proxy — `lore create task --plan-id P --parent Q` (P !== Q)
      // is a SUPPORTED shape (SPEC-065 D4), and keying this listing on the proxy
      // silently dropped such a member from its OWN plan's `active_plans` entry
      // in the session-start injection every consumer session reads first
      // (task-the-eleventh-plan-member-site-found-by-enumeration; the same
      // conversion `computeReadinessPointer` below already carries). Do NOT
      // re-inline the comparison here — `bun run check:plan-member-sites`
      // reports it.
      const tasks = allDocs.filter((d) => d.type === "task" && isPlanMember(d, plan.id));
      activePlanEntries.push({ plan, tasks });
    }

    const allActiveTaskIds = activePlanEntries.flatMap(({ tasks }) => tasks.map((t) => t.id));
    const activeBlocksLinksResult = await this.store.findLinksByToIds(allActiveTaskIds, "blocks");
    if (!activeBlocksLinksResult.ok) return activeBlocksLinksResult;

    const activePlans: BootstrapReport["active_plans"] = [];
    for (const { plan, tasks } of activePlanEntries) {
      const countsResult = await this.computeTaskCounts(
        tasks,
        allDocs,
        nowIso,
        activeBlocksLinksResult.value,
      );
      if (!countsResult.ok) return countsResult;
      activePlans.push({
        slug: plan.slug,
        title: truncateTitle(plan.title),
        task_counts: countsResult.value,
        // SPEC-069 §Design Decisions D6 — zero extra store calls: plan + tasks
        // are already resident in memory from the loop above.
        last_activity_at: deriveLastActivityAt(plan, tasks),
      });
    }

    // Corpus-wide derived sessions over EVERY task carrying a claim — NOT the
    // `allActiveTaskIds` set above, which stays active-plan-scoped for
    // `active_plans`' own per-plan counts only
    // (task-active-sessions-derives-only-over-active-plans-tasks-with,
    // Required #1). See `computeActiveSessionsFrom`'s own JSDoc (Private
    // Helpers, below) for the full rationale this used to carry inline —
    // extracted so `getActiveSessions` (spec-multi-session-concurrency-
    // queryable-ownership-checkout §Scope L0, AC-OWN-1/AC-OWN-5) can reuse the
    // IDENTICAL derivation without `lore territory`/`lore session list|show`
    // paying for this method's unrelated plan/queue/handoff assembly.
    // `TaskWorkflowService.ready`'s plan-scoped `sessions[]` remains a
    // SEPARATE, untouched call site over the shared `deriveSessions` pure fn.
    const activeSessionsResult = await this.computeActiveSessionsFrom(allDocs, nowIso);
    if (!activeSessionsResult.ok) return activeSessionsResult;
    const activeSessions: ReadySession[] = activeSessionsResult.value;

    // Pending review queue — same `status: "draft"` filter ReviewService.pending uses.
    const pendingDrafts = allDocs.filter((d) => d.status === "draft").sort(byCreatedAtAsc);
    const pendingReviews = {
      count: pendingDrafts.length,
      slugs: pendingDrafts.slice(0, 10).map((d) => d.slug),
    };

    // Caller's own claims, across every task corpus-wide.
    const myClaims: BootstrapReport["my_claims"] = [];
    for (const task of allDocs) {
      if (task.type !== "task") continue;
      const claim = extractHeldClaim(task);
      if (claim === undefined || claim.by !== by) continue;
      // reason: plan membership is `extra.plan_id` — the DECLARED property
      // {@link isPlanMember} reads — NEVER `task.parent_id`. SPEC-065 D4's
      // `--plan-id P --parent Q` (P !== Q) shape means the filing parent can
      // legitimately diverge from the plan a task is a MEMBER of; keying this
      // report on `parent_id` reported the filing parent's slug for a diverged
      // task, and the root PRD's slug for an `--adhoc` task (which has no plan
      // by design, SPEC-069 D2) instead of "no plan"
      // (task-plan-member-sites-twelve-and-thirteen-both-structurally, site 12).
      // Not routed through `isPlanMember` itself: this is a Map LOOKUP keyed by
      // the declared id, not a boolean membership comparison against a
      // candidate plan — the same distinction `_resolveTaskPhaseNamespace`'s
      // own `declaredPlanId` read draws (corpus-service.ts). `declaredPlanId`
      // not resolving to a known doc (broken ref / hard delete / adhoc) is a
      // data-integrity edge case, not a reason to fail the whole bootstrap
      // snapshot — degrades to a placeholder, never silently a wrong slug.
      const declaredPlanId = task.extra["plan_id"];
      const planSlug =
        typeof declaredPlanId === "string" ? (slugById.get(declaredPlanId) ?? "(unknown)") : "(unknown)";
      myClaims.push({
        task_slug: task.slug,
        plan_slug: planSlug,
        claimed_at: claim.at,
        stale: isClaimStale(claim, nowIso, this.deps.claimTtlMinutes),
      });
    }

    // Armed gates — enabled checkpoints + discoverable feeding-skill source. Reuses
    // the SAME computeArmedGates SSOT `CorpusService.status`'s SPEC-043 D8
    // invalidated-feeding-source warning also calls — never a second derivation.
    const approvedSkillDocs = allDocs
      .filter((d) => d.type === "knowledge" && d.status === "approved")
      .map((d) => ({ doc: d, parsed: knowledgeExtraSchema.safeParse(d.extra) }))
      .filter(({ parsed }) => parsed.success && parsed.data.sub_type === "skill")
      .map(({ doc, parsed }) => ({
        slug: doc.slug,
        updated_at: doc.updated_at,
        appliesTo: parsed.success ? parsed.data.skill?.applies_to : undefined,
      }));
    const isCheckpointEnabled = this.deps.isCheckpointEnabled ?? (() => true);
    const armedGates: BootstrapReport["armed_gates"] = computeArmedGates(
      approvedSkillDocs,
      isCheckpointEnabled,
    );

    // Latest handoff per plan grouping (null group = parentless or PRD-parented) + a
    // corpus-wide resume hint (the single newest handoff overall).
    //
    // reason: spec-session-start-handoff-neutrality D3 — a handoff doc whose
    // status is archived/deprecated, or which is invalidated per
    // `extra.validity` (SPEC-043's `isInvalidated` SSOT predicate, the SAME
    // one every other read surface calls — never a second hand-rolled
    // interpretation), is dropped HERE, at the single derivation site both
    // `latest_handoffs` and `resume_hint` build from below. Archiving or
    // invalidating a handoff therefore becomes an effective cleanup action
    // everywhere it surfaces (the full report AND the tier-1 injection),
    // closing the "manual cleanup is currently ineffective" byproduct gap.
    const planIds = new Set(plans.map((p) => p.id));
    const handoffPairs = allDocs
      .map((doc) => ({ doc, handoff: extractHandoffExtra(doc) }))
      .filter((p): p is { doc: DocRecord; handoff: HandoffExtra } => p.handoff !== null)
      .filter(
        (p) => p.doc.status !== "archived" && p.doc.status !== "deprecated" && !isInvalidated(p.doc, nowIso),
      );

    const groups = new Map<DocId | null, Array<{ doc: DocRecord; handoff: HandoffExtra }>>();
    for (const pair of handoffPairs) {
      const key = pair.doc.parent_id !== null && planIds.has(pair.doc.parent_id) ? pair.doc.parent_id : null;
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, [pair]);
      } else {
        group.push(pair);
      }
    }

    const latestHandoffs: BootstrapReport["latest_handoffs"] = [];
    for (const [planId, pairs] of groups) {
      const newest = pairs.reduce((n, p) => (p.doc.created_at > n.doc.created_at ? p : n));
      latestHandoffs.push({
        plan_slug: planId !== null ? (slugById.get(planId) ?? null) : null,
        handoff_slug: newest.doc.slug,
        by: newest.handoff.by,
        at: newest.doc.created_at,
      });
    }
    latestHandoffs.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    // reason: `handoffPointers` mirrors `handoffPairs` 1:1 (same order, same `at`
    // field) so `deriveResumeHint`'s corpus-global scan (no `seatPlanId`) stays
    // BYTE-IDENTICAL to the pre-SPEC-057 `overallNewest` reduce it replaces — the
    // frozen-baseline REGRESSION suite (session-service.test.ts) pins this.
    const handoffPointers: HandoffPointer[] = handoffPairs.map((pair) => {
      const planId =
        pair.doc.parent_id !== null && planIds.has(pair.doc.parent_id) ? pair.doc.parent_id : null;
      return {
        handoff_slug: pair.doc.slug,
        plan_id: planId,
        plan_slug: planId !== null ? (slugById.get(planId) ?? null) : null,
        at: pair.doc.created_at,
      };
    });

    // Resume hint — corpus-global by default; seat-scoped when `seat` resolves to a
    // live plan (SPEC-057 D3). `seatUnresolved` is the "degraded to corpus-global"
    // signal spliced onto `report` below (present-iff-true).
    let resumeHint: BootstrapReport["resume_hint"];
    let seatUnresolved = false;
    if (seat !== undefined) {
      // reason: parseSeatBranch recovers the plan-slug remainder; the matching-plan
      // scan mirrors `SeatService`'s private `deriveShortPlanSlug` inverse (services
      // never cross-import — service/CLAUDE.md — so this small lookup is duplicated
      // here rather than imported from seat-service.ts).
      const shortSlug = parseSeatBranch(seat.branch);
      const matchedPlan =
        shortSlug !== null ? plans.find((p) => p.slug.replace(/^plan-/, "") === shortSlug) : undefined;
      if (matchedPlan !== undefined) {
        resumeHint = deriveResumeHint(handoffPointers, matchedPlan.id);
      } else {
        resumeHint = deriveResumeHint(handoffPointers);
        seatUnresolved = true;
      }
    } else {
      resumeHint = deriveResumeHint(handoffPointers);
    }

    // Corpus-wide size + freshness snapshot.
    const lastUpdated =
      allDocs.length > 0
        ? allDocs.reduce((latest, d) => (d.updated_at > latest ? d.updated_at : latest), allDocs[0]!.updated_at)
        : null;

    // spec-lifecycle-archival-plan-close-cascade-deterministic §Design Decisions D4 —
    // ONE derivation site: the SAME computeArchiveCandidates (R2-R4 sweep rule
    // engine) `lore archive --sweep`/`--apply` calls, over the SAME `allDocs` this
    // method already fetched above (no extra store round-trip). R1 (cascade) is
    // deliberately excluded — it fires automatically at plan-close, needing no
    // discovery surfacing.
    const archiveCandidatesCount = computeArchiveCandidates(allDocs, nowIso, {
      handoffTtlMinutes: this.deps.handoffTtlMinutes,
      claimTtlMinutes: this.deps.claimTtlMinutes,
    }).length;

    const report: BootstrapReport = {
      root,
      ...(strategy !== undefined ? { strategy } : {}),
      architecture,
      active_plans: activePlans,
      pending_reviews: pendingReviews,
      my_claims: myClaims,
      armed_gates: armedGates,
      latest_handoffs: latestHandoffs,
      resume_hint: resumeHint,
      // reason: present-iff-true (SPEC-057 D3) — omitted entirely rather than set
      // `false`, mirroring `attestation.first_seen`'s convention, so a pre-SPEC-057
      // caller's report shape stays byte-identical when no seat signal was given.
      ...(seatUnresolved ? { seat_unresolved: true as const } : {}),
      corpus: { total_docs: allDocs.length, last_updated: lastUpdated },
      active_sessions: activeSessions,
      archive_candidates: archiveCandidatesCount,
    };

    // reason: self-consistency assertion, not user-input validation —
    // bootstrapReportSchema documents the exact shape this method is contractually
    // obligated to produce; a parse failure here means a programmer error in this
    // method, not bad external input, so a throwing `.parse` is appropriate (mirrors
    // checkpoint-registry.ts's "can't happen in production" throw shape).
    return ok(bootstrapReportSchema.parse(report));
  }

  // ── L0 Ownership Read Surfaces (spec-multi-session-concurrency-queryable- ──
  // ── ownership-checkout §Scope L0, AC-OWN-1, AC-OWN-5) ───────────────────────

  /**
   * Corpus-wide derived sessions (`computeActiveSessionsFrom`'s shared
   * derivation — the SAME computation `bootstrap`'s `active_sessions` uses)
   * — exposed as its OWN query so `lore territory`/`lore session list|show`
   * (AC-OWN-1, AC-OWN-5) don't pay for `bootstrap`'s unrelated plan/queue/
   * handoff assembly just to read this one field. READ-ONLY — zero store
   * mutations, same module invariant `bootstrap`/`resume` already carry.
   *
   * @param now - Caller-supplied current-time seam (D10), never `Date.now()`
   *   directly.
   * @returns `ok(ReadySession[])` — corpus-wide, byte-identical shape to
   *   `BootstrapReport.active_sessions`.
   */
  async getActiveSessions(now: () => string = defaultNow): Promise<Result<ReadySession[], LoreError>> {
    const nowIso = now();
    const allDocsResult = await this.store.findMany({});
    if (!allDocsResult.ok) return allDocsResult;
    return this.computeActiveSessionsFrom(allDocsResult.value, nowIso);
  }

  /**
   * Records THIS process's own `{pid, started_at, machine?}` as `sessionId`'s
   * current heartbeat (AC-OWN-5) — the ONLY write this service performs for
   * liveness purposes, and a deliberate COMMAND, never hidden inside
   * `getActiveSessions`/`deriveSessionLiveness` (CQS — a query method must
   * never carry a hidden side effect). The CLI adapter (`commands/session.ts`)
   * calls this explicitly, BEFORE it queries `deriveSessionLiveness`, so the
   * calling session's own presence becomes measurable to a LATER `lore
   * session list|show` call — the mechanism that makes AC-OWN-5's
   * cross-process liveness answerable at all without a P2 session-lease write
   * path (deliberately out of THIS plan's scope — see the plan doc's own "Out
   * of scope" section). A session that never calls this (or calls it on a
   * DIFFERENT machine) is honestly reported `"unmeasured"` by
   * `deriveSessionLiveness`, never fabricated.
   *
   * Best-effort / ADVISORY, mirrors `TaskWorkflowService.claim`'s
   * `installClaimTrailerBinding`: a probe/write fault here must never fail
   * the caller. `pid` is probed via the SAME `probeProcessStartTimePort`
   * `deriveSessionLiveness` later uses to verify it — so a later re-probe of
   * the identical pid yields the IDENTICAL `started_at` (self-consistency:
   * this is the OS's own answer about this process, never a self-reported
   * wall-clock value).
   *
   * @param sessionId - The captured session instance (`ReadySession.session_id`
   *   — the SAME sanitized discriminator `TaskWorkflowService.claim` captures
   *   via `resolveClaimSessionId`).
   * @param pid - The pid to record (caller-supplied; never read directly
   *   here, for testability). The CLI layer passes `process.ppid` — the
   *   PARENT that invoked the `lore` binary (the orchestrating shell/agent
   *   process) — deliberately NEVER `process.pid`: the `lore` CLI process
   *   itself is a short-lived subprocess that exits the instant its command
   *   returns, so recording its OWN pid would make every session report
   *   "dead" on the very next probe, moments after reporting "alive"
   *   (measured while building this command, `commands/session.ts`'s own
   *   comment carries the same note).
   * @param machine - This process's own machine identity (caller-supplied —
   *   `os.hostname()` at the CLI layer, mirrors `TaskClaim.machine`'s own
   *   "auto-captured by the CLI" convention).
   * @example
   * await sessionService.recordOwnHeartbeat("3de02220", process.ppid, "alices-mbp");
   */
  async recordOwnHeartbeat(sessionId: string, pid: number, machine: string | undefined): Promise<void> {
    const startedAt = await this.probeProcessStartTimePort(pid);
    // reason: can't honestly record a start time we couldn't measure, even
    // for OURSELVES — a probe failure here degrades to "no heartbeat
    // recorded" (readSessionHeartbeat later reports "unmeasured"), never a
    // fabricated value.
    if (startedAt === null) return;
    await this.writeHeartbeatPort?.(sessionId, {
      pid,
      started_at: startedAt,
      ...(machine !== undefined ? { machine } : {}),
    });
  }

  /**
   * `lore session list|show`'s liveness join (AC-OWN-5) — pairs each
   * corpus-wide derived session with a probed liveness verdict, NEVER
   * inferred from claim age (`session.stale`, when present, is carried
   * through UNCHANGED alongside `liveness` — two independent facts, never
   * merged into one). READ-ONLY query (CQS) — the write half is
   * `recordOwnHeartbeat`, a SEPARATE, explicitly-named method the caller
   * invokes first.
   *
   * Liveness resolution per session, in order:
   *   1. `session.session_id` absent → `"unmeasured"` (nothing to look a
   *      heartbeat up by — mirrors `compareClaimSessions`'s own "absent ⇒
   *      not-measured" rule, `gate-predicates.ts`).
   *   2. `session.machine` present AND differs from `currentMachine` →
   *      `"unmeasured"` (spec §Non-goals: cross-machine liveness is
   *      advisory-only, never rendered as a live/dead verdict). An ABSENT
   *      `session.machine` does NOT trip this — `TaskClaim.machine` is
   *      additive/optional, and absence is not evidence of a DIFFERENT
   *      machine (a missing side is "not comparable", never a trip).
   *   3. No recorded heartbeat on file for this `session_id` → `"unmeasured"`
   *      (the session never called `recordOwnHeartbeat` — on this machine or
   *      at all — or its heartbeat was never written).
   *   4. Else → {@link deriveLivenessVerdict} over the recorded heartbeat and
   *      a FRESH probe of the recorded pid's CURRENT start time.
   *
   * @param sessions - Corpus-wide derived sessions (`getActiveSessions`'s
   *   result) — passed in rather than re-fetched, so a caller (`lore
   *   territory` already computing the SAME set) never pays for a second
   *   store round trip.
   * @param currentMachine - THIS process's own machine identity
   *   (caller-supplied — `os.hostname()`, mirrors `recordOwnHeartbeat`'s
   *   identical convention).
   * @returns One {@link SessionLivenessRecord} per input session, SAME order,
   *   1:1 — no session is ever dropped (mirrors `deriveSessions`'s own
   *   never-drop discipline).
   */
  async deriveSessionLiveness(
    sessions: readonly ReadySession[],
    currentMachine: string,
  ): Promise<SessionLivenessRecord[]> {
    const records: SessionLivenessRecord[] = [];
    for (const session of sessions) {
      if (session.session_id === undefined) {
        records.push({ ...session, liveness: "unmeasured" });
        continue;
      }
      const sameMachine = session.machine === undefined || session.machine === currentMachine;
      if (!sameMachine) {
        records.push({ ...session, liveness: "unmeasured" });
        continue;
      }
      const recorded = await this.readHeartbeatPort?.(session.session_id);
      if (recorded === undefined) {
        records.push({ ...session, liveness: "unmeasured" });
        continue;
      }
      /** @lore-site BR-383 */
      const probed = await this.probeProcessStartTimePort(recorded.pid);
      records.push({ ...session, liveness: deriveLivenessVerdict(recorded, probed, true) });
    }
    return records;
  }

  // ── Handoff Write (S2) ──────────────────────────────────────────────────

  /**
   * Validates `input` against `handoffExtraSchema`, resolves its parent (four-way
   * rule below), renders deterministic content, and creates the doc via the injected
   * `createHandoffDoc` port. Status is always `draft` (the doc enters the normal
   * review loop — unreviewed handoffs are advisory, PRD §15).
   *
   * Parent resolution (pinned, SPEC-041 §3 D3):
   *   1. `input.plan_ref` given → must resolve to a live (non-deleted) `plan` doc,
   *      else `VALIDATION_ERROR`.
   *   2. No `plan_ref`, exactly one PRD in the corpus → that PRD.
   *   3. No `plan_ref`, zero PRDs → parentless (legal for `knowledge` docs).
   *   4. No `plan_ref`, >1 PRDs → `VALIDATION_ERROR` requiring `plan_ref`.
   *
   * @param input - A `handoffExtraSchema`-shaped payload (validated here, not by the
   *   caller — the JSON IS the `extra.handoff` SSOT, D6).
   * @param now - Reserved for symmetry with `bootstrap`/`resume`'s time seam; not
   *   currently consulted (doc timestamps come from `createHandoffDoc`'s own clock).
   * @param caller - The verified writer run. When given (CLI and MCP always give it), the handoff's
   *   `changed_files` / `changed_files_measured` / `trail_gaps` are COMPUTED here from that run's session
   *   trail merged with `modified_files` (session-trail D16) and any such fields in `input` are discarded;
   *   `modified_files` itself is stored exactly as typed. A `null` run reads "changed files: not measured".
   *   Omitted (internal callers and legacy tests) leaves the payload untouched.
   * @returns `ok(DocRecord)` of the created handoff doc, or `err(VALIDATION_ERROR)`.
   * @example
   * await sessionService.writeHandoff({
   *   by: "claude", task_refs: [], modified_files: [], key_decisions: [],
   *   next_steps: ["merge the PR"],
   * });
   */
  async writeHandoff(
    input: HandoffExtra,
    // reason: accepted for signature symmetry with bootstrap/resume's explicit time
    // seam (D10-style discipline); writeHandoff itself performs no now()-dependent
    // computation — doc timestamps are stamped by createHandoffDoc's own clock.
    _now: () => string = defaultNow,
    caller?: HandoffCaller,
  ): Promise<Result<DocRecord, LoreError>> {
    const parsed = handoffExtraSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? String(issue.path.join(".")) : "handoff",
        message: issue?.message ?? "Invalid handoff payload",
        value: input,
      });
    }
    const handoff = caller === undefined ? parsed.data : this.withTrailChangedFiles(parsed.data, caller);

    let parentId: DocId | null = null;
    if (handoff.plan_ref !== undefined) {
      // reason: includeDeleted keeps the "must resolve to a live plan ... (soft-deleted)" refusal below reachable (BR-338: exit 4).
      const resolveResult = await resolveDoc(this.store, handoff.plan_ref, { includeDeleted: true });
      if (!resolveResult.ok) {
        return err({
          code: "VALIDATION_ERROR",
          field: "plan_ref",
          message: `plan_ref "${handoff.plan_ref}" does not resolve to any document`,
          value: handoff.plan_ref,
          rule: "BR-338",
        });
      }
      const planDoc = resolveResult.value;
      if (planDoc.type !== "plan" || planDoc.deleted_at !== null) {
        return err({
          code: "VALIDATION_ERROR",
          field: "plan_ref",
          message:
            `plan_ref "${handoff.plan_ref}" must resolve to a live plan document — ` +
            `found type "${planDoc.type}"${planDoc.deleted_at !== null ? " (soft-deleted)" : ""}`,
          value: handoff.plan_ref,
          rule: "BR-338",
        });
      }
      parentId = planDoc.id;
    } else {
      const prdsResult = await this.store.findMany({ type: "prd" });
      if (!prdsResult.ok) return prdsResult;
      const prds = prdsResult.value;
      if (prds.length === 1) {
        parentId = prds[0]!.id;
      } else if (prds.length > 1) {
        return err({
          code: "VALIDATION_ERROR",
          field: "plan_ref",
          message:
            "multiple PRDs exist in the corpus; plan_ref is required to disambiguate the handoff's parent",
          value: prds.map((p) => p.slug),
          rule: "BR-339",
        });
      }
      // prds.length === 0 → parentId stays null (parentless — legal for knowledge docs).
    }

    const createInput: CreateDocInput = {
      type: "knowledge",
      title: `Handoff — ${handoff.by}`,
      ...(parentId !== null ? { parent_id: parentId } : {}),
      content: renderHandoffContent(handoff),
      extra: { sub_type: "handoff", handoff },
    };

    return this.deps.createHandoffDoc(createInput);
  }

  /**
   * Replace the trail-derived fields of `handoff` with the merge of the caller's session trail and the
   * author's `modified_files` (D16). Any `changed_files*` / `trail_gaps` the payload carried are dropped:
   * only the trail may say what changed. Never throws — an unreadable trail is "not measured" with its reason.
   */
  private withTrailChangedFiles(handoff: HandoffExtra, caller: HandoffCaller): HandoffExtra {
    const { changed_files: _dropFiles, changed_files_measured: _dropMeasured, trail_gaps: _dropGaps, ...base } = handoff;
    let trail: SessionTrail | null = null;
    let reason: string;
    if (caller.run === null) {
      reason = "no attested run";
    } else {
      try {
        const { session } = parseRunId(caller.run);
        /** @lore-site BR-1149 */
        trail = this.readTrailPort(session);
        reason = `no session trail for ${session}`;
      } catch (e) {
        // reason: a trail that cannot be read is a measurement gap to SHOW (I7), never a handoff refusal.
        reason = e instanceof Error ? e.message : String(e);
      }
    }
    return { ...base, ...mergeTrailIntoChangedFiles(trail, handoff.modified_files, reason) };
  }

  // ── Resume rule diff (BL-15, SPEC-157 AC-BLS2-22 / BR-966) ───────────────

  /**
   * For every non-terminal CLAIMED task of `planRef`, the governing-rule diff since its claim
   * (`computeRuleDiffSinceClaim`) plus its rendered lines — what `lore feed session-resume`
   * prints so a resumed session sees which rules moved under it.
   *
   * @param planRef - Plan id/slug; unresolvable, or not a plan → err (never an empty result).
   * @param by - When given, only tasks claimed by this actor.
   * @returns one entry per claimed task, in store order; `[]` when the plan has no claimed task.
   */
  async resumeRuleDiffs(
    planRef: string,
    by?: string,
  ): Promise<Result<Array<{ task_slug: string; lines: string[] }>, LoreError>> {
    const plan = await resolveDoc(this.store, planRef);
    if (!plan.ok) return plan;
    if (plan.value.type !== "plan") {
      return err({
        code: "VALIDATION_ERROR",
        field: "plan",
        message: `"${planRef}" does not resolve to a plan document`,
        value: planRef,
      });
    }
    const tasks = await this.store.findMany({ type: "task" });
    if (!tasks.ok) return tasks;
    const out: Array<{ task_slug: string; lines: string[] }> = [];
    for (const task of tasks.value) {
      if (!isPlanMember(task, plan.value.id)) continue;
      if (task.status === "archived" || task.status === "deprecated") continue;
      const claim = task.extra["claim"] as { by?: unknown } | null | undefined;
      if (claim === null || claim === undefined || typeof claim !== "object") continue;
      if (by !== undefined && claim.by !== by) continue;
      const diff = await computeRuleDiffSinceClaim({ store: this.store, taskId: task.id });
      if (!diff.ok) return diff;
      // AC-BLS2-11: a task whose spec cites no baseline rule has nothing to report - print nothing.
      if (diff.value.governing.length === 0) continue;
      out.push({ task_slug: task.slug, lines: renderRuleDiff(diff.value) });
    }
    return ok(out);
  }

  // ── Resume (S2 read path) ────────────────────────────────────────────────

  /**
   * Resolves the handoff(s) matching `opts` and returns them with rendered content,
   * age/TTL status, and a readiness pointer. READ-ONLY — see module invariants.
   *
   * Targeting (SPEC-041 §3 D5):
   *   - `opts.handoff` given → direct targeting, skips all derivation.
   *   - Else `opts.plan` given → newest-wins scoped to that plan (or newest PER
   *     actor when `opts.by` is omitted and >1 actor has handoffs there —
   *     `multi_actor: true`).
   *   - Else corpus-wide → newest-wins overall (same actor-isolation/multi-actor
   *     rule, applied without a plan scope).
   *   - `opts.by`, when given, filters the candidate set to that actor first.
   *
   * @param opts.plan - Plan id/slug to scope the search to. Ignored when `opts.handoff` is given.
   * @param opts.handoff - Handoff doc id/slug — direct targeting. When given, this is
   *   the ENTIRE candidate set: `opts.plan` and `opts.by` are both ignored (D5 "skips
   *   derivation" — an explicit target is never re-filtered).
   * @param opts.by - Actor identity to isolate to. Only consulted when `opts.handoff`
   *   is omitted.
   * @param now - Caller-supplied current-time seam.
   * @returns `ok(ResumeResult)` — `found: false` is a fact (D5: "(no handoff recorded)"),
   *   never an error. An unresolvable `--plan`/`--handoff` id IS an error (bad input,
   *   distinct from "valid target, zero handoffs yet").
   * @example
   * const result = await sessionService.resume({ plan: "plan-session-layer" });
   * if (result.ok && result.value.found) console.log(result.value.handoff?.content);
   */
  async resume(
    opts: { plan?: string; handoff?: string; by?: string },
    now: () => string = defaultNow,
  ): Promise<Result<ResumeResult, LoreError>> {
    const nowIso = now();

    let scopePlan: DocRecord | null = null;
    let explicitPair: { doc: DocRecord; handoff: HandoffExtra } | null = null;

    if (opts.handoff !== undefined) {
      const resolveResult = await resolveDoc(this.store, opts.handoff);
      if (!resolveResult.ok) return resolveResult;
      const doc = resolveResult.value;
      const handoff = extractHandoffExtra(doc);
      if (handoff === null) {
        return err({
          code: "VALIDATION_ERROR",
          field: "handoff",
          message: `"${opts.handoff}" does not resolve to a knowledge/handoff document`,
          value: opts.handoff,
        });
      }
      explicitPair = { doc, handoff };
    }

    if (opts.plan !== undefined) {
      const resolveResult = await resolveDoc(this.store, opts.plan);
      if (!resolveResult.ok) return resolveResult;
      const doc = resolveResult.value;
      if (doc.type !== "plan") {
        return err({
          code: "VALIDATION_ERROR",
          field: "plan",
          message: `"${opts.plan}" does not resolve to a plan document`,
          value: opts.plan,
        });
      }
      scopePlan = doc;
    }

    // Candidate set — direct targeting skips derivation entirely (D5).
    let candidates: Array<{ doc: DocRecord; handoff: HandoffExtra }>;
    if (explicitPair !== null) {
      candidates = [explicitPair];
    } else {
      const allResult = await this.store.findMany({ type: "knowledge" });
      if (!allResult.ok) return allResult;
      candidates = [];
      for (const doc of allResult.value) {
        const handoff = extractHandoffExtra(doc);
        if (handoff === null) continue;
        if (scopePlan !== null && doc.parent_id !== scopePlan.id) continue;
        candidates.push({ doc, handoff });
      }
      if (opts.by !== undefined) {
        candidates = candidates.filter((c) => c.handoff.by === opts.by);
      }
    }

    if (candidates.length === 0) {
      return ok({ found: false, multi_actor: false, readiness: null });
    }

    // Newest-wins / newest-per-actor selection (skipped for direct --handoff targeting).
    let selected: Array<{ doc: DocRecord; handoff: HandoffExtra }>;
    let multiActor = false;
    if (explicitPair !== null) {
      selected = candidates;
    } else {
      const actors = new Set(candidates.map((c) => c.handoff.by));
      if (actors.size <= 1) {
        selected = [candidates.reduce((n, c) => (c.doc.created_at > n.doc.created_at ? c : n))];
      } else {
        multiActor = true;
        const newestByActor = new Map<string, { doc: DocRecord; handoff: HandoffExtra }>();
        for (const c of candidates) {
          const existing = newestByActor.get(c.handoff.by);
          if (existing === undefined || c.doc.created_at > existing.doc.created_at) {
            newestByActor.set(c.handoff.by, c);
          }
        }
        selected = [...newestByActor.values()].sort((a, b) => (a.doc.created_at < b.doc.created_at ? 1 : -1));
      }
    }

    const records: ResumeHandoffRecord[] = [];
    for (const pair of selected) {
      records.push(await this.buildResumeRecord(pair.doc, pair.handoff, nowIso));
    }

    // Readiness pointer — only for a single, unambiguous plan context (D5's readiness
    // block is a per-plan concept; a multi-actor result has no single plan to point at).
    let readiness: ResumeReadinessPointer | null = null;
    if (!multiActor) {
      const single = selected[0]!;
      let planDoc: DocRecord | null = scopePlan;
      if (planDoc === null && single.doc.parent_id !== null) {
        const parentResult = await this.store.find(single.doc.parent_id);
        if (parentResult.ok && parentResult.value !== null && parentResult.value.type === "plan") {
          planDoc = parentResult.value;
        }
      }
      if (planDoc !== null) {
        const readinessResult = await this.computeReadinessPointer(planDoc, nowIso);
        if (!readinessResult.ok) return readinessResult;
        readiness = readinessResult.value;
      }
    }

    if (multiActor) {
      return ok({ found: true, handoffs: records, multi_actor: true, readiness });
    }
    // reason: non-empty by construction — `selected` (and therefore `records`) always
    // has exactly 1 entry in the non-multi-actor branch (see selection logic above).
    return ok({ found: true, handoff: records[0]!, multi_actor: false, readiness });
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Corpus-wide derived sessions over EVERY task carrying a claim (SPEC-041,
   * task-active-sessions-derives-only-over-active-plans-tasks-with Required
   * #1) — the shared derivation both `bootstrap`'s `active_sessions` and
   * `getActiveSessions` (AC-OWN-1, AC-OWN-5) call, over an already-fetched
   * `allDocs` (no extra store round trip for `bootstrap`'s own call site).
   *
   * NOT scoped to `active_plans`' membership — the shipped bootstrap
   * contract documents this field as a "corpus-global snapshot spanning
   * every plan, every actor, and every concurrent session"
   * (`BOOTSTRAP_SCOPE_DECLARATION`) — the pre-fix form intersected with
   * `activePlanIds`, so this field read `[]` in ANY corpus with zero active
   * plans (measured: 114 archived / 0 active here) AND never included an
   * `--adhoc` task (SPEC-069 D2 parents these to the root PRD, never a plan,
   * and adhoc is now the dominant task shape in this corpus) — a fresh
   * session read that `[]` as "nobody is working" and removed a live agent's
   * worktree. Scoping this field to active-plan membership was the bug, not
   * a feature to preserve.
   *
   * `TaskWorkflowService.ready`'s plan-scoped `sessions[]` is DELIBERATELY
   * LEFT UNCHANGED and is NOT the defect — it answers "who's on THIS plan",
   * this method answers "who's working AT ALL, anywhere" — the two stay two
   * independent call sites over the shared `deriveSessions` pure fn rather
   * than being collapsed into one helper with a scope flag.
   *
   * Terminal-status tasks (archived/deprecated) are EXCLUDED — `lore done`'s
   * `writeTaskStatus` only ever changes `status`/`updated_at`/`version`, it
   * never clears `extra.claim`, so an archived task can still carry a claim
   * that has not yet aged past `claimTtlMinutes`. Without this filter, the
   * widening above would "resurrect" a just-completed task into
   * `active_sessions` for the remainder of its stale claim's TTL window
   * (STATE dimension, dispatch addendum). `release()` already deletes
   * `extra.claim` outright, so a released task needs no explicit check here —
   * it has no claim left to be picked up at all.
   *
   * reason: deliberately does NOT ALSO filter `isInvalidated` (retracted)
   * tasks — that is a SEPARATE, already-filed defect in this SAME derivation
   * (`knowledge-handoff-agent-main-orchestrator-71` NS3: a retracted task's
   * claim is not excluded here). `ready()` already excludes retracted tasks
   * via its own `isInvalidated` filter
   * (task-a-task-cannot-be-retracted-supersedes-emits-a-repair AC3); this
   * site does not, exactly as before this method was extracted (no new
   * regression — it was never filtered here either).
   *
   * Staleness: Required #2's RECORDED decision (dispatch addendum — "do not
   * silently pick one"). Chosen: candidate (a) — keep reporting a stale
   * claim, flagged, rather than silently dropping it — the incident's own
   * minimum viable fix. Weighed against (b) claim.at ALREADY refreshes on
   * evidence writes (SPEC-069 D4/D5's `renewClaimForEvidence`) — but that
   * leaves the ENTIRE pre-first-evidence working phase unrefreshed, exactly
   * the incident's own window; and (c) an explicit `liveness: "unknown"`
   * marker — rejected because (a) already subsumes it: a `stale: true` row
   * already tells a reader "liveness unconfirmed" without inventing a second
   * vocabulary (AC-OWN-5's `deriveSessionLiveness`, above, is the mechanism
   * that eventually DOES supply a real liveness verdict — probed, never
   * inferred from this same staleness flag). Lengthening `claim_ttl_minutes`
   * was explicitly out of scope — it moves the false-death threshold without
   * making staleness mean liveness, and delays genuine lease reclamation.
   *
   * Mechanically: `deriveSessions` is called with an EFFECTIVELY UNBOUNDED
   * ttl so nothing is filtered out during grouping (fresh AND what would
   * otherwise be "stale" group together uniformly, by the SAME pure function
   * `ready()` uses, called here an EXTRA time rather than modified —
   * `deriveSessions` itself is untouched, so `ready()`'s behavior stays
   * byte-identical). Each returned group is then independently re-checked:
   * `stale: true` iff that group's OWN freshest signal (`newest_at`, already
   * the max `claim.at` across every member task) has itself aged past the
   * REAL ttl — mirrors this same module's `deriveLastActivityAt`
   * "over-reporting is the safe direction" precedent. `stale` is
   * present-iff-true (never `false`), so a genuinely fresh session's shape
   * stays BYTE-IDENTICAL to the pre-this-decision output.
   *
   * `stale: true` means "no fresher activity signal has been recorded for
   * this claimant" — it does NOT mean dead (see `readySessionSchema`'s own
   * `stale` field JSDoc). A consumer must treat it as "claimant exists,
   * liveness unconfirmed" — the same non-solitude caveat this schema already
   * states for an absent `session_id` — never as sole grounds for a
   * destructive action against the claimant's worktree.
   *
   * @param allDocs - Every doc in the corpus (already fetched by the caller).
   * @param nowIso - Current time, ISO 8601.
   */
  private async computeActiveSessionsFrom(
    allDocs: DocRecord[],
    nowIso: string,
  ): Promise<Result<ReadySession[], LoreError>> {
    const claimBearingTasks = allDocs.filter(
      (d) => d.type === "task" && d.status !== "archived" && d.status !== "deprecated",
    );
    // reason: BR-1363 — every holder listing shows the holding session's main-run address; the registry reads
    // happen here so `deriveSessions` stays pure.
    const addressByRun = await resolveMessageAddressByRun(this.store, claimBearingTasks);
    if (!addressByRun.ok) return addressByRun;
    const UNBOUNDED_TTL_MINUTES = Number.POSITIVE_INFINITY;
    return ok(
      deriveSessions(claimBearingTasks, nowIso, UNBOUNDED_TTL_MINUTES, undefined, addressByRun.value).map(
        (session) => {
          const groupIsStale = isClaimStale(
            { by: session.by, at: session.newest_at },
            nowIso,
            this.deps.claimTtlMinutes,
          );
          return groupIsStale ? { ...session, stale: true } : session;
        },
      ),
    );
  }

  /**
   * Computes `{ready, claimed, done}` for one plan's `tasks`, reusing
   * `evaluateReadiness` (`@lore/core`) — the same computation `lore ready` uses.
   * `claimed` counts tasks with a FRESH (non-stale) claim; `done` counts tasks whose
   * `status === "archived"` — the same "satisfied iff archived" convention
   * `evaluateReadiness` already applies to blockers, reused here at the plan level
   * since this codebase has no separate task-completion status field (SPEC-025 §3 D6
   * removed `task_status`).
   *
   * @param tasks - The plan's child task docs.
   * @param allDocs - Every doc in the corpus (already loaded by the caller) — used to
   *   build the blocker-status map without a second `findMany({})` round trip.
   * @param nowIso - Current time, ISO 8601.
   * @param prefetchedBlocksLinks - Optional pre-fetched `"blocks"` links, already
   *   batched across possibly MORE than just `tasks` (e.g. `bootstrap`'s single
   *   cross-plan `findLinksByToIds` call, SPEC review M5). When provided, this
   *   method issues NO store call — `evaluateReadiness` filters its `blocksLinks`
   *   input per-task internally (`link.to_id === task.id`), so passing a superset
   *   of links belonging to other plans' tasks is safe and requires no manual
   *   slice. When omitted, fetches `taskIds`-scoped links itself (the
   *   `computeReadinessPointer` single-plan call site).
   */
  private async computeTaskCounts(
    tasks: DocRecord[],
    allDocs: DocRecord[],
    nowIso: string,
    prefetchedBlocksLinks?: LinkRecord[],
  ): Promise<Result<{ ready: number; claimed: number; done: number }, LoreError>> {
    if (tasks.length === 0) return ok({ ready: 0, claimed: 0, done: 0 });

    let blocksLinks: LinkRecord[];
    if (prefetchedBlocksLinks !== undefined) {
      blocksLinks = prefetchedBlocksLinks;
    } else {
      const taskIds = tasks.map((t) => t.id);
      const linksResult = await this.store.findLinksByToIds(taskIds, "blocks");
      if (!linksResult.ok) return linksResult;
      blocksLinks = linksResult.value;
    }

    const blockerStatuses = new Map<DocId, BlockerInfo>();
    for (const doc of allDocs) {
      blockerStatuses.set(doc.id, { slug: doc.slug, status: doc.status });
    }

    const records = evaluateReadiness(
      tasks,
      blocksLinks,
      blockerStatuses,
      nowIso,
      this.deps.claimTtlMinutes,
    );

    let ready = 0;
    let claimed = 0;
    let done = 0;
    for (const record of records) {
      if (record.ready) ready += 1;
      if (record.claim !== undefined && !record.claim.stale) claimed += 1;
      if (record.task.status === "archived") done += 1;
    }
    return ok({ ready, claimed, done });
  }

  /**
   * Fetches `planDoc`'s tasks + computes its readiness pointer for `resume`'s
   * output (the `session-resume` feed, a frequently-run path). Membership is
   * decided by {@link isPlanMember} (`extra.plan_id`), never a bare
   * `parent_id` match (task-eight-more-plan-member-queries-still-key-on-
   * parent-id) — this call site ALREADY fetches the whole corpus for
   * `computeTaskCounts`'s blocker-status map, so deriving the plan's tasks
   * from that SAME `findMany({})` result (filtered in memory) both fixes the
   * membership bug AND removes a store round trip versus the pre-fix
   * two-call shape, rather than adding a second corpus-wide scan.
   */
  private async computeReadinessPointer(
    planDoc: DocRecord,
    nowIso: string,
  ): Promise<Result<ResumeReadinessPointer, LoreError>> {
    const allDocsResult = await this.store.findMany({});
    if (!allDocsResult.ok) return allDocsResult;
    const tasks = allDocsResult.value.filter(
      (d) => d.type === "task" && isPlanMember(d, planDoc.id),
    );

    const countsResult = await this.computeTaskCounts(tasks, allDocsResult.value, nowIso);
    if (!countsResult.ok) return countsResult;

    return ok({
      plan_slug: planDoc.slug,
      total: tasks.length,
      ...countsResult.value,
    });
  }

  /** Builds one {@link ResumeHandoffRecord} from a resolved (doc, handoff) pair. */
  private async buildResumeRecord(
    doc: DocRecord,
    handoff: HandoffExtra,
    nowIso: string,
  ): Promise<ResumeHandoffRecord> {
    const ageMs = new Date(nowIso).getTime() - new Date(doc.created_at).getTime();

    let planSlug: string | null = null;
    if (doc.parent_id !== null) {
      // reason: plan_slug is an OPTIONAL pointer (nullable in the schema) — a lookup
      // failure or a non-plan parent both legitimately resolve to "no plan", not an
      // error. This is a display pointer, not a required field (contrast with
      // writeHandoff's plan_ref resolution above, which DOES fail loud — that path
      // decides where a doc gets WRITTEN; this one only decides what to DISPLAY).
      const parentResult = await this.store.find(doc.parent_id);
      if (parentResult.ok && parentResult.value !== null && parentResult.value.type === "plan") {
        planSlug = parentResult.value.slug;
      }
    }

    return {
      handoff_slug: doc.slug,
      plan_slug: planSlug,
      by: handoff.by,
      at: doc.created_at,
      age_minutes: Math.floor(ageMs / 60_000),
      ttl_warning: ageMs > this.deps.handoffTtlMinutes * 60_000,
      degraded: handoff.degraded === true,
      content: renderHandoffContent(handoff),
    };
  }
}
