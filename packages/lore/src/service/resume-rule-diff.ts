/**
 * resume-rule-diff — BL-15 (SPEC-157 AC-BLS2-22, rule BR-966, leaf baseline-resume-a-session).
 *
 * When a session resumes a CLAIMED task, the governing baseline rules may have moved since the
 * claim. This module answers "what changed under me?": for every rule the task's spec cites
 * (`spec.extra.acceptance_criteria[].cites`), it compares the rule as of the claim instant
 * (`task.extra.claim.at`) against the rule now, and reports statement / confidence / lifecycle
 * changes with old and new values. A rule that is retired now but was not at claim time is listed
 * in `retired` (and NOT additionally as a lifecycle change — one fact, one line).
 *
 * @invariant Value at claim time comes from baseline doc VERSION rows: the newest row with
 *   `created_at <= claim.at` that carries the rule. A change made at or before the claim instant
 *   is therefore never reported; only later edits are.
 * @invariant Pure read — no writes, no wall-clock reads. Fails loud: no claim, unknown task, a
 *   task without a resolvable spec, or a corrupt stored rule is an `err`, never an empty diff.
 * @invariant A task whose plan is not parented by a spec governs no rules: the diff is empty (ok),
 *   not an error — nothing it cites can have moved.
 * @invariant A governing rule with no version row at or before the claim (it did not exist yet)
 *   has no "old" value and is skipped — there is nothing to diff against.
 */

import { err, ok, type Result } from "@lore/core";
import type { LoreError, DocRecord, VersionRecord } from "@lore/core";
import { BASELINE_RULE_ID_PATTERN, baselineRuleSchema, type BaselineRule } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

export type RuleChangeKind = "statement" | "confidence" | "lifecycle";

export interface RuleChange {
  readonly rule_id: string;
  readonly kind: RuleChangeKind;
  readonly old: string;
  readonly new: string;
}

export interface RuleDiff {
  readonly claimed_at: string;
  /** Rule ids the task's spec cites. Empty = the task governs no baseline rule (nothing to report). */
  readonly governing: readonly string[];
  readonly changes: readonly RuleChange[];
  readonly retired: readonly string[];
}

export const RULES_UNCHANGED_LINE = "governing rules unchanged since claim";

const VERSION_PAGE = 200;

function validation(field: string, message: string): LoreError {
  return { code: "VALIDATION_ERROR", field, message };
}

function parseRule(raw: unknown, where: string): Result<BaselineRule, LoreError> {
  const parsed = baselineRuleSchema.safeParse(raw);
  if (!parsed.success) {
    return err({ code: "STORE_ERROR", message: `corrupt rule in ${where}: ${parsed.error.issues[0]?.message ?? "invalid"}` });
  }
  return ok(parsed.data);
}

function rulesIn(extra: Record<string, unknown>): unknown[] {
  const raw = extra["rules"];
  return Array.isArray(raw) ? raw : [];
}

/** Governing rule ids: every BR-id cited by the spec's acceptance criteria, first-seen order. */
function governingRuleIds(spec: DocRecord): string[] {
  const criteria = spec.extra["acceptance_criteria"];
  if (!Array.isArray(criteria)) return [];
  const seen = new Set<string>();
  for (const c of criteria) {
    const cites = (c as { cites?: unknown } | null)?.cites;
    if (!Array.isArray(cites)) continue;
    for (const entry of cites) {
      if (typeof entry === "string" && BASELINE_RULE_ID_PATTERN.test(entry)) seen.add(entry);
    }
  }
  return [...seen];
}

async function allVersions(store: StoreInterface, docId: string): Promise<Result<VersionRecord[], LoreError>> {
  const out: VersionRecord[] = [];
  for (let offset = 0; ; offset += VERSION_PAGE) {
    const page = await store.findVersions(docId, { limit: VERSION_PAGE, offset });
    if (!page.ok) return page;
    out.push(...page.value);
    if (page.value.length < VERSION_PAGE) return ok(out);
  }
}

