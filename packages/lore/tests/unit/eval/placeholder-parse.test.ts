/**
 * Unit tests for src/eval/scenarios/placeholder-parse.ts
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
  runPlaceholderParse,
  PlaceholderParseResultSchema,
} from "../../../src/eval/scenarios/placeholder-parse.js";
import type { App } from "../../../src/app.js";
import type { DocRecord } from "@lore/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal App using InMemoryStore — no SQLite, no disk I/O. */
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
    close: () => { telemetry.close(); },
  };
}

/** Create a DocRecord for direct store insertion (bypasses service validation). */
let docCounter = 0;
function makeDoc(overrides: Partial<DocRecord> & { type: DocRecord["type"] }): DocRecord {
  const id = `01${String(++docCounter).padStart(24, "0")}`;
  const now = new Date().toISOString();
  return {
    id,
    slug: `${overrides.type}-placeholder-${id.slice(-6)}`,
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

describe("HAPPY — corpus with only whitelisted resolved placeholders", () => {
  it("returns passed=true on corpus with a ChildrenOf whitelisted placeholder", async () => {
    // Spec: whitelisted components resolve successfully → passed=true, unknown_warnings=0
    // The ChildrenOf component queries children of the parent doc by type.
    const store = new InMemoryStore();
    // Parent PRD with a ChildrenOf placeholder
    const prd = makeDoc({
      type: "prd",
      content: '<ChildrenOf type="spec" />',
    });
    // Child spec doc (gives ChildrenOf something to return)
    const spec = makeDoc({
      type: "spec",
      parent_id: prd.id,
      role: "spec",
      content: "# Spec content",
    });
    await store.insert(prd);
    await store.insert(spec);

    const app = makeApp(store);
    const result = await runPlaceholderParse(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.unknown_warnings).toBe(0);
    expect(result.resolution_errors).toBe(0);
    // The PRD has a ChildrenOf placeholder → docs_with_placeholders >= 1
    expect(result.docs_with_placeholders).toBeGreaterThanOrEqual(1);
    // ChildrenOf resolved at least once
    expect(result.resolved_total).toBeGreaterThanOrEqual(1);
  });

  it("returns passed=true on corpus with multiple distinct whitelisted placeholders", async () => {
    // Spec: all 7 whitelisted component types should resolve without warnings
    // Using RecentDecisions and HealthStats (no special setup required)
    const store = new InMemoryStore();
    const prd = makeDoc({
      type: "prd",
      content: "<RecentDecisions />\n<HealthStats />",
    });
    await store.insert(prd);

    const app = makeApp(store);
    const result = await runPlaceholderParse(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.unknown_warnings).toBe(0);
    expect(result.resolved_total).toBeGreaterThanOrEqual(2);
    // Verify different inputs produce different outputs vs hardcoded stub guard:
    // resolved_total reflects two components, not a hardcoded 1
    expect(result.total_placeholders_found).toBe(2);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE — corpus contains an unknown component", () => {
  it("returns passed=false when corpus contains an unknown component", async () => {
    // Spec: non-whitelisted component → stripped + warning → unknown_warnings >= 1, passed=false
    const store = new InMemoryStore();
    const prd = makeDoc({
      type: "prd",
      content: "Some text <UnknownComp />",
    });
    await store.insert(prd);

    const app = makeApp(store);
    const result = await runPlaceholderParse(app);
    app.close();

    expect(result.passed).toBe(false);
    expect(result.unknown_warnings).toBeGreaterThanOrEqual(1);
    // details.unknown_components must include the unknown component name
    const componentNames = result.details.unknown_components.map((u) => u.component);
    expect(componentNames).toContain("UnknownComp");
    // Each entry must have both doc_id and component fields
    const entry = result.details.unknown_components.find((u) => u.component === "UnknownComp");
    expect(entry).toBeDefined();
    expect(entry!.doc_id).toBe(prd.id);
  });

  it("returns passed=false even if mixed: one whitelisted + one unknown component", async () => {
    // Spec: ANY unknown warning flips passed to false
    const store = new InMemoryStore();
    const prd = makeDoc({
      type: "prd",
      content: "<HealthStats />\n<BogusWidget />",
    });
    await store.insert(prd);

    const app = makeApp(store);
    const result = await runPlaceholderParse(app);
    app.close();

    expect(result.passed).toBe(false);
    expect(result.unknown_warnings).toBe(1);
    expect(result.resolved_total).toBe(1);
    expect(result.details.unknown_components.map((u) => u.component)).toContain("BogusWidget");
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY — empty corpus", () => {
  it("returns passed=true on empty corpus with all counts zero", async () => {
    // Spec: empty corpus → trivially passes (no placeholders possible)
    const app = makeApp();
    const result = await runPlaceholderParse(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.total_docs_scanned).toBe(0);
    expect(result.docs_with_placeholders).toBe(0);
    expect(result.total_placeholders_found).toBe(0);
    expect(result.resolved_total).toBe(0);
    expect(result.unknown_warnings).toBe(0);
    expect(result.resolution_errors).toBe(0);
    expect(result.details.unknown_components).toHaveLength(0);
    expect(result.details.resolution_error_docs).toHaveLength(0);
  });
});

describe("BOUNDARY — corpus with no placeholders", () => {
  it("returns passed=true on corpus with plain markdown content", async () => {
    // Spec: docs without MDX placeholder tags are skipped; scenario passes trivially
    const store = new InMemoryStore();
    // Multiple docs with plain text — no self-closing MDX tags
    for (let i = 0; i < 5; i++) {
      await store.insert(makeDoc({
        type: "prd",
        content: `# Title ${i}\n\nSome plain markdown content without placeholders.\n\n## Section\n\nMore text.`,
      }));
    }

    const app = makeApp(store);
    const result = await runPlaceholderParse(app);
    app.close();

    expect(result.passed).toBe(true);
    expect(result.total_docs_scanned).toBe(5);
    expect(result.docs_with_placeholders).toBe(0);
    expect(result.total_placeholders_found).toBe(0);
    // No resolve() calls needed → resolved_total stays 0
    expect(result.resolved_total).toBe(0);
    expect(result.unknown_warnings).toBe(0);
  });

  it("does not count lowercase self-closing tags as placeholders", async () => {
    // Spec: placeholder regex requires uppercase-first component name
    // <br /> and <hr /> should NOT be counted as MDX component placeholders
    const store = new InMemoryStore();
    await store.insert(makeDoc({
      type: "prd",
      content: "Line one<br />Line two<hr />End",
    }));

    const app = makeApp(store);
    const result = await runPlaceholderParse(app);
    app.close();

    // <br /> / <hr /> start with lowercase → no match
    expect(result.total_placeholders_found).toBe(0);
    expect(result.docs_with_placeholders).toBe(0);
    expect(result.passed).toBe(true);
  });
});

describe("BOUNDARY — details.unknown_components capped at 10", () => {
  it("15 unique unknown placeholders → details.unknown_components has exactly 10 entries", async () => {
    // Spec: details.unknown_components is capped at top-10 by encounter order
    // The unknown_warnings COUNTER is unbounded; only the details array is capped
    const store = new InMemoryStore();
    // Build content with 15 distinct unknown components
    const tags = Array.from({ length: 15 }, (_, i) => `<Unknown${String.fromCharCode(65 + i)} />`);
    const content = tags.join("\n");
    await store.insert(makeDoc({ type: "prd", content }));

    const app = makeApp(store);
    const result = await runPlaceholderParse(app);
    app.close();

    expect(result.passed).toBe(false);
    expect(result.unknown_warnings).toBe(15);
    // Cap: only 10 entries in details array (SPEC-013 §7 AC 4)
    expect(result.details.unknown_components).toHaveLength(10);
    // First 10 components are the first 10 by encounter order
    const names = result.details.unknown_components.map((u) => u.component);
    expect(names).toContain("UnknownA");
    expect(names).toContain("UnknownJ");
    expect(names).not.toContain("UnknownK"); // 11th component excluded
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("ERROR — outlineService.resolve returns err for one doc", () => {
  it("resolution error is counted in resolution_errors and passed=false", async () => {
    // Spec: docs whose outlineService.resolve() returns an error → counted in resolution_errors
    const store = new InMemoryStore();
    const prd = makeDoc({
      type: "prd",
      content: "<HealthStats />",
    });
    await store.insert(prd);

    const app = makeApp(store);

    // Stub outlineService.resolve to return an error for this specific doc
    vi.spyOn(app.outlineService, "resolve").mockResolvedValueOnce({
      ok: false,
      error: { code: "STORE_ERROR", message: "injected resolve failure" },
    });

    const result = await runPlaceholderParse(app);
    app.close();

    expect(result.passed).toBe(false);
    expect(result.resolution_errors).toBeGreaterThanOrEqual(1);
    // The errored doc must appear in resolution_error_docs
    expect(result.details.resolution_error_docs).toHaveLength(1);
    expect(result.details.resolution_error_docs[0]!.doc_id).toBe(prd.id);
    expect(result.details.resolution_error_docs[0]!.error_code).toBe("STORE_ERROR");
  });
});

describe("ERROR — corpusService.list returns err", () => {
  it("list() failure → passed=false, zero counts, no throw", async () => {
    // Spec: list() failure is the only fatal path — returns passed=false without throwing
    const app = makeApp();

    vi.spyOn(app.corpusService, "list").mockResolvedValueOnce({
      ok: false,
      error: { code: "STORE_ERROR", message: "injected list failure" },
    });

    let result: Awaited<ReturnType<typeof runPlaceholderParse>> | undefined;
    await expect(
      runPlaceholderParse(app).then((r) => { result = r; }),
    ).resolves.not.toThrow();
    app.close();

    expect(result).toBeDefined();
    expect(result!.passed).toBe(false);
    expect(result!.total_docs_scanned).toBe(0);
    expect(result!.docs_with_placeholders).toBe(0);
    expect(result!.total_placeholders_found).toBe(0);
    expect(result!.resolved_total).toBe(0);
    expect(result!.unknown_warnings).toBe(0);
    expect(result!.resolution_errors).toBe(0);
  });
});

describe("ERROR — mass resolve failures do not cause runPlaceholderParse to throw", () => {
  it("all resolve() calls fail → resolves to valid result with passed=false", async () => {
    // Spec: never throws — all errors surface as passed=false
    const store = new InMemoryStore();
    // 5 docs each with a placeholder → all resolves fail
    for (let i = 0; i < 5; i++) {
      await store.insert(makeDoc({
        type: "prd",
        content: "<HealthStats />",
      }));
    }

    const app = makeApp(store);

    vi.spyOn(app.outlineService, "resolve").mockResolvedValue({
      ok: false,
      error: { code: "STORE_ERROR", message: "mass resolve failure" },
    });

    let result: Awaited<ReturnType<typeof runPlaceholderParse>> | undefined;
    await expect(
      runPlaceholderParse(app).then((r) => { result = r; }),
    ).resolves.not.toThrow();
    app.close();

    expect(result).toBeDefined();
    expect(result!.passed).toBe(false);
    expect(result!.resolution_errors).toBe(5);
    // details cap at 10 — with 5 errors, all should be recorded
    expect(result!.details.resolution_error_docs).toHaveLength(5);
  });
});

describe("ERROR — corpusService.get failure is non-fatal (doc is skipped)", () => {
  it("get() failure causes the doc to be skipped, not counted as resolution_error", async () => {
    // Spec (invariant in source comment): a single doc fetch failure is non-fatal —
    // the doc is skipped and is NOT counted in resolution_errors (failure before resolve)
    const store = new InMemoryStore();
    const prd = makeDoc({ type: "prd", content: "<HealthStats />" });
    await store.insert(prd);

    const app = makeApp(store);

    // Stub get to fail for the specific doc
    vi.spyOn(app.corpusService, "get").mockResolvedValueOnce({
      ok: false,
      error: { code: "DOC_NOT_FOUND", id: prd.id },
    });

    const result = await runPlaceholderParse(app);
    app.close();

    // Doc was skipped — not counted as resolution_error
    expect(result.resolution_errors).toBe(0);
    expect(result.docs_with_placeholders).toBe(0);
    // passed=true because no unknown_warnings and no resolution_errors
    expect(result.passed).toBe(true);
    // total_docs_scanned reflects summaries from list(), not successful gets
    expect(result.total_docs_scanned).toBe(1);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("STATE — runPlaceholderParse does not mutate the corpus", () => {
  it("doc list before and after the scenario run is identical", async () => {
    // Spec: read-only on corpusService + outlineService; no corpus mutations
    const store = new InMemoryStore();
    const prd = makeDoc({ type: "prd", content: "<ChildrenOf />" });
    await store.insert(prd);

    const app = makeApp(store);

    const beforeResult = await app.corpusService.list({});
    expect(beforeResult.ok).toBe(true);
    const docsBefore = (beforeResult as Extract<typeof beforeResult, { ok: true }>).value.docs;

    await runPlaceholderParse(app);

    const afterResult = await app.corpusService.list({});
    expect(afterResult.ok).toBe(true);
    const docsAfter = (afterResult as Extract<typeof afterResult, { ok: true }>).value.docs;

    app.close();

    // Same docs, same count, same IDs
    expect(docsAfter).toHaveLength(docsBefore.length);
    for (const before of docsBefore) {
      const after = docsAfter.find((d) => d.id === before.id);
      expect(after).toBeDefined();
      expect(after!.slug).toBe(before.slug);
      expect(after!.status).toBe(before.status);
    }
  });
});

describe("STATE — runPlaceholderParse is idempotent", () => {
  it("same corpus yields identical result fields across two consecutive runs", async () => {
    // Spec: idempotent — read-only on corpusService + outlineService
    const store = new InMemoryStore();
    const prd = makeDoc({
      type: "prd",
      content: "<RecentDecisions />\n<UnknownWidget />",
    });
    await store.insert(prd);

    const app = makeApp(store);
    const result1 = await runPlaceholderParse(app);
    const result2 = await runPlaceholderParse(app);
    app.close();

    // All fields must be identical modulo duration_ms
    expect(result1.passed).toBe(result2.passed);
    expect(result1.total_docs_scanned).toBe(result2.total_docs_scanned);
    expect(result1.docs_with_placeholders).toBe(result2.docs_with_placeholders);
    expect(result1.total_placeholders_found).toBe(result2.total_placeholders_found);
    expect(result1.resolved_total).toBe(result2.resolved_total);
    expect(result1.unknown_warnings).toBe(result2.unknown_warnings);
    expect(result1.resolution_errors).toBe(result2.resolution_errors);
    expect(result1.details.unknown_components).toEqual(result2.details.unknown_components);
    expect(result1.details.resolution_error_docs).toEqual(result2.details.resolution_error_docs);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — result conforms to PlaceholderParseResultSchema", () => {
  it("Zod schema round-trip must not throw for any run result", async () => {
    // Spec: PlaceholderParseResultSchema is the SSOT for result shape
    const store = new InMemoryStore();
    const prd = makeDoc({
      type: "prd",
      content: "<HealthStats />\n<BadComp />",
    });
    await store.insert(prd);

    const app = makeApp(store);
    const result = await runPlaceholderParse(app);
    app.close();

    // Must not throw — result must conform to its own schema
    expect(() => PlaceholderParseResultSchema.parse(result)).not.toThrow();

    // Verify the parsed shape matches (not just that parse() didn't throw)
    const parsed = PlaceholderParseResultSchema.parse(result);
    expect(parsed.passed).toBe(result.passed);
    expect(parsed.unknown_warnings).toBe(result.unknown_warnings);
    expect(parsed.total_docs_scanned).toBe(result.total_docs_scanned);
  });

  it("schema round-trip works for the empty-corpus case", async () => {
    const app = makeApp();
    const result = await runPlaceholderParse(app);
    app.close();

    expect(() => PlaceholderParseResultSchema.parse(result)).not.toThrow();
  });
});

describe("REGRESSION — skips soft-deleted docs", () => {
  it("soft-deleted doc with placeholder is not counted in scanned or placeholder totals", async () => {
    // Spec: list({}) excludes soft-deleted docs (store.findMany adds deleted_at IS NULL by default)
    const store = new InMemoryStore();
    const prd = makeDoc({
      type: "prd",
      content: "<UnknownWidget />",
    });
    await store.insert(prd);

    // Soft-delete the doc directly in the store (bypasses confirm guard)
    await store.softDelete(prd.id);

    const app = makeApp(store);
    const result = await runPlaceholderParse(app);
    app.close();

    // Soft-deleted doc must be excluded entirely
    expect(result.total_docs_scanned).toBe(0);
    expect(result.docs_with_placeholders).toBe(0);
    expect(result.total_placeholders_found).toBe(0);
    expect(result.unknown_warnings).toBe(0);
    // With no unknown_warnings and no resolution_errors, passes trivially
    expect(result.passed).toBe(true);
  });

  it("live docs are still scanned after a sibling doc is soft-deleted", async () => {
    // Regression: soft-delete of one doc must not block scanning of sibling docs
    const store = new InMemoryStore();
    const deleted = makeDoc({ type: "prd", content: "<GoneComp />" });
    const live = makeDoc({ type: "prd", content: "<HealthStats />" });
    await store.insert(deleted);
    await store.insert(live);
    await store.softDelete(deleted.id);

    const app = makeApp(store);
    const result = await runPlaceholderParse(app);
    app.close();

    // Only the live doc is scanned
    expect(result.total_docs_scanned).toBe(1);
    expect(result.docs_with_placeholders).toBe(1);
    // No unknown component warnings (HealthStats is whitelisted)
    expect(result.unknown_warnings).toBe(0);
    expect(result.passed).toBe(true);
  });
});
