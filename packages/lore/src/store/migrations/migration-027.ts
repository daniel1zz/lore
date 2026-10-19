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
 *   - A REAL WRITE: every converted node gets version N+1 (a `versions` row, action `update`, written by the migrate
 *     run's actor) and ONE hash-chained audit row (`migrate-schema-027`, in the family of `update`), in the same
 *     transaction, so `AuditService.verify` (which checks every version) and history stay truthful. A node that needs
 *     no change gets neither. The actor is the `lore migrate schema` caller's, passed as `migrationActor`; a
 *     conversion with no actor fails loudly (nothing is attributed to a guessed identity).
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

import type { AuditEntry } from "@lore/core";
import { computeAuditEntryHash, computeFtsShadowValues } from "../store-shared.js";
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
  readonly version: number;
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
export const SELECT_BASELINE_NODES_SQL = "SELECT id, slug, title, content, status, extra, tags, version FROM docs WHERE type = 'baseline'";
/** A node's last approved version (`?` = doc id). */
export const SELECT_LAST_APPROVED_SQL = "SELECT title, content, extra FROM versions WHERE doc_id = ? AND status = 'approved' ORDER BY version DESC LIMIT 1";
/** Writes a converted node back as its next version (`?` = title, content, extra, fts_title, fts_content, fts_tags, version, updated_at, id). */
export const UPDATE_CONVERTED_NODE_SQL =
  "UPDATE docs SET title = ?, content = ?, extra = ?, fts_title = ?, fts_content = ?, fts_tags = ?, version = ?, updated_at = ? WHERE id = ?";
/** The converted node's `versions` row (`?` = doc_id, version, content, extra, status, title, created_at, created_by, change_summary, slug). */
export const INSERT_CONVERSION_VERSION_SQL =
  "INSERT INTO versions (doc_id, version, content, extra, status, title, action, created_at, created_by, change_summary, slug) VALUES (?, ?, ?, ?, ?, ?, 'update', ?, ?, ?, ?)";
/** The audit chain head (`entry_hash` of the newest row, none on an empty chain). */
export const SELECT_AUDIT_HEAD_SQL = "SELECT entry_hash FROM audit ORDER BY id DESC LIMIT 1";
/** One audit row (`?` = timestamp, actor, session_id, action, doc_id, details, prev_hash, entry_hash). */
export const INSERT_AUDIT_SQL =
  "INSERT INTO audit (timestamp, actor, session_id, action, doc_id, details, prev_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
/** Marks a pending add `proposed` (`?` = rule id, owning leaf doc id). */
export const PROPOSE_RULE_SQL = "UPDATE rule_registry SET lifecycle = 'proposed' WHERE id = ? AND leaf_doc_id = ?";

/** Audit action of a converted node; in the `update` family of `VERSION_ACTION_AUDIT_FAMILY` (audit-service.ts). */
export const MIGRATION_027_AUDIT_ACTION = "migrate-schema-027";
/** The version's change summary and the audit row's `details.summary`. */
export const MIGRATION_027_SUMMARY = "migrate-schema-027: split into approved + pending items";
/** The audit row's `session_id`: a corpus-level migration belongs to no doc session. */
export const MIGRATION_027_SESSION_ID = "migrate-schema";

/**
 * The actor of the conversion writes.
 *
 * @throws {Error} when the opener passed none: a converted node must be attributed to the real `lore migrate schema` caller
 */
export function requireMigrationActor(actor: string | undefined, slug: string): string {
  if (actor === undefined || actor === "") {
    throw new Error(`baseline node ${slug} needs conversion but no migration actor was supplied (open the store through \`lore migrate schema\`)`);
  }
  return actor;
}

/** The values {@link UPDATE_CONVERTED_NODE_SQL} binds, computed once for both stores. */
export function convertedNodeBindings(
  node: BaselineNodeRow,
  conversion: BaselineConversion,
  now: string,
): [string, string, string, string, string, string, number, string, string] {
  const shadow = computeFtsShadowValues(conversion.title, conversion.content, node.tags);
  return [
    conversion.title,
    conversion.content,
    JSON.stringify(conversion.extra),
    shadow.fts_title,
    shadow.fts_content,
    shadow.fts_tags,
    Number(node.version) + 1,
    now,
    node.id,
  ];
}

/** The values {@link INSERT_CONVERSION_VERSION_SQL} binds. */
export function conversionVersionBindings(
  node: BaselineNodeRow,
  conversion: BaselineConversion,
  actor: string,
  now: string,
): [string, number, string, string, string, string, string, string, string, string] {
  return [
    node.id,
    Number(node.version) + 1,
    conversion.content,
    JSON.stringify(conversion.extra),
    node.status,
    conversion.title,
    now,
    actor,
    MIGRATION_027_SUMMARY,
    node.slug,
  ];
}

/** The audit entry of one converted node (hashed into the chain by the caller). */
export function conversionAuditEntry(node: BaselineNodeRow, conversion: BaselineConversion, actor: string, now: string): AuditEntry {
  return {
    timestamp: now,
    actor,
    session_id: MIGRATION_027_SESSION_ID,
    action: MIGRATION_027_AUDIT_ACTION,
    doc_id: node.id,
    details: {
      summary: MIGRATION_027_SUMMARY,
      from_version: Number(node.version),
      to_version: Number(node.version) + 1,
      pending_rules: Object.keys((conversion.extra["pending"] as { rules?: Record<string, unknown> }).rules ?? {}),
    },
  };
}

/** The values {@link INSERT_AUDIT_SQL} binds for `entry` chained after `prevHash`. */
export function auditBindings(entry: AuditEntry, prevHash: string): [string, string, string, string, string | null, string, string, string] {
  return [
    entry.timestamp,
    entry.actor,
    entry.session_id,
    entry.action,
    entry.doc_id ?? null,
    JSON.stringify(entry.details ?? {}),
    prevHash,
    computeAuditEntryHash(entry, prevHash),
  ];
}

/** The version bump, inside the conversion transaction. */
export const MIGRATION_027_SQL = "PRAGMA user_version = 27;";

/** The part of `bun:sqlite`'s `Database` the SQLite runner needs. */
export interface Migration027Database extends SqlExecutor {
  query(sql: string): { all(...args: string[]): unknown[]; get(...args: string[]): unknown };
  prepare(sql: string): { run(...args: (string | number | null)[]): unknown };
}

/**
 * Runs migration 027 atomically on a SQLite handle.
 *
 * @param db - an open handle at schema 26
 * @param corpusPath - the corpus file, named in a failure
 * @param actor - the `lore migrate schema` caller, who authors every conversion write; required once a node needs one
 * @param now - the timestamp of the conversion writes (default: the current time)
 * @throws {MigrationFailedError} when any node fails to convert, after rolling the transaction back
 */
export function applyMigration027(db: Migration027Database, corpusPath: string, actor?: string, now: string = new Date().toISOString()): void {
  let current = "begin transaction";
  try {
    db.exec("BEGIN IMMEDIATE;");
    const nodes = db.query(SELECT_BASELINE_NODES_SQL).all() as BaselineNodeRow[];
    for (const node of nodes) {
      current = `convert baseline node ${node.slug}`;
      const lastApproved = db.query(SELECT_LAST_APPROVED_SQL).get(node.id) as ApprovedVersionRow | null;
      const conversion = planBaselineItemConversion(node, lastApproved ?? undefined);
      if (conversion === undefined) continue;
      const by = requireMigrationActor(actor, node.slug);
      db.prepare(UPDATE_CONVERTED_NODE_SQL).run(...convertedNodeBindings(node, conversion, now));
      db.prepare(INSERT_CONVERSION_VERSION_SQL).run(...conversionVersionBindings(node, conversion, by, now));
      const head = db.query(SELECT_AUDIT_HEAD_SQL).get() as { entry_hash: string | null } | null;
      db.prepare(INSERT_AUDIT_SQL).run(...auditBindings(conversionAuditEntry(node, conversion, by, now), head?.entry_hash ?? ""));
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
