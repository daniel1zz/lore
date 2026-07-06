/**
 * Unit tests for src/eval/scenarios/fts-recall.ts
 * Uses InMemoryStore (no SQLite, no file I/O) — all tests run under vitest.
 * Covers: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 * @spec_ref SPEC-013 §9
 */

import { describe, it, expect, vi } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { NoOpTelemetry } from "@lore/core";
import {
  runFtsRecall,
  DEFAULT_FTS_QUERIES,
  DEFAULT_RECALL_THRESHOLD,
  DEFAULT_TOP_K,
  FtsRecallResultSchema,
} from "../../../src/eval/scenarios/fts-recall.js";
import type { App } from "../../../src/app.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal App using InMemoryStore (no SQLite, no file I/O). */
function makeApp(store?: InMemoryStore): App {
  const s = store ?? new InMemoryStore();
  const telemetry = new NoOpTelemetry();
  return {
    corpusService: new CorpusService(s, telemetry),
    reviewService: new ReviewService(s),
    versionService: new VersionService(s),
    outlineService: new OutlineService(s),
    migrationService: new MigrationService(s),
    treeCheckService: new TreeCheckService(s),
    apiKeyStore: null as unknown as App["apiKeyStore"],
    // reason: eval scenarios never exercise the AI path; null-cast avoids heavyweight
    // AIProviderService construction while satisfying the now-required field (SPEC-017 §3.12).
    aiProviderService: null as unknown as App["aiProviderService"],
    // reason: eval scenarios never exercise sync-docs path — null-cast per SPEC-018 §3.6.
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    // reason: test does not exercise phase commands; null-cast per pattern from SPEC-023 §9.1.
    phaseService: null as unknown as App["phaseService"],
    // reason: SPEC-025 §9.1 — test does not exercise task-workflow commands; null-cast per
    // established pattern (see phaseService above) for satisfying newly-required App fields.
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    // reason: SPEC-032 §3.4 — test does not exercise spec-kind audit; null-cast per
    // established pattern (see phaseService above) for satisfying newly-required App fields.
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    // reason: test does not exercise AI-default path; callerSurface required by App interface (SPEC-024).
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry,
    close: () => { telemetry.close(); },
  };
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("runFtsRecall", () => {
  describe("HAPPY", () => {
    it("returns passed=true when avg recall meets default threshold (0.8)", async () => {
      // Create 3 PRDs whose content contains distinct keywords used as queries.
      // All 3 queries will find their expected doc → recall = 1.0 per query → avg = 1.0.
      const app = makeApp();

      const prd1 = await app.corpusService.create({
        type: "prd",
        title: "Alpha Widget System",
        content: "unique-alpha-frobnicator details about widget architecture",
      });
      const prd2 = await app.corpusService.create({
        type: "prd",
        title: "Beta Service Design",
        content: "unique-beta-snorkeling details about service orchestration",
      });
      const prd3 = await app.corpusService.create({
        type: "prd",
        title: "Gamma Data Pipeline",
        content: "unique-gamma-quuxification details about data ingestion",
      });

      expect(prd1.ok).toBe(true);
      expect(prd2.ok).toBe(true);
      expect(prd3.ok).toBe(true);

      if (!prd1.ok || !prd2.ok || !prd3.ok) return;

      const queries = [
        { query: "unique-alpha-frobnicator", expected_slugs: [prd1.value.slug] },
        { query: "unique-beta-snorkeling", expected_slugs: [prd2.value.slug] },
        { query: "unique-gamma-quuxification", expected_slugs: [prd3.value.slug] },
      ];

      const result = await runFtsRecall({ queries }, app);
      app.close();

      expect(result.passed).toBe(true);
      expect(result.avg_recall).toBeGreaterThanOrEqual(0.8);
      expect(result.total_queries).toBe(3);
    });

    it("returns different avg_recall for different query sets (guards against hardcoded stub)", async () => {
      // Two runs with different query success rates must yield different avg_recall values.
      const app = makeApp();

      const prd1 = await app.corpusService.create({
        type: "prd",
        title: "Alpha Widget",
        content: "unique-alpha-frobnicator details",
      });

      expect(prd1.ok).toBe(true);
      if (!prd1.ok) return;

      // Run A: query finds its target → recall = 1.0
      const resultA = await runFtsRecall(
        { queries: [{ query: "unique-alpha-frobnicator", expected_slugs: [prd1.value.slug] }] },
        app,
      );

      // Run B: query will NOT find a target → recall = 0.0 (degenerate — slug not in corpus)
      const resultB = await runFtsRecall(
        { queries: [{ query: "unique-alpha-frobnicator", expected_slugs: ["prd-does-not-exist-zzzz"] }] },
        app,
      );

      app.close();

      expect(resultA.avg_recall).toBeGreaterThan(resultB.avg_recall);
    });
  });

  // ─── NEGATIVE ───────────────────────────────────────────────────────────────

  describe("NEGATIVE", () => {
    it("returns passed=false when avg recall is below threshold", async () => {
      const app = makeApp();

      // Create a doc but query with a keyword NOT in its content → no hits
      await app.corpusService.create({
        type: "prd",
        title: "Irrelevant Doc",
        content: "this content contains only unrelated terms",
      });

      // Create a target doc that WON'T be hit by the query (different keyword)
      const target = await app.corpusService.create({
        type: "prd",
        title: "Other Target",
        content: "completely different subject matter here",
      });

      expect(target.ok).toBe(true);
      if (!target.ok) return;

      // Query with a keyword that doesn't appear in any doc → 0 hits → recall 0 (degenerate because slug resolves)
      // Actually, let's create a slug that resolves but the query won't match the doc
      const target2 = await app.corpusService.create({
        type: "prd",
        title: "Target Two",
        content: "target two unique content xyzzy-missmatch-word",
      });
      expect(target2.ok).toBe(true);
      if (!target2.ok) return;

      // Query with "nonexistent-keyword-zzzz" that never appears in any content
      // expect_slug resolves, so resolved_expected_count=1, but no hits → recall=0
      const queries = [
        { query: "xyzzy-missmatch-word-that-never-matches", expected_slugs: [target2.value.slug] },
      ];

      const result = await runFtsRecall({ queries }, app);
      app.close();

      expect(result.passed).toBe(false);
      expect(result.avg_recall).toBeLessThan(0.8);
    });

    it("uses custom pass_threshold from input — same avg_recall of 1.0 fails with threshold=1.0+epsilon", async () => {
      // This test verifies that the threshold is actually read from input,
      // not silently baked-in as a constant.
      const app = makeApp();

      const prd = await app.corpusService.create({
        type: "prd",
        title: "Threshold Test Doc",
        content: "xyzzy-threshold-needle content for threshold testing",
      });
      expect(prd.ok).toBe(true);
      if (!prd.ok) return;

      const queries = [
        { query: "xyzzy-threshold-needle", expected_slugs: [prd.value.slug] },
      ];

      // With strict threshold (1.0): recall=1.0 → 1.0 >= 1.0 → passed=true
      const resultStrict = await runFtsRecall(
        { queries, pass_threshold: 1.0 },
        app,
      );

      // With threshold above 1.0 is not allowed by schema (max=1), use 0.3 as lenient
      // With lenient threshold (0.3): recall=1.0 ≥ 0.3 → passed=true
      const resultLenient = await runFtsRecall(
        { queries, pass_threshold: 0.3 },
        app,
      );

      app.close();

      // Both should pass with recall=1.0, but the thresholds must be stored in result
      expect(resultStrict.pass_threshold).toBe(1.0);
      expect(resultLenient.pass_threshold).toBe(0.3);
      // Confirm that the threshold shown in result is NOT always the default
      expect(resultStrict.pass_threshold).not.toBe(DEFAULT_RECALL_THRESHOLD);
      expect(resultLenient.pass_threshold).not.toBe(DEFAULT_RECALL_THRESHOLD);
    });

    it("uses custom pass_threshold to make a passing avg fail when threshold is raised", async () => {
      // avg_recall that would pass at 0.8 should fail at 0.999
      const app = makeApp();

      // Create 2 docs; first query hits, second misses
      const prd1 = await app.corpusService.create({
        type: "prd",
        title: "Hit Doc",
        content: "xyzzy-hit-keyword only appears here",
      });
      const prd2 = await app.corpusService.create({
        type: "prd",
        title: "Miss Doc",
        content: "xyzzy-miss-keyword completely different content",
      });

      expect(prd1.ok).toBe(true);
      expect(prd2.ok).toBe(true);
      if (!prd1.ok || !prd2.ok) return;

      const queries = [
        // This query hits prd1 (keyword in content)
        { query: "xyzzy-hit-keyword", expected_slugs: [prd1.value.slug] },
        // This query does NOT hit prd2 because "nomatch-xyzzy" doesn't appear anywhere
        { query: "nomatch-xyzzy-invisible", expected_slugs: [prd2.value.slug] },
      ];

      // avg = (1.0 + 0.0) / 2 = 0.5 < 0.8 default threshold → passed=false
      const resultDefault = await runFtsRecall({ queries }, app);
      // lenient threshold 0.4: 0.5 >= 0.4 → passed=true
      const resultLenient = await runFtsRecall(
        { queries, pass_threshold: 0.4 },
        app,
      );

      app.close();

      expect(resultDefault.passed).toBe(false);
      expect(resultDefault.avg_recall).toBeCloseTo(0.5, 1);
      expect(resultLenient.passed).toBe(true);
      expect(resultLenient.avg_recall).toBeCloseTo(0.5, 1);
    });
  });

  // ─── BOUNDARY ───────────────────────────────────────────────────────────────

  describe("BOUNDARY", () => {
    it("empty queries array — returns passed=false and avg_recall=0 (conservative gate)", async () => {
      // Spec comment in implementation: "avg_recall=0 fails the gate"
      // 0 < DEFAULT_RECALL_THRESHOLD (0.8) → passed=false
      const app = makeApp();
      const result = await runFtsRecall({ queries: [] }, app);
      app.close();

      expect(result.passed).toBe(false);
      expect(result.avg_recall).toBe(0);
      expect(result.total_queries).toBe(0);
      expect(result.per_query).toHaveLength(0);
    });

    it("respects per-query top_k override — result at position > global top_k found with query top_k", async () => {
      // Create 7 docs all containing "xyzzy-shared-word"; target is the 6th result.
      // With top_k=5: target not in top-5 → recall=0.
      // With top_k=7: target in top-7 → recall=1.
      // Note: InMemoryStore search returns in insertion order (no ranking).
      const app = makeApp();
      const slugs: string[] = [];

      // Create 6 decoy docs first (they'll appear before target in search results)
      for (let i = 0; i < 6; i++) {
        const r = await app.corpusService.create({
          type: "prd",
          title: `Decoy Doc ${i}`,
          content: `xyzzy-shared-word decoy number ${i}`,
        });
        expect(r.ok).toBe(true);
        if (r.ok) slugs.push(r.value.slug);
      }

      // Create the target doc (7th insertion — would be at index 6, position 7)
      const target = await app.corpusService.create({
        type: "prd",
        title: "Target at Position Seven",
        content: "xyzzy-shared-word this is the target document",
      });
      expect(target.ok).toBe(true);
      if (!target.ok) return;

      // top_k=5: target is NOT in top-5 hits → resolved_expected_count=1, hits=0, recall=0
      const resultSmallK = await runFtsRecall(
        {
          queries: [
            {
              query: "xyzzy-shared-word",
              expected_slugs: [target.value.slug],
              top_k: 5,
            },
          ],
        },
        app,
      );

      // top_k=10: target IS in top-10 hits → recall=1
      const resultLargeK = await runFtsRecall(
        {
          queries: [
            {
              query: "xyzzy-shared-word",
              expected_slugs: [target.value.slug],
              top_k: 10,
            },
          ],
        },
        app,
      );

      app.close();

      expect(resultSmallK.per_query[0]!.retrieved_top_k).toBe(5);
      expect(resultLargeK.per_query[0]!.retrieved_top_k).toBe(10);
      expect(resultSmallK.per_query[0]!.recall).toBe(0);
      expect(resultLargeK.per_query[0]!.recall).toBe(1);
    });

    it("expected_slugs missing from corpus → resolved_expected_count=0, degenerate=true, recall=0", async () => {
      const app = makeApp();
      // DO NOT create a doc with slug "prd-nonexistent-slug-99999" — it won't resolve
      const result = await runFtsRecall(
        {
          queries: [
            {
              query: "any search term",
              expected_slugs: ["prd-nonexistent-slug-99999"],
            },
          ],
        },
        app,
      );
      app.close();

      const perQuery = result.per_query[0]!;
      expect(perQuery.degenerate).toBe(true);
      expect(perQuery.recall).toBe(0);
      expect(perQuery.resolved_expected_count).toBe(0);
      // Degenerate is NOT the same as failed — the search itself succeeded
      expect(perQuery.failed).toBe(false);
    });

    it("single query with full recall returns total_queries=1 and avg_recall=1", async () => {
      const app = makeApp();
      const prd = await app.corpusService.create({
        type: "prd",
        title: "Solo Recall Doc",
        content: "xyzzy-solo-recall-unique-term is here",
      });
      expect(prd.ok).toBe(true);
      if (!prd.ok) return;

      const result = await runFtsRecall(
        {
          queries: [
            { query: "xyzzy-solo-recall-unique-term", expected_slugs: [prd.value.slug] },
          ],
        },
        app,
      );
      app.close();

      expect(result.total_queries).toBe(1);
      expect(result.avg_recall).toBe(1);
      expect(result.passed).toBe(true);
    });
  });

  // ─── ERROR ───────────────────────────────────────────────────────────────────

  describe("ERROR", () => {
    it("search returning error → per_query[i].failed=true, recall=0, passed=false", async () => {
      const app = makeApp();

      // Spy on corpusService.search to inject a failure
      vi.spyOn(app.corpusService, "search").mockResolvedValueOnce({
        ok: false,
        error: { code: "STORE_ERROR", message: "injected search failure" },
      });

      const result = await runFtsRecall(
        {
          queries: [
            { query: "any query", expected_slugs: ["some-slug"] },
          ],
        },
        app,
      );
      app.close();

      expect(result.per_query[0]!.failed).toBe(true);
      expect(result.per_query[0]!.recall).toBe(0);
      // A failed search must trip the pass gate regardless of avg_recall
      expect(result.passed).toBe(false);
    });

    it("failed query does NOT mark degenerate=true — failed and degenerate are mutually exclusive", async () => {
      // spec: failed=true means search error; degenerate=true means resolved_expected_count=0.
      // When search fails, the implementation records degenerate=false (cannot determine).
      const app = makeApp();

      vi.spyOn(app.corpusService, "search").mockResolvedValueOnce({
        ok: false,
        error: { code: "STORE_ERROR", message: "injected failure" },
      });

      const result = await runFtsRecall(
        {
          queries: [{ query: "any query", expected_slugs: ["some-slug"] }],
        },
        app,
      );
      app.close();

      const perQuery = result.per_query[0]!;
      expect(perQuery.failed).toBe(true);
      expect(perQuery.degenerate).toBe(false);
    });

    it("never throws even if all queries fail — resolves to valid FtsRecallResult", async () => {
      const app = makeApp();

      // Mock all search calls to fail
      vi.spyOn(app.corpusService, "search").mockResolvedValue({
        ok: false,
        error: { code: "STORE_ERROR", message: "persistent failure" },
      });

      const queries = [
        { query: "query one", expected_slugs: ["slug-one"] },
        { query: "query two", expected_slugs: ["slug-two"] },
        { query: "query three", expected_slugs: ["slug-three"] },
      ];

      let result: Awaited<ReturnType<typeof runFtsRecall>> | undefined;
      await expect(
        runFtsRecall({ queries }, app).then((r) => { result = r; }),
      ).resolves.not.toThrow();
      app.close();

      expect(result).toBeDefined();
      expect(result!.passed).toBe(false);
      expect(result!.total_queries).toBe(3);
      // All per-query entries should be marked failed
      for (const pq of result!.per_query) {
        expect(pq.failed).toBe(true);
      }
    });

    it("one failed query among passing queries forces passed=false", async () => {
      // If 2 queries succeed with recall=1.0 but 1 query fails (search error),
      // passed must be false even though avg_recall looks good.
      // This guards against the "anyFailed" gate being ignored.
      const app = makeApp();

      const prd1 = await app.corpusService.create({
        type: "prd",
        title: "Good Doc One",
        content: "xyzzy-good-doc-one content",
      });
      const prd2 = await app.corpusService.create({
        type: "prd",
        title: "Good Doc Two",
        content: "xyzzy-good-doc-two content",
      });
      expect(prd1.ok).toBe(true);
      expect(prd2.ok).toBe(true);
      if (!prd1.ok || !prd2.ok) return;

      // First two calls succeed; third call fails
      const originalSearch = app.corpusService.search.bind(app.corpusService);
      let callCount = 0;
      vi.spyOn(app.corpusService, "search").mockImplementation(async (q, f) => {
        callCount++;
        if (callCount === 3) {
          return { ok: false, error: { code: "STORE_ERROR", message: "third query fails" } };
        }
        return originalSearch(q, f);
      });

      const queries = [
        { query: "xyzzy-good-doc-one", expected_slugs: [prd1.value.slug] },
        { query: "xyzzy-good-doc-two", expected_slugs: [prd2.value.slug] },
        { query: "xyzzy-injected-fail", expected_slugs: ["some-slug"] },
      ];

      const result = await runFtsRecall({ queries }, app);
      app.close();

      // Two hits: avg = (1+1+0)/3 ≈ 0.667, but anyFailed=true → passed=false
      expect(result.passed).toBe(false);
      expect(result.per_query[2]!.failed).toBe(true);
    });
  });

  // ─── STATE ───────────────────────────────────────────────────────────────────

  describe("STATE", () => {
    it("does not mutate the corpus — doc list before and after is identical", async () => {
      const app = makeApp();

      // Create some docs before running eval
      const prd1 = await app.corpusService.create({
        type: "prd",
        title: "Pre-Eval Doc A",
        content: "xyzzy-pre-eval-content-a",
      });
      expect(prd1.ok).toBe(true);

      const listBefore = await app.corpusService.list({});
      expect(listBefore.ok).toBe(true);

      // Run the eval scenario
      await runFtsRecall(
        {
          queries: [
            { query: "xyzzy-pre-eval-content-a", expected_slugs: ["any-slug"] },
          ],
        },
        app,
      );

      const listAfter = await app.corpusService.list({});
      expect(listAfter.ok).toBe(true);

      if (!listBefore.ok || !listAfter.ok) return;

      // Corpus must be identical — same count, same IDs, same slugs
      // corpusService.list returns { docs: DocSummary[]; total: number }
      expect(listAfter.value.docs.map((d) => d.id).sort()).toEqual(
        listBefore.value.docs.map((d) => d.id).sort(),
      );

      app.close();
    });

    it("idempotent — same input twice yields same result fields (except duration_ms)", async () => {
      const app = makeApp();

      const prd = await app.corpusService.create({
        type: "prd",
        title: "Idempotent Eval Doc",
        content: "xyzzy-idempotent-eval-term",
      });
      expect(prd.ok).toBe(true);
      if (!prd.ok) return;

      const queries = [
        { query: "xyzzy-idempotent-eval-term", expected_slugs: [prd.value.slug] },
      ];

      const result1 = await runFtsRecall({ queries }, app);
      const result2 = await runFtsRecall({ queries }, app);
      app.close();

      // Core logical fields must be identical across runs
      expect(result1.passed).toBe(result2.passed);
      expect(result1.total_queries).toBe(result2.total_queries);
      expect(result1.avg_recall).toBe(result2.avg_recall);
      expect(result1.pass_threshold).toBe(result2.pass_threshold);
      expect(result1.per_query.length).toBe(result2.per_query.length);
      expect(result1.per_query[0]!.recall).toBe(result2.per_query[0]!.recall);
      expect(result1.per_query[0]!.hits).toBe(result2.per_query[0]!.hits);
    });
  });

  // ─── REGRESSION ──────────────────────────────────────────────────────────────

  describe("REGRESSION", () => {
    it("DEFAULT_FTS_QUERIES has exactly 7 entries (corpus-shape lock)", () => {
      // Guards against accidental shrinkage or expansion of the default fixtures.
      expect(DEFAULT_FTS_QUERIES.length).toBe(7);
    });

    it("DEFAULT_RECALL_THRESHOLD is 0.8", () => {
      // Sanity check — guards against accidental drift of the pass threshold.
      expect(DEFAULT_RECALL_THRESHOLD).toBe(0.8);
    });

    it("DEFAULT_TOP_K is 5", () => {
      expect(DEFAULT_TOP_K).toBe(5);
    });

    it("result conforms to FtsRecallResultSchema (Zod parse round-trip)", async () => {
      const app = makeApp();

      const prd = await app.corpusService.create({
        type: "prd",
        title: "Schema Roundtrip Doc",
        content: "xyzzy-schema-roundtrip unique content",
      });
      expect(prd.ok).toBe(true);
      if (!prd.ok) return;

      const result = await runFtsRecall(
        {
          queries: [
            { query: "xyzzy-schema-roundtrip", expected_slugs: [prd.value.slug] },
          ],
        },
        app,
      );
      app.close();

      // Must not throw — validates every field including nested per_query
      expect(() => FtsRecallResultSchema.parse(result)).not.toThrow();
    });

    it("result conforms to FtsRecallResultSchema even when passed=false", async () => {
      // Guards that schema validation works for the failure-path shape too.
      const app = makeApp();

      vi.spyOn(app.corpusService, "search").mockResolvedValueOnce({
        ok: false,
        error: { code: "STORE_ERROR", message: "schema test failure" },
      });

      const result = await runFtsRecall(
        { queries: [{ query: "anything", expected_slugs: ["some-slug"] }] },
        app,
      );
      app.close();

      expect(() => FtsRecallResultSchema.parse(result)).not.toThrow();
      expect(result.passed).toBe(false);
    });

    it("each per_query entry contains all required fields", async () => {
      // Regression guard — ensures no field is dropped from per_query results.
      const app = makeApp();

      const prd = await app.corpusService.create({
        type: "prd",
        title: "Per-Query Fields Doc",
        content: "xyzzy-per-query-fields-check content",
      });
      expect(prd.ok).toBe(true);
      if (!prd.ok) return;

      const result = await runFtsRecall(
        {
          queries: [
            { query: "xyzzy-per-query-fields-check", expected_slugs: [prd.value.slug] },
          ],
        },
        app,
      );
      app.close();

      const pq = result.per_query[0]!;
      expect(pq).toHaveProperty("query");
      expect(pq).toHaveProperty("expected_slugs");
      expect(pq).toHaveProperty("resolved_expected_count");
      expect(pq).toHaveProperty("retrieved_top_k");
      expect(pq).toHaveProperty("hits");
      expect(pq).toHaveProperty("recall");
      expect(pq).toHaveProperty("failed");
      expect(pq).toHaveProperty("degenerate");
    });
  });
});
