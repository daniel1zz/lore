// @reads packages/lore/src/store/**
/** @spec_ref AC-STORE-001 */
/**
 * Tests for SQLiteStore — the SQLite-specific cases only (bun:sqlite, `bun test`).
 * Behaviour shared with InMemoryStore/TursoStore (insert/find/update/links/search/
 * versions/audit/CAS/judgments/maxDocVersion …) lives in store-core.shared.ts and
 * store-judgments.shared.ts and is run against SQLiteStore at the bottom of this file.
 *
 * Spec references (SPEC-LORE-STORE-001):
 *   AC-STORE-001: insert + find (by id, by slug)
 *   AC-STORE-002: update + versioning
 *   AC-STORE-003: soft delete lifecycle
 *   AC-STORE-004: duplicate slug rejection
 *   AC-STORE-005: link management + cycle detection
 *   AC-STORE-006: FTS5 search
 *   AC-STORE-007: version history
 *   AC-STORE-008: audit log
 *   AC-STORE-009: findMany filters
 *
 * Test design techniques applied:
 *   EP: valid/invalid inserts, filter combinations
 *   BVA: empty query, limit/offset boundaries, empty arrays
 *   Decision Table: direction='in'|'out'|'both', exclude_deleted=true|false
 *   State Transition: soft-delete lifecycle, parent-cycle detection
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import {
  makeAuditEntry,
  makeDoc,
  makeVersion,
  resetCounter,
  runFileBackedDbSizeSuite,
  runStoreCoreSuite,
} from "./store-core.shared.js";
import { runStoreJudgmentsSuite } from "./store-judgments.shared.js";
import { formatError } from "../../../src/adapters/cli/utils.js";
import type { DocRecord, LoreError } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── FTS5 Special-Token Escape — SPEC-013 §3.5 ───────────────────────────────
//
// @spec_ref AC-STORE-FTS-001
//
// These tests verify that SQLiteStore.search() safely handles FTS5-special input
// tokens (hyphens, wildcards, colons, parentheses) that would previously cause a
// raw SQLite FTS5 MATCH syntax error to propagate as a thrown exception.
//
// After the escapeFtsQuery fix is applied in SQLiteStore, all probes below must
// return Result.ok (never throw / never return Result.err for syntax reasons).
//
// Test design:
//   HAPPY  — hyphen query matches docs containing that hyphenated token
//   HAPPY  — multi-word AND semantics work post-escape
//   BOUNDARY — empty / whitespace-only query short-circuits to ok([])
//   ERROR  — historically crashing inputs surface as ok (never err from SQL error)
//   REGRESSION — "append-only" canonical case matched correctly
//   STATE  — store returns consistent results across repeated calls

describe("SQLiteStore.search — FTS5 special-token escape (SPEC-013 §3.5)", () => {
  let store: SQLiteStore;

  // Each test gets a fresh in-memory store — matches the pattern used above.
  beforeEach(() => {
    resetCounter();
    store = actedStore(new SQLiteStore(":memory:"));
  });

  afterEach(() => {
    store.close();
  });

  // ── Happy Path ──────────────────────────────────────────────────────────────

  it("FTS-HAPPY-01: returns ok() for query containing hyphen (append-only)", async () => {
    const doc = makeDoc({
      slug: "spec-fts-hyphen",
      title: "Append-Only Journal Design",
      content: "This spec covers the append-only journal for the version store.",
      type: "spec",
      role: "spec",
    });
    await store.insert(doc);

    const result = await store.search("append-only");
    expect(result.ok).toBe(true);
    // Must find the doc containing the hyphenated token
    if (!result.ok) return;
    const ids = result.value.map((h) => h.id);
    expect(ids).toContain(doc.id);
  });

  it("FTS-HAPPY-02: hyphenated query does NOT match doc that lacks the hyphenated form", async () => {
    // Doc A has "append-only" as a true hyphenated word.
    // Doc B has the words separately in a sentence — FTS5 phrase semantics
    // ensure "append-only" (after escaping to '"append-only"') matches the
    // concatenated token, not split words.
    const docA = makeDoc({
      slug: "spec-fts-h-a",
      title: "Append-Only Store",
      content: "Uses an append-only journal for durability.",
      type: "spec",
      role: "spec",
    });
    const docB = makeDoc({
      slug: "spec-fts-h-b",
      title: "Storage Notes",
      content: "We should not append data. Only log relevant deltas.",
      type: "spec",
      role: "spec",
    });
    await store.insert(docA);
    await store.insert(docB);

    const result = await store.search("append-only");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.map((h) => h.id);
    // docA must appear (has the literal hyphenated token)
    expect(ids).toContain(docA.id);
    // docB must NOT appear (split sentence, not hyphenated token)
    expect(ids).not.toContain(docB.id);
  });

  it("FTS-HAPPY-03: prefix wildcard query (foo*) returns ok — no SQL error", async () => {
    // After the fix, "foo*" is wrapped as '"foo*"'. FTS5 allows * at end of
    // a quoted phrase for prefix matching. Result may be 0 hits but must not
    // be an error.
    const result = await store.search("foo*");
    expect(result.ok).toBe(true);
    // Zero hits is acceptable — the critical assertion is no SQL error
  });

  it("FTS-HAPPY-04: multi-word query uses AND semantics — returns only docs with both terms", async () => {
    // Doc A has BOTH "service" and "layer" in content.
    // Doc B has ONLY "service".
    // search("service layer") must return A but NOT B.
    const docA = makeDoc({
      slug: "spec-fts-and-a",
      title: "Service Layer Design",
      content: "The service layer handles all business logic.",
      type: "spec",
      role: "spec",
    });
    const docB = makeDoc({
      slug: "spec-fts-and-b",
      title: "Service Overview",
      content: "Overview of the service module without further details.",
      type: "spec",
      role: "spec",
    });
    await store.insert(docA);
    await store.insert(docB);

    const result = await store.search("service layer");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.map((h) => h.id);
    expect(ids).toContain(docA.id);
    expect(ids).not.toContain(docB.id);
  });

  // ── Boundary Values ─────────────────────────────────────────────────────────

  it("FTS-BOUNDARY-01: empty string query returns ok([]) without hitting FTS", async () => {
    // Short-circuit: escapeFtsQuery("") === "" → caller must skip MATCH → return []
    const result = await store.search("");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("FTS-BOUNDARY-02: whitespace-only query returns ok([]) without hitting FTS", async () => {
    // "   \t\n  " trims to "" — same short-circuit as empty string
    const result = await store.search("   \t\n  ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  // ── Error / No-Throw ────────────────────────────────────────────────────────

  it("FTS-ERROR-01: historically problematic inputs never cause thrown SQL error or Result.err", async () => {
    // Before the fix, FTS5-special tokens triggered a SQL syntax error that propagated
    // as a thrown exception. After the fix, ALL inputs return Result (never throw).
    // We specifically target inputs that FTS5 interprets as operators without quoting.
    const probes = [
      "append-only",   // hyphen = FTS5 NOT operator
      "real-world",    // hyphen in different context
      "foo*",          // naked wildcard
      "bar?",          // question mark (FTS5 fuzzy in some builds)
      "(parens)",      // grouping syntax
      "a:b",           // FTS5 column filter syntax
      "AND",           // FTS5 boolean operator keyword
      "OR",            // FTS5 boolean operator keyword
      "NOT",           // FTS5 boolean operator keyword
      "-term",         // leading hyphen = NOT
    ];

    for (const q of probes) {
      const r = await store.search(q, {});
      expect(
        r.ok,
        `search("${q}") must return ok (not throw). Got: ${JSON.stringify(!r.ok && r)}`,
      ).toBe(true);
    }
  });

  // ── Regression ──────────────────────────────────────────────────────────────

  it("REGRESSION FTS-REG-01: 'append-only' canonical case — finds doc, does not throw", async () => {
    // This is the exact scenario from the bug report: searching for a hyphenated
    // term previously crashed SQLiteStore with an FTS5 syntax error.
    const doc = makeDoc({
      slug: "spec-fts-reg-hyphen",
      title: "Version Store Spec",
      content: "The store uses an append-only log for version history.",
      type: "spec",
      role: "spec",
    });
    await store.insert(doc);

    // Must not throw; must be ok; must contain the doc
    const result = await store.search("append-only");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((h) => h.id)).toContain(doc.id);
  });

  it("REGRESSION FTS-REG-02: empty query short-circuit works regardless of docs in store", async () => {
    // Insert a doc so the store is non-empty — verify short-circuit still works
    const doc = makeDoc({
      slug: "spec-fts-reg-empty",
      title: "Some Doc",
      content: "Some content here.",
    });
    await store.insert(doc);

    const result = await store.search("");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  // ── State ───────────────────────────────────────────────────────────────────

  it("FTS-STATE-01: repeated searches with same query return consistent results", async () => {
    const doc = makeDoc({
      slug: "spec-fts-state",
      title: "Idempotent Search",
      content: "real-world usage of the FTS system.",
      type: "spec",
      role: "spec",
    });
    await store.insert(doc);

    const first = await store.search("real-world");
    const second = await store.search("real-world");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Same set of IDs in same order
    expect(first.value.map((h) => h.id)).toEqual(second.value.map((h) => h.id));
  });
});

// AC-STORE-010: dbSizeBytes — real on-disk size via PRAGMA page_count * page_size.
// Uses a real temp file (not ":memory:") so the byte count reflects actual disk usage.
describe("SQLiteStore.dbSizeBytes (AC-STORE-010)", () => {
  let tempDir: string;
  let dbPath: string;
  let store: SQLiteStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-db-size-"));
    dbPath = join(tempDir, "test.db");
    store = actedStore(new SQLiteStore(dbPath));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("BOUNDARY: value equals PRAGMA page_count * PRAGMA page_size exactly", async () => {
    const db = store.getDatabase();
    const { page_count: pageCount } = db.query("PRAGMA page_count").get() as {
      page_count: number;
    };
    const { page_size: pageSize } = db.query("PRAGMA page_size").get() as {
      page_size: number;
    };

    const result = await store.dbSizeBytes();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(pageCount * pageSize);
  });
});

// ─── DUPLICATE_SLUG.existing_id names the WINNER, never the rejected doc ─────
// task-skill-implement-duplicate-slug-existing-id-names-the
//
// ⛔ These cases MUST run under `bun test` against the real SQLiteStore:
//   cd packages/lore && bun test tests/unit/store/sqlite-store.bun.test.ts
// A vitest run cannot judge this. The two stores that got the field wrong
// (SQLiteStore, TursoStore) are the two that need a real database; the one that
// got it right is InMemoryStore — the test double every vitest unit test uses,
// so every vitest assertion about this field was green while both SQL-backed
// stores were reporting an id that resolved to nothing.

/** The DUPLICATE_SLUG member of the `LoreError` union (`packages/core/src/errors.ts:15`). */
type DuplicateSlugError = Extract<LoreError, { code: "DUPLICATE_SLUG" }>;

