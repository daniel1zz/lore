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
 *   migrateRequirement(prdIdOrSlug, reqId, ruleId)    → Requirement[] (sets `migrated_to`, BR-983)
 *
 * @invariant All methods return Promise<Result<T, LoreError>> — no thrown exceptions.
 * @invariant `addRequirement` validates the FULL candidate array (existing + new) via
 *   `prdRequirementsSchema` in one `safeParse` — covers id grammar, priority enum, the
 *   100-entry cap AND array-level unique-id, simultaneously (mirrors `AcService.addCriterion`).
 * @invariant `addRequirement` ALSO rejects an unquantified abstract-quality claim in the
 *   NEWLY-ADDED requirement's `statement` (SPEC-059 §Design, Option A: service-layer lint,
 *   no new gate) — the deterministic, zero-LLM `lintStatement` primitive (`@lore/core`,
 *   ac-quality.ts — the SAME primitive `AcService.addCriterion`'s `lintAcQuantifiability`
 *   delegates to) runs AFTER shape validation succeeds and BEFORE the CAS write, so a
 *   `lore requirement add` with an unquantified statement never reaches the store. Only the
 *   newly-appended entry is linted — a pre-existing vague requirement (added before this
 *   check existed, or written while `workflow.requirement_quantifiable.enabled: false`) is
 *   NEVER retroactively blocked, mirroring `AcService.addCriterion`'s identical "lint only
 *   the new entry" scoping. `workflow.requirement_quantifiable.enabled: false`
 *   (`resolveRequirementQuantifiableEnabled`, `@lore/core`) disables this check entirely —
 *   the write then proceeds exactly as it did pre-SPEC-059.
 * @invariant `removeRequirement` fails loud when the AC of ANY spec that is not deleted still lists the id in
 *   its `requirement_refs` (BR-692 — specs hang under no PRD, so the scan is corpus-wide), UNLESS `opts.force` — a forced removal leaves those refs dangling
 *   (they simply cover nothing) rather than silently rewriting AC declarations.
 * @invariant `migrateRequirement` (and `addRequirement` with `opts.requireLiveRule`) refuse a
 *   `migrated_to` rule that is not `live` in a baseline leaf (absent, deprecated or retired) with
 *   VALIDATION_ERROR — a migrated requirement could never be covered by such a rule (BR-983).
 * @invariant Writes are CAS-guarded and produce exactly one insertVersion + one audit entry.
 *
 * Side-effect class: IO (reads and writes via StoreInterface).
 * Source: SPEC-055 §Scope, §Design D2; SPEC-059 §Scope, §Design (requirement-layer lint).
 */

