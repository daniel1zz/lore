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
 *   addEvidence(idOrSlug, entry, now?)     → append one oracle verification record
 *   claim(idOrSlug, opts, now?)            → acquire/refresh/steal the advisory lease
 *   release(idOrSlug, opts, now?)          → clear the advisory lease
 *   ready(planIdOrSlug, now?)              → computed readiness report (zero writes)
 *
 * @invariant All public methods return Promise<Result<T, LoreError>> — no thrown exceptions.
 * @invariant Every write carries the read version as a CAS guard (store.update's
 *   expected_version) — a concurrent writer wins the race, the loser gets STALE_VERSION.
 * @invariant Every successful write bumps the task's version and appends one VersionRecord
 *   (action: "update") so `lore log` shows who claimed/released/added evidence and when.
 * @invariant addEvidence/claim/release touch ONLY extra.claim / extra.verification_evidence
 *   — never content, title, or status.
 * @invariant ready() performs zero writes — readiness is computed, never stored (D3).
 *
 * Side-effect class: IO (reads/writes via StoreInterface; emits telemetry).
 * Source: SPEC-025 §3 D2, D3, D5, D7, D8, D10; §4 AC-WF-1..11; §8.2, §8.3
 */

import { z } from "zod";
import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import {
  evidenceEntrySchema,
  taskClaimSchema,
  isClaimStale,
  evaluateReadiness,
  type EvidenceEntry,
  type TaskClaim,
  type ReadyRecord,
  type BlockerInfo,
} from "@lore/core";
import type { DocId, DocRecord, DocStatus } from "@lore/core";
import { NoOpTelemetry, type Telemetry, type TelemetryEvent, type TaskWorkflowEventName } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

// ─── Public Types ──────────────────────────────────────────────────────────

/** Options for {@link TaskWorkflowService.claim}. */
export interface ClaimOpts {
  /** Resolved actor identity (CLI: --by > $LORE_ACTOR > OS username). */
  by: string;
  /** Optional git branch where the work is happening (SPEC-025 non-goal: no worktree paths). */
  branch?: string;
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

/** Evidence input for {@link TaskWorkflowService.addEvidence} — recorded_at is set by the service. */
export type EvidenceInput = Omit<EvidenceEntry, "recorded_at"> & {
  /** See {@link ClaimOpts.source}. */
  source?: string;
};

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

/** Computes age in whole minutes between two ISO timestamps (nowIso - atIso). */
function ageMinutesBetween(nowIso: string, atIso: string): number {
  return Math.floor((new Date(nowIso).getTime() - new Date(atIso).getTime()) / 60_000);
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
   * @param store - Storage abstraction (same instance passed to CorpusService)
   * @param telemetry - Telemetry sink (own wiring — D8; defaults to NoOp)
   * @param config - `{ claimTtlMinutes }` — see resolveClaimTtlMinutes in @lore/core
   */
  constructor(
    private readonly store: StoreInterface,
    telemetry: Telemetry = new NoOpTelemetry(),
    config: { claimTtlMinutes: number },
  ) {
    this.telemetry = telemetry;
    this.claimTtlMinutes = config.claimTtlMinutes;
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

  private async _addEvidenceImpl(
    idOrSlug: string,
    entry: EvidenceInput,
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

    const newExtra: Record<string, unknown> = {
      ...task.extra,
      verification_evidence: [...existing, parsedEntry.data],
    };

    return this.writeTaskExtra(
      task,
      newExtra,
      nowIso,
      entry.recorded_by,
      `Evidence added: ${entry.oracle} ${entry.result}`,
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
    const taskResult = await this.resolveTask(idOrSlug);
    if (!taskResult.ok) return taskResult;
    const task = taskResult.value;

    const nowIso = now();
    const existingClaim = readClaim(task);

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
    }

    const newClaim: TaskClaim = {
      by: opts.by,
      at: nowIso,
      ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
    };
    const newExtra: Record<string, unknown> = { ...task.extra, claim: newClaim };

    const summary =
      existingClaim !== undefined && existingClaim.by !== opts.by
        ? `Claimed by ${opts.by} (previous holder: ${existingClaim.by})`
        : `Claimed by ${opts.by}`;

    return this.writeTaskExtra(task, newExtra, nowIso, opts.by, summary);
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

    return this.writeTaskExtra(task, newExtra, nowIso, opts.by, summary);
  }

  // ── ready ────────────────────────────────────────────────────────────────

  /**
   * Computed readiness report for every task under a plan. Zero writes (D3).
   *
   * Fetches: (1) the plan's parent doc, once, to derive the SPEC-032 §3.4
   * `upstream_unapproved` advisory (non-null iff the parent is a `spec`), (2) the
   * plan's child tasks, (3) `blocks`-type links targeting those tasks in one batch
   * query (D7), (4) statuses/slugs for the referenced blocker docs — then delegates
   * to the pure `evaluateReadiness`.
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param now - Time seam (D10) — drives claim staleness computation
   * @returns Flat ReadyRecord[] (D9), one per child task
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a plan)
   */
  async ready(
    planIdOrSlug: string,
    now: () => string = defaultNow,
  ): Promise<Result<ReadyRecord[], LoreError>> {
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

    if (tasks.length === 0) return ok([]);

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

    return ok(
      evaluateReadiness(tasks, blocksLinks, blockerStatuses, now(), this.claimTtlMinutes, parentSpecStatus),
    );
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
   * Shared write path for addEvidence/claim/release: CAS-guarded store.update on
   * `extra` only, followed by one insertVersion snapshot carrying `change_summary`.
   * Never touches content/title/status (D8 bound).
   */
  private async writeTaskExtra(
    task: DocRecord,
    newExtra: Record<string, unknown>,
    nowIso: string,
    actor: string,
    changeSummary: string,
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
    });
    if (!versionResult.ok) return versionResult;

    return ok(updateResult.value);
  }

  /**
   * Records exactly one telemetry event per successful write (AC-WF-11).
   * Never throws — delegates to Telemetry.record() which swallows IO errors.
   * Failed writes do not emit an event (the AC scopes emission to "successful ... write").
   */
  private recordEvent<T>(
    eventName: TaskWorkflowEventName,
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
