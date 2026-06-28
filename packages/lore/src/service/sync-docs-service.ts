/**
 * SyncDocsService — one-way file → corpus reconciler for spec documents.
 *
 * Public surface:
 *   - SyncDocsService.run(opts) — scan a directory of *.md spec files, compare
 *     against the corpus by title, create missing specs, report drift.
 *
 * Invariants:
 *   - Stateless. The only dependency is CorpusService (no AI, no direct store access).
 *   - Never overwrites corpus content — drift is reported, not auto-resolved.
 *   - Idempotent — re-running on the same corpus produces 0 creates, only matches.
 *   - Per-file errors do NOT abort the whole run; other files still process.
 *   - aiProviderService is NEVER called from this service (no-AI boundary).
 *     reason: sync-docs is a structural reconciler; AI generation is orthogonal.
 *     AC-SD-15 enforces this at test time via grep.
 *
 * Side-effect class: IO (readdirSync, readFileSync) + CorpusService async calls.
 *
 * Source: SPEC-018 §3
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { diffChars } from "diff";
import { err, ok } from "@lore/core";
import type { LoreError, Priority, Result } from "@lore/core";
import type { DocId, DocSummary } from "@lore/core";
import { prioritySchema } from "@lore/core";
import type { CorpusService } from "./corpus-service.js";

// ─── Public Types ─────────────────────────────────────────────────────────────

/**
 * Options passed to SyncDocsService.run().
 *
 * @example
 *   const report = await syncDocsService.run({ fromDir: "docs/requirements/spec", dryRun: false });
 */
export interface SyncDocsOptions {
  /** Absolute path to directory of *.md spec files. */
  fromDir: string;
  /**
   * When true, compute and report what would happen but write nothing.
   * Default at the CLI adapter level is false (applies creates by default).
   */
  dryRun: boolean;
}

/**
 * Summary of a single sync operation.
 * All counts are integers. Arrays are always present (may be empty).
 */
export interface SyncReport {
  /** Total *.md files scanned in fromDir (excluding subdirectory recursion). */
  scanned: number;
  /** Specs created in the corpus during this run. Empty when dryRun=true. */
  created: Array<{ file: string; slug: string }>;
  /** Specs whose body matches corpus content exactly. */
  matched_clean: Array<{ file: string; slug: string }>;
  /** Specs found in corpus but whose body differs from the file. */
  matched_drift: Array<{ file: string; slug: string; diff_chars: number }>;
  /** Per-file parse/parent-resolution errors. Other files still processed. */
  errors: Array<{ file: string; error: string }>;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

/** Parsed and validated content from a spec file's frontmatter + body. */
interface ParsedSpec {
  /** Absolute path of the source file. */
  path: string;
  /** Frontmatter title field (string-coerced). */
  title: string;
  /** Frontmatter-stripped body (leading whitespace trimmed). */
  body: string;
  /**
   * Frontmatter `parent:` string, used for PRD lookup in multi-PRD corpora.
   * Undefined when the frontmatter has no `parent` key.
   */
  parent_title_hint: string | undefined;
  /** Validated priority; falls back to "medium" if unknown. */
  priority: Priority;
  /** Frontmatter tags array; falls back to [] if absent. */
  tags: string[];
}

// ─── Valid priority values for membership check ───────────────────────────────

const VALID_PRIORITIES = prioritySchema.options as readonly string[];

// ─── SyncDocsService ──────────────────────────────────────────────────────────

/**
 * Reconciles spec files on disk with the Lore corpus.
 *
 * @example
 *   const service = new SyncDocsService(corpusService);
 *   const result = await service.run({ fromDir: "/project/docs/requirements/spec", dryRun: false });
 *   if (result.ok) console.log(result.value.created.length, "new specs created");
 */
export class SyncDocsService {
  /**
   * @param corpus - CorpusService instance for all corpus read/write operations.
   */
  constructor(private readonly corpus: CorpusService) {}

