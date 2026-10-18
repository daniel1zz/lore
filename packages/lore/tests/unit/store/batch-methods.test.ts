/**
 * Cross-store parity: `InMemoryStore` runs the SAME shared suite
 * (`batch-methods.shared.ts`) as `SQLiteStore`/`TursoStore`
 * (`batch-methods.bun.test.ts`) for `findByIds` / `findLinksByFromIds` — the
 * two batch methods that close the M6/M7 N+1 patterns.
 *
 * Runner: vitest (no bun:sqlite dependency).
 *
 * @spec_ref N+1 batch-method hardening (store-layer review M5/M6/M7)
 */

import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { runBatchStoreMethodsSuite } from "./batch-methods.shared.js";
import { actedStore } from "../../live-invocation.js";

runBatchStoreMethodsSuite({
  label: "InMemoryStore",
  createStore: () => actedStore(new InMemoryStore()),
  destroyStore: () => {
    // reason: no external resources — nothing to release.
  },
});
