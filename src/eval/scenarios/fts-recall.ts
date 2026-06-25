/**
 * Eval scenario: fts-recall.
 *
 * Evaluates the full-text search recall rate of the Lore corpus against a set
 * of known query/expected-slug pairs. For each query, the top-K search results
 * are checked for the presence of every expected document. The overall recall
 * rate must meet or exceed the pass_threshold (default 0.8) for the scenario to pass.
 *
 * Public surface:
 *   - FtsRecallQuerySchema + FtsRecallQuery   — single query + expected slugs
 *   - FtsRecallInputSchema  + FtsRecallInput  — scenario input (queries + threshold)
 *   - FtsRecallResultSchema + FtsRecallResult — structured result type (Zod SSOT)
 *   - DEFAULT_FTS_QUERIES   — curated default query fixtures for the lore corpus
 *   - DEFAULT_RECALL_THRESHOLD — 0.8 (SPEC-013 §7 row 1)
 *   - DEFAULT_TOP_K        — 5
 *   - runFtsRecall(input, app) → Promise<FtsRecallResult>
 *
 * Invariants:
 *   - Never throws — all errors surface as passed=false
 *   - Idempotent: same input + same app state ⇒ same output
 *   - Read-only: only queries app.corpusService, never mutates the corpus
 *
 * Side-effect class: IO (read-only calls to app.corpusService.search / resolve)
 *
 * Source: SPEC-013 §7 row 1
 */

import { z } from "zod";
import type { App } from "../../app.js";

// ─── Query Schema ──────────────────────────────────────────────────────────────

/**
 * A single FTS recall query: the search query string and the set of slugs
 * expected to appear in the top-K results.
 */
export const FtsRecallQuerySchema = z.object({
  /** The search query string to submit to corpusService.search */
  query: z.string().min(1),
  /**
   * Slugs of documents expected to be present in the top-K results.
   * Each slug is checked against the live corpus via corpusService.resolve;
   * slugs that do not resolve are counted as missing-expected (not an error).
   */
  expected_slugs: z.array(z.string().min(1)).min(1),
  /**
   * Override top-K for this specific query.
   * If absent, the scenario-level top_k is used.
   */
  top_k: z.number().int().positive().optional(),
});

export type FtsRecallQuery = z.infer<typeof FtsRecallQuerySchema>;

// ─── Input Schema ─────────────────────────────────────────────────────────────

/**
 * Input to the fts-recall scenario. All fields are optional —
 * omitting the whole input is equivalent to supplying defaults.
 */
export const FtsRecallInputSchema = z.object({
  /** Queries to evaluate. Defaults to DEFAULT_FTS_QUERIES. */
  queries: z.array(FtsRecallQuerySchema).optional(),
  /**
   * Minimum average recall required for the scenario to pass.
   * Range 0..1. Default: DEFAULT_RECALL_THRESHOLD (0.8).
   */
  pass_threshold: z.number().min(0).max(1).optional(),
  /**
   * Default number of search results to consider per query.
   * Per-query top_k overrides this. Default: DEFAULT_TOP_K (5).
   */
  top_k: z.number().int().positive().optional(),
});

export type FtsRecallInput = z.infer<typeof FtsRecallInputSchema>;

// ─── Result Schema (Zod SSOT) ─────────────────────────────────────────────────

/**
 * Per-query recall breakdown.
 */
const FtsRecallPerQuerySchema = z.object({
  /** The query string that was searched */
  query: z.string(),
  /** The expected slugs provided in the fixture */
  expected_slugs: z.array(z.string()),
  /**
   * Number of expected_slugs that resolved to a live doc in the corpus.
   * Expected slugs that do not resolve are treated as unfound and reduce recall.
   */
  resolved_expected_count: z.number().int().nonnegative(),
  /** Number of top results considered for this query */
  retrieved_top_k: z.number().int().nonnegative(),
  /** Intersection: how many expected docs appeared in the retrieved set */
  hits: z.number().int().nonnegative(),
  /**
   * recall = hits / resolved_expected_count.
   * 0 when resolved_expected_count === 0 (degenerate case).
   */
  recall: z.number().min(0).max(1),
  /** true if corpusService.search returned an error for this query */
  failed: z.boolean(),
  /**
   * true if resolved_expected_count === 0 (all expected slugs were absent from corpus).
   * Degenerate queries contribute recall=0.
   */
  degenerate: z.boolean(),
});

