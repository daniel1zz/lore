/**
 * Module: baseline-pending — the pure write side of per-item baseline approval: propose a pending revision of one
 * item, discard it, promote it to the approved version.
 *
 * Purpose: BR-626..628, BR-648, BR-722, BR-1338. A baseline node's items (each business rule, plus the node's own part:
 *   title, body, label, glossary, depends_on, commands) each have an approved version and at most one pending
 *   revision. `extra.rules` / `label` / `glossary` / `depends_on` / `commands` and the doc's title and body hold the
 *   APPROVED versions; `extra.pending` holds what is proposed (`baselinePendingSchema`). Every dedicated writer
 *   (`RuleService`, `CorpusService.set` for a body or title) and the approval path (`ReviewService`) builds its next
 *   `extra` through this module, so no writer has its own idea of what "pending" or "promote" means.
 *
 * Public surface: {@link newRevisionId}, {@link initialPending}, {@link effectiveNodePart}, {@link proposeNodePart},
 *   {@link proposeRuleRevision}, {@link effectiveRuleOf}, {@link discardRuleRevision}, {@link discardNodeRevision},
 *   {@link promoteRuleRevision}, {@link promoteNodeRevision}, {@link listPendingItems}, {@link pendingCountOf},
 *   {@link statusFor}, {@link NODE_ITEM}, and the input/output types.
 * Invariants:
 *   - Pure: no store, no clock beyond a fresh ULID per revision; every function returns a new `extra`, never mutates.
 *   - A write to an item REPLACES its pending revision and gives it a new `revision_id`, so an approval that saw an
 *     older revision can be refused. A write that leaves the item equal to its approved version removes the revision
 *     (and gives no new id).
 *   - A node created and never approved carries `pending.node = { initial: true }`: it has no approved own part, so
 *     its own-part writes land directly ({@link proposeNodePart} returns `direct`) and the marker keeps it `draft`.
 *   - `pending` is dropped from `extra` as soon as it holds nothing (an approved node carries no `pending` key).
 *   - Status is derived: `approved` iff nothing is pending ({@link statusFor}); no verb sets a baseline node's status.
 * Side-effect class: pure.
 *
 * Source: spec-baseline-approval-is-per-item-an-edit-adds-a-pending.
 */

import { isDeepStrictEqual } from "node:util";
import { ulid } from "ulidx";
import {
  countPendingItems,
  deriveBaselineStatus,
  type BaselinePending,
  type BaselineRule,
  type DocStatus,
  type GlossaryEntry,
  type PendingNodeRevision,
} from "@lore/core";
import { approvedCommandsOf, approvedDependsOnOf, approvedGlossaryOf, approvedLabelOf, approvedRulesOf, pendingRevisionsOf } from "./baseline-items.js";

/** The item id the node's own part answers to in `--item`, review output and audit rows. */
export const NODE_ITEM = "node";

type Extra = Readonly<Record<string, unknown>>;

/** A fresh revision id: changes on every write to an item. */
export function newRevisionId(): string {
  return ulid();
}

/** The `pending` a newly created baseline node carries: its own part has no approved version yet. */
export function initialPending(): BaselinePending {
  return { node: { revision_id: newRevisionId(), initial: true } };
}

function pendingOf(extra: Extra): { rules: Record<string, { revision_id: string; rule: BaselineRule; move_to?: string }>; node: PendingNodeRevision | undefined } {
  const view = pendingRevisionsOf({ extra });
  return { rules: { ...view.rules } as Record<string, { revision_id: string; rule: BaselineRule; move_to?: string }>, node: view.node };
}

/** `extra` with `pending` set to `rules` / `node`, or without the key when both are empty. */
function withPending(extra: Extra, rules: Record<string, unknown>, node: PendingNodeRevision | undefined): Record<string, unknown> {
  const next: Record<string, unknown> = { ...extra };
  delete next["pending"];
  const pending: Record<string, unknown> = {};
  if (Object.keys(rules).length > 0) pending["rules"] = rules;
  if (node !== undefined) pending["node"] = node;
  if (Object.keys(pending).length > 0) next["pending"] = pending;
  return next;
}

// ─── The node's own part ─────────────────────────────────────────────────────

/** A change to the node's own part. `null` clears a field; an absent key leaves it as it is. */
export interface NodePartChange {
  title?: string;
  content?: string;
  label?: string | null;
  glossary?: readonly GlossaryEntry[] | null;
  depends_on?: readonly string[] | null;
  commands?: readonly string[] | null;
}

