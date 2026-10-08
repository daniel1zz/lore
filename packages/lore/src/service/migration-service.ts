/**
 * MigrationService — one-shot import of DocMan v1 corpus into Lore v2.
 * Source: SPEC-007, SPEC-001 §3.5
 *
 * Reads v1 markdown files (YAML frontmatter + content), maps to v2 types,
 * inserts via StoreInterface. Detects potential secrets before import.
 */

import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { ulid } from "ulidx";
import { err, ok, splitFrontmatter } from "@lore/core";
import { slugify, slugifyWithCollision } from "@lore/core";
// reason: getTransliterateCjk/containsCjk (SPEC-068 D1, hotfix 2026-07-23) are
// Node-only-subpath-gated purely for the browser-safety barrel-isolation
// invariant (packages/core/src/CLAUDE.md) — this service file is always
// server-side, same precedent config-service.ts already set.
import { containsCjk, getTransliterateCjk } from "@lore/core/node";
import type { LoreError, Result } from "@lore/core";
import type {
  DocId,
  DocRecord,
  DocRole,
  DocStatus,
  DocType,
  LinkRecord,
  LinkType,
  Priority,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { walkFiles } from "./fs-walk.js";
import { applyAcChange } from "./ac-write-chokepoint.js";

// ─── Public Types ──────────────────────────────────────────────────────────

export interface FileError {
  file: string;
  error: string;
}

export interface SecretWarning {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

export interface MigrationReport {
  source_path: string;
  total_files: number;
  parseable: number;
  unparseable: FileError[];
  type_mapping: { v1Type: string; v2Type: string; count: number }[];
  link_mapping: { total: number; resolvable: number; broken: number };
  secret_warnings: SecretWarning[];
  estimated_corpus_size: string;
}

export interface MigrationResult {
  imported: number;
  /**
   * Docs that were skipped because they already exist in the store (idempotent re-run).
   * Distinct from `errors` (parse failures) — these docs are NOT missing from the corpus.
   * Used by eval scenarios to compute: (imported + already_existed) === expected_files.
   */
  already_existed: number;
  /** @deprecated Kept for forward-compatibility; always 0 — parse failures go to `errors`. */
  skipped: number;
  errors: FileError[];
  link_resolution: { created: number; broken: number };
  warnings: string[];
}

export interface MigrateOpts {
  dryRun: boolean;
  skipSecretScan: boolean;
  idStrategy: "preserve" | "remap";
}

// ─── Internal Parsed Doc ────────────────────────────────────────────────────

/** Normalized internal link entry — produced from either string or object form. */
interface ParsedLink {
  targetId: string;
  /** Resolved to a valid LinkType — unknown values coerced to "relates-to". */
  linkType: LinkType;
}

interface ParsedV1Doc {
  filePath: string;
  v1Id: string;
  v1Type: string;
  v1Status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  links: ParsedLink[];
  /** v1 id of the parent doc, if declared in frontmatter via `parent:` field */
  parentV1Id: string | null;
  title: string;
  content: string;
}

// ─── Type Mapping Table ─────────────────────────────────────────────────────

interface V2TypeMapping {
  type: DocType;
  role: DocRole;
  warning?: string;
}

const V1_TYPE_MAP: Readonly<Record<string, V2TypeMapping>> = {
  prd: { type: "prd", role: "intent" },
  spec: { type: "spec", role: "spec" },
  "feature-spec": { type: "spec", role: "spec" },
  "tech-spec": { type: "spec", role: "spec" },
  architecture: { type: "spec", role: "spec" },
  decision: { type: "adr", role: "decision" },
  adr: { type: "adr", role: "decision" },
  plan: { type: "plan", role: "plan" },
  knowledge: { type: "knowledge", role: "knowledge" },
  ideation: { type: "knowledge", role: "knowledge" },
  retrospective: { type: "knowledge", role: "knowledge" },
  task: { type: "task", role: "plan" },
} as const;

const DEFAULT_MAPPING: V2TypeMapping = {
  type: "knowledge",
  role: "knowledge",
};

// ─── Secret Scan Patterns ───────────────────────────────────────────────────

interface SecretPattern {
  name: string;
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: "AWS Access Key",
    regex: /AKIA[A-Z0-9]{16}/,
  },
  {
    name: "Private Key Block",
    regex: /-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----/,
  },
  {
    name: ".env style value",
    regex: /^[A-Z_]+=.{8,}/m,
  },
];

// keyword context for generic API key detection
const API_KEY_KEYWORDS = /\b(key|token|secret|api)[_-]?[a-z]*/i;
const GENERIC_KEY_REGEX = /[A-Za-z0-9_-]{32,}/;

// ─── MigrationService ──────────────────────────────────────────────────────

export class MigrationService {
  constructor(private readonly store: StoreInterface) {}

  /**
   * Analyze source directory — parse all .md files, compute report.
   * No writes to store.
   */
  analyze(sourcePath: string): Result<MigrationReport, LoreError> {
    const mdFilesResult = collectMdFiles(sourcePath);
    if (!mdFilesResult.ok) return mdFilesResult;

    const mdFiles = mdFilesResult.value;
    const parsedDocs: ParsedV1Doc[] = [];
    const unparseable: FileError[] = [];

    for (const filePath of mdFiles) {
      const parseResult = parseV1File(filePath);
      if (parseResult.ok) {
        parsedDocs.push(parseResult.value);
      } else {
        unparseable.push({
          file: filePath,
          error: parseResult.error.message,
        });
      }
    }

    const typeMappingCounts = buildTypeMappingCounts(parsedDocs);
    const linkMapping = computeLinkMapping(parsedDocs);
    const secretWarnings = scanForSecrets(parsedDocs);
    const totalBytes = estimateTotalBytes(parsedDocs);

    return ok({
      source_path: sourcePath,
      total_files: mdFiles.length,
      parseable: parsedDocs.length,
      unparseable,
      type_mapping: typeMappingCounts,
      link_mapping: linkMapping,
      secret_warnings: secretWarnings,
      estimated_corpus_size: formatCorpusSize(parsedDocs.length, totalBytes),
    });
  }

  /**
   * Execute import of v1 corpus into the store.
   * Returns MigrationResult or a LoreError if preconditions fail.
   */
  async execute(
    sourcePath: string,
    opts: MigrateOpts,
  ): Promise<Result<MigrationResult, LoreError>> {
    const reportResult = this.analyze(sourcePath);
    if (!reportResult.ok) return reportResult;

    const report = reportResult.value;

    if (opts.dryRun) {
      return ok({
        imported: 0,
        already_existed: 0,
        skipped: 0,
        errors: [],
        link_resolution: { created: 0, broken: 0 },
        warnings: ["dry-run: no documents written"],
      });
    }

    if (report.secret_warnings.length > 0 && !opts.skipSecretScan) {
      return err({
        code: "VALIDATION_ERROR",
        field: "sourcePath",
        message: `Secret scan found ${report.secret_warnings.length} potential secret(s). Fix source files or pass skipSecretScan=true to proceed.`,
        value: report.secret_warnings.map((w) => w.file),
      });
    }

    // Re-collect parsed docs for import
    const mdFilesResult = collectMdFiles(sourcePath);
    if (!mdFilesResult.ok) return mdFilesResult;

    const parsedDocs: ParsedV1Doc[] = [];
    const importErrors: FileError[] = [];

    for (const filePath of mdFilesResult.value) {
      const parseResult = parseV1File(filePath);
      if (parseResult.ok) {
        parsedDocs.push(parseResult.value);
      } else {
        importErrors.push({ file: filePath, error: parseResult.error.message });
      }
    }

    const importResult = await this.importDocs(parsedDocs, opts, importErrors);
    if (!importResult.ok) return importResult;

    const { imported, already_existed, warnings, v1IdToNewId } = importResult.value;

    await this.resolveParents(parsedDocs, v1IdToNewId, warnings);
    const linkResolution = await this.resolveLinks(parsedDocs, v1IdToNewId);

    return ok({
      imported,
      already_existed,
      skipped: 0,
      errors: importErrors,
      link_resolution: linkResolution,
      warnings,
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async importDocs(
    parsedDocs: ParsedV1Doc[],
    opts: MigrateOpts,
    importErrors: FileError[],
  ): Promise<
    Result<
      {
        imported: number;
        already_existed: number;
        warnings: string[];
        v1IdToNewId: Map<string, DocId>;
      },
      LoreError
    >
  > {
    let imported = 0;
    // reason: "already_existed" tracks docs that are idempotently skipped (already in store).
    // This is separate from parse-error skips (which land in importErrors). Eval scenarios use
    // (imported + already_existed) === expected_files as the pass criterion — see SPEC-013 §K2.
    let already_existed = 0;
    const warnings: string[] = [];
    const v1IdToNewId = new Map<string, DocId>();

    // Build a set of existing v1 original IDs to detect re-runs. A STORE_ERROR here
    // MUST abort the whole import — silently treating it as "no existing docs" would
    // re-import every already-migrated doc as new (mass duplication with zero error
    // signal), violating the repo's no-silent-fallback convention.
    const existingV1IdsResult = await this.collectExistingV1Ids();
    if (!existingV1IdsResult.ok) return existingV1IdsResult;
    const existingV1Ids = existingV1IdsResult.value;

    for (const doc of parsedDocs) {
      // Skip already-imported docs (idempotency) — count as already_existed, not skipped
      if (existingV1Ids.has(doc.v1Id)) {
        already_existed += 1;
        continue;
      }

      const mappingResult = resolveV1Type(doc.v1Type);
      if (mappingResult.warning) {
        warnings.push(
          `${doc.filePath}: unknown type "${doc.v1Type}", imported as knowledge`,
        );
      }

      const newId =
        opts.idStrategy === "preserve" ? doc.v1Id : ulid();

      const existingSlugsFn = async (slug: string): Promise<boolean> => {
        const r = await this.store.findBySlug(slug);
        return r.ok && r.value !== null;
      };

      // Only awaited when the title actually contains CJK — an ASCII-only
      // title never pays the pinyin-pro load cost (SPEC-068 D1 hotfix).
      // reason: exactOptionalPropertyTypes forbids `{ transliterate: undefined }`
      // — omit the key entirely rather than spread an undefined-valued property.
      const slugOpts = containsCjk(doc.title) ? { transliterate: await getTransliterateCjk() } : undefined;
      const slug = await slugifyWithCollision(
        mappingResult.type,
        doc.title,
        existingSlugsFn,
        slugOpts,
      );

      const extra = buildExtra(mappingResult, doc);

      const docRecord: DocRecord = {
        id: newId,
        slug,
        type: mappingResult.type,
        role: mappingResult.role,
        title: doc.title,
        status: mapV1Status(doc.v1Status),
        priority: mapV1Priority(doc.priority),
        content: doc.content,
        parent_id: null,
        created_at: parseIsoDate(doc.createdAt),
        updated_at: parseIsoDate(doc.updatedAt),
        created_by: "migration:v1",
        version: 1,
        deleted_at: null,
        tags: doc.tags,
        extra,
      };

      // AC write chokepoint (spec-baseline-slice-2 §C3, #54): imported frontmatter criteria are a
      // sanctioned "import" write, re-validated like any other incoming AC array. A malformed
      // array is reported per-file and skipped, never inserted.
      const acGate = applyAcChange("import", undefined, extra);
      if (!acGate.ok) {
        importErrors.push({
          file: doc.filePath,
          error: `Invalid acceptance_criteria: ${acGate.error.code === "VALIDATION_ERROR" ? acGate.error.message : acGate.error.code}`,
        });
        continue;
      }

      const insertResult = await this.store.insert(docRecord);
      if (!insertResult.ok) {
        importErrors.push({
          file: doc.filePath,
          error:
            insertResult.error.code === "DUPLICATE_SLUG"
              ? `Duplicate slug: ${slug}`
              : `Store error: ${insertResult.error.code}`,
        });
        continue;
      }

      // Version record
      await this.store.insertVersion({
        doc_id: newId,
        version: 1,
        content: doc.content,
        extra,
        status: docRecord.status,
        title: doc.title,
        action: "create",
        created_at: docRecord.created_at,
        created_by: "migration:v1",
      });

      v1IdToNewId.set(doc.v1Id, newId);
      imported += 1;
    }

    return ok({ imported, already_existed, warnings, v1IdToNewId });
  }

  /**
   * Collects the set of `v1_original_id` values already present in the store, used by
   * `importDocs` to detect a re-run and skip already-migrated docs (idempotency guard).
   *
   * @invariant passes `exclude_deleted: false` — a previously-migrated doc that was
   *   later soft-deleted MUST still count as "already imported", otherwise a re-run
   *   would resurrect it as a brand-new duplicate (the doc's `deleted_at` says nothing
   *   about whether v1 already produced it once).
   * @invariant propagates a STORE_ERROR instead of degrading to an empty set — an
   *   empty set here would make every already-migrated doc look new, re-importing the
   *   entire corpus as duplicates with no error surfaced to the caller.
   */
  private async collectExistingV1Ids(): Promise<Result<Set<string>, LoreError>> {
    const result = await this.store.findMany({ exclude_deleted: false });
    if (!result.ok) return result;

    const ids = new Set<string>();
    for (const doc of result.value) {
      const v1Id = doc.extra["v1_original_id"];
      if (typeof v1Id === "string") {
        ids.add(v1Id);
      }
    }
    return ok(ids);
  }

  private async resolveLinks(
    parsedDocs: ParsedV1Doc[],
    v1IdToNewId: Map<string, DocId>,
  ): Promise<{ created: number; broken: number }> {
    let created = 0;
    let broken = 0;

    const now = new Date().toISOString();

    for (const doc of parsedDocs) {
      const fromId = v1IdToNewId.get(doc.v1Id);
      if (fromId === undefined) continue;

      for (const link of doc.links) {
        const toId = v1IdToNewId.get(link.targetId);
        if (toId === undefined) {
          broken += 1;
          continue;
        }

        const linkRecord: LinkRecord = {
          from_id: fromId,
          to_id: toId,
          link_type: link.linkType,
          created_at: now,
          created_by: "migration:v1",
        };

        const addResult = await this.store.addLink(linkRecord);
        if (addResult.ok) {
          created += 1;
        } else {
          // DUPLICATE_LINK is benign on re-run — count as broken to not inflate
          broken += 1;
        }
      }
    }

    return { created, broken };
  }

  /**
   * Back-fill parent_id on imported docs that declared a `parent:` field.
   * Must run AFTER importDocs so all v1IdToNewId entries are populated.
   * Docs whose parent v1Id did not import (forward ref or missing) get a warning.
   */
  private async resolveParents(
    parsedDocs: ParsedV1Doc[],
    v1IdToNewId: Map<string, DocId>,
    warnings: string[],
  ): Promise<void> {
    for (const doc of parsedDocs) {
      if (doc.parentV1Id === null) continue;

      const childNewId = v1IdToNewId.get(doc.v1Id);
      if (childNewId === undefined) continue; // doc itself was skipped

      const parentNewId = v1IdToNewId.get(doc.parentV1Id);
      if (parentNewId === undefined) {
        warnings.push(
          `${doc.filePath}: parent "${doc.parentV1Id}" not found in imported corpus — parent_id left null`,
        );
        continue;
      }

      await this.store.update(childNewId, { parent_id: parentNewId });
    }
  }
}

// ─── File System Helpers ────────────────────────────────────────────────────

function collectMdFiles(dirPath: string): Result<string[], LoreError> {
  try {
    // reason: onError defaults to "throw" — a single failure anywhere in the walk
    // propagates to this catch, matching the original walkDir's un-caught-internally
    // recursion (the whole walk aborted together, converted to one STORE_ERROR here).
    return ok(walkFiles(dirPath, { extensions: [".md"] }));
  } catch (e) {
    const storeErr: LoreError = e instanceof Error
      ? { code: "STORE_ERROR", message: `Cannot read source directory "${dirPath}": ${e.message}`, cause: e }
      : { code: "STORE_ERROR", message: `Cannot read source directory "${dirPath}": ${String(e)}` };
    return err(storeErr);
  }
}

// ─── Parsing ────────────────────────────────────────────────────────────────

type ParseError = { ok: false; error: { message: string } };

function parseV1File(filePath: string): Result<ParsedV1Doc, { message: string }> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (e) {
    return { ok: false, error: { message: `Cannot read file: ${String(e)}` } };
  }

  const fmResult = extractFrontmatter(raw);
  if (!fmResult.ok) {
    return fmResult;
  }

  const { frontmatter, body } = fmResult.value;

  let fm: unknown;
  try {
    fm = parseYaml(frontmatter);
  } catch (e) {
    return { ok: false, error: { message: `YAML parse error: ${String(e)}` } };
  }

  if (fm === null || typeof fm !== "object") {
    return { ok: false, error: { message: "Frontmatter is not an object" } };
  }

  const record = fm as Record<string, unknown>;

  const id = typeof record["id"] === "string" ? record["id"] : "";
  if (!id) {
    return {
      ok: false,
      error: { message: 'Missing required frontmatter field "id"' },
    };
  }

  const title = extractTitle(body, record);

  return {
    ok: true,
    value: {
      filePath,
      v1Id: id,
      v1Type: typeof record["type"] === "string" ? record["type"] : "knowledge",
      v1Status:
        typeof record["status"] === "string" ? record["status"] : "draft",
      priority:
        typeof record["priority"] === "string" ? record["priority"] : "medium",
      createdAt:
        typeof record["created"] === "string" ? record["created"] : "",
      updatedAt:
        typeof record["updated"] === "string" ? record["updated"] : "",
      tags: parseStringArray(record["tags"]),
      links: parseLinkArray(record["links"]),
      parentV1Id: typeof record["parent"] === "string" ? record["parent"] : null,
      title,
      content: body.trim(),
    },
  };
}

function extractFrontmatter(
  raw: string,
): Result<{ frontmatter: string; body: string }, { message: string }> {
  // reason: BOM-stripping stays here (splitFrontmatter is delimiter-splitting only —
  // pre-processing is each caller's job, see packages/core/src/frontmatter.ts header).
  const stripped = raw.startsWith("﻿") ? raw.slice(1) : raw;

  const split = splitFrontmatter(stripped, "loose");
  if (!split.ok) {
    return { ok: false, error: { message: split.error } };
  }

  return {
    ok: true,
    value: { frontmatter: split.frontmatter, body: split.body },
  };
}

function extractTitle(body: string, record: Record<string, unknown>): string {
  // Try frontmatter title first
  if (typeof record["title"] === "string" && record["title"].trim()) {
    return record["title"].trim();
  }
  // Try first H1 in body
  const h1Match = /^#\s+(.+)$/m.exec(body);
  if (h1Match) {
    return h1Match[1]?.trim() ?? "Untitled";
  }
  return "Untitled";
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Valid LinkType values as a lookup set for O(1) membership test. */
const VALID_LINK_TYPES = new Set<LinkType>([
  "parent",
  "implements",
  "informs",
  "supersedes",
  "relates-to",
  "blocks",
  "governs",
]);

/**
 * Coerce an arbitrary string to a valid LinkType.
 * Unknown v1/lore-native types (e.g. "consumes", "consumed-by", "contains") fall back
 * to "relates-to" so the link is still preserved without a store constraint violation.
 */
function normalizeLinkType(raw: string): LinkType {
  const trimmed = raw.trim() as LinkType;
  return VALID_LINK_TYPES.has(trimmed) ? trimmed : "relates-to";
}

/**
 * Parse the `links` frontmatter field, which may be:
 *   - string array:  ["SPEC-001", "SPEC-002"]
 *   - object array:  [{id: "SPEC-001", type: "consumes", note: "..."}]
 *   - mixed array:   ["SPEC-001", {id: "SPEC-002", type: "implements"}]
 *
 * Objects missing the `id` field are skipped with no throw (they're malformed).
 * Returns normalized ParsedLink[] in all cases.
 */
function parseLinkArray(value: unknown): ParsedLink[] {
  if (!Array.isArray(value)) return [];

  const result: ParsedLink[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (item.trim()) {
        result.push({ targetId: item.trim(), linkType: "relates-to" });
      }
    } else if (item !== null && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const targetId = typeof obj["id"] === "string" ? obj["id"].trim() : "";
      if (!targetId) continue; // malformed object — skip silently
      const linkType =
        typeof obj["type"] === "string" && obj["type"].trim()
          ? normalizeLinkType(obj["type"])
          : "relates-to";
      result.push({ targetId, linkType });
    }
    // other types (number, boolean) silently ignored
  }
  return result;
}

// ─── Type Resolution ────────────────────────────────────────────────────────

function resolveV1Type(v1Type: string): V2TypeMapping {
  return V1_TYPE_MAP[v1Type] ?? { ...DEFAULT_MAPPING, warning: `unknown v1 type: ${v1Type}` };
}

// ─── Status / Priority Mapping ──────────────────────────────────────────────

function mapV1Status(v1Status: string): DocStatus {
  const map: Record<string, DocStatus> = {
    published: "approved",
    draft: "draft",
    "in-review": "in-review",
    approved: "approved",
    active: "active",
    archived: "archived",
    deprecated: "deprecated",
  };
  return map[v1Status] ?? "draft";
}

function mapV1Priority(v1Priority: string): Priority {
  const map: Record<string, Priority> = {
    critical: "critical",
    high: "high",
    medium: "medium",
    low: "low",
  };
  return map[v1Priority] ?? "medium";
}

// ─── Extra Fields ───────────────────────────────────────────────────────────

function buildExtra(
  mapping: V2TypeMapping,
  doc: ParsedV1Doc,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    v1_original_id: doc.v1Id,
  };

  if (mapping.type === "adr") {
    return { ...base, decision_status: "accepted" };
  }
  if (mapping.type === "knowledge") {
    return { ...base, sub_type: "reference" };
  }
  if (mapping.type === "task") {
    // task requires plan_id — use a placeholder since v1 tasks may not have one
    return { ...base, plan_id: doc.v1Id };
  }

  return base;
}

// ─── Date Parsing ───────────────────────────────────────────────────────────

function parseIsoDate(raw: string): string {
  if (!raw) return new Date().toISOString();
  // Handle YYYY-MM-DD format or ISO strings
  const d = new Date(raw);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

// ─── Secret Scan ───────────────────────────────────────────────────────────

/**
 * Placeholder patterns that indicate a previously-redacted value.
 * A secret match on a line containing one of these tokens is skipped —
 * it represents documentation of a secret, not the secret itself.
 */
const REDACTED_PLACEHOLDER = /\[REDACTED\]|<redacted>|\*{3,}|XXXX/i;

function scanForSecrets(docs: ParsedV1Doc[]): SecretWarning[] {
  const warnings: SecretWarning[] = [];

  for (const doc of docs) {
    const lines = doc.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const lineNum = i + 1;

      // If the line already contains a redacted placeholder, skip all pattern
      // checks for it — it documents a secret rather than containing one.
      if (REDACTED_PLACEHOLDER.test(line)) {
        continue;
      }

      // Check named secret patterns
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(line)) {
          warnings.push({
            file: doc.filePath,
            line: lineNum,
            pattern: pattern.name,
            snippet: redact(line),
          });
        }
      }

      // Check generic API key pattern: long base64-ish string near keyword
      if (API_KEY_KEYWORDS.test(line) && GENERIC_KEY_REGEX.test(line)) {
        warnings.push({
          file: doc.filePath,
          line: lineNum,
          pattern: "potential API key",
          snippet: redact(line),
        });
      }
    }
  }

  return warnings;
}

