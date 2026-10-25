/**
 * Migration 029 — pending revisions that a landed spec change set accounts for become approved (resolves #323).
 *
 * Purpose: migration 028 took each draft baseline node's approved versions from its LAST approved version. Before
 *   BR-1211 changed, `lore rule apply` landed a spec's change set (`extra.rule_changes` entries stamped
 *   `applied_at`) and demoted the leaf, so those already-reviewed changes were read as unapproved and became pending
 *   revisions. This corrective step promotes exactly those back: a pending rule revision whose content equals the
 *   LATEST applied change-set entry for its rule id becomes the approved version of the rule.
 *     - add    -> the pending rule carries the landed statement / examples / enforced_by and is `live`;
 *     - modify -> the pending rule carries the landed fields that the entry sets (statement / examples / enforced_by)
 *                 and is `live`;
 *     - retire -> the pending rule is `retired` with the entry's note.
 *   Every other pending revision (no landed entry, or content that differs from it) is left untouched.
 *
 * Public surface: {@link planLandedPromotion}, {@link collectLandedChanges}, {@link applyMigration029},
 *   {@link MIGRATION_029_SQL}, {@link SELECT_SPEC_EXTRAS_SQL}, {@link specExtrasSqlFor}, {@link PromotionPlan}, {@link LandedChange}.
 * Invariants:
 *   - The planner is pure; the SQLite runner here and the Turso runner in `turso-store.ts` share it and the SQL
 *     constants, so the two stores cannot promote differently.
 *   - ATOMIC: node updates and `PRAGMA user_version = 29` run in ONE transaction; any failure rolls back and throws
 *     {@link MigrationFailedError} naming the node; the corpus stays at schema 28.
 *   - A REAL WRITE per changed node: one `versions` row (action `update`, written by the migrate caller) and ONE
 *     hash-chained audit row (`migrate-schema-029`, in the family of `update`). A node with nothing to promote gets
 *     neither. The actor is the `lore migrate schema` caller's; a promotion with no actor fails loudly.
 *   - The registry follows the approved versions: `docs_idx_baseline_au` re-syncs each rule's lifecycle and version
 *     from the new `extra.rules` (a promoted add goes `proposed` -> `live`, a promoted retire goes `retired`).
 *   - Idempotent: a promoted revision leaves `extra.pending`, so a second run finds nothing to promote.
 *   - A spec whose `extra` is not a JSON object contributes no landed entry (a corrupt spec must not stop the
 *     upgrade, and reading it lenient is how `rule-changes.ts` reads it too); a baseline node whose `extra` is
 *     corrupt fails the run loudly.
 *
 * Side-effect class: schema/data migration (executed once per store).
 */

import { ruleChangeSchema, type RuleChange } from "@lore/core";
import type { AuditEntry } from "@lore/core";
import { computeFtsShadowValues } from "../store-shared.js";
import {
  auditBindings,
  INSERT_AUDIT_SQL,
  INSERT_CONVERSION_VERSION_SQL,
  requireMigrationActor,
  SELECT_AUDIT_HEAD_SQL,
  SELECT_BASELINE_NODES_SQL,
  UPDATE_CONVERTED_NODE_SQL,
  type BaselineNodeRow,
} from "./migration-028.js";
import { MigrationFailedError } from "./migration-026.js";

/** The latest applied change-set entry for one rule id, with the spec that landed it. */
export interface LandedChange {
  readonly specSlug: string;
  readonly change: RuleChange;
}

/** What to write back for one node whose pending revisions were promoted. */
export interface PromotionPlan {
  readonly extra: Record<string, unknown>;
  /** Ids of the rules promoted to approved, in pending order. */
  readonly promotedRuleIds: readonly string[];
}

type PendingRuleRevision = { revision_id: string; rule: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Key-order-insensitive JSON text, so two equal values compare equal whatever order their keys were written in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    // reason: a spec with unparseable extra has no readable change set; it contributes nothing (see module note).
    return undefined;
  }
}

/**
 * The latest APPLIED entry per rule id across every spec. "Latest" is the greatest `applied_at`; a tie goes to the
 * entry read last (specs in the order given, entries in stored order).
 *
 * @param specs - the live spec docs as `{ slug, extra }` (`extra` = the stored JSON text)
 */
