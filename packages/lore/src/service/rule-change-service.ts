/**
 * RuleChangeService — the dedicated writer of a spec's rule change set (`extra.rule_changes`).
 *
 * Purpose: a rule a spec is about to add / modify / retire lives in that spec's change set, NOT in a baseline
 *   leaf, until the spec lands (spec-a-spec-carries-its-rule-changes-the-baseline-takes-them). This service is the
 *   ONLY writer of `extra.rule_changes` (`CorpusService.set` refuses to touch it: DEDICATED_EXTRA_KEYS).
 *
 * Public surface:
 *   propose(spec, input, opts?) → { change, doc }   (add reserves a `proposed` id; modify/retire name a live id)
 *   changes(spec)               → { spec, changes } (read; fails loud on a corrupt stored change set)
 *   setCorpusWriteContext(ctx)                      (claim-scoped authoring guard, armed once per CLI process)
 *
 * Invariants:
 *   - Every method returns `Result<_, LoreError>`; a domain refusal never throws.
 *   - `add` reserves the next permanent BR id in registry state `proposed` AND writes the spec in ONE store
 *     transaction (`reserveProposedRuleAndUpdateSpec`): a refused or stale write burns no id; NO leaf is touched.
 *   - `modify` / `retire` name a rule that is `live` in the tree; a rule another spec already modifies or retires
 *     (that spec not deprecated) is refused naming that spec. One spec holds at most one entry per rule id: a
 *     second `modify` / `retire` of the same id replaces its earlier entry.
 *   - A locked spec's change set is locked like its criteria: refused by `RecordLockService.assertEditable`
 *     unless `opts.correction` (BR-1069, same exit as `AcService.setCriterion`): one version, status kept, reason
 *     in `change_summary` and the audit row. An unlocked approved spec is demoted to draft, like any contract edit.
 *   - Writes are CAS-guarded; on STALE_VERSION the proposal is re-validated against a fresh read at most
 *     {@link MAX_CAS_REAPPLIES} times, then STALE_VERSION is returned — no silent last-writer-wins.
 *
 * Side-effect class: IO (reads and writes via StoreInterface).
 * Source: spec-a-spec-carries-its-rule-changes-the-baseline-takes-them (Model, Scope, Edge cases); BR-1069.
 */

import { err, ok, type Result } from "@lore/core";
import type { AuditEntry, DocRecord, DocStatus, LoreError, RuleChange, VersionRecord } from "@lore/core";
import {
  resolveStatusAfterContractEdit,
  ruleChangeSchema,
  ruleIdPrefixOfNode,
  specRuleChangesSchema,
  type BaselineRule,
} from "@lore/core";

/** How a rule is enforced: `guaranteed` | `both` | `prompt-only` (the baseline rule schema's own enum). */
export type RuleEnforcement = BaselineRule["enforced_by"];
import type { StoreInterface } from "../store/store-interface.js";
import { resolveWriteActorFor } from "../store/write-context-store.js";
import { CorpusWriteAuthority, type CorpusWriteAuthorityContext } from "./foreign-corpus-write-guard.js";
import { RecordLockService } from "./record-lock-service.js";
import { resolveDoc } from "./resolve.js";
import { collectLeafRules } from "./rule-index-queries.js";
import { findOtherSpecChange, findProposal, ruleChangesOf } from "./rule-changes.js";

/** Immediate re-applies after a CAS miss before the STALE_VERSION error is surfaced. */
export const MAX_CAS_REAPPLIES = 3;

/** Placeholder id used only to pre-validate an `add` before the registry allocates the real one. */
const PREVALIDATION_ID = "BR-999999999";

/** What a caller proposes. `add` carries no id: the registry allocates it. */
export type ProposeRuleChangeInput =
  | { op: "add"; leaf: string; statement: string; examples: string[]; enforced_by: RuleEnforcement }
  | { op: "modify"; id: string; statement?: string; examples?: string[]; enforced_by?: RuleEnforcement }
  | { op: "retire"; id: string; note: string };

/** Options of {@link RuleChangeService.propose}. */
export interface ProposeOpts {
  /** Acting identity; omitted → the write-context / environment chain. */
  by?: string;
  /** The audited exit for a LOCKED spec (BR-1069): why this write is a fix, not a change. */
  correction?: { reason: string };
}

/** Result of {@link RuleChangeService.changes}. */
export interface RuleChangeList {
  /** The spec's slug. */
  spec: string;
  changes: RuleChange[];
}

function validationError(field: string, message: string, value?: unknown): LoreError {
  return value === undefined
    ? { code: "VALIDATION_ERROR", field, message }
    : { code: "VALIDATION_ERROR", field, message, value };
}

