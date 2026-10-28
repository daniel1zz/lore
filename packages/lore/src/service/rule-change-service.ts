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
 *   - `amend --leaf` moves a proposed `add` to another business leaf and re-points its registry row in ONE
 *     transaction (`repointProposedRuleAndUpdateSpec`); no leaf document is written.
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

import { err, ok, validationError, type Result } from "@lore/core";
import type { DecisionRecord, DocRecord, DocStatus, LoreError, RuleChange } from "@lore/core";
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
import { findWriteSourceFor, resolveWriteActorFor } from "../store/write-context-store.js";
import { writeCarriesDecision, type DecisionDraft, type DecisionGate } from "./decision-gate.js";
import { CorpusWriteAuthority, type CorpusWriteAuthorityContext } from "./foreign-corpus-write-guard.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";
import { RecordLockService } from "./record-lock-service.js";
import { resolveDoc } from "./resolve.js";
import { collectLeafRules } from "./rule-index-queries.js";
import { findOtherSpecChange, findProposal, isLanded, ruleChangesOf } from "./rule-changes.js";
import { measureLandingEvidence } from "./landing-evidence.js";
import { approvedRulesOf, pendingRevisionsOf } from "./baseline-items.js";
import type { AbandonedLeafPlan, AbandonmentPlan, RuleApplyLeafWrite, RuleApplyOpts, RuleApplyOutcome, RuleChangeLandingPort } from "./rule-landing-port.js";

/** Immediate re-applies after a CAS miss before the STALE_VERSION error is surfaced. */
export const MAX_CAS_REAPPLIES = 3;

/** Placeholder id used only to pre-validate an `add` before the registry allocates the real one. */
const PREVALIDATION_ID = "BR-999999999";

/** What a caller proposes. `add` carries no id: the registry allocates it. */
export type ProposeRuleChangeInput =
  | { op: "add"; leaf: string; statement: string; examples: string[]; enforced_by: RuleEnforcement }
  | { op: "modify"; id: string; statement?: string; examples?: string[]; enforced_by?: RuleEnforcement }
  | { op: "retire"; id: string; note: string }
  | { op: "amend"; id: string; leaf?: string; statement?: string; examples?: string[]; enforced_by?: RuleEnforcement }
  | { op: "withdraw"; id: string };

/** The `amend` member of {@link ProposeRuleChangeInput}: rewrites THIS spec's own proposed `add` entry in place (`leaf` moves it). */
type AmendInput = Extract<ProposeRuleChangeInput, { op: "amend" }>;

/** The `withdraw` member of {@link ProposeRuleChangeInput}: removes THIS spec's own unlanded `modify` / `retire` entry. */
type WithdrawInput = Extract<ProposeRuleChangeInput, { op: "withdraw" }>;

/** Options of {@link RuleChangeService.propose}. */
export interface ProposeOpts {
  /** Acting identity; omitted → the write-context / environment chain. */
  by?: string;
  /** The audited exit for a LOCKED spec (BR-1069): why this write is a fix, not a change. */
  correction?: { reason: string };
  /** The decision the writer supplies (BR-1478): required of an agent when the spec is not a draft. */
  decision?: DecisionDraft | undefined;
}