export function collectLandedChanges(specs: readonly { slug: string; extra: string }[]): Map<string, LandedChange> {
  const latest = new Map<string, LandedChange>();
  for (const spec of specs) {
    const extra = parseObject(spec.extra);
    const raw = extra?.["rule_changes"];
    if (!Array.isArray(raw)) continue;
    for (const entry of raw as unknown[]) {
      const parsed = ruleChangeSchema.safeParse(entry);
      if (!parsed.success || parsed.data.applied_at === undefined) continue;
      const held = latest.get(parsed.data.id);
      if (held === undefined || (held.change.applied_at ?? "") <= parsed.data.applied_at) {
        latest.set(parsed.data.id, { specSlug: spec.slug, change: parsed.data });
      }
    }
  }
  return latest;
}

/** True when `rule` is exactly what the landed `change` leaves in the tree (on the fields the entry decides). */
function equalsLanded(rule: Record<string, unknown>, change: RuleChange): boolean {
  if (change.op === "retire") return rule["lifecycle"] === "retired" && rule["retired_note"] === change.note;
  if (rule["lifecycle"] !== "live") return false;
  const fields = change.op === "add" ? (["statement", "examples", "enforced_by"] as const) : (["statement", "examples", "enforced_by"] as const).filter((f) => change[f] !== undefined);
  if (fields.length === 0) return false;
  return fields.every((field) => canonical(rule[field]) === canonical(change[field]));
}

/**
 * Plans the promotion for one baseline node, or `undefined` when nothing on it is promotable.
 *
 * @param node - the node's current row
 * @param landed - {@link collectLandedChanges} of the corpus
 * @throws {Error} when the node's `extra` is not a JSON object — the caller reports it
 */
export function planLandedPromotion(node: BaselineNodeRow, landed: ReadonlyMap<string, LandedChange>): PromotionPlan | undefined {
  const extra = parseObject(node.extra);
  if (extra === undefined) throw new Error(`baseline node ${node.slug}: extra is not a JSON object`);
  const pending = extra["pending"];
  if (!isRecord(pending) || !isRecord(pending["rules"])) return undefined;
  const pendingRules = pending["rules"] as Record<string, PendingRuleRevision>;

  const rules: Record<string, unknown>[] = Array.isArray(extra["rules"]) ? [...(extra["rules"] as Record<string, unknown>[])] : [];
  const remaining: Record<string, PendingRuleRevision> = {};
  const promotedRuleIds: string[] = [];
  for (const [id, revision] of Object.entries(pendingRules)) {
    const entry = landed.get(id);
    if (entry === undefined || !isRecord(revision) || !isRecord(revision.rule) || !equalsLanded(revision.rule, entry.change)) {
      remaining[id] = revision;
      continue;
    }
    const index = rules.findIndex((rule) => isRecord(rule) && rule["id"] === id);
    if (index === -1) rules.push(revision.rule);
    else rules[index] = revision.rule;
    promotedRuleIds.push(id);
  }
  if (promotedRuleIds.length === 0) return undefined;

  const nextPending: Record<string, unknown> = { ...pending };
  if (Object.keys(remaining).length > 0) nextPending["rules"] = remaining;
  else delete nextPending["rules"];
  const next: Record<string, unknown> = { ...extra, rules };
  if (Object.keys(nextPending).length > 0) next["pending"] = nextPending;
  else delete next["pending"];
  return { extra: next, promotedRuleIds };
}

/** Every live spec, for the landed-change index. */
export const SELECT_SPEC_EXTRAS_SQL = "SELECT slug, extra FROM docs WHERE type = 'spec' AND deleted_at IS NULL ORDER BY slug";
/** The same read for a legacy `docs` table that predates the `deleted_at` column (no soft delete existed, so every row is live). */
export const SELECT_SPEC_EXTRAS_LEGACY_SQL = "SELECT slug, extra FROM docs WHERE type = 'spec' ORDER BY slug";
/** `PRAGMA table_info(docs)`, so a runner can tell which of the two reads above its schema supports. */
export const DOCS_TABLE_INFO_SQL = "PRAGMA table_info(docs)";

/** The spec read that fits a `docs` table with (`true`) or without (`false`) the `deleted_at` column. */
export function specExtrasSqlFor(hasDeletedAt: boolean): string {
  return hasDeletedAt ? SELECT_SPEC_EXTRAS_SQL : SELECT_SPEC_EXTRAS_LEGACY_SQL;
}

