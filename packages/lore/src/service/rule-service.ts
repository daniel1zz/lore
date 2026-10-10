/**
 * RuleService — the dedicated writer of a `baseline` doc's verb-owned `extra` keys:
 * rules (permanent ids: `BR-n` on a business leaf, `AS-n` on an architecture standard, `AD-n` on a
 * debt registry), node label, `depends_on`, glossary — plus baseline node creation.
 *
 * Purpose: single write path for `lore rule add|set` and `lore baseline add|set-label|
 *   depends|glossary`; `CorpusService.set` refuses to touch these keys
 *   (DEDICATED_EXTRA_KEYS replace guard), so this service is the ONLY place they change.
 *
 * Public surface:
 *   addRule(leaf, input, opts?)            → { ruleId, doc }
 *   setRule(ruleId, patch, opts?)          → { rule, doc }   (edit | lifecycle | moveTo)
 *   addNode(parent, input, opts?)          → DocRecord        (new baseline node of either tree)
 *   setLabel(node, label, opts?)           → DocRecord
 *   setDependsOn(leaf, change, opts?)      → DocRecord
 *   setSiteMap(leaf, change, opts?)        → DocRecord   (`extra.site_map` + `extra.commands`, leaf only)
 *   glossaryAdd(node, entry, opts?)        → DocRecord
 *   glossaryRemove(node, term, opts?)      → DocRecord
 *   listBaselineTree(root?)                → BaselineTreeEntry[]   (read-only, depth-first)
 *
 * Invariants:
 *   - Every method returns `Result<_, LoreError>`; a domain refusal never throws.
 *   - Rule ids are allocated ONLY by `store.allocateRuleAndUpdateLeaf` (registry, never
 *     reissued); a refused/invalid rule never burns an id (validation precedes allocation).
 *   - Rule lifecycle moves forward only (`isLawfulRuleLifecycleTransition`); retiring
 *     requires a note.
 *   - Writes are CAS-guarded. On STALE_VERSION the mutation is re-applied to a fresh read at
 *     most {@link MAX_CAS_REAPPLIES} times, then the STALE_VERSION error is returned — no
 *     silent last-writer-wins.
 *   - Editing the content of an `approved` leaf demotes it to `draft` (the one shared rule,
 *     `resolveStatusAfterContractEdit`, same as CorpusService.set / AcService.setCriterion).
 *     The demotion is its own CAS write BEFORE the rule write, so a failure after it leaves
 *     the doc conservatively un-approved rather than approved with unreviewed content.
 *   - Every write leaves one version row + one audit entry (single-leaf writes are one
 *     atomic `updateWithProvenance`; allocate/move append their audit entry right after the
 *     store's own transaction).
 *
 * Side-effect class: IO (reads and writes via StoreInterface; node creation via the injected
 *   create port).
 * Source: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C3.
 */

import { err, ok, type Result } from "@lore/core";
import type { LoreError, DocRecord, DocStatus, VersionRecord } from "@lore/core";
import {
  ANY_RULE_ID_PATTERN,
  BASELINE_RULE_ID_PATTERN,
  baselineExtraSchema,
  baselineNodeSchema,
  baselineRuleSchema,
  glossaryEntrySchema,
  isLawfulRuleLifecycleTransition,
  isNodeOfTree,
  resolveStatusAfterContractEdit,
  ruleIdPrefix,
  ruleIdPrefixOfNode,
  validateBaselineParent,
  type BaselineNode,
  type BaselineRule,
  type BaselineTree,
  type GlossaryEntry,
  type RuleLifecycle,
} from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import { resolveActorWithSource } from "@lore/core/node";
import type { StoreInterface } from "../store/store-interface.js";
import { NON_BUSINESS_PREFIX } from "./leaf-coverage.js";
import { resolveDoc } from "./resolve.js";
import { CorpusService, type CreateDocResult, type WriteActorOpts } from "./corpus-service.js";
import { collectKnownRuleIds } from "./baseline-rule-ids.js";
import { collectLeafRules } from "./rule-index-queries.js";
import { CorpusWriteAuthority, type CorpusWriteAuthorityContext } from "./foreign-corpus-write-guard.js";

// reason: C7's `--check-baseline` imports this from the service that owns rules; the helper itself
// lives in a pure module so CorpusService can share it without a service cycle.
export { findUnregisteredRuleIds, type UnregisteredRule } from "./baseline-rule-ids.js";

/** Immediate re-applies after a CAS miss before the STALE_VERSION error is surfaced. */
export const MAX_CAS_REAPPLIES = 3;

/**
 * Placeholder number used only to pre-validate a candidate rule before the registry allocates the real
 * id. The family prefix is the TARGET NODE's (`ruleIdPrefixOfNode`), so the node/family check and the
 * four-part-standard check run against the real family.
 */
const PREVALIDATION_NUMBER = "999999999";

// ─── Public types ────────────────────────────────────────────────────────────

/** Fields a caller supplies for a new rule; id + lifecycle are service-assigned. */
export interface AddRuleInput {
  statement: string;
  confidence: BaselineRule["confidence"];
  enforced_by: BaselineRule["enforced_by"];
  examples: string[];
  /**
   * Four-part standard (AS rules only; all four or none — `baselineRuleSchema` enforces it):
   * what the code does today / the target rule / the debt entries (`AD-n`, each must be a LIVE
   * debt entry; may be empty) / how the exceptions get closed.
   */
  current_reality?: string;
  target_rule?: string;
  current_exceptions?: string[];
  migration?: string;
}