/**
 * The AC-1 assertion, factored so every insert entry point asserts the SAME
 * property: `existing_id` must RESOLVE to a persisted doc that holds the
 * colliding slug.
 *
 * ⛔ An id-SHAPED string is not a passing condition — the pre-fix defect
 * returned `doc.id` (the rejected doc's own freshly generated, never-persisted
 * ULID), which is perfectly id-shaped and resolved to DOC_NOT_FOUND every
 * single time. Hence the `store.find()` round trip plus the slug equality
 * check, and the explicit `not.toBe(loser.id)` disqualifier.
 */
async function expectExistingIdNamesTheWinner(
  store: SQLiteStore,
  error: DuplicateSlugError,
  winner: DocRecord,
  loser: DocRecord,
): Promise<void> {
  expect(error.slug).toBe(winner.slug);

  // Resolution is asserted BEFORE identity on purpose: it is the assertion
  // with the discriminating power ("an id-shaped string is not a passing
  // condition"), so it is the one a future red must quote.
  const resolved = await store.find(error.existing_id);
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return;
  expect(
    resolved.value,
    `existing_id ${error.existing_id} resolved to NO doc — the field promises the id of the doc ` +
      `already holding '${error.slug}' (expected the winner ${winner.id}), so an unresolvable ` +
      `value is the false label this fix closes`,
  ).not.toBeNull();
  expect(resolved.value?.slug).toBe(winner.slug);

  expect(error.existing_id).toBe(winner.id);
  expect(error.existing_id).not.toBe(loser.id);
}