function staleExhausted(id: string): LoreError {
  return {
    code: "STORE_ERROR",
    message: `CAS re-apply budget (${MAX_CAS_REAPPLIES}) exhausted for ${id} without a recorded STALE_VERSION`,
  };
}

export class RuleChangeService {
  private writeAuthority: CorpusWriteAuthority | undefined;

  /**
   * @param store - Storage abstraction.
   * @param recordLock - The ONE lock resolver (REQUIRED, like every rewrite-path service): the change set of a
   *   locked spec is refused through it.
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly recordLock: RecordLockService,
  ) {}

  /**
   * Arms the claim-scoped corpus-write guard (same context `RuleService` receives). Absent ⇒ every write is
   * ungated, exactly as before the guard existed.
   */
  setCorpusWriteContext(context: CorpusWriteAuthorityContext): void {
    this.writeAuthority = new CorpusWriteAuthority(this.store, context);
  }

  /**
   * Add one entry to a spec's change set.
   *
   * @param specRef - Spec id or slug; a non-spec doc → VALIDATION_ERROR.
   * @param input - `add` (reserves the next BR id, `proposed`), `modify` (a live id; at least one field) or
   *   `retire` (a live id; a non-blank note).
   * @param opts.correction - required on a LOCKED spec; a blank reason → VALIDATION_ERROR `correction.reason`.
   * @returns `{ change, doc }` — the stored entry (an `add` carries its reserved id) and the updated spec.
   *   VALIDATION_ERROR for an invalid input, an unknown / non-live id, a rule another spec already changes
   *   (naming it) or a locked spec without a correction (`field: "gate:record-edit"`); DOC_NOT_FOUND; STALE_VERSION.
   * @example
   * await rules.propose("spec-x", { op: "add", leaf: "baseline-claims", statement: "…", examples: ["…"],
   *   enforced_by: "both" }, { by: "agent:x" });
   */
  async propose(
    specRef: string,
    input: ProposeRuleChangeInput,
    opts: ProposeOpts = {},
  ): Promise<Result<{ change: RuleChange; doc: DocRecord }, LoreError>> {
    const actor = resolveWriteActorFor(this.store, opts.by);
    const shaped = shapeInput(input);
    if (!shaped.ok) return shaped;
    const specResult = await this.resolveSpec(specRef);
    if (!specResult.ok) return specResult;

    const exit = await this.resolveLockExit(specResult.value, opts.correction);
    if (!exit.ok) return exit;
    const correctionReason = exit.value.correctionReason;

    const authorized = await this.authorizeTarget(shaped.value, actor);
    if (!authorized.ok) return authorized;
    const leaf = authorized.value;

    let lastStale: LoreError | undefined;
    for (let attempt = 0; attempt <= MAX_CAS_REAPPLIES; attempt += 1) {
      const fresh = await this.readSpec(specResult.value.id);
      if (!fresh.ok) return fresh;
      const spec = fresh.value;
      const status = exit.value.keepStatus ? spec.status : resolveStatusAfterContractEdit(spec.status, true);
      const summary = correctionReason !== undefined
        ? `Correction: ${correctionReason}`
        : `Rule change proposed: ${shaped.value.op} ${shaped.value.op === "add" ? "(new rule)" : shaped.value.id}`;
      const written = shaped.value.op === "add"
        ? await this.writeAdd(spec, shaped.value, leaf, status, summary, actor)
        : await this.writeAmend(spec, shaped.value, status, summary, actor, correctionReason);
      if (!written.ok) {
        if (written.error.code === "STALE_VERSION") { lastStale = written.error; continue; }
        return written;
      }
      return written;
    }
    return err(lastStale ?? staleExhausted(specResult.value.id as string));
  }

