/**
 * store-shared.ts — SSOT helpers shared by SQLiteStore and TursoStore.
 *
 * Contains:
 *  - Raw DB row interfaces (DocRow, LinkRow, VersionRow, AuditRow, FtsRow)
 *  - Row → domain record mappers (rowToDocRecord, etc.)
 *  - parseJson, wrapStoreError utilities
 *
 * Design contract:
 *  - Both stores share these types/functions — no duplication
 *  - Row types represent the raw column layout from the database
 *  - Mappers are pure functions with no side effects
 *
 * Source: SPEC-002 §7.1; SPEC-009 §3.1
 */

import type {
  AuditEntry,
  CalibrationRecord,
  CheckResult,
  DocRecord,
  DocType,
  LinkRecord,
  LinkType,
  ReviewJudgment,
  ReviewReason,
  VersionRecord,
} from "@lore/core";
import { err, type LoreError, type Result } from "@lore/core";

// ─── Raw DB row types ──────────────────────────────────────────────────────

/**
 * Raw row from the `docs` table.
 * Shared between SQLiteStore (bun:sqlite) and TursoStore (@libsql/client).
 * Numeric fields (version) may be bigint from libsql — callers MUST use Number().
 */
export interface DocRow {
  id: string;
  slug: string;
  type: string;
  role: string;
  title: string;
  status: string;
  priority: string;
  content: string;
  parent_id: string | null;
  extra: string;
  tags: string;
  version: number | bigint;
  created_at: string;
  updated_at: string;
  created_by: string;
  deleted_at: string | null;
}

export interface LinkRow {
  from_id: string;
  to_id: string;
  link_type: string;
  created_at: string;
  created_by: string;
}

export interface VersionRow {
  doc_id: string;
  version: number | bigint;
  content: string;
  extra: string;
  status: string;
  title: string;
  action: string;
  created_at: string;
  created_by: string;
  change_summary: string | null;
}

export interface AuditRow {
  timestamp: string;
  actor: string;
  session_id: string;
  action: string;
  doc_id: string | null;
  details: string;
}

export interface FtsRow {
  id: string;
  slug: string;
  title: string;
  snippet: string;
  rank: number | bigint;
}

/**
 * Raw row from the `review_judgments` table (migration-003.ts, SPEC-034 §3).
 * `judge_provider`/`judge_model`/`judge_prompt_version` are denormalized
 * columns mirroring `ReviewJudgment.judge` — no separate judges table.
 */
export interface JudgmentRow {
  id: string;
  doc_id: string;
  doc_version: number | bigint;
  decision: string;
  confidence: number;
  reasons: string;
  checks: string;
  blocking_questions: string;
  judge_provider: string;
  judge_model: string;
  judge_prompt_version: string;
  created_at: string;
  created_by: string;
}

/** Raw row from the `calibration_records` table (migration-003.ts, SPEC-034 §3). */
export interface CalibrationRow {
  id: string;
  judgment_id: string;
  doc_id: string;
  doc_type: string;
  human_outcome: string;
  delta_reasons: string;
  actor: string;
  created_at: string;
}

// ─── JSON helpers ──────────────────────────────────────────────────────────

export function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─── Row mappers ───────────────────────────────────────────────────────────

export function rowToDocRecord(row: DocRow): DocRecord {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type as DocRecord["type"],
    role: row.role as DocRecord["role"],
    title: row.title,
    status: row.status as DocRecord["status"],
    priority: row.priority as DocRecord["priority"],
    content: row.content,
    parent_id: row.parent_id,
    extra: parseJson(row.extra, {}),
    tags: parseJson(row.tags, []),
    version: Number(row.version),
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    deleted_at: row.deleted_at,
  };
}

