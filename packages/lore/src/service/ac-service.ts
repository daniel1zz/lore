/**
 * AcService — manages structured acceptance criteria declared on spec documents.
 *
 * Acceptance criteria live in `spec.extra.acceptance_criteria` (array of
 * `AcceptanceCriterion`, schema-validated by `specAcceptanceCriteriaSchema` —
 * `@lore/core` acceptance.ts). They are NOT a doc type — no id of their own beyond
 * the `AC-*` string `id` field, no lifecycle, no independent version history; changes
 * ride the parent spec's own version log (unlike PhaseService's version-less writes —
 * AC declarations are judge-consumed data (SPEC-026/038), so history matters more here).
 *
 * Public surface:
 *   addCriterion(specIdOrSlug, criterion)          → AcceptanceCriterion[] (updated list)
 *   listCriteria(specIdOrSlug)                     → AcListResult { criteria, coverage, dangling }
 *   removeCriterion(specIdOrSlug, acId, opts?)     → AcceptanceCriterion[] (updated list)
 *
 * @invariant All methods return Promise<Result<T, LoreError>> — no thrown exceptions.
 * @invariant `addCriterion` validates the FULL candidate array (existing + new) via
 *   `specAcceptanceCriteriaSchema` in one `safeParse` call — covers the new entry's own
 *   shape (id format, verify discriminant) AND array-level constraints (max 50, unique
 *   id) simultaneously. Mirrors `CorpusService.set`'s single-shot spec-extra validation
 *   (schemas.ts's `spec_kind` superRefine precedent) rather than re-deriving per-field
 *   checks here.
 * @invariant `removeCriterion` fails loud (VALIDATION_ERROR) when any task under a
 *   child plan of the spec has `verification_evidence[].ac_ref === acId`, UNLESS
 *   `opts.force` is true. A forced removal never touches task evidence — those
 *   `ac_ref` values become "dangling" (surfaced by `listCriteria`'s `dangling[]`,
 *   SPEC-038 §9 STATE dimension) rather than silently cleaned up.
 * @invariant Writes are CAS-guarded (`store.update`'s `expected_version`) and produce
 *   exactly one `insertVersion` snapshot + one `appendAuditEntry` (action "update",
 *   actor "system") — same shape as `CorpusService.set`'s spec-extra write path, so
 *   `AuditService.verify`'s versions⋈audit completeness oracle (SPEC-035 §2) is
 *   satisfied without a special case for AC writes.
 *
 * Side-effect class: IO (reads and writes via StoreInterface).
 * Source: SPEC-038 §4, §6, §7 D4
 */

import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import {
  specAcceptanceCriteriaSchema,
  computeAcCoverage,
  extractEvidence,
  type AcceptanceCriterion,
  type AcCoverageFact,
} from "@lore/core";
import type { DocId, DocRecord } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

// ─── Public Types ──────────────────────────────────────────────────────────

/** Result of {@link AcService.listCriteria}. */
export interface AcListResult {
  /** Declared acceptance criteria, in declaration order. */
  criteria: AcceptanceCriterion[];
  /**
   * Pass/fail coverage facts, one per declared criterion — present iff the spec has
   * at least one child plan (regardless of whether that plan has any tasks yet).
   * `null` means "no plan to aggregate against", NOT "zero coverage" — a spec with a
   * plan that has zero tasks yields `[]`-shaped facts (0 pass, 0 fail), not `null`.
   */
  coverage: AcCoverageFact[] | null;
  /**
   * `ac_ref` values found in child-plan tasks' evidence that do not match any
   * currently-declared criterion id — the residue of a `removeCriterion(..., {force:
   * true})` call whose evidence was deliberately left untouched. Sorted, deduplicated.
   */
  dangling: string[];
}

/** Options for {@link AcService.removeCriterion}. */
export interface RemoveCriterionOpts {
  /** Remove even when task evidence still references this id (see class invariant). */
  force?: boolean;
}

