/**
 * Migration 040 — classify released pre-#356 claims that can never be measured as `unrecoverable` (#473;
 * spec-claims-released-before-tips-were-recorded-are-classified, D1-D5).
 *
 * Purpose: a branch claim released before #356 recorded branch tips holds neither `start_head` nor `end_tip`, so landing
 *   (`measureLanding`) can never measure it and refuses the whole task `unmeasurable` for good. This migration writes ONE
 *   `claim-unrecoverable` audit entry per such claim (a claim row itself is a hash-chained audit entry and is never
 *   edited); landing reads those entries, lists the claims, and judges only the others. Then `PRAGMA user_version = 40`,
 *   all in ONE `BEGIN IMMEDIATE` transaction.
 * Public surface: {@link applyMigration040}, {@link planUnrecoverableClaims}, {@link MIGRATION_040_SQL}, the statement constants and binding helpers the Turso runner shares.
 * Invariants:
 *   - Reads NO git and no clock: the selection is over recorded facts only, so it behaves identically on a SQLite store and
 *     on a Turso replica with no checkout. It has no refusal path other than a failed write (rolled back, schema stays 39).
 *   - Idempotent: the rows are read INSIDE the write lock and a claim already carrying a marker is skipped, so a second run
 *     (or a second opener that waited on the lock) writes nothing.
 *   - A no-branch claim, a claim with a `start_head`, and a claim whose release recorded an `end_tip` are never selected.
 *
 * Side-effect class: schema version bump + audit appends (once per store); no git, no document rewrite.
 */

import { UNRECOVERABLE_CLAIM_ACTION, UNRECOVERABLE_CLAIM_REASON, type AuditEntry } from "@lore/core";
import { MigrationFailedError } from "./migration-026.js";
import { auditBindings, INSERT_AUDIT_SQL, requireMigrationActor, SELECT_AUDIT_HEAD_SQL } from "./migration-028.js";

export const MIGRATION_040_MARKED_BY = "migration-040";
export const MIGRATION_040_SESSION_ID = "migrate-schema";
export const MIGRATION_040_SQL = "PRAGMA user_version = 40;";

/** Every task row's id and slug, and the stored `extra` (soft-deleted included: a hidden task still holds its claims). */
export const SELECT_TASK_CLAIM_HOLDERS_SQL = "SELECT id, slug, extra FROM docs WHERE type = 'task'";
/** The claim, release and marker audit rows, oldest first. */
export const SELECT_CLAIM_AUDIT_ROWS_SQL =
  `SELECT id, timestamp, action, doc_id, details FROM audit WHERE action IN ('claim', 'release', '${UNRECOVERABLE_CLAIM_ACTION}') AND doc_id IS NOT NULL ORDER BY id`;

/** One task row as the planner needs it. */
export interface TaskHolderRow {
  readonly id: string;
  readonly slug: string;
  readonly extra: string;
}

/** One audit row as the planner needs it (`details` is the stored JSON text). */
export interface ClaimAuditRow {
  readonly id: number;
  readonly timestamp: string;
  readonly action: string;
  readonly doc_id: string;
  readonly details: string;
}

/** One claim reconstructed from its audit row and the release rows of its period. */
interface HistoricClaim {
  readonly at: string;
  readonly branch: string | undefined;
  readonly start_head: string | undefined;
  readonly end_tip: string | undefined;
  readonly released: boolean;
}