/** The node's own part as it reads once its pending revision is applied (what a writer starts from). */
export interface EffectiveNodePart {
  title: string;
  content: string;
  label: string | undefined;
  glossary: GlossaryEntry[];
  depends_on: string[];
  commands: string[];
}

const LIST_FIELDS = ["glossary", "depends_on", "commands"] as const;

/** The node's own part with the pending revision laid over the approved version. */
export function effectiveNodePart(doc: { title: string; content: string; extra: Extra }): EffectiveNodePart {
  const revision = pendingOf(doc.extra).node;
  const pick = <T>(key: keyof PendingNodeRevision, approved: T, emptyAs: T): T => {
    if (revision === undefined || !(key in revision)) return approved;
    const value = revision[key];
    return value === null || value === undefined ? emptyAs : (value as T);
  };
  return {
    title: revision?.title ?? doc.title,
    content: revision?.content ?? doc.content,
    label: pick<string | undefined>("label", approvedLabelOf({ extra: doc.extra }), undefined),
    glossary: pick<GlossaryEntry[]>("glossary", [...approvedGlossaryOf({ extra: doc.extra })] as GlossaryEntry[], []),
    depends_on: pick<string[]>("depends_on", approvedDependsOnOf({ extra: doc.extra }), []),
    commands: pick<string[]>("commands", approvedCommandsOf({ extra: doc.extra }), []),
  };
}

/** What {@link proposeNodePart} decided. */
export type NodePartProposal =
  /** The change leaves the node's own part as it reads now: nothing to write. */
  | { readonly kind: "unchanged" }
  /** A pending revision (new `extra`; the stored title and body stay the approved ones). */
  | { readonly kind: "pending"; readonly extra: Record<string, unknown> }
  /** A never-approved node: the change lands on the stored fields. `title` / `content` are set only when they change. */
  | { readonly kind: "direct"; readonly extra: Record<string, unknown>; readonly title?: string; readonly content?: string };

function normalised(field: (typeof LIST_FIELDS)[number], value: readonly unknown[] | null | undefined): unknown[] | null {
  if (value === null || value === undefined || value.length === 0) return null;
  return [...value];
}

/**
 * Record `change` on the node's own part: a pending revision of the one item, or a direct write for a never-approved
 * node. A field set back to its approved value drops out of the revision; an emptied revision is removed.
 */
export function proposeNodePart(doc: { title: string; content: string; extra: Extra }, change: NodePartChange): NodePartProposal {
  const { rules, node } = pendingOf(doc.extra);
  const effective = effectiveNodePart(doc);

  if (node?.initial === true) {
    const extra: Record<string, unknown> = { ...doc.extra };
    let touched = false;
    if (change.label !== undefined) {
      const next = change.label ?? undefined;
      if (next !== effective.label) touched = true;
      if (next === undefined) delete extra["label"];
      else extra["label"] = next;
    }
    for (const field of LIST_FIELDS) {
      const value = change[field];
      if (value === undefined) continue;
      const next = normalised(field, value);
      if (!isDeepStrictEqual(next ?? [], effective[field])) touched = true;
      if (next === null) delete extra[field];
      else extra[field] = next;
    }
    const titleChanged = change.title !== undefined && change.title !== doc.title;
    const contentChanged = change.content !== undefined && change.content !== doc.content;
    if (!touched && !titleChanged && !contentChanged) return { kind: "unchanged" };
    return {
      kind: "direct",
      extra,
      ...(titleChanged ? { title: change.title as string } : {}),
      ...(contentChanged ? { content: change.content as string } : {}),
    };
  }

  const revision: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node ?? {})) if (key !== "revision_id") revision[key] = value;
  const approved: Record<string, unknown> = {
    title: doc.title,
    content: doc.content,
    label: approvedLabelOf({ extra: doc.extra }) ?? null,
    glossary: normalised("glossary", approvedGlossaryOf({ extra: doc.extra })),
    depends_on: normalised("depends_on", approvedDependsOnOf({ extra: doc.extra })),
    commands: normalised("commands", approvedCommandsOf({ extra: doc.extra })),
  };
  let touched = false;
  const apply = (key: string, next: unknown): void => {
    const current = key in revision ? revision[key] : approved[key];
    if (isDeepStrictEqual(next, current)) return;
    touched = true;
    if (isDeepStrictEqual(next, approved[key])) delete revision[key];
    else revision[key] = next;
  };
  if (change.title !== undefined) apply("title", change.title);
  if (change.content !== undefined) apply("content", change.content);
  if (change.label !== undefined) apply("label", change.label);
  for (const field of LIST_FIELDS) {
    const value = change[field];
    if (value !== undefined) apply(field, normalised(field, value));
  }
  if (!touched) return { kind: "unchanged" };
  const nextNode = Object.keys(revision).length === 0 ? undefined : ({ revision_id: newRevisionId(), ...revision } as PendingNodeRevision);
  return { kind: "pending", extra: withPending(doc.extra, rules, nextNode) };
}