/** Partial rule edit. `note` is the retirement note (stored as `retired_note`). */
export interface SetRulePatch {
  statement?: string;
  confidence?: BaselineRule["confidence"];
  enforced_by?: BaselineRule["enforced_by"];
  examples?: string[];
  lifecycle?: RuleLifecycle;
  note?: string;
  /** Destination leaf id|slug — relocates the rule, keeping its id. */
  moveTo?: string;
  /** Four-part standard parts (AS rules only); each replaces the stored part, `current_exceptions` wholesale. */
  current_reality?: string;
  target_rule?: string;
  current_exceptions?: string[];
  migration?: string;
}

/** Fields of a new baseline node. */
export interface AddNodeInput {
  /** Which tree the node joins; absent = business. */
  tree?: BaselineTree;
  node: BaselineNode;
  label: string;
  title: string;
  content: string;
}

/** Create port: the production wiring injects `corpusService.create` so gates and provenance guards apply. */
export type CreateBaselineDocPort = (
  input: CreateDocInput,
  opts?: WriteActorOpts,
) => Promise<Result<CreateDocResult, LoreError>>;

/** One row of {@link RuleService.listBaselineTree}: a baseline node with its depth and rule tallies. */
export interface BaselineTreeEntry {
  id: string;
  slug: string;
  title: string;
  status: DocStatus;
  depth: number;
  node: string;
  label: string | null;
  /** Rule counts by lifecycle (leaf only; all zero elsewhere). */
  rules: Record<RuleLifecycle, number>;
  /** Which tree the node belongs to (`extra.tree`; absent on the doc = business). */
  tree: BaselineTree;
}

// ─── Errors (value constructors) ─────────────────────────────────────────────

function validationError(field: string, message: string, value?: unknown): LoreError {
  return value === undefined
    ? { code: "VALIDATION_ERROR", field, message }
    : { code: "VALIDATION_ERROR", field, message, value };
}

/** Result of one mutation attempt against a fresh read: the new extra, or a refusal. */
type Mutation = Result<{ extra: Record<string, unknown>; summary: string; details: Record<string, unknown> }, LoreError>;

/**
 * One `lore baseline map` edit of a leaf's completeness-census state.
 * `sites` SETS (replaces) each key's mapping; entries are rule ids of THIS leaf or
 * `non-business:<reason>`.
 */