/** Result of {@link RuleChangeService.changes}. */
export interface RuleChangeList {
  /** The spec's slug. */
  spec: string;
  changes: RuleChange[];
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
    // reason: AC-DCL-5 — the ONE write route (`CorpusService`); `app.ts` passes the composed one, a bare test gets a
    // bare writer sharing this service's record lock. This service never calls a store write primitive itself.
    writer?: DocWritePort,
  ) {
    this.writer = writer ?? bareDocWriter(store, recordLock);
  }

  private readonly writer: DocWritePort;

  /**
   * `true` once the claim-scoped authority is armed: every write of this service follows an `authorize(...)` call
   * (a foreign crossing is refused there unless a scoped lease covers it), so the write route's own foreign-corpus
   * refusal must not second-guess a decision already taken. Unarmed ⇒ the route decides alone.
   */
  private get foreignIntent(): boolean {
    return this.writeAuthority !== undefined;
  }

  /**
   * Armed by `app.ts` (both roots): an agent's proposal on a spec that is not a draft is refused without a complete
   * decision (BR-1478). Absent (a bare test construction) = ungated.
   */
  private decisionGate: DecisionGate | undefined;

  setDecisionGate(gate: DecisionGate): void {
    this.decisionGate = gate;
  }

  /**
   * The decision of a proposal: required of an agent when `spec` is not a draft (a proposal on a draft spec is decided
   * with the spec's approval); `ok(undefined)` when none is required and none was supplied.
   */
  private resolveProposalDecision(spec: DocRecord, draft: DecisionDraft | undefined): Result<DecisionRecord | undefined, LoreError> {
    const gate = this.decisionGate;
    if (gate === undefined) return ok(undefined);
    const required = writeCarriesDecision({ writerSource: findWriteSourceFor(this.store), targetIsDraft: spec.status === "draft", changesMoreThanStatus: true });
    return gate.judge({ required, draft });
  }

  /**
   * Arms the claim-scoped corpus-write guard (same context `RuleService` receives). Absent ⇒ every write is
   * ungated, exactly as before the guard existed.
   */
  setCorpusWriteContext(context: CorpusWriteAuthorityContext): void {
    this.writeAuthority = new CorpusWriteAuthority(this.store, context, this.writer);
  }

  /**
   * Add one entry to a spec's change set.
   *
   * @param specRef - Spec id or slug; a non-spec doc → VALIDATION_ERROR.
   * @param input - `add` (reserves the next BR id, `proposed`), `modify` (a live id; at least one field),
   *   `retire` (a live id; a non-blank note) or `amend` (an id THIS spec proposed and has not landed; at least one
   *   field that differs, or a `leaf`; rewrites that `add` entry in place keeping its id; `examples` replace
   *   wholesale; `amend --leaf` moves the entry to another business leaf (validated by `resolveBusinessLeaf`, as
   *   `add --leaf` is) and re-points the registry row via `repointProposedRuleAndUpdateSpec` — refused for a
   *   modify / retire entry, which has no proposed leaf).
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
    if (input.op === "amend") return this.proposeAmendOfProposal(specRef, input, opts, actor);
    if (input.op === "withdraw") return this.proposeWithdrawal(specRef, input, opts, actor);
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
    const decided = this.resolveProposalDecision(specResult.value, opts.decision);
    if (!decided.ok) return decided;
    const decision = decided.value;

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
        ? await this.writeAdd(spec, shaped.value, leaf, status, summary, actor, decision)
        : await this.writeAmend(spec, shaped.value, status, summary, actor, correctionReason, decision);
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
      { shortfalls: measured.shortfalls, unproven: measured.unproven }, "BR-1210",
    ));
  }

  /**
   * Plan every touched leaf without writing: all leaf plans are computed (and shape-validated) and each leaf's
   * write authorized, so a refusal on one leaf leaves the tree untouched.
   *
   * @returns one entry per leaf the changes actually alter (a leaf whose plan is a no-op is skipped).
   */
  private async planLeafWrites(
    spec: DocRecord,
    changes: readonly RuleChange[],
    mode: "land" | "abandon",
    actor: string,
  ): Promise<Result<Array<{ leaf: DocRecord; changes: RuleChange[]; plan: LeafPlan }>, LoreError>> {
    if (changes.length === 0) return ok([]);
    const states = await this.readRuleStates();
    if (!states.ok) return states;
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

    const planned: Array<{ leaf: DocRecord; changes: RuleChange[]; plan: LeafPlan }> = [];
    for (const group of groups.values()) {
      const fresh = await this.readDoc(group.leafId);
      if (!fresh.ok) return fresh;
      const plan = planLeaf(fresh.value, group.changes, spec.slug, mode, states.value);
      if (!plan.ok) return plan;
      if (plan.value === undefined) continue;
      if (this.writeAuthority !== undefined) {
        const verdict = await this.writeAuthority.authorize([fresh.value], "rule-apply", actor);
        if (!verdict.ok) return verdict;
      }
      planned.push({ leaf: fresh.value, changes: group.changes, plan: plan.value });
    }
    return ok(planned);
  }

  /** The registry's rule id to lifecycle map, read once per plan. */
  private async readRuleStates(): Promise<Result<Map<string, string>, LoreError>> {
    const registry = await this.store.listRuleRegistry();
    if (!registry.ok) return registry;
    return ok(new Map(registry.value.map((row) => [row.id, row.lifecycle as string])));
  }

  /**
   * BR-1307 - the leaf writes that retire a spec's still-proposed ids "never landed: <spec>", planned and not
   * written: the corpus commits them with the spec's move to `deprecated` in ONE transaction.
   *
   * @param specRef - Spec id or slug; a non-spec doc is a VALIDATION_ERROR.
   * @returns the plan (empty `leaves` when nothing is proposed or every id is already retired); the refusal when a
   *   leaf is unresolvable, unwritable from here, or the stored change set is corrupt.
   */
  async planAbandonment(specRef: string, opts: RuleApplyOpts = {}): Promise<Result<AbandonmentPlan, LoreError>> {
    const actor = resolveWriteActorFor(this.store, opts.by);
    const specResult = await this.resolveSpec(specRef);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;
    const stored = readChangeSet(spec);
    if (!stored.ok) return stored;
    const abandoned = stored.value.filter((change) => change.op === "add" && !isLanded(change));
    const planned = await this.planLeafWrites(spec, abandoned, "abandon", actor);
    if (!planned.ok) return planned;
    return ok({
      spec: spec.slug,
      leaves: planned.value.map(({ leaf, plan }) => ({
        leaf,
        extra: plan.extra,
        status: leaf.status, // reason: BR-1211 — a landed change set is approved by its spec; the leaf's status is untouched
        summary: `Proposed rules retired, never landed (${spec.slug}): ${plan.touched.join(", ")}`,
        details: { operation: "rule-abandon", spec: spec.slug, rules: plan.touched },
        rules: plan.touched,
      })),
    });
  }

  /**
   * The reverse of {@link planAbandonment}: the leaf writes that take the "never landed: <spec>" tombstones of
   * `specRef`'s proposed ids off their leaves, planned and not written. The owner rejected the spec's deprecation
   * (adr-an-acceptance-criterion-retires-with-the-feature-it: a rejected item is restored and re-planned), so the ids
   * the deprecation abandoned are proposed again. The caller commits the plan in the SAME transaction as the spec's
   * status restore and asks the store to mark the ids `proposed` (`CompanionDocWrite.propose_rules`).
   *
   * @param specRef - Spec id or slug; a non-spec doc is a VALIDATION_ERROR.
   * @returns the plan (empty `leaves` when no id of the spec carries its tombstone); the refusal when a leaf is
   *   unresolvable or unwritable from here.
   */
  async planRevival(specRef: string, opts: RuleApplyOpts = {}): Promise<Result<AbandonmentPlan, LoreError>> {
    const actor = resolveWriteActorFor(this.store, opts.by);
    const specResult = await this.resolveSpec(specRef);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;
    const stored = readChangeSet(spec);
    if (!stored.ok) return stored;
    const proposed = new Set(stored.value.filter((change) => change.op === "add" && !isLanded(change)).map((change) => change.id));
    const baseline = await this.store.findMany({ type: "baseline" });
    if (!baseline.ok) return baseline;
    const tombstone = `never landed: ${spec.slug}`;
    const leaves: AbandonedLeafPlan[] = [];
    for (const doc of baseline.value) {
      if ((doc.deleted_at ?? null) !== null) continue;
      const rules = approvedRulesOf(doc) as BaselineRule[];
      const revived = rules.filter((rule) => proposed.has(rule.id) && rule.lifecycle === "retired" && rule.retired_note === tombstone);
      if (revived.length === 0) continue;
      if (this.writeAuthority !== undefined) {
        const verdict = await this.writeAuthority.authorize([doc], "rule-apply", actor);
        if (!verdict.ok) return verdict;
      }
      const ids = revived.map((rule) => rule.id);
      const extra = { ...doc.extra, rules: rules.filter((rule) => !ids.includes(rule.id)) };
      const shape = baselineExtraSchema.safeParse(extra);
      if (!shape.success) {
        const issue = shape.error.issues[0];
        return err(validationError(`extra.${issue !== undefined ? issue.path.join(".") : ""}`, `${doc.slug}: ${issue?.message ?? "invalid baseline extra"}`));
      }
      leaves.push({
        leaf: doc,
        extra,
        status: doc.status,
        summary: `Proposed rules restored, deprecation of ${spec.slug} rejected: ${ids.join(", ")}`,
        details: { operation: "rule-revive", spec: spec.slug, rules: ids },
        rules: ids,
      });
    }
    return ok({ spec: spec.slug, leaves });
  }

  /**
   * Write every touched leaf exactly once. A STALE_VERSION re-plans that leaf on a fresh read.
   */
  private async writeLeaves(
    spec: DocRecord,
    changes: readonly RuleChange[],
    mode: "land" | "abandon",
    actor: string,
  ): Promise<Result<RuleApplyLeafWrite[], LoreError>> {
    const plannedAll = await this.planLeafWrites(spec, changes, mode, actor);
    if (!plannedAll.ok) return plannedAll;
    const planned = plannedAll.value;
    const stateRead = await this.readRuleStates();
    if (!stateRead.ok) return stateRead;
    const states = stateRead.value;

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
        // reason: BR-1211 — landing writes the APPROVED version of each changed rule and demotes nothing: the spec that
        // carried the change set was reviewed and approved, so the leaf keeps its status.
        const committed = await this.commitDoc(fresh.value, plan.value.extra, fresh.value.status, summary, actor, {
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
    const written = await this.writer.writeDoc({
      doc,
      patch: { extra, status },
      action: "update",
      changeSummary: summary,
      auditAction: "update",
      auditDetails: details,
      lock: "none",
      by: actor,
      foreignIntent: this.foreignIntent,
    });
    if (!written.ok) return written;
    return ok(written.value.doc);
  }

  private async resolveLeaf(leafRef: string): Promise<Result<DocRecord, LoreError>> {
    const resolved = await resolveDoc(this.store, leafRef);
    if (!resolved.ok) return resolved;
    if (resolved.value.type !== "baseline" || ruleIdPrefixOfNode(resolved.value.extra) !== "BR") {
      return err(validationError("leaf", `a rule lands on a business leaf; '${leafRef}' is not one`, leafRef, "BR-1232"));
    }
    return ok(resolved.value);
  }

  private ownerOf(ruleId: string, owners: ReadonlyMap<string, { leaf: DocRecord }>): Result<DocRecord, LoreError> {
    const owner = owners.get(ruleId);
    if (owner === undefined) return err(validationError("id", `${ruleId} is not a rule of the baseline`, ruleId, "BR-1232"));
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
    decision: DecisionRecord | undefined,
  ): Promise<Result<{ change: RuleChange; doc: DocRecord }, LoreError>> {
    if (leaf === undefined) return err(validationError("leaf", "an add needs a resolved baseline leaf"));
    let stored: RuleChange | undefined;
    const reserved = await this.writer.reserveProposedRule({
      write: {
        specId: spec.id,
        expectedVersion: spec.version,
        ownerLeafId: leaf.id,
        status,
        changeSummary: summary,
        ...(decision !== undefined ? { decision } : {}),
        buildExtra: (ruleId) => {
          stored = { ...change, id: ruleId, leaf: leaf.slug };
          return { ...spec.extra, rule_changes: [...ruleChangesOf(spec.extra), stored] };
        },
      },
      family: "BR",
      auditDetails: { change_op: "add", operation: "rule-propose" },
      by: actor,
      foreignIntent: this.foreignIntent,
    });
    if (!reserved.ok) return reserved;
    if (stored === undefined) return err({ code: "STORE_ERROR", message: "reservation committed without building the change" });
    return ok({ change: stored, doc: reserved.value.doc });
  }

  private async writeAmend(
    spec: DocRecord,
    change: Exclude<RuleChange, { op: "add" }>,
    status: DocStatus,
    summary: string,
    actor: string,
    correctionReason: string | undefined,
    decision: DecisionRecord | undefined,
  ): Promise<Result<{ change: RuleChange; doc: DocRecord }, LoreError>> {
    const checked = await this.checkAmendable(spec, change);
    if (!checked.ok) return checked;
    const existing = ruleChangesOf(spec.extra);
    const replaced = existing.some((c) => c.id === change.id);
    const next = replaced ? existing.map((c) => (c.id === change.id ? change : c)) : [...existing, change];
    return this.writeChangeSet(spec, next, change, status, summary, actor, correctionReason, change.op, decision);
  }

  /**
   * Persist `next` as the spec's change set: ONE version (status as given), one audit row carrying the
   * correction reason when there is one. Shared by `modify` / `retire` and by `amend`.
   */
  private async writeChangeSet(
    spec: DocRecord,
    next: RuleChange[],
    change: RuleChange,
    status: DocStatus,
    summary: string,
    actor: string,
    correctionReason: string | undefined,
    auditChangeOp: string = change.op,
    decision?: DecisionRecord,
  ): Promise<Result<{ change: RuleChange; doc: DocRecord }, LoreError>> {
    const written = await this.writer.writeDoc({
      doc: spec,
      patch: { extra: { ...spec.extra, rule_changes: next }, status },
      action: "update",
      changeSummary: summary,
      ...(decision !== undefined ? { decision } : {}),
      auditAction: "update",
      auditDetails: {
        operation: "rule-propose",
        change_op: auditChangeOp,
        rule_id: change.id,
        ...(correctionReason !== undefined ? { correction: { reason: correctionReason } } : {}),
      },
      lock: "none",
      by: actor,
      foreignIntent: this.foreignIntent,
    });
    if (!written.ok) return written;
    return ok({ change, doc: written.value.doc });
  }

  /**
   * `amend`: rewrite this spec's own proposed `add` entry in place (same id; the leaf changes only when `input.leaf`
   * names another business leaf, in which case {@link writeRepoint} moves the registry row too). The locked-spec exit is the
   * unchanged BR-1069 correction ({@link resolveLockExit}); the entry is re-read on every CAS attempt.
   * @returns VALIDATION_ERROR naming the id when it is not an unlanded `add` of THIS spec (live, proposed by
   *   another spec, unknown, a modify/retire of this spec, landed) or when the amend changes nothing.
   */
  private async proposeAmendOfProposal(
    specRef: string,
    input: AmendInput,
    opts: ProposeOpts,
    actor: string,
  ): Promise<Result<{ change: RuleChange; doc: DocRecord }, LoreError>> {
    const fields = shapeAmend(input);
    if (!fields.ok) return fields;
    const specResult = await this.resolveSpec(specRef);
    if (!specResult.ok) return specResult;
    const exit = await this.resolveLockExit(specResult.value, opts.correction);
    if (!exit.ok) return exit;
    const correctionReason = exit.value.correctionReason;
    const decided = this.resolveProposalDecision(specResult.value, opts.decision);
    if (!decided.ok) return decided;
    const decision = decided.value;

    let lastStale: LoreError | undefined;
    for (let attempt = 0; attempt <= MAX_CAS_REAPPLIES; attempt += 1) {
      const fresh = await this.readDoc(specResult.value.id);
      if (!fresh.ok) return fresh;
      const spec = fresh.value;
      const entry = await this.findOwnProposedAdd(spec, fields.value.id);
      if (!entry.ok) return entry;
      const leaf = await resolveDoc(this.store, entry.value.leaf);
      if (!leaf.ok) return leaf;
      if (this.writeAuthority !== undefined) {
        const verdict = await this.writeAuthority.authorize([leaf.value], "rule-propose", actor);
        if (!verdict.ok) return verdict;
      }
      // An amend's --leaf is validated exactly as an add's (same lookup, same refusal) and its write authorized too.
      let target: DocRecord | undefined;
      if (fields.value.leaf !== undefined) {
        const resolved = await this.resolveBusinessLeaf(fields.value.leaf);
        if (!resolved.ok) return resolved;
        target = resolved.value;
        if (this.writeAuthority !== undefined) {
          const verdict = await this.writeAuthority.authorize([target], "rule-propose", actor);
          if (!verdict.ok) return verdict;
        }
      }
      const amended: Extract<RuleChange, { op: "add" }> = {
        ...entry.value,
        ...(target !== undefined ? { leaf: target.slug } : {}),
        ...(fields.value.statement !== undefined ? { statement: fields.value.statement } : {}),
        ...(fields.value.examples !== undefined ? { examples: fields.value.examples } : {}),
        ...(fields.value.enforced_by !== undefined ? { enforced_by: fields.value.enforced_by } : {}),
      };
      if (JSON.stringify(amended) === JSON.stringify(entry.value)) {
        return err(validationError("change", `an amend must change something: ${entry.value.id} already has exactly this statement, examples and enforced_by`, entry.value.id, "BR-1287"));
      }
      const next = ruleChangesOf(spec.extra).map((c) => (c.id === amended.id ? amended : c));
      const status = exit.value.keepStatus ? spec.status : resolveStatusAfterContractEdit(spec.status, true);
      const summary = correctionReason !== undefined
        ? `Correction: ${correctionReason}`
        : `Rule change proposed: amend ${amended.id}`;
      // A moved leaf re-points the registry row in the SAME transaction as the spec write; otherwise a plain write.
      const written = target !== undefined && target.slug !== entry.value.leaf
        ? await this.writeRepoint(spec, next, amended, target, status, summary, actor, correctionReason, decision)
        : await this.writeChangeSet(spec, next, amended, status, summary, actor, correctionReason, amended.op, decision);
      if (!written.ok && written.error.code === "STALE_VERSION") { lastStale = written.error; continue; }
      return written;
    }
    return err(lastStale ?? staleExhausted(specResult.value.id as string));
  }

  /** Persist an amend that moves a proposed add to `target`: spec version + audit row + registry `leaf_doc_id`, one write. */
  private async writeRepoint(
    spec: DocRecord,
    next: RuleChange[],
    change: Extract<RuleChange, { op: "add" }>,
    target: DocRecord,
    status: DocStatus,
    summary: string,
    actor: string,
    correctionReason: string | undefined,
    decision: DecisionRecord | undefined,
  ): Promise<Result<{ change: RuleChange; doc: DocRecord }, LoreError>> {
    const written = await this.writer.repointProposedRule({
      write: {
        specId: spec.id,
        expectedVersion: spec.version,
        extra: { ...spec.extra, rule_changes: next },
        ruleId: change.id,
        toLeafId: target.id,
        status,
        changeSummary: summary,
        ...(decision !== undefined ? { decision } : {}),
      },
      auditDetails: {
        operation: "rule-propose",
        change_op: "amend",
        ...(correctionReason !== undefined ? { correction: { reason: correctionReason } } : {}),
      },
      by: actor,
      foreignIntent: this.foreignIntent,
    });
    if (!written.ok) return written;
    return ok({ change, doc: written.value });
  }

  /**
   * `withdraw`: remove this spec's own unlanded `modify` / `retire` entry for `id` from its change set — the exit
   * for an entry that must not stay reserved (e.g. a spec split into others). One version, one audit row
   * (`change_op: "withdraw"`); a locked spec needs the BR-1069 correction ({@link resolveLockExit}).
   * @returns the removed entry; VALIDATION_ERROR naming the id when this spec carries no unlanded modify / retire
   *   of it (an `add` is refused: its reserved id is released only by deprecating the spec).
   */
  private async proposeWithdrawal(
    specRef: string,
    input: WithdrawInput,
    opts: ProposeOpts,
    actor: string,
  ): Promise<Result<{ change: RuleChange; doc: DocRecord }, LoreError>> {
    const specResult = await this.resolveSpec(specRef);
    if (!specResult.ok) return specResult;
    const exit = await this.resolveLockExit(specResult.value, opts.correction);
    if (!exit.ok) return exit;
    const correctionReason = exit.value.correctionReason;
    const decided = this.resolveProposalDecision(specResult.value, opts.decision);
    if (!decided.ok) return decided;
    const decision = decided.value;

    let lastStale: LoreError | undefined;
    for (let attempt = 0; attempt <= MAX_CAS_REAPPLIES; attempt += 1) {
      const fresh = await this.readDoc(specResult.value.id);
      if (!fresh.ok) return fresh;
      const spec = fresh.value;
      const existing = ruleChangesOf(spec.extra);
      const entry = existing.find((c) => c.id === input.id);
      const refuse = (why: string) => err(validationError("id", `a withdraw removes an entry of ${spec.slug}'s change set: ${input.id} ${why}`, input.id, "BR-1311"));
      if (entry === undefined) return refuse("is not in this spec's change set");
      if (isLanded(entry)) return refuse("already landed; a landed entry is history");
      if (entry.op === "add") return refuse("is a proposed add; its reserved id is released by deprecating the spec, not by a withdraw");
      const baseline = await this.store.findMany({ type: "baseline" });
      if (!baseline.ok) return baseline;
      const leaf = collectLeafRules(baseline.value).get(entry.id)?.leaf;
      if (this.writeAuthority !== undefined && leaf !== undefined) {
        const verdict = await this.writeAuthority.authorize([leaf], "rule-propose", actor);
        if (!verdict.ok) return verdict;
      }
      const status = exit.value.keepStatus ? spec.status : resolveStatusAfterContractEdit(spec.status, true);
      const summary = correctionReason !== undefined
        ? `Correction: ${correctionReason}`
        : `Rule change withdrawn: ${entry.op} ${entry.id}`;
      const next = existing.filter((c) => c.id !== input.id);
      const written = await this.writeChangeSet(spec, next, entry, status, summary, actor, correctionReason, "withdraw", decision);
      if (!written.ok && written.error.code === "STALE_VERSION") { lastStale = written.error; continue; }
      return written;
    }
    return err(lastStale ?? staleExhausted(specResult.value.id as string));
  }

  /** The unlanded `add` entry `ruleId` of `spec`; otherwise a VALIDATION_ERROR naming the id and why it is not amendable. */
  private async findOwnProposedAdd(spec: DocRecord, ruleId: string): Promise<Result<Extract<RuleChange, { op: "add" }>, LoreError>> {
    const own = ruleChangesOf(spec.extra).find((c) => c.id === ruleId);
    if (own !== undefined && own.op === "add" && !isLanded(own)) return ok(own);
    const refuse = (why: string) => err(validationError("id", `an amend rewrites a proposed entry of ${spec.slug}: ${ruleId} ${why}`, ruleId, "BR-1287"));
    if (own !== undefined && isLanded(own)) return refuse("already landed; a landed entry is history");
    if (own !== undefined) return refuse(`is a ${own.op} of this spec, not a proposed add (re-propose the ${own.op} instead)`);
    const specs = await this.store.findMany({ type: "spec" });
    if (!specs.ok) return specs;
    const proposal = findProposal(ruleId, specs.value);
    if (proposal !== undefined) return refuse(`is proposed by ${proposal.spec.slug}, not by this spec`);
    const baseline = await this.store.findMany({ type: "baseline" });
    if (!baseline.ok) return baseline;
    return collectLeafRules(baseline.value).has(ruleId)
      ? refuse("is a live rule of the baseline (use modify)")
      : refuse("is not proposed by any spec");
  }

  /**
   * `modify` / `retire` need a rule that is live in the tree and not already changed by another spec.
   * Re-run on every CAS attempt, so a concurrent proposal by another spec is seen.
   */
  private async checkAmendable(spec: DocRecord, change: Exclude<RuleChange, { op: "add" }>): Promise<Result<void, LoreError>> {
    if (ruleChangesOf(spec.extra).some((entry) => entry.id === change.id && isLanded(entry))) {
      return err(validationError("id", `${change.id} already landed from ${spec.slug}; a landed entry is history and cannot be re-proposed`, change.id, "BR-1208"));
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
      return err(validationError("id", `a ${change.op} names a LIVE rule: ${why}`, change.id, "BR-1207"));
    }
    const other = findOtherSpecChange(change.id, specs.value, spec.id as string);
    if (other !== undefined) {
      return err(validationError(
        "id",
        `${change.id} is already ${other.change.op === "retire" ? "retired" : "modified"} by the unlanded change set of ${other.spec.slug}; ` +
          `that spec must land or be deprecated before another spec changes it`,
        change.id, "BR-1207",
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
          correction.reason, "BR-1208",
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
      const resolved = await this.resolveBusinessLeaf(change.leaf);
      if (!resolved.ok) return resolved;
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

  /**
   * The business leaf an `add` lands on — and an `amend --leaf` moves to: one lookup, one refusal (BR-1206).
   * @param ref - leaf id or slug; unresolvable → DOC_NOT_FOUND; not a business baseline leaf → VALIDATION_ERROR.
   */
  private async resolveBusinessLeaf(ref: string): Promise<Result<DocRecord, LoreError>> {
    const resolved = await resolveDoc(this.store, ref);
    if (!resolved.ok) return resolved;
    if (resolved.value.type !== "baseline" || ruleIdPrefixOfNode(resolved.value.extra) !== "BR") {
      return err(validationError("leaf", `an add lands on a business leaf; '${ref}' is not one`, ref, "BR-1206"));
    }
    return ok(resolved.value);
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
      `the stored change set of ${spec.slug} is invalid: ${issue?.message ?? "invalid"}`, undefined, "BR-1209",
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
  const rules: BaselineRule[] = [...(approvedRulesOf(leaf) as BaselineRule[])];
  const touched: string[] = [];
  const pendingDirect = pendingRevisionsOf(leaf).rules;
  for (const change of changes) {
    // reason: BR-1211 — a rule a direct write has revised and nobody has approved yet cannot also be landed by a spec:
    // the landing would approve over a revision no review has seen. Refused naming the rule, nothing written.
    if (pendingDirect[change.id] !== undefined && !(mode === "abandon" && change.op !== "add")) {
      return err(validationError(
        "id",
        `${change.id} on ${leaf.slug} holds a pending direct revision (${pendingDirect[change.id]?.revision_id ?? "?"}); ` +
          `approve it (\`lore review ${leaf.slug}\`, \`lore approve ${leaf.slug} --item ${change.id}\`) or discard it ` +
          `(\`lore reject ${leaf.slug} --item ${change.id}\`), then re-run \`lore rule apply ${specSlug}\``,
        change.id, "BR-1211",
      ));
    }
    const index = rules.findIndex((rule) => rule.id === change.id);
    const current = index === -1 ? undefined : rules[index];
    if (change.op === "add") {
      if (current !== undefined) {
        if (mode === "land" && current.lifecycle !== "live") {
          return err(validationError("id", `${change.id} is ${current.lifecycle} in ${leaf.slug}; a spec proposing it cannot land it`, change.id, "BR-1232"));
        }
        continue;
      }
      if (states.get(change.id) !== "proposed") {
        return err(validationError("id", `${change.id} is not a proposed rule id (registry state: ${states.get(change.id) ?? "unknown"})`, change.id, "BR-1232"));
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
    if (current === undefined) return err(validationError("id", `${change.id} is not on ${leaf.slug}; it moved or was removed since it was proposed`, change.id, "BR-1232"));
    if (change.op === "retire") {
      if (current.lifecycle === "retired") continue;
      rules[index] = { ...current, lifecycle: "retired", retired_note: change.note };
    } else {
      if (current.lifecycle !== "live") {
        return err(validationError("id", `${change.id} is ${current.lifecycle}; a modify names a live rule`, change.id, "BR-1232"));
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
 * Validate an `amend`'s fields with the stored-shape schema (the same statement / example / enforced_by bounds an
 * `add` and a `modify` obey) and require at least one of them, like `modify`.
 */
function shapeAmend(input: AmendInput): Result<AmendInput, LoreError> {
  const parsed = ruleChangeSchema.safeParse({
    op: "modify",
    id: input.id,
    ...(input.statement !== undefined ? { statement: input.statement } : {}),
    ...(input.examples !== undefined ? { examples: input.examples } : {}),
    ...(input.enforced_by !== undefined ? { enforced_by: input.enforced_by } : {}),
  });
  if (!parsed.success || parsed.data.op !== "modify") {
    const issue = parsed.success ? undefined : parsed.error.issues[0];
    return err(validationError(
      issue !== undefined && issue.path.length > 0 ? String(issue.path[0]) : "change",
      issue !== undefined ? issue.message : "invalid rule change", undefined, "BR-1206",
    ));
  }
  const { statement, examples, enforced_by } = parsed.data;
  if (input.leaf !== undefined && input.leaf.trim() === "") {
    return err(validationError("leaf", "an amend's --leaf must name a baseline leaf", input.leaf, "BR-1287"));
  }
  if (statement === undefined && examples === undefined && enforced_by === undefined && input.leaf === undefined) {
    return err(validationError("change", "an amend must change at least one of leaf, statement, examples, enforced_by", undefined, "BR-1287"));
  }
  return ok({
    op: "amend",
    id: parsed.data.id,
    ...(input.leaf !== undefined ? { leaf: input.leaf } : {}),
    ...(statement !== undefined ? { statement } : {}),
    ...(examples !== undefined ? { examples } : {}),
    ...(enforced_by !== undefined ? { enforced_by } : {}),
  });
}

/**
 * Validate a caller's input with the stored-shape schema (`add` against a placeholder id) so a refusal burns no
 * id and the CLI cannot write a shape the reader would later drop.
 */
function shapeInput(input: Exclude<ProposeRuleChangeInput, { op: "amend" | "withdraw" }>): Result<RuleChange, LoreError> {
  const candidate =
    input.op === "add" ? { ...input, id: PREVALIDATION_ID } : input.op === "retire" ? { ...input, note: input.note.trim() } : input;
  const parsed = ruleChangeSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(validationError(
      issue !== undefined && issue.path.length > 0 ? String(issue.path[0]) : "change",
      issue !== undefined ? issue.message : "invalid rule change", undefined, "BR-1206",
    ));
  }
  if (parsed.data.op === "modify" && parsed.data.statement === undefined && parsed.data.examples === undefined && parsed.data.enforced_by === undefined) {
    return err(validationError("change", "a modify must change at least one of statement, examples, enforced_by", undefined, "BR-1206"));
  }
  if (parsed.data.op === "retire" && parsed.data.note.trim().length === 0) {
    return err(validationError("note", "a retire needs a non-blank note naming why the rule is no longer true", undefined, "BR-1206"));
  }
  return ok(parsed.data);
}
