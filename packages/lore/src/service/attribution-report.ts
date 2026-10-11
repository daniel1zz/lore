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
 */

import type { AuditEntry, DocId, LoreError, Result, VersionRecord } from "@lore/core";
import { err, ok } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

export const UNATTESTED = "unattested";

export interface WriteAttribution {
  /** The harness run id, or the word `unattested`. */
  readonly attested: string;
  readonly claimed: string;
  /** flag | env | mcp | session | worktree | os; absent for a row written before the source was recorded. */
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

const DAY_MS = 86_400_000;
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
}
