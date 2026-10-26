/**
 * Migration 039 — the one-time back-fill of landing facts (spec-lore-done-closes-a-commitless-task-through-an-audited-no D7; #422).
 *
 * Purpose: every stored landing gets `kind: "commits"`, every open branch claim gets `start_head` (+ `end_tip`), and a legacy
 *   claim whose start and tip cannot be recorded is released with an audit entry; then `PRAGMA user_version = 39`, all in ONE
 *   `BEGIN IMMEDIATE` transaction. The pure transform is `landing-backfill.ts`; after this migration the schemas require both.
 * Public surface: {@link applyMigration039}, {@link MIGRATION_039_SQL}, {@link planLandingBackfill}, {@link repoRootOfCorpus},
 *   {@link integrationBranchOf}, the statement constants and binding helpers the Turso runner shares.
 * Invariants:
 *   - Concurrency-safe: the task rows are read INSIDE the write lock, so a second opener that waited on the lock reads the
 *     first one's output and finds nothing left to change (idempotent), then only re-sets `user_version`.
 *   - Every changed task gets a real write: one `versions` row and one hash-chained audit row (`migrate-schema-039`) authored
 *     by the `lore migrate schema` caller; a released claim's audit `details` carry the reason and the remedy.
 *   - The repository is the one holding the corpus file (`git rev-parse --show-toplevel` from its directory); with none, no
 *     tip is recordable and each such claim is released with that reason, never defaulted.
 *
 * Side-effect class: schema version bump + data rewrite (once per store), read-only `git` subprocesses.
 */

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import type { AuditEntry } from "@lore/core";
import { computeFtsShadowValues } from "../store-shared.js";
import { MigrationFailedError } from "./migration-026.js";
import {
  auditBindings,
  INSERT_AUDIT_SQL,
  INSERT_CONVERSION_VERSION_SQL,
  requireMigrationActor,
  SELECT_AUDIT_HEAD_SQL,
  UPDATE_CONVERTED_NODE_SQL,
  type BaselineNodeRow,
} from "./migration-028.js";
import { backfillLandingFacts, type BackfillAudit, type BackfillChange, type BackfillResult } from "./landing-backfill.js";

/** Audit action of a back-filled task; in the `update` family of `VERSION_ACTION_AUDIT_FAMILY` (audit-service.ts). */
export const MIGRATION_039_AUDIT_ACTION = "migrate-schema-039";
export const MIGRATION_039_SUMMARY = "migrate-schema-039: landing kind and claim start_head back-filled";
export const MIGRATION_039_SESSION_ID = "migrate-schema";

/** Every task row (soft-deleted included: a hidden task still holds its claim and landing). */
export const SELECT_TASK_ROWS_SQL = "SELECT id, slug, title, content, status, extra, tags, version FROM docs WHERE type = 'task'";

export const MIGRATION_039_SQL = "PRAGMA user_version = 39;";

function parseObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    // reason: an unparseable extra holds no claim or landing to back-fill; the row is left byte-identical.
    return {};
  }
}

function gitOut(cwd: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000 }).trim();
  } catch {
    // reason: not a repository, or no such ref — reported by the caller as "nothing recordable".
    return undefined;
  }
}

/** The repository that holds the corpus file; the corpus directory itself when none does (git then fails every query). */
export function repoRootOfCorpus(corpusPath: string): string {
  const dir = dirname(corpusPath);
  const top = gitOut(dir, ["rev-parse", "--show-toplevel"]);
  return top !== undefined && top !== "" ? top : dir;
}

/** `main`, else `master`, else `main` (the merge-base then fails and each affected claim is released with that reason). */
export function integrationBranchOf(repoRoot: string): string {
  for (const name of ["main", "master"]) {
    if (gitOut(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]) !== undefined) return name;
  }
  return "main";
}

/** One task row to rewrite: its stored row, the new extra, and the audit entry of a released claim (if any). */
export interface TaskWrite {
  readonly row: BaselineNodeRow;
  readonly extra: Record<string, unknown>;
  readonly released?: BackfillAudit;
}