/** One marker to write: the task and the claim it classifies. */
export interface UnrecoverableClaimMark {
  readonly docId: string;
  readonly slug: string;
  readonly claimAt: string;
  readonly branch: string;
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    // reason: an unparseable details/extra holds no recorded fact; the row selects nothing and is left untouched.
    return {};
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** `claim.released`: a later claim exists, or the task holds no open claim record after the last one. */
function isReleased(claim: HistoricClaim): boolean {
  return claim.released;
}

/**
 * Plans the markers over rows read inside the write lock. Pure: no git, no clock.
 *
 * A task's claim rows, oldest first, are its claims; every claim but the last is released by the next claim, and the last is
 * released when the task holds no `extra.claim`. A claim's `end_tip` is the newest one a `release` row recorded from the
 * claim's row up to the next claim's row. The branch is the row's `branch`, else its `worktree` when that is a branch name.
 *
 * @returns the claims to mark, in audit order; those already marked are omitted.
 */
export function planUnrecoverableClaims(tasks: readonly TaskHolderRow[], auditRows: readonly ClaimAuditRow[]): UnrecoverableClaimMark[] {
  const marks: UnrecoverableClaimMark[] = [];
  for (const task of tasks) {
    const rows = auditRows.filter((row) => row.doc_id === task.id);
    const claimRows = rows.filter((row) => row.action === "claim");
    const alreadyMarked = new Set(
      rows
        .filter((row) => row.action === UNRECOVERABLE_CLAIM_ACTION)
        .map((row) => {
          const details = parseObject(row.details);
          return `${String(details["claim_at"])}\u0000${String(details["branch"])}`;
        }),
    );
    const holdsOpenClaim = parseObject(task.extra)["claim"] !== undefined;
    claimRows.forEach((claimRow, index) => {
      const next = claimRows[index + 1];
      const details = parseObject(claimRow.details);
      const worktree = nonEmptyString(details["worktree"]);
      const branch = nonEmptyString(details["branch"]) ?? (worktree !== undefined && !worktree.startsWith("/") ? worktree : undefined);
      const periodReleases = rows.filter((row) => row.action === "release" && row.id > claimRow.id && (next === undefined || row.id < next.id));
      const endTip = periodReleases
        .map((row) => nonEmptyString(parseObject(row.details)["end_tip"]))
        .filter((tip): tip is string => tip !== undefined)
        .pop();
      const claim: HistoricClaim = {
        at: claimRow.timestamp,
        branch,
        start_head: nonEmptyString(details["start_head"]),
        end_tip: endTip ?? nonEmptyString(details["end_tip"]),
        released: next !== undefined || !holdsOpenClaim,
      };
      // reason: the selection of spec D3, recorded facts only: a claim with a start is measurable by the current schema, a
      // claim whose release recorded a tip is measurable, a no-branch claim needs no start, an open claim is not history.
      if (claim.start_head === undefined && claim.end_tip === undefined && claim.branch !== undefined && isReleased(claim)) {
        if (alreadyMarked.has(`${claim.at}\u0000${claim.branch}`)) return;
        marks.push({ docId: task.id, slug: task.slug, claimAt: claim.at, branch: claim.branch });
      }
    });
  }
  return marks;
}

/** The audit entry of one marker (hashed into the chain by the caller). */
export function unrecoverableClaimAuditEntry(mark: UnrecoverableClaimMark, actor: string, now: string): AuditEntry {
  return {
    timestamp: now,
    actor,
    session_id: MIGRATION_040_SESSION_ID,
    action: UNRECOVERABLE_CLAIM_ACTION,
    doc_id: mark.docId,
    details: {
      summary: `${UNRECOVERABLE_CLAIM_ACTION}: claim on ${mark.branch} classified unrecoverable`,
      claim_at: mark.claimAt,
      branch: mark.branch,
      reason: UNRECOVERABLE_CLAIM_REASON,
      marked_by: MIGRATION_040_MARKED_BY,
    },
  };
}

/** The part of `bun:sqlite`'s `Database` the SQLite runner needs. */
export interface Migration040Database {
  exec(sql: string): unknown;
  query(sql: string): { all(...args: string[]): unknown[]; get(...args: string[]): unknown };
  prepare(sql: string): { run(...args: (string | number | null)[]): unknown };
}

/**
 * Runs migration 040 atomically on a SQLite handle.
 *
 * @param db - an open handle at schema 39
 * @param corpusPath - the corpus file (names a failure)
 * @param actor - the `lore migrate schema` caller, who authors every marker; required once a claim needs one
 * @param now - the timestamp of the writes (default: the current time)
 * @throws {MigrationFailedError} on any failed step, after rolling back (schema stays 39)
 */
export function applyMigration040(db: Migration040Database, corpusPath: string, actor?: string, now: string = new Date().toISOString()): void {
  let current = "begin transaction";
  try {
    db.exec("BEGIN IMMEDIATE;");
    current = "plan the unrecoverable-claim markers";
    // reason: rows are read AFTER the write lock is held, so a concurrent opener's finished markers are seen, not redone.
    const tasks = db.query(SELECT_TASK_CLAIM_HOLDERS_SQL).all() as TaskHolderRow[];
    const rows = db.query(SELECT_CLAIM_AUDIT_ROWS_SQL).all() as ClaimAuditRow[];
    for (const mark of planUnrecoverableClaims(tasks, rows)) {
      current = `mark the claim of ${mark.slug} on ${mark.branch}`;
      const by = requireMigrationActor(actor, mark.slug);
      const head = db.query(SELECT_AUDIT_HEAD_SQL).get() as { entry_hash: string | null } | null;
      db.prepare(INSERT_AUDIT_SQL).run(...auditBindings(unrecoverableClaimAuditEntry(mark, by, now), head?.entry_hash ?? ""));
    }
    current = "set user_version 40";
    db.exec(MIGRATION_040_SQL);
    current = "commit";
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // reason: no open transaction to roll back (BEGIN itself failed, or COMMIT already closed it) — the
      // original failure below is the one to report.
    }
    throw new MigrationFailedError(40, current, corpusPath, error);
  }
}
