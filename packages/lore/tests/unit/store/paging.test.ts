/**
 * Cross-store parity: `InMemoryStore` runs the SAME shared suite
 * (`paging.shared.ts`) as `SQLiteStore`/`TursoStore` (`paging.bun.test.ts`) for
 * `findMany`'s `limit`/`offset` fields.
 *
 * Runner: vitest (no bun:sqlite dependency).
 *
 * @spec_ref pagination hardening (list/findMany read path, unbounded-payload review)
 */

import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { runPagingStoreSuite } from "./paging.shared.js";

runPagingStoreSuite({
  label: "InMemoryStore",
  createStore: () => new InMemoryStore(),
  destroyStore: () => {
    // reason: no external resources — nothing to release.
  },
});