  /**
   * Run the sync-docs reconciliation pass.
   *
   * Algorithm:
   *   1. Collect *.md files from opts.fromDir (non-recursive).
   *   2. Parse frontmatter for each file → accumulate ParsedSpec[] and parse errors.
   *   3. Fetch all specs and PRDs from corpus once (pre-caching).
   *   4. For each ParsedSpec: match by title.
   *      If matched → fetch full doc for content → compare body (drift check).
   *      If unmatched → resolve parent → create (unless dryRun).
   *   5. Return SyncReport.
   *
   * @param opts - Directory to scan and dry-run flag.
   * @returns ok(SyncReport) always — individual file errors are inside report.errors, not a top-level err().
   */
  async run(opts: SyncDocsOptions): Promise<Result<SyncReport, LoreError>> {
    // ── Step 1: Collect and parse *.md files ─────────────────────────────────
    const mdFiles = collectMdFiles(opts.fromDir);

    const parsedSpecs: ParsedSpec[] = [];
    const parseErrors: Array<{ file: string; error: string }> = [];

    for (const filePath of mdFiles) {
      const parseResult = parseSpecFile(filePath);
      if (parseResult.ok) {
        parsedSpecs.push(parseResult.value);
      } else {
        const parseErrMsg = "message" in parseResult.error ? parseResult.error.message : parseResult.error.code;
        parseErrors.push({ file: filePath, error: parseErrMsg });
      }
    }

    // ── Step 2: Fetch corpus once — cache PRD + spec lists ───────────────────
    const specListResult = await this.corpus.list({ type: "spec" });
    if (!specListResult.ok) return specListResult;

    const prdListResult = await this.corpus.list({ type: "prd" });
    if (!prdListResult.ok) return prdListResult;

    // Build lookup map: title → corpus DocSummary
    // reason: title-match dedup is the v1 identity strategy per SPEC-018 §3.1.
    const titleToCorpusSpec = buildTitleMap(specListResult.value.docs);
    const prds = prdListResult.value.docs;

    // ── Step 3: Resolve parent PRD once if there's exactly one ───────────────
    // reason: cache single-PRD case to avoid re-querying per file (spec §3.4 branch 2).
    const singlePrd: DocSummary | undefined = prds.length === 1 ? prds[0] : undefined;
    let singlePrdWarnedOnce = false;

    // ── Step 4: Process each parsed spec ─────────────────────────────────────
    const created: Array<{ file: string; slug: string }> = [];
    const matched_clean: Array<{ file: string; slug: string }> = [];
    const matched_drift: Array<{ file: string; slug: string; diff_chars: number }> = [];
    const fileErrors: Array<{ file: string; error: string }> = [];

    for (const spec of parsedSpecs) {
      const existingSummary = titleToCorpusSpec.get(spec.title);

      if (existingSummary !== undefined) {
        // Title matched — fetch full doc to compare body for drift
        const getResult = await this.corpus.get(existingSummary.id as string);
        if (!getResult.ok) {
          fileErrors.push({ file: spec.path, error: `get failed: ${getResult.error.code}` });
          continue;
        }
        const existingContent = getResult.value.doc.content;

        const fileNormalized = normalizeBody(spec.body);
        const corpusNormalized = normalizeBody(existingContent);

        if (fileNormalized === corpusNormalized) {
          matched_clean.push({ file: spec.path, slug: existingSummary.slug });
        } else {
          // reason: Math.abs(length diff) reports 0 for equal-length-but-different bodies,
        // contradicting the matched_drift bucket. diffChars uses LCS for accuracy. SPEC-018 §3.3.
        const changes = diffChars(corpusNormalized, fileNormalized);
        const diff_chars = changes
          .filter((c) => c.added === true || c.removed === true)
          .reduce((sum, c) => sum + c.value.length, 0);
          matched_drift.push({ file: spec.path, slug: existingSummary.slug, diff_chars });
        }
        continue;
      }

      // No title match — this spec needs to be created.
      // Resolve parent PRD.
      const parentResult = resolveParentId(spec, prds, singlePrd);
      if (!parentResult.ok) {
        const parentErrMsg = "message" in parentResult.error ? parentResult.error.message : parentResult.error.code;
        fileErrors.push({ file: spec.path, error: parentErrMsg });
        continue;
      }

      // Warn once about frontmatter parent being ignored (single-PRD corpus, AC-SD-7)
      if (singlePrd !== undefined && !singlePrdWarnedOnce && spec.parent_title_hint !== undefined) {
        process.stderr.write(
          `note: ignoring frontmatter parent for single-PRD corpus — using "${singlePrd.title}"\n`,
        );
        singlePrdWarnedOnce = true;
      }

      if (opts.dryRun) {
        // Dry-run: report what would be created but write nothing
        created.push({ file: spec.path, slug: "(dry-run)" });
        continue;
      }

      const createResult = await this.corpus.create({
        type: "spec",
        title: spec.title,
        content: spec.body,
        parent_id: parentResult.value,
        priority: spec.priority,
        tags: spec.tags,
      });

      if (!createResult.ok) {
        const errorDetail =
          "message" in createResult.error ? ` — ${createResult.error.message}` : "";
        fileErrors.push({
          file: spec.path,
          error: `create failed: ${createResult.error.code}${errorDetail}`,
        });
        continue;
      }

      created.push({ file: spec.path, slug: createResult.value.slug });
    }

    const report: SyncReport = {
      scanned: mdFiles.length,
      created,
      matched_clean,
      matched_drift,
      errors: [...parseErrors, ...fileErrors],
    };

    return ok(report);
  }
}

// ─── File System Helpers ──────────────────────────────────────────────────────

/**
 * Collect all *.md files in a directory (non-recursive, flat listing only).
 * Returns [] if directory is empty or does not exist.
 *
 * @param dirPath - Directory to list.
 * @returns Array of absolute file paths to *.md files.
 */
function collectMdFiles(dirPath: string): string[] {
  let names: string[];
  try {
    // reason: readdirSync without withFileTypes returns string[] which avoids
    // Dirent<NonSharedBuffer> type issues in Bun's TypeScript definitions.
    names = readdirSync(dirPath) as string[];
  } catch {
    // Directory does not exist or is not readable — return empty list.
    // reason: --from <empty-or-missing-dir> exits 0 with "0 files" per AC-SD-3.
    return [];
  }

  const result: string[] = [];
  for (const name of names) {
    if (typeof name === "string" && name.endsWith(".md")) {
      result.push(join(dirPath, name));
    }
  }
  return result;
}

// ─── Frontmatter Parsing ─────────────────────────────────────────────────────

/**
 * Parse a single spec file: extract frontmatter, validate type="spec", extract body.
 *
 * @param absPath - Absolute path to the *.md file.
 * @returns ok(ParsedSpec) or err(VALIDATION_ERROR) for missing/malformed frontmatter.
 */
function parseSpecFile(absPath: string): Result<ParsedSpec, LoreError> {
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch (e) {
    return err({
      code: "VALIDATION_ERROR",
      field: "file",
      message: `${absPath}: cannot read file — ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // Normalize CRLF → LF before regex to handle Windows line endings (spec §3.2 note)
  const normalized = raw.replace(/\r\n/g, "\n");

  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return err({
      code: "VALIDATION_ERROR",
      field: "frontmatter",
      message: `${absPath}: missing or malformed frontmatter (expected ---\\n...\\n---\\n)`,
    });
  }

  // match[1] is the YAML block, match[2] is the body
  // reason: regex has two capturing groups so match[1] and match[2] are always
  // defined when match is non-null, but TypeScript doesn't know that — use ?? "".
  const yamlBlock = match[1] ?? "";
  const bodyRaw = match[2] ?? "";

  let fm: unknown;
  try {
    fm = parseYaml(yamlBlock);
  } catch (e) {
    // AC-SD-13: malformed YAML → VALIDATION_ERROR for this file
    return err({
      code: "VALIDATION_ERROR",
      field: "frontmatter",
      message: `${absPath}: YAML parse error — ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  if (fm === null || typeof fm !== "object") {
    return err({
      code: "VALIDATION_ERROR",
      field: "frontmatter",
      message: `${absPath}: frontmatter is not a YAML object`,
    });
  }

  const record = fm as Record<string, unknown>;

  // AC-SD-12: type must be "spec"
  if (record["type"] !== "spec") {
    return err({
      code: "VALIDATION_ERROR",
      field: "type",
      message: `${absPath}: type='${String(record["type"])}' (expected 'spec')`,
    });
  }

  const title = typeof record["title"] === "string" ? record["title"].trim() : "";
  if (!title) {
    return err({
      code: "VALIDATION_ERROR",
      field: "title",
      message: `${absPath}: missing or empty 'title' in frontmatter`,
    });
  }

  const rawPriority = typeof record["priority"] === "string" ? record["priority"] : "";
  const priority: Priority = VALID_PRIORITIES.includes(rawPriority)
    ? (rawPriority as Priority)
    : "medium";

  const tags: string[] = Array.isArray(record["tags"])
    ? record["tags"].filter((v): v is string => typeof v === "string")
    : [];

  const parent_title_hint: string | undefined =
    typeof record["parent"] === "string" ? record["parent"] : undefined;

  return ok({
    path: absPath,
    title,
    body: bodyRaw.trimStart(),
    parent_title_hint,
    priority,
    tags,
  });
}

// ─── Parent Resolution ───────────────────────────────────────────────────────

/**
 * Resolve the parent PRD DocId for a spec being synced.
 *
 * Resolution rules (SPEC-018 §3.4):
 *   0 PRDs → VALIDATION_ERROR
 *   1 PRD  → always use it (frontmatter `parent` ignored, warned once by caller)
 *   ≥2 PRDs, frontmatter.parent matches one PRD title → use that PRD
 *   ≥2 PRDs, no match → VALIDATION_ERROR
 *
 * @param spec - Parsed spec (may carry parent_title_hint from frontmatter).
 * @param prds - All PRD DocSummary records in the corpus.
 * @param singlePrd - Pre-resolved single PRD when prds.length === 1, else undefined.
 * @returns ok(DocId) or err(VALIDATION_ERROR).
 */
function resolveParentId(
  spec: ParsedSpec,
  prds: DocSummary[],
  singlePrd: DocSummary | undefined,
): Result<DocId, LoreError> {
  // Branch 1: 0 PRDs → fail loud (AC-SD-10)
  if (prds.length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "parent_id",
      message:
        `${spec.path}: no PRD in corpus — create one first or use \`lore create spec --parent <slug>\``,
    });
  }

  // Branch 2: exactly 1 PRD → use it unconditionally (AC-SD-7)
  if (singlePrd !== undefined) {
    return ok(singlePrd.id);
  }

  // Branch 3 / 4: ≥2 PRDs — look up by frontmatter parent_title_hint
  if (spec.parent_title_hint !== undefined) {
    const matched = prds.filter((p) => p.title === spec.parent_title_hint);
    if (matched.length === 1 && matched[0] !== undefined) {
      return ok(matched[0].id);
    }
  }

  // Branch 4: no match → VALIDATION_ERROR (AC-SD-9)
  return err({
    code: "VALIDATION_ERROR",
    field: "parent_id",
    message:
      `${spec.path}: multiple PRDs in corpus and frontmatter 'parent: ${spec.parent_title_hint ?? "(none)"}' ` +
      `does not match any PRD title — disambiguate with \`lore create spec --parent <slug>\``,
  });
}

// ─── Body Comparison ─────────────────────────────────────────────────────────

/**
 * Normalize a body string for comparison: convert CRLF → LF, then trim.
 * This avoids false drift reports due to line-ending differences (SPEC-018 §7).
 *
 * @param body - Raw body text from file or corpus.
 */
function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trim();
}

// ─── Corpus Lookup Helpers ───────────────────────────────────────────────────

/**
 * Build a Map<title, DocSummary> from a list of docs.
 * Collisions (two docs with same title) last-writer wins — acceptable for
 * the sync-docs title-match heuristic which assumes unique spec titles.
 *
 * @param docs - Array of corpus DocSummary records.
 */
function buildTitleMap(docs: DocSummary[]): Map<string, DocSummary> {
  const map = new Map<string, DocSummary>();
  for (const doc of docs) {
    map.set(doc.title, doc);
  }
  return map;
}