export function rowToLinkRecord(row: LinkRow): LinkRecord {
  return {
    from_id: row.from_id,
    to_id: row.to_id,
    link_type: row.link_type as LinkType,
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

export function rowToVersionRecord(row: VersionRow): VersionRecord {
  return {
    doc_id: row.doc_id,
    version: Number(row.version),
    content: row.content,
    extra: parseJson(row.extra, {}),
    status: row.status as VersionRecord["status"],
    title: row.title,
    action: row.action as VersionRecord["action"],
    created_at: row.created_at,
    created_by: row.created_by,
    ...(row.change_summary !== null
      ? { change_summary: row.change_summary }
      : {}),
  };
}

export function rowToAuditEntry(row: AuditRow): AuditEntry {
  return {
    timestamp: row.timestamp,
    actor: row.actor,
    session_id: row.session_id,
    action: row.action,
    ...(row.doc_id !== null ? { doc_id: row.doc_id } : {}),
    details: parseJson(row.details, {}),
  };
}

/** Maps a raw `review_judgments` row to a ReviewJudgment. Reassembles `judge` from its 3 denormalized columns. */
export function rowToReviewJudgment(row: JudgmentRow): ReviewJudgment {
  return {
    id: row.id,
    doc_id: row.doc_id,
    doc_version: Number(row.doc_version),
    decision: row.decision as ReviewJudgment["decision"],
    confidence: row.confidence,
    reasons: parseJson<ReviewReason[]>(row.reasons, []),
    checks: parseJson<CheckResult[]>(row.checks, []),
    blocking_questions: parseJson<string[]>(row.blocking_questions, []),
    judge: {
      provider: row.judge_provider,
      model: row.judge_model,
      prompt_version: row.judge_prompt_version,
    },
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

/** Maps a raw `calibration_records` row to a CalibrationRecord. */
export function rowToCalibrationRecord(row: CalibrationRow): CalibrationRecord {
  return {
    id: row.id,
    judgment_id: row.judgment_id,
    doc_id: row.doc_id,
    doc_type: row.doc_type as DocType,
    human_outcome: row.human_outcome as CalibrationRecord["human_outcome"],
    delta_reasons: parseJson<string[]>(row.delta_reasons, []),
    actor: row.actor,
    created_at: row.created_at,
  };
}

// ─── Error helpers ──────────────────────────────────────────────────────────

export function wrapStoreError(e: unknown): Result<never, LoreError> {
  const message =
    e instanceof Error ? e.message : "Unknown store error";
  if (e instanceof Error) {
    return err({ code: "STORE_ERROR", message, cause: e });
  }
  return err({ code: "STORE_ERROR", message });
}

// ─── FTS5 query escape ─────────────────────────────────────────────────────

/**
 * Escape an arbitrary user search string into a FTS5-safe MATCH expression.
 *
 * Algorithm:
 *   1. Trim input. If empty, return "".
 *   2. Split on whitespace (one or more) into pieces.
 *   3. For each piece, replace internal `"` with `""` (FTS5 phrase escape) and
 *      wrap in `"…"`.
 *   4. Join pieces with single spaces.
 *
 * Semantics: the resulting expression is an AND of phrase queries (FTS5 default
 * boolean operator between bare phrases is AND). Each phrase is FTS5-tokenized
 * internally — so `"append-only"` matches docs containing the consecutive
 * sequence "append" then "only", which is what users with a hyphenated term in
 * mind almost always want.
 *
 * Returns "" only when input was empty or whitespace-only. Callers MUST treat
 * empty input as a no-results query and short-circuit BEFORE passing to FTS5
 * MATCH — FTS5 errors on an empty MATCH expression.
 *
 * Note: InMemoryStore uses substring-based search and does NOT use this
 * function — its semantics intentionally diverge from FTS5 and are out of scope
 * for this escape mechanism.
 *
 * @example
 *   escapeFtsQuery("")                    === ""
 *   escapeFtsQuery("   ")                 === ""
 *   escapeFtsQuery("service")             === '"service"'
 *   escapeFtsQuery("service layer")       === '"service" "layer"'
 *   escapeFtsQuery("append-only version") === '"append-only" "version"'
 *   escapeFtsQuery('he said "hi"')        === '"he" "said" """hi"""'
 *   escapeFtsQuery("foo*")                === '"foo*"'
 *   escapeFtsQuery("(append)")            === '"(append)"'
 *
 * Source: SPEC-013 §3.5 FTS5-special-token resilience
 */
export function escapeFtsQuery(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  // reason: FTS5 phrase quoting: wrap each whitespace-delimited piece in double
  // quotes, and escape any embedded double-quote by doubling it (""). This
  // neutralises all FTS5 operators (hyphen, parens, colon, star, OR, AND, NOT)
  // because the tokenizer processes the string inside the phrase, not the FTS5
  // query parser. See SQLite FTS5 docs §3.1 (phrase queries).
  const pieces = trimmed.split(/\s+/);
  const escaped = pieces.map((piece) => {
    const inner = piece.replaceAll('"', '""');
    return `"${inner}"`;
  });
  return escaped.join(" ");
}
