/**
 * Migration 038 — a plan's known defects become its own record; the `known-defect` link type is retired
 * (BR-1421, spec-a-plan-s-known-defects-are-its-own-record-of-github-issues D1, D5).
 *
 * Purpose: every plan -> task `known-defect` link becomes entries of the plan's `extra.known_defects`
 *   (`{repo_id, number, dimension, fingerprint}`), then the links are deleted and `known-defect` leaves the
 *   `links.link_type` CHECK, all in ONE transaction together with `PRAGMA user_version = 38`.
 * Public surface: {@link planKnownDefectConversion}, {@link checkKnownDefectConversion}, {@link applyMigration038},
 *   {@link summarizeConversion}, {@link describeUnconvertible}, {@link MIGRATION_038_SQL} and the SQL constants the
 *   Turso runner shares, plus the row/plan types.
 * Invariants:
 *   - The issue ref comes from the target's report ref: `extra.issue_report.github` `{repo_id, number}`, else the
 *     first `extra.issues` entry. A target with neither is unconvertible.
 *   - Dimension and fingerprint come, in order, from the target's `extra.milestone_findings` (one entry per element),
 *     else from the `Dimension:` and `Root-cause fingerprint:` lines the filer wrote into the issue body, which the
 *     target's content holds verbatim (one entry). Neither source yielding a valid milestone dimension is unconvertible.
 *   - Targets are read whether or not they are soft-deleted.
 *   - ALL-OR-NOTHING: if ANY link is unconvertible the migration throws {@link MigrationFailedError} naming each such
 *     link BEFORE it writes anything; the corpus stays byte-identical at schema 37.
 *   - Every plan that gains entries gets a real write: one `versions` row and one hash-chained audit row
 *     (`migrate-schema-038`), authored by the `lore migrate schema` caller; no actor fails loudly.
 *   - {@link checkKnownDefectConversion} is the read-only twin: it plans over a handle and writes nothing, so an
 *     operator can run it against a COPY of a corpus before landing.
 *
 * Side-effect class: schema DDL + data rewrite (executed once per store); the check is pure over its reads.
 */

import { appendKnownDefects, MILESTONE_DIMENSIONS, readKnownDefects, withKnownDefects, type AuditEntry, type KnownDefectEntry } from "@lore/core";
import { computeFtsShadowValues } from "../store-shared.js";
import { MigrationFailedError } from "./migration-026.js";
import {
  auditBindings,
  INSERT_AUDIT_SQL,
  INSERT_CONVERSION_VERSION_SQL,
  SELECT_AUDIT_HEAD_SQL,
  UPDATE_CONVERTED_NODE_SQL,
  type BaselineNodeRow,
} from "./migration-028.js";

/** One `known-defect` link with the facts of both ends (the target is read even when soft-deleted). */
export interface KnownDefectLinkRow {
  readonly from_id: string;
  readonly to_id: string;
  readonly from_slug: string;
  readonly from_type: string;
  /** `null` when the target row does not exist at all. */
  readonly to_slug: string | null;
  readonly to_extra: string | null;
  readonly to_content: string | null;
}

/** Where a conversion's dimension and fingerprint came from. */
export type ConversionSource = "milestone_findings" | "issue body lines";

/** One link that converts, with the entries it yields. */
export interface LinkConversion {
  readonly link: string;
  readonly planId: string;
  readonly planSlug: string;
  readonly source: ConversionSource;
  readonly entries: readonly KnownDefectEntry[];
}

/** One link that cannot convert, and why. */
export interface UnconvertibleLink {
  readonly link: string;
  readonly reason: string;
}

/** The planned conversion of a whole corpus. */
export interface ConversionPlan {
  readonly conversions: readonly LinkConversion[];
  readonly unconvertible: readonly UnconvertibleLink[];
}

const BODY_DIMENSION = /^Dimension:[ \t]*(\S+)[ \t]*$/m;
const BODY_FINGERPRINT = /^Root-cause fingerprint:[ \t]*(\S+)[ \t]*$/m;
const DIMENSIONS: readonly string[] = MILESTONE_DIMENSIONS;