  /**
   * A spec's change set, in stored order.
   *
   * @returns `{ spec, changes }`; VALIDATION_ERROR when the stored `extra.rule_changes` is corrupt (never a
   *   silently shortened list); DOC_NOT_FOUND / VALIDATION_ERROR for an unresolvable or non-spec reference.
   */
  async changes(specRef: string): Promise<Result<RuleChangeList, LoreError>> {
    const specResult = await this.resolveSpec(specRef);
    if (!specResult.ok) return specResult;
    const raw = specResult.value.extra["rule_changes"];
    if (raw === undefined) return ok({ spec: specResult.value.slug, changes: [] });
    const parsed = specRuleChangesSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(validationError(
        `extra.rule_changes${issue !== undefined && issue.path.length > 0 ? `.${issue.path.join(".")}` : ""}`,
        `the stored change set of ${specResult.value.slug} is invalid: ${issue?.message ?? "invalid"}`,
      ));
    }
    return ok({ spec: specResult.value.slug, changes: parsed.data });
  }

  // ── write paths ──────────────────────────────────────────────────────────

  private async writeAdd(
    spec: DocRecord,
    change: Extract<RuleChange, { op: "add" }>,
    leaf: DocRecord | undefined,
    status: DocStatus,
    summary: string,
    actor: string,
  ): Promise<Result<{ change: RuleChange; doc: DocRecord }, LoreError>> {
    if (leaf === undefined) return err(validationError("leaf", "an add needs a resolved baseline leaf"));
    let stored: RuleChange | undefined;
    const reserved = await this.store.reserveProposedRuleAndUpdateSpec(
      {
        specId: spec.id,
        expectedVersion: spec.version,
        ownerLeafId: leaf.id,
        status,
        changeSummary: summary,
        buildExtra: (ruleId) => {
          stored = { ...change, id: ruleId, leaf: leaf.slug };
          return { ...spec.extra, rule_changes: [...ruleChangesOf(spec.extra), stored] };
        },
      },
      actor,
      "BR",
    );
    if (!reserved.ok) return reserved;
    if (stored === undefined) return err({ code: "STORE_ERROR", message: "reservation committed without building the change" });
    const audited = await this.appendAudit(actor, reserved.value.doc, { change_op: "add", rule_id: reserved.value.ruleId });
    if (!audited.ok) return audited;
    return ok({ change: stored, doc: reserved.value.doc });
  }

  private async writeAmend(
    spec: DocRecord,
    change: Exclude<RuleChange, { op: "add" }>,
    status: DocStatus,
    summary: string,
    actor: string,
    correctionReason: string | undefined,
  ): Promise<Result<{ change: RuleChange; doc: DocRecord }, LoreError>> {
    const checked = await this.checkAmendable(spec, change);
    if (!checked.ok) return checked;
    const existing = ruleChangesOf(spec.extra);
    const replaced = existing.some((c) => c.id === change.id);
    const next = replaced ? existing.map((c) => (c.id === change.id ? change : c)) : [...existing, change];
    const extra = { ...spec.extra, rule_changes: next };
    const now = new Date().toISOString();
    const version = spec.version + 1;
    const versionRecord: VersionRecord = {
      doc_id: spec.id,
      version,
      content: spec.content,
      extra,
      status,
      title: spec.title,
      action: "update",
      created_at: now,
      created_by: actor,
      change_summary: summary,
      slug: spec.slug,
    };
    const audit: AuditEntry = {
      timestamp: now,
      actor,
      session_id: spec.id,
      action: "update",
      doc_id: spec.id,
      details: {
        operation: "rule-propose",
        change_op: change.op,
        rule_id: change.id,
        version,
        ...(correctionReason !== undefined ? { correction: { reason: correctionReason } } : {}),
      },
    };
    const written = await this.store.updateWithProvenance(
      spec.id,
      { extra, status, version, updated_at: now },
      { expected_version: spec.version },
      versionRecord,
      audit,
    );
    if (!written.ok) return written;
    return ok({ change, doc: written.value });
  }

  /**
   * `modify` / `retire` need a rule that is live in the tree and not already changed by another spec.
   * Re-run on every CAS attempt, so a concurrent proposal by another spec is seen.
   */
  private async checkAmendable(spec: DocRecord, change: Exclude<RuleChange, { op: "add" }>): Promise<Result<void, LoreError>> {
    const baseline = await this.store.findMany({ type: "baseline" });
    if (!baseline.ok) return baseline;
    const specs = await this.store.findMany({ type: "spec" });
    if (!specs.ok) return specs;
    const live = collectLeafRules(baseline.value).get(change.id);
    if (live === undefined || live.lifecycle !== "live") {
      const proposal = findProposal(change.id, specs.value);
      const why = proposal !== undefined
        ? `${change.id} is proposed by ${proposal.spec.slug} and not in the baseline yet`
        : live === undefined
          ? `${change.id} is not a rule of the baseline`
          : `${change.id} is ${live.lifecycle}, not live`;
      return err(validationError("id", `a ${change.op} names a LIVE rule: ${why}`, change.id));
    }
    const other = findOtherSpecChange(change.id, specs.value, spec.id as string);
    if (other !== undefined) {
      return err(validationError(
        "id",
        `${change.id} is already ${other.change.op === "retire" ? "retired" : "modified"} by the unlanded change set of ${other.spec.slug}; ` +
          `that spec must land or be deprecated before another spec changes it`,
        change.id,
      ));
    }
    return ok(undefined);
  }

  // ── gates ────────────────────────────────────────────────────────────────

  /**
   * The record-edit gate for a change-set write, with the BR-1069 correction exit.
   * @returns `keepStatus` true when the spec is a locked record being corrected (no demotion).
   */
  private async resolveLockExit(
    spec: DocRecord,
    correction: ProposeOpts["correction"],
  ): Promise<Result<{ keepStatus: boolean; correctionReason: string | undefined }, LoreError>> {
    let correctionApplies = false;
    let correctionReason: string | undefined;
    if (correction !== undefined) {
      correctionReason = correction.reason.trim();
      if (correctionReason.length === 0) {
        return err(validationError(
          "correction.reason",
          'a correction needs a non-empty reason (--correction "<why this is a fix, not a change>")',
          correction.reason,
        ));
      }
      const lock = await this.recordLock.resolve(spec);
      if (!lock.ok) return lock;
      correctionApplies = lock.value.standing === "record" && lock.value.locked;
    }
    if (!correctionApplies) {
      // reason: the change set is part of the spec's contract, so it is gated as the "criteria" rewrite path —
      // the same op `AcService` uses; the refusal prose names the same correction exit.
      const gate = await this.recordLock.assertEditable(spec, "criteria");
      if (!gate.ok) return gate;
    }
    return ok({ keepStatus: correctionApplies, correctionReason });
  }

  /**
   * Resolve the leaf an `add` lands on (a business leaf), or the leaf carrying the live rule a `modify` /
   * `retire` names, and authorize the write against the caller's claim scope (inert without a context).
   * A modify / retire of an unknown id resolves no leaf here; {@link checkAmendable} reports it.
   */
  private async authorizeTarget(change: RuleChange, actor: string): Promise<Result<DocRecord | undefined, LoreError>> {
    let leaf: DocRecord | undefined;
    if (change.op === "add") {
      const resolved = await resolveDoc(this.store, change.leaf);
      if (!resolved.ok) return resolved;
      if (resolved.value.type !== "baseline" || ruleIdPrefixOfNode(resolved.value.extra) !== "BR") {
        return err(validationError("leaf", `an add lands on a business leaf; '${change.leaf}' is not one`, change.leaf));
      }
      leaf = resolved.value;
    } else {
      const baseline = await this.store.findMany({ type: "baseline" });
      if (!baseline.ok) return baseline;
      leaf = collectLeafRules(baseline.value).get(change.id)?.leaf;
    }
    if (this.writeAuthority !== undefined && leaf !== undefined) {
      const verdict = await this.writeAuthority.authorize([leaf], "rule-propose", actor);
      if (!verdict.ok) return verdict;
    }
    return ok(leaf);
  }

  // ── reads ────────────────────────────────────────────────────────────────

  private async resolveSpec(specRef: string): Promise<Result<DocRecord, LoreError>> {
    const resolved = await resolveDoc(this.store, specRef);
    if (!resolved.ok) return resolved;
    if (resolved.value.type !== "spec") {
      return err(validationError("spec", `a rule change set belongs to a spec; '${specRef}' is a ${resolved.value.type}`, resolved.value.type));
    }
    return ok(resolved.value);
  }

  private async readSpec(id: DocRecord["id"]): Promise<Result<DocRecord, LoreError>> {
    const found = await this.store.find(id);
    if (!found.ok) return found;
    if (found.value === null || found.value.deleted_at !== null) return err({ code: "DOC_NOT_FOUND", id });
    return ok(found.value);
  }

  private async appendAudit(actor: string, doc: DocRecord, details: Record<string, unknown>): Promise<Result<void, LoreError>> {
    return this.store.appendAuditEntry({
      timestamp: new Date().toISOString(),
      actor,
      session_id: doc.id,
      action: "update",
      doc_id: doc.id,
      details: { ...details, operation: "rule-propose", version: doc.version },
    });
  }
}

/**
 * Validate a caller's input with the stored-shape schema (`add` against a placeholder id) so a refusal burns no
 * id and the CLI cannot write a shape the reader would later drop.
 */
function shapeInput(input: ProposeRuleChangeInput): Result<RuleChange, LoreError> {
  const candidate =
    input.op === "add" ? { ...input, id: PREVALIDATION_ID } : input.op === "retire" ? { ...input, note: input.note.trim() } : input;
  const parsed = ruleChangeSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(validationError(
      issue !== undefined && issue.path.length > 0 ? String(issue.path[0]) : "change",
      issue !== undefined ? issue.message : "invalid rule change",
    ));
  }
  if (parsed.data.op === "modify" && parsed.data.statement === undefined && parsed.data.examples === undefined && parsed.data.enforced_by === undefined) {
    return err(validationError("change", "a modify must change at least one of statement, examples, enforced_by"));
  }
  if (parsed.data.op === "retire" && parsed.data.note.trim().length === 0) {
    return err(validationError("note", "a retire needs a non-blank note naming why the rule is no longer true"));
  }
  return ok(parsed.data);
}
