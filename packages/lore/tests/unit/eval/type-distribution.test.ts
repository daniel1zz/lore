/**
 * Unit tests for src/eval/scenarios/type-distribution.ts
 * Uses InMemoryStore (no SQLite) — all tests run under vitest.
 * Covers: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 * @spec_ref SPEC-013 §3.4
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
import {
  runTypeDistribution,
  DEFAULT_THRESHOLDS,
} from "../../../src/eval/scenarios/type-distribution.js";
import type { App } from "../../../src/app.js";
import type { DocRecord } from "@lore/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let docCounter = 0;

/** Build a minimal App using InMemoryStore. */
function makeApp(store?: InMemoryStore): App {
  const s = store ?? new InMemoryStore();
  const telemetry = new NoOpTelemetry();
  return {
    corpusService: new CorpusService(s, new RecordLockService(s, new GateEnforcer(undefined)), telemetry),
    reviewService: new ReviewService(s),
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

/** Create a minimal DocRecord for direct store insertion. */
function makeDoc(overrides: Partial<DocRecord> & { type: DocRecord["type"] }): DocRecord {
  const id = `01${String(++docCounter).padStart(24, "0")}`;
  const now = new Date().toISOString();
  return {
    id,
    slug: `${overrides.type}-dist-${id.slice(-6)}`,
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

describe("HAPPY — corpus meeting default thresholds passes", () => {
  it("1 prd + 1 spec → passed=true (meets min=1 for prd and spec)", async () => {
    const store = new InMemoryStore();
    await store.insert(makeDoc({ type: "prd" }));
    await store.insert(makeDoc({ type: "spec" }));

    const app = makeApp(store);
    const result = await runTypeDistribution(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.distribution["prd"]).toBe(1);
    expect(result.distribution["spec"]).toBe(1);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("HAPPY — custom threshold with exact boundary passes", () => {
  it("min=1 threshold with actual=1 → passed=true (boundary case)", async () => {
    const store = new InMemoryStore();
    await store.insert(makeDoc({ type: "prd" }));

    const app = makeApp(store);
    const result = await runTypeDistribution(app, {
      thresholds: [{ type: "prd", min: 1 }],
    });
    app.close();

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE — missing prd causes passed=false", () => {
  it("no prd in corpus → violations includes prd below_min, passed=false", async () => {
    const store = new InMemoryStore();
    // Only add spec, no prd
    await store.insert(makeDoc({ type: "spec" }));

    const app = makeApp(store);
    // Custom thresholds with just prd min=1 to isolate the violation
    const result = await runTypeDistribution(app, {
      thresholds: [{ type: "prd", min: 1 }],
    });
    app.close();

    expect(result.passed).toBe(false);
    const prdViolation = result.violations.find((v) => v.type === "prd");
    expect(prdViolation).toBeDefined();
    expect(prdViolation?.reason).toBe("below_min");
    expect(prdViolation?.actual).toBe(0);
  });
});

describe("NEGATIVE — default thresholds fail without prd", () => {
  it("corpus with only spec + knowledge → prd below_min violation", async () => {
    const store = new InMemoryStore();
    await store.insert(makeDoc({ type: "spec" }));

    const app = makeApp(store);
    const result = await runTypeDistribution(app);
    app.close();

    expect(result.passed).toBe(false);
    const prdViolation = result.violations.find((v) => v.type === "prd");
    expect(prdViolation).toBeDefined();
    expect(prdViolation?.reason).toBe("below_min");
  });
});

describe("NEGATIVE — above_max violation causes passed=false", () => {
  it("3 prds with max=2 → above_max violation, passed=false", async () => {
    const store = new InMemoryStore();
    await store.insert(makeDoc({ type: "prd" }));
    await store.insert(makeDoc({ type: "prd" }));
    await store.insert(makeDoc({ type: "prd" }));

    const app = makeApp(store);
    const result = await runTypeDistribution(app, {
      thresholds: [{ type: "prd", min: 1, max: 2 }],
    });
    app.close();

    expect(result.passed).toBe(false);
    const violation = result.violations.find((v) => v.type === "prd");
    expect(violation?.reason).toBe("above_max");
    expect(violation?.actual).toBe(3);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY — min=1 actual=1 boundary passes", () => {
  it("exactly meets min threshold → passed=true", async () => {
    const store = new InMemoryStore();
    await store.insert(makeDoc({ type: "prd" }));

    const app = makeApp(store);
    const result = await runTypeDistribution(app, {
      thresholds: [{ type: "prd", min: 1, max: 3 }],
    });
    app.close();

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

describe("BOUNDARY — max=2 actual=2 boundary passes", () => {
  it("exactly at max threshold → passed=true", async () => {
    const store = new InMemoryStore();
    await store.insert(makeDoc({ type: "prd" }));
    await store.insert(makeDoc({ type: "prd" }));

    const app = makeApp(store);
    const result = await runTypeDistribution(app, {
      thresholds: [{ type: "prd", min: 1, max: 2 }],
    });
    app.close();

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("ERROR — unknown type in custom thresholds fails loud", () => {
  it("unknown_type 'blueprint' in thresholds → violation with reason=unknown_type", async () => {
    const store = new InMemoryStore();
    await store.insert(makeDoc({ type: "prd" }));

    const app = makeApp(store);
    const result = await runTypeDistribution(app, {
      // reason: unknown types must not be silently skipped — SPEC-013 §3 invariant
      thresholds: [{ type: "blueprint" as never, min: 1 }],
    });
    app.close();

    // Should not silently pass
    expect(result.passed).toBe(false);
    const unknownViolation = result.violations.find((v) => v.type === "blueprint");
    expect(unknownViolation).toBeDefined();
    expect(unknownViolation?.reason).toBe("unknown_type");
  });
});

describe("ERROR — store failure returns passed=false without throwing", () => {
  it("corpusService.status failure → passed=false, no throw", async () => {
    const store = new InMemoryStore();
    const app = makeApp(store);

    vi.spyOn(app.corpusService, "status").mockResolvedValueOnce({
      ok: false,
      error: { code: "STORE_ERROR", message: "injected failure" },
    });

    let result: Awaited<ReturnType<typeof runTypeDistribution>> | undefined;
    await expect(
      runTypeDistribution(app).then((r) => { result = r; }),
    ).resolves.not.toThrow();
    app.close();

    expect(result).toBeDefined();
    expect(result!.passed).toBe(false);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("STATE — runTypeDistribution is deterministic", () => {
  it("same corpus + same thresholds + two runs → identical results", async () => {
    const store = new InMemoryStore();
    await store.insert(makeDoc({ type: "prd" }));
    await store.insert(makeDoc({ type: "prd" }));
    await store.insert(makeDoc({ type: "spec" }));

    const app = makeApp(store);
    const result1 = await runTypeDistribution(app);
    const result2 = await runTypeDistribution(app);
    app.close();

    expect(result1.passed).toBe(result2.passed);
    expect(result1.violations).toHaveLength(result2.violations.length);
    expect(JSON.stringify(result1.distribution)).toBe(JSON.stringify(result2.distribution));
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — default thresholds pass on a realistic corpus", () => {
  it("corpus with all doc types represented satisfies DEFAULT_THRESHOLDS", async () => {
    const store = new InMemoryStore();
    // Insert at least one of each type
    await store.insert(makeDoc({ type: "prd" }));
    await store.insert(makeDoc({ type: "spec" }));
    await store.insert(makeDoc({ type: "adr" }));
    await store.insert(makeDoc({ type: "plan" }));
    await store.insert(makeDoc({ type: "knowledge" }));
    await store.insert(makeDoc({ type: "task" }));

    const app = makeApp(store);
    const result = await runTypeDistribution(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    // Verify distribution covers all types
    expect(Object.keys(result.distribution).length).toBeGreaterThanOrEqual(6);
  });
});

describe("REGRESSION — DEFAULT_THRESHOLDS export has correct shape", () => {
  it("DEFAULT_THRESHOLDS covers all known doc types with min=0 or min=1", () => {
    const types = DEFAULT_THRESHOLDS.map((t) => t.type);
    expect(types).toContain("prd");
    expect(types).toContain("spec");
    expect(types).toContain("adr");
    expect(types).toContain("plan");
    expect(types).toContain("knowledge");
    expect(types).toContain("task");

    const prdThreshold = DEFAULT_THRESHOLDS.find((t) => t.type === "prd");
    const specThreshold = DEFAULT_THRESHOLDS.find((t) => t.type === "spec");
    expect(prdThreshold?.min).toBe(1);
    expect(specThreshold?.min).toBe(1);
  });
});
