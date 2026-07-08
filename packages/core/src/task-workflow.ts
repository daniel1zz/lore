/**
 * Task execution workflow metadata — evidence, claim lease, computed readiness.
 * Pure, browser-safe module: no IO, no Date.now() calls (callers pass nowIso).
 *
 * Public surface:
 *   - evidenceEntrySchema / EvidenceEntry — one oracle verification record
 *   - ATTESTATION_RUNNERS / AttestationRunner — enum of trusted runners allowed to
 *     write `EvidenceEntry.attestation` (SPEC-039 §2 D1)
 *   - taskClaimSchema / TaskClaim — advisory execution lease {by, at, branch?}
 *   - isClaimStale(claim, nowIso, ttlMinutes) — pure staleness check
 *   - resolveTargetTask(tasks, opts) — pure host-task resolution for `lore verify`:
 *     explicit override > sole fresh claim > ambiguity error (SPEC-039 §2 D4)
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
 * Source: SPEC-025 §3 D1-D3, D9, D10; §8.2, §8.3; SPEC-039 §2 D1, D4
 */

import { z } from "zod";
import { ok, err } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import type { DocId, DocRecord, DocStatus, DocSummary, LinkRecord } from "./types.js";

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
 * @invariant `attestation` is runner-issued ONLY — public write paths (CLI `lore evidence`,
 *   MCP `lore_evidence_add`) reject any input carrying this field with VALIDATION_ERROR
 *   (SPEC-039 §4 D2); `TaskWorkflowService.recordVerifiedEvidence` is the sole injection
 *   point. Staying `.optional()` here is load-bearing, not a style choice: {@link extractEvidence}
 *   parses the WHOLE `verification_evidence` array in one `z.array(evidenceEntrySchema)`
 *   call — making `attestation` required would fail-close every array containing a
 *   pre-SPEC-039 legacy entry, silently zeroing out all existing evidence for that task
 *   (SPEC-039 §9, evidence-based correction of the original draft).
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
  result: z.enum(["pass", "fail"]),
  output_tail: z.string().max(4000).optional(),
  recorded_at: z.string(),
  recorded_by: z.string().min(1),
  /** Optional pointer to a declared acceptance criterion id (SPEC-038 §4). */
  ac_ref: z.string().optional(),
  /** Runner-issued attestation metadata (SPEC-039 §2 D1) — see the field-level invariant above. */
  attestation: z
    .object({
      runner: z.enum(ATTESTATION_RUNNERS),
      exit_code: z.number().int(),
      duration_ms: z.number().int().min(0),
      timed_out: z.boolean(),
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
 * @example
 * taskClaimSchema.parse({ by: "alice", at: "2026-07-02T10:00:00.000Z", branch: "feat/x" });
 */
export const taskClaimSchema = z.object({
  by: z.string().min(1),
  at: z.string(),
  branch: z.string().optional(),
});

/** Derived TypeScript type for a task claim lease. */
export type TaskClaim = z.infer<typeof taskClaimSchema>;

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

// ─── Readiness ─────────────────────────────────────────────────────────────

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
  /** Result + timestamp of the most recently appended evidence entry, if any. */
  latest_evidence?: { result: "pass" | "fail"; recorded_at: string };
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

    if (parentSpecStatus !== null && parentSpecStatus !== "approved") {
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
