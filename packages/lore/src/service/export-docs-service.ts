/**
 * ExportDocsService — one-way corpus → disk exporter (inverse of SyncDocsService).
 *
 * Public surface:
 *   - ExportDocsService.exportDocs(opts) — walk all corpus docs, write one .md per doc
 *     under docs/requirements/<type>/, maintain .lore/export-index.json.
 *
 * Invariants:
 *   - Stateless. The only dependency is StoreInterface (no AI, no HTTP).
 *   - Never overwrites a drifted file unless the caller passes `force: true` (SPEC-021
 *     Amendment A2 — implemented; previously deferred to "v2" per SPEC-021 §8 Q2). With
 *     `force: true`, a drifted file is rewritten with the CURRENT expected content
 *     (frontmatter regenerated + the same resolved body used for the drift comparison)
 *     and reported in `report.overwritten`, never in `report.drift`.
 *   - Idempotent — re-running on unchanged corpus produces 0 created, 0 drifted.
 *   - Topological order — parents always written before their children.
 *   - Per-doc errors do NOT abort the whole run; other docs still process.
 *   - aiProviderService is NEVER called from this service (no-AI boundary).
 *     reason: export-docs is a structural emitter; AI generation is orthogonal.
 *   - Body comparison uses canonicaliseBody from @lore/core (shared with SyncDocsService).
 *     reason: SPEC-021 §4 requires both services to normalise identically for roundtrip parity.
 *   - Index allocation is collision-safe against duplicate corpus titles.
 *     reason: CorpusService dedupes `slug` only (slugifyWithCollision), never `title` — two
 *     docs may legitimately share the same title. buildOrExtendIndex's title-match reconcile
 *     path (index rebuild after a missing/corrupted index.json) MUST NOT match a file_path
 *     already claimed by a different doc id in this reconcile pass (tracked via usedFilePaths);
 *     sequential fallback allocation dedupes its computed file_path the same way (-2, -3, ...
 *     suffix, mirroring slugifyWithCollision), fail-loud after 999 attempts. A prior version of
 *     this file lacked the usedFilePaths guard, letting a same-titled doc silently inherit an
 *     unrelated doc's human_id + file_path (SPEC-021 export-collision incident).
 *   - New-allocation human_ids honor a title-declared number before falling back to the
 *     sequential counter (SPEC-021 Amendment A1). reason: a prior incident allocated a doc
 *     titled "SPEC-035 — …" the id SPEC-033 because allocation ignored the number already
 *     embedded in the title. `usedHumanIds` (mirrors usedFilePaths) tracks every id already
 *     claimed — by an existing mapping or an earlier allocation this pass — so a title-claim
 *     can never collide, and the sequential fallback skips any number the set already holds.
 *     Title-match reconcile (the path above) and existing index mappings are untouched by
 *     this amendment; it applies only to the new-allocation branch.
 *   - Corrupted indexes self-heal. If .lore/export-index.json already contains two doc ids
 *     mapped to the same file_path (e.g. written by the bug above, or hand-edited), the next
 *     export run detects it, keeps exactly one canonical owner (content match, else earliest
 *     created_at), strips the losing mapping(s) so they get freshly reallocated, and reports
 *     what was repaired via ExportReport.repaired — never a silent skip or data loss.
 *   - MDX placeholders are spliced into the written body via the injected `resolveDocBody`
 *     callback (SPEC-032 §3.3 AC-4), NOT left as raw `<ChildrenOf />` tags in git.
 *     reason: ExportDocsService must not import OutlineService (services never cross-import —
 *     see service/CLAUDE.md "no cross-service calls"); app.ts (the composition root) wires
 *     `resolveDocBody` as `(doc) => outlineService.resolve(doc).then(renderResolvedToMarkdown)`.
 *     CRITICAL — the SAME resolveDocBody(doc) output is used for BOTH the drift comparison
 *     AND the on-write body. Comparing raw doc.content against an on-disk file that was
 *     written spliced (or vice versa) would make any doc with a whitelisted placeholder
 *     report PERMANENT false drift every run — canonicaliseBody alone cannot catch this
 *     because the two sides would never converge no matter how many times you export.
 *     This means drift on a placeholder-bearing doc is now always a TRUE positive: the
 *     on-disk file is a STALE PROJECTION of the doc's CURRENT children/links (e.g. a child
 *     was added since the last export) — never a phantom comparison-basis mismatch. It is
 *     indistinguishable, from inside this service, from a hand-edited file; `force: true`
 *     resolves either case the same way (overwrite with the current projection), which is
 *     why it stays an explicit opt-in rather than an automatic refresh.
 *   - The SPEC-043 D4 invalidation banner is prepended to `resolveDocBody`'s output
 *     directly in THIS file (`resolveValidityBanner`, imported as a standalone
 *     function from `./outline-service.js` — NOT the `OutlineService` class; T1's own
 *     JSDoc on that function names "ExportDocsService's written body" as a sanctioned
 *     direct caller, same tier as CLI `get`). This does NOT reopen the `ResolveDocBody`
 *     injection seam above — `this.store` is already a constructor dependency of this
 *     service, so no new dependency is introduced. The banner is folded into
 *     `resolvedBody` ONCE, before both the drift comparison and the on-write content,
 *     preserving the "same value both sides" invariant this module already enforces
 *     for MDX splicing.
 *
 * Side-effect class: IO (readFileSync, writeFileSync, mkdirSync) + StoreInterface async calls
 *   + resolveDocBody (itself store-backed via OutlineService.resolve, injected not imported).
 *
 * Source: SPEC-021 §9, SPEC-032 §3.3
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  openSync,
  writeSync,
  closeSync,
  renameSync,
} from "fs";
import { join, dirname, basename } from "path";
import { parse as parseYaml } from "yaml";
import {
  err,
  ok,
  canonicaliseBody,
  exportIndexSchema,
  slugify,
  DOC_TYPE_ROLE_MAP,
  splitFrontmatter,
} from "@lore/core";
// reason: transliterateCjk (SPEC-066 D1) is Node-only-subpath-gated purely for the
// browser-safety barrel-isolation invariant (packages/core/src/CLAUDE.md) — this
// service file is always server-side, same precedent config-service.ts already set.
import { transliterateCjk } from "@lore/core/node";
import type {
  LoreError,
  Result,
  DocType,
  DocRecord,
  LinkRecord,
} from "@lore/core";
import type { ExportIndex } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveValidityBanner } from "./outline-service.js";
import { walkFiles } from "./fs-walk.js";

/** Time seam (SPEC-043 D3/D4 convention) — never `Date.now()` read directly. */
const defaultNow = (): string => new Date().toISOString();

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
   * Overwrite drifted files with the CURRENT expected content (regenerated frontmatter +
   * the same resolved body used for the drift comparison). Files with no drift are
   * unaffected (skipped_clean as usual); files that don't exist yet are still created
   * normally. Overwritten paths are reported in `report.overwritten`, never `report.drift`.
   * reason: SPEC-021 Amendment A2 — implements the flag `export-docs --help` already
   * declared and the drift warning already promised, superseding the SPEC-021 §8 Q2 /
   * SPEC-018-mirrored "deferred to v2" stance.
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
  /**
   * File paths where on-disk body differs from the current expected content and were
   * NOT overwritten because `force` was not passed. Empty when `force: true` — those
   * paths are reported in `overwritten` instead.
   */
  drift: string[];
  /**
   * File paths that differed from the current expected content and WERE overwritten
   * because the caller passed `force: true` (SPEC-021 Amendment A2). Empty unless
   * `force: true`. Under `dryRun: true`, reports what would be overwritten without
   * writing anything (mirrors `created`'s dry-run semantics).
   */
  overwritten: string[];
  /** Per-doc error messages that did not abort the overall run. */
  errors: string[];
  /**
   * Human-readable log of index self-heal repairs performed this run (empty when the index
   * was already consistent). Each entry names the doc id that was stripped of its (corrupted,
   * collided) mapping and reallocated a fresh human_id + file_path. Never silent.
   */
  repaired: string[];
}

