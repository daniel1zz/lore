/**
 * Cross-store parity: `InMemoryStore` runs the SAME shared suite
 * (`provenance-writes.shared.ts`) as `SQLiteStore`/`TursoStore`
 * (`provenance-writes.bun.test.ts`) for `insertWithProvenance` /
 * `updateWithProvenance` / `softDeleteWithProvenance` (BUG-002).
 *
 * Runner: vitest (no bun:sqlite dependency).
 *
 * @spec_ref audit finding BUG-002 — corpus-service.ts _createImpl/set/delete
 */

import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { runProvenanceWritesSuite } from "./provenance-writes.shared.js";

runProvenanceWritesSuite({
  label: "InMemoryStore",
  createStore: () => new InMemoryStore(),
  destroyStore: () => {
    // reason: no external resources — nothing to release.
  },
  // reason: InMemoryStore.insertVersion has no real (doc_id, version) PK
  // constraint (bare push(), by design — see store/CLAUDE.md "InMemoryStore
  // mirrors SQLiteStore semantics, not [constraint enforcement]"), so the
  // shared suite's PK-collision atomicity tests are skipped here.
  // InMemoryStore's OWN atomicity coverage — via the AC-prescribed
  // subclass-wrapper failure-injection technique — lives in
  // in-memory-store-provenance-atomicity.test.ts.
  supportsPkCollisionAtomicity: false,
});
