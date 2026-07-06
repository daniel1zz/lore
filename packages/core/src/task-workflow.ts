/**
 * Task execution workflow metadata — evidence, claim lease, computed readiness.
 * Pure, browser-safe module: no IO, no Date.now() calls (callers pass nowIso).
 *
 * Public surface:
 *   - evidenceEntrySchema / EvidenceEntry — one oracle verification record
 *   - taskClaimSchema / TaskClaim — advisory execution lease {by, at, branch?}
 *   - isClaimStale(claim, nowIso, ttlMinutes) — pure staleness check
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
 * Source: SPEC-025 §3 D1-D3, D9, D10; §8.2, §8.3
 */

import { z } from "zod";
import type { DocId, DocRecord, DocStatus, DocSummary, LinkRecord } from "./types.js";

// ─── Evidence Schema ───────────────────────────────────────────────────────

/**
 * One oracle verification record, appended to task.extra.verification_evidence.
 * Append-only — entries are never edited or removed, only added (up to the 50-entry cap
 * enforced by taskExtraSchema in schemas.ts).
 *
 * @invariant output_tail is capped at 4000 chars — bounds document growth (SPEC-025 §5 risk table).
 * @invariant recorded_at is an ISO 8601 string set by the caller's time seam (D10), never
 *   generated inside this schema.
 *
 * @example
 * evidenceEntrySchema.parse({
 *   oracle: "tsc", command: "bun run typecheck", result: "pass",
 *   recorded_at: "2026-07-02T10:00:00.000Z", recorded_by: "alice",
 * });
 */
export const evidenceEntrySchema = z.object({
  oracle: z.enum(["tsc", "test", "lint", "build", "e2e", "manual", "other"]),
  command: z.string().min(1),
  result: z.enum(["pass", "fail"]),
  output_tail: z.string().max(4000).optional(),
  recorded_at: z.string(),
  recorded_by: z.string().min(1),
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
 * Extracts the verification_evidence array from a task's extra field.
 * Returns [] when absent or malformed (defensive — extra is untyped storage).
 */
function extractEvidence(task: DocRecord): EvidenceEntry[] {
  const raw = task.extra["verification_evidence"];
  if (!Array.isArray(raw)) return [];
  const parsed = z.array(evidenceEntrySchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * Extracts and validates the claim from a task's extra field.
 * Returns undefined when absent or malformed (defensive — extra is untyped storage).
 */
function extractClaim(task: DocRecord): TaskClaim | undefined {
  const raw = task.extra["claim"];
  if (raw === undefined || raw === null) return undefined;
  const parsed = taskClaimSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Builds the lightweight DocSummary projection of a task DocRecord. */
function toDocSummary(doc: DocRecord): DocSummary {
  return {
    id: doc.id,
    slug: doc.slug,
    type: doc.type,
    title: doc.title,
    status: doc.status,
    updated_at: doc.updated_at,
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
