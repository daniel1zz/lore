/**
 * ExportDocsService — one-way corpus → disk exporter (inverse of SyncDocsService).
 *
 * Public surface:
 *   - ExportDocsService.exportDocs(opts) — walk all corpus docs, write one .md per doc
 *     under docs/requirements/<type>/, maintain .lore/export-index.json.
 *
 * Invariants:
 *   - Stateless. The only dependency is StoreInterface (no AI, no HTTP).
 *   - Never overwrites a drifted file without --force (v2 deferred per SPEC-021 §8 Q2).
 *   - Idempotent — re-running on unchanged corpus produces 0 created, 0 drifted.
 *   - Topological order — parents always written before their children.
 *   - Per-doc errors do NOT abort the whole run; other docs still process.
 *   - aiProviderService is NEVER called from this service (no-AI boundary).
 *     reason: export-docs is a structural emitter; AI generation is orthogonal.
 *   - Body comparison uses canonicaliseBody from @lore/core (shared with SyncDocsService).
 *     reason: SPEC-021 §4 requires both services to normalise identically for roundtrip parity.
 *
 * Side-effect class: IO (readFileSync, writeFileSync, mkdirSync) + StoreInterface async calls.
 *
 * Source: SPEC-021 §9
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  openSync,
  writeSync,
  closeSync,
  renameSync,
} from "fs";
import { join, dirname } from "path";
import { parse as parseYaml } from "yaml";
import { err, ok, canonicaliseBody, exportIndexSchema, slugify, DOC_TYPE_ROLE_MAP } from "@lore/core";
import type {
  LoreError,
  Result,
  DocType,
  DocRecord,
  LinkRecord,
} from "@lore/core";
import type { ExportIndex } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

// ─── Public Types ──────────────────────────────────────────────────────────────

/**
 * Options for ExportDocsService.exportDocs().
 *
 * @example
 *   const result = await service.exportDocs({ projectDir: "/project", dryRun: false });
 */
export interface ExportDocsOptions {
  /** Absolute path to the project root — parent of both .lore/ and docs/. */
  projectDir: string;
  /**
   * When true, compute and report what would happen but write nothing.
   * Files will appear in report.created without actually being written.
   */
  dryRun: boolean;
  /** Restrict export to one document type. When absent, all types are exported. */
  type?: DocType;
  /**
   * (v2 placeholder) Overwrite drifted files with corpus body.
   * Currently ALWAYS rejected with VALIDATION_ERROR.
   * reason: SPEC-021 §8 Q2 defers --force to v2, mirroring SPEC-018 stance.
   */
  force?: boolean;
}

/**
 * Summary of a single exportDocs() run.
 * All arrays are always present (may be empty). No exceptions cross this boundary.
 */
export interface ExportReport {
  /** File paths created during this run (relative to projectDir). Empty when dryRun=true writes nothing. */
  created: string[];
  /** File paths already present with body matching corpus — skipped cleanly. */
  skipped_clean: string[];
  /** File paths where on-disk body differs from corpus — NOT overwritten (v1 behaviour). */
  drift: string[];
  /** Per-doc error messages that did not abort the overall run. */
  errors: string[];
}

// ─── Human-ID type prefixes ───────────────────────────────────────────────────

/**
 * Maps each DocType to its human-readable ID prefix.
 * Source: SPEC-021 §9.4
 */
const TYPE_PREFIX: Record<DocType, string> = {
  prd: "PRD",
  spec: "SPEC",
  adr: "ADR",
  plan: "PLAN",
  task: "TASK",
  knowledge: "KN",
} as const;

/**
 * Maps each DocType to its subdirectory under docs/requirements/.
 * Source: SPEC-021 §2.1
 */
const TYPE_DIR: Record<DocType, string> = {
  prd: "prd",
  spec: "spec",
  adr: "adr",
  plan: "plan",
  task: "task",
  knowledge: "knowledge",
} as const;

// ─── ExportDocsService ────────────────────────────────────────────────────────