/**
 * Structured result of a single fts-recall scenario run.
 * Types derive from this schema; never add a separate interface.
 */
export const FtsRecallResultSchema = z.object({
  /** Total number of queries evaluated */
  total_queries: z.number().int().nonnegative(),
  /**
   * Average recall across all queries: sum(recall_i) / total_queries.
   * 0 when total_queries === 0.
   */
  avg_recall: z.number().min(0).max(1),
  /** The threshold used for pass/fail evaluation */
  pass_threshold: z.number().min(0).max(1),
  /** Per-query breakdown */
  per_query: z.array(FtsRecallPerQuerySchema),
  /** Wall-clock duration of the scenario in milliseconds */
  duration_ms: z.number().nonnegative(),
  /**
   * true iff avg_recall >= pass_threshold AND no per-query failed===true.
   * This is the single pass/fail gate for CI use. Source: SPEC-013 §7 row 1
   */
  passed: z.boolean(),
});

export type FtsRecallResult = z.infer<typeof FtsRecallResultSchema>;

// ─── Defaults ─────────────────────────────────────────────────────────────────

/**
 * Minimum average recall required for the scenario to pass. Source: SPEC-013 §7.
 */
export const DEFAULT_RECALL_THRESHOLD = 0.8 as const;

/**
 * Default number of search result hits to consider per query.
 */
export const DEFAULT_TOP_K = 5 as const;

/**
 * Curated default query fixtures for the self-dogfood lore corpus.
 *
 * Each query uses terms that appear verbatim in the corresponding spec body,
 * so FTS naturally surfaces the target document. Queries deliberately avoid
 * generic terms that would bleed across documents. Each query expects exactly
 * one slug (single-document recall — simpler to reason about).
 *
 * These are designed to remain robust across reasonable corpus drift.
 * If a slug disappears from the corpus the query is marked degenerate
 * (recall=0) rather than throwing. Source: SPEC-013 §7 row 1
 */
export const DEFAULT_FTS_QUERIES = [
  {
    query: "service layer dependency injection result",
    expected_slugs: ["spec-service-layer"],
  },
  {
    query: "MDX placeholder resolution outline",
    expected_slugs: ["spec-prd-as-living-root"],
  },
  {
    query: "review workflow approval status transition",
    expected_slugs: ["spec-review-workflow"],
  },
  {
    query: "version history diff restore append-only",
    expected_slugs: ["spec-version-history"],
  },
  {
    query: "v1 migration import YAML frontmatter",
    expected_slugs: ["spec-v1-migration"],
  },
  {
    query: "telemetry JSONL captures latency event",
    expected_slugs: ["spec-telemetry"],
  },
  {
    query: "eval framework scenario passed recall",
    expected_slugs: ["spec-eval-framework"],
  },
] as const satisfies ReadonlyArray<{ query: string; expected_slugs: string[] }>;

// ─── Main Eval Function ───────────────────────────────────────────────────────

/**
 * Run the fts-recall eval scenario against a wired App instance.
 *
 * For each query in input.queries (default = DEFAULT_FTS_QUERIES):
 *   1. Calls app.corpusService.search to get top-K results.
 *   2. Resolves each expected_slug to a live DocId via app.corpusService.resolve.
 *   3. Computes recall = |retrieved ∩ resolved_expected| / |resolved_expected|.
 *
 * The function never throws. Any service error surfaces as passed=false.
 *
 * @param input - Optional scenario configuration; undefined uses all defaults
 * @param app - Wired App instance; only corpusService is accessed (read-only)
 * @returns Structured recall result
 *
 * @example
 * const result = await runFtsRecall(undefined, app);
 * if (!result.passed) process.exit(1);
 */