/** `extra` without the node's pending revision (the node's own part reads as approved again). */
export function discardNodeRevision(extra: Extra): Record<string, unknown> {
  return withPending(extra, pendingOf(extra).rules, undefined);
}

/**
 * Promote the node's pending revision to the approved version: the revision's fields become the stored ones
 * (`null` clears a field) and the revision is removed.
 *
 * @returns the new `extra` and the title / body to store (set only when the revision carries one).
 */
export function promoteNodeRevision(doc: { extra: Extra }): { extra: Record<string, unknown>; title?: string; content?: string } {
  const { rules, node } = pendingOf(doc.extra);
  const extra: Record<string, unknown> = { ...doc.extra };
  if (node !== undefined) {
    if ("label" in node) {
      if (node.label === null || node.label === undefined) delete extra["label"];
      else extra["label"] = node.label;
    }
    for (const field of LIST_FIELDS) {
      if (!(field in node)) continue;
      const value = node[field];
      if (value === null || value === undefined) delete extra[field];
      else extra[field] = value;
    }
  }
  const result: { extra: Record<string, unknown>; title?: string; content?: string } = {
    extra: withPending(extra, rules, undefined),
  };
  if (node?.title !== undefined) result.title = node.title;
  if (node?.content !== undefined) result.content = node.content;
  return result;
}

// ─── Rules ───────────────────────────────────────────────────────────────────

/** The rule as it reads once its pending revision is applied: the pending rule, else the approved one. */
export function effectiveRuleOf(extra: Extra, ruleId: string): BaselineRule | undefined {
  const revision = pendingOf(extra).rules[ruleId];
  if (revision !== undefined) return revision.rule;
  return approvedRulesOf({ extra }).find((r): r is BaselineRule => typeof r === "object" && r !== null && (r as { id?: unknown }).id === ruleId);
}

function approvedRule(extra: Extra, ruleId: string): BaselineRule | undefined {
  return approvedRulesOf({ extra }).find((r): r is BaselineRule => typeof r === "object" && r !== null && (r as { id?: unknown }).id === ruleId);
}

/**
 * Record `rule` as the pending revision of its item (a pending add when the rule has no approved version). A revision
 * equal to the approved version, with no move, removes the pending revision instead.
 *
 * @param moveTo - id of the leaf the rule moves to on approval
 */
export function proposeRuleRevision(extra: Extra, rule: BaselineRule, moveTo?: string): Record<string, unknown> {
  const { rules, node } = pendingOf(extra);
  const approved = approvedRule(extra, rule.id);
  const next = { ...rules };
  if (approved !== undefined && moveTo === undefined && isDeepStrictEqual(approved, rule)) {
    delete next[rule.id];
  } else {
    next[rule.id] = { revision_id: newRevisionId(), rule, ...(moveTo !== undefined ? { move_to: moveTo } : {}) };
  }
  return withPending(extra, next, node);
}

/** `extra` without the pending revision of `ruleId` (an approved rule reads as approved again; a pending add disappears). */
export function discardRuleRevision(extra: Extra, ruleId: string): Record<string, unknown> {
  const { rules, node } = pendingOf(extra);
  const next = { ...rules };
  delete next[ruleId];
  return withPending(extra, next, node);
}

/**
 * Promote the pending revision of `ruleId`: it replaces the approved version in place, or is appended when the rule had
 * none. A revision that moves the rule is removed from this leaf (the caller adds it to the destination).
 *
 * @returns the new `extra`, or `undefined` when `ruleId` holds no pending revision.
 */
