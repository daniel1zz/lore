/**
 * Migration 027 — baseline nodes become items (spec-baseline-approval-is-per-item-an-edit-adds-a-pending, BR-1341).
 *
 * Purpose: from schema 27 a baseline node's approval is held per item. `extra.rules` / `label` / `glossary` /
 *   `depends_on` / `commands` and the doc's title and body hold the APPROVED versions; `extra.pending` holds the
 *   pending revisions. This migration converts every baseline node once, with no compatibility layer:
 *     - an approved node is already all-approved: untouched;
 *     - a node that is not approved but was approved once takes each item's approved version from its LAST approved
 *       version (the `versions` row), and each difference from the current content becomes a pending revision;
 *     - a node never approved has every item pending (no approved rule, no approved node part).
 *   A rule that becomes a pending add is set `proposed` in `rule_registry` (its id is reserved, no leaf lists it).
 *
 * Public surface: {@link planBaselineItemConversion}, {@link MIGRATION_027_SQL}, {@link applyMigration027},
 *   {@link BaselineNodeRow}, {@link ApprovedVersionRow}, {@link BaselineConversion}.
 * Invariants:
 *   - The planner is pure; the SQLite runner here and the Turso runner in `turso-store.ts` share it and the SQL
 *     constants, so the two stores cannot convert differently.
 *   - ATOMIC: node updates, registry updates and `PRAGMA user_version = 27` run in ONE transaction; any failure
 *     (including a baseline node whose `extra` is not a JSON object) rolls back and throws
 *     {@link MigrationFailedError} naming the node; the corpus stays at schema 26. Nothing is skipped silently.
 *   - IN PLACE: the docs row is rewritten without a version bump or a new `versions` row. The audit chain has a row
 *     for every version and a migration has no actor to write one for; the `migrate_schema` audit row is the record.
 *   - Re-runnable: a node that already carries `extra.pending` is skipped, an approved node is never touched, so a
 *     second run (or a run on a converted corpus) writes nothing.
 *   - Revision ids are deterministic (`m027-<doc id>-<item>`), so two runs agree.
 *   - The title and body of a never-approved node cannot be absent, so they stay as stored; its pending node
 *     revision carries only the label / glossary / depends_on / commands it had.
 *   - `docs_idx_baseline_au` (migration-014/018) re-syncs `rule_depends` and the registry's version/lifecycle from the
 *     new `extra` (approved versions only); {@link PROPOSE_RULE_SQL} then marks the pending adds `proposed`.
 *
 * Side-effect class: schema/data migration (executed once per store).
 */

import { computeFtsShadowValues } from "../store-shared.js";
import { MigrationFailedError, type SqlExecutor } from "./migration-026.js";

/** The node-part fields of `extra` that are items of the node's own part (title and body live in columns). */
const NODE_PART_FIELDS = ["label", "glossary", "depends_on", "commands"] as const;

/** A `docs` row of type `baseline`, as the migration reads it. */
export interface BaselineNodeRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly content: string;
  readonly status: string;
  readonly extra: string;
  readonly tags: string;
}

/** The last `versions` row of a node whose status was `approved`. */
export interface ApprovedVersionRow {
  readonly title: string;
  readonly content: string;
  readonly extra: string;
}

/** What to write back for one converted node. */
export interface BaselineConversion {
  readonly title: string;
  readonly content: string;
  readonly extra: Record<string, unknown>;
  /** Ids of the rules that became pending adds: the registry marks them `proposed`. */
  readonly proposedRuleIds: readonly string[];
}

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

function parseExtra(text: string, where: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`${where}: extra is not valid JSON (${cause instanceof Error ? cause.message : String(cause)})`);
  }
  if (!isRecord(parsed)) throw new Error(`${where}: extra is not a JSON object`);
  return parsed;
}

function ruleRecords(extra: Record<string, unknown>): Record<string, unknown>[] {
  const raw = extra["rules"];
  return Array.isArray(raw) ? raw.filter((r): r is Record<string, unknown> => isRecord(r) && typeof r["id"] === "string") : [];
}

/**
 * Plans the conversion of one baseline node, or `undefined` when it needs none (approved, already converted, or
 * not different from its last approved version).
 *
 * @param node - the node's current row
 * @param lastApproved - its last approved version, `undefined` when it was never approved
 * @throws {Error} when the node's `extra` (or its approved version's) is not a JSON object — the caller reports it
 */
