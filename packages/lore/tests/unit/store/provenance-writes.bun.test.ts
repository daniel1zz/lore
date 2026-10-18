/**
 * Cross-store parity: `SQLiteStore` and `TursoStore` both run the SAME shared
 * suite (`provenance-writes.shared.ts`) for `insertWithProvenance` /
 * `updateWithProvenance` / `softDeleteWithProvenance` (BUG-002) — proving REAL
 * transaction rollback (`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` for SQLite, a real
 * `client.transaction()` for Turso), not just a manual in-memory undo.
 * `InMemoryStore` runs the identical suite under vitest
 * (`provenance-writes.test.ts`).
 *
 * Runner: bun:sqlite / @libsql/client file mode — must run under `bun test`,
 * not vitest (see store/CLAUDE.md "bun:sqlite is external to vitest").
 *
 * @spec_ref audit finding BUG-002 — corpus-service.ts _createImpl/set/delete
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { runProvenanceWritesSuite } from "./provenance-writes.shared.js";
import { actedStore } from "../../live-invocation.js";

runProvenanceWritesSuite({
  label: "SQLiteStore",
  createStore: () => actedStore(new SQLiteStore(":memory:")),
  destroyStore: (store) => {
    (store as SQLiteStore).close();
  },
});

runProvenanceWritesSuite({
  label: "TursoStore",
  createStore: () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lore-turso-provenance-writes-"));
    const dbPath = join(tmpDir, "lore.db");
    const store = actedStore(new TursoStore({ localPath: dbPath }));
    // reason: stash tmpDir on the instance so destroyStore can clean it up —
    // mirrors batch-methods.bun.test.ts's identical suite-factory pairing.
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
        // failure, mirrors batch-methods.bun.test.ts's own afterEach swallow.
      }
    }
  },
});
