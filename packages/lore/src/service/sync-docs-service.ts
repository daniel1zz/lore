/**
 * SyncDocsService — one-way file → corpus reconciler for spec documents.
 *
 * Public surface:
 *   - SyncDocsService.run(opts) — scan a directory of *.md spec files, compare
 *     against the corpus by title, create missing specs, report drift.
 *
 * Invariants:
 *   - A NEW spec is created structured (BR-1528): the file's front matter carries `fields:` (and `dimensions:`, optional
 *     `spec_kind:`), its markdown body must be empty because the body is rendered from the fields, and a file with no
 *     `fields:` is reported as a per-file error (loud, nothing created) instead of being imported as a free body. A file
 *     whose title already matches a corpus spec is compared as before (body vs body; fields vs fields when it has fields).
 *   - Stateless. The only dependency is CorpusService (no AI, no direct store access).
 *   - Never overwrites corpus content — drift is reported, not auto-resolved.
 *   - Idempotent — re-running on the same corpus produces 0 creates, only matches.
 *   - Per-file errors do NOT abort the whole run; other files still process.
 *   - aiProviderService is NEVER called from this service (no-AI boundary).
 *     reason: sync-docs is a structural reconciler; AI generation is orthogonal.
 *     AC-SD-15 enforces this at test time via grep.
 *   - Created specs take NO parent (BR-789, BR-2): a spec relates to the product trees through its
 *     criteria's citations, never through a PRD parent. A frontmatter `parent:` is ignored, with one
 *     stderr note per run — it is never resolved, never an error.
 *   - Body comparison uses canonicaliseBody from @lore/core (shared with ExportDocsService).
 *     reason: SPEC-021 §4 requires both services to normalise identically for roundtrip parity.
 *
 * Side-effect class: IO (readdirSync, readFileSync) + CorpusService async calls.
 *
 * Source: SPEC-018 §3
 */

