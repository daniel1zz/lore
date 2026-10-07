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
 *   - SPEC-084 T5 — Amendment A1's title-parse + sequential-fallback allocator above is
 *     RETIRED for "numbered types" (spec/adr, per `@lore/core`'s `ORDINAL_REGISTRY`) once a
 *     doc carries a store-allocated `ordinal` column value: `buildOrExtendIndex`'s main
 *     allocation loop checks `ORDINAL_REGISTRY[doc.type] !== undefined && typeof doc.ordinal
 *     === "number"` FIRST, and when true composes `human_id` via `formatMirrorHumanId` (a
 *     pure, zero-padded read of the column — no title parsing, no counter, never a silent
 *     renumber; task-unify-mirror-identifiers-on-zero-padded-form-export-all switched this
 *     from the unpadded `formatDocDisplayId` so the mirror's `human_id` matches its own
 *     zero-padded filename/legacy-allocator convention) and derives `file_path` from that id,
 *     skipping the legacy branch entirely. A numbered-type
 *     doc whose `ordinal` is still `null`/`undefined` (pre-`lore migrate ordinals` legacy, OR
 *     permanently kind-exempt e.g. a `domain-overview` spec) falls through to the UNCHANGED
 *     Amendment A1 legacy path — but when it is NOT kind-exempt, `buildOrExtendIndex` also
 *     appends a LOUD entry to the new `ordinalWarnings` return (surfaced as
 *     `ExportReport.ordinal_warnings`) naming `lore migrate ordinals`, so the gap is visible
 *     in every export run rather than silently perpetuated. Non-numbered types (prd, plan,
 *     task, knowledge, phase) never enter either new branch — `ORDINAL_REGISTRY[doc.type]`
 *     is `undefined` for them — and keep this exact legacy path byte-identical.
 *   - SPEC-084 T5 — existing `.lore/export-index.json` mappings for numbered-type docs
 *     reconcile to the column on the next export run: `reconcileOrdinalMappings` (run
 *     alongside `repairCollisions`, same "strip the stale mapping and let it be freshly
 *     reallocated" strategy, logged into the SAME `ExportReport.repaired` array — a
 *     `repaired`-family entry, mirroring `repairCollisions`' loudness) detects a mapped doc
 *     whose `ordinal` is now a number but whose recorded `human_id` no longer matches
 *     `formatMirrorHumanId(doc)` (e.g. it was exported under a legacy allocation before
 *     `lore migrate ordinals` backfilled the column, OR a later write patched `human_id`
 *     with the unpadded `formatDocDisplayId` — see `reconcileOrdinalMappings`'s own JSDoc)
 *     and deletes the stale mapping so the
 *     column-derived branch above re-derives it fresh. The doc's previously-written file at
 *     the stale path is left on disk (this module never deletes files it wrote) — a fresh
 *     file is created at the corrected path on the same run.
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
  formatMirrorHumanId,
  assertIsMirrorHumanId,
  ORDINAL_REGISTRY,
} from "@lore/core";
// reason: getTransliterateCjk/containsCjk (SPEC-068 D1, hotfix 2026-07-23) are
// Node-only-subpath-gated purely for the browser-safety barrel-isolation
// invariant (packages/core/src/CLAUDE.md) — this service file is always
// server-side, same precedent config-service.ts already set.
import { containsCjk, getTransliterateCjk } from "@lore/core/node";
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
   *
   * ⛔ This flag is LOAD-BEARING for a read-only caller, not merely an optimization: since
   * 2026-08-17 `scripts/export-spec-mirror.ts`'s `runContentCheck` (the `bun run check:spec-mirror`
   * body comparison, AC-BFI-8 of `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor`)
   * calls this method with `dryRun: true` precisely BECAUSE the body verdict must come from the
   * pipeline that writes the files rather than a second, silently divergent copy. Every write site
   * in `exportDocs` — the Phase-1 `saveIndexAtomic`, the `mkdirSync`, the identity-repair /
   * frontmatter-repair / force-overwrite `writeFileSync` calls, and `writeFileExclusive` — is
   * behind a `dryRun` guard or an early `continue`, and that must stay true. A new write that
   * escapes the guard would turn a drift CHECK into a self-repairing export, which reports clean on
   * its second consecutive run and can therefore never fail. Regression oracle:
   * `scripts/tests/spec-mirror-content-drift.test.ts` (two consecutive `--check` runs over one
   * mutated body must report identical drift, and that file's hash must be unchanged across the
   * assertion window).
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
   *
   * SPEC-084 T5 — ALSO carries "ordinal-reconcile" entries: a numbered-type (spec/adr) doc
   * whose store-allocated `ordinal` column has since been populated but whose existing
   * mapping still reflects a stale legacy (title-parse/sequential) human_id is stripped here
   * too, so it is freshly reallocated from the column on this same run. Same array, same
   * "never silent" loudness contract as the collision self-heal above — see
   * `reconcileOrdinalMappings`.
   */
  repaired: string[];
  /**
   * SPEC-084 T5 — loud warnings for numbered-type (spec/adr) docs that are NOT kind-exempt
   * (see `@lore/core`'s `ORDINAL_REGISTRY[type].exemptKinds`, e.g. `domain-overview` specs)
   * but still carry a `null`/`undefined` `ordinal` column value at export time — i.e. a doc
   * predating the SPEC-084 `lore migrate ordinals` repair migration. Such a doc still gets a
   * human_id via the retired Amendment A1 legacy allocator (title-parse + sequential
   * fallback) so export never blocks or invents a number silently, but every run names the
   * exact doc + the repair command instead of quietly perpetuating the gap. Always present,
   * empty when every numbered-type doc in this run already carries an allocated ordinal (or
   * is legitimately kind-exempt).
   */
  ordinal_warnings: string[];
  /**
   * task-unify-mirror-identifiers-on-zero-padded-form-export-all (2026-08-11) — file paths
   * whose FRONTMATTER was unconditionally rewritten because this doc's identity was determined
   * stale, by ANY of three independent signals (see the write loop's own comment for the full
   * detail): (1) this run's `reconcileOrdinalMappings` just deleted-and-refreshed the doc's
   * OWN mapping (its `human_id` was stale, e.g. `SPEC-2` corrected to `SPEC-002`); (2) the
   * file's ACTUAL on-disk frontmatter `id:` disagrees with the mapping's CURRENT `human_id`
   * right now; or (3) the file's on-disk `links`/`parent`/`plan` refs — i.e. what it CITES —
   * disagree with what those refs freshly resolve to right now (a doc whose OWN id never
   * changed can still cite ANOTHER doc's OLD, now-corrected id string) — ALL regardless of the
   * normal body-only drift check.
   *
   * ⛔ Why this bucket exists at all: the drift check in the main write loop below compares ONLY
   * the file's BODY (`extractBodyFromMd` strips frontmatter before comparing, by design — SPEC-021
   * §4's roundtrip-parity requirement, and so a routine status/tag/AC-checklist edit never forces
   * a rewrite). A doc whose identity was corrected very often recomputes (or already sits at) the
   * EXACT SAME `file_path` it already had (only the `human_id` STRING changed, not the file it
   * lives at) — so the write loop would see "file exists, body unchanged" and silently report
   * `skipped_clean`, NEVER refreshing the stale `id:`/`links:` frontmatter lines. Signal (1)
   * alone is INSUFFICIENT — measured empirically: once an earlier run's reconcile had already
   * corrected the INDEX, a later run finds no mismatch left to reconcile against, yet the FILE's
   * frontmatter can still lag behind forever with nothing else to catch it; signal (2) reads the
   * on-disk truth directly, every run, closing that gap regardless of which run caused it. Signal
   * (2) alone is STILL insufficient for a doc that only CITES a stale id without its OWN id ever
   * being wrong — that is signal (3), the CITING side of the same bug class (a doc B's `links:`
   * entry for doc A survives with A's OLD id string even after A's own id is corrected, because
   * B's own content/id never changed and so B never trips signals 1/2 for ITSELF). All three
   * together are exactly what this task fixes: a mirror file whose frontmatter (its own id, or
   * what it cites) disagreed with the CURRENT truth forever, because nothing ever revisited it
   * after the referenced identity was corrected elsewhere. Entries here bypass the body-only
   * check entirely and are ALWAYS freshly written (frontmatter AND body), independent of
   * `created`/`skipped_clean`/`drift`/`overwritten` (a doc can appear in `identity_repaired` OR
   * exactly one of those four, never both — see the write loop's `identityStale` branch).
   */
  identity_repaired: string[];
  /**
   * task-the-two-mirror-exporters-disagree-because-drift-detection (2026-08-13) — file paths
   * whose on-disk FRONTMATTER SCALAR fields (`status`, `priority`, `title`, `tags`, `phase` —
   * every field {@link buildFrontmatterString} derives directly from `doc`, excluding the
   * identity fields `identity_repaired` already covers and the wall-clock `created`/`updated`
   * dates) disagreed with the doc's CURRENT corpus values while the BODY still matched, and
   * were unconditionally rewritten to converge — independent of `opts.force`, because a
   * corpus-authoritative field (e.g. a `status` transition) has exactly one correct value, never
   * a hand-edit judgement call the way body content is. This is what makes a status-only drift
   * (measured baseline 2026-08-13: 202 mirror files reading a stale `status:` after their corpus
   * doc's status changed with the body byte-unchanged) actually REPAIRABLE by `bun run
   * mirror:export` / `lore export-docs` with no flags — before this field existed, the body-only
   * comparison below was blind to every one of these fields (same root cause `identity_repaired`
   * was added to fix for `id`/`parent`/`plan`/`links`, generalized here to the remaining scalar
   * frontmatter surface). Never populated together with `skipped_clean`/`drift`/`overwritten`/
   * `identity_repaired` for the SAME path.
   */
  frontmatter_repaired: string[];
  /**
   * task-the-two-mirror-exporters-disagree-because-drift-detection (2026-08-13) — file paths
   * whose frontmatter scalar staleness (see {@link frontmatter_repaired}) was DETECTED but could
   * NOT be safely repaired, for one of two reasons, both named here rather than silently folded
   * into `skipped_clean` (which would misreport a file this run could not actually verify or fix
   * as clean — the "a report that can only print OK" defect this field exists to kill):
   *   1. The on-disk frontmatter block could not be parsed at all (missing/malformed `status`,
   *      `priority`, `title`, or `tags`) — staleness is UNDECIDABLE, so this run can prove
   *      neither "clean" nor "stale" and must say so rather than guess `skipped_clean`.
   *   2. The BODY *also* drifted (the existing `report.drift` case) and `opts.force` was not
   *      passed — repairing the frontmatter alone would still require rewriting the body, which
   *      is not an approved action without `--force`, so this run declines the WHOLE file rather
   *      than silently patching half of it. Also present in `report.drift` for this case (finer-
   *      grained information, not a replacement for it).
   */
  frontmatter_declined: string[];
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
  // baseline (spec-baseline-slice-1 C1) — compile-forced entry; "BL" avoided because BL-n names PRD requirements.
  baseline: "BASE",
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
  baseline: "baseline",
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
   *        a. If this doc's mapping was just reconciled in Phase 1 (its `human_id` was stale —
   *           task-unify-mirror-identifiers-on-zero-padded-form-export-all, 2026-08-11) →
   *           unconditionally rebuild frontmatter + body and write, report in
   *           `identity_repaired` — bypasses steps b/c entirely, since the body-only drift
   *           check would otherwise misreport this as `skipped_clean` (frontmatter isn't part
   *           of that comparison) whenever the recomputed path happens to already exist.
   *        b. Else if file exists at mapping.file_path → compare body (drift check).
   *           - Match → skipped_clean.
   *           - Differ, no `opts.force` → drift (file untouched).
   *           - Differ, `opts.force: true` → rebuild frontmatter + body, overwrite in
   *             place, report in `overwritten` (SPEC-021 Amendment A2).
   *        c. If file absent → build frontmatter, write with O_EXCL; add to created.
   *
   * @param opts - Project root, dry-run flag, optional type filter, optional force-overwrite.
   * @param now - Time seam (SPEC-043 D3/D4 convention) — drives the invalidation banner
   *   prepended below to any invalidated doc's body (knowledge/adr/task, per
   *   `ValidityService.VALIDITY_ELIGIBLE_TYPES` — `resolveValidityBanner` is type-agnostic
   *   and this loop is not type-filtered); defaults to `() => new Date().toISOString()`.
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

    // task-the-mirror-prune-does-not-retire-a-mapping-whose-doc-was (2026-08-17) — a SEPARATE
    // fetch, INCLUDING soft-deleted docs, scoped by the SAME `opts.type` filter as `allDocs`
    // above. This is what lets `buildOrExtendIndex` distinguish "this docId never existed at
    // all" (an orphan RESERVATION several existing tests rely on staying inert forever —
    // `repairCollisions`/`reconcileOrdinalMappings`'s own "not this reconciler's concern"
    // stance toward a mapping with no backing DocRecord) from "this docId existed and was
    // soft-deleted" (the ONLY case this task's retirement step may act on). Reusing the SAME
    // type filter also means a per-type call's retirement check can never see a DIFFERENT
    // type's doc at all — a spec-scoped pass's `everKnownDocIds` simply never contains a
    // knowledge doc's id, deleted or not, so no separate directory-scope guard is needed.
    // Never reused for anything else in this method — `allDocs` above stays the SAME live-only
    // population every other phase (topo sort, Phase 2 write loop) already depends on.
    const everKnownDocsResult = await this.store.findMany(
      opts.type ? { type: opts.type, exclude_deleted: false } : { exclude_deleted: false },
    );
    if (!everKnownDocsResult.ok) return everKnownDocsResult;
    const everKnownDocIds = new Set(everKnownDocsResult.value.map((d) => d.id));

    const indexResult = await buildOrExtendIndex(indexPath, docsBaseDir, allDocs, opts.projectDir, everKnownDocIds);
    if (!indexResult.ok) return indexResult;
    const { index, repaired, ordinalWarnings, reconciledDocIds } = indexResult.value;

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
      ordinal_warnings: ordinalWarnings,
      identity_repaired: [],
      frontmatter_repaired: [],
      frontmatter_declined: [],
    };

    // Computes this doc's CURRENT, correct identity refs (parent/plan/links human_ids) from the
    // live index — the SAME value used for both the staleness comparison below and the actual
    // write, so they can never independently diverge (see `computeFreshIdentityRefs`'s own doc
    // comment).
    const fetchFreshIdentityRefs = async (doc: DocRecord): Promise<FreshIdentityRefs> => {
      const linksResult = await this.store.findLinks(doc.id, "out");
      const outLinks: LinkRecord[] = linksResult.ok ? linksResult.value : [];
      return computeFreshIdentityRefs(doc, outLinks, index);
    };

    // Builds the complete file content (frontmatter + spliced body) for a doc — shared by
    // BOTH the "file absent → create" path and the "drift + force → overwrite" path, so a
    // force-overwrite regenerates frontmatter (title/status/tags/links may also have
    // changed) rather than only patching the body.
    const buildFileContent = (doc: DocRecord, resolvedBody: string, freshRefs: FreshIdentityRefs): string => {
      const mapping = index.mappings[doc.id]!;
      const fmStr = buildFrontmatterString(doc, mapping.human_id, freshRefs);
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
      const bannerBody = banner !== undefined ? `${banner}\n\n${bodyResult.value}` : bodyResult.value;
      // task-unify-mirror-identifiers-on-zero-padded-form-export-all (2026-08-11) — sanitize
      // raw NUL bytes BEFORE both the drift comparison and the on-write content (same "one
      // computation, both uses" rule the MDX splice/banner above already establish) — see
      // `sanitizeRawNulBytes`'s own doc comment for why this belongs at the export boundary,
      // never on `doc.content` itself.
      const resolvedBody = sanitizeRawNulBytes(bannerBody);

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

      const freshRefs = await fetchFreshIdentityRefs(doc);

      if (existsSync(absFilePath)) {
        // File already exists — read once, then decide identity-repair vs. the normal
        // body-only drift check (SPEC-021 §9.6).
        let fileMd: string;
        try {
          fileMd = readFileSync(absFilePath, "utf8");
        } catch (e) {
          report.errors.push(
            `${mapping.file_path}: cannot read — ${e instanceof Error ? e.message : String(e)}`,
          );
          continue;
        }

        // task-unify-mirror-identifiers-on-zero-padded-form-export-all (2026-08-11) — THREE
        // independent signals, any one forces an unconditional rewrite (bypassing the
        // body-only drift check entirely, which is blind to frontmatter by design):
        //   1. `reconciledDocIds.has(doc.id)` — this doc's mapping was JUST deleted-and-
        //      refreshed in Phase 1 THIS run (reconcileOrdinalMappings), so its frontmatter is
        //      KNOWN stale even before comparing anything.
        //   2. `onDiskId !== mapping.human_id` — the file's ACTUAL frontmatter `id:` disagrees
        //      with the CURRENT mapping right now, regardless of whether Phase 1 reconciled
        //      anything THIS run. Needed because an EARLIER run (or a still-unfixed write path
        //      like `OrdinalMigrationService` step 3) can leave the INDEX already correct while
        //      the FILE lags behind with no mismatch left for Phase 1 to detect — signal 1
        //      alone would silently perpetuate that gap forever once the index converges.
        //   3. The file's on-disk `links`/`parent`/`plan` refs disagree with `freshRefs` right
        //      now — the CITING side of the exact same class of bug: doc B cites doc A by A's
        //      OLD human_id string; A's own id later gets corrected (by signal 1 or 2, on A's
        //      OWN export), but B's frontmatter is never revisited (B's own id/body never
        //      changed, so B never trips signals 1/2 for ITSELF) — B's stale citation of A
        //      would otherwise survive forever, which is exactly what left 12+ cross-type
        //      `links_broken` references broken even after every doc's OWN id was fixed
        //      (measured empirically on the live corpus, 2026-08-11).
        // See `ExportReport.identity_repaired`'s own doc comment for the full mechanism.
        const onDiskId = extractFrontmatterId(fileMd);
        const onDiskRefs = extractFrontmatterIdentityRefs(fileMd);
        const refsStale = onDiskRefs !== null && canonicalizeIdentityRefs(onDiskRefs) !== canonicalizeIdentityRefs(freshRefs);
        const identityStale = reconciledDocIds.has(doc.id) || (onDiskId !== null && onDiskId !== mapping.human_id) || refsStale;

        if (identityStale) {
          if (opts.dryRun) {
            report.identity_repaired.push(mapping.file_path);
            continue;
          }
          const fileContent = buildFileContent(doc, resolvedBody, freshRefs);
          try {
            writeFileSync(absFilePath, fileContent, "utf8");
          } catch (e) {
            report.errors.push(
              `${mapping.file_path}: identity-repair rewrite failed — ${e instanceof Error ? e.message : String(e)}`,
            );
            continue;
          }
          report.identity_repaired.push(mapping.file_path);
          continue;
        }

        const fileBody = extractBodyFromMd(fileMd);
        const fileNorm = canonicaliseBody(fileBody);
        const corpusNorm = canonicaliseBody(resolvedBody);
        const bodyStale = fileNorm !== corpusNorm;

        // task-the-two-mirror-exporters-disagree-because-drift-detection (2026-08-13) — the
        // SAME staleness question the identity check above asks, generalized from the identity
        // fields (id/parent/plan/links) to the remaining scalar frontmatter fields that are
        // ALSO pure, deterministic projections of `doc` and therefore ALSO invisible to the
        // body-only comparison above by construction (a `status` transition changes not one
        // byte of `resolvedBody`). See `ExportReport.frontmatter_repaired`'s own doc comment for
        // the full mechanism and measured baseline.
        const onDiskScalar = extractFrontmatterScalarFields(fileMd);
        const freshScalar = computeFreshScalarFields(doc);
        const scalarUndecidable = onDiskScalar === null;
        const scalarStale = !scalarUndecidable && canonicalizeScalarFields(onDiskScalar) !== canonicalizeScalarFields(freshScalar);

        if (!bodyStale) {
          // Body content matches — but the file's frontmatter scalar fields may still be
          // stale (or unreadable), independent of `opts.force`: see `frontmatter_repaired`'s
          // own doc comment for why this is unconditional, unlike body drift below.
          if (scalarUndecidable) {
            report.frontmatter_declined.push(mapping.file_path);
            continue;
          }
          if (scalarStale) {
            if (opts.dryRun) {
              report.frontmatter_repaired.push(mapping.file_path);
              continue;
            }
            try {
              const fileContent = buildFileContent(doc, resolvedBody, freshRefs);
              writeFileSync(absFilePath, fileContent, "utf8");
            } catch (e) {
              report.errors.push(
                `${mapping.file_path}: frontmatter-repair rewrite failed — ${e instanceof Error ? e.message : String(e)}`,
              );
              continue;
            }
            report.frontmatter_repaired.push(mapping.file_path);
            continue;
          }
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
          if (scalarStale) {
            // Frontmatter is ALSO stale, but fixing it here would require rewriting the body
            // too (buildFileContent regenerates the whole file) — not an approved action
            // without --force. Name it explicitly rather than letting `report.drift` alone
            // stand in for "and nothing else is wrong" (AC-OX-5c: a decline must be honest).
            report.frontmatter_declined.push(mapping.file_path);
          }
          continue;
        }

        // force: true — overwrite with the current expected content (SPEC-021 Amendment A2).
        if (opts.dryRun) {
          report.overwritten.push(mapping.file_path);
          continue;
        }
        try {
          const fileContent = buildFileContent(doc, resolvedBody, freshRefs);
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

      const fileContent = buildFileContent(doc, resolvedBody, freshRefs);

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
 * Algorithm (SPEC-021 §9.3, §9.4; Amendment A1 for step 5b — RETIRED for numbered types by
 * SPEC-084 T5, see step 5a's ordinal branch below):
 *   1. Load existing index.
 *   2. Self-heal: repair any (human_id, file_path) collision between two different
 *      doc ids already in the index (see repairCollisions) — logged, never silent.
 *   2b. SPEC-084 T5 — reconcile: for a numbered-type (spec/adr) doc already mapped whose
 *       store-allocated `ordinal` column no longer matches its recorded human_id (i.e. it
 *       was exported under the legacy allocator before `lore migrate ordinals` backfilled
 *       the column), strip the stale mapping the same way step 2 does — logged into the
 *       SAME repair array (see reconcileOrdinalMappings).
 *   3. Scan files per type dir — build title → humanId/filePath map.
 *   4. Seed per-type next-number counters from index + file scan.
 *   5. For each corpus doc not in index:
 *      a. SPEC-084 T5 — if `doc.type` is a numbered type (`ORDINAL_REGISTRY[doc.type]`
 *         defined) AND `doc.ordinal` is an allocated number: human_id = `formatMirrorHumanId`
 *         (pure, zero-padded column read, no title parsing, no counter) — skip b/c entirely.
 *      b. Match by title to scanned file → inherit its ID + filePath, UNLESS that
 *         filePath is already claimed by a different doc id this pass (usedFilePaths) —
 *         titles are not unique across docs (only slug is), so this guard is required.
 *      c. Else: try the doc's self-declared number — `doc.title` matched against
 *         `^{PREFIX}-(\d+)\b` where PREFIX is keyed to `doc.type` (Amendment A1). Adopt
 *         the normalized `{PREFIX}-{NNN}` id iff not already held by an existing mapping
 *         or an earlier allocation this pass (usedHumanIds); otherwise allocate the next
 *         sequential number, skipping any already in usedHumanIds. Either way, compute a
 *         new filePath deduped against usedFilePaths with a -2/-3/... suffix (mirrors
 *         slugifyWithCollision). Steps b/c are the RETIRED-for-numbered-types legacy path —
 *         still exercised by non-numbered types always, and by numbered types ONLY while
 *         `doc.ordinal` is `null`/`undefined` (pre-migration, or permanently kind-exempt).
 *         SPEC-084 T5 — a numbered-type doc reaching b/c that is NOT kind-exempt (see
 *         `ORDINAL_REGISTRY[doc.type].exemptKinds`) additionally appends a loud entry to the
 *         returned `ordinalWarnings`, naming `lore migrate ordinals` — never a silently
 *         invented number.
 *   6. Return mutated index (caller must save it atomically) plus the repair log and the
 *      ordinal-fallback warning log.
 *
 * @param indexPath - Absolute path to .lore/export-index.json.
 * @param docsBaseDir - Absolute path to docs/requirements/.
 * @param docs - All active (live) corpus docs to reconcile.
 * @param projectDir - Absolute project root (for resolving file_path during self-heal).
 * @param everKnownDocIds - Every doc id that exists at all (live OR soft-deleted) under the
 *   SAME type scope `docs` was fetched with — see `retireDeletedDocMappings`'s own doc
 *   comment for why this is the discriminator between a retirable (soft-deleted) mapping and
 *   an inert orphan reservation (docId that never existed).
 * @returns ok({index, repaired, ordinalWarnings, reconciledDocIds}) with all docs mapped; err on
 *   allocation exhaustion or store failure.
 */
async function buildOrExtendIndex(
  indexPath: string,
  docsBaseDir: string,
  docs: DocRecord[],
  projectDir: string,
  everKnownDocIds: ReadonlySet<string>,
): Promise<
  Result<
    { index: ExportIndex; repaired: string[]; ordinalWarnings: string[]; reconciledDocIds: Set<string> },
    LoreError
  >
> {
  const index = loadIndex(indexPath);

  // Self-heal BEFORE seeding counters/usedFilePaths so repaired (stripped) doc ids are
  // treated as brand-new allocations below, and the counter/collision state reflects
  // only the surviving, consistent mappings.
  const repaired = repairCollisions(index, projectDir, docs);
  // SPEC-084 T5 — same "strip stale mapping, let it be freshly reallocated" strategy, for
  // numbered-type docs whose column has since diverged from their recorded human_id. Runs
  // AFTER collision self-heal (operates on whatever mappings survived that pass) and BEFORE
  // the counter/usedFilePaths seeding below, so a reconciled doc is treated as unmapped.
  const ordinalReconcile = reconcileOrdinalMappings(index, docs);
  repaired.push(...ordinalReconcile.repairLog);
  const reconciledDocIds = ordinalReconcile.reconciledDocIds;

  // task-the-mirror-prune-does-not-retire-a-mapping-whose-doc-was (2026-08-17) — a THIRD
  // "strip the stale mapping" pass, same repairLog array, same "runs before counter
  // seeding" placement as the two above: a mapping whose doc was soft-deleted (or never
  // existed) since being mirrored is retired here so a corpus-wide parity oracle stops
  // seeing it forever. `everKnownDocIds` is scoped by the SAME `opts.type` filter `docs`
  // itself was fetched with (see `exportDocs`'s own comment on that fetch), so a per-type
  // call can never mistake an OTHER type's mapping for a genuine orphan — that mapping's
  // docId simply never appears in a type-narrowed `everKnownDocIds` at all.
  repaired.push(...retireDeletedDocMappings(index, docs, everKnownDocIds));

  const ordinalWarnings: string[] = [];

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

    // SPEC-084 T5 — column-derived branch: a numbered type (spec/adr) with an allocated
    // ordinal composes its human_id from the column via formatMirrorHumanId (pure read, no
    // title parsing, no counter, never a silent renumber) and skips the legacy path (title-
    // match / title-declared-number / sequential fallback) entirely — the column is
    // authoritative once it holds a value.
    // reason (task-unify-mirror-identifiers-on-zero-padded-form-export-all, 2026-08-11):
    // zero-padded to 3 digits via formatMirrorHumanId, NOT the general-purpose (unpadded)
    // formatDocDisplayId — the legacy allocator below has always zero-padded, so this branch
    // must match it or every doc that flows through here diverges from its own filename
    // (the exact SPEC-021/"SPEC-21" corruption this task fixes).
    if (isOrdinalEligibleType(doc.type) && typeof doc.ordinal === "number") {
      const humanId = formatMirrorHumanId(doc);
      if (humanId !== null) {
        const truncatedKebab = await computeExportKebabStem(doc);
        const dirRelPath = `docs/requirements/${TYPE_DIR[doc.type]}`;
        const filePathResult = allocateUniqueFilePath(dirRelPath, humanId, truncatedKebab, usedFilePaths);
        if (!filePathResult.ok) return filePathResult;
        const filePath = filePathResult.value;

        usedFilePaths.add(filePath);
        usedHumanIds.add(humanId);
        index.mappings[doc.id] = { human_id: humanId, file_path: filePath };
        continue;
      }
    }

    // SPEC-084 T5 — a numbered type still lacking an allocated ordinal (pre-`lore migrate
    // ordinals`) falls through to the legacy path below like any non-numbered type, but
    // (unless it is permanently kind-exempt, e.g. a domain-overview spec) the gap is named
    // loudly rather than silently perpetuated — never a fabricated number.
    if (isOrdinalEligibleType(doc.type) && !isOrdinalExemptKind(doc)) {
      const warning =
        `${doc.type} doc "${doc.title}" (id ${doc.id}) has no store-allocated SPEC-084 ` +
        `ordinal yet — falling back to legacy title/sequential human_id allocation for this ` +
        `export run. Run \`lore migrate ordinals\` to backfill its ordinal.`;
      ordinalWarnings.push(warning);
      process.stderr.write(`⚠ ordinal-fallback: ${warning}\n`);
    }

    const typeTitleMap = titleMaps.get(doc.type);

    // Try title-match to an existing file (index rebuild path, SPEC-021 §9.3).
    // reason: title is NOT unique across docs (CorpusService dedupes slug only) — a
    // filePath already claimed by a different doc id this pass must NOT be inherited,
    // or two docs end up sharing one human_id + file_path (the export-collision bug).
    const fileMatch = typeTitleMap?.get(doc.title);
    if (fileMatch && !usedFilePaths.has(fileMatch.filePath)) {
      // Narrows the scanned-from-disk human_id to the branded MirrorHumanId (SPEC-mirror-
      // identifier-ssot D3/D4) via the exported assertion function, never a textual cast —
      // this legacy title-match rebuild path composes the SAME {PREFIX}-{digits} shape but is
      // NOT formatMirrorHumanId itself, so it can't return the brand type on its own.
      assertIsMirrorHumanId(fileMatch.humanId);
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
    const truncatedKebab = await computeExportKebabStem(doc);

    const dirRelPath = `docs/requirements/${TYPE_DIR[doc.type]}`;
    const filePathResult = allocateUniqueFilePath(dirRelPath, humanId, truncatedKebab, usedFilePaths);
    if (!filePathResult.ok) return filePathResult;
    const filePath = filePathResult.value;

    usedFilePaths.add(filePath);
    // Narrows this legacy per-type sequential/title-claimed allocation (non-numbered doc
    // types — prd/plan/knowledge/task/phase, never touched by the D1 two-writer reversion
    // loop) to the branded MirrorHumanId via the exported assertion function, never a
    // textual cast (SPEC-mirror-identifier-ssot D3/D4).
    assertIsMirrorHumanId(humanId);
    index.mappings[doc.id] = { human_id: humanId, file_path: filePath };
  }

  return ok({ index, repaired, ordinalWarnings, reconciledDocIds });
}

/**
 * Computes the truncated kebab-case filename stem (no human_id prefix, no extension) for a
 * doc's export file_path — shared by BOTH the legacy Amendment A1 allocation branch and the
 * SPEC-084 T5 column-derived ordinal branch in `buildOrExtendIndex`'s main loop, so the two
 * paths never independently re-derive (and potentially diverge on) the same slug/truncation
 * logic. Extracted verbatim from the pre-SPEC-084 T5 inline computation — no behavior change.
 *
 * reason: slugify() produces "{type}-{kebab}" — strip the type prefix to get just the kebab
 * portion for the filename, keeping the human_id prefix as the sole numbering source. The
 * CJK transliteration hook is only awaited when the title actually contains CJK — an
 * ASCII-only title never pays the pinyin-pro load cost (SPEC-068 D1 hotfix).
 *
 * @param doc - The doc whose title is being slugified for its export filename.
 * @returns Truncated (≤50 char) kebab stem with no trailing hyphen.
 */
async function computeExportKebabStem(doc: DocRecord): Promise<string> {
  // reason: exactOptionalPropertyTypes forbids `{ transliterate: undefined }` — omit the key
  // entirely rather than spread an undefined-valued property.
  const slugOpts = containsCjk(doc.title) ? { transliterate: await getTransliterateCjk() } : undefined;
  const fullSlug = slugify(doc.type, doc.title, slugOpts);
  const typePrefix = `${doc.type}-`;
  const kebabPart = fullSlug.startsWith(typePrefix) ? fullSlug.slice(typePrefix.length) : fullSlug;
  // Limit filename length to avoid filesystem issues.
  return kebabPart.slice(0, 50).replace(/-+$/, "");
}

/**
 * True when `type` is a store-allocated "numbered type" per `@lore/core`'s
 * `ORDINAL_REGISTRY` (currently spec/adr) — the SPEC-084 T5 gate that decides whether a doc
 * is even ELIGIBLE for the column-derived human_id branch (regardless of whether this
 * particular doc actually carries an allocated ordinal yet). Non-numbered types (prd, plan,
 * task, knowledge, phase) always return false here and take the unmodified legacy path.
 *
 * @param type - The doc type to check.
 */
function isOrdinalEligibleType(type: DocType): boolean {
  return ORDINAL_REGISTRY[type] !== undefined;
}

/**
 * True when `doc` is a numbered type but PERMANENTLY exempt from ordinal allocation for its
 * declared `extra.spec_kind` (e.g. a `domain-overview` spec, SPEC-080 taxonomy) — per
 * `@lore/core`'s `ORDINAL_REGISTRY[doc.type].exemptKinds`. Distinguishes a doc that will
 * NEVER receive an ordinal (legitimate, no warning) from one that simply hasn't been
 * migrated yet (SPEC-084 T5's loud `ordinalWarnings` case). Only meaningful when
 * {@link isOrdinalEligibleType} is already true for `doc.type` — callers check that first.
 *
 * @param doc - The doc to check (reads `doc.type` and `doc.extra["spec_kind"]`).
 */
function isOrdinalExemptKind(doc: DocRecord): boolean {
  const entry = ORDINAL_REGISTRY[doc.type];
  if (entry?.exemptKinds === undefined) return false;
  const specKind = typeof doc.extra["spec_kind"] === "string" ? doc.extra["spec_kind"] : undefined;
  return specKind !== undefined && entry.exemptKinds.includes(specKind);
}

/**
 * Reconciles existing `.lore/export-index.json` mappings for numbered-type (spec/adr) docs
 * whose store-allocated `ordinal` column has since been populated (SPEC-084) but whose
 * recorded `human_id`/`file_path` still reflects the retired Amendment A1 legacy allocator
 * — e.g. a doc originally exported under a legacy `SPEC-007` allocation before
 * `lore migrate ordinals` backfilled its real `ordinal` column to 40.
 *
 * Repair strategy mirrors `repairCollisions`: DELETE the stale mapping entry rather than
 * mutate it in place here, so there remains exactly one code path (the column-derived branch
 * in `buildOrExtendIndex`'s main loop) that ever WRITES a column-derived mapping. A deleted
 * doc id is returned in `reconciledDocIds` (task-unify-mirror-identifiers-on-zero-padded-form-
 * export-all, 2026-08-11 addition — see below) so Phase 2 knows to unconditionally rewrite
 * that doc's file even when the freshly-recomputed `file_path` turns out identical to the
 * stale one (the common case: only the `human_id` STRING was corrupted, e.g. `SPEC-2` instead
 * of `SPEC-002`, while `file_path` already correctly embedded the padded form — reconciling
 * recomputes the SAME path from the corrected id, so `existsSync` finds "the file exists" and
 * the normal body-only drift check would report `skipped_clean`, NEVER refreshing the stale
 * frontmatter `id:` line — see `ExportReport.identity_repaired`'s own doc comment for the full
 * mechanism this closes).
 *
 * reason (task-unify-mirror-identifiers-on-zero-padded-form-export-all, 2026-08-11): compares
 * against `formatMirrorHumanId` (zero-padded), not `formatDocDisplayId` (unpadded) — this is
 * the SAME function `buildOrExtendIndex`'s column-derived branch now writes with, so a
 * mapping this reconciler leaves untouched is guaranteed to already carry the padded form. A
 * prior version of this line compared against the unpadded formatter, which meant a mapping
 * whose `human_id` had ALREADY been corrupted to the unpadded form by some other write path
 * (empirically: `OrdinalMigrationService`'s step 3, `.lore/export-index.json`'s
 * `{...mapping, human_id: expectedHumanId}` patch) trivially "matched" (unpadded ===
 * unpadded) and was never caught — this line is what makes THIS reconciler catch that drift
 * on the next export run instead of silently perpetuating it into the next file write.
 *
 * @param index - Loaded export index (mutated in place: stale entries removed).
 * @param docs - All active corpus docs currently being reconciled.
 * @returns `repairLog` (human-readable lines, empty when nothing needed reconciling) plus
 *   `reconciledDocIds` (the doc ids whose mapping was just deleted here — Phase 2 forces a
 *   rewrite for every one of these, never trusting the body-only drift check for them).
 */
function reconcileOrdinalMappings(
  index: ExportIndex,
  docs: DocRecord[],
): { repairLog: string[]; reconciledDocIds: Set<string> } {
  const repairLog: string[] = [];
  const reconciledDocIds = new Set<string>();
  const docById = new Map(docs.map((d) => [d.id, d]));

  for (const [docId, mapping] of Object.entries(index.mappings)) {
    const doc = docById.get(docId);
    if (doc === undefined) continue; // orphan entry — not this reconciler's concern
    if (!isOrdinalEligibleType(doc.type)) continue;
    if (typeof doc.ordinal !== "number") continue; // not yet migrated — nothing to reconcile against

    const correctHumanId = formatMirrorHumanId(doc);
    if (correctHumanId === null) continue; // unreachable given the ordinal-number check above
    if (mapping.human_id === correctHumanId) continue; // already converged

    delete index.mappings[docId];
    reconciledDocIds.add(docId);
    const line =
      `ordinal-reconcile: doc ${docId} ("${doc.title}") was mapped to ${mapping.human_id} / ` +
      `${mapping.file_path} — reconciling to its store-allocated ordinal ${correctHumanId} ` +
      `(the file at the recomputed path — same path or a fresh one — will be unconditionally ` +
      `rewritten this run, see ExportReport.identity_repaired)`;
    repairLog.push(line);
    process.stderr.write(`⚠ export-index ordinal-reconcile: ${line}\n`);
  }

  return { repairLog, reconciledDocIds };
}

/**
 * Retires an export-index mapping whose doc was SOFT-DELETED since being mirrored — it still
 * belongs to `everKnownDocIds` (it resolves to a real DocRecord) but no longer to the LIVE
 * population THIS PASS is authoritative for
 * (task-the-mirror-prune-does-not-retire-a-mapping-whose-doc-was, 2026-08-17). Measured on
 * the real corpus: `pruneOrphanMirrorFiles` (scripts/export-spec-mirror-core.ts, invoked
 * only by `bun run mirror:export`'s `runExport`) already deletes the ORPHANED FILE once its
 * mapping is gone from the FRESH index it reads back after export — but nothing ever
 * removed the mapping ITSELF, so `.lore/export-index.json` kept naming a deleted doc
 * forever (measured: doc `01KWVPCJBKHPTBZQBPMXZK0B99`, soft-deleted 2026-07-18, still
 * mapped weeks later with its file already gone) and every corpus-wide parity oracle
 * (AC-OX-6) reported it as a permanent, unfixable-by-re-running defect. This is the
 * missing half, landed HERE — not in the script — so every `exportDocs` caller (`lore
 * export-docs`, `bun run mirror:export`, the MCP/HTTP surfaces) retires it identically,
 * never only the one surface that happened to expose the gap.
 *
 * Scoped by `everKnownDocIds`, NOT merely "docId absent from `docs`" — two DIFFERENT reasons
 * a docId can be absent from `docs` (the LIVE population), and only one of them is retirable:
 *
 *   1. The doc EXISTS but is soft-deleted (`deleted_at` set) — retirable. This is the actual
 *      task scope.
 *   2. The docId never existed in the store AT ALL (a hand-seeded or historical "orphan"
 *      mapping several EXISTING tests deliberately rely on as an inert human_id/file_path
 *      RESERVATION — `repairCollisions`/`reconcileOrdinalMappings`'s own "not this
 *      reconciler's concern" stance toward `doc === undefined`) — NOT retirable. Conflating
 *      this with case 1 is a regression this function's own test suite measured directly: an
 *      existing fixture pins a doc titled "SPEC-040 — Late Claimant" falling back to
 *      SPEC-041 because an unrelated orphan mapping already "reserves" SPEC-040 — an early
 *      version of this function retired that reservation too, letting the new doc's own
 *      title-declared number (SPEC-041's Amendment A1 path) claim SPEC-040 right back,
 *      silently reintroducing the exact human_id-collision risk that reservation exists to
 *      prevent.
 *
 * `everKnownDocIds` (fetched by `exportDocs` via a SEPARATE `findMany({..., exclude_deleted:
 * false})` call, scoped by the SAME `opts.type` filter as `docs`) is what tells these two
 * cases apart: case 1's docId IS in `everKnownDocIds` (it resolves to a real, if deleted,
 * DocRecord); case 2's docId is in NEITHER set. Reusing the SAME type filter also means a
 * per-type call's `everKnownDocIds` can never contain an OTHER type's doc id at all — a
 * spec-scoped pass simply never sees a knowledge doc's id, deleted or not, so no separate
 * directory-scope guard is needed on top of this.
 *
 * ⛔ Never deletes the on-disk file — mirrors this module's own established "strip the
 * INDEX entry only" contract (see the two repair functions above: a stale mapping is
 * dropped so a later pass can act on it, but the file itself is left for a SEPARATE
 * cleanup step). Here, that separate step is `pruneOrphanMirrorFiles`: once this mapping
 * is gone from the SAVED index (`saveIndexAtomic` runs immediately after this function's
 * caller returns), the file is "no longer mapped to any corpus doc" on the very next
 * prune, exactly like any other orphan file — no new file-deletion code path needed.
 *
 * @param index the export index being built/extended THIS run (mutated in place).
 * @param docs the LIVE (non-deleted) doc population `exportDocs` fetched for its `opts.type`
 *   scope (or every type, when `opts.type` is unset) — the SAME `findMany` result the rest
 *   of this pass uses, never a separately-fetched population.
 * @param everKnownDocIds every doc id that exists at all (live OR soft-deleted), under the
 *   SAME type scope `docs` was fetched with — see above for why this is the retirable-vs-
 *   inert-orphan discriminator.
 * @returns human-readable repair-log lines (empty when nothing was retired) — pushed into
 *   the SAME `ExportReport.repaired` array `reconcileOrdinalMappings`/`repairCollisions`
 *   already populate, so a caller sees this action without a new report field to consume.
 */
function retireDeletedDocMappings(
  index: ExportIndex,
  docs: DocRecord[],
  everKnownDocIds: ReadonlySet<string>,
): string[] {
  const repairLog: string[] = [];
  const liveDocIds = new Set(docs.map((d) => d.id));

  for (const [docId, mapping] of Object.entries(index.mappings)) {
    if (liveDocIds.has(docId)) continue; // still live — nothing to retire

    if (!everKnownDocIds.has(docId)) {
      continue; // never existed at all (for THIS pass's type scope) — an inert orphan reservation, not this function's concern
    }

    delete index.mappings[docId];
    const line =
      `deleted-doc-retire: doc ${docId} was mapped to ${mapping.human_id} / ${mapping.file_path} ` +
      `but resolves to a SOFT-DELETED corpus doc — retiring the mapping; the orphaned mirror ` +
      `file itself is left for pruneOrphanMirrorFiles to remove`;
    repairLog.push(line);
    process.stderr.write(`⚠ export-index deleted-doc-retire: ${line}\n`);
  }

  return repairLog;
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
 * Replaces every raw NUL character (U+0000) in a doc's resolved body with the visible, 6-
 * character escape sequence `\u0000` — mirror files are meant to be `git diff`/`git show`
 * reviewable, and a raw NUL inside git's first-8000-byte binary-sniff window makes the WHOLE
 * FILE unreviewable (`git show --stat` reports `Bin 0 -> N bytes`, no diff at all — this is
 * `scripts/check-no-nul-bytes.ts`'s own stated concern, and its `bun run test`-wired check is
 * what actually catches an unsanitized export).
 *
 * task-unify-mirror-identifiers-on-zero-padded-form-export-all (2026-08-11) — measured live:
 * widening the export to ALL SIX types (this task's own deliverable) exported `task` docs for
 * the FIRST time, which surfaced `TASK-434-literal-nul-bytes-in-two-scripts-source-files-one`
 * (a retro doc whose OWN body intentionally quotes a raw NUL — `const KEY_SEP = "\x00"` — as a
 * before/after contrast against its escaped fix) and immediately failed `check-no-nul-bytes`.
 *
 * ⛔ Applied ONLY to the exported PROJECTION (this function's caller, right where the MDX
 * splice/invalidation banner above already establish "one computation, both the drift
 * comparison and the on-write content"), NEVER to `doc.content` itself — a doc's raw NUL can be
 * entirely intentional and evidentiary (exactly the TASK-434 case above); silently rewriting
 * the corpus SOURCE would destroy that evidentiary value. Sanitizing the mirror instead keeps
 * the corpus untouched while making the git-tracked projection reviewable.
 *
 * @param body - Resolved body text about to be written to (or compared against) a mirror file.
 * @returns The same text with every U+0000 replaced by the literal `\u0000` escape — a no-op
 *   when `body` contains none.
 */
function sanitizeRawNulBytes(body: string): string {
  return body.replace(/\u0000/g, "\\u0000");
}

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
 * Extract the frontmatter `id:` field from a .md file — the SAME strict-frontmatter +
 * `parseYaml` pattern {@link scanTypeDirectory} already uses for title-match reconcile, applied
 * here to a single already-loaded file's content instead of a directory scan.
 *
 * task-unify-mirror-identifiers-on-zero-padded-form-export-all (2026-08-11): this is the direct,
 * ALWAYS-CURRENT observable signal the write loop below compares against `mapping.human_id` to
 * decide `identity_repaired` — strictly more robust than relying only on "was this doc's mapping
 * reconciled in THIS SAME run" (`reconciledDocIds`): a doc whose mapping was already silently
 * corrected to the padded form by an EARLIER export run (before this fix existed, or before a
 * still-unfixed write path like `OrdinalMigrationService` step 3 touches it again) has NO
 * mismatch left in the INDEX to reconcile against on a LATER run, yet its on-disk FILE's
 * frontmatter can still carry the stale value forever — the body-only drift check is blind to
 * this (frontmatter isn't part of that comparison), so nothing else would ever catch it. Reading
 * this value directly, every run, closes that gap regardless of which run originally caused it.
 *
 * @param mdContent - Full file content (as read from disk).
 * @returns The frontmatter `id:` string, or `null` if the file has no strict frontmatter block,
 *   the frontmatter isn't valid YAML, or it has no string `id` field — never throws.
 */
function extractFrontmatterId(mdContent: string): string | null {
  const normalized = mdContent.replace(/\r\n/g, "\n");
  const split = splitFrontmatter(normalized, "strict");
  if (!split.ok) return null;
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatter);
  } catch {
    return null;
  }
  if (!fm || typeof fm !== "object") return null;
  const record = fm as Record<string, unknown>;
  return typeof record["id"] === "string" ? record["id"].trim() : null;
}

/** One `links:` entry as either side (fresh-computed or on-disk-parsed) represents it. */
interface FrontmatterLinkRef {
  id: string;
  type: string;
}

/**
 * The identity-bearing cross-reference fields a doc's frontmatter carries — everything that
 * names ANOTHER doc by its human_id string: `parent`, `plan` (tasks only), and `links[]`.
 * Deliberately excludes `id` itself (that's `mapping.human_id`, checked separately by
 * {@link extractFrontmatterId}) — this shape is specifically the OUTBOUND reference set whose
 * staleness `links_broken` (and the parent/plan warnings) actually measure.
 */
interface FreshIdentityRefs {
  parentHumanId: string | undefined;
  planHumanId: string | undefined;
  links: FrontmatterLinkRef[];
}

/**
 * Computes the CURRENT, correct identity-reference fields for a doc from the live index —
 * the single source both {@link buildFrontmatterString} (what gets WRITTEN) and the write
 * loop's staleness check (task-unify-mirror-identifiers-on-zero-padded-form-export-all,
 * 2026-08-11 — what gets COMPARED against what's already on disk) read from, so the two can
 * never independently drift from each other.
 *
 * @param doc - Full DocRecord from corpus.
 * @param outLinks - Outbound non-parent links from store.findLinks(doc.id, "out").
 * @param index - Export index for resolving linked doc IDs to human IDs.
 */
function computeFreshIdentityRefs(doc: DocRecord, outLinks: LinkRecord[], index: ExportIndex): FreshIdentityRefs {
  // Resolve parent ULID → human ID (if available in index).
  const parentHumanId =
    doc.parent_id !== null ? index.mappings[doc.parent_id]?.human_id : undefined;

  // Resolve plan_id for task docs → human ID (SPEC-021 §8 Q5).
  const planHumanId =
    doc.type === "task" && typeof doc.extra["plan_id"] === "string"
      ? index.mappings[doc.extra["plan_id"]]?.human_id
      : undefined;

  // Outbound non-parent links — resolve to human IDs (skip unresolvable ones).
  const links = outLinks
    .filter((l) => l.link_type !== "parent")
    .flatMap((l) => {
      const linkedHumanId = index.mappings[l.to_id]?.human_id;
      if (!linkedHumanId) return []; // linked doc not in index (soft-deleted or filtered out)
      return [{ id: linkedHumanId, type: l.link_type }];
    });

  return { parentHumanId, planHumanId, links };
}

/**
 * Order-independent canonical string for a {@link FreshIdentityRefs}-shaped value — used ONLY
 * to COMPARE two ref sets for equality (task-unify-mirror-identifiers-on-zero-padded-form-
 * export-all, 2026-08-11), never written anywhere. Sorting `links` before stringifying makes
 * the comparison independent of `store.findLinks`' return order, which this module makes no
 * ordering guarantee about — an order-sensitive comparison would false-positive as "drift" on
 * every run whenever the store's link order isn't stable, defeating idempotency corpus-wide.
 */
function canonicalizeIdentityRefs(refs: { parentHumanId: string | undefined; planHumanId: string | undefined; links: FrontmatterLinkRef[] }): string {
  const sortedLinks = [...refs.links].sort((a, b) => (a.id === b.id ? a.type.localeCompare(b.type) : a.id.localeCompare(b.id)));
  return JSON.stringify({ parent: refs.parentHumanId ?? null, plan: refs.planHumanId ?? null, links: sortedLinks });
}

/**
 * Extracts the SAME identity-reference shape {@link computeFreshIdentityRefs} computes, but
 * read from an ALREADY-WRITTEN file's frontmatter — the on-disk half of the
 * task-unify-mirror-identifiers-on-zero-padded-form-export-all (2026-08-11) staleness
 * comparison. Same strict-frontmatter + `parseYaml` pattern as {@link extractFrontmatterId}.
 * Malformed/missing fields degrade to absent (`undefined`/empty array) rather than throwing —
 * this feeds a COMPARISON, never a write, so a parse gap should never abort the export run.
 *
 * @param mdContent - Full file content (as read from disk).
 * @returns The parsed refs, or `null` if the file has no strict frontmatter block or the
 *   frontmatter isn't valid YAML.
 */
function extractFrontmatterIdentityRefs(
  mdContent: string,
): { parentHumanId: string | undefined; planHumanId: string | undefined; links: FrontmatterLinkRef[] } | null {
  const normalized = mdContent.replace(/\r\n/g, "\n");
  const split = splitFrontmatter(normalized, "strict");
  if (!split.ok) return null;
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatter);
  } catch {
    return null;
  }
  if (!fm || typeof fm !== "object") return null;
  const record = fm as Record<string, unknown>;

  const parentHumanId = typeof record["parent"] === "string" ? record["parent"] : undefined;
  const planHumanId = typeof record["plan"] === "string" ? record["plan"] : undefined;

  const rawLinks = Array.isArray(record["links"]) ? record["links"] : [];
  const links: FrontmatterLinkRef[] = [];
  for (const item of rawLinks) {
    if (item !== null && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      if (typeof obj["id"] === "string" && typeof obj["type"] === "string") {
        links.push({ id: obj["id"], type: obj["type"] });
      }
    }
  }

  return { parentHumanId, planHumanId, links };
}

/**
 * The frontmatter SCALAR fields — every field {@link buildFrontmatterString} derives directly
 * and deterministically from `doc`'s own columns, EXCLUDING the identity fields
 * {@link FreshIdentityRefs} already covers (`id`/`parent`/`plan`/`links`) and the wall-clock
 * `created`/`updated` dates (deliberately excluded — see
 * {@link computeFreshScalarFields}'s own doc comment for why). This is the shape both
 * {@link computeFreshScalarFields} (current corpus truth) and
 * {@link extractFrontmatterScalarFields} (on-disk claim) produce, so the write loop's staleness
 * comparison (task-the-two-mirror-exporters-disagree-because-drift-detection, 2026-08-13) always
 * compares like with like.
 */
interface FrontmatterScalarFields {
  status: string;
  priority: string;
  title: string;
  tags: string[];
  phase: string | undefined;
}

/**
 * Computes the CURRENT, correct scalar frontmatter fields for `doc` — direct reads of the doc's
 * own columns, never a guess or a regex derivation (task-the-two-mirror-exporters-disagree-
 * because-drift-detection, 2026-08-13). Deliberately excludes `created`/`updated`: those track
 * wall-clock write time rather than a single corpus-authoritative FACT the way `status`/
 * `priority`/`title`/`tags`/`phase` do, so treating a same-run `updated_at` change as "frontmatter
 * drift" would make nearly every export touch nearly every file's mirror for no observable
 * reason beyond the date stamp — a noisy trigger nothing measured or asked for, unlike the other
 * five fields which have exactly one correct value at any moment and no legitimate reason to
 * ever disagree with the file that claims to mirror them.
 *
 * @param doc - Full DocRecord from corpus.
 */
function computeFreshScalarFields(doc: DocRecord): FrontmatterScalarFields {
  const phaseStr = typeof doc.extra["phase"] === "string" ? doc.extra["phase"] : undefined;
  return {
    status: doc.status,
    priority: doc.priority,
    title: doc.title,
    tags: [...doc.tags],
    phase: phaseStr,
  };
}

/**
 * Extracts the SAME scalar frontmatter shape {@link computeFreshScalarFields} computes, but read
 * from an ALREADY-WRITTEN file's frontmatter — the on-disk half of the
 * task-the-two-mirror-exporters-disagree-because-drift-detection (2026-08-13) staleness
 * comparison. Same strict-frontmatter + `parseYaml` pattern as
 * {@link extractFrontmatterIdentityRefs}, but STRICTER on the three fields
 * {@link buildFrontmatterString} unconditionally writes for every doc (`status`/`priority`/
 * `title`): a missing or wrong-typed value there means the frontmatter block itself cannot be
 * trusted, so this returns `null` (staleness UNDECIDABLE) rather than degrading those three to
 * an absent value the way {@link extractFrontmatterIdentityRefs} degrades its OPTIONAL fields —
 * a caller that silently read "no status field" as "not stale" would misreport an unreadable
 * file as clean (see `ExportReport.frontmatter_declined`'s own doc comment). `tags`/`phase` DO
 * degrade (to `[]`/`undefined`) on a missing/malformed value, matching `tags`' own optional-
 * looking-but-not-required shape in practice and `phase`'s genuinely optional one.
 *
 * @param mdContent - Full file content (as read from disk).
 * @returns The parsed scalar fields, or `null` if the file has no strict frontmatter block, the
 *   frontmatter isn't valid YAML, or `status`/`priority`/`title` is missing or not a string.
 */
function extractFrontmatterScalarFields(mdContent: string): FrontmatterScalarFields | null {
  const normalized = mdContent.replace(/\r\n/g, "\n");
  const split = splitFrontmatter(normalized, "strict");
  if (!split.ok) return null;
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatter);
  } catch {
    return null;
  }
  if (!fm || typeof fm !== "object") return null;
  const record = fm as Record<string, unknown>;

  const status = record["status"];
  const priority = record["priority"];
  const title = record["title"];
  if (typeof status !== "string" || typeof priority !== "string" || typeof title !== "string") {
    return null;
  }

  const rawTags = record["tags"];
  const tags = Array.isArray(rawTags) ? rawTags.filter((t): t is string => typeof t === "string") : [];
  const phase = typeof record["phase"] === "string" ? record["phase"] : undefined;

  return { status, priority, title, tags, phase };
}

/**
 * Canonical comparison string for a {@link FrontmatterScalarFields} value — used ONLY to compare
 * two scalar-field sets for equality, never written anywhere. `tags` is compared IN ORDER
 * (unlike {@link canonicalizeIdentityRefs}'s `links` sort): tags are a direct copy of `doc.tags`
 * on both sides (never independently re-ordered by a store join the way `findLinks` is), so an
 * order-sensitive comparison introduces no false-positive risk here.
 */
function canonicalizeScalarFields(fields: FrontmatterScalarFields): string {
  return JSON.stringify({
    status: fields.status,
    priority: fields.priority,
    title: fields.title,
    tags: fields.tags,
    phase: fields.phase ?? null,
  });
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
 * @param freshRefs - Pre-computed identity refs (see {@link computeFreshIdentityRefs}) — the
 *   caller computes this once and reuses it for both the staleness comparison and this write,
 *   so the two can never independently diverge.
 * @returns Frontmatter string including `---\n...\n---\n` delimiters.
 */
function buildFrontmatterString(
  doc: DocRecord,
  humanId: string,
  freshRefs: FreshIdentityRefs,
): string {
  const created = doc.created_at.split("T")[0] ?? doc.created_at;
  const updated = doc.updated_at.split("T")[0] ?? doc.updated_at;

  const { parentHumanId, planHumanId, links } = freshRefs;

  // Extra.phase string (legacy singular phase field, used by specs/tasks as label).
  const phaseStr =
    typeof doc.extra["phase"] === "string" ? doc.extra["phase"] : undefined;

  // Plans may declare an array of phases (SPEC-023).
  const phasesArr =
    doc.type === "plan" && Array.isArray(doc.extra["phases"]) && doc.extra["phases"].length > 0
      ? (doc.extra["phases"] as Array<{ name: string; description?: string }>)
      : undefined;

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