/**
 * Walks all corpus docs and emits one .md file per doc under docs/requirements/<type>/.
 * Maintains .lore/export-index.json for stable human-readable ID assignment.
 *
 * @example
 *   const service = new ExportDocsService(store);
 *   const result = await service.exportDocs({ projectDir: "/project", dryRun: false });
 *   if (result.ok) console.log(result.value.created.length, "files created");
 */
export class ExportDocsService {
  /**
   * @param store - StoreInterface for all corpus read operations.
   */
  constructor(private readonly store: StoreInterface) {}

  /**
   * Export all corpus docs to disk.
   *
   * Algorithm:
   *   Phase 1 — Build/extend export index:
   *     1. Load .lore/export-index.json (create empty if absent).
   *     2. Scan existing *.md files per type directory — parse titles + human IDs.
   *     3. For each corpus doc not in index: match by title to existing file (inherit its ID)
   *        or allocate next sequential number for its type.
   *     4. Write updated index atomically (temp file + rename).
   *
   *   Phase 2 — Write files (topological order):
   *     5. Sort docs so parents come before children (DFS on parent_id chain).
   *     6. For each doc:
   *        a. If file exists at mapping.file_path → compare body (drift check); report/skip.
   *        b. If file absent → build frontmatter, write with O_EXCL; add to created.
   *
   * @param opts - Project root, dry-run flag, optional type filter.
   * @returns ok(ExportReport) always — per-doc errors are inside report.errors, not top-level err().
   * @throws Never — StoreInterface errors propagate as err(LoreError).
   */
  async exportDocs(opts: ExportDocsOptions): Promise<Result<ExportReport, LoreError>> {
    // reason: SPEC-021 §8 Q2 defers --force to v2 (consistent with SPEC-018 stance).
    // Rejecting early ensures callers get a clear message rather than silent no-op.
    if (opts.force === true) {
      return err({
        code: "VALIDATION_ERROR",
        field: "force",
        message: "--force not yet implemented — v2 will overwrite corpus body over file",
      });
    }

    // ── Phase 1: Build / extend the export index ──────────────────────────────
    const indexPath = join(opts.projectDir, ".lore", "export-index.json");
    const docsBaseDir = join(opts.projectDir, "docs", "requirements");

    const docsResult = await this.store.findMany(opts.type ? { type: opts.type } : {});
    if (!docsResult.ok) return docsResult;
    const allDocs = docsResult.value;

    const indexResult = buildOrExtendIndex(indexPath, docsBaseDir, allDocs);
    if (!indexResult.ok) return indexResult;
    const index = indexResult.value;

    // Save index (atomically) before writing any files — all human IDs are now allocated.
    if (!opts.dryRun) {
      const saveResult = saveIndexAtomic(indexPath, index);
      if (!saveResult.ok) return saveResult;
    }

    // ── Phase 2: Topological sort + per-doc export ────────────────────────────
    const { sorted: sortedDocs, cycles } = topoSortDocs(allDocs);
    if (cycles.length > 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "parent_id",
        message: `Cycle detected in parent_id chain involving docs: ${cycles.join(", ")}`,
      });
    }

    const report: ExportReport = {
      created: [],
      skipped_clean: [],
      drift: [],
      errors: [],
    };

    for (const doc of sortedDocs) {
      const mapping = index.mappings[doc.id];
      if (!mapping) {
        // Should never happen after Phase 1, but guard defensively.
        report.errors.push(`${doc.id}: missing index entry after reconcile`);
        continue;
      }

      const absFilePath = join(opts.projectDir, mapping.file_path);
      const dirPath = dirname(absFilePath);

      // Ensure directory exists (idempotent mkdir -p)
      if (!opts.dryRun) {
        try {
          mkdirSync(dirPath, { recursive: true });
        } catch (e) {
          report.errors.push(
            `${mapping.file_path}: cannot create directory — ${e instanceof Error ? e.message : String(e)}`,
          );
          continue;
        }
      }

      if (existsSync(absFilePath)) {
        // File already exists — drift check (SPEC-021 §9.6)
        let fileMd: string;
        try {
          fileMd = readFileSync(absFilePath, "utf8");
        } catch (e) {
          report.errors.push(
            `${mapping.file_path}: cannot read — ${e instanceof Error ? e.message : String(e)}`,
          );
          continue;
        }

        const fileBody = extractBodyFromMd(fileMd);
        const fileNorm = canonicaliseBody(fileBody);
        const corpusNorm = canonicaliseBody(doc.content);

        if (fileNorm === corpusNorm) {
          report.skipped_clean.push(mapping.file_path);
        } else {
          // reason: drift is reported but never auto-resolved in v1 — mirrors SPEC-018 §2.1.
          // --force (v2) will overwrite; until then we preserve the existing file.
          report.drift.push(mapping.file_path);
          process.stderr.write(`⚠ drift: ${mapping.file_path}\n`);
        }
        continue;
      }

      // File does not exist — will create.
      if (opts.dryRun) {
        report.created.push(mapping.file_path);
        continue;
      }

      // Fetch outbound non-parent links for this doc.
      const linksResult = await this.store.findLinks(doc.id, "out");
      const outLinks: LinkRecord[] = linksResult.ok ? linksResult.value : [];

      // Build frontmatter string
      const fmStr = buildFrontmatterString(doc, mapping.human_id, outLinks, index);

      // Canonicalise the corpus body and combine with frontmatter
      const fileContent = fmStr + canonicaliseBody(doc.content);

      // Write with O_EXCL semantics (fail if file appeared between check and write).
      // reason: concurrent exports could both see "file absent" and race to create.
      // O_EXCL ('wx') fails with EEXIST on the second writer — see SPEC-021 §9.7.
      const writeResult = writeFileExclusive(absFilePath, fileContent, mapping.file_path, index, indexPath);
      if (!writeResult.ok) {
        report.errors.push(`${mapping.file_path}: ${writeResult.error.code === "STORE_ERROR" && "message" in writeResult.error ? writeResult.error.message : writeResult.error.code}`);
        continue;
      }

      report.created.push(mapping.file_path);
    }

    return ok(report);
  }
}

