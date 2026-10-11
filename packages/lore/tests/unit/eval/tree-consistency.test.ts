/**
 * Unit tests for src/eval/scenarios/tree-consistency.ts
 * Uses InMemoryStore (no SQLite) — all tests run under vitest.
 * Covers: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 * @spec_ref SPEC-013 §3.2
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, vi } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { NoOpTelemetry } from "@lore/core";
import { runTreeConsistency } from "../../../src/eval/scenarios/tree-consistency.js";
import type { App } from "../../../src/app.js";
import type { DocRecord } from "@lore/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal App using InMemoryStore (no SQLite, no file I/O). */
function makeApp(store?: InMemoryStore): App {
  const s = store ?? new InMemoryStore();
  const telemetry = new NoOpTelemetry();
  return {
    corpusService: new CorpusService(s, new RecordLockService(s, new GateEnforcer(undefined)), telemetry),
    reviewService: new ReviewService(s, new RecordLockService(s, new GateEnforcer(undefined))),
    versionService: new VersionService(s, new RecordLockService(s, new GateEnforcer(undefined))),
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

let docCounter = 0;

/**
 * Build a minimal DocRecord for direct store insertion (bypasses service validation).
 * Used to inject structural violations that the service layer would reject.
 */
function makeDoc(
  overrides: Partial<DocRecord> & { type: DocRecord["type"] },
): DocRecord {
  const id = `01${String(++docCounter).padStart(24, "0")}`;
  const now = new Date().toISOString();
  return {
    id,
    slug: `${overrides.type}-test-${id.slice(-6)}`,
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

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("HAPPY — healthy corpus passes tree-consistency", () => {
  it("prd root + a parentless spec → passed=true, all counts 0 (BR-572, BR-2)", async () => {
    const store = new InMemoryStore();
    const prd = makeDoc({ type: "prd", parent_id: null });
    // re-baseline (BR-2): a spec takes no parent, so the healthy shape is a PARENTLESS spec
    const spec = makeDoc({ type: "spec", parent_id: null });
    await store.insert(prd);
    await store.insert(spec);

    const app = makeApp(store);
    const result = await runTreeConsistency(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.orphans).toBe(0);
    expect(result.cycles).toBe(0);
    expect(result.invalid_parent_types).toBe(0);
    expect(result.total_docs).toBe(2);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE — orphan doc causes passed=false", () => {
  it("knowledge with no parent → orphan detected, passed=false", async () => {
    // re-baseline (BR-2): this used a spec; a parentless spec is legal now, so the control that
    // must still be an orphan is a doc of a type that DOES need a parent.
    const store = new InMemoryStore();
    const knowledge = makeDoc({ type: "knowledge", parent_id: null });
    await store.insert(knowledge);

    const app = makeApp(store);
    const result = await runTreeConsistency(app);
    app.close();

    expect(result.passed).toBe(false);
    expect(result.orphans).toBeGreaterThanOrEqual(1);
    expect(result.details.orphan_ids).toContain(knowledge.id);
  });

  it("spec with no parent → NOT an orphan, passed=true (BR-572 agrees with BR-400)", async () => {
    const store = new InMemoryStore();
    const spec = makeDoc({ type: "spec", parent_id: null });
    await store.insert(spec);

    const app = makeApp(store);
    const result = await runTreeConsistency(app);
    app.close();

    expect(result.orphans).toBe(0);
    expect(result.details.orphan_ids).not.toContain(spec.id);
    expect(result.passed).toBe(true);
  });
});

describe("NEGATIVE — invalid parent type causes passed=false", () => {
  it("spec under plan → invalid_parent_types > 0, passed=false", async () => {
    const store = new InMemoryStore();
    const prd = makeDoc({ type: "prd", parent_id: null });
    // plan under prd is valid; spec under plan is NOT (spec only valid under prd)
    const plan = makeDoc({ type: "plan", parent_id: prd.id });
    const spec = makeDoc({ type: "spec", parent_id: plan.id });
    await store.insert(prd);
    await store.insert(plan);
    await store.insert(spec);

    const app = makeApp(store);
    const result = await runTreeConsistency(app);
    app.close();

    expect(result.passed).toBe(false);
    expect(result.invalid_parent_types).toBeGreaterThanOrEqual(1);
    // spec under plan is the violation
    const violationChildIds = result.details.invalid_pairs.map((p) => p.child_id);
    expect(violationChildIds).toContain(spec.id);
  });
});

describe("NEGATIVE — broken parent_id causes orphan", () => {
  it("doc with non-existent parent_id → orphan detected", async () => {
    const store = new InMemoryStore();
    const spec = makeDoc({ type: "spec", parent_id: "01NONEXISTENTPARENT0000000" });
    await store.insert(spec);

    const app = makeApp(store);
    const result = await runTreeConsistency(app);
    app.close();

    expect(result.passed).toBe(false);
    expect(result.orphans).toBeGreaterThanOrEqual(1);
    expect(result.details.orphan_ids).toContain(spec.id);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY — empty corpus passes", () => {
  it("no docs → passed=true, all counts 0", async () => {
    const app = makeApp();
    const result = await runTreeConsistency(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.orphans).toBe(0);
    expect(result.cycles).toBe(0);
    expect(result.invalid_parent_types).toBe(0);
    expect(result.total_docs).toBe(0);
    expect(result.details.orphan_ids).toHaveLength(0);
    expect(result.details.cycle_paths).toHaveLength(0);
    expect(result.details.invalid_pairs).toHaveLength(0);
  });
});

describe("BOUNDARY — single prd root doc passes", () => {
  it("single prd with no parent → passed=true (root type)", async () => {
    const store = new InMemoryStore();
    await store.insert(makeDoc({ type: "prd", parent_id: null }));

    const app = makeApp(store);
    const result = await runTreeConsistency(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.total_docs).toBe(1);
    expect(result.orphans).toBe(0);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("ERROR — store failure returns passed=false without throwing", () => {
  it("checkTree store error → passed=false, no throw", async () => {
    const store = new InMemoryStore();
    const app = makeApp(store);

    // Simulate store failure by replacing checkTree with one that returns an error
    vi.spyOn(app.treeCheckService, "checkTree").mockResolvedValueOnce({
      ok: false,
      error: { code: "STORE_ERROR", message: "injected failure" },
    });

    // Capture result outside the expect-not-throw wrapper
    let result: Awaited<ReturnType<typeof runTreeConsistency>> | undefined;
    await expect(
      runTreeConsistency(app).then((r) => { result = r; }),
    ).resolves.not.toThrow();
    app.close();

    expect(result).toBeDefined();
    expect(result!.passed).toBe(false);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("STATE — runTreeConsistency is deterministic", () => {
  it("same corpus + two runs → identical results", async () => {
    const store = new InMemoryStore();
    const prd = makeDoc({ type: "prd", parent_id: null });
    const spec = makeDoc({ type: "spec", parent_id: null });
    await store.insert(prd);
    await store.insert(spec);

    const app = makeApp(store);
    const result1 = await runTreeConsistency(app);
    const result2 = await runTreeConsistency(app);
    app.close();

    expect(result1.passed).toBe(result2.passed);
    expect(result1.orphans).toBe(result2.orphans);
    expect(result1.cycles).toBe(result2.cycles);
    expect(result1.invalid_parent_types).toBe(result2.invalid_parent_types);
    expect(result1.total_docs).toBe(result2.total_docs);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — 50+ doc corpus completes in <1s", () => {
  it("large corpus performance test", async () => {
    const store = new InMemoryStore();

    // Create 10 PRDs each beside 4 parentless specs = 50 docs total
    const docs: DocRecord[] = [];
    for (let i = 0; i < 10; i++) {
      const prd = makeDoc({ type: "prd", parent_id: null });
      docs.push(prd);
      for (let j = 0; j < 4; j++) {
        docs.push(makeDoc({ type: "spec", parent_id: null }));
      }
    }

    for (const doc of docs) {
      await store.insert(doc);
    }

    const app = makeApp(store);
    const start = Date.now();
    const result = await runTreeConsistency(app);
    const elapsed = Date.now() - start;
    app.close();

    expect(result.passed).toBe(true);
    expect(result.total_docs).toBe(50);
    // reason: 1s budget is generous for 50-doc InMemoryStore; guard against O(N²) regressions
    expect(elapsed).toBeLessThan(1000);
  }, 5000);
});