/** Audit action of a promoted node; in the `update` family of `VERSION_ACTION_AUDIT_FAMILY` (audit-service.ts). */
export const MIGRATION_029_AUDIT_ACTION = "migrate-schema-029";
/** The version's change summary and the audit row's `details.summary`. */
export const MIGRATION_029_SUMMARY = "migrate-schema-029: landed spec changes promoted from pending to approved";
/** The audit row's `session_id`: a corpus-level migration belongs to no doc session. */
export const MIGRATION_029_SESSION_ID = "migrate-schema";
/** The version bump, inside the promotion transaction. */
export const MIGRATION_029_SQL = "PRAGMA user_version = 29;";

/** The values {@link UPDATE_CONVERTED_NODE_SQL} binds for a promoted node (title and content are unchanged). */
export function promotedNodeBindings(node: BaselineNodeRow, plan: PromotionPlan, now: string): [string, string, string, string, string, string, number, string, string] {
  const shadow = computeFtsShadowValues(node.title, node.content, node.tags);
  return [node.title, node.content, JSON.stringify(plan.extra), shadow.fts_title, shadow.fts_content, shadow.fts_tags, Number(node.version) + 1, now, node.id];
}

/** The values {@link INSERT_CONVERSION_VERSION_SQL} binds for a promoted node. */
export function promotedVersionBindings(
  node: BaselineNodeRow,
  plan: PromotionPlan,
  actor: string,
  now: string,
): [string, number, string, string, string, string, string, string, string, string] {
  return [node.id, Number(node.version) + 1, node.content, JSON.stringify(plan.extra), node.status, node.title, now, actor, MIGRATION_029_SUMMARY, node.slug];
}

/** The audit entry of one promoted node (hashed into the chain by the caller). */
export function promotionAuditEntry(node: BaselineNodeRow, plan: PromotionPlan, actor: string, now: string): AuditEntry {
  return {
    timestamp: now,
    actor,
    session_id: MIGRATION_029_SESSION_ID,
    action: MIGRATION_029_AUDIT_ACTION,
    doc_id: node.id,
    details: {
      summary: MIGRATION_029_SUMMARY,
      from_version: Number(node.version),
      to_version: Number(node.version) + 1,
      promoted_rules: [...plan.promotedRuleIds],
    },
  };
}

/** The part of `bun:sqlite`'s `Database` the SQLite runner needs. */
export interface Migration029Database {
  exec(sql: string): unknown;
  query(sql: string): { all(...args: string[]): unknown[]; get(...args: string[]): unknown };
  prepare(sql: string): { run(...args: (string | number | null)[]): unknown };
}

/**
 * Runs migration 029 atomically on a SQLite handle.
 *
 * @param db - an open handle at schema 28
 * @param corpusPath - the corpus file, named in a failure
 * @param actor - the `lore migrate schema` caller, who authors every promotion write; required once a node needs one
 * @param now - the timestamp of the writes (default: the current time)
 * @throws {MigrationFailedError} when any node fails, after rolling the transaction back
 */
export function applyMigration029(db: Migration029Database, corpusPath: string, actor?: string, now: string = new Date().toISOString()): void {
  let current = "begin transaction";
  try {
    db.exec("BEGIN IMMEDIATE;");
    const hasDeletedAt = (db.query(DOCS_TABLE_INFO_SQL).all() as { name: string }[]).some((column) => column.name === "deleted_at");
    const landed = collectLandedChanges(db.query(specExtrasSqlFor(hasDeletedAt)).all() as { slug: string; extra: string }[]);
    const nodes = db.query(SELECT_BASELINE_NODES_SQL).all() as BaselineNodeRow[];
    for (const node of nodes) {
      current = `promote landed changes on baseline node ${node.slug}`;
      const plan = planLandedPromotion(node, landed);
      if (plan === undefined) continue;
      const by = requireMigrationActor(actor, node.slug);
      db.prepare(UPDATE_CONVERTED_NODE_SQL).run(...promotedNodeBindings(node, plan, now));
      db.prepare(INSERT_CONVERSION_VERSION_SQL).run(...promotedVersionBindings(node, plan, by, now));
      const head = db.query(SELECT_AUDIT_HEAD_SQL).get() as { entry_hash: string | null } | null;
      db.prepare(INSERT_AUDIT_SQL).run(...auditBindings(promotionAuditEntry(node, plan, by, now), head?.entry_hash ?? ""));
    }
    current = "set user_version 29";
    db.exec(MIGRATION_029_SQL);
    current = "commit";
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // reason: no open transaction to roll back (BEGIN itself failed, or COMMIT already closed it) — the
      // original failure below is the one to report.
    }
    throw new MigrationFailedError(29, current, corpusPath, error);
  }
}