export function planBaselineItemConversion(node: BaselineNodeRow, lastApproved: ApprovedVersionRow | undefined): BaselineConversion | undefined {
  if (node.status === "approved") return undefined;
  const current = parseExtra(node.extra, `baseline node ${node.slug}`);
  if (current["pending"] !== undefined) return undefined;
  const approved = lastApproved === undefined ? undefined : parseExtra(lastApproved.extra, `baseline node ${node.slug} (last approved version)`);

  const pendingRules: Record<string, { revision_id: string; rule: Record<string, unknown> }> = {};
  const proposedRuleIds: string[] = [];
  const approvedRules: Record<string, unknown>[] = [];
  const currentRules = ruleRecords(current);
  const approvedById = new Map(ruleRecords(approved ?? {}).map((rule) => [rule["id"] as string, rule]));
  for (const rule of currentRules) {
    const id = rule["id"] as string;
    const before = approvedById.get(id);
    if (before === undefined) {
      pendingRules[id] = { revision_id: `m027-${node.id}-${id}`, rule };
      proposedRuleIds.push(id);
    } else if (canonical(before) === canonical(rule)) {
      approvedRules.push(rule);
    } else {
      approvedRules.push(before);
      pendingRules[id] = { revision_id: `m027-${node.id}-${id}`, rule };
    }
  }

  const extra: Record<string, unknown> = { ...current };
  delete extra["rules"];
  if (approvedRules.length > 0) extra["rules"] = approvedRules;

  const pendingNode: Record<string, unknown> = {};
  let title = node.title;
  let content = node.content;
  for (const field of NODE_PART_FIELDS) {
    const now = current[field];
    const before = approved?.[field];
    if (approved === undefined) {
      if (now !== undefined) pendingNode[field] = now;
      delete extra[field];
    } else if (canonical(now) !== canonical(before)) {
      pendingNode[field] = now ?? null;
      if (before === undefined) delete extra[field];
      else extra[field] = before;
    }
  }
  if (lastApproved !== undefined) {
    if (lastApproved.title !== node.title) {
      pendingNode["title"] = node.title;
      title = lastApproved.title;
    }
    if (lastApproved.content !== node.content) {
      pendingNode["content"] = node.content;
      content = lastApproved.content;
    }
  }

  const hasNodePending = approved === undefined || Object.keys(pendingNode).length > 0;
  if (Object.keys(pendingRules).length === 0 && !hasNodePending) return undefined;
  const pending: Record<string, unknown> = {};
  if (Object.keys(pendingRules).length > 0) pending["rules"] = pendingRules;
  if (hasNodePending) pending["node"] = { revision_id: `m027-${node.id}-node`, ...pendingNode };
  extra["pending"] = pending;
  return { title, content, extra, proposedRuleIds };
}

/** Every baseline node, for the conversion pass. */
export const SELECT_BASELINE_NODES_SQL = "SELECT id, slug, title, content, status, extra, tags FROM docs WHERE type = 'baseline'";
/** A node's last approved version (`?` = doc id). */
export const SELECT_LAST_APPROVED_SQL = "SELECT title, content, extra FROM versions WHERE doc_id = ? AND status = 'approved' ORDER BY version DESC LIMIT 1";
/** Writes a converted node back (`?` = title, content, extra, fts_title, fts_content, fts_tags, id). */
export const UPDATE_CONVERTED_NODE_SQL = "UPDATE docs SET title = ?, content = ?, extra = ?, fts_title = ?, fts_content = ?, fts_tags = ? WHERE id = ?";
/** Marks a pending add `proposed` (`?` = rule id, owning leaf doc id). */
export const PROPOSE_RULE_SQL = "UPDATE rule_registry SET lifecycle = 'proposed' WHERE id = ? AND leaf_doc_id = ?";

/** The same row values {@link UPDATE_CONVERTED_NODE_SQL} binds, computed once for both stores. */
export function convertedNodeBindings(node: BaselineNodeRow, conversion: BaselineConversion): [string, string, string, string, string, string, string] {
  const shadow = computeFtsShadowValues(conversion.title, conversion.content, node.tags);
  return [conversion.title, conversion.content, JSON.stringify(conversion.extra), shadow.fts_title, shadow.fts_content, shadow.fts_tags, node.id];
}

/** The version bump, inside the conversion transaction. */
export const MIGRATION_027_SQL = "PRAGMA user_version = 27;";

/** The part of `bun:sqlite`'s `Database` the SQLite runner needs. */
export interface Migration027Database extends SqlExecutor {
  query(sql: string): { all(...args: string[]): unknown[]; get(...args: string[]): unknown };
  prepare(sql: string): { run(...args: string[]): unknown };
}

/**
 * Runs migration 027 atomically on a SQLite handle.
 *
 * @param db - an open handle at schema 26
 * @param corpusPath - the corpus file, named in a failure
 * @throws {MigrationFailedError} when any node fails to convert, after rolling the transaction back
 */
export function applyMigration027(db: Migration027Database, corpusPath: string): void {
  let current = "begin transaction";
  try {
    db.exec("BEGIN IMMEDIATE;");
    const nodes = db.query(SELECT_BASELINE_NODES_SQL).all() as BaselineNodeRow[];
    for (const node of nodes) {
      current = `convert baseline node ${node.slug}`;
      const lastApproved = db.query(SELECT_LAST_APPROVED_SQL).get(node.id) as ApprovedVersionRow | null;
      const conversion = planBaselineItemConversion(node, lastApproved ?? undefined);
      if (conversion === undefined) continue;
      db.prepare(UPDATE_CONVERTED_NODE_SQL).run(...convertedNodeBindings(node, conversion));
      for (const ruleId of conversion.proposedRuleIds) db.prepare(PROPOSE_RULE_SQL).run(ruleId, node.id);
    }
    current = "set user_version 27";
    db.exec(MIGRATION_027_SQL);
    current = "commit";
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // reason: no open transaction to roll back (BEGIN itself failed, or COMMIT already closed it) — the
      // original failure below is the one to report.
    }
    throw new MigrationFailedError(27, current, corpusPath, error);
  }
}