/**
 * Resolves one document's exportable body — splicing MDX placeholders into
 * deterministic markdown when present, or returning the content unchanged when not.
 *
 * Injected rather than imported: ExportDocsService must not import OutlineService
 * directly (services never cross-import each other — service/CLAUDE.md). The
 * composition root (app.ts) wires the real implementation as
 * `(doc) => outlineService.resolve(doc).then(r => r.ok ? ok(renderResolvedToMarkdown(r.value)) : r)`.
 *
 * @param doc - Full DocRecord to resolve a body for.
 * @returns ok(markdown body) or a propagated store error from resolution.
 */
export type ResolveDocBody = (doc: DocRecord) => Promise<Result<string, LoreError>>;

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
  // SPEC-056 T4 — "phase" registered as a real DocType (compile-forced entry;
  // export-docs support for phase docs is a later task's scope).
  phase: "PHASE",
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
  // SPEC-056 T4 — see TYPE_PREFIX's phase entry above for the same rationale.
  phase: "phase",
} as const;

// ─── ExportDocsService ────────────────────────────────────────────────────────

/**
 * Walks all corpus docs and emits one .md file per doc under docs/requirements/<type>/.
 * Maintains .lore/export-index.json for stable human-readable ID assignment.
 *
 * @example
 *   const service = new ExportDocsService(store, resolveDocBody);
 *   const result = await service.exportDocs({ projectDir: "/project", dryRun: false });
 *   if (result.ok) console.log(result.value.created.length, "files created");
 */
