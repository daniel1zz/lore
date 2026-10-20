/**
 * Attribution rendering + share (spec-run-identity-slice-1-harness-attested-runs-attested D4, D9, D11;
 * BR-1037, BR-1039).
 *
 * Two read-only concerns, one module, both over a `StoreInterface` (never written through):
 *
 *   1. {@link attributionOfVersion} / {@link formatAttributionLabels} — the SINGLE definition of how one write
 *      reads on `lore get` and `lore log` (text and --json), so the same write can never read differently on
 *      the two surfaces. `attested` is the version's stored `harness_run`, or the word `unattested`; the claimed
 *      name is the version's author, its source is `audit.details.name_source` of the audit row written in the
 *      same transaction (matched by `details.version`, else by `(doc_id, created_at)`). A row written before
 *      migration 016 (no `harness_run`, no `name_source`) reads `unattested` with its stored name and NO source
 *      — a source is never guessed.
 *   2. {@link AttributionReport.share} — claims + evidence + handoffs written in the window, and how many carry
 *      an attested run. Claims/evidence are audit actions `claim` / `evidence` (`countAttributedWrites`);
 *      handoffs are `create` audit rows of knowledge docs carrying `extra.handoff` (how `lore handoff` writes
 *      them). Ordinary document writes never enter the count.
 *   3. {@link AttributionReport.identitySources} — every audit row in the window, counted by the known party's
 *      source (spec-every-write-is-made-by-a-known-party-an-attested-agent-run end state 6, BR-1039): the row's
 *      `details.name_source` (`run` / `human` / `api-key` / `dashboard`); a row with a run but no recorded source
 *      counts as `run`; anything else (internal writers, rows written before sources existed, a retired
 *      `flag` / `env` / `session` / `worktree` / `os` source) is `other`, never dropped, so the buckets sum to the
 *      window's rows. No bucket is called "unattested".
 *   4. {@link AttributionReport.orphanedDirty} — claims kept by `lore run end` because their worktree was dirty
 *      (`extra.claim.orphaned_dirty`): how many, and the age in minutes of the oldest.
 */

import type { AuditEntry, DocId, LoreError, NameSource, Result, VersionRecord } from "@lore/core";
import { err, extractHeldClaim, ok } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

export const UNATTESTED = "unattested";

export interface WriteAttribution {
  /** The harness run id, or the word `unattested`. */
  readonly attested: string;
  readonly claimed: string;
  /** run | human | api-key | dashboard; absent for a row written before the source was recorded (older rows keep their retired source text). */
  readonly claimed_source?: string;
}

/** The audit row belonging to `version`: same `details.version`, else same `(doc_id, timestamp)`. */
function auditRowOf(version: VersionRecord, audits: readonly AuditEntry[]): AuditEntry | undefined {
  const mine = audits.filter((a) => a.doc_id === version.doc_id);
  const byVersion = mine.filter((a) => a.details?.version === version.version);
  const candidates = byVersion.length > 0 ? byVersion : mine.filter((a) => a.timestamp === version.created_at);
  return candidates.find((a) => a.actor === version.created_by) ?? candidates[0];
}

export function attributionOfVersion(version: VersionRecord, audits: readonly AuditEntry[]): WriteAttribution {
  const row = auditRowOf(version, audits);
  const rawSource = row !== undefined && row.actor === version.created_by ? row.details?.name_source : undefined;
  return {
    attested: version.harness_run ?? UNATTESTED,
    claimed: version.created_by,
    ...(typeof rawSource === "string" ? { claimed_source: rawSource } : {}),
  };
}

/** `attested: <run|unattested> · claimed: <name> (<source>)`; the parenthesis is omitted when no source was recorded. */
export function formatAttributionLabels(a: WriteAttribution): string {
  const claimed = a.claimed_source !== undefined ? `${a.claimed} (${a.claimed_source})` : a.claimed;
  return `attested: ${a.attested} · claimed: ${claimed}`;
}

/** Versions of `docId` (newest first, at most `limit`) with their attribution, read from `store`. */
export async function loadVersionAttributions(
  store: StoreInterface,
  docId: DocId,
  limit: number,
): Promise<Result<{ version: VersionRecord; attribution: WriteAttribution }[], LoreError>> {
  const versions = await store.findVersions(docId, { limit });
  if (!versions.ok) return versions;
  const audits = await store.queryAudit({ doc_id: docId });
  if (!audits.ok) return audits;
  return ok(versions.value.map((version) => ({ version, attribution: attributionOfVersion(version, audits.value) })));
}

export interface AttributionShare {
  window_days: number;
  total: number;
  attested: number;
  /** attested / total, rounded to 4 decimals; `0` when nothing was written (never NaN). */
  share: number;
}

export interface IdentitySourceCounts {
  window_days: number;
  run: number;
  human: number;
  api_key: number;
  dashboard: number;
  /** Rows with no run and no recorded source (internal writers, rows written before sources existed), or a retired source. */
  other: number;
}