export async function runFtsRecall(
  input: FtsRecallInput | undefined,
  app: App,
): Promise<FtsRecallResult> {
  const startMs = Date.now();

  // reason: cast to ReadonlyArray<FtsRecallQuery> so that both user-supplied queries
  // (which have optional top_k) and DEFAULT_FTS_QUERIES (which omit top_k entirely
  // due to "as const") are treated uniformly by the loop below.
  const queries: ReadonlyArray<FtsRecallQuery> = input?.queries ?? DEFAULT_FTS_QUERIES;
  const passThreshold = input?.pass_threshold ?? DEFAULT_RECALL_THRESHOLD;
  const scenarioTopK = input?.top_k ?? DEFAULT_TOP_K;

  // Empty query list is a degenerate-but-valid case — avg_recall=0 fails the gate
  if (queries.length === 0) {
    return FtsRecallResultSchema.parse({
      total_queries: 0,
      avg_recall: 0,
      pass_threshold: passThreshold,
      per_query: [],
      duration_ms: Date.now() - startMs,
      // reason: 0 queries → avg_recall=0 → 0 < threshold → false (conservative)
      passed: false,
    });
  }

  const perQueryResults: z.infer<typeof FtsRecallPerQuerySchema>[] = [];
  let anyFailed = false;

  for (const queryFixture of queries) {
    const topK = queryFixture.top_k ?? scenarioTopK;

    // ── Step 1: Execute search ──────────────────────────────────────────────
    const searchResult = await app.corpusService.search(queryFixture.query, {});

    if (!searchResult.ok) {
      // Search failed entirely — record as failed query, recall=0
      anyFailed = true;
      perQueryResults.push({
        query: queryFixture.query,
        expected_slugs: [...queryFixture.expected_slugs],
        resolved_expected_count: 0,
        retrieved_top_k: topK,
        hits: 0,
        recall: 0,
        failed: true,
        degenerate: false,
      });
      continue;
    }

    // ── Step 2: Collect retrieved IDs (top-K) ──────────────────────────────
    const retrievedIds = new Set<string>(
      searchResult.value.results.slice(0, topK).map((hit) => hit.id),
    );

    // ── Step 3: Resolve expected slugs to DocIds ────────────────────────────
    const resolvedExpectedIds: string[] = [];
    for (const slug of queryFixture.expected_slugs) {
      const resolveResult = await app.corpusService.resolve(slug);
      if (resolveResult.ok) {
        resolvedExpectedIds.push(resolveResult.value);
      }
      // reason: slug absent from corpus → treat as missing-expected, NOT a hard error.
      // Corpus evolves; eval must degrade gracefully rather than throw (SPEC-013 §2).
    }

    const resolvedExpectedCount = resolvedExpectedIds.length;

    // ── Step 4: Compute recall for this query ───────────────────────────────
    const isDegenerate = resolvedExpectedCount === 0;

    let recall = 0;
    let hits = 0;
    if (!isDegenerate) {
      for (const expectedId of resolvedExpectedIds) {
        if (retrievedIds.has(expectedId)) {
          hits += 1;
        }
      }
      recall = hits / resolvedExpectedCount;
    }

    perQueryResults.push({
      query: queryFixture.query,
      expected_slugs: [...queryFixture.expected_slugs],
      resolved_expected_count: resolvedExpectedCount,
      retrieved_top_k: topK,
      hits,
      recall,
      failed: false,
      degenerate: isDegenerate,
    });
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const totalQueries = perQueryResults.length;
  const avgRecall =
    totalQueries > 0
      ? perQueryResults.reduce((sum, q) => sum + q.recall, 0) / totalQueries
      : 0;

  // reason: failed queries (search error) block pass — a search system that errors
  // on any query has not demonstrated adequate recall, regardless of the average.
  const passed = avgRecall >= passThreshold && !anyFailed;

  return FtsRecallResultSchema.parse({
    total_queries: totalQueries,
    avg_recall: avgRecall,
    pass_threshold: passThreshold,
    per_query: perQueryResults,
    duration_ms: Date.now() - startMs,
    passed,
  });
}
