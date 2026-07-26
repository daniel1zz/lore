/**
 * PrdOutlineService — dedicated writer for the root PRD's structured outline
 * (`prd.extra.outline[]`, SPEC-080 C1) and a plan's audited sync exemption
 * (`plan.extra.prd_sync_exempt`, SPEC-080 C4).
 *
 * Outline entries are NOT a doc type — no id of their own beyond the entry's
 * own `section` key, no lifecycle, no independent version history; changes
 * ride the parent PRD's own version log (CAS + one insertVersion + one audit
 * entry), same shape as `AcService`/`RequirementService` one tier up.
 * `prd_sync_exempt` rides the PLAN's own version log the same way.
 *
 * Public surface:
 *   outlineSet(prdIdOrSlug, entry, opts?)   → OutlineEntry[] (updated array)
 *   outlineList(prdIdOrSlug)                → OutlineEntry[]
 *   outlineRm(prdIdOrSlug, section)         → OutlineEntry[] (updated array)
 *   exempt(planIdOrSlug, opts)              → PrdSyncExempt
 *
 * @invariant `outlineSet` is a SINGLE-ENTRY CAS patch keyed by `entry.section`
 *   — it replaces exactly the one matching sibling (or appends, when
 *   `opts.create` is `true`), never the whole array. Every OTHER entry is
 *   carried through byte-identical (round-tripped from the doc's own current
 *   `extra.outline`, not re-derived from caller-supplied fixtures) — this is
 *   what distinguishes it from `CorpusService.set`'s wholesale-replace
 *   footgun (SPEC-076 phases-wipe precedent) the dedicated-writer pattern
 *   exists to close (SPEC-080 T6).
 * @invariant An unknown `section` key is rejected (`VALIDATION_ERROR` listing
 *   the currently-declared keys) UNLESS `opts.create` is explicitly `true` —
 *   this is the same "opt-in append vs. accidental new entry" distinction
 *   `AcService.addCriterion`/`RequirementService.addRequirement` don't need
 *   (their add path is always additive); `outlineSet` is update-shaped by
 *   default because C1's primary use case is revising an EXISTING section's
 *   bounded summary, not authoring a brand-new one.
 * @invariant `outlineSet`/`outlineRm` only operate on a `type: "prd"` document
 *   — a spec/task/etc. target fails loud (`VALIDATION_ERROR` naming "prd").
 * @invariant `exempt` requires a non-blank `reason` (`VALIDATION_ERROR`
 *   naming "reason" on omission OR whitespace-only) — mirrors
 *   `prdSyncExemptSchema`'s `.min(1)` (`@lore/core`, outline.ts), re-checked
 *   here because the caller passes a raw `{reason, by}` object, not something
 *   already Zod-validated.
 * @invariant Writes are CAS-guarded (`store.update`'s `expected_version`) and
 *   produce exactly one `insertVersion` snapshot + one `appendAuditEntry`
 *   (action "update", actor "system") per call — same shape as
 *   `AcService`/`RequirementService`'s write paths, so
 *   `AuditService.verify`'s versions⋈audit completeness oracle (SPEC-035 §2)
 *   needs no special case for outline/exemption writes.
 *
 * Side-effect class: IO (reads and writes via StoreInterface).
 * Source: SPEC-080 C1, C4
 */

