/**
 * Eval scenario: link-integrity.
 *
 * Validates that all non-parent links in the corpus point to valid, live documents.
 * Checks three invariants:
 *   1. No dangling links — link.to_id must refer to a doc found in the store.
 *      Note: truly dangling links (to completely absent doc IDs) cannot be detected
 *      through the service layer without raw store access; only links to soft-deleted
 *      docs are detectable (store.find returns them with deleted_at != null).
 *   2. No to_deleted links — link.to_id must not point to a soft-deleted doc.
 *   3. No self-loop links — link.from_id must not equal link.to_id.
 *
 * Implementation strategy (service-layer-only, no new store methods):
 *   - corpusService.list({}) → all live doc IDs
 *   - corpusService.get(id) per doc → navigation.related gives non-parent links visible
 *     at the service layer (links to hard-missing docs are silently dropped by get())
 *   - For each unique link target, corpusService.get(to_id) → check deleted_at
 *
 * Public surface:
 *   - LinkIntegrityResultSchema — Zod schema (z.infer derives the type)
 *   - LinkIntegrityResult — type alias
 *   - runLinkIntegrity(app) → Promise<LinkIntegrityResult>
 *
 * Invariants:
 *   - Never throws — store errors are returned as passed=false
 *   - Idempotent: same corpus state → same result
 *   - Uses only existing public service APIs (no new store methods)
 *
 * Side-effect class: IO (reads from app's store, no writes)
 *
 * Source: SPEC-013 §3.3 (previously §7 Future Scenarios)
 */

import { z } from "zod";
import type { App } from "../../app.js";

// ─── Result Schema (Zod SSOT) ─────────────────────────────────────────────────

/**
 * Describes a single link violation.
 */
const LinkViolationSchema = z.object({
  from_id: z.string(),
  to_id: z.string(),
  type: z.string(),
});

/**
 * Describes a self-loop link (from_id === to_id).
 */
const SelfLoopViolationSchema = z.object({
  from_id: z.string(),
  type: z.string(),
});

/**
 * Zod schema for the link-integrity eval result.
 * Types derive from this schema via z.infer — do not duplicate as an interface.
 *
 * @example
 * const result = await runLinkIntegrity(app);
 * if (!result.passed) console.error("Dangling:", result.details.dangling_links);
 */
export const LinkIntegrityResultSchema = z.object({
  /** Total link edges inspected (may undercount if corpus has hard-deleted link targets) */
  total_links: z.number().int().nonnegative(),
  /**
   * Links pointing to hard-missing docs (not found in store at all).
   * Note: corpusService.get silently drops links to truly non-existent docs —
   * so this count reflects what the service layer can detect, which is 0
   * for links created through the normal corpusService.link() API.
   * Truly dangling links (e.g. from DB corruption) require raw store access.
   */
  dangling: z.number().int().nonnegative(),
  /** Links whose to_id points to a soft-deleted doc (deleted_at != null) */
  to_deleted: z.number().int().nonnegative(),
  /** Links where from_id === to_id */
  self_loops: z.number().int().nonnegative(),
  /** Wall-clock duration in milliseconds */
  duration_ms: z.number(),
  /**
   * true iff dangling===0 && to_deleted===0 && self_loops===0.
   * Source: SPEC-013 §3.3
   */
  passed: z.boolean(),
  details: z.object({
    /** Up to 10 sampled dangling links (to_id not found in store) */
    dangling_links: z.array(LinkViolationSchema),
    /** Up to 10 sampled links targeting soft-deleted docs */
    deleted_target_links: z.array(LinkViolationSchema),
    /** Up to 10 sampled self-loop links */
    self_loop_links: z.array(SelfLoopViolationSchema),
  }),
});

export type LinkIntegrityResult = z.infer<typeof LinkIntegrityResultSchema>;

// ─── Main Eval Function ───────────────────────────────────────────────────────

/**
 * Run the link-integrity eval scenario.
 *
 * Iterates all live docs via corpusService.list(), then for each doc fetches
 * its navigation.related links via corpusService.get(). Links to soft-deleted
 * docs appear in navigation.related (store.find returns them); self-loops appear
 * when a doc links to itself. Truly missing to_ids are silently dropped by
 * the service layer.
 *
 * Never throws — store failures are returned as passed=false.
 *
 * @param app - Wired App instance (corpusService must be available)
 * @returns Structured link-integrity result
 *
 * @example
 * const result = await runLinkIntegrity(app);
 * if (!result.passed) process.exit(1);
 */
