/**
 * Cross-store parity: `SQLiteStore` and `TursoStore` both run the SAME shared
 * suite (`batch-methods.shared.ts`) for `findByIds` / `findLinksByFromIds` —
 * the two batch methods that close the M6/M7 N+1 patterns. `InMemoryStore`
 * runs the identical suite under vitest (`batch-methods.test.ts`).
 *
 * Runner: bun:sqlite / @libsql/client file mode — must run under `bun test`,
 * not vitest (see store/CLAUDE.md "bun:sqlite is external to vitest").
 *
 * @spec_ref N+1 batch-method hardening (store-layer review M5/M6/M7)
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { runBatchStoreMethodsSuite } from "./batch-methods.shared.js";
import { actedStore } from "../../live-invocation.js";

runBatchStoreMethodsSuite({
  label: "SQLiteStore",
  createStore: () => actedStore(new SQLiteStore(":memory:")),
  destroyStore: (store) => {
    (store as SQLiteStore).close();
  },
});

runBatchStoreMethodsSuite({
  label: "TursoStore",
  createStore: () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lore-turso-batch-methods-"));
    const dbPath = join(tmpDir, "lore.db");
    const store = actedStore(new TursoStore({ localPath: dbPath }));
    // reason: stash tmpDir on the instance so destroyStore can clean it up —
    // mirrors turso-store.bun.test.ts's beforeEach/afterEach tmpDir pairing,
    // just folded into this suite-factory's single createStore/destroyStore
    // shape instead of two separate hook callbacks.
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