export class ExportDocsService {
  /**
   * @param store - StoreInterface for all corpus read operations.
   * @param resolveDocBody - Splices MDX placeholders into a doc's body (SPEC-032 §3.3).
   *   Injected by the composition root (app.ts) — see ResolveDocBody's JSDoc for why this
   *   isn't a direct OutlineService import.
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly resolveDocBody: ResolveDocBody,
  ) {}

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
   *        a. If file exists at mapping.file_path → compare body (drift check).
   *           - Match → skipped_clean.
   *           - Differ, no `opts.force` → drift (file untouched).
   *           - Differ, `opts.force: true` → rebuild frontmatter + body, overwrite in
   *             place, report in `overwritten` (SPEC-021 Amendment A2).
   *        b. If file absent → build frontmatter, write with O_EXCL; add to created.
   *
   * @param opts - Project root, dry-run flag, optional type filter, optional force-overwrite.
   * @param now - Time seam (SPEC-043 D3/D4 convention) — drives the invalidation banner
   *   prepended to knowledge/adr bodies below; defaults to `() => new Date().toISOString()`.
   * @returns ok(ExportReport) always — per-doc errors are inside report.errors, not top-level err().
   * @throws Never — StoreInterface errors propagate as err(LoreError).
   */
  async exportDocs(
    opts: ExportDocsOptions,
    now: () => string = defaultNow,
  ): Promise<Result<ExportReport, LoreError>> {
    // ── Phase 1: Build / extend the export index ──────────────────────────────
    const indexPath = join(opts.projectDir, ".lore", "export-index.json");
    const docsBaseDir = join(opts.projectDir, "docs", "requirements");

    const docsResult = await this.store.findMany(opts.type ? { type: opts.type } : {});
    if (!docsResult.ok) return docsResult;
    const allDocs = docsResult.value;

    const indexResult = buildOrExtendIndex(indexPath, docsBaseDir, allDocs, opts.projectDir);
    if (!indexResult.ok) return indexResult;
    const { index, repaired } = indexResult.value;

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
      overwritten: [],
      errors: [],
      repaired,
    };

    // Builds the complete file content (frontmatter + spliced body) for a doc — shared by
    // BOTH the "file absent → create" path and the "drift + force → overwrite" path, so a
    // force-overwrite regenerates frontmatter (title/status/tags/links may also have
    // changed) rather than only patching the body.
    const buildFileContent = async (doc: DocRecord, resolvedBody: string): Promise<string> => {
      const mapping = index.mappings[doc.id]!;
      const linksResult = await this.store.findLinks(doc.id, "out");
      const outLinks: LinkRecord[] = linksResult.ok ? linksResult.value : [];
      const fmStr = buildFrontmatterString(doc, mapping.human_id, outLinks, index);
      return fmStr + canonicaliseBody(resolvedBody);
    };