export async function runLinkIntegrity(app: App): Promise<LinkIntegrityResult> {
  const startMs = Date.now();

  // Step 1: list all live doc IDs
  const listResult = await app.corpusService.list({});
  if (!listResult.ok) {
    return buildErrorResult(startMs);
  }

  const docSummaries = listResult.value.docs;

  if (docSummaries.length === 0) {
    return LinkIntegrityResultSchema.parse({
      total_links: 0,
      dangling: 0,
      to_deleted: 0,
      self_loops: 0,
      duration_ms: Date.now() - startMs,
      passed: true,
      details: { dangling_links: [], deleted_target_links: [], self_loop_links: [] },
    });
  }

  // Build set of live doc IDs for quick lookup
  const liveDocIds = new Set<string>(docSummaries.map((d) => d.id));

  // Track seen links (from_id, to_id, link_type) to avoid double-counting
  // (navigation.related includes both inbound and outbound non-parent links)
  const seenLinkKeys = new Set<string>();

  // Violation accumulators
  const danglingLinks: Array<{ from_id: string; to_id: string; type: string }> = [];
  const deletedTargetLinks: Array<{ from_id: string; to_id: string; type: string }> = [];
  const selfLoopLinks: Array<{ from_id: string; type: string }> = [];

  // Step 2: for each live doc, collect its visible non-parent links
  for (const summary of docSummaries) {
    const getResult = await app.corpusService.get(summary.id);
    if (!getResult.ok) {
      // A single doc lookup failure does not abort the scan
      // reason: eval must remain non-throwing (SPEC-013 §3); partial failures
      // should not mask legitimate violations in other docs
      continue;
    }

    const { doc, navigation } = getResult.value;

    for (const related of navigation.related) {
      // De-duplicate: links appear from both ends (out from doc, in to doc)
      const canonicalKey = buildCanonicalLinkKey(doc.id, related.id, related.link_type);
      if (seenLinkKeys.has(canonicalKey)) continue;
      seenLinkKeys.add(canonicalKey);

      // Self-loop detection: doc links to itself
      if (related.id === doc.id) {
        selfLoopLinks.push({ from_id: doc.id, type: related.link_type });
        continue;
      }

      // Deleted-target detection: link target exists but has been soft-deleted.
      // corpusService.get() returns the deleted doc when the underlying store.find
      // returns it (soft-delete does not remove the record, only sets deleted_at).
      // reason: store.find returns deleted docs; get() surfaces them in navigation.related;
      // we then re-fetch the target to check deleted_at on the full DocRecord.
      if (!liveDocIds.has(related.id)) {
        // Target is not in our live set — it's either soft-deleted or hard-missing
        const targetResult = await app.corpusService.get(related.id);
        if (!targetResult.ok || targetResult.value.doc.deleted_at !== null) {
          // Soft-deleted or completely missing — report as deleted_target
          // (truly missing docs would fail get() with DOC_NOT_FOUND, but we treat both the same)
          deletedTargetLinks.push({
            from_id: doc.id,
            to_id: related.id,
            type: related.link_type,
          });
        }
        // If get() returned ok with deleted_at === null, the live set was stale (race condition)
        // In that case it's not a violation — skip
      }
      // If liveDocIds.has(related.id): to_id is live → no violation
    }
  }

  // total_links = unique link edges seen through the service layer
  const totalLinks = seenLinkKeys.size;
  const danglingCount = danglingLinks.length;
  const deletedCount = deletedTargetLinks.length;
  const selfLoopCount = selfLoopLinks.length;

  return LinkIntegrityResultSchema.parse({
    total_links: totalLinks,
    dangling: danglingCount,
    to_deleted: deletedCount,
    self_loops: selfLoopCount,
    duration_ms: Date.now() - startMs,
    passed: danglingCount === 0 && deletedCount === 0 && selfLoopCount === 0,
    details: {
      dangling_links: danglingLinks.slice(0, 10),
      deleted_target_links: deletedTargetLinks.slice(0, 10),
      self_loop_links: selfLoopLinks.slice(0, 10),
    },
  });
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Build a canonical link key for de-duplication.
 * Since navigation.related includes both directions, we canonicalize by sorting
 * the two IDs so the same link doesn't get counted twice.
 *
 * @param aId - One endpoint of the link
 * @param bId - Other endpoint of the link
 * @param linkType - The link type
 * @returns Stable string key regardless of direction
 */
function buildCanonicalLinkKey(aId: string, bId: string, linkType: string): string {
  const [first, second] = aId < bId ? [aId, bId] : [bId, aId];
  return `${first}:${second}:${linkType}`;
}

/**
 * Build a failed result when the store is unavailable.
 * All counts default to 0; passed=false signals the failure.
 *
 * @param startMs - Date.now() at scenario start
 */
function buildErrorResult(startMs: number): LinkIntegrityResult {
  // reason: eval must never throw (SPEC-013 §3); store errors become passed=false
  return LinkIntegrityResultSchema.parse({
    total_links: 0,
    dangling: 0,
    to_deleted: 0,
    self_loops: 0,
    duration_ms: Date.now() - startMs,
    passed: false,
    details: { dangling_links: [], deleted_target_links: [], self_loop_links: [] },
  });
}