describe("SQLiteStore — DUPLICATE_SLUG.existing_id names the winner (task-skill-implement-duplicate-slug-existing-id-names-the)", () => {
  let store: SQLiteStore;

  beforeEach(() => {
    resetCounter();
    store = actedStore(new SQLiteStore(":memory:"));
  });

  afterEach(() => {
    store.close();
  });

  const CONFLICT_SLUG = "prd-existing-id-conflict";

  it("AC-1.01 (insert): existing_id resolves to the doc already holding the slug", async () => {
    const winner = makeDoc({ slug: CONFLICT_SLUG });
    const loser = makeDoc({ slug: CONFLICT_SLUG });
    const seeded = await store.insert(winner);
    expect(seeded.ok).toBe(true);

    const result = await store.insert(loser);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DUPLICATE_SLUG");
    if (result.error.code !== "DUPLICATE_SLUG") return;

    await expectExistingIdNamesTheWinner(store, result.error, winner, loser);
  });

  it("AC-1.02 (insertWithAllocatedOrdinal): existing_id resolves to the doc already holding the slug", async () => {
    const winner = makeDoc({ slug: CONFLICT_SLUG });
    const loser = makeDoc({ slug: CONFLICT_SLUG });
    expect((await store.insert(winner)).ok).toBe(true);

    const result = await store.insertWithAllocatedOrdinal(loser);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DUPLICATE_SLUG");
    if (result.error.code !== "DUPLICATE_SLUG") return;

    await expectExistingIdNamesTheWinner(store, result.error, winner, loser);
  });

  it("AC-1.03 (insertWithProvenance): existing_id resolves to the doc already holding the slug", async () => {
    const winner = makeDoc({ slug: CONFLICT_SLUG });
    const loser = makeDoc({ slug: CONFLICT_SLUG });
    expect((await store.insert(winner)).ok).toBe(true);

    const result = await store.insertWithProvenance(
      loser,
      makeVersion(loser.id, 1),
      makeAuditEntry(loser.id),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DUPLICATE_SLUG");
    if (result.error.code !== "DUPLICATE_SLUG") return;

    await expectExistingIdNamesTheWinner(store, result.error, winner, loser);
  });

  it("AC-1.04 (insertWithAllocatedOrdinalAndProvenance): existing_id resolves to the doc already holding the slug", async () => {
    const winner = makeDoc({ slug: CONFLICT_SLUG });
    const loser = makeDoc({ slug: CONFLICT_SLUG });
    expect((await store.insert(winner)).ok).toBe(true);

    const result = await store.insertWithAllocatedOrdinalAndProvenance(
      loser,
      makeVersion(loser.id, 1),
      makeAuditEntry(loser.id),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DUPLICATE_SLUG");
    if (result.error.code !== "DUPLICATE_SLUG") return;

    await expectExistingIdNamesTheWinner(store, result.error, winner, loser);
  });

  it("AC-1.05 BOUNDARY: a SOFT-DELETED holder still owns the slug, so existing_id names it", async () => {
    // reason: `docs.slug` is `TEXT NOT NULL UNIQUE` at the COLUMN level
    // (`store/migrations/migration-006.ts:103`) — not a partial index over
    // `deleted_at IS NULL`. A soft-deleted row therefore still holds its slug
    // and still raises the UNIQUE violation, so the conflict lookup MUST NOT
    // filter on `deleted_at` (this mirrors `InMemoryStore.findSlugConflict`,
    // which scans every doc including soft-deleted ones). This case is the
    // guard against a future session "tidying" a `WHERE deleted_at IS NULL`
    // into that lookup: the lookup would then find nothing while the UNIQUE
    // index still refuses the insert.
    const winner = makeDoc({ slug: CONFLICT_SLUG });
    const loser = makeDoc({ slug: CONFLICT_SLUG });
    expect((await store.insert(winner)).ok).toBe(true);
    expect((await store.softDelete(winner.id)).ok).toBe(true);

    const result = await store.insert(loser);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DUPLICATE_SLUG");
    if (result.error.code !== "DUPLICATE_SLUG") return;

    // `find` is a direct-address lookup and applies NO soft-delete filter
    // (`store/store-interface.ts:414`), so the shared assertion holds unchanged.
    await expectExistingIdNamesTheWinner(store, result.error, winner, loser);
  });

  it("AC-4 SURFACE: formatError's rendered message names the WINNER's id, not the rejected doc's", async () => {
    // The user-visible half of the same false label:
    // `adapters/cli/utils.ts`'s DUPLICATE_SLUG branch renders
    // "already exists (used by <id>)" — a sentence that was false for every
    // SQL-backed store until this fix. Asserting the store alone would leave
    // the rendered surface uncovered.
    const winner = makeDoc({ slug: CONFLICT_SLUG });
    const loser = makeDoc({ slug: CONFLICT_SLUG });
    expect((await store.insert(winner)).ok).toBe(true);

    const result = await store.insert(loser);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const rendered = formatError(result.error);
    expect(rendered).toContain(`Slug '${CONFLICT_SLUG}' already exists`);
    expect(rendered).toContain(winner.id);
    expect(rendered).not.toContain(loser.id);
  });
});

describe("AC-3 SSOT: no store constructs DUPLICATE_SLUG from the REJECTED doc's own id", () => {
  const STORE_DIR = fileURLToPath(new URL("../../../src/store/", import.meta.url));
  const STORE_FILES_THAT_MUST_CONSTRUCT_IT = [
    "sqlite-store.ts",
    "turso-store.ts",
    "in-memory-store.ts",
  ] as const;

  /**
   * One construction site per store implementation, each fed by a real
   * conflict lookup. The count is asserted EXACTLY (not `<= 3`) so that a
   * fourth store — or a fifth site smuggled back into an existing one — fails
   * here and sends its author to this comment.
   */
  const EXPECTED_CONSTRUCTION_SITE_COUNT = 3;

  function scanStoreSources(): {
    scannedFiles: string[];
    rejectedDocIdSites: string[];
    constructionSites: string[];
  } {
    const scannedFiles = readdirSync(STORE_DIR).filter((name) => name.endsWith(".ts"));
    const rejectedDocIdSites: string[] = [];
    const constructionSites: string[] = [];

    for (const file of scannedFiles) {
      const lines = readFileSync(join(STORE_DIR, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        // reason: comment lines are skipped so that PROSE about this invariant
        // (including the why-comments this very fix added, which necessarily
        // quote the field name) never counts as a construction site — the
        // census must measure code, not documentation of code.
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (!/existing_id\s*:/.test(line)) return;
        constructionSites.push(`${file}:${index + 1}`);
        if (/existing_id\s*:\s*doc\.id\b/.test(line)) {
          rejectedDocIdSites.push(`${file}:${index + 1}`);
        }
      });
    }
    return { scannedFiles, rejectedDocIdSites, constructionSites };
  }

  it("no store file assigns existing_id from the doc being inserted", () => {
    const { scannedFiles, rejectedDocIdSites } = scanStoreSources();

    // Positive control: without this, a renamed or empty directory would make
    // the census below vacuously true.
    for (const required of STORE_FILES_THAT_MUST_CONSTRUCT_IT) {
      expect(scannedFiles).toContain(required);
    }

    expect(
      rejectedDocIdSites,
      `existing_id must name the doc ALREADY HOLDING the slug, resolved by a conflict lookup — ` +
        `never \`doc.id\`, which is the id of the doc the UNIQUE constraint just rejected and which ` +
        `was therefore never persisted. Offending sites: ${rejectedDocIdSites.join(", ")}`,
    ).toEqual([]);
  });

  it("exactly one construction site per store implementation, and every store still has one", () => {
    const { constructionSites } = scanStoreSources();

    for (const required of STORE_FILES_THAT_MUST_CONSTRUCT_IT) {
      const sitesInFile = constructionSites.filter((site) => site.startsWith(`${required}:`));
      expect(
        sitesInFile.length,
        `${required} must construct DUPLICATE_SLUG at exactly ONE site (found ${sitesInFile.length}: ${sitesInFile.join(", ")})`,
      ).toBe(1);
    }

    expect(
      constructionSites.length,
      `Every DUPLICATE_SLUG construction site in src/store must resolve the WINNER's id through a ` +
        `conflict lookup — see SQLiteStore.findSlugConflictIdSync, TursoStore.findSlugConflictId, ` +
        `InMemoryStore.findSlugConflict. A new site here means a new store: give it a lookup and ` +
        `bump this count. Sites: ${constructionSites.join(", ")}`,
    ).toBe(EXPECTED_CONSTRUCTION_SITE_COUNT);
  });
});

runStoreCoreSuite({
  label: "SQLiteStore",
  createStore: () => actedStore(new SQLiteStore(":memory:")),
  destroyStore: (store) => store.close(),
});

runStoreJudgmentsSuite({
  label: "SQLiteStore",
  createStore: () => actedStore(new SQLiteStore(":memory:")),
  destroyStore: (store) => store.close(),
  enforcesForeignKeys: true,
});

// Disk-backed size contract: a temp-file SQLiteStore (the suites above use ":memory:").
runFileBackedDbSizeSuite({
  label: "SQLiteStore",
  createStore: () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lore-db-size-"));
    const store = actedStore(new SQLiteStore(join(tempDir, "test.db")));
    // reason: stash tempDir on the instance so destroyStore can remove it.
    (store as SQLiteStore & { __tmpDir?: string }).__tmpDir = tempDir;
    return store;
  },
  destroyStore: (store) => {
    const sqlite = store as SQLiteStore & { __tmpDir?: string };
    sqlite.close();
    if (sqlite.__tmpDir !== undefined) rmSync(sqlite.__tmpDir, { recursive: true, force: true });
  },
});