// ─── Index Management ─────────────────────────────────────────────────────────

/**
 * Load an existing export index from disk. Returns an empty index if absent or corrupted.
 * Validates the loaded JSON against exportIndexSchema.
 *
 * @param indexPath - Absolute path to .lore/export-index.json.
 * @returns Loaded or fresh ExportIndex (never fails — corrupted index → start fresh).
 */
function loadIndex(indexPath: string): ExportIndex {
  if (!existsSync(indexPath)) {
    return { version: 1, mappings: {} };
  }
  try {
    const raw = readFileSync(indexPath, "utf8");
    const parsed = exportIndexSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    // Corrupted but parseable JSON — start fresh with warning suppressed (non-fatal).
    // reason: corrupted index is rebuilt by reconciliation; no data is lost (files stay on disk).
    process.stderr.write(
      `Warning: .lore/export-index.json failed schema validation — rebuilding from scratch.\n`,
    );
    return { version: 1, mappings: {} };
  } catch {
    process.stderr.write(
      `Warning: .lore/export-index.json unreadable — rebuilding from scratch.\n`,
    );
    return { version: 1, mappings: {} };
  }
}

/**
 * Scan existing *.md files in a type directory.
 * Parses frontmatter to extract human_id (`id:` field) and title for reconcile matching.
 *
 * @param typeDir - Absolute path to docs/requirements/<type>/.
 * @param typeRelPath - Forward-slash path relative to project root, e.g. "docs/requirements/spec".
 * @returns Map of title → { humanId, filePath (project-relative, forward-slash) }.
 */