import {
  err,
  ok,
  outlineEntrySchema,
  prdSyncExemptSchema,
  type OutlineEntry,
  type PrdSyncExempt,
  type Result,
  type LoreError,
  type DocRecord,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

/** Options for {@link PrdOutlineService.outlineSet}. */
export interface OutlineSetOpts {
  /**
   * When `true`, an unmatched `entry.section` is APPENDED as a new entry
   * instead of being rejected. Defaults to `false` — `outlineSet` is
   * update-shaped by default (see class invariant).
   */
  create?: boolean;
}

/** Options for {@link PrdOutlineService.exempt}. */
export interface ExemptOpts {
  /** Required justification — a blank/whitespace-only string is rejected. */
  reason: string;
  /** Actor identity recording the exemption. */
  by: string;
}

export class PrdOutlineService {
  /**
   * @param store - Storage abstraction (same instance passed to AcService/RequirementService)
   */
  constructor(private readonly store: StoreInterface) {}

  // ── outlineSet ────────────────────────────────────────────────────────────

  /**
   * Single-entry CAS patch onto a PRD's `extra.outline`, keyed by
   * `entry.section`. An existing entry with a matching `section` is REPLACED
   * wholesale by the (schema-validated) candidate; every sibling entry is
   * carried through unchanged. An unmatched `section` is rejected
   * (`VALIDATION_ERROR` listing declared keys) unless `opts.create` is
   * `true`, in which case it is appended.
   *
   * @param prdIdOrSlug - PRD document ULID or slug
   * @param entry - Untrusted candidate entry (validated here via `outlineEntrySchema`)
   * @param opts - `{ create? }` — opt into appending an unknown `section`
   * @returns The full, updated outline array (declaration order preserved)
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a prd / malformed entry /
   *   unknown section without `opts.create`), STALE_VERSION
   */
  async outlineSet(
    prdIdOrSlug: string,
    entry: unknown,
    opts: OutlineSetOpts = {},
  ): Promise<Result<OutlineEntry[], LoreError>> {
    const prdResult = await this.resolvePrd(prdIdOrSlug);
    if (!prdResult.ok) return prdResult;
    const prd = prdResult.value;

    const parsedEntry = outlineEntrySchema.safeParse(entry);
    if (!parsedEntry.success) {
      const issue = parsedEntry.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `outline.${issue.path.join(".")}` : "outline",
        message: issue !== undefined ? issue.message : "Invalid outline entry",
        value: entry,
      });
    }
    const candidateEntry = parsedEntry.data;

    const existing = extractOutline(prd);
    const matchIndex = existing.findIndex((e) => e.section === candidateEntry.section);

    let updated: OutlineEntry[];
    if (matchIndex >= 0) {
      updated = existing.map((e, i) => (i === matchIndex ? candidateEntry : e));
    } else if (opts.create === true) {
      updated = [...existing, candidateEntry];
    } else {
      const declaredKeys = existing.map((e) => e.section).join(", ");
      return err({
        code: "VALIDATION_ERROR",
        field: "outline.section",
        message:
          `Unknown outline section "${candidateEntry.section}" — declared sections: ` +
          `[${declaredKeys}]. Pass { create: true } to add a new section.`,
        value: candidateEntry.section,
      });
    }

    const writeResult = await this.writeOutline(prd, updated, matchIndex >= 0 ? "update" : "add");
    if (!writeResult.ok) return writeResult;
    return ok(updated);
  }

  // ── outlineList ───────────────────────────────────────────────────────────

  /**
   * Return the declared outline entries for a PRD, in declaration order.
   *
   * @param prdIdOrSlug - PRD document ULID or slug
   * @returns The outline array
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a prd)
   */
  async outlineList(prdIdOrSlug: string): Promise<Result<OutlineEntry[], LoreError>> {
    const prdResult = await this.resolvePrd(prdIdOrSlug);
    if (!prdResult.ok) return prdResult;
    return ok(extractOutline(prdResult.value));
  }

  // ── outlineRm ─────────────────────────────────────────────────────────────

  /**
   * Remove a declared outline entry from a PRD by its `section` key.
   *
   * @param prdIdOrSlug - PRD document ULID or slug
   * @param section - Section key to remove (exact match)
   * @returns The full, updated outline array after removal
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a prd / section not found), STALE_VERSION
   */
  async outlineRm(prdIdOrSlug: string, section: string): Promise<Result<OutlineEntry[], LoreError>> {
    const prdResult = await this.resolvePrd(prdIdOrSlug);
    if (!prdResult.ok) return prdResult;
    const prd = prdResult.value;

    const existing = extractOutline(prd);
    if (!existing.some((e) => e.section === section)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "outline.section",
        message: `Outline section "${section}" does not exist on this PRD`,
        value: section,
      });
    }

    const updated = existing.filter((e) => e.section !== section);
    const writeResult = await this.writeOutline(prd, updated, "remove");
    if (!writeResult.ok) return writeResult;
    return ok(updated);
  }

  // ── exempt ────────────────────────────────────────────────────────────────

  /**
   * Record an audited, required-reason exemption from the plan-close sync
   * predicate (`plan.extra.prd_sync_exempt`, SPEC-080 C4) — the ONLY sanctioned
   * writer of this field (`CorpusService.set` rejects a direct patch that
   * would drop it, naming this method).
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param opts - `{ reason, by }` — `reason` must be non-blank
   * @returns The persisted exemption `{ reason, by, at }`
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (blank/missing reason), STALE_VERSION
   */
  async exempt(
    planIdOrSlug: string,
    opts: ExemptOpts,
  ): Promise<Result<PrdSyncExempt, LoreError>> {
    if (typeof opts.reason !== "string" || opts.reason.trim().length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "reason",
        message: "reason is required and must not be blank",
        value: opts.reason,
      });
    }

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

    const now = new Date().toISOString();
    const exemption = prdSyncExemptSchema.parse({ reason: opts.reason, by: opts.by, at: now });

    const newVersion = plan.version + 1;
    const newExtra: Record<string, unknown> = { ...plan.extra, prd_sync_exempt: exemption };

    const updateResult = await this.store.update(
      plan.id,
      { extra: newExtra, updated_at: now, version: newVersion },
      { expected_version: plan.version },
    );
    if (!updateResult.ok) return updateResult;

    const versionResult = await this.store.insertVersion({
      doc_id: plan.id,
      version: newVersion,
      content: updateResult.value.content,
      extra: updateResult.value.extra,
      status: updateResult.value.status,
      title: updateResult.value.title,
      action: "update",
      created_at: now,
      created_by: "system",
      change_summary: `Plan-close sync exemption recorded: ${opts.reason}`,
      // SPEC-072 D1/D2 — this write path only touches `extra`; carry the
      // current (unchanged) slug.
      slug: updateResult.value.slug,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: "system",
      session_id: plan.id,
      action: "update",
      doc_id: plan.id,
      details: { operation: "exempt", version: newVersion },
    });
    if (!auditResult.ok) return auditResult;

    return ok(exemption);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /** Resolves idOrSlug and validates it is a prd document. */
  private async resolvePrd(idOrSlug: string): Promise<Result<DocRecord, LoreError>> {
    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;
    if (doc.type !== "prd") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a prd document; got type '${doc.type}'`,
        value: doc.type,
      });
    }
    return ok(doc);
  }

  /**
   * Shared CAS-guarded write path for outlineSet/outlineRm: bumps the PRD's
   * version, writes one insertVersion snapshot, then one audit entry (action
   * "update", actor "system") — same shape as `AcService.writeCriteria`/
   * `RequirementService.writeRequirements`.
   */
  private async writeOutline(
    prd: DocRecord,
    outline: OutlineEntry[],
    operation: "add" | "update" | "remove",
  ): Promise<Result<DocRecord, LoreError>> {
    const now = new Date().toISOString();
    const newVersion = prd.version + 1;
    const newExtra: Record<string, unknown> = { ...prd.extra, outline };

    const updateResult = await this.store.update(
      prd.id,
      { extra: newExtra, updated_at: now, version: newVersion },
      { expected_version: prd.version },
    );
    if (!updateResult.ok) return updateResult;

    const versionResult = await this.store.insertVersion({
      doc_id: prd.id,
      version: newVersion,
      content: updateResult.value.content,
      extra: updateResult.value.extra,
      status: updateResult.value.status,
      title: updateResult.value.title,
      action: "update",
      created_at: now,
      created_by: "system",
      change_summary: `Outline ${operation === "add" ? "entry added" : operation === "remove" ? "entry removed" : "entry updated"} — ${outline.length} entries`,
      // SPEC-072 D1/D2 — this write path only touches `extra`; carry the
      // current (unchanged) slug.
      slug: updateResult.value.slug,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: "system",
      session_id: prd.id,
      action: "update",
      doc_id: prd.id,
      details: { operation, outline_count: outline.length, version: newVersion },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updateResult.value);
  }
}

/**
 * Extract the validated outline array from a PRD DocRecord. Returns [] when
 * `extra.outline` is absent or fails schema validation — schema-based (not
 * duck-typed), mirroring `AcService`'s `extractCriteria`/`RequirementService`'s
 * `extractRequirements`.
 */
function extractOutline(prd: DocRecord): OutlineEntry[] {
  const parsed = outlineEntrySchema.array().safeParse(prd.extra["outline"]);
  return parsed.success ? parsed.data : [];
}