import {
  err,
  ok,
  prdRequirementsSchema,
  specAcceptanceCriteriaSchema,
  lintStatement,
  type Requirement,
  type Result,
  type LoreError,
  type DocId,
  type DocRecord,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";
import { buildRuleIndex } from "./ac-citations.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";

/** Options for {@link RequirementService.addRequirement}. */
export interface AddRequirementOpts {
  /** Refuse a `migrated_to` rule that is not `live` in a baseline leaf (CLI surfaces set this). */
  requireLiveRule?: boolean;
}

/** Options for {@link RequirementService.removeRequirement}. */
export interface RemoveRequirementOpts {
  /** Remove even when a spec AC still references this id (see class invariant). */
  force?: boolean;
}

export class RequirementService {
  /**
   * @param store - Storage abstraction (same instance passed to AcService)
   * @param requirementQuantifiableEnabled - Resolved `workflow.requirement_quantifiable.enabled`
   *   (SPEC-059 §Scope) — `false` disables `addRequirement`'s quantifiability lint entirely.
   *   Defaults to `true` (the schema default, `resolveRequirementQuantifiableEnabled(undefined)`)
   *   so a bare `new RequirementService(store)` unit-test construction stays gated ON, matching
   *   production's default-on behavior; `app.ts` wires the resolved config value explicitly.
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly requirementQuantifiableEnabled: boolean = true,
    /** The one write route (`CorpusService`, AC-DCL-3); `app.ts` passes the composed one, a bare test gets a bare writer. */
    writer?: DocWritePort,
  ) {
    this.writer = writer ?? bareDocWriter(store);
  }

  private readonly writer: DocWritePort;

  // ── addRequirement ──────────────────────────────────────────────────────────

  /**
   * Append a requirement to a PRD's `extra.requirements`. The FULL candidate array is
   * validated before writing — malformed id/priority, duplicate id, or the 101st entry all
   * fail loud with the doc unchanged.
   *
   * @param prdIdOrSlug - PRD document ULID or slug
   * @param requirement - Untrusted candidate (validated here, not by the caller)
   * @param opts - `{ requireLiveRule? }` — see {@link AddRequirementOpts}
   * @returns Updated requirement inventory after appending
   */
  async addRequirement(
    prdIdOrSlug: string,
    requirement: unknown,
    opts: AddRequirementOpts = {},
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
        rule: "BR-683",
      });
    }

    // reason: SPEC-059 §Design — service-layer lint (Option A), the requirement-layer
    // mirror of AcService.addCriterion's SPEC-052 wiring. Lint ONLY the newly-appended
    // entry (`parsed.data`'s last element — Zod array parsing preserves element order,
    // `candidate` never reorders `existing`) via the SAME zero-LLM `lintStatement`
    // primitive `lintAcQuantifiability` delegates to, never a second wordlist/heuristic.
    // A pre-existing vague requirement is NEVER retroactively blocked. Skipped entirely
    // when `workflow.requirement_quantifiable.enabled: false`. Enumerates ONE
    // `R-id: <word> → add a measurable token or benchmark anchor` line per offending
    // word (SPEC-059 §Design "enumerating ... per finding") — a statement carrying
    // multiple abstract words fails with every offender named, not just the first.
    if (this.requirementQuantifiableEnabled) {
      const newRequirement = parsed.data[parsed.data.length - 1];
      if (newRequirement !== undefined) {
        const findings = lintStatement(newRequirement.statement);
        if (findings.length > 0) {
          const message = findings
            .map((f) => `${newRequirement.id}: ${f.word} → add a measurable token or benchmark anchor`)
            .join("; ");
          return err({
            code: "VALIDATION_ERROR",
            field: `requirements.${newRequirement.id}`,
            message,
            value: requirement,
            rule: "BR-684",
          });
        }
      }
    }

    const addedRule = parsed.data[parsed.data.length - 1]?.migrated_to;
    if (opts.requireLiveRule === true && addedRule !== undefined) {
      const live = await this.requireLiveRule(addedRule);
      if (!live.ok) return live;
    }

    const writeResult = await this.writeRequirements(prd, parsed.data, "add");
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
  }

  // ── migrateRequirement ────────────────────────────────────────────────────────

  /**
   * Mark an existing requirement as migrated to baseline rule `ruleId` (BR-983): from now on
   * its coverage is "the rule has a live script-mode citing criterion". Re-migrating to a
   * different rule replaces `migrated_to`. Refuses a non-live rule.
   *
   * @param prdIdOrSlug - PRD document ULID or slug
   * @param reqId - Existing requirement id
   * @param ruleId - Baseline rule id (`BR-<n>`)
   * @returns Updated requirement inventory
   */
  async migrateRequirement(
    prdIdOrSlug: string,
    reqId: string,
    ruleId: string,
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
        rule: "BR-1001",
      });
    }
    const candidate = existing.map((r) => (r.id === reqId ? { ...r, migrated_to: ruleId } : r));
    const parsed = prdRequirementsSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `requirements.${issue.path.join(".")}` : "requirements",
        message: issue !== undefined ? issue.message : "Invalid migrated_to",
        value: ruleId,
        rule: "BR-1001",
      });
    }
    const live = await this.requireLiveRule(ruleId);
    if (!live.ok) return live;

    const writeResult = await this.writeRequirements(prd, parsed.data, "migrate");
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
   * Remove a requirement from a PRD. Fails if any spec that is not deleted still references the id in an
   * AC's `requirement_refs` (BR-692: every such spec is checked, wherever it is filed), unless `opts.force`.
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
        rule: "BR-690",
      });
    }

    if (opts.force !== true) {
      const refsResult = await this.gatherSpecAcRefs();
      if (!refsResult.ok) return refsResult;
      if (refsResult.value.has(reqId)) {
        return err({
          code: "VALIDATION_ERROR",
          field: "requirements[].id",
          message:
            `Cannot remove "${reqId}" — a spec acceptance criterion still references it. ` +
            "Pass --force to remove anyway (the AC ref keeps its value and becomes dangling).",
          value: reqId,
          rule: "BR-691",
        });
      }
    }

    const updated = existing.filter((r) => r.id !== reqId);
    const writeResult = await this.writeRequirements(prd, updated, "remove");
    if (!writeResult.ok) return writeResult;
    return ok(updated);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────────

  /** VALIDATION_ERROR unless `ruleId` is `live` in some baseline leaf (absent/deprecated/retired are refused). */
  private async requireLiveRule(ruleId: string): Promise<Result<true, LoreError>> {
    const leaves = await this.store.findMany({ type: "baseline" });
    if (!leaves.ok) return leaves;
    const rule = buildRuleIndex(leaves.value).get(ruleId);
    if (rule === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "migrated_to",
        message: `Rule "${ruleId}" is not in any baseline leaf — a requirement cannot migrate to a rule that does not exist`,
        value: ruleId,
        rule: "BR-1001",
      });
    }
    if (rule.lifecycle !== "live") {
      return err({
        code: "VALIDATION_ERROR",
        field: "migrated_to",
        message: `Rule "${ruleId}" is ${rule.lifecycle}, not live — a requirement cannot migrate to an inactive rule`,
        value: ruleId,
        rule: "BR-1001",
      });
    }
    return ok(true);
  }

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
        rule: "BR-686",
      });
    }
    return ok(doc);
  }

  /**
   * Every `requirement_refs` id declared across the ACs of EVERY spec that is not deleted, whatever its
   * status and wherever it is filed (BR-692). A spec has no parent, so no PRD owns a subset of them.
   */
  private async gatherSpecAcRefs(): Promise<Result<Set<string>, LoreError>> {
    const specsResult = await this.store.findMany({ type: "spec" });
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
   * Shared write path for add/remove/migrate: one `writeDoc` on the one write route (AC-DCL-3) — CAS-guarded
   * `extra.requirements` update, one version snapshot, one audit entry (`action: "update"`), in one transaction,
   * attributed to the CALLING actor (#298: it used to be the literal "system"), refused from a foreign-resolved
   * corpus. A requirement array equal to the stored one writes nothing.
   */
  private async writeRequirements(
    prd: DocRecord,
    requirements: Requirement[],
    operation: "add" | "remove" | "migrate",
  ): Promise<Result<DocRecord, LoreError>> {
    const written = await this.writer.writeDoc({
      doc: prd,
      patch: { extra: { ...prd.extra, requirements } },
      action: "update",
      changeSummary: `Requirements ${operation === "remove" ? "updated (removal)" : operation === "migrate" ? "updated (migration)" : "updated"} — ${requirements.length} entries`,
      auditAction: "update",
      auditDetails: { operation, requirement_count: requirements.length },
      lock: "none",
    });
    if (!written.ok) return written;
    return ok(written.value.doc);
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