/** Plans the writes over the rows read inside the lock. Pure over the rows plus read-only git. */
export function planLandingBackfill(rows: readonly BaselineNodeRow[], corpusPath: string): { writes: TaskWrite[]; result: BackfillResult } {
  const repoRoot = repoRootOfCorpus(corpusPath);
  const result = backfillLandingFacts({
    tasks: rows.map((row) => ({ slug: row.slug, extra: parseObject(row.extra) })),
    repoRoot,
    integrationBranch: integrationBranchOf(repoRoot),
  });
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const audits = new Map(result.audits.map((audit) => [audit.slug, audit]));
  const writes: TaskWrite[] = [];
  for (const change of result.changes as BackfillChange[]) {
    const row = bySlug.get(change.slug);
    if (row === undefined) continue;
    const released = audits.get(change.slug);
    writes.push({ row, extra: change.extra, ...(released !== undefined ? { released } : {}) });
  }
  return { writes, result };
}

/** The values {@link UPDATE_CONVERTED_NODE_SQL} binds for a back-filled task. */
export function taskWriteBindings(write: TaskWrite, now: string): [string, string, string, string, string, string, number, string, string] {
  const { row } = write;
  const shadow = computeFtsShadowValues(row.title, row.content, row.tags);
  return [row.title, row.content, JSON.stringify(write.extra), shadow.fts_title, shadow.fts_content, shadow.fts_tags, Number(row.version) + 1, now, row.id];
}

/** The values {@link INSERT_CONVERSION_VERSION_SQL} binds for a back-filled task. */
export function taskVersionBindings(
  write: TaskWrite,
  actor: string,
  now: string,
): [string, number, string, string, string, string, string, string, string, string] {
  const { row } = write;
  return [row.id, Number(row.version) + 1, row.content, JSON.stringify(write.extra), row.status, row.title, now, actor, MIGRATION_039_SUMMARY, row.slug];
}

/** The audit entry of a back-filled task (hashed into the chain by the caller). */
export function taskAuditEntry(write: TaskWrite, actor: string, now: string): AuditEntry {
  const { row } = write;
  return {
    timestamp: now,
    actor,
    session_id: MIGRATION_039_SESSION_ID,
    action: MIGRATION_039_AUDIT_ACTION,
    doc_id: row.id,
    details: {
      summary: MIGRATION_039_SUMMARY,
      from_version: Number(row.version),
      to_version: Number(row.version) + 1,
      ...(write.released !== undefined ? { claim_released: true, reason: write.released.reason, remedy: write.released.remedy } : {}),
    },
  };
}

/** The part of `bun:sqlite`'s `Database` the SQLite runner needs. */
export interface Migration039Database {
  exec(sql: string): unknown;
  query(sql: string): { all(...args: string[]): unknown[]; get(...args: string[]): unknown };
  prepare(sql: string): { run(...args: (string | number | null)[]): unknown };
}

/**
 * Runs migration 039 atomically on a SQLite handle.
 *
 * @param db - an open handle at schema 38
 * @param corpusPath - the corpus file: names a failure and locates the repository
 * @param actor - the `lore migrate schema` caller, who authors every write; required once a task needs one
 * @param now - the timestamp of the writes (default: the current time)
 * @throws {MigrationFailedError} on any failed step, after rolling back (schema stays 38)
 */
export function applyMigration039(db: Migration039Database, corpusPath: string, actor?: string, now: string = new Date().toISOString()): void {
  let current = "begin transaction";
  try {
    db.exec("BEGIN IMMEDIATE;");
    current = "plan the landing back-fill";
    // reason: rows are read AFTER the write lock is held, so a concurrent opener's finished back-fill is seen, not redone.
    const rows = db.query(SELECT_TASK_ROWS_SQL).all() as BaselineNodeRow[];
    for (const write of planLandingBackfill(rows, corpusPath).writes) {
      current = `back-fill task ${write.row.slug}`;
      const by = requireMigrationActor(actor, write.row.slug);
      db.prepare(UPDATE_CONVERTED_NODE_SQL).run(...taskWriteBindings(write, now));
      db.prepare(INSERT_CONVERSION_VERSION_SQL).run(...taskVersionBindings(write, by, now));
      const head = db.query(SELECT_AUDIT_HEAD_SQL).get() as { entry_hash: string | null } | null;
      db.prepare(INSERT_AUDIT_SQL).run(...auditBindings(taskAuditEntry(write, by, now), head?.entry_hash ?? ""));
    }
    current = "set user_version 39";
    db.exec(MIGRATION_039_SQL);
    current = "commit";
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // reason: no open transaction to roll back (BEGIN itself failed, or COMMIT already closed it) — the
      // original failure below is the one to report.
    }
    throw new MigrationFailedError(39, current, corpusPath, error);
  }
}