/** The task's governing spec, or `null` when its plan is not parented by a spec (nothing is governed). */
async function specOfTask(store: StoreInterface, task: DocRecord): Promise<Result<DocRecord | null, LoreError>> {
  const planRef = task.extra["plan_id"];
  const planId = typeof planRef === "string" ? planRef : task.parent_id;
  if (planId === null || planId === undefined) {
    return err(validation("taskId", `task ${task.slug} has no plan, so no governing spec`));
  }
  const plan = await resolveDoc(store, planId);
  if (!plan.ok) return plan;
  if (plan.value.parent_id === null) return ok(null);
  const spec = await resolveDoc(store, plan.value.parent_id);
  if (!spec.ok) return spec;
  return ok(spec.value.type === "spec" ? spec.value : null);
}

/**
 * Diffs the task's governing rules between its claim instant and now.
 *
 * @param args.store - Store to read docs and baseline version history from.
 * @param args.taskId - Task id or slug.
 * @returns the diff, or `VALIDATION_ERROR` when the task holds no claim, `DOC_NOT_FOUND` for an
 *   unknown task, or a propagated store error.
 */
export async function computeRuleDiffSinceClaim(args: {
  store: StoreInterface;
  taskId: string;
}): Promise<Result<RuleDiff, LoreError>> {
  const { store } = args;
  const task = await resolveDoc(store, args.taskId);
  if (!task.ok) return task;
  const claim = task.value.extra["claim"];
  const claimedAt = (claim as { at?: unknown } | null | undefined)?.at;
  if (typeof claimedAt !== "string" || claimedAt === "") {
    return err(validation("taskId", `task ${task.value.slug} has no claim; a rule diff since claim needs a claim timestamp`));
  }

  const spec = await specOfTask(store, task.value);
  if (!spec.ok) return spec;
  const governing = spec.value === null ? [] : governingRuleIds(spec.value);

  const baselines = await store.findMany({ type: "baseline" });
  if (!baselines.ok) return baselines;

  // Current value of each rule, and its value at claim time (newest version row <= claim carrying it).
  const now = new Map<string, BaselineRule>();
  for (const doc of baselines.value) {
    for (const raw of rulesIn(doc.extra)) {
      const rule = parseRule(raw, `baseline ${doc.slug}`);
      if (!rule.ok) return rule;
      if (governing.includes(rule.value.id)) now.set(rule.value.id, rule.value);
    }
  }
  const atClaim = new Map<string, { rule: BaselineRule; at: string }>();
  for (const doc of baselines.value) {
    const versions = await allVersions(store, doc.id);
    if (!versions.ok) return versions;
    for (const v of versions.value) {
      if (v.created_at > claimedAt) continue;
      for (const raw of rulesIn(v.extra)) {
        const rule = parseRule(raw, `baseline ${doc.slug} v${v.version}`);
        if (!rule.ok) return rule;
        if (!governing.includes(rule.value.id)) continue;
        const prior = atClaim.get(rule.value.id);
        if (prior === undefined || v.created_at > prior.at) atClaim.set(rule.value.id, { rule: rule.value, at: v.created_at });
      }
    }
  }

  const changes: RuleChange[] = [];
  const retired: string[] = [];
  for (const id of governing) {
    const current = now.get(id);
    const before = atClaim.get(id)?.rule;
    if (current === undefined || before === undefined) continue; // no old or no current value — nothing to diff
    if (current.statement !== before.statement) {
      changes.push({ rule_id: id, kind: "statement", old: before.statement, new: current.statement });
    }
    if (current.confidence !== before.confidence) {
      changes.push({ rule_id: id, kind: "confidence", old: before.confidence, new: current.confidence });
    }
    if (current.lifecycle !== before.lifecycle) {
      if (current.lifecycle === "retired") retired.push(id);
      else changes.push({ rule_id: id, kind: "lifecycle", old: before.lifecycle, new: current.lifecycle });
    }
  }
  return ok({ claimed_at: claimedAt, governing, changes, retired });
}

/** Renders a diff as feed lines; an empty diff is exactly {@link RULES_UNCHANGED_LINE}. */
export function renderRuleDiff(diff: RuleDiff): string[] {
  if (diff.changes.length === 0 && diff.retired.length === 0) return [RULES_UNCHANGED_LINE];
  const lines = [`governing rules changed since claim (${diff.claimed_at}):`];
  for (const c of diff.changes) {
    lines.push(`  ${c.rule_id} ${c.kind}: ${JSON.stringify(c.old)} -> ${JSON.stringify(c.new)}`);
  }
  for (const id of diff.retired) lines.push(`  ${id} retired since claim`);
  return lines;
}