function parseObject(text: string | null): Record<string, unknown> {
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    // reason: an unparseable extra yields no ref; the link is then reported unconvertible, which is the loud outcome.
    return {};
  }
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function issueRefOf(extra: Record<string, unknown>): { repo_id: number; number: number } | undefined {
  const report = extra["issue_report"];
  if (typeof report === "object" && report !== null) {
    const github = (report as Record<string, unknown>)["github"];
    if (typeof github === "object" && github !== null) {
      const repoId = positiveInt((github as Record<string, unknown>)["repo_id"]);
      const number = positiveInt((github as Record<string, unknown>)["number"]);
      if (repoId !== undefined && number !== undefined) return { repo_id: repoId, number };
    }
  }
  const issues = extra["issues"];
  if (Array.isArray(issues) && issues.length > 0 && typeof issues[0] === "object" && issues[0] !== null) {
    const first = issues[0] as Record<string, unknown>;
    const repoId = positiveInt(first["repo_id"]);
    const number = positiveInt(first["number"]);
    if (repoId !== undefined && number !== undefined) return { repo_id: repoId, number };
  }
  return undefined;
}

type DimensionFingerprint = { dimension: (typeof MILESTONE_DIMENSIONS)[number]; fingerprint: string };

function findingsOf(extra: Record<string, unknown>, content: string): { source: ConversionSource; findings: DimensionFingerprint[] } | { error: string } {
  const recorded = extra["milestone_findings"];
  if (Array.isArray(recorded) && recorded.length > 0) {
    const findings: DimensionFingerprint[] = [];
    for (const element of recorded) {
      const record = typeof element === "object" && element !== null ? (element as Record<string, unknown>) : {};
      const dimension = record["dimension"];
      const fingerprint = record["fingerprint"];
      if (typeof dimension !== "string" || !DIMENSIONS.includes(dimension) || typeof fingerprint !== "string" || fingerprint === "") {
        return { error: `milestone_findings element ${JSON.stringify(element)} has no valid milestone dimension and fingerprint` };
      }
      findings.push({ dimension: dimension as DimensionFingerprint["dimension"], fingerprint });
    }
    return { source: "milestone_findings", findings };
  }
  const dimension = BODY_DIMENSION.exec(content)?.[1];
  const fingerprint = BODY_FINGERPRINT.exec(content)?.[1];
  if (dimension !== undefined && DIMENSIONS.includes(dimension) && fingerprint !== undefined) {
    return { source: "issue body lines", findings: [{ dimension: dimension as DimensionFingerprint["dimension"], fingerprint }] };
  }
  return { error: "no milestone_findings and no valid `Dimension:` / `Root-cause fingerprint:` lines in the content" };
}

/**
 * Plans the conversion of every link. Pure.
 *
 * @param rows - every `known-defect` link with both ends
 * @returns the convertible links with their entries and the unconvertible ones with their reasons
 */
export function planKnownDefectConversion(rows: readonly KnownDefectLinkRow[]): ConversionPlan {
  const conversions: LinkConversion[] = [];
  const unconvertible: UnconvertibleLink[] = [];
  for (const row of rows) {
    const link = `${row.from_slug} -> ${row.to_slug ?? row.to_id}`;
    if (row.from_type !== "plan") {
      unconvertible.push({ link, reason: `the link starts at a ${row.from_type}, not a plan` });
      continue;
    }
    if (row.to_slug === null) {
      unconvertible.push({ link, reason: "the link target row does not exist" });
      continue;
    }
    const extra = parseObject(row.to_extra);
    const ref = issueRefOf(extra);
    if (ref === undefined) {
      unconvertible.push({ link, reason: "no issue ref: the target has neither extra.issue_report.github {repo_id, number} nor extra.issues" });
      continue;
    }
    const found = findingsOf(extra, row.to_content ?? "");
    if ("error" in found) {
      unconvertible.push({ link, reason: found.error });
      continue;
    }
    conversions.push({
      link,
      planId: row.from_id,
      planSlug: row.from_slug,
      source: found.source,
      entries: found.findings.map((f) => ({ repo_id: ref.repo_id, number: ref.number, dimension: f.dimension, fingerprint: f.fingerprint })),
    });
  }
  return { conversions, unconvertible };
}

/** The error text naming every unconvertible link. */
export function describeUnconvertible(unconvertible: readonly UnconvertibleLink[]): string {
  return `${String(unconvertible.length)} known-defect link(s) cannot be converted: ${unconvertible.map((u) => `${u.link} (${u.reason})`).join("; ")}`;
}

