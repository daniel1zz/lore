/**
 * Unit tests for src/eval/scenarios/link-integrity.ts
 * Uses InMemoryStore (no SQLite) — all tests run under vitest.
 * Covers: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 * @spec_ref SPEC-013 §3.3
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
import { runLinkIntegrity } from "../../../src/eval/scenarios/link-integrity.js";
import type { App } from "../../../src/app.js";
import type { DocRecord, LinkRecord } from "@lore/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let docCounter = 0;

/** Build a minimal App using InMemoryStore. */
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
    // reason: test does not exercise AI-default path; callerSurface required by App interface (SPEC-024).
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    close: () => { telemetry.close(); },
  };
}

/** Create a minimal DocRecord for direct store insertion. */
function makeDoc(overrides: Partial<DocRecord> & { type: DocRecord["type"] }): DocRecord {
  const id = `01${String(++docCounter).padStart(24, "0")}`;
  const now = new Date().toISOString();
  return {
    id,
    slug: `${overrides.type}-link-${id.slice(-6)}`,
    role: "spec",
    title: `Test ${overrides.type} ${id.slice(-6)}`,
    status: "draft",
    priority: "medium",
    content: "",
    parent_id: null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  };
}

/** Create a non-parent LinkRecord for direct store insertion. */
function makeLink(fromId: string, toId: string, type: LinkRecord["link_type"] = "relates-to"): LinkRecord {
  return {
    from_id: fromId,
    to_id: toId,
    link_type: type,
    created_at: new Date().toISOString(),
    created_by: "test",
  };
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("HAPPY — all links point to live docs", () => {
  it("two docs with a relates-to link → passed=true, all counts 0", async () => {
    const store = new InMemoryStore();
    const prd1 = makeDoc({ type: "prd" });
    const prd2 = makeDoc({ type: "prd" });
    await store.insert(prd1);
    await store.insert(prd2);
    // Add a non-parent link via addLink (skips service-layer validation to test scenario directly)
    await store.addLink(makeLink(prd1.id, prd2.id, "relates-to"));

    const app = makeApp(store);
    const result = await runLinkIntegrity(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.dangling).toBe(0);
    expect(result.to_deleted).toBe(0);
    expect(result.self_loops).toBe(0);
    expect(result.total_links).toBeGreaterThanOrEqual(1);
  });
});

describe("HAPPY — corpus with no links at all", () => {
  it("docs with no links → passed=true, total_links=0", async () => {
    const store = new InMemoryStore();
    await store.insert(makeDoc({ type: "prd" }));
    await store.insert(makeDoc({ type: "prd" }));

    const app = makeApp(store);
    const result = await runLinkIntegrity(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.total_links).toBe(0);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE — self-loop link causes passed=false", () => {
  it("doc with relates-to link to itself → self_loops>0, passed=false", async () => {
    const store = new InMemoryStore();
    const prd = makeDoc({ type: "prd" });
    await store.insert(prd);
    // Insert a self-loop directly (bypassing service validation which would prevent this)
    await store.addLink({
      from_id: prd.id,
      to_id: prd.id,
      link_type: "relates-to",
      created_at: new Date().toISOString(),
      created_by: "test",
    });

    const app = makeApp(store);
    const result = await runLinkIntegrity(app);
    app.close();

    expect(result.passed).toBe(false);
    expect(result.self_loops).toBeGreaterThanOrEqual(1);
    const selfLoopIds = result.details.self_loop_links.map((l) => l.from_id);
    expect(selfLoopIds).toContain(prd.id);
  });
});

describe("NEGATIVE — link to soft-deleted doc causes passed=false", () => {
  it("link targeting a soft-deleted doc → to_deleted>0, passed=false", async () => {
    const store = new InMemoryStore();
    const prd1 = makeDoc({ type: "prd" });
    const prd2 = makeDoc({ type: "prd" });
    await store.insert(prd1);
    await store.insert(prd2);
    // Add link prd1 → prd2
    await store.addLink(makeLink(prd1.id, prd2.id, "relates-to"));
    // Soft-delete prd2 (makes prd1's link target deleted)
    await store.softDelete(prd2.id);

    const app = makeApp(store);
    const result = await runLinkIntegrity(app);
    app.close();

    expect(result.passed).toBe(false);
    expect(result.to_deleted).toBeGreaterThanOrEqual(1);
    const deletedTargetIds = result.details.deleted_target_links.map((l) => l.to_id);
    expect(deletedTargetIds).toContain(prd2.id);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY — empty corpus passes", () => {
  it("no docs, no links → passed=true, all counts 0", async () => {
    const app = makeApp();
    const result = await runLinkIntegrity(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.total_links).toBe(0);
    expect(result.dangling).toBe(0);
    expect(result.to_deleted).toBe(0);
    expect(result.self_loops).toBe(0);
    expect(result.details.dangling_links).toHaveLength(0);
    expect(result.details.deleted_target_links).toHaveLength(0);
    expect(result.details.self_loop_links).toHaveLength(0);
  });
});

describe("BOUNDARY — corpus with docs but no links passes", () => {
  it("10 docs, 0 links → passed=true", async () => {
    const store = new InMemoryStore();
    for (let i = 0; i < 10; i++) {
      await store.insert(makeDoc({ type: "prd" }));
    }

    const app = makeApp(store);
    const result = await runLinkIntegrity(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.total_links).toBe(0);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("ERROR — store failure returns passed=false without throwing", () => {
  it("corpusService.list failure → passed=false, no throw", async () => {
    const store = new InMemoryStore();
    const app = makeApp(store);

    // Simulate list failure
    vi.spyOn(app.corpusService, "list").mockResolvedValueOnce({
      ok: false,
      error: { code: "STORE_ERROR", message: "injected failure" },
    });

    let result: Awaited<ReturnType<typeof runLinkIntegrity>> | undefined;
    await expect(
      runLinkIntegrity(app).then((r) => { result = r; }),
    ).resolves.not.toThrow();
    app.close();

    expect(result).toBeDefined();
    expect(result!.passed).toBe(false);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("STATE — runLinkIntegrity is deterministic", () => {
  it("same corpus + two runs → identical results", async () => {
    const store = new InMemoryStore();
    const prd1 = makeDoc({ type: "prd" });
    const prd2 = makeDoc({ type: "prd" });
    await store.insert(prd1);
    await store.insert(prd2);
    await store.addLink(makeLink(prd1.id, prd2.id, "relates-to"));

    const app = makeApp(store);
    const result1 = await runLinkIntegrity(app);
    const result2 = await runLinkIntegrity(app);
    app.close();

    expect(result1.passed).toBe(result2.passed);
    expect(result1.total_links).toBe(result2.total_links);
    expect(result1.dangling).toBe(result2.dangling);
    expect(result1.to_deleted).toBe(result2.to_deleted);
    expect(result1.self_loops).toBe(result2.self_loops);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — 50+ doc corpus with links completes in reasonable time", () => {
  it("50 docs each with one outgoing link → passed=true, performance reasonable", async () => {
    const store = new InMemoryStore();
    const docs: DocRecord[] = [];

    for (let i = 0; i < 50; i++) {
      docs.push(makeDoc({ type: "prd" }));
    }

    for (const doc of docs) {
      await store.insert(doc);
    }

    // Each doc links to the next one (ring, but not self-loops)
    for (let i = 0; i < 49; i++) {
      await store.addLink(makeLink(docs[i]!.id, docs[i + 1]!.id, "relates-to"));
    }

    const app = makeApp(store);
    const start = Date.now();
    const result = await runLinkIntegrity(app);
    const elapsed = Date.now() - start;
    app.close();

    expect(result.passed).toBe(true);
    expect(result.total_links).toBe(49);
    expect(result.self_loops).toBe(0);
    // reason: 3s budget for 50 docs × get() per doc; get() triggers N store lookups internally
    expect(elapsed).toBeLessThan(3000);
  }, 10000);
});