function scanTypeDirectory(
  typeDir: string,
  typeRelPath: string,
): Map<string, { humanId: string; filePath: string }> {
  const result = new Map<string, { humanId: string; filePath: string }>();
  if (!existsSync(typeDir)) return result;

  let names: string[];
  try {
    // reason: readdirSync without withFileTypes returns string[] per SPEC-018 pattern.
    names = readdirSync(typeDir) as string[];
  } catch {
    return result;
  }

  for (const name of names) {
    if (typeof name !== "string" || !name.endsWith(".md")) continue;
    const absPath = join(typeDir, name);
    try {
      const raw = readFileSync(absPath, "utf8");
      const normalized = raw.replace(/\r\n/g, "\n");
      const match = normalized.match(/^---\n([\s\S]*?)\n---\n/);
      if (!match) continue;
      const fm = parseYaml(match[1] ?? "") as unknown;
      if (!fm || typeof fm !== "object") continue;
      const record = fm as Record<string, unknown>;
      const title = typeof record["title"] === "string" ? record["title"].trim() : "";
      const humanId = typeof record["id"] === "string" ? record["id"].trim() : "";
      if (title && humanId) {
        // Store forward-slash relative path for cross-platform compatibility.
        const filePath = `${typeRelPath}/${name}`;
        result.set(title, { humanId, filePath });
      }
    } catch {
      // Skip unparseable files — they will remain un-indexed.
    }
  }
  return result;
}

/**
 * Extract the maximum sequential number from existing human IDs of a given prefix.
 * Returns 0 if no entries for that prefix exist.
 *
 * @param prefix - Type prefix e.g. "SPEC", "PRD".
 * @param humanIds - All human_id strings to scan.
 */
function maxNumberForPrefix(prefix: string, humanIds: string[]): number {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of humanIds) {
    const m = id.match(re);
    if (m) {
      const n = parseInt(m[1] ?? "0", 10);
      if (n > max) max = n;
    }
  }
  return max;
}

/**
 * Build or extend the export index: allocate human IDs for new corpus docs.
 *
 * Algorithm (SPEC-021 §9.3, §9.4):
 *   1. Load existing index.
 *   2. Scan files per type dir — build title → humanId/filePath map.
 *   3. Seed per-type next-number counters from index + file scan.
 *   4. For each corpus doc not in index:
 *      a. Match by title to scanned file → inherit its ID + filePath.
 *      b. Else: allocate next sequential number, compute new filePath.
 *   5. Return mutated index (caller must save it atomically).
 *
 * @param indexPath - Absolute path to .lore/export-index.json.
 * @param docsBaseDir - Absolute path to docs/requirements/.
 * @param docs - All active corpus docs to reconcile.
 * @returns ok(ExportIndex) with all docs mapped; err on store failure (already handled upstream).
 */