/** "N convertible, M unconvertible" plus one line per link naming the source used (or the reason). */
export function summarizeConversion(plan: ConversionPlan): string {
  const lines = [`${String(plan.conversions.length)} convertible, ${String(plan.unconvertible.length)} unconvertible`];
  for (const c of plan.conversions) lines.push(`  ok   ${c.link}: ${String(c.entries.length)} entr${c.entries.length === 1 ? "y" : "ies"} from ${c.source}`);
  for (const u of plan.unconvertible) lines.push(`  FAIL ${u.link}: ${u.reason}`);
  return lines.join("\n");
}

/** Every known-defect link with both ends; the target join is a LEFT join with no `deleted_at` filter. */
export const SELECT_KNOWN_DEFECT_LINKS_SQL =
  "SELECT l.from_id AS from_id, l.to_id AS to_id, f.slug AS from_slug, f.type AS from_type, t.slug AS to_slug, t.extra AS to_extra, t.content AS to_content " +
  "FROM links l JOIN docs f ON f.id = l.from_id LEFT JOIN docs t ON t.id = l.to_id WHERE l.link_type = 'known-defect' ORDER BY f.slug, t.slug, l.to_id";
/** A plan row (`?` = id) in the shape the shared write statements take. */
export const SELECT_PLAN_ROW_SQL = "SELECT id, slug, title, content, status, extra, tags, version FROM docs WHERE id = ?";
/** Audit action of a converted plan; in the `update` family of `VERSION_ACTION_AUDIT_FAMILY` (audit-service.ts). */
export const MIGRATION_038_AUDIT_ACTION = "migrate-schema-038";
/** The version's change summary and the audit row's `details.summary`. */
export const MIGRATION_038_SUMMARY = "migrate-schema-038: known-defect links converted to extra.known_defects";
/** The audit row's `session_id`: a corpus-level migration belongs to no doc session. */
export const MIGRATION_038_SESSION_ID = "migrate-schema";

/** Deletes the links, then rebuilds `links` without `known-defect` in its CHECK; bumps user_version. Runs inside the caller's transaction. */
export const MIGRATION_038_SQL = `DELETE FROM links WHERE link_type = 'known-defect';

DROP TABLE IF EXISTS links_new;

CREATE TABLE links_new (
  from_id     TEXT NOT NULL REFERENCES docs(id),
  to_id       TEXT NOT NULL REFERENCES docs(id),
  link_type   TEXT NOT NULL CHECK(link_type IN ('parent','implements','informs','supersedes','relates-to','blocks','governs','resolves')),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, link_type)
);

INSERT INTO links_new (from_id, to_id, link_type, created_at, created_by)
  SELECT from_id, to_id, link_type, created_at, created_by FROM links;

DROP TABLE links;

ALTER TABLE links_new RENAME TO links;

CREATE INDEX idx_links_from ON links(from_id);
CREATE INDEX idx_links_to   ON links(to_id);
CREATE INDEX idx_links_type ON links(link_type);

PRAGMA user_version = 38;
`;

/** The extra a plan carries after the conversion: its current extra plus the merged entries of every link of that plan. */
export interface PlanWrite {
  readonly planId: string;
  readonly extra: Record<string, unknown>;
  readonly addedKeys: number;
}

/**
 * The writes of a conversion: one per plan, merging into the plan's CURRENT `extra`.
 *
 * @param plan - {@link planKnownDefectConversion}'s result (must have no unconvertible link)
 * @param extraOf - the plan's current stored `extra` text
 */
export function planWrites(plan: ConversionPlan, extraOf: (planId: string) => string): PlanWrite[] {
  const byPlan = new Map<string, KnownDefectEntry[]>();
  for (const conversion of plan.conversions) byPlan.set(conversion.planId, [...(byPlan.get(conversion.planId) ?? []), ...conversion.entries]);
  const writes: PlanWrite[] = [];
  for (const [planId, additions] of byPlan) {
    const extra = parseObject(extraOf(planId));
    const existing = readKnownDefects(extra);
    const merged = appendKnownDefects(existing, additions);
    writes.push({ planId, extra: withKnownDefects(extra, merged), addedKeys: merged.length - existing.length });
  }
  return writes;
}

/** The values {@link UPDATE_CONVERTED_NODE_SQL} binds for a converted plan (title and content are unchanged). */
export function convertedPlanBindings(row: BaselineNodeRow, write: PlanWrite, now: string): [string, string, string, string, string, string, number, string, string] {
  const shadow = computeFtsShadowValues(row.title, row.content, row.tags);
  return [row.title, row.content, JSON.stringify(write.extra), shadow.fts_title, shadow.fts_content, shadow.fts_tags, Number(row.version) + 1, now, row.id];
}