export interface OrphanedDirtySummary {
  count: number;
  /** Whole minutes since the oldest `orphaned_dirty.at`; `null` when there is no such claim (never 0). */
  oldest_age_minutes: number | null;
}

/** The recorded `details.name_source` values and the report bucket each counts into (`NameSource`, run-identity.ts). */
const BUCKET_BY_NAME_SOURCE: Readonly<Record<NameSource, "run" | "human" | "api_key" | "dashboard">> = {
  run: "run",
  human: "human",
  "api-key": "api_key",
  dashboard: "dashboard",
};

function bucketOfNameSource(value: unknown): "run" | "human" | "api_key" | "dashboard" | undefined {
  return typeof value === "string" && Object.hasOwn(BUCKET_BY_NAME_SOURCE, value) ? BUCKET_BY_NAME_SOURCE[value as NameSource] : undefined;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const AUDIT_KINDS = ["claim", "evidence"] as const;

export class AttributionReport {
  constructor(private readonly store: StoreInterface) {}

  /** Window = `[clock() - windowDays, clock()]`, start instant INCLUDED. */
  async share(windowDays: number, clock: () => Date): Promise<Result<AttributionShare, LoreError>> {
    if (!Number.isInteger(windowDays) || windowDays < 1) {
      return err({ code: "VALIDATION_ERROR", message: `windowDays must be a positive integer, got ${windowDays}` } as LoreError);
    }
    const windowStart = new Date(clock().getTime() - windowDays * DAY_MS).toISOString();

    const counted = await this.store.countAttributedWrites(windowStart, AUDIT_KINDS);
    if (!counted.ok) return counted;

    const knowledge = await this.store.findMany({ type: "knowledge" });
    if (!knowledge.ok) return knowledge;
    const handoffIds = new Set<string>(knowledge.value.filter((d) => d.extra?.handoff !== undefined).map((d) => d.id));
    let total = counted.value.total;
    let attested = counted.value.attested;
    if (handoffIds.size > 0) {
      const creates = await this.store.queryAudit({ action: "create", since: windowStart });
      if (!creates.ok) return creates;
      for (const row of creates.value) {
        if (row.doc_id === undefined || !handoffIds.has(row.doc_id)) continue;
        total += 1;
        if (row.harness_run != null) attested += 1;
      }
    }
    const share = total === 0 ? 0 : Math.round((attested / total) * 10_000) / 10_000;
    return ok({ window_days: windowDays, total, attested, share });
  }

  /** Audit rows with `timestamp >= clock() - windowDays`, bucketed by identity source (see module header, item 3). */
  async identitySources(windowDays: number, clock: () => Date): Promise<Result<IdentitySourceCounts, LoreError>> {
    if (!Number.isInteger(windowDays) || windowDays < 1) {
      return err({ code: "VALIDATION_ERROR", message: `windowDays must be a positive integer, got ${windowDays}` } as LoreError);
    }
    const windowStart = new Date(clock().getTime() - windowDays * DAY_MS).toISOString();
    const rows = await this.store.queryAudit({ since: windowStart });
    if (!rows.ok) return rows;
    const counts: IdentitySourceCounts = { window_days: windowDays, run: 0, human: 0, api_key: 0, dashboard: 0, other: 0 };
    for (const row of rows.value) {
      const bucket = bucketOfNameSource(row.details?.name_source);
      if (bucket !== undefined) counts[bucket] += 1;
      // reason: a row stamped with a run whose actor differs from the claimed name carries no `name_source`; its run
      // is still the known party's, so it counts as `run`, never `other`.
      else if (row.harness_run != null) counts.run += 1;
      else counts.other += 1;
    }
    return ok(counts);
  }

  /** Tasks whose claim is `orphaned_dirty`: the count and the oldest one's age at `clock()`. */
  async orphanedDirty(clock: () => Date): Promise<Result<OrphanedDirtySummary, LoreError>> {
    const tasks = await this.store.findMany({ type: "task" });
    if (!tasks.ok) return tasks;
    const nowMs = clock().getTime();
    let count = 0;
    let oldestMs: number | null = null;
    for (const task of tasks.value) {
      const orphan = extractHeldClaim(task)?.orphaned_dirty;
      if (orphan === undefined) continue;
      const atMs = Date.parse(orphan.at);
      if (Number.isNaN(atMs)) {
        return err({
          code: "VALIDATION_ERROR",
          field: "orphaned_dirty.at",
          message: `task ${task.slug}: orphaned_dirty.at is not a date: ${orphan.at}`,
          value: orphan.at,
        } as LoreError);
      }
      count += 1;
      if (oldestMs === null || atMs < oldestMs) oldestMs = atMs;
    }
    return ok({
      count,
      oldest_age_minutes: oldestMs === null ? null : Math.max(0, Math.floor((nowMs - oldestMs) / MINUTE_MS)),
    });
  }
}
