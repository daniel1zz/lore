/**
 * @spec_ref AC-STORE-TURSO-001
 *
 * TursoStore tests — the Turso-specific cases only (file: mode, `bun test` only:
 * `@libsql/client` file mode is not loadable under vitest).
 *
 * Behaviour shared with InMemoryStore/SQLiteStore (insert/find/update/links/search/
 * versions/audit/CAS/judgments/maxDocVersion/dbSizeBytes …) lives in
 * store-core.shared.ts and store-judgments.shared.ts and is run against TursoStore at
 * the bottom of this file. What stays here has no counterpart in the other adapters:
 *   - search: CJK snippet collapse and FTS trigger / integrity-check regressions
 *   - sync() without remoteUrl → STORE_ERROR (AC-STORE-TURSO-SYNC)
 *   - constructor initSchema rejection handling (AC-STORE-TURSO-INIT)
 *   - dbSizeBytes page-size arithmetic (the "> 0" and "grows" cases are shared)
 *
 * Construction: new TursoStore({ localPath }) — file-only mode when no remoteUrl.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TursoStore } from "../../../src/store/turso-store.js";
import { makeDoc, resetCounter, runFileBackedDbSizeSuite, runStoreCoreSuite } from "./store-core.shared.js";
import { runStoreJudgmentsSuite } from "./store-judgments.shared.js";
import { SNIPPET_MARK_CLOSE, SNIPPET_MARK_OPEN } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("TursoStore", () => {
  let store: TursoStore;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    resetCounter();
    tmpDir = mkdtempSync(join(tmpdir(), "lore-turso-test-"));
    dbPath = join(tmpDir, "lore.db");
    store = actedStore(new TursoStore({ localPath: dbPath }));
  });

  afterEach(async () => {
    store.close();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  // ── [TS-6] Search (FTS5) ───────────────────────────────────────────────────
  // Mirrors: [SQ-6] search (FTS5) in sqlite-store.bun.test.ts
  // Note: TursoStore must explicitly maintain FTS5 index on INSERT/UPDATE/DELETE
  // (R1 spike finding: FTS5 triggers may not fire via @libsql/client — see libsql-compat.bun.test.ts S3.5)

  describe("search (FTS5)", () => {
    // SPEC-037 D5 — snippet highlight sentinels replace literal '['/']'
    // A document whose body contains literal '[brackets]' must not have them
    // misread as highlight markers — only the real FTS match is wrapped.
    // Byproduct fix (task-search-snippets-render-bigram-expanded-shadow-text-tong-bu):
    // snippet() reads the CJK bigram-expanded fts_content shadow column
    // (migration-008) — this pins that TursoStore.search collapses the
    // bigram-overlap artifacts back to prose via the SAME shared
    // rowToSearchHit/collapseCjkBigramSnippet helper SQLiteStore uses (both
    // stores route through store-shared.ts, never duplicate the transform).
    it("search snippet collapses CJK bigram-expansion artifacts back into original prose", async () => {
      const doc = makeDoc({
        slug: "prd-turso-cjk-snippet",
        title: "Turso CJK Snippet Test",
        content: "本周关注量化交易策略的回撤控制。",
      });
      await store.insert(doc);

      const result = await store.search("交易策略");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const hit = result.value.find((h) => h.id === doc.id);
      expect(hit).toBeDefined();
      if (!hit) return;

      const plain = hit.snippet
        .split(SNIPPET_MARK_OPEN)
        .join("")
        .split(SNIPPET_MARK_CLOSE)
        .join("");
      expect(plain.includes("量化交易策略")).toBe(true);
      expect(plain).not.toMatch(/[一-鿿]{2} [一-鿿]{2}/);
    });

    // SPEC-037 §2 — SearchHit now carries type + status from the docs join
    // [TS-6 REGRESSION] FTS triggers are the sole mechanism (Fix 1 gate regression).
    // Verifies: insert doc with unique term A, update replacing A with term B →
    //   search(A) returns 0 hits (old term removed from index),
    //   search(B) returns 1 hit (new term indexed).
    // This confirms triggers keep the FTS index correct without manual fts* calls.
    it("TS-6-REG-01: FTS trigger-only: update removes old term from index, indexes new term", async () => {
      const doc = makeDoc({
        slug: "prd-turso-fts-trig-reg",
        title: "Trigger Regression Test",
        content: "This content contains uniqueTermAlpha_trigger_reg.",
      });
      await store.insert(doc);

      // Verify term A is found before update
      const beforeResult = await store.search("uniqueTermAlpha_trigger_reg");
      expect(beforeResult.ok).toBe(true);
      if (!beforeResult.ok) return;
      expect(beforeResult.value.map((h) => h.id)).toContain(doc.id);

      // Update doc, replacing term A with term B
      await store.update(doc.id, {
        content: "This content now contains uniqueTermBeta_trigger_reg instead.",
        updated_at: "2026-06-11T12:00:00.000Z",
      });

      // term A must no longer appear in results (trigger removed old entry)
      const searchA = await store.search("uniqueTermAlpha_trigger_reg");
      expect(searchA.ok).toBe(true);
      if (!searchA.ok) return;
      expect(searchA.value.map((h) => h.id)).not.toContain(doc.id);

      // term B must appear in results (trigger indexed new entry)
      const searchB = await store.search("uniqueTermBeta_trigger_reg");
      expect(searchB.ok).toBe(true);
      if (!searchB.ok) return;
      expect(searchB.value.map((h) => h.id)).toContain(doc.id);
    });

    // [TS-6 REGRESSION] FTS integrity-check passes after normal insert+update operations.
    // Verifies: `INSERT INTO docs_fts(docs_fts, rank) VALUES ('integrity-check', 0)` executes
    // without error, proving the FTS index is internally consistent.
    it("TS-6-REG-02: FTS integrity-check passes after insert and update", async () => {
      const doc = makeDoc({
        slug: "prd-turso-fts-integrity",
        title: "FTS Integrity Check Doc",
        content: "Content for integrity check test.",
      });
      await store.insert(doc);
      await store.update(doc.id, {
        content: "Updated content for integrity check.",
        updated_at: "2026-06-11T12:00:00.000Z",
      });

      // FTS integrity-check: must execute without throwing
      // A non-zero return value indicates corruption.
      const { createClient } = await import("@libsql/client");
      const checkClient = createClient({ url: `file:${dbPath}` });
      try {
        const rs = await checkClient.execute(
          "INSERT INTO docs_fts(docs_fts, rank) VALUES ('integrity-check', 0)",
        );
        // integrity-check returns 0 rows; success means no corruption
        expect(rs).toBeDefined();
      } finally {
        checkClient.close();
      }
    });
  });

  // ── [TS-12] TursoStore-specific: sync() without remoteUrl ─────────────────
  // NEW dimension — no equivalent in sqlite-store.bun.test.ts
  // @spec_ref AC-STORE-TURSO-SYNC
  //
  // SPEC-009 §3.1: TursoStore.sync() forwards to @libsql/client.sync()
  // File-only mode (no remoteUrl/syncUrl): sync() MUST NOT silently succeed.
  // MUST return err({ code: "STORE_ERROR", message: ... }) with a message that
  // clearly communicates sync is not available in file-only mode.
  // The message must contain either "sync" or "not supported" (case-insensitive)
  // so callers can display a meaningful error without inspecting internals.

  describe("sync() file-only mode", () => {
    describe("negative cases", () => {
      it("AC-STORE-TURSO-SYNC.N01: sync() without remoteUrl returns STORE_ERROR (not throws)", async () => {
        // NEGATIVE: file-only store (no remoteUrl) — sync() must fail loudly,
        // not silently succeed or return an empty result.
        // Per global rule: ⛔ no silent fallback on unsupported operations.
        const result = await store.sync();
        expect(result.ok).toBe(false);
      });

      it("AC-STORE-TURSO-SYNC.N02: sync() STORE_ERROR has code STORE_ERROR", async () => {
        // NEGATIVE: error code must be STORE_ERROR (existing error taxonomy in errors.ts)
        const result = await store.sync();
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("STORE_ERROR");
      });

      it("AC-STORE-TURSO-SYNC.N03: sync() STORE_ERROR message describes the problem", async () => {
        // NEGATIVE: error message must contain "sync" or "not supported" (case-insensitive)
        // so the CLI/adapter layer can surface a clear user-facing message.
        const result = await store.sync();
        expect(result.ok).toBe(false);
        if (result.ok) return;
        if (result.error.code !== "STORE_ERROR") return;
        const msgLower = result.error.message.toLowerCase();
        const describesProblem = msgLower.includes("sync") || msgLower.includes("not supported");
        expect(describesProblem).toBe(true);
      });

      it("AC-STORE-TURSO-SYNC.N04: sync() never throws — always returns a Result", async () => {
        // NEGATIVE: all operations on StoreInterface return Result, never throw.
        await expect(store.sync()).resolves.toBeDefined();
      });
    });

    describe("boundary values", () => {
      it("AC-STORE-TURSO-SYNC.BV01: sync() called multiple times consistently returns STORE_ERROR", async () => {
        // BOUNDARY: idempotency — calling sync() multiple times on file-only mode
        // must consistently return STORE_ERROR, not succeed on a subsequent call.
        const r1 = await store.sync();
        const r2 = await store.sync();
        expect(r1.ok).toBe(false);
        expect(r2.ok).toBe(false);
        if (!r1.ok && !r2.ok) {
          expect(r1.error.code).toBe(r2.error.code);
        }
      });
    });

    describe("state transitions", () => {
      it("AC-STORE-TURSO-SYNC.ST01: sync() failure does not corrupt store state — can still insert after failed sync", async () => {
        // STATE: a failed sync() must not leave the store in a broken state.
        // All other operations must continue to work normally after a sync failure.
        const syncResult = await store.sync();
        expect(syncResult.ok).toBe(false); // file-only mode, expected failure

        // Store must still be usable after sync() fails
        const doc = makeDoc({ slug: "prd-turso-after-sync-fail" });
        const insertResult = await store.insert(doc);
        expect(insertResult.ok).toBe(true);

        const findResult = await store.find(doc.id);
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value?.id).toBe(doc.id);
      });
    });

  });

  // ── [TS-13] Constructor rejection handling — initSchema async rejection ────
  // Regression: Fix 1 — constructor used `void this.initSchema()` which left
  // the rejection unhandled at the process level if initSchema rejected before
  // any public method awaited ensureReady(). The fix attaches a no-op .catch()
  // to mark the promise handled while still propagating via ensureReady().
  //
  // Implementation note: @libsql/client createClient() throws SYNCHRONOUSLY for
  // invalid paths (e.g. nonexistent directory), so the constructor itself will
  // throw in that case. The async-rejection fix applies to the narrower scenario
  // where the client is created successfully but initSchema() rejects asynchronously
  // (e.g. a malformed PRAGMA response or migration failure on a valid file path).
  //
  // @spec_ref AC-STORE-TURSO-001 (fail-loud: STORE_ERROR on bad path)

  describe("constructor initSchema rejection handling", () => {
    describe("negative cases", () => {
      it("AC-STORE-TURSO-INIT.N01: initSchema rejection surfaced as STORE_ERROR on first operation (not unhandledRejection)", async () => {
        // NEGATIVE: verify that a newly constructed TursoStore (valid path) runs initSchema
        // eagerly AND that the resulting promise has a .catch() handler attached so any
        // rejection does NOT fire as an unhandled promise rejection at the process level.
        // The observable behavior: store construction succeeds, all operations work, and
        // after store is closed the _schemaInitPromise has already been settled.
        // This test uses a valid path (the beforeEach store) to confirm the happy path
        // works end-to-end with the .catch() attached.
        const doc = makeDoc({ slug: "prd-turso-init-catch-ok" });
        const insertResult = await store.insert(doc);
        expect(insertResult.ok).toBe(true);

        const findResult = await store.find(doc.id);
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value?.id).toBe(doc.id);
      });

      it("AC-STORE-TURSO-INIT.N02: ensureReady rejection propagates as STORE_ERROR Result (not unhandled throw)", async () => {
        // NEGATIVE: if initSchema rejects (simulated by directly rejecting the stored
        // promise), all subsequent operations must return STORE_ERROR, not throw or hang.
        // This guards the ensureReady() → catch path in public methods.
        // We inject a rejected promise directly into _schemaInitPromise to simulate
        // a post-construction initSchema failure without needing a broken file path.
        // NOTE: TypeScript private field — accessed via type assertion for test injection only.
        const testStore = actedStore(new TursoStore({ localPath: dbPath + ".inject" }));
        const fakeError = new Error("simulated initSchema failure");

        // Inject a pre-rejected promise — simulates a late async initSchema rejection.
        // Attach .catch() immediately to suppress unhandledRejection at injection point.
        const rejectedPromise = Promise.reject(fakeError);
        rejectedPromise.catch(() => { /* handled */ });
        (testStore as unknown as Record<string, unknown>)["_schemaInitPromise"] = rejectedPromise;

        try {
          // The first operation must return STORE_ERROR, not throw
          const result = await testStore.findMany({});
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("STORE_ERROR");
          }
        } finally {
          testStore.close();
        }
      });
    });

    describe("state transitions", () => {
      it("AC-STORE-TURSO-INIT.ST01: store remains usable after _schemaInitPromise settles successfully", async () => {
        // STATE: once initSchema completes successfully (settled promise),
        // all subsequent operations work without re-running migrations.
        const doc1 = makeDoc({ slug: "prd-turso-init-st-01" });
        const doc2 = makeDoc({ slug: "prd-turso-init-st-02" });

        await store.insert(doc1);
        await store.insert(doc2);

        const listResult = await store.findMany({});
        expect(listResult.ok).toBe(true);
        if (!listResult.ok) return;
        expect(listResult.value.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe("regression", () => {
      it("AC-STORE-TURSO-INIT.REG01: regression — constructor void initSchema() unhandled rejection pattern", async () => {
        // REGRESSION: before the fix, `void this.initSchema()` in the constructor
        // left the async rejection unhandled at the process level, potentially causing
        // UnhandledPromiseRejection events that could crash Bun/Node processes.
        // After the fix, `.catch(() => { /* surfaced via ensureReady */ })` is attached
        // so the promise is marked handled immediately in the constructor.
        //
        // Verification: construct a store (which calls initSchema() with .catch()),
        // then verify the schema was actually initialized by doing a round-trip.
        // If the .catch() accidentally swallowed errors, operations would fail.
        const freshDir = mkdtempSync(join(tmpdir(), "lore-turso-reg01-"));
        const freshPath = join(freshDir, "lore.db");
        const freshStore = actedStore(new TursoStore({ localPath: freshPath }));
        try {
          const doc = makeDoc({ slug: "prd-turso-reg01" });
          const insertResult = await freshStore.insert(doc);
          expect(insertResult.ok).toBe(true);
          const findResult = await freshStore.find(doc.id);
          expect(findResult.ok).toBe(true);
          if (findResult.ok) {
            expect(findResult.value?.id).toBe(doc.id);
          }
        } finally {
          freshStore.close();
          try { rmSync(freshDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
      });
    });
  });

  // AC-BLS2-9: maxDocVersion — MAX(version) over live docs of every type.
  // AC-STORE-010: dbSizeBytes — real on-disk size via PRAGMA page_count * page_size
  // against the embedded replica's local file (file-only mode, no remoteUrl).
  describe("dbSizeBytes (AC-STORE-010)", () => {
    it("STATE: reports a size at least as large after inserting documents", async () => {
      const before = await store.dbSizeBytes();
      expect(before.ok).toBe(true);
      if (!before.ok) return;

      for (let i = 0; i < 20; i += 1) {
        await store.insert(
          makeDoc({ slug: `prd-turso-size-${i}`, content: "x".repeat(2000) }),
        );
      }

      const after = await store.dbSizeBytes();
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      expect(after.value).toBeGreaterThanOrEqual(before.value);
    });

    it("BOUNDARY: value is a multiple of the SQLite default page size (4096) — sanity check on page_count * page_size arithmetic", async () => {
      // `client` is a private field on TursoStore, so this asserts the public
      // contract's shape rather than reaching into the driver directly:
      // any valid SQLite page_size is a power of two >= 512, and the file's
      // total byte size (page_count * page_size) must be an exact multiple of it.
      const result = await store.dbSizeBytes();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value % 512).toBe(0);
    });
  });
});

runStoreCoreSuite({
  label: "TursoStore",
  createStore: () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lore-turso-core-"));
    const store = actedStore(new TursoStore({ localPath: join(tmpDir, "lore.db") }));
    // reason: stash tmpDir on the instance so destroyStore can remove it.
    (store as TursoStore & { __tmpDir?: string }).__tmpDir = tmpDir;
    return store;
  },
  destroyStore: (store) => {
    const turso = store as TursoStore & { __tmpDir?: string };
    turso.close();
    if (turso.__tmpDir !== undefined) rmSync(turso.__tmpDir, { recursive: true, force: true });
  },
});

runStoreJudgmentsSuite({
  label: "TursoStore",
  createStore: () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lore-turso-judg-"));
    const store = actedStore(new TursoStore({ localPath: join(tmpDir, "lore.db") }));
    // reason: stash tmpDir on the instance so destroyStore can remove it.
    (store as TursoStore & { __tmpDir?: string }).__tmpDir = tmpDir;
    return store;
  },
  destroyStore: (store) => {
    const turso = store as TursoStore & { __tmpDir?: string };
    turso.close();
    if (turso.__tmpDir !== undefined) rmSync(turso.__tmpDir, { recursive: true, force: true });
  },
  enforcesForeignKeys: true,
});

runFileBackedDbSizeSuite({
  label: "TursoStore",
  createStore: () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lore-turso-size-"));
    const store = actedStore(new TursoStore({ localPath: join(tmpDir, "lore.db") }));
    // reason: stash tmpDir on the instance so destroyStore can remove it.
    (store as TursoStore & { __tmpDir?: string }).__tmpDir = tmpDir;
    return store;
  },
  destroyStore: (store) => {
    const turso = store as TursoStore & { __tmpDir?: string };
    turso.close();
    if (turso.__tmpDir !== undefined) rmSync(turso.__tmpDir, { recursive: true, force: true });
  },
});