// ─── AcService ─────────────────────────────────────────────────────────────

export class AcService {
  /**
   * @param store - Storage abstraction (same instance passed to CorpusService)
   */
  constructor(private readonly store: StoreInterface) {}

  // ── addCriterion ──────────────────────────────────────────────────────────

  /**
   * Append a new acceptance criterion to a spec's `extra.acceptance_criteria`.
   * The FULL candidate array (existing + new) is validated via
   * `specAcceptanceCriteriaSchema` before writing — malformed shape, duplicate id, or
   * exceeding the 50-entry cap all fail loud with the doc left unchanged.
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @param criterion - Untrusted candidate criterion (validated here, not by the caller —
   *   CLI/MCP callers pass raw flag-assembled objects)
   * @returns Updated criteria array after appending
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / malformed criterion / duplicate
   *   id / 51st entry), STALE_VERSION
   *
   * @example
   * await acService.addCriterion("spec-my-feature", {
   *   id: "AC-ACODE-1",
   *   statement: "Rejects malformed input",
   *   verify: { mode: "script", oracle: "test", command: "bunx vitest run x" },
   * });
   */
  async addCriterion(
    specIdOrSlug: string,
    criterion: unknown,
  ): Promise<Result<AcceptanceCriterion[], LoreError>> {
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    const existing = extractCriteria(spec);
    const candidate = [...existing, criterion];
    const parsed = specAcceptanceCriteriaSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `acceptance_criteria.${issue.path.join(".")}` : "acceptance_criteria",
        message: issue !== undefined ? issue.message : "Invalid acceptance criterion",
        value: criterion,
      });
    }

    const writeResult = await this.writeCriteria(spec, parsed.data, "add");
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
  }

  // ── listCriteria ──────────────────────────────────────────────────────────

  /**
   * Return the declared criteria for a spec, plus per-AC evidence coverage (when the
   * spec has ≥1 child plan) and dangling `ac_ref` ids (evidence pointing at ids no
   * longer declared).
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @returns {@link AcListResult}
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec)
   */
  async listCriteria(specIdOrSlug: string): Promise<Result<AcListResult, LoreError>> {
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;
    const criteria = extractCriteria(spec);

    const plansResult = await this.findChildPlans(spec.id);
    if (!plansResult.ok) return plansResult;
    const plans = plansResult.value;

    const tasksResult = await this.findTasksUnderPlans(plans);
    if (!tasksResult.ok) return tasksResult;
    const tasks = tasksResult.value;

    const coverage = plans.length > 0 ? computeAcCoverage(criteria, tasks) : null;

    const declaredIds = new Set(criteria.map((c) => c.id));
    const danglingSet = new Set<string>();
    for (const task of tasks) {
      for (const entry of extractEvidence(task)) {
        if (entry.ac_ref !== undefined && !declaredIds.has(entry.ac_ref)) {
          danglingSet.add(entry.ac_ref);
        }
      }
    }

    return ok({ criteria, coverage, dangling: Array.from(danglingSet).sort() });
  }

  // ── removeCriterion ───────────────────────────────────────────────────────

  /**
   * Remove a declared acceptance criterion from a spec.
   * Fails if any task under a child plan of the spec has evidence referencing this
   * id, unless `opts.force` is true (see class invariant — force never touches
   * existing evidence).
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @param acId - Acceptance criterion id to remove (exact match)
   * @param opts - `{ force? }`
   * @returns Updated criteria array after removal
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / id not found / evidence
   *   references it without force), STALE_VERSION
   */
  async removeCriterion(
    specIdOrSlug: string,
    acId: string,
    opts: RemoveCriterionOpts = {},
  ): Promise<Result<AcceptanceCriterion[], LoreError>> {
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    const existing = extractCriteria(spec);
    if (!existing.some((c) => c.id === acId)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "acceptance_criteria[].id",
        message: `Acceptance criterion "${acId}" does not exist on this spec`,
        value: acId,
      });
    }

    if (opts.force !== true) {
      const plansResult = await this.findChildPlans(spec.id);
      if (!plansResult.ok) return plansResult;
      const tasksResult = await this.findTasksUnderPlans(plansResult.value);
      if (!tasksResult.ok) return tasksResult;

      const referencingTask = tasksResult.value.find((task) =>
        extractEvidence(task).some((entry) => entry.ac_ref === acId),
      );
      if (referencingTask !== undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: "acceptance_criteria[].id",
          message:
            `Cannot remove "${acId}" — task "${referencingTask.slug}" has evidence referencing it. ` +
            "Pass --force to remove anyway (existing evidence keeps its ac_ref and becomes dangling).",
          value: acId,
        });
      }
    }

    const updated = existing.filter((c) => c.id !== acId);
    const writeResult = await this.writeCriteria(spec, updated, "remove");
    if (!writeResult.ok) return writeResult;
    return ok(updated);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /** Resolves idOrSlug and validates it is a spec document. */
  private async resolveSpec(idOrSlug: string): Promise<Result<DocRecord, LoreError>> {
    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;
    if (doc.type !== "spec") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a spec document; got type '${doc.type}'`,
        value: doc.type,
      });
    }
    return ok(doc);
  }

  /** Child plans of a spec (direct parent_id match only). */
  private async findChildPlans(specId: DocId): Promise<Result<DocRecord[], LoreError>> {
    return this.store.findMany({ parent_id: specId, type: "plan" });
  }

  /** All tasks across a set of plans (flattened, one findMany per plan). */
  private async findTasksUnderPlans(plans: DocRecord[]): Promise<Result<DocRecord[], LoreError>> {
    const allTasks: DocRecord[] = [];
    for (const plan of plans) {
      const tasksResult = await this.store.findMany({ parent_id: plan.id, type: "task" });
      if (!tasksResult.ok) return tasksResult;
      allTasks.push(...tasksResult.value);
    }
    return ok(allTasks);
  }

  /**
   * Shared CAS-guarded write path for addCriterion/removeCriterion: bumps the spec's
   * version, writes one insertVersion snapshot, then one audit entry (action "update",
   * actor "system") — same shape as CorpusService.set's spec-extra write, so
   * AuditService.verify's versions⋈audit completeness oracle needs no special case.
   */
  private async writeCriteria(
    spec: DocRecord,
    criteria: AcceptanceCriterion[],
    operation: "add" | "remove",
  ): Promise<Result<DocRecord, LoreError>> {
    const now = new Date().toISOString();
    const newVersion = spec.version + 1;
    const newExtra: Record<string, unknown> = { ...spec.extra, acceptance_criteria: criteria };

    const updateResult = await this.store.update(
      spec.id,
      { extra: newExtra, updated_at: now, version: newVersion },
      { expected_version: spec.version },
    );
    if (!updateResult.ok) return updateResult;

    const versionResult = await this.store.insertVersion({
      doc_id: spec.id,
      version: newVersion,
      content: updateResult.value.content,
      extra: updateResult.value.extra,
      status: updateResult.value.status,
      title: updateResult.value.title,
      action: "update",
      created_at: now,
      created_by: "system",
      change_summary: `Acceptance criteria ${operation === "add" ? "updated" : "updated (removal)"} — ${criteria.length} entries`,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: "system",
      session_id: spec.id,
      action: "update",
      doc_id: spec.id,
      details: { operation, criteria_count: criteria.length, version: newVersion },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updateResult.value);
  }
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

/**
 * Extract the validated acceptance criteria array from a spec DocRecord.
 * Returns [] when extra.acceptance_criteria is absent or fails schema validation —
 * schema-based (not duck-typed) since the discriminated `verify` union is too
 * structural for a hand-rolled type guard to safely narrow.
 */
function extractCriteria(spec: DocRecord): AcceptanceCriterion[] {
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  return parsed.success ? parsed.data : [];
}
