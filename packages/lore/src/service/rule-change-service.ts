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
 *   apply(spec, opts?)          → RuleApplyOutcome  (LANDING: the one writer from a change set to the tree, D3;
 *                                  implements {@link RuleChangeLandingPort})
 *   setCorpusWriteContext(ctx)                      (claim-scoped authoring guard, armed once per CLI process)
 *
 * Landing invariants (`apply`):
 *   - Evidence-gated (D2): every criterion of the spec citing a changed id needs a runner-attested pass, and every
 *     `add` / `modify` id must be cited by some criterion (an unproven change); a `retire` needs no evidence
 *     (`measureLandingEvidence`). Otherwise VALIDATION_ERROR naming the criteria / ids and NOTHING is written.
 *   - Each touched leaf is written ONCE (one version, status demoted like any contract edit, the spec named in
 *     the version's change summary); `proposed` ids become `live` (the registry follows the leaf in the same
 *     transaction), `modify` rewrites statement/examples/enforced_by, `retire` sets `retired` + note.
 *   - Idempotent: landed entries carry `applied_at`; a second apply writes nothing. A crash between the leaf
 *     writes and the spec marker is repaired by re-running apply (leaf edits that already hold are skipped).
 *   - A DEPRECATED spec never lands: apply retires its still-`proposed` ids with the note "never landed: <spec>"
 *     (a tombstone in the owner leaf, so the id keeps resolving). `modify` / `retire` entries touch no rule.
 *   - A landed `add` enters the tree with confidence `established`: the spec that proposed it decided it.
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
  baselineExtraSchema,
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
import { findOtherSpecChange, findProposal, isLanded, ruleChangesOf } from "./rule-changes.js";
import { measureLandingEvidence } from "./landing-evidence.js";
import type { RuleApplyLeafWrite, RuleApplyOpts, RuleApplyOutcome, RuleChangeLandingPort } from "./rule-landing-port.js";

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

/** Confidence a landed `add` carries: the proposing spec decided the rule, so it is not `observed`/`unconfirmed`. */
const LANDED_RULE_CONFIDENCE: BaselineRule["confidence"] = "established";

/** Confidence of the tombstone left for an id whose spec never landed: the rule was never decided or built. */
const TOMBSTONE_RULE_CONFIDENCE: BaselineRule["confidence"] = "unconfirmed";

/** What one apply pass does to one leaf: the new `extra` and the rule ids it touches. */
interface LeafPlan {
  readonly extra: Record<string, unknown>;
  readonly touched: string[];
}