export interface SiteMapChange {
  sites?: Record<string, string[]>;
  removeSites?: string[];
  addCommands?: string[];
  removeCommands?: string[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class RuleService {
  private readonly createDoc: CreateBaselineDocPort;
  /**
   * Claim-scoped corpus authoring (spec-baseline-slice-2 §C8, AC-BLS2-8): set post-construction by
   * `adapters/cli/loader.ts` — never via the constructor, so every bare `new RuleService(store)`
   * stays byte-identical (absent ⇒ every write is ungated, exactly as before the guard existed).
   */
  private writeAuthority: CorpusWriteAuthority | undefined;

  /**
   * @param store - Storage abstraction.
   * @param createDoc - Node-creation port. Production (`app.ts`) injects the wired
   *   `corpusService.create`. reason: absent → a bare `CorpusService(store)`, which is what
   *   every unit test and tool that builds `new RuleService(store)` expects; it is a
   *   construction default, not a runtime fallback (the port is resolved once, here).
   */
  constructor(
    private readonly store: StoreInterface,
    createDoc?: CreateBaselineDocPort,
  ) {
    if (createDoc !== undefined) {
      this.createDoc = createDoc;
    } else {
      const corpus = new CorpusService(store);
      this.createDoc = corpus.create.bind(corpus);
    }
  }

  /**
   * Arms the claim-scoped corpus-write guard for every baseline write this instance performs
   * from now on. Called once per CLI process by the composition root.
   */
  setCorpusWriteContext(context: CorpusWriteAuthorityContext): void {
    this.writeAuthority = new CorpusWriteAuthority(this.store, context);
  }

  /**
   * Authorizes a baseline write by `by` against `targets` — the ONE entry every writer in this
   * service (and `lore baseline map`) shares. Inert without {@link setCorpusWriteContext} or
   * outside a foreign (worktree) crossing; otherwise requires a fresh lease whose `corpus_scope`
   * covers every target, and records the authorization in the audit log.
   *
   * @returns ok, or the `gate:corpus-write:foreign-provenance` refusal.
   */
  async authorizeCorpusWrite(
    targets: readonly DocRecord[],
    operation: string,
    by?: string,
  ): Promise<Result<void, LoreError>> {
    if (this.writeAuthority === undefined) return ok(undefined);
    const verdict = await this.writeAuthority.authorize(targets, operation, this.resolveActor(by));
    if (!verdict.ok) return verdict;
    return ok(undefined);
  }

  /**
   * Authorize a write on the baseline node `idOrSlug` (resolved here) — for adapter verbs whose
   * write path lives outside this service (`lore baseline map`).
   */
  async authorizeNodeWrite(idOrSlug: string, operation: string, by?: string): Promise<Result<DocRecord, LoreError>> {
    const target = await this.resolveBaselineDoc(idOrSlug);
    if (!target.ok) return target;
    const gate = await this.authorizeCorpusWrite([target.value], operation, by);
    if (!gate.ok) return gate;
    return target;
  }

  // ── rules ──────────────────────────────────────────────────────────────────

  /**
   * Append a new `live` rule to a rule-holding baseline node, allocating its permanent id. The id
   * family comes from the node: business leaf -> `BR-n`, architecture standard -> `AS-n`,
   * architecture debt-registry -> `AD-n` (each family numbers from 1, one never-reused registry).
   *
   * @param leaf - Doc id or slug of a business leaf, an architecture standard or a debt-registry.
   * @returns `{ ruleId, doc }` (the updated node), VALIDATION_ERROR for a node that holds no rules
   *   or an invalid rule — incl. a `current_exceptions` id that is not a live `AD-n` (no id
   *   burned, node untouched), DOC_NOT_FOUND, or STALE_VERSION once the CAS re-apply budget is spent.
   * @example
   * await rules.addRule("baseline-claims", { statement: "…", confidence: "established",
   *   enforced_by: "guaranteed", examples: ["…"] }, { by: "agent:x" });
   */
  async addRule(
    leaf: string,
    input: AddRuleInput,
    opts?: { by?: string },
  ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>> {
    const actor = this.resolveActor(opts?.by);
    // reason: first pass validates the rule's own fields only; "AS" is the one family that admits every
    // field (four-part standard included). The family-specific verdict comes from the extra check below.
    const candidate = baselineRuleSchema.safeParse({ ...input, id: `AS-${PREVALIDATION_NUMBER}`, lifecycle: "live" });
    if (!candidate.success) {
      const issue = candidate.error.issues[0];
      return err(validationError(
        issue ? `rule.${issue.path.join(".")}` : "rule",
        issue ? issue.message : "invalid rule",
      ));
    }
    const target = await this.resolveBaselineDoc(leaf);
    if (!target.ok) return target;
    const family = ruleIdPrefixOfNode(target.value.extra);
    if (family === undefined) {
      return err(validationError(
        "node",
        `rules live only on a business leaf, an architecture standard or an architecture debt-registry (got tree=${String(target.value.extra["tree"] ?? "business")} node=${String(target.value.extra["node"])})`,
        target.value.extra["node"],
      ));
    }
    const exceptions = await this.checkCurrentExceptions(candidate.data.current_exceptions);
    if (!exceptions.ok) return exceptions;
    const gate = await this.authorizeCorpusWrite([target.value], "rule-add", opts?.by);
    if (!gate.ok) return gate;
    const leafId = target.value.id;

    let lastStale: LoreError | undefined;
    for (let attempt = 0; attempt <= MAX_CAS_REAPPLIES; attempt += 1) {
      const fresh = await this.readLeaf(leafId);
      if (!fresh.ok) return fresh;
      const readied = await this.demoteIfApproved(fresh.value, actor, "rule add");
      if (!readied.ok) {
        if (readied.error.code === "STALE_VERSION") { lastStale = readied.error; continue; }
        return readied;
      }
      const base = readied.value;
      const withRule = (ruleId: string): Record<string, unknown> => ({
        ...base.extra,
        rules: [...rulesOf(base), { ...candidate.data, id: ruleId }],
      });
      const shape = baselineExtraSchema.safeParse(withRule(`${family}-${PREVALIDATION_NUMBER}`));
      if (!shape.success) {
        const issue = shape.error.issues[0];
        return err(validationError(issue ? `extra.${issue.path.join(".")}` : "extra", issue ? issue.message : "invalid leaf extra"));
      }
      const allocated = await this.store.allocateRuleAndUpdateLeaf(base.id, base.version, withRule, actor, family);
      if (!allocated.ok) {
        if (allocated.error.code === "STALE_VERSION") { lastStale = allocated.error; continue; }
        return allocated;
      }
      const audited = await this.appendAudit(actor, allocated.value.doc, "rule-add", { rule_id: allocated.value.ruleId });
      if (!audited.ok) return audited;
      return ok(allocated.value);
    }
    return err(lastStale ?? staleExhausted(leafId));
  }

  /**
   * Edit a rule, move it through its lifecycle, or relocate it to another leaf.
   *
   * @param ruleId - Permanent id `BR-<n>`, `AS-<n>` or `AD-<n>`; unknown → DOC_NOT_FOUND.
   * @param patch - At least one field. `lifecycle` is forward-only; `retired` needs `note`;
   *   `note` is valid only together with `lifecycle: "retired"`.
   * @returns `{ rule, doc }` — the rule as stored and the leaf that now holds it.
   */
  async setRule(
    ruleId: string,
    patch: SetRulePatch,
    opts?: { by?: string },
  ): Promise<Result<{ rule: BaselineRule; doc: DocRecord }, LoreError>> {
    const actor = this.resolveActor(opts?.by);
    if (!ANY_RULE_ID_PATTERN.test(ruleId)) {
      return err(validationError("ruleId", `rule id must match BR-<n>, AS-<n> or AD-<n> (got '${ruleId}')`, ruleId));
    }
    const patchCheck = validateSetRulePatch(patch);
    if (!patchCheck.ok) return patchCheck;
    const exceptions = await this.checkCurrentExceptions(patch.current_exceptions);
    if (!exceptions.ok) return exceptions;

    let lastStale: LoreError | undefined;
    let authorized = false; // reason: one authorization (and one audit row) per call, not per CAS re-apply
    for (let attempt = 0; attempt <= MAX_CAS_REAPPLIES; attempt += 1) {
      const located = await this.locateRule(ruleId);
      if (!located.ok) return located;
      const { sourceLeaf, current, registered } = located.value;
      const edited = applyRulePatch(current, patch);
      if (!edited.ok) return edited;

      if (patch.moveTo === undefined) {
        if (!authorized) {
          const gate = await this.authorizeCorpusWrite([sourceLeaf], "rule-set", opts?.by);
          if (!gate.ok) return gate;
          authorized = true;
        }
        const written = await this.writeLeafExtra(
          sourceLeaf, actor,
          (doc) => replaceRule(doc, ruleId, edited.value, patchSummary(patch), {
            rule_id: ruleId, operation: "rule-set", fields: Object.keys(patch),
          }),
        );
        if (!written.ok) {
          if (written.error.code === "STALE_VERSION") { lastStale = written.error; continue; }
          return written;
        }
        return ok({ rule: edited.value, doc: written.value });
      }

      const dest = await this.resolveBaselineDoc(patch.moveTo, ["leaf", "standard", "debt-registry"]);
      if (!dest.ok) return dest;
      if (ruleIdPrefixOfNode(dest.value.extra) !== ruleIdPrefix(ruleId)) {
        return err(validationError(
          "moveTo",
          `rule ${ruleId} cannot move to a ${String(dest.value.extra["tree"] ?? "business")} ${String(dest.value.extra["node"])}: it holds ${ruleIdPrefixOfNode(dest.value.extra) ?? "no"} ids`,
          patch.moveTo,
        ));
      }
      if (dest.value.id === sourceLeaf.id) {
        return err(validationError("moveTo", `rule ${ruleId} already lives on that leaf`, patch.moveTo));
      }
      if (!authorized) {
        const gate = await this.authorizeCorpusWrite([sourceLeaf, dest.value], "rule-move", opts?.by);
        if (!gate.ok) return gate;
        authorized = true;
      }
      const fromReady = await this.demoteIfApproved(sourceLeaf, actor, "rule move");
      if (!fromReady.ok) {
        if (fromReady.error.code === "STALE_VERSION") { lastStale = fromReady.error; continue; }
        return fromReady;
      }
      const toFresh = await this.readLeaf(dest.value.id);
      if (!toFresh.ok) return toFresh;
      const toReady = await this.demoteIfApproved(toFresh.value, actor, "rule move");
      if (!toReady.ok) {
        if (toReady.error.code === "STALE_VERSION") { lastStale = toReady.error; continue; }
        return toReady;
      }
      const from = fromReady.value;
      const to = toReady.value;
      const fromExtra = { ...from.extra, rules: rulesOf(from).filter((r) => r.id !== ruleId) };
      const toExtra = { ...to.extra, rules: [...rulesOf(to), edited.value] };
      for (const [label, extra] of [["source", fromExtra], ["destination", toExtra]] as const) {
        const shape = baselineExtraSchema.safeParse(extra);
        if (!shape.success) {
          const issue = shape.error.issues[0];
          return err(validationError(`extra.${issue ? issue.path.join(".") : ""}`, `${label} leaf: ${issue ? issue.message : "invalid extra"}`));
        }
      }
      const moved = registered
        ? await this.store.moveRule(
            ruleId,
            { id: from.id, expectedVersion: from.version, extra: fromExtra },
            { id: to.id, expectedVersion: to.version, extra: toExtra },
            actor,
          )
        : await this.moveUnregisteredRule(from, fromExtra, to, toExtra, actor);
      if (!moved.ok) {
        if (moved.error.code === "STALE_VERSION") { lastStale = moved.error; continue; }
        return moved;
      }
      for (const doc of [moved.value.from, moved.value.to]) {
        const audited = await this.appendAudit(actor, doc, "rule-move", {
          rule_id: ruleId, from: from.id, to: to.id, registered,
        });
        if (!audited.ok) return audited;
      }
      return ok({ rule: edited.value, doc: moved.value.to });
    }
    return err(lastStale ?? staleExhausted(ruleId));
  }

  // ── baseline nodes ─────────────────────────────────────────────────────────

  /**
   * Create a baseline node under `parent`.
   *
   * @param parent - A prd (for `node: "root"`), a business root|branch (for branch|leaf), an
   *   architecture root (for a section) or an architecture section (for module-card|standard|debt-registry).
   * @returns the created doc, or VALIDATION_ERROR naming why the tree/node/parent triple is illegal
   *   (a kind that does not belong to `input.tree` creates nothing).
   */
  async addNode(
    parent: string,
    input: AddNodeInput,
    opts?: { by?: string },
  ): Promise<Result<DocRecord, LoreError>> {
    const node = baselineNodeSchema.safeParse(input.node);
    if (!node.success) {
      return err(validationError("node", `node must be one of ${baselineNodeSchema.options.join("|")} (got '${String(input.node)}')`, input.node));
    }
    if (!isNodeOfTree(input.tree, node.data)) {
      return err(validationError("node", `node=${node.data} does not belong to tree=${input.tree ?? "business"}`, input.node));
    }
    if (input.label.trim() === "") return err(validationError("label", "label must not be empty"));
    const parentDoc = await resolveDoc(this.store, parent);
    if (!parentDoc.ok) return parentDoc;
    const parentNode = parentDoc.value.type === "baseline" ? parentDoc.value.extra["node"] : undefined;
    const parentTree = parentDoc.value.type === "baseline" ? parentDoc.value.extra["tree"] : undefined;
    const verdict = validateBaselineParent(
      { node: node.data, ...(input.tree !== undefined ? { tree: input.tree } : {}) },
      {
        type: parentDoc.value.type,
        ...(typeof parentNode === "string" ? { node: parentNode } : {}),
        ...(typeof parentTree === "string" ? { tree: parentTree } : {}),
      },
    );
    if (!verdict.ok) return err(validationError("parent", verdict.reason, parent));
    const created = await this.createDoc(
      {
        type: "baseline",
        title: input.title,
        content: input.content,
        parent_id: parentDoc.value.id,
        // reason: `tree` is written only for the architecture tree — an absent tree means business, so a
        // business node's stored `extra` stays byte-identical to what it was before the architecture tree.
        extra: { ...(input.tree === "architecture" ? { tree: "architecture" } : {}), node: node.data, label: input.label },
      } as CreateDocInput,
      opts?.by !== undefined ? { by: opts.by } : undefined,
    );
    return created;
  }

  /** Set a node's display label (`extra.label`). */
  async setLabel(node: string, label: string, opts?: { by?: string }): Promise<Result<DocRecord, LoreError>> {
    if (label.trim() === "") return err(validationError("label", "label must not be empty"));
    const target = await this.resolveBaselineDoc(node);
    if (!target.ok) return target;
    const gate = await this.authorizeCorpusWrite([target.value], "label-set", opts?.by);
    if (!gate.ok) return gate;
    return this.retryWrite(target.value.id, opts?.by, (doc) => ok({
      extra: { ...doc.extra, label },
      summary: `Baseline label set to '${label}'`,
      details: { operation: "label-set", label },
    }));
  }

  /**
   * Add and/or remove `depends_on` entries (rule ids) of a leaf. Every `add` entry must
   * exist in the rule registry; every `remove` entry must currently be present.
   */
  async setDependsOn(
    leaf: string,
    change: { add?: string[]; remove?: string[] },
    opts?: { by?: string },
  ): Promise<Result<DocRecord, LoreError>> {
    const add = change.add ?? [];
    const remove = change.remove ?? [];
    if (add.length === 0 && remove.length === 0) {
      return err(validationError("depends_on", "nothing to change: pass at least one add or remove rule id"));
    }
    const target = await this.resolveBaselineDoc(leaf, "leaf");
    if (!target.ok) return target;
    const gate = await this.authorizeCorpusWrite([target.value], "depends-on", opts?.by);
    if (!gate.ok) return gate;
    for (const id of [...add, ...remove]) {
      if (!BASELINE_RULE_ID_PATTERN.test(id)) {
        return err(validationError("depends_on", `'${id}' is not a rule id (BR-<n>)`, id));
      }
    }
    const registry = await this.store.listRuleRegistry();
    if (!registry.ok) return registry;
    const docs = await this.listBaselineDocs();
    if (!docs.ok) return docs;
    const known = collectKnownRuleIds(docs.value, registry.value);
    const unknown = add.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return err(validationError("depends_on", `rule id(s) that exist nowhere in the baseline tree or registry: ${unknown.join(", ")}`, unknown));
    }
    return this.retryWrite(target.value.id, opts?.by, (doc) => {
      const current = dependsOnOf(doc);
      const absent = remove.filter((id) => !current.includes(id));
      if (absent.length > 0) {
        return err(validationError("depends_on", `cannot remove, not present: ${absent.join(", ")}`, absent));
      }
      const next = [...new Set([...current.filter((id) => !remove.includes(id)), ...add])];
      return ok({
        extra: { ...doc.extra, depends_on: next },
        summary: `depends_on +${add.length} -${remove.length}`,
        details: { operation: "depends-on", add, remove },
      });
    });
  }

  /**
   * Edit a leaf's `site_map` (census site key -> rule ids | `non-business:<reason>`) and its
   * `commands` list — the ONLY writer of both keys (`lore baseline map`).
   *
   * @returns the updated leaf; VALIDATION_ERROR for an empty change, a non-leaf, a rule id the
   *   leaf does not carry, a `non-business:` entry without a reason, or removing something absent.
   */
  async setSiteMap(
    leaf: string,
    change: SiteMapChange,
    opts?: { by?: string },
  ): Promise<Result<DocRecord, LoreError>> {
    const sites = change.sites ?? {};
    const removeSites = change.removeSites ?? [];
    const addCommands = (change.addCommands ?? []).map((c) => c.trim());
    const removeCommands = (change.removeCommands ?? []).map((c) => c.trim());
    if (Object.keys(sites).length + removeSites.length + addCommands.length + removeCommands.length === 0) {
      return err(validationError("site_map", "nothing to change: pass at least one site mapping, removal or command"));
    }
    if ([...addCommands, ...removeCommands].some((c) => c.length === 0)) {
      return err(validationError("commands", "a command name must not be blank"));
    }
    const target = await this.resolveBaselineDoc(leaf, "leaf");
    if (!target.ok) return target;
    const gate = await this.authorizeCorpusWrite([target.value], "baseline-map", opts?.by);
    if (!gate.ok) return gate;
    return this.retryWrite(target.value.id, opts?.by, (doc) => {
      const ruleIds = new Set(rulesOf(doc).map((r) => r.id));
      for (const [site, entries] of Object.entries(sites)) {
        if (site.trim().length === 0 || entries.length === 0) {
          return err(validationError("site_map", `site '${site}' needs a non-empty key and at least one rule id or non-business reason`, site));
        }
        for (const entry of entries) {
          const isReason = entry.startsWith(NON_BUSINESS_PREFIX) && entry.slice(NON_BUSINESS_PREFIX.length).trim().length > 0;
          if (!isReason && !ruleIds.has(entry)) {
            return err(validationError("site_map", `'${entry}' for site '${site}' is neither a rule of this leaf nor '${NON_BUSINESS_PREFIX}<reason>'`, entry));
          }
        }
      }
      const currentMap = siteMapOf(doc);
      const absentSites = removeSites.filter((k) => !(k in currentMap));
      if (absentSites.length > 0) {
        return err(validationError("site_map", `cannot remove, not mapped: ${absentSites.join(", ")}`, absentSites));
      }
      const currentCommands = commandsOf(doc);
      const absentCommands = removeCommands.filter((c) => !currentCommands.includes(c));
      if (absentCommands.length > 0) {
        return err(validationError("commands", `cannot remove, not present: ${absentCommands.join(", ")}`, absentCommands));
      }
      const nextMap: Record<string, string[]> = { ...currentMap, ...sites };
      for (const key of removeSites) delete nextMap[key];
      const nextCommands = [...new Set([...currentCommands.filter((c) => !removeCommands.includes(c)), ...addCommands])];
      const extra: Record<string, unknown> = { ...doc.extra };
      if (Object.keys(nextMap).length > 0) extra["site_map"] = nextMap;
      else delete extra["site_map"];
      if (nextCommands.length > 0) extra["commands"] = nextCommands;
      else delete extra["commands"];
      return ok({
        extra,
        summary: `site_map set ${Object.keys(sites).length} removed ${removeSites.length}; commands +${addCommands.length} -${removeCommands.length}`,
        details: { operation: "baseline-map", sites: Object.keys(sites), removeSites, addCommands, removeCommands },
      });
    });
  }

  /** Add a glossary entry to a root|branch node; a duplicate term is refused. */
  async glossaryAdd(
    node: string,
    entry: { term: string; meaning: string; note?: string },
    opts?: { by?: string },
  ): Promise<Result<DocRecord, LoreError>> {
    const parsed = glossaryEntrySchema.safeParse(entry);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(validationError(issue ? `glossary.${issue.path.join(".")}` : "glossary", issue ? issue.message : "invalid glossary entry"));
    }
    const target = await this.resolveBaselineDoc(node, ["root", "branch"]);
    if (!target.ok) return target;
    const gate = await this.authorizeCorpusWrite([target.value], "glossary-add", opts?.by);
    if (!gate.ok) return gate;
    return this.retryWrite(target.value.id, opts?.by, (doc) => {
      const current = glossaryOf(doc);
      if (current.some((g) => g.term === parsed.data.term)) {
        return err(validationError("glossary.term", `term '${parsed.data.term}' already defined`, parsed.data.term));
      }
      return ok({
        extra: { ...doc.extra, glossary: [...current, parsed.data] },
        summary: `Glossary + '${parsed.data.term}'`,
        details: { operation: "glossary-add", term: parsed.data.term },
      });
    });
  }

  /** Remove a glossary entry by exact term; an absent term is refused. */
  async glossaryRemove(node: string, term: string, opts?: { by?: string }): Promise<Result<DocRecord, LoreError>> {
    const target = await this.resolveBaselineDoc(node, ["root", "branch"]);
    if (!target.ok) return target;
    const gate = await this.authorizeCorpusWrite([target.value], "glossary-remove", opts?.by);
    if (!gate.ok) return gate;
    return this.retryWrite(target.value.id, opts?.by, (doc) => {
      const current = glossaryOf(doc);
      if (!current.some((g) => g.term === term)) {
        return err(validationError("glossary.term", `term '${term}' is not defined on this node`, term));
      }
      return ok({
        extra: { ...doc.extra, glossary: current.filter((g) => g.term !== term) },
        summary: `Glossary - '${term}'`,
        details: { operation: "glossary-remove", term },
      });
    });
  }

  // ── read ───────────────────────────────────────────────────────────────────

  /**
   * Baseline nodes depth-first, siblings ordered by slug. Without `root` every node whose
   * parent is not a baseline doc (each `node=root`) starts a subtree; with `root` (id|slug of
   * a baseline doc) only that subtree is returned. Read-only.
   */
  async listBaselineTree(root?: string): Promise<Result<BaselineTreeEntry[], LoreError>> {
    const docs = await this.listBaselineDocs();
    if (!docs.ok) return docs;
    const byParent = new Map<string, DocRecord[]>();
    const ids = new Set(docs.value.map((d) => d.id));
    for (const doc of docs.value) {
      const key = doc.parent_id !== null && ids.has(doc.parent_id) ? doc.parent_id : "";
      byParent.set(key, [...(byParent.get(key) ?? []), doc]);
    }
    let starts: DocRecord[];
    if (root === undefined) {
      starts = byParent.get("") ?? [];
    } else {
      const resolved = await this.resolveBaselineDoc(root);
      if (!resolved.ok) return resolved;
      starts = [resolved.value];
    }
    const entries: BaselineTreeEntry[] = [];
    const visit = (doc: DocRecord, depth: number): void => {
      const tally: Record<RuleLifecycle, number> = { live: 0, deprecated: 0, retired: 0 };
      for (const rule of rulesOf(doc)) tally[rule.lifecycle] += 1;
      const label = doc.extra["label"];
      entries.push({
        id: doc.id,
        slug: doc.slug,
        title: doc.title,
        status: doc.status,
        depth,
        node: String(doc.extra["node"] ?? "?"),
        label: typeof label === "string" ? label : null,
        rules: tally,
        tree: doc.extra["tree"] === "architecture" ? "architecture" : "business",
      });
      const children = [...(byParent.get(doc.id) ?? [])].sort((a, b) => a.slug.localeCompare(b.slug));
      for (const child of children) visit(child, depth + 1);
    };
    for (const start of [...starts].sort((a, b) => a.slug.localeCompare(b.slug))) visit(start, 0);
    return ok(entries);
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private resolveActor(by?: string): string {
    return resolveActorWithSource(by, process.env).actor;
  }

  /** Resolve id|slug to a live baseline doc, optionally restricted to node kind(s). */
  private async resolveBaselineDoc(
    idOrSlug: string,
    kinds?: BaselineNode | readonly BaselineNode[],
  ): Promise<Result<DocRecord, LoreError>> {
    const resolved = await resolveDoc(this.store, idOrSlug);
    if (!resolved.ok) return resolved;
    const doc = resolved.value;
    if (doc.type !== "baseline") {
      return err(validationError("type", `expected a baseline doc; '${idOrSlug}' is a ${doc.type}`, doc.type));
    }
    if (kinds !== undefined) {
      const allowed = typeof kinds === "string" ? [kinds] : kinds;
      const kind = doc.extra["node"];
      if (typeof kind !== "string" || !(allowed as readonly string[]).includes(kind)) {
        const need = allowed.join("|");
        return err(validationError(
          "node",
          need === "leaf"
            ? `rules and depends_on live only on a leaf node (got node=${String(kind)})`
            : `operation requires node=${need} (got node=${String(kind)})`,
          kind,
        ));
      }
    }
    return ok(doc);
  }

  /**
   * Every id of a four-part standard's `current_exceptions` must be a LIVE `AD-n` debt entry that some
   * architecture debt-registry carries. Runs BEFORE allocation, so a refusal burns no registry id.
   */
  private async checkCurrentExceptions(ids: readonly string[] | undefined): Promise<Result<void, LoreError>> {
    if (ids === undefined || ids.length === 0) return ok(undefined);
    const docs = await this.listBaselineDocs();
    if (!docs.ok) return docs;
    const held = collectLeafRules(docs.value);
    for (const id of ids) {
      const entry = held.get(id);
      if (ruleIdPrefix(id) !== "AD" || entry === undefined || entry.lifecycle !== "live") {
        return err(validationError(
          "current_exceptions",
          `${id} is not a live AD-<n> debt entry (a standard's current exceptions name existing, live debt entries only)`,
          id,
        ));
      }
    }
    return ok(undefined);
  }

  private async readLeaf(id: string): Promise<Result<DocRecord, LoreError>> {
    const found = await this.store.find(id);
    if (!found.ok) return found;
    if (found.value === null) return err({ code: "DOC_NOT_FOUND", id });
    return ok(found.value);
  }

  /**
   * Every live baseline doc (one `findMany`) — rules are located by what the LEAVES carry, not
   * by the registry alone: the registry is the id allocator, the leaf is the rule's home, and a
   * leaf authored through `lore create baseline --extra` can carry ids the registry never saw.
   */
  private async listBaselineDocs(): Promise<Result<DocRecord[], LoreError>> {
    return this.store.findMany({ type: "baseline" });
  }

  /** Owning leaf + stored rule for `ruleId`, and whether the registry knows the id. */
  private async locateRule(
    ruleId: string,
  ): Promise<Result<{ sourceLeaf: DocRecord; current: BaselineRule; registered: boolean }, LoreError>> {
    const docs = await this.listBaselineDocs();
    if (!docs.ok) return docs;
    const sourceLeaf = docs.value.find((d) => rulesOf(d).some((r) => r.id === ruleId));
    if (sourceLeaf === undefined) return err({ code: "DOC_NOT_FOUND", id: ruleId });
    const current = rulesOf(sourceLeaf).find((r) => r.id === ruleId);
    if (current === undefined) return err({ code: "DOC_NOT_FOUND", id: ruleId });
    const registry = await this.store.listRuleRegistry();
    if (!registry.ok) return registry;
    const row = registry.value.find((r) => r.id === ruleId);
    if (row !== undefined && row.leaf_doc_id !== sourceLeaf.id) {
      return err({
        code: "STORE_ERROR",
        message: `rule registry maps ${ruleId} to leaf ${row.leaf_doc_id} but leaf ${sourceLeaf.slug} carries it — registry and leaf diverged`,
      });
    }
    return ok({ sourceLeaf, current, registered: row !== undefined });
  }

  /**
   * If `doc` is approved, write the approved→draft demotion (the shared
   * `resolveStatusAfterContractEdit` rule) as its own CAS write and return the fresh doc;
   * otherwise return `doc` unchanged.
   */
  private async demoteIfApproved(doc: DocRecord, actor: string, why: string): Promise<Result<DocRecord, LoreError>> {
    const status = resolveStatusAfterContractEdit(doc.status, true);
    if (status === doc.status) return ok(doc);
    return this.commit(doc, doc.extra, status, actor, `Demoted to draft: ${why} edits approved content`, {
      operation: "demote", reason: why,
    });
  }

  /** CAS write of one leaf (doc + version row + audit entry, atomic). */
  private async commit(
    doc: DocRecord,
    extra: Record<string, unknown>,
    status: DocStatus,
    actor: string,
    summary: string,
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
    return this.store.updateWithProvenance(
      doc.id,
      { extra, status, version, updated_at: now },
      { expected_version: doc.version },
      versionRecord,
      {
        timestamp: now,
        actor,
        session_id: doc.id,
        action: "update",
        doc_id: doc.id,
        details: { ...details, version, new_version: version },
      },
    );
  }

  /** One mutate→demote→commit attempt on `doc` (already freshly read). */
  private async writeLeafExtra(
    doc: DocRecord,
    actor: string,
    mutate: (doc: DocRecord) => Mutation,
  ): Promise<Result<DocRecord, LoreError>> {
    const ready = await this.demoteIfApproved(doc, actor, "baseline edit");
    if (!ready.ok) return ready;
    const mutation = mutate(ready.value);
    if (!mutation.ok) return mutation;
    const shape = baselineExtraSchema.safeParse(mutation.value.extra);
    if (!shape.success) {
      const issue = shape.error.issues[0];
      return err(validationError(issue ? `extra.${issue.path.join(".")}` : "extra", issue ? issue.message : "invalid baseline extra"));
    }
    return this.commit(ready.value, mutation.value.extra, ready.value.status, actor, mutation.value.summary, mutation.value.details);
  }

  /** Re-read → mutate → commit, re-applying on STALE_VERSION up to {@link MAX_CAS_REAPPLIES} times. */
  private async retryWrite(
    docId: string,
    by: string | undefined,
    mutate: (doc: DocRecord) => Mutation,
  ): Promise<Result<DocRecord, LoreError>> {
    const actor = this.resolveActor(by);
    let lastStale: LoreError | undefined;
    for (let attempt = 0; attempt <= MAX_CAS_REAPPLIES; attempt += 1) {
      const fresh = await this.readLeaf(docId);
      if (!fresh.ok) return fresh;
      const written = await this.writeLeafExtra(fresh.value, actor, mutate);
      if (written.ok) return written;
      if (written.error.code !== "STALE_VERSION") return written;
      lastStale = written.error;
    }
    return err(lastStale ?? staleExhausted(docId));
  }

  /**
   * Move a rule the registry never allocated (a leaf authored with the rule already inside).
   * `store.moveRule` needs the registry row, so this is two CAS writes — DESTINATION first, so
   * a crash between them leaves the rule on both leaves (a duplicate id, loudly detectable)
   * rather than on neither (a lost rule). The id still never changes.
   */
  private async moveUnregisteredRule(
    from: DocRecord,
    fromExtra: Record<string, unknown>,
    to: DocRecord,
    toExtra: Record<string, unknown>,
    actor: string,
  ): Promise<Result<{ from: DocRecord; to: DocRecord }, LoreError>> {
    const added = await this.commit(to, toExtra, to.status, actor, "Rule moved in (unregistered id)", { operation: "rule-move-in" });
    if (!added.ok) return added;
    const removed = await this.commit(from, fromExtra, from.status, actor, "Rule moved out (unregistered id)", { operation: "rule-move-out" });
    if (!removed.ok) return removed;
    return ok({ from: removed.value, to: added.value });
  }

  /** Audit entry for the store-owned allocate / move transactions (they write the version row themselves). */
  private async appendAudit(
    actor: string,
    doc: DocRecord,
    operation: string,
    details: Record<string, unknown>,
  ): Promise<Result<void, LoreError>> {
    return this.store.appendAuditEntry({
      timestamp: new Date().toISOString(),
      actor,
      session_id: doc.id,
      action: "update",
      doc_id: doc.id,
      details: { ...details, operation, version: doc.version, new_version: doc.version },
    });
  }
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function staleExhausted(id: string): LoreError {
  return {
    code: "STORE_ERROR",
    message: `CAS re-apply budget (${MAX_CAS_REAPPLIES}) exhausted for ${id} without a recorded STALE_VERSION`,
  };
}

/** Rules stored on a leaf, parsed through the schema so a corrupt row fails loud downstream. */
function rulesOf(doc: DocRecord): BaselineRule[] {
  const raw = doc.extra["rules"];
  return Array.isArray(raw) ? (raw as BaselineRule[]) : [];
}

function dependsOnOf(doc: DocRecord): string[] {
  const raw = doc.extra["depends_on"];
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function siteMapOf(doc: DocRecord): Record<string, string[]> {
  const raw = doc.extra["site_map"];
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string[]>) : {};
}

function commandsOf(doc: DocRecord): string[] {
  const raw = doc.extra["commands"];
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function glossaryOf(doc: DocRecord): GlossaryEntry[] {
  const raw = doc.extra["glossary"];
  return Array.isArray(raw) ? (raw as GlossaryEntry[]) : [];
}

const SETTABLE_RULE_FIELDS = ["statement", "confidence", "enforced_by", "examples", "lifecycle", "note", "moveTo", "current_reality", "target_rule", "current_exceptions", "migration"] as const;

/** Patch-level refusals that need no stored state. */
function validateSetRulePatch(patch: SetRulePatch): Result<void, LoreError> {
  if (!SETTABLE_RULE_FIELDS.some((field) => patch[field] !== undefined)) {
    return err(validationError("patch", "nothing to change: pass at least one of statement, confidence, enforced_by, examples, lifecycle, note, moveTo, current_reality, target_rule, current_exceptions, migration"));
  }
  if (patch.lifecycle === "retired" && (patch.note === undefined || patch.note.trim() === "")) {
    return err(validationError("note", "lifecycle=retired requires --note (stored as retired_note)"));
  }
  if (patch.note !== undefined && patch.lifecycle !== "retired") {
    return err(validationError("note", "note is the retirement note and is valid only with lifecycle=retired"));
  }
  return ok(undefined);
}

/** Apply a patch to the stored rule; enforces forward-only lifecycle and re-validates the whole rule. */
function applyRulePatch(current: BaselineRule, patch: SetRulePatch): Result<BaselineRule, LoreError> {
  if (patch.lifecycle !== undefined && !isLawfulRuleLifecycleTransition(current.lifecycle, patch.lifecycle)) {
    return err(validationError(
      "lifecycle",
      `rule ${current.id} cannot move ${current.lifecycle} -> ${patch.lifecycle}; lifecycle is forward-only (live -> deprecated -> retired)`,
      patch.lifecycle,
    ));
  }
  const next = {
    ...current,
    ...(patch.statement !== undefined ? { statement: patch.statement } : {}),
    ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
    ...(patch.enforced_by !== undefined ? { enforced_by: patch.enforced_by } : {}),
    ...(patch.examples !== undefined ? { examples: patch.examples } : {}),
    ...(patch.lifecycle !== undefined ? { lifecycle: patch.lifecycle } : {}),
    ...(patch.note !== undefined ? { retired_note: patch.note } : {}),
    ...(patch.current_reality !== undefined ? { current_reality: patch.current_reality } : {}),
    ...(patch.target_rule !== undefined ? { target_rule: patch.target_rule } : {}),
    ...(patch.current_exceptions !== undefined ? { current_exceptions: patch.current_exceptions } : {}),
    ...(patch.migration !== undefined ? { migration: patch.migration } : {}),
  };
  const parsed = baselineRuleSchema.safeParse(next);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(validationError(issue ? `rule.${issue.path.join(".")}` : "rule", issue ? issue.message : "invalid rule"));
  }
  return ok(parsed.data);
}

function patchSummary(patch: SetRulePatch): string {
  return `Rule set: ${Object.keys(patch).filter((k) => patch[k as keyof SetRulePatch] !== undefined).join(", ")}`;
}

/** Replace one rule inside a leaf's `extra.rules`, keeping its position. */
function replaceRule(
  doc: DocRecord,
  ruleId: string,
  next: BaselineRule,
  summary: string,
  details: Record<string, unknown>,
): Mutation {
  const rules = rulesOf(doc);
  if (!rules.some((r) => r.id === ruleId)) {
    return err({ code: "STORE_ERROR", message: `rule ${ruleId} disappeared from ${doc.slug} between read and write` });
  }
  return ok({
    extra: { ...doc.extra, rules: rules.map((r) => (r.id === ruleId ? next : r)) },
    summary,
    details,
  });
}
