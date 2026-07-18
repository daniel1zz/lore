/**
 * RequirementService — manages the structured requirement inventory on PRD documents
 * (SPEC-055). Mirrors `AcService`'s shape exactly, one tier up: requirements live in
 * `prd.extra.requirements` (array of `Requirement`, schema-validated by
 * `prdRequirementsSchema`), are NOT a doc type, and their changes ride the parent PRD's
 * own version log (CAS + one insertVersion + one audit entry — same shape `AcService`/
 * `CorpusService.set` use, so `AuditService.verify`'s completeness oracle needs no special
 * case).
 *
 * Public surface:
 *   addRequirement(prdIdOrSlug, requirement)          → Requirement[] (updated inventory)
 *   listRequirements(prdIdOrSlug)                     → Requirement[]
 *   removeRequirement(prdIdOrSlug, reqId, opts?)      → Requirement[] (updated inventory)
 *
 * @invariant All methods return Promise<Result<T, LoreError>> — no thrown exceptions.
 * @invariant `addRequirement` validates the FULL candidate array (existing + new) via
 *   `prdRequirementsSchema` in one `safeParse` — covers id grammar, priority enum, the
 *   100-entry cap AND array-level unique-id, simultaneously (mirrors `AcService.addCriterion`).
 * @invariant `removeRequirement` fails loud when a descendant spec AC still lists the id in
 *   its `requirement_refs`, UNLESS `opts.force` — a forced removal leaves those refs dangling
 *   (they simply cover nothing) rather than silently rewriting AC declarations.
 * @invariant Writes are CAS-guarded and produce exactly one insertVersion + one audit entry.
 *
 * Side-effect class: IO (reads and writes via StoreInterface).
 * Source: SPEC-055 §Scope, §Design D2.
 */

import {
  err,
  ok,
  prdRequirementsSchema,
  specAcceptanceCriteriaSchema,
  type Requirement,
  type Result,
  type LoreError,
  type DocId,
  type DocRecord,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

/** Options for {@link RequirementService.removeRequirement}. */
export interface RemoveRequirementOpts {
  /** Remove even when a descendant spec AC still references this id (see class invariant). */
  force?: boolean;
}

export class RequirementService {
  constructor(private readonly store: StoreInterface) {}

  // ── addRequirement ──────────────────────────────────────────────────────────

  /**
   * Append a requirement to a PRD's `extra.requirements`. The FULL candidate array is
   * validated before writing — malformed id/priority, duplicate id, or the 101st entry all
   * fail loud with the doc unchanged.
   *
   * @param prdIdOrSlug - PRD document ULID or slug
   * @param requirement - Untrusted candidate (validated here, not by the caller)
   * @returns Updated requirement inventory after appending
   */
  async addRequirement(
    prdIdOrSlug: string,
    requirement: unknown,
  ): Promise<Result<Requirement[], LoreError>> {
    const prdResult = await this.resolvePrd(prdIdOrSlug);
    if (!prdResult.ok) return prdResult;
    const prd = prdResult.value;

    const existing = extractRequirements(prd);
    const candidate = [...existing, requirement];
    const parsed = prdRequirementsSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `requirements.${issue.path.join(".")}` : "requirements",
        message: issue !== undefined ? issue.message : "Invalid requirement",
        value: requirement,
      });
    }

    const writeResult = await this.writeRequirements(prd, parsed.data, "add");
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
  }

  // ── listRequirements ──────────────────────────────────────────────────────────

  /**
   * Return the declared requirement inventory for a PRD.
   *
   * @param prdIdOrSlug - PRD document ULID or slug
   * @returns The requirement array (declaration order)
   */
  async listRequirements(prdIdOrSlug: string): Promise<Result<Requirement[], LoreError>> {
    const prdResult = await this.resolvePrd(prdIdOrSlug);
    if (!prdResult.ok) return prdResult;
    return ok(extractRequirements(prdResult.value));
  }

  // ── removeRequirement ─────────────────────────────────────────────────────────

  /**
   * Remove a requirement from a PRD. Fails if any descendant spec AC still references the id
   * in `requirement_refs`, unless `opts.force`.
   *
   * @param prdIdOrSlug - PRD document ULID or slug
   * @param reqId - Requirement id to remove (exact match)
   * @param opts - `{ force? }`
   * @returns Updated requirement inventory after removal
   */
  async removeRequirement(
    prdIdOrSlug: string,
    reqId: string,
    opts: RemoveRequirementOpts = {},
  ): Promise<Result<Requirement[], LoreError>> {
    const prdResult = await this.resolvePrd(prdIdOrSlug);
    if (!prdResult.ok) return prdResult;
    const prd = prdResult.value;

    const existing = extractRequirements(prd);
    if (!existing.some((r) => r.id === reqId)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "requirements[].id",
        message: `Requirement "${reqId}" does not exist on this PRD`,
        value: reqId,
      });
    }

    if (opts.force !== true) {
      const refsResult = await this.gatherDescendantAcRefs(prd.id);
      if (!refsResult.ok) return refsResult;
      if (refsResult.value.has(reqId)) {
        return err({
          code: "VALIDATION_ERROR",
          field: "requirements[].id",
          message:
            `Cannot remove "${reqId}" — a descendant spec acceptance criterion still references it. ` +
            "Pass --force to remove anyway (the AC ref keeps its value and becomes dangling).",
          value: reqId,
        });
      }
    }

    const updated = existing.filter((r) => r.id !== reqId);
    const writeResult = await this.writeRequirements(prd, updated, "remove");
    if (!writeResult.ok) return writeResult;
    return ok(updated);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────────

  /** Resolves idOrSlug and validates it is a PRD document. */
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

  /** Every `requirement_refs` id declared across a PRD's descendant specs' ACs. */
  private async gatherDescendantAcRefs(prdId: DocId): Promise<Result<Set<string>, LoreError>> {
    const specsResult = await this.store.findMany({ parent_id: prdId, type: "spec" });
    if (!specsResult.ok) return specsResult;
    const refs = new Set<string>();
    for (const spec of specsResult.value) {
      const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
      if (!parsed.success) continue;
      for (const ac of parsed.data) {
        for (const ref of ac.requirement_refs ?? []) refs.add(ref);
      }
    }
    return ok(refs);
  }

  /**
   * Shared CAS-guarded write path for add/removeRequirement: bumps the PRD's version, writes
   * one insertVersion snapshot, then one audit entry (action "update", actor "system") —
   * same shape as `AcService.writeCriteria`.
   */
  private async writeRequirements(
    prd: DocRecord,
    requirements: Requirement[],
    operation: "add" | "remove",
  ): Promise<Result<DocRecord, LoreError>> {
    const now = new Date().toISOString();
    const newVersion = prd.version + 1;
    const newExtra: Record<string, unknown> = { ...prd.extra, requirements };

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
      change_summary: `Requirements ${operation === "add" ? "updated" : "updated (removal)"} — ${requirements.length} entries`,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: "system",
      session_id: prd.id,
      action: "update",
      doc_id: prd.id,
      details: { operation, requirement_count: requirements.length, version: newVersion },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updateResult.value);
  }
}

/**
 * Extract the validated requirement inventory from a PRD DocRecord. Returns [] when
 * `extra.requirements` is absent or fails schema validation.
 */
export function extractRequirements(prd: DocRecord): Requirement[] {
  const parsed = prdRequirementsSchema.safeParse(prd.extra["requirements"]);
  return parsed.success ? parsed.data : [];
}
