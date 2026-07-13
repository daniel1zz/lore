/**
 * Cross-store parity: `SQLiteStore` and `TursoStore` both run the SAME shared
 * suite (`paging.shared.ts`) for `findMany`'s `limit`/`offset` fields.
 * `InMemoryStore` runs the identical suite under vitest (`paging.test.ts`).
 *
 * Runner: bun:sqlite / @libsql/client file mode — must run under `bun test`,
 * not vitest (see store/CLAUDE.md "bun:sqlite is external to vitest").
 *
 * @spec_ref pagination hardening (list/findMany read path, unbounded-payload review)
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { runPagingStoreSuite } from "./paging.shared.js";

runPagingStoreSuite({
  label: "SQLiteStore",
  createStore: () => new SQLiteStore(":memory:"),
  destroyStore: (store) => {
    (store as SQLiteStore).close();
  },
});

runPagingStoreSuite({
  label: "TursoStore",
  createStore: () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lore-turso-paging-"));
    const dbPath = join(tmpDir, "lore.db");
    const store = new TursoStore({ localPath: dbPath });
    // reason: stash tmpDir on the instance so destroyStore can clean it up —
    // mirrors batch-methods.bun.test.ts's tmpDir pairing.
    (store as TursoStore & { __tmpDir?: string }).__tmpDir = tmpDir;
    return store;
  },
  destroyStore: (store) => {
    const tursoStore = store as TursoStore & { __tmpDir?: string };
    tursoStore.close();
    if (tursoStore.__tmpDir !== undefined) {
      try {
        rmSync(tursoStore.__tmpDir, { recursive: true, force: true });
      } catch {
        // reason: best-effort cleanup — a leftover temp dir is not a test
        // failure, mirrors turso-store.bun.test.ts's own afterEach swallow.
      }
    }
  },
});
