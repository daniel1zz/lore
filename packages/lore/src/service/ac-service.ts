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
 *   setCriterion(specIdOrSlug, acId, patch)        → AcceptanceCriterion[] (updated list) —
 *     in-place edit of ONE declared criterion (spec-lore-ac-set-in-place-edit-of-a-declared-
 *     acceptance, D1-D6). `id`/`mode` are immutable; `statement`/`covers` are mode-agnostic;
 *     `oracle`/`command` (script) / `rubric` (ai) / `note` (human) are mode-specific and
 *     rejected as VALIDATION_ERROR when passed against a criterion of a different mode (D5).
 *
 * @invariant All methods return Promise<Result<T, LoreError>> — no thrown exceptions.
 * @invariant `addCriterion` validates the FULL candidate array (existing + new) via
 *   `specAcceptanceCriteriaSchema` in one `safeParse` call — covers the new entry's own
 *   shape (id format, verify discriminant) AND array-level constraints (max 50, unique
 *   id) simultaneously. Mirrors `CorpusService.set`'s single-shot spec-extra validation
 *   (schemas.ts's `spec_kind` superRefine precedent) rather than re-deriving per-field
 *   checks here.
 * @invariant `addCriterion` ALSO rejects an unquantified abstract-quality claim in the
 *   new entry's `statement` (AC-Quantifiability Gate spec §Design) — the deterministic,
 *   zero-LLM `lintAcQuantifiability` lint (`@lore/core`, ac-quality.ts) runs AFTER shape
 *   validation succeeds and BEFORE the CAS write, so a `lore ac add` with an
 *   unquantified AC never reaches the store. This is the immediate-feedback layer; the
 *   `acQuantifiable` gate predicate (`gate-predicates.ts`, wired into `spec-create`/
 *   `spec-promote`) is the backstop for ACs added through any other path.
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
 * @invariant `setCriterion` applies the SAME approved→draft demotion rule
 *   `CorpusService.set` applies to a content/title edit (`isApprovedAutoResetToDraft`
 *   in corpus-service.ts: `existing.status === "approved" && contentChanged` ⇒
 *   `"draft"`) — an in-place AC edit changes the spec's governing contract exactly as
 *   much as a content edit does (D2). This is a MIRROR, not a shared import: services
 *   in this module never cross-import each other (see module CLAUDE.md "no
 *   cross-service imports"); the one-line predicate is trivial enough that
 *   `computeSetStatus` below and `corpus-service.ts`'s own inline check are each other's
 *   single source of truth for the RULE (not the code), cross-referenced by name in
 *   both places so a future edit to one is a deliberate signal to check the other.
 *
 * Side-effect class: IO (reads and writes via StoreInterface).
 * Source: SPEC-038 §4, §6, §7 D4; spec-lore-ac-set-in-place-edit-of-a-declared-acceptance D1-D6
 */

import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import {
  specAcceptanceCriteriaSchema,
  computeAcCoverage,
  extractEvidence,
  lintAcQuantifiability,
  type AcceptanceCriterion,
  type AcCoverageFact,
  type AcVerifyMode,
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

/**
 * Patch for {@link AcService.setCriterion} — every field optional, each one present
 * REPLACES that field on the target criterion, each one absent leaves it untouched
 * (D1). Deliberately has no `id`/`mode` field — those two are NOT editable through
 * this verb (D1): a caller wanting to change `mode` must use `rm` + `add` instead,
 * which this type cannot even represent, making the immutability structural rather
 * than a runtime check alone.
 *
 * @invariant `statement` and `covers` are mode-agnostic — every criterion has a
 *   statement, and any criterion may declare covered PRD requirement ids.
 * @invariant `oracle`/`command` apply only to a `mode: "script"` criterion, `rubric`
 *   only to `"ai"`, `note` only to `"human"` — passing one against a criterion of a
 *   different mode is VALIDATION_ERROR (D5), never silently accepted-and-dropped.
 * @invariant `covers`, when present, REPLACES `requirement_refs` wholesale — an
 *   empty array (`[]`) clears it. `undefined` (the field omitted) leaves the
 *   existing `requirement_refs` untouched. The caller (CLI `commands/ac.ts`) is
 *   responsible for turning a bare `--covers ""` into `[]` before calling here.
 */
export interface SetCriterionPatch {
  statement?: string;
  oracle?: string;
  command?: string;
  rubric?: string;
  note?: string;
  covers?: string[];
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

    // reason: AC-Quantifiability Gate spec §Design — this is the PRIMARY, immediate
    // enforcement point (the spec-create/spec-promote gate predicate, `acQuantifiable`
    // in `gate-predicates.ts`, is the BACKSTOP that re-lints the whole declared set).
    // Lint ONLY the newly-appended entry — `existing` entries were already accepted
    // through this same check (or predate the gate; the backstop catches those at
    // spec-promote) — via the SAME zero-LLM `lintAcQuantifiability` lint, never a
    // second wordlist/heuristic. `parsed.data`'s last element is the validated form
    // of `criterion` (Zod array parsing preserves element order — `candidate` never
    // reorders `existing`).
    const newCriterion = parsed.data[parsed.data.length - 1];
    if (newCriterion !== undefined) {
      const findings = lintAcQuantifiability([newCriterion]).filter((f) => f.severity === "block");
      const finding = findings[0];
      if (finding !== undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: `acceptance_criteria.${finding.ac_id}`,
          message: finding.message,
          value: criterion,
        });
      }
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

  // ── setCriterion ──────────────────────────────────────────────────────────

  /**
   * Edit ONE declared acceptance criterion in place — `id` stable, every OTHER
   * criterion and every other `extra` key untouched (D6), no `--force`, ever.
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @param acId - The criterion's id (unchanged by this call — see {@link SetCriterionPatch})
   * @param patch - Fields to replace; at least one MUST be present (D3 — a
   *   completely-empty patch is VALIDATION_ERROR here as defense in depth, though the
   *   CLI already refuses it pre-service at exit 2, argv-decidable, before this method
   *   is ever called — D5a)
   * @returns Updated criteria array (all entries, target replaced in place)
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / empty patch / unknown id,
   *   naming the declared ids (D4) / a mode-inconsistent flag, naming the flag and the
   *   criterion's actual mode (D5) / malformed resulting shape), STALE_VERSION
   *
   * @example
   * await acService.setCriterion("spec-my-feature", "AC-ACODE-1", {
   *   statement: "Rejects malformed input with a named field",
   * });
   */
  async setCriterion(
    specIdOrSlug: string,
    acId: string,
    patch: SetCriterionPatch,
  ): Promise<Result<AcceptanceCriterion[], LoreError>> {
    const hasAnyField =
      patch.statement !== undefined ||
      patch.oracle !== undefined ||
      patch.command !== undefined ||
      patch.rubric !== undefined ||
      patch.note !== undefined ||
      patch.covers !== undefined;
    if (!hasAnyField) {
      return err({
        code: "VALIDATION_ERROR",
        field: "patch",
        message:
          "lore ac set requires at least one field to change: --statement, --oracle, --command, --rubric, --note, --covers",
        value: patch,
      });
    }

    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    const existing = extractCriteria(spec);
    const index = existing.findIndex((c) => c.id === acId);
    if (index === -1) {
      const declaredIds = existing.map((c) => c.id);
      return err({
        code: "VALIDATION_ERROR",
        field: "acceptance_criteria[].id",
        message:
          declaredIds.length > 0
            ? `Acceptance criterion "${acId}" is not declared on this spec. Declared ids: ${declaredIds.join(", ")}`
            : `Acceptance criterion "${acId}" is not declared on this spec — no criteria are declared yet`,
        value: acId,
      });
    }
    const target = existing[index] as AcceptanceCriterion;

    // D5 — mode-inconsistent flag guard: VALIDATION_ERROR (document-state fault,
    // D5a) naming BOTH the offending flag and the criterion's actual mode. Checked
    // in a fixed order (oracle, command, rubric, note) so a caller passing more
    // than one wrong flag at once still gets a single deterministic message.
    const mode = target.verify.mode;
    if (patch.oracle !== undefined && mode !== "script") {
      return err(modeMismatchError(acId, "--oracle", mode));
    }
    if (patch.command !== undefined && mode !== "script") {
      return err(modeMismatchError(acId, "--command", mode));
    }
    if (patch.rubric !== undefined && mode !== "ai") {
      return err(modeMismatchError(acId, "--rubric", mode));
    }
    if (patch.note !== undefined && mode !== "human") {
      return err(modeMismatchError(acId, "--note", mode));
    }

    const candidateCriterion: Record<string, unknown> = {
      id: target.id,
      statement: patch.statement ?? target.statement,
      verify: buildVerifyCandidate(target.verify, patch),
      ...(patch.covers !== undefined
        ? { requirement_refs: patch.covers }
        : target.requirement_refs !== undefined
          ? { requirement_refs: target.requirement_refs }
          : {}),
    };

    const candidateArray = existing.map((c, i) => (i === index ? candidateCriterion : c));
    const parsed = specAcceptanceCriteriaSchema.safeParse(candidateArray);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `acceptance_criteria.${issue.path.join(".")}` : "acceptance_criteria",
        message: issue !== undefined ? issue.message : "Invalid acceptance criterion",
        value: candidateCriterion,
      });
    }

    // D2 — mirrors CorpusService.set's isApprovedAutoResetToDraft (see class
    // invariant above): an approved spec demotes to draft on this edit; a
    // non-approved spec's status is untouched.
    const newStatus = computeSetStatus(spec.status);

    const writeResult = await this.writeCriteria(spec, parsed.data, "set", { status: newStatus, acId });
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
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
   * Shared CAS-guarded write path for addCriterion/removeCriterion/setCriterion: bumps
   * the spec's version, writes one insertVersion snapshot, then one audit entry (action
   * "update", actor "system") — same shape as CorpusService.set's spec-extra write, so
   * AuditService.verify's versions⋈audit completeness oracle needs no special case.
   *
   * @param opts.status - Explicit status to write (setCriterion's D2 demotion); omitted
   *   for add/remove, which never change status — defaults to `spec.status` unchanged.
   * @param opts.acId - The edited criterion's id, for setCriterion's change_summary/audit
   *   `details` only (add/remove operate on the whole array, no single id to name).
   */
  private async writeCriteria(
    spec: DocRecord,
    criteria: AcceptanceCriterion[],
    operation: "add" | "remove" | "set",
    opts: { status?: DocRecord["status"]; acId?: string } = {},
  ): Promise<Result<DocRecord, LoreError>> {
    const now = new Date().toISOString();
    const newVersion = spec.version + 1;
    const newExtra: Record<string, unknown> = { ...spec.extra, acceptance_criteria: criteria };
    const newStatus = opts.status ?? spec.status;

    const updateResult = await this.store.update(
      spec.id,
      { extra: newExtra, updated_at: now, version: newVersion, status: newStatus },
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
      change_summary:
        operation === "set"
          ? buildSetChangeSummary(criteria.length, opts.acId, spec.status, newStatus)
          : `Acceptance criteria ${operation === "add" ? "updated" : "updated (removal)"} — ${criteria.length} entries`,
      // SPEC-072 D1/D2 — this write path only touches `extra`; carry the
      // current (unchanged) slug.
      slug: updateResult.value.slug,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: "system",
      session_id: spec.id,
      action: "update",
      doc_id: spec.id,
      details: {
        operation,
        criteria_count: criteria.length,
        version: newVersion,
        ...(opts.acId !== undefined ? { ac_id: opts.acId } : {}),
      },
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

/**
 * Build the candidate `verify` object for {@link AcService.setCriterion} — mode is
 * ALWAYS carried over from `existingVerify` unchanged (D1: not editable through this
 * verb); each mode-specific field is `patch`'s value when supplied, else the
 * existing value. Deliberately returns `Record<string, unknown>` (not the typed
 * `AcceptanceCriterion["verify"]` union) — same pattern `commands/ac.ts`'s
 * `buildCriterionCandidate` already uses for `add`: the candidate is validated by
 * `specAcceptanceCriteriaSchema.safeParse` immediately after, which is the single
 * source of truth for shape correctness, not this assembly step.
 */
function buildVerifyCandidate(
  existingVerify: AcceptanceCriterion["verify"],
  patch: SetCriterionPatch,
): Record<string, unknown> {
  switch (existingVerify.mode) {
    case "script":
      return {
        mode: "script",
        oracle: patch.oracle ?? existingVerify.oracle,
        command: patch.command ?? existingVerify.command,
        ...(existingVerify.timeout_ms !== undefined ? { timeout_ms: existingVerify.timeout_ms } : {}),
      };
    case "ai":
      return { mode: "ai", rubric: patch.rubric ?? existingVerify.rubric };
    case "human":
      return {
        mode: "human",
        ...(patch.note !== undefined
          ? { note: patch.note }
          : existingVerify.note !== undefined
            ? { note: existingVerify.note }
            : {}),
      };
  }
}

/**
 * D5's VALIDATION_ERROR for a flag that does not apply to the target criterion's
 * mode — names BOTH the flag and the actual mode (D5: "accepting-and-dropping would
 * let a caller believe an oracle was rewritten when it was not"). Exit-4 family per
 * D5a: this is decidable only against the RESOLVED document's declared mode, never
 * from argv alone.
 */
function modeMismatchError(acId: string, flag: string, actualMode: AcVerifyMode): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "verify",
    message: `${flag} only applies to a "${modeFieldName(flag)}"-mode criterion — "${acId}" is mode "${actualMode}"`,
    value: { ac_id: acId, flag, mode: actualMode },
  };
}

/** The verify mode a given mode-specific flag belongs to (for modeMismatchError's message). */
function modeFieldName(flag: string): AcVerifyMode {
  if (flag === "--oracle" || flag === "--command") return "script";
  if (flag === "--rubric") return "ai";
  return "human";
}

/**
 * D2 — mirrors CorpusService.set's `isApprovedAutoResetToDraft` rule
 * (`existing.status === "approved" && contentChanged` ⇒ `"draft"`). Every
 * `setCriterion` call changes governing content by construction (the empty-patch
 * case already returned VALIDATION_ERROR before this is reached), so the
 * `contentChanged` conjunct is always true here — this function only re-states the
 * `existingStatus === "approved"` half.
 */
function computeSetStatus(existingStatus: DocRecord["status"]): DocRecord["status"] {
  return existingStatus === "approved" ? "draft" : existingStatus;
}

/**
 * change_summary for a `setCriterion` write — names the edited id, and appends a
 * demotion note ONLY when this write actually moved `approved` → `draft` (AC-ACS-4:
 * the draft-stays-draft case must show no status-transition text at all).
 */
function buildSetChangeSummary(
  count: number,
  acId: string | undefined,
  fromStatus: DocRecord["status"],
  toStatus: DocRecord["status"],
): string {
  const base = `Acceptance criterion "${acId ?? "?"}" updated — ${count} entries`;
  return fromStatus === "approved" && toStatus === "draft" ? `${base} (demoted approved → draft on edit)` : base;
}