function buildOrExtendIndex(
  indexPath: string,
  docsBaseDir: string,
  docs: DocRecord[],
): Result<ExportIndex, LoreError> {
  const index = loadIndex(indexPath);

  // Collect all existing human IDs from the index for next-number seeding.
  const existingHumanIds = Object.values(index.mappings).map((m) => m.human_id);

  // Per-type next-number counters — seeded from index.
  const typeCounters = new Map<DocType, number>();
  for (const [type, prefix] of Object.entries(TYPE_PREFIX) as [DocType, string][]) {
    const max = maxNumberForPrefix(prefix, existingHumanIds);
    typeCounters.set(type, max);
  }

  // Scan each type directory that appears in the doc list to build title→humanId maps.
  const typeSet = new Set<DocType>(docs.map((d) => d.type));
  const titleMaps = new Map<DocType, Map<string, { humanId: string; filePath: string }>>();

  for (const typeName of typeSet) {
    const typeDir = join(docsBaseDir, TYPE_DIR[typeName]);
    const typeRelPath = `docs/requirements/${TYPE_DIR[typeName]}`;
    const titleMap = scanTypeDirectory(typeDir, typeRelPath);
    titleMaps.set(typeName, titleMap);

    // Also seed counters from scanned files (in case index is absent/partial).
    const fileHumanIds = [...titleMap.values()].map((v) => v.humanId);
    const prefix = TYPE_PREFIX[typeName];
    const maxFromFiles = maxNumberForPrefix(prefix, fileHumanIds);
    const current = typeCounters.get(typeName) ?? 0;
    if (maxFromFiles > current) typeCounters.set(typeName, maxFromFiles);
  }

  // Assign human IDs to corpus docs not yet in the index.
  for (const doc of docs) {
    if (index.mappings[doc.id] !== undefined) continue; // already mapped

    const typeTitleMap = titleMaps.get(doc.type);

    // Try title-match to an existing file (index rebuild path, SPEC-021 §9.3).
    const fileMatch = typeTitleMap?.get(doc.title);
    if (fileMatch) {
      index.mappings[doc.id] = {
        human_id: fileMatch.humanId,
        file_path: fileMatch.filePath,
      };
      continue;
    }

    // Allocate next sequential number for this type.
    const prefix = TYPE_PREFIX[doc.type];
    const current = typeCounters.get(doc.type) ?? 0;
    const next = current + 1;
    typeCounters.set(doc.type, next);
    const humanId = `${prefix}-${String(next).padStart(3, "0")}`;

    // Compute file name from human ID + slugified title (minus type prefix).
    // reason: slugify() produces "{type}-{kebab}" — strip the type prefix to get
    // just the kebab portion for the filename, keeping SPEC-025 prefix only from humanId.
    const fullSlug = slugify(doc.type, doc.title);
    const typePrefix = `${doc.type}-`;
    const kebabPart = fullSlug.startsWith(typePrefix)
      ? fullSlug.slice(typePrefix.length)
      : fullSlug;
    // Limit filename length to avoid filesystem issues.
    const truncatedKebab = kebabPart.slice(0, 50).replace(/-+$/, "");
    const fileName = `${humanId}-${truncatedKebab}.md`;
    const filePath = `docs/requirements/${TYPE_DIR[doc.type]}/${fileName}`;

    index.mappings[doc.id] = { human_id: humanId, file_path: filePath };
  }

  return ok(index);
}

/**
 * Write the export index atomically: write to a temp file then rename.
 * reason: Direct writeFileSync is not atomic — a crash mid-write corrupts the index.
 * Temp + rename (POSIX rename(2)) is atomic on the same filesystem.
 * Source: SPEC-021 §9.7
 *
 * @param indexPath - Final path for .lore/export-index.json.
 * @param index - Index to serialise.
 */
function saveIndexAtomic(indexPath: string, index: ExportIndex): Result<void, LoreError> {
  const indexDir = dirname(indexPath);
  try {
    if (!existsSync(indexDir)) {
      mkdirSync(indexDir, { recursive: true });
    }
    const tmpPath = `${indexPath}.tmp.${Date.now()}`;
    writeFileSync(tmpPath, JSON.stringify(index, null, 2) + "\n", "utf8");
    renameSync(tmpPath, indexPath);
    return ok(undefined);
  } catch (e) {
    return err({
      code: "STORE_ERROR",
      message: `Failed to write export-index.json: ${e instanceof Error ? e.message : String(e)}`,
      ...(e instanceof Error ? { cause: e } : {}),
    });
  }
}

// ─── Topological Sort ─────────────────────────────────────────────────────────

/**
 * Sort docs so each doc appears after its parent (DFS post-order traversal).
 * Detects cycles defensively (should never occur — CorpusService.link prevents them).
 *
 * @param docs - All docs to sort (may be filtered by type, so parent may be absent).
 * @returns { sorted: DocRecord[], cycles: string[] } — cycle entries are doc IDs.
 */