function redact(line: string): string {
  // Replace long token-like strings with redacted marker
  return line.replace(/[A-Za-z0-9_/+=]{16,}/g, "[REDACTED]").slice(0, 100);
}

// ─── Report Builders ────────────────────────────────────────────────────────

function buildTypeMappingCounts(
  docs: ParsedV1Doc[],
): { v1Type: string; v2Type: string; count: number }[] {
  const counts = new Map<string, { v2Type: string; count: number }>();

  for (const doc of docs) {
    const mapping = resolveV1Type(doc.v1Type);
    const existing = counts.get(doc.v1Type);
    if (existing) {
      counts.set(doc.v1Type, { v2Type: existing.v2Type, count: existing.count + 1 });
    } else {
      counts.set(doc.v1Type, { v2Type: mapping.type, count: 1 });
    }
  }

  return Array.from(counts.entries()).map(([v1Type, { v2Type, count }]) => ({
    v1Type,
    v2Type,
    count,
  }));
}

function computeLinkMapping(
  docs: ParsedV1Doc[],
): { total: number; resolvable: number; broken: number } {
  const allV1Ids = new Set(docs.map((d) => d.v1Id));
  let total = 0;
  let resolvable = 0;

  for (const doc of docs) {
    for (const link of doc.links) {
      total += 1;
      if (allV1Ids.has(link.targetId)) resolvable += 1;
    }
  }

  return { total, resolvable, broken: total - resolvable };
}

function estimateTotalBytes(docs: ParsedV1Doc[]): number {
  return docs.reduce((sum, d) => sum + d.content.length, 0);
}

function formatCorpusSize(count: number, bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return `${count} docs, ${mb}MB`;
}