import { discardWarnings, type WarnSink } from "./warn-sink.js";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { diffChars } from "diff";
import { err, ok, canonicaliseBody } from "@lore/core";
import type { LoreError, Priority, Result } from "@lore/core";
import type { DocSummary } from "@lore/core";
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
  /** Where the one-line "ignoring frontmatter parent" note goes (the run's stderr); absent -> not printed. */
  warn?: WarnSink;
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
  /** Per-file parse/create errors. Other files still processed. */
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
   * Frontmatter `parent:` string. Carried only so the run can say it was ignored (a spec takes no
   * parent, BR-2); never used to resolve anything. Undefined when the frontmatter has no `parent` key.
   */
  ignored_parent_hint: string | undefined;
  /** Validated priority; falls back to "medium" if unknown. */
  priority: Priority;
  /** Frontmatter tags array; falls back to [] if absent. */
  tags: string[];
  /**
   * Frontmatter `fields:` (BR-1528): the spec's structured content, validated by the create path against the approved
   * template of its kind. Absent for a legacy free-body file, which is no longer created (the file is reported).
   */
  fields: Record<string, unknown> | undefined;
  /** Frontmatter `dimensions:` answers; `[]` when the file declares `fields` but no dimensions. */
  dimensions: unknown[];
  /** Frontmatter `spec_kind:` (selects the template's kind); absent = the create path's default kind. */
  specKind: string | undefined;
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
   *   3. Fetch all specs from corpus once (pre-caching).
   *   4. For each ParsedSpec: match by title.
   *      If matched → fetch full doc for content → compare body (drift check).
   *      If unmatched → create with no parent (unless dryRun) — BR-789.
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

    // ── Step 2: Fetch corpus once — cache the spec list ──────────────────────
    const specListResult = await this.corpus.list({ type: "spec" });
    if (!specListResult.ok) return specListResult;

    // Build lookup map: title → corpus DocSummary
    // reason: title-match dedup is the v1 identity strategy per SPEC-018 §3.1.
    const titleToCorpusSpec = buildTitleMap(specListResult.value.docs);
    let ignoredParentNoted = false;

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
        const existingDoc = getResult.value.doc;
        // reason: a structured file's body is empty by contract (the corpus body is rendered), so the comparison is
        // fields against fields: the stored `extra.fields` against the file's, as stable JSON.
        const existingContent = spec.fields === undefined ? existingDoc.content : stableJson(existingDoc.extra["fields"] ?? null);

        const fileNormalized = canonicaliseBody(spec.fields === undefined ? spec.body : stableJson(spec.fields));
        const corpusNormalized = canonicaliseBody(existingContent);

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

      // No title match — this spec needs to be created, with NO parent (BR-789, BR-2).
      // A frontmatter `parent:` is a leftover of the retired PRD-parent model: say so once, then ignore it.
      if (!ignoredParentNoted && spec.ignored_parent_hint !== undefined) {
        (opts.warn ?? discardWarnings)(
          `note: ignoring frontmatter parent "${spec.ignored_parent_hint}" — a spec takes no parent; ` +
            "it belongs to the product trees through its criteria's citations (`lore ac cite`)",
        );
        ignoredParentNoted = true;
      }

      // reason: the refusal comes BEFORE the dry-run report, so a dry run never lists as "would create" a file the real run refuses.
      if (spec.fields === undefined || spec.body.trim() !== "") {
        fileErrors.push({
          file: spec.path,
          error:
            spec.fields === undefined
              ? "create failed: a new spec is created structured (BR-1528) but the file has no `fields:` in its front matter — " +
                "add `fields:` and `dimensions:` (`lore template show spec --kind <kind> --blank` prints the skeleton)"
              : "create failed: the file declares `fields:` so its text is rendered from them; its markdown body must be empty",
        });
        continue;
      }

      if (opts.dryRun) {
        // Dry-run: report what would be created but write nothing
        created.push({ file: spec.path, slug: "(dry-run)" });
        continue;
      }

      const createResult = await this.corpus.create({
        type: "spec",
        title: spec.title,
        priority: spec.priority,
        tags: spec.tags,
        extra: { ...(spec.specKind !== undefined ? { spec_kind: spec.specKind } : {}), fields: spec.fields, dimensions: spec.dimensions },
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
      rule: "BR-791",
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
      rule: "BR-791",
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
      rule: "BR-791",
    });
  }

  if (fm === null || typeof fm !== "object") {
    return err({
      code: "VALIDATION_ERROR",
      field: "frontmatter",
      message: `${absPath}: frontmatter is not a YAML object`,
      rule: "BR-791",
    });
  }

  const record = fm as Record<string, unknown>;

  // AC-SD-12: type must be "spec"
  if (record["type"] !== "spec") {
    return err({
      code: "VALIDATION_ERROR",
      field: "type",
      message: `${absPath}: type='${String(record["type"])}' (expected 'spec')`,
      rule: "BR-791",
    });
  }

  const title = typeof record["title"] === "string" ? record["title"].trim() : "";
  if (!title) {
    return err({
      code: "VALIDATION_ERROR",
      field: "title",
      message: `${absPath}: missing or empty 'title' in frontmatter`,
      rule: "BR-791",
    });
  }

  const rawPriority = typeof record["priority"] === "string" ? record["priority"] : "";
  const priority: Priority = VALID_PRIORITIES.includes(rawPriority)
    ? (rawPriority as Priority)
    : "medium";

  const tags: string[] = Array.isArray(record["tags"])
    ? record["tags"].filter((v): v is string => typeof v === "string")
    : [];

  const ignored_parent_hint: string | undefined =
    typeof record["parent"] === "string" ? record["parent"] : undefined;

  const fieldsRaw = record["fields"];
  if (fieldsRaw !== undefined && (fieldsRaw === null || typeof fieldsRaw !== "object" || Array.isArray(fieldsRaw))) {
    return err({ code: "VALIDATION_ERROR", field: "fields", message: `${absPath}: frontmatter 'fields' must be a YAML mapping`, rule: "BR-791" });
  }
  const dimensionsRaw = record["dimensions"];
  if (dimensionsRaw !== undefined && !Array.isArray(dimensionsRaw)) {
    return err({ code: "VALIDATION_ERROR", field: "dimensions", message: `${absPath}: frontmatter 'dimensions' must be a YAML list`, rule: "BR-791" });
  }

  return ok({
    path: absPath,
    title,
    body: bodyRaw.trimStart(),
    ignored_parent_hint,
    priority,
    tags,
    fields: fieldsRaw as Record<string, unknown> | undefined,
    dimensions: (dimensionsRaw as unknown[] | undefined) ?? [],
    specKind: typeof record["spec_kind"] === "string" ? record["spec_kind"] : undefined,
  });
}

/** JSON with object keys sorted, so two equal field trees compare equal whatever their key order. */
function stableJson(value: unknown): string {
  const sorted = (node: unknown): unknown =>
    Array.isArray(node)
      ? node.map(sorted)
      : node !== null && typeof node === "object"
        ? Object.fromEntries(Object.entries(node as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]))
        : node;
  return JSON.stringify(sorted(value), null, 2);
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