function topoSortDocs(docs: DocRecord[]): { sorted: DocRecord[]; cycles: string[] } {
  const idToDoc = new Map<string, DocRecord>(docs.map((d) => [d.id, d]));
  const sorted: DocRecord[] = [];
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const cycles: string[] = [];

  function visit(doc: DocRecord): void {
    if (visited.has(doc.id)) return;
    if (inProgress.has(doc.id)) {
      // reason: cycle in parent_id chain — should never happen (CorpusService.link
      // enforces acyclicity), but we guard defensively per SPEC-021 §9.5.
      cycles.push(doc.id);
      return;
    }

    inProgress.add(doc.id);

    // Visit parent first if it's in the filtered set (may be absent if --type filter applied).
    if (doc.parent_id !== null) {
      const parent = idToDoc.get(doc.parent_id);
      if (parent !== undefined) {
        visit(parent);
      }
    }

    inProgress.delete(doc.id);
    visited.add(doc.id);
    sorted.push(doc);
  }

  for (const doc of docs) {
    visit(doc);
  }

  return { sorted, cycles };
}

// ─── Frontmatter Emission ─────────────────────────────────────────────────────

/**
 * Extract the body section from a .md file (everything after the closing `---`).
 * Returns the full file content as body if no frontmatter is found.
 *
 * @param mdContent - Full file content.
 * @returns Body string (may have leading whitespace — caller uses canonicaliseBody).
 */
function extractBodyFromMd(mdContent: string): string {
  const normalized = mdContent.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? (match[1] ?? "") : normalized;
}

/**
 * Build the YAML frontmatter string for a corpus doc.
 *
 * Frontmatter shape (SPEC-021 §9.2):
 *   id, type, role, title, status, priority, [phase], created, updated, tags,
 *   [parent (human ID)], [plan (human ID, for tasks)], [links], [phases (for plans)]
 *
 * @param doc - Full DocRecord from corpus.
 * @param humanId - Human-readable ID (e.g. "SPEC-025").
 * @param outLinks - Outbound non-parent links from store.findLinks(doc.id, "out").
 * @param index - Export index for resolving linked doc IDs to human IDs.
 * @returns Frontmatter string including `---\n...\n---\n` delimiters.
 */
function buildFrontmatterString(
  doc: DocRecord,
  humanId: string,
  outLinks: LinkRecord[],
  index: ExportIndex,
): string {
  const created = doc.created_at.split("T")[0] ?? doc.created_at;
  const updated = doc.updated_at.split("T")[0] ?? doc.updated_at;

  // Resolve parent ULID → human ID (if available in index).
  const parentHumanId =
    doc.parent_id !== null ? index.mappings[doc.parent_id]?.human_id : undefined;

  // Resolve plan_id for task docs → human ID (SPEC-021 §8 Q5).
  const planHumanId =
    doc.type === "task" && typeof doc.extra["plan_id"] === "string"
      ? index.mappings[doc.extra["plan_id"]]?.human_id
      : undefined;

  // Extra.phase string (legacy singular phase field, used by specs/tasks as label).
  const phaseStr =
    typeof doc.extra["phase"] === "string" ? doc.extra["phase"] : undefined;

  // Plans may declare an array of phases (SPEC-023).
  const phasesArr =
    doc.type === "plan" && Array.isArray(doc.extra["phases"]) && doc.extra["phases"].length > 0
      ? (doc.extra["phases"] as Array<{ name: string; description?: string }>)
      : undefined;

  // Outbound non-parent links — resolve to human IDs (skip unresolvable ones).
  const links = outLinks
    .filter((l) => l.link_type !== "parent")
    .flatMap((l) => {
      const linkedHumanId = index.mappings[l.to_id]?.human_id;
      if (!linkedHumanId) return []; // linked doc not in index (soft-deleted or filtered out)
      return [{ id: linkedHumanId, type: l.link_type }];
    });

  let fm = "---\n";
  fm += `id: ${humanId}\n`;
  fm += `type: ${doc.type}\n`;
  fm += `role: ${DOC_TYPE_ROLE_MAP[doc.type]}\n`;
  // reason: title may contain special YAML characters (colons, dashes) — always double-quote.
  fm += `title: "${escapeYamlString(doc.title)}"\n`;
  fm += `status: ${doc.status}\n`;
  fm += `priority: ${doc.priority}\n`;
  if (phaseStr !== undefined) {
    fm += `phase: ${phaseStr}\n`;
  }
  fm += `created: ${created}\n`;
  fm += `updated: ${updated}\n`;
  // Tags use YAML flow style [...] to match the existing spec file convention.
  if (doc.tags.length > 0) {
    fm += `tags: [${doc.tags.map(escapeYamlString).join(", ")}]\n`;
  } else {
    fm += `tags: []\n`;
  }
  if (parentHumanId !== undefined) {
    fm += `parent: ${parentHumanId}\n`;
  }
  if (planHumanId !== undefined) {
    fm += `plan: ${planHumanId}\n`;
  }
  if (phasesArr !== undefined) {
    fm += `phases:\n`;
    for (const phase of phasesArr) {
      if (phase.description) {
        fm += `  - {name: "${escapeYamlString(phase.name)}", description: "${escapeYamlString(phase.description)}"}\n`;
      } else {
        fm += `  - {name: "${escapeYamlString(phase.name)}"}\n`;
      }
    }
  }
  if (links.length > 0) {
    fm += `links:\n`;
    for (const link of links) {
      fm += `  - {id: ${link.id}, type: ${link.type}}\n`;
    }
  }
  fm += "---\n";
  return fm;
}