export function promoteRuleRevision(extra: Extra, ruleId: string): Record<string, unknown> | undefined {
  const { rules, node } = pendingOf(extra);
  const revision = rules[ruleId];
  if (revision === undefined) return undefined;
  const approved = approvedRulesOf({ extra }) as BaselineRule[];
  const listed = approved.some((r) => r.id === ruleId);
  let nextRules: BaselineRule[];
  if (revision.move_to !== undefined) nextRules = approved.filter((r) => r.id !== ruleId);
  else if (listed) nextRules = approved.map((r) => (r.id === ruleId ? revision.rule : r));
  else nextRules = [...approved, revision.rule];
  const remaining = { ...rules };
  delete remaining[ruleId];
  const base: Record<string, unknown> = { ...extra };
  if (nextRules.length > 0) base["rules"] = nextRules;
  else delete base["rules"];
  return withPending(base, remaining, node);
}

/** `extra` with `rule` appended to the approved rules (the destination of an approved move). */
export function appendApprovedRule(extra: Extra, rule: BaselineRule): Record<string, unknown> {
  const approved = approvedRulesOf({ extra }) as BaselineRule[];
  return { ...extra, rules: [...approved.filter((r) => r.id !== rule.id), rule] };
}

/** A rule an approval moves to another leaf: its approved version after the promotion, and the destination leaf id. */
export interface PromotedMove {
  readonly ruleId: string;
  readonly rule: BaselineRule;
  readonly moveTo: string;
}

/** What promoting a set of pending items does to a node. */
export interface Promotion {
  /** The node's new `extra` (moving rules already removed from its approved rules). */
  readonly extra: Record<string, unknown>;
  /** New title / body when the node's own-part revision carries one. */
  readonly title?: string;
  readonly content?: string;
  /** The rules that leave this node: the caller writes them to their destination leaf. */
  readonly moves: readonly PromotedMove[];
}

/**
 * Promote the pending revisions named by `items` (rule ids and/or {@link NODE_ITEM}); every other pending revision is
 * left exactly as it is (BR-1338: items not named are untouched). An item that holds no pending revision is skipped.
 */
export function promoteItems(doc: { extra: Extra }, items: readonly string[]): Promotion {
  let extra: Record<string, unknown> = { ...doc.extra };
  const moves: PromotedMove[] = [];
  let title: string | undefined;
  let content: string | undefined;
  for (const item of items) {
    if (item === NODE_ITEM) {
      const promoted = promoteNodeRevision({ extra });
      extra = promoted.extra;
      title = promoted.title ?? title;
      content = promoted.content ?? content;
      continue;
    }
    const revision = pendingOf(extra).rules[item];
    if (revision === undefined) continue;
    const next = promoteRuleRevision(extra, item);
    if (next === undefined) continue;
    extra = next;
    if (revision.move_to !== undefined) moves.push({ ruleId: item, rule: revision.rule, moveTo: revision.move_to });
  }
  return { extra, ...(title !== undefined ? { title } : {}), ...(content !== undefined ? { content } : {}), moves };
}

// ─── Reading what is pending ─────────────────────────────────────────────────

/** One pending revision, named the way `--item` names it. */
export interface PendingItem {
  /** `BR-n` / `AS-n` / `AD-n`, or {@link NODE_ITEM}. */
  readonly item: string;
  readonly revisionId: string;
  readonly kind: "rule-add" | "rule-revision" | "rule-move" | "node";
}

/** Every pending revision of a node, rules first (by id), then the node's own part. */
export function listPendingItems(extra: Extra): PendingItem[] {
  const { rules, node } = pendingOf(extra);
  const items: PendingItem[] = Object.keys(rules)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((id) => {
      const revision = rules[id];
      const listed = approvedRule(extra, id) !== undefined;
      return {
        item: id,
        revisionId: revision?.revision_id ?? "",
        kind: !listed ? ("rule-add" as const) : revision?.move_to !== undefined ? ("rule-move" as const) : ("rule-revision" as const),
      };
    });
  if (node !== undefined) items.push({ item: NODE_ITEM, revisionId: node.revision_id, kind: "node" });
  return items;
}

/** Number of items holding a pending revision. */
export function pendingCountOf(extra: Extra): number {
  const { rules, node } = pendingOf(extra);
  return countPendingItems({ rules, ...(node !== undefined ? { node } : {}) } as BaselinePending);
}

/** The status a node holding `extra` has (BR-1339), starting from its stored `current` status. */
export function statusFor(current: DocStatus, extra: Extra): DocStatus {
  return deriveBaselineStatus(current, pendingCountOf(extra));
}