/** The values {@link INSERT_CONVERSION_VERSION_SQL} binds for a converted plan. */
export function convertedPlanVersionBindings(
  row: BaselineNodeRow,
  write: PlanWrite,
  actor: string,
  now: string,
): [string, number, string, string, string, string, string, string, string, string] {
  return [row.id, Number(row.version) + 1, row.content, JSON.stringify(write.extra), row.status, row.title, now, actor, MIGRATION_038_SUMMARY, row.slug];
}

/** The audit entry of a converted plan (hashed into the chain by the caller). */
export function convertedPlanAuditEntry(row: BaselineNodeRow, write: PlanWrite, actor: string, now: string): AuditEntry {
  return {
    timestamp: now,
    actor,
    session_id: MIGRATION_038_SESSION_ID,
    action: MIGRATION_038_AUDIT_ACTION,
    doc_id: row.id,
    details: { summary: MIGRATION_038_SUMMARY, from_version: Number(row.version), to_version: Number(row.version) + 1, entries_added: write.addedKeys },
  };
}

/** The author of the conversion's plan writes; a conversion that writes a plan with none fails loudly. */
export function requireConversionActor(actor: string | undefined, planSlug: string): string {
  if (actor === undefined || actor === "") {
    throw new Error(`plan ${planSlug} needs its known defects recorded but no migration actor was supplied (open the store through \`lore migrate schema\`)`);
  }
  return actor;
}

/** The part of `bun:sqlite`'s `Database` the SQLite runner and the check need. */
export interface Migration038Database {
  exec(sql: string): unknown;
  query(sql: string): { all(...args: string[]): unknown[]; get(...args: string[]): unknown };
  prepare(sql: string): { run(...args: (string | number | null)[]): unknown };
}

/**
 * The read-only check: plans the conversion over a handle and writes nothing.
 *
 * @param db - an open handle at schema 37 (a COPY of the corpus when run by an operator)
 */
export function checkKnownDefectConversion(db: Pick<Migration038Database, "query">): ConversionPlan {
  return planKnownDefectConversion(db.query(SELECT_KNOWN_DEFECT_LINKS_SQL).all() as KnownDefectLinkRow[]);
}

/**
 * Runs migration 038 atomically on a SQLite handle.
 *
 * @param db - an open handle at schema 37
 * @param corpusPath - the corpus file, named in a failure
 * @param actor - the `lore migrate schema` caller, who authors every plan write
 * @param now - the timestamp of the writes (default: the current time)
 * @throws {MigrationFailedError} naming each unconvertible link (nothing written), or any other failed step
 */
export function applyMigration038(db: Migration038Database, corpusPath: string, actor?: string, now: string = new Date().toISOString()): void {
  let current = "begin transaction";
  try {
    db.exec("BEGIN IMMEDIATE;");
    current = "plan known-defect link conversion";
    const plan = checkKnownDefectConversion(db);
    if (plan.unconvertible.length > 0) throw new Error(describeUnconvertible(plan.unconvertible));
    const rowOf = (id: string): BaselineNodeRow => db.query(SELECT_PLAN_ROW_SQL).get(id) as BaselineNodeRow;
    const writes = planWrites(plan, (id) => rowOf(id).extra);
    for (const write of writes) {
      const row = rowOf(write.planId);
      current = `record known defects on plan ${row.slug}`;
      if (write.addedKeys === 0) continue;
      const by = requireConversionActor(actor, row.slug);
      db.prepare(UPDATE_CONVERTED_NODE_SQL).run(...convertedPlanBindings(row, write, now));
      db.prepare(INSERT_CONVERSION_VERSION_SQL).run(...convertedPlanVersionBindings(row, write, by, now));
      const head = db.query(SELECT_AUDIT_HEAD_SQL).get() as { entry_hash: string | null } | null;
      db.prepare(INSERT_AUDIT_SQL).run(...auditBindings(convertedPlanAuditEntry(row, write, by, now), head?.entry_hash ?? ""));
    }
    current = "delete links, remove the link type, set user_version 38";
    db.exec(MIGRATION_038_SQL);
    current = "commit";
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // reason: no open transaction to roll back (BEGIN itself failed, or COMMIT already closed it) — the
      // original failure below is the one to report.
    }
    throw new MigrationFailedError(38, current, corpusPath, error);
  }
}