/**
 * Escape a string value for safe embedding inside double-quoted YAML scalars.
 * Only escapes backslash and double-quote (the two characters that need escaping in "...").
 *
 * @param s - Raw string value.
 * @returns String safe for use inside `"..."` in YAML.
 */
function escapeYamlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ─── File Write ────────────────────────────────────────────────────────────────

/**
 * Write file using O_EXCL flag to detect concurrent-writer race (SPEC-021 §9.7).
 *
 * If EEXIST (another process already wrote the file between our check and this write):
 *   - Read the newly appeared file and do a drift check instead of overwriting.
 *   - Report the outcome in the return value via a special sentinel.
 * If any other error: return err(STORE_ERROR).
 *
 * @param absFilePath - Absolute path to write.
 * @param content - Complete file content (frontmatter + body).
 * @param relFilePath - Relative path for error messages.
 * @param index - Index (used for potential EEXIST retry, currently unused in v1).
 * @param indexPath - Index path (unused in v1 single-retry logic).
 * @returns ok(undefined) on success; err(STORE_ERROR) on failure.
 */
function writeFileExclusive(
  absFilePath: string,
  content: string,
  relFilePath: string,
  _index: ExportIndex,
  _indexPath: string,
): Result<void, LoreError> {
  let fd: number;
  try {
    // 'wx' = O_WRONLY | O_CREAT | O_EXCL — fails with EEXIST if file appeared concurrently.
    fd = openSync(absFilePath, "wx");
  } catch (e) {
    const errno = (e as NodeJS.ErrnoException).code;
    if (errno === "EEXIST") {
      // Concurrent writer created the file — treat as "appeared between check and write".
      // Report as STORE_ERROR with a clear message so the caller can distinguish this case.
      return err({
        code: "STORE_ERROR",
        message: `concurrent write conflict on ${relFilePath} — retry export-docs`,
        ...(e instanceof Error ? { cause: e } : {}),
      });
    }
    return err({
      code: "STORE_ERROR",
      message: `cannot open ${relFilePath} for writing: ${e instanceof Error ? e.message : String(e)}`,
      ...(e instanceof Error ? { cause: e } : {}),
    });
  }

  try {
    writeSync(fd, content, 0, "utf8");
  } catch (e) {
    try { closeSync(fd); } catch { /* ignore close error */ }
    return err({
      code: "STORE_ERROR",
      message: `write failed for ${relFilePath}: ${e instanceof Error ? e.message : String(e)}`,
      ...(e instanceof Error ? { cause: e } : {}),
    });
  }

  try {
    closeSync(fd);
  } catch (e) {
    return err({
      code: "STORE_ERROR",
      message: `close failed for ${relFilePath}: ${e instanceof Error ? e.message : String(e)}`,
      ...(e instanceof Error ? { cause: e } : {}),
    });
  }

  return ok(undefined);
}