    const nowIso = now();

    for (const doc of sortedDocs) {
      const mapping = index.mappings[doc.id];
      if (!mapping) {
        // Should never happen after Phase 1, but guard defensively.
        report.errors.push(`${doc.id}: missing index entry after reconcile`);
        continue;
      }

      // Splice MDX placeholders (SPEC-032 §3.3 AC-4) — the SAME resolved body is used
      // below for BOTH the drift comparison and the on-write content. Using raw
      // doc.content for one side and the spliced body for the other would make any
      // placeholder-bearing doc report permanent false drift (see module header).
      const bodyResult = await this.resolveDocBody(doc);
      if (!bodyResult.ok) {
        report.errors.push(`${doc.id}: MDX placeholder resolution failed — ${bodyResult.error.code}`);
        continue;
      }
      // SPEC-043 D4 — prepend the invalidation banner when `doc` is currently
      // invalidated (the SAME shared renderer CLI `get`/`lore feed` call, T2 wiring
      // site 2/3). Computed ONCE here and folded into `resolvedBody` BEFORE both the
      // drift comparison below and the on-write content — never a second, divergent
      // computation for either side (same critical invariant as the MDX splice above).
      const banner = await resolveValidityBanner(this.store, doc, nowIso);
      const resolvedBody = banner !== undefined ? `${banner}\n\n${bodyResult.value}` : bodyResult.value;

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
        const corpusNorm = canonicaliseBody(resolvedBody);

        if (fileNorm === corpusNorm) {
          report.skipped_clean.push(mapping.file_path);
          continue;
        }

        // Drift: on-disk body no longer matches the current expected content — either a
        // hand edit, or (for placeholder-bearing docs) a stale projection now that
        // referenced children/links changed (see module header). Without force, preserve
        // the file untouched (reason: never auto-resolved without explicit opt-in).
        if (!opts.force) {
          report.drift.push(mapping.file_path);
          process.stderr.write(`⚠ drift: ${mapping.file_path}\n`);
          continue;
        }

        // force: true — overwrite with the current expected content (SPEC-021 Amendment A2).
        if (opts.dryRun) {
          report.overwritten.push(mapping.file_path);
          continue;
        }
        try {
          const fileContent = await buildFileContent(doc, resolvedBody);
          writeFileSync(absFilePath, fileContent, "utf8");
        } catch (e) {
          report.errors.push(
            `${mapping.file_path}: force-overwrite failed — ${e instanceof Error ? e.message : String(e)}`,
          );
          continue;
        }
        report.overwritten.push(mapping.file_path);
        continue;
      }

      // File does not exist — will create.
      if (opts.dryRun) {
        report.created.push(mapping.file_path);
        continue;
      }

      const fileContent = await buildFileContent(doc, resolvedBody);

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

  let absPaths: string[];
  try {
    // reason: non-recursive — SPEC-018 scans one type directory, not its subtree.
    // "skip" mirrors the original's catch-and-return-empty on an unreadable typeDir.
    absPaths = walkFiles(typeDir, { extensions: [".md"], recursive: false, onError: "skip" });
  } catch {
    return result;
  }