export class RuleChangeService implements RuleChangeLandingPort {
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
      const fresh = await this.readDoc(specResult.value.id);
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
    const stored = readChangeSet(specResult.value);
    if (!stored.ok) return stored;
    return ok({ spec: specResult.value.slug, changes: stored.value });
  }

  /**
   * Land a spec's change set in the baseline tree (D2, D3) — or, for a DEPRECATED spec, retire its proposed ids.
   *
   * @param specRef - Spec id or slug; a non-spec doc → VALIDATION_ERROR.
   * @param opts.by - acting identity.
   * @returns `applied` (leaves written, one version each), `noop` (nothing pending), or `abandoned` (deprecated
   *   spec). VALIDATION_ERROR naming every criterion that cites a changed id without a runner-attested pass
   *   (nothing written); STALE_VERSION after the CAS re-apply budget; DOC_NOT_FOUND.
   * @example
   * const landed = await rules.apply("spec-x", { by: "agent:x" });
   * if (landed.ok && landed.value.kind === "applied") landed.value.leaves; // [{ leaf, version, rules }]
   */
  async apply(specRef: string, opts: RuleApplyOpts = {}): Promise<Result<RuleApplyOutcome, LoreError>> {
    const actor = resolveWriteActorFor(this.store, opts.by);
    const specResult = await this.resolveSpec(specRef);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;
    const stored = readChangeSet(spec);
    if (!stored.ok) return stored;
    if (stored.value.length === 0) return ok({ kind: "noop", spec: spec.slug, reason: "no-changes" });
    if (spec.status === "deprecated") return this.abandon(spec, stored.value, actor);

    const pending = stored.value.filter((change) => !isLanded(change));
    if (pending.length === 0) return ok({ kind: "noop", spec: spec.slug, reason: "already-applied" });

    const gate = await this.requireLandingEvidence(spec, pending);
    if (!gate.ok) return gate;
    const leaves = await this.writeLeaves(spec, pending, "land", actor);
    if (!leaves.ok) return leaves;
    const marked = await this.markLanded(spec, pending.map((change) => change.id), actor);
    if (!marked.ok) return marked;
    return ok({ kind: "applied", spec: spec.slug, leaves: leaves.value });
  }

  /** A deprecated spec: its still-`proposed` ids become `retired` tombstones "never landed: <spec>". */
  private async abandon(spec: DocRecord, changes: RuleChange[], actor: string): Promise<Result<RuleApplyOutcome, LoreError>> {
    const written = await this.writeLeaves(spec, changes.filter((change) => change.op === "add" && !isLanded(change)), "abandon", actor);
    if (!written.ok) return written;
    if (written.value.length === 0) return ok({ kind: "noop", spec: spec.slug, reason: "already-abandoned" });
    return ok({ kind: "abandoned", spec: spec.slug, leaves: written.value });
  }

  /**
   * D2: every criterion citing a changed id must hold a runner-attested pass. Reads the corpus once; writes nothing.
   * @returns VALIDATION_ERROR (`field: "rule_changes"`, `value` = the shortfalls) naming each criterion and why.
   */
  private async requireLandingEvidence(spec: DocRecord, pending: readonly RuleChange[]): Promise<Result<void, LoreError>> {
    const specs = await this.store.findMany({ type: "spec" });
    if (!specs.ok) return specs;
    const plans = await this.store.findMany({ type: "plan" });
    if (!plans.ok) return plans;
    const tasks = await this.store.findMany({ type: "task" });
    if (!tasks.ok) return tasks;
    const measured = measureLandingEvidence({
      spec,
      specs: specs.value,
      plans: plans.value,
      tasks: tasks.value,
      changedRuleIds: new Set(pending.map((change) => change.id)),
      provableRuleIds: new Set(pending.filter((change) => change.op !== "retire").map((change) => change.id)),
    });
    if (!measured.ok) return err(validationError("acceptance_criteria", measured.reason));
    if (measured.shortfalls.length === 0 && measured.unproven.length === 0) return ok(undefined);
    const parts: string[] = [];
    if (measured.shortfalls.length > 0) {
      const lines = measured.shortfalls.map(
        (s) => `${s.acId} (cites ${s.cites.join(", ")}: ${s.reason === "no-attested-run" ? "no runner-attested pass" : "its latest runner-attested run failed"})`,
      );
      parts.push(
        `${measured.shortfalls.length} criterion(s) citing a changed rule lack a runner-attested pass — ${lines.join("; ")}. ` +
          `Record one with \`lore verify\` (a self-reported or expected-fail row does not count)`,
      );
    }
    if (measured.unproven.length > 0) {
      parts.push(
        `unproven change(s) — no criterion of ${spec.slug} cites ${measured.unproven.join(", ")}, so nothing would vouch for it. ` +
          `Cite it with \`lore ac cite ${spec.slug} <ac-id> <rule-id>\``,
      );
    }
    return err(validationError(
      "rule_changes",
      `cannot land the rule changes of ${spec.slug}: ${parts.join("; ")}; then re-run \`lore rule apply ${spec.slug}\``,
      { shortfalls: measured.shortfalls, unproven: measured.unproven },
    ));
  }

  /**
   * Write every touched leaf exactly once. All leaf plans are computed (and shape-validated) BEFORE the first
   * write, so a refusal on one leaf leaves the tree untouched; a STALE_VERSION re-plans that leaf on a fresh read.
   */
  private async writeLeaves(
    spec: DocRecord,
    changes: readonly RuleChange[],
    mode: "land" | "abandon",
    actor: string,
  ): Promise<Result<RuleApplyLeafWrite[], LoreError>> {
    if (changes.length === 0) return ok([]);
    const registry = await this.store.listRuleRegistry();
    if (!registry.ok) return registry;
    const states = new Map(registry.value.map((row) => [row.id, row.lifecycle as string]));
    const baseline = await this.store.findMany({ type: "baseline" });
    if (!baseline.ok) return baseline;
    const owners = collectLeafRules(baseline.value);

    const groups = new Map<string, { leafId: DocRecord["id"]; changes: RuleChange[] }>();
    for (const change of changes) {
      const leaf = change.op === "add" ? await this.resolveLeaf(change.leaf) : this.ownerOf(change.id, owners);
      if (!leaf.ok) return leaf;
      const group = groups.get(leaf.value.id as string) ?? { leafId: leaf.value.id, changes: [] };
      group.changes.push(change);
      groups.set(leaf.value.id as string, group);
    }

    const planned: Array<{ leaf: DocRecord; changes: RuleChange[] }> = [];
    for (const group of groups.values()) {
      const fresh = await this.readDoc(group.leafId);
      if (!fresh.ok) return fresh;
      const plan = planLeaf(fresh.value, group.changes, spec.slug, mode, states);
      if (!plan.ok) return plan;
      if (plan.value === undefined) continue;
      if (this.writeAuthority !== undefined) {
        const verdict = await this.writeAuthority.authorize([fresh.value], "rule-apply", actor);
        if (!verdict.ok) return verdict;
      }
      planned.push({ leaf: fresh.value, changes: group.changes });
    }

    const written: RuleApplyLeafWrite[] = [];
    for (const { leaf, changes: leafChanges } of planned) {
      let lastStale: LoreError | undefined;
      let done = false;
      for (let attempt = 0; attempt <= MAX_CAS_REAPPLIES && !done; attempt += 1) {
        const fresh = await this.readDoc(leaf.id);
        if (!fresh.ok) return fresh;
        const plan = planLeaf(fresh.value, leafChanges, spec.slug, mode, states);
        if (!plan.ok) return plan;
        if (plan.value === undefined) { done = true; continue; }
        const summary = mode === "land"
          ? `Rule changes landed from ${spec.slug}: ${plan.value.touched.join(", ")}`
          : `Proposed rules retired, never landed (${spec.slug}): ${plan.value.touched.join(", ")}`;
        const committed = await this.commitDoc(fresh.value, plan.value.extra, resolveStatusAfterContractEdit(fresh.value.status, true), summary, actor, {
          operation: mode === "land" ? "rule-apply" : "rule-abandon",
          spec: spec.slug,
          rules: plan.value.touched,
        });
        if (!committed.ok) {
          if (committed.error.code === "STALE_VERSION") { lastStale = committed.error; continue; }
          return committed;
        }
        written.push({ leaf: committed.value.slug, version: committed.value.version, rules: plan.value.touched });
        done = true;
      }
      if (!done) return err(lastStale ?? staleExhausted(leaf.id as string));
    }
    return ok(written);
  }

  /** Stamp `applied_at` on the entries this apply landed (one spec write; the status is kept — landing is bookkeeping). */
  private async markLanded(spec: DocRecord, ids: readonly string[], actor: string): Promise<Result<void, LoreError>> {
    const landed = new Set(ids);
    let lastStale: LoreError | undefined;
    for (let attempt = 0; attempt <= MAX_CAS_REAPPLIES; attempt += 1) {
      const fresh = await this.readDoc(spec.id);
      if (!fresh.ok) return fresh;
      const stored = readChangeSet(fresh.value);
      if (!stored.ok) return stored;
      const now = new Date().toISOString();
      const next = stored.value.map((change) => (landed.has(change.id) && !isLanded(change) ? { ...change, applied_at: now } : change));
      const committed = await this.commitDoc(
        fresh.value,
        { ...fresh.value.extra, rule_changes: next },
        fresh.value.status,
        `Rule changes landed: ${[...landed].join(", ")}`,
        actor,
        { operation: "rule-apply", rules: [...landed] },
      );
      if (committed.ok) return ok(undefined);
      if (committed.error.code === "STALE_VERSION") { lastStale = committed.error; continue; }
      return committed;
    }
    return err(lastStale ?? staleExhausted(spec.id as string));
  }

  /** CAS write of one doc: doc patch + version row + audit entry, atomic. Returns the written doc. */
  private async commitDoc(
    doc: DocRecord,
    extra: Record<string, unknown>,
    status: DocStatus,
    summary: string,
    actor: string,
    details: Record<string, unknown>,
  ): Promise<Result<DocRecord, LoreError>> {
    const now = new Date().toISOString();
    const version = doc.version + 1;
    const versionRecord: VersionRecord = {
      doc_id: doc.id,
      version,
      content: doc.content,
      extra,
      status,
      title: doc.title,
      action: "update",
      created_at: now,
      created_by: actor,
      change_summary: summary,
      slug: doc.slug,
    };
    const audit: AuditEntry = {
      timestamp: now,
      actor,
      session_id: doc.id,
      action: "update",
      doc_id: doc.id,
      details: { ...details, version, new_version: version },
    };
    return this.store.updateWithProvenance(
      doc.id,
      { extra, status, version, updated_at: now },
      { expected_version: doc.version },
      versionRecord,
      audit,
    );
  }

  private async resolveLeaf(leafRef: string): Promise<Result<DocRecord, LoreError>> {
    const resolved = await resolveDoc(this.store, leafRef);
    if (!resolved.ok) return resolved;
    if (resolved.value.type !== "baseline" || ruleIdPrefixOfNode(resolved.value.extra) !== "BR") {
      return err(validationError("leaf", `a rule lands on a business leaf; '${leafRef}' is not one`, leafRef));
    }
    return ok(resolved.value);
  }

  private ownerOf(ruleId: string, owners: ReadonlyMap<string, { leaf: DocRecord }>): Result<DocRecord, LoreError> {
    const owner = owners.get(ruleId);
    if (owner === undefined) return err(validationError("id", `${ruleId} is not a rule of the baseline`, ruleId));
    return ok(owner.leaf);
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
    if (ruleChangesOf(spec.extra).some((entry) => entry.id === change.id && isLanded(entry))) {
      return err(validationError("id", `${change.id} already landed from ${spec.slug}; a landed entry is history and cannot be re-proposed`, change.id));
    }
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

  private async readDoc(id: DocRecord["id"]): Promise<Result<DocRecord, LoreError>> {
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

/** The spec's stored change set, strictly parsed: a corrupt `extra.rule_changes` is an error, never a shorter list. */
function readChangeSet(spec: DocRecord): Result<RuleChange[], LoreError> {
  const raw = spec.extra["rule_changes"];
  if (raw === undefined) return ok([]);
  const parsed = specRuleChangesSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(validationError(
      `extra.rule_changes${issue !== undefined && issue.path.length > 0 ? `.${issue.path.join(".")}` : ""}`,
      `the stored change set of ${spec.slug} is invalid: ${issue?.message ?? "invalid"}`,
    ));
  }
  return ok(parsed.data);
}

function sameRule(a: BaselineRule, b: BaselineRule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What landing (`mode: "land"`) or abandoning (`mode: "abandon"`) `changes` does to ONE leaf, computed against the
 * leaf as read now. Pure; returns `undefined` when nothing on the leaf needs writing (every entry already holds),
 * which is what makes `apply` idempotent and a re-run after a partial landing safe.
 *
 * @param states - registry state of every rule id (`proposed` | `live` | `deprecated` | `retired`)
 */
function planLeaf(
  leaf: DocRecord,
  changes: readonly RuleChange[],
  specSlug: string,
  mode: "land" | "abandon",
  states: ReadonlyMap<string, string>,
): Result<LeafPlan | undefined, LoreError> {
  const rules: BaselineRule[] = Array.isArray(leaf.extra["rules"]) ? [...(leaf.extra["rules"] as BaselineRule[])] : [];
  const touched: string[] = [];
  for (const change of changes) {
    const index = rules.findIndex((rule) => rule.id === change.id);
    const current = index === -1 ? undefined : rules[index];
    if (change.op === "add") {
      if (current !== undefined) {
        if (mode === "land" && current.lifecycle !== "live") {
          return err(validationError("id", `${change.id} is ${current.lifecycle} in ${leaf.slug}; a spec proposing it cannot land it`, change.id));
        }
        continue;
      }
      if (states.get(change.id) !== "proposed") {
        return err(validationError("id", `${change.id} is not a proposed rule id (registry state: ${states.get(change.id) ?? "unknown"})`, change.id));
      }
      const base = { id: change.id, statement: change.statement, enforced_by: change.enforced_by, examples: change.examples };
      rules.push(
        mode === "land"
          ? { ...base, confidence: LANDED_RULE_CONFIDENCE, lifecycle: "live" }
          : { ...base, confidence: TOMBSTONE_RULE_CONFIDENCE, lifecycle: "retired", retired_note: `never landed: ${specSlug}` },
      );
      touched.push(change.id);
      continue;
    }
    if (mode === "abandon") continue;
    if (current === undefined) return err(validationError("id", `${change.id} is not on ${leaf.slug}; it moved or was removed since it was proposed`, change.id));
    if (change.op === "retire") {
      if (current.lifecycle === "retired") continue;
      rules[index] = { ...current, lifecycle: "retired", retired_note: change.note };
    } else {
      if (current.lifecycle !== "live") {
        return err(validationError("id", `${change.id} is ${current.lifecycle}; a modify names a live rule`, change.id));
      }
      const next: BaselineRule = {
        ...current,
        ...(change.statement !== undefined ? { statement: change.statement } : {}),
        ...(change.examples !== undefined ? { examples: change.examples } : {}),
        ...(change.enforced_by !== undefined ? { enforced_by: change.enforced_by } : {}),
      };
      if (sameRule(current, next)) continue;
      rules[index] = next;
    }
    touched.push(change.id);
  }
  if (touched.length === 0) return ok(undefined);
  const extra = { ...leaf.extra, rules };
  const shape = baselineExtraSchema.safeParse(extra);
  if (!shape.success) {
    const issue = shape.error.issues[0];
    return err(validationError(`extra.${issue !== undefined ? issue.path.join(".") : ""}`, `${leaf.slug}: ${issue?.message ?? "invalid baseline extra"}`));
  }
  return ok({ extra, touched });
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
