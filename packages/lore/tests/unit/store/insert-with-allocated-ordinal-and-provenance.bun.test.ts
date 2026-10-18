/**
 * Cross-store parity: `SQLiteStore` and `TursoStore` both run the SAME shared
 * suite (`insert-with-allocated-ordinal-and-provenance.shared.ts`) for
 * `insertWithAllocatedOrdinalAndProvenance` — proving REAL transaction
 * rollback (`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` for SQLite, a real
 * `client.transaction()` for Turso), not just a manual in-memory undo.
 * `InMemoryStore` runs the identical suite under vitest
 * (`insert-with-allocated-ordinal-and-provenance.test.ts`).
 *
 * Runner: bun:sqlite / @libsql/client file mode — must run under `bun test`,
 * not vitest (see store/CLAUDE.md "bun:sqlite is external to vitest").
 *
 * @spec_ref task-skill-implement-ordinal-aware-provenance-composite (SPEC-084 follow-up, BUG-002)
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { runInsertWithAllocatedOrdinalAndProvenanceSuite } from "./insert-with-allocated-ordinal-and-provenance.shared.js";
import { actedStore } from "../../live-invocation.js";

runInsertWithAllocatedOrdinalAndProvenanceSuite({
  label: "SQLiteStore",
  createStore: () => actedStore(new SQLiteStore(":memory:")),
  destroyStore: (store) => {
    (store as SQLiteStore).close();
  },
});

runInsertWithAllocatedOrdinalAndProvenanceSuite({
  label: "TursoStore",
  createStore: () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "lore-turso-ordinal-provenance-"));
    const dbPath = join(tmpDir, "lore.db");
    const store = actedStore(new TursoStore({ localPath: dbPath }));
    // reason: stash tmpDir on the instance so destroyStore can clean it up —
    // mirrors provenance-writes.bun.test.ts's identical suite-factory pairing.
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
        // failure, mirrors provenance-writes.bun.test.ts's own swallow.
      }
    }
  },
});