  for (const absPath of absPaths) {
    const name = basename(absPath);
    try {
      const raw = readFileSync(absPath, "utf8");
      const normalized = raw.replace(/\r\n/g, "\n");
      const split = splitFrontmatter(normalized, "strict");
      if (!split.ok) continue;
      const fm = parseYaml(split.frontmatter) as unknown;
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
 * Algorithm (SPEC-021 §9.3, §9.4; Amendment A1 for step 5b):
 *   1. Load existing index.
 *   2. Self-heal: repair any (human_id, file_path) collision between two different
 *      doc ids already in the index (see repairCollisions) — logged, never silent.
 *   3. Scan files per type dir — build title → humanId/filePath map.
 *   4. Seed per-type next-number counters from index + file scan.
 *   5. For each corpus doc not in index:
 *      a. Match by title to scanned file → inherit its ID + filePath, UNLESS that
 *         filePath is already claimed by a different doc id this pass (usedFilePaths) —
 *         titles are not unique across docs (only slug is), so this guard is required.
 *      b. Else: try the doc's self-declared number — `doc.title` matched against
 *         `^{PREFIX}-(\d+)\b` where PREFIX is keyed to `doc.type` (Amendment A1). Adopt
 *         the normalized `{PREFIX}-{NNN}` id iff not already held by an existing mapping
 *         or an earlier allocation this pass (usedHumanIds); otherwise allocate the next
 *         sequential number, skipping any already in usedHumanIds. Either way, compute a
 *         new filePath deduped against usedFilePaths with a -2/-3/... suffix (mirrors
 *         slugifyWithCollision).
 *   6. Return mutated index (caller must save it atomically) plus the repair log.
 *
 * @param indexPath - Absolute path to .lore/export-index.json.
 * @param docsBaseDir - Absolute path to docs/requirements/.
 * @param docs - All active corpus docs to reconcile.
 * @param projectDir - Absolute project root (for resolving file_path during self-heal).
 * @returns ok({index, repaired}) with all docs mapped; err on allocation exhaustion or store failure.
 */
function buildOrExtendIndex(
  indexPath: string,
  docsBaseDir: string,
  docs: DocRecord[],
  projectDir: string,
): Result<{ index: ExportIndex; repaired: string[] }, LoreError> {
  const index = loadIndex(indexPath);

  // Self-heal BEFORE seeding counters/usedFilePaths so repaired (stripped) doc ids are
  // treated as brand-new allocations below, and the counter/collision state reflects
  // only the surviving, consistent mappings.
  const repaired = repairCollisions(index, projectDir, docs);

  // Collect all existing human IDs from the index for next-number seeding.
  const existingHumanIds = Object.values(index.mappings).map((m) => m.human_id);

  // file_path values already claimed by a doc id in the index — the SSOT for collision
  // detection during both title-match and sequential allocation below.
  const usedFilePaths = new Set(Object.values(index.mappings).map((m) => m.file_path));

  // human_id values already claimed by a doc id in the index, PLUS every id handed out
  // during this pass (title-match inherits, title-declared claims, sequential fallbacks) —
  // mirrors usedFilePaths so a title-declared number (SPEC-021 Amendment A1) can never
  // collide with an existing mapping or an earlier allocation in the same pass.
  const usedHumanIds = new Set<string>(existingHumanIds);

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
    // reason: title is NOT unique across docs (CorpusService dedupes slug only) — a
    // filePath already claimed by a different doc id this pass must NOT be inherited,
    // or two docs end up sharing one human_id + file_path (the export-collision bug).
    const fileMatch = typeTitleMap?.get(doc.title);
    if (fileMatch && !usedFilePaths.has(fileMatch.filePath)) {
      index.mappings[doc.id] = {
        human_id: fileMatch.humanId,
        file_path: fileMatch.filePath,
      };
      usedFilePaths.add(fileMatch.filePath);
      usedHumanIds.add(fileMatch.humanId);
      continue;
    }

    // Allocate a human_id: title-declared number first (SPEC-021 Amendment A1), then
    // sequential per-type counter fallback.
    const prefix = TYPE_PREFIX[doc.type];

    // reason: a doc's title may self-declare its own number (e.g. a spec titled
    // "SPEC-035 — Foo"); the prefix is keyed to doc.type, not string-sniffed out of the
    // title, so a plan titled "SPEC-035 implementation — X" (prefix PLAN) can never claim
    // a SPEC number. Adopt the claim only if no existing mapping or earlier allocation in
    // this pass already holds it — otherwise fall through to the sequential counter, which
    // must itself skip any number already claimed this way (see the while-loop below).
    const titleClaimMatch = doc.title.match(new RegExp(`^\\s*${prefix}-(\\d+)\\b`));
    // Normalize via the parsed number, not the raw captured digits — a title written as
    // "SPEC-0007" must still canonicalize to "SPEC-007", not retain its own zero-padding.
    const claimedNumber = titleClaimMatch ? parseInt(titleClaimMatch[1] ?? "0", 10) : undefined;
    const titleClaimedId =
      claimedNumber !== undefined ? `${prefix}-${String(claimedNumber).padStart(3, "0")}` : undefined;

    let humanId: string;
    if (titleClaimedId !== undefined && !usedHumanIds.has(titleClaimedId)) {
      humanId = titleClaimedId;
      // Advance the counter past the claimed number so a subsequent sequential allocation
      // never re-derives it independently (it's already guarded by usedHumanIds too, but
      // keeping the counter in step avoids the while-loop having to skip on every call).
      const current = typeCounters.get(doc.type) ?? 0;
      if ((claimedNumber ?? 0) > current) typeCounters.set(doc.type, claimedNumber ?? 0);
    } else {
      let next = (typeCounters.get(doc.type) ?? 0) + 1;
      let candidate = `${prefix}-${String(next).padStart(3, "0")}`;
      while (usedHumanIds.has(candidate)) {
        next += 1;
        candidate = `${prefix}-${String(next).padStart(3, "0")}`;
      }
      typeCounters.set(doc.type, next);
      humanId = candidate;
    }
    usedHumanIds.add(humanId);

    // Compute file name from human ID + slugified title (minus type prefix).
    // reason: slugify() produces "{type}-{kebab}" — strip the type prefix to get
    // just the kebab portion for the filename, keeping SPEC-025 prefix only from humanId.
    const fullSlug = slugify(doc.type, doc.title, { transliterate: transliterateCjk });
    const typePrefix = `${doc.type}-`;
    const kebabPart = fullSlug.startsWith(typePrefix)
      ? fullSlug.slice(typePrefix.length)
      : fullSlug;
    // Limit filename length to avoid filesystem issues.
    const truncatedKebab = kebabPart.slice(0, 50).replace(/-+$/, "");

    const dirRelPath = `docs/requirements/${TYPE_DIR[doc.type]}`;
    const filePathResult = allocateUniqueFilePath(dirRelPath, humanId, truncatedKebab, usedFilePaths);
    if (!filePathResult.ok) return filePathResult;
    const filePath = filePathResult.value;

    usedFilePaths.add(filePath);
    index.mappings[doc.id] = { human_id: humanId, file_path: filePath };
  }

  return ok({ index, repaired });
}

/**
 * Detect and repair export-index corruption: two different doc ids mapped to the same
 * file_path (which, since fileName always embeds human_id, also means the same human_id).
 * This can only arise from a prior buggy run (title-match wrongly matching a different
 * doc with an identical title — see buildOrExtendIndex's usedFilePaths guard) or a manual
 * hand-edit of export-index.json.
 *
 * Repair strategy — for each colliding file_path:
 *   1. If exactly one claimant's corpus content matches the on-disk file body, it is the
 *      canonical owner (it actually wrote that file).
 *   2. Otherwise the claimant with the earliest created_at wins (most likely exported
 *      first, before the collision occurred).
 *   All other claimants have their mapping entry DELETED from `index.mappings` — the
 *   caller's normal allocation loop then treats them as unmapped and assigns each a
 *   fresh, unique human_id + file_path; Phase 2 of exportDocs writes their (previously
 *   never-written) file. No data loss, no silent skip — every repair is logged.
 *
 * A lone mapping for a doc id that no longer exists in `docs` (soft-deleted / filtered
 * out) is NOT a collision by itself — it is a harmless orphan entry, left untouched.
 *
 * @param index - Loaded export index (mutated in place: losing entries removed).
 * @param projectDir - Absolute project root, for resolving file_path to an on-disk file.
 * @param docs - All active corpus docs currently being reconciled.
 * @returns Human-readable repair log lines (empty when no collision was found).
 */
function repairCollisions(index: ExportIndex, projectDir: string, docs: DocRecord[]): string[] {
  const repairLog: string[] = [];
  const docById = new Map(docs.map((d) => [d.id, d]));

  const claimantsByFilePath = new Map<string, string[]>();
  for (const [docId, mapping] of Object.entries(index.mappings)) {
    const list = claimantsByFilePath.get(mapping.file_path) ?? [];
    list.push(docId);
    claimantsByFilePath.set(mapping.file_path, list);
  }

  for (const [filePath, claimantIds] of claimantsByFilePath) {
    const activeClaimants = claimantIds.filter((id) => docById.has(id));
    if (activeClaimants.length < 2) continue; // no real collision

    const absFilePath = join(projectDir, filePath);
    let onDiskBody: string | undefined;
    if (existsSync(absFilePath)) {
      try {
        onDiskBody = canonicaliseBody(extractBodyFromMd(readFileSync(absFilePath, "utf8")));
      } catch {
        onDiskBody = undefined;
      }
    }

    const contentMatches =
      onDiskBody !== undefined
        ? activeClaimants.filter((id) => canonicaliseBody(docById.get(id)!.content) === onDiskBody)
        : [];

    const canonicalId =
      contentMatches.length === 1
        ? contentMatches[0]!
        : [...activeClaimants].sort((a, b) =>
            docById.get(a)!.created_at.localeCompare(docById.get(b)!.created_at),
          )[0]!;

    for (const id of activeClaimants) {
      if (id === canonicalId) continue;
      const lostMapping = index.mappings[id];
      delete index.mappings[id];
      repairLog.push(
        `self-heal: doc ${id} ("${docById.get(id)!.title}") was wrongly mapped to ` +
          `${lostMapping?.human_id ?? "?"} / ${filePath} (collided with doc ${canonicalId}) — ` +
          `reallocating a new human_id + file_path`,
      );
      process.stderr.write(`⚠ export-index self-heal: ${repairLog[repairLog.length - 1]}\n`);
    }
  }

  return repairLog;
}

/**
 * Resolve a candidate export file_path to one not yet claimed in usedFilePaths, appending
 * a -2, -3, ... suffix on collision (mirrors slugifyWithCollision from @lore/core). Fails
 * loud rather than silently overwriting or aliasing another doc's file.
 *
 * @param dirRelPath - Type directory, relative to project root, e.g. "docs/requirements/knowledge".
 * @param humanId - Allocated human ID, e.g. "KN-003".
 * @param kebabStem - Truncated kebab-case stem (no human_id prefix, no extension), ≤50 chars.
 * @param usedFilePaths - file_path values already claimed this reconcile pass.
 * @returns ok(filePath) on success; err(VALIDATION_ERROR) if exhausted after 999 attempts.
 */
function allocateUniqueFilePath(
  dirRelPath: string,
  humanId: string,
  kebabStem: string,
  usedFilePaths: ReadonlySet<string>,
): Result<string, LoreError> {
  const base = `${dirRelPath}/${humanId}-${kebabStem}.md`;
  if (!usedFilePaths.has(base)) return ok(base);

  const MAX_ATTEMPTS = 999;
  for (let n = 2; n <= MAX_ATTEMPTS; n++) {
    const suffix = `-${n}`;
    const stemBudget = Math.max(50 - suffix.length, 1);
    const stem = kebabStem.slice(0, stemBudget).replace(/-+$/, "");
    const candidate = `${dirRelPath}/${humanId}-${stem}${suffix}.md`;
    if (!usedFilePaths.has(candidate)) return ok(candidate);
  }

  return err({
    code: "VALIDATION_ERROR",
    field: "file_path",
    message: `Could not allocate a unique export file_path for ${humanId} after ${MAX_ATTEMPTS} attempts (dir=${dirRelPath}, stem=${kebabStem})`,
  });
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
  const split = splitFrontmatter(normalized, "strict");
  return split.ok ? split.body : normalized;
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
    // reason: phase names may contain YAML-significant chars (": " broke 4 exported task
    // files, migration-coverage regression 2026-07-11) — quote like title above.
    fm += `phase: "${escapeYamlString(phaseStr)}"\n`;
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
