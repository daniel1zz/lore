/**
 * InMemoryStore's run of the shared `insertWithAllocatedOrdinalAndProvenance`
 * suite (`insert-with-allocated-ordinal-and-provenance.shared.ts`) — the
 * SQLiteStore/TursoStore twin (`.bun.test.ts`) exercises real transaction
 * rollback; this vitest twin exercises InMemoryStore's manual-undo path.
 * `supportsPkCollisionAtomicity: false` mirrors `provenance-writes.test.ts`'s
 * identical gap (no real `(doc_id, version)` uniqueness constraint to collide
 * with) — InMemoryStore's own dedicated atomicity coverage lives in
 * `in-memory-store-ordinal-provenance-atomicity.test.ts` (failure-injection
 * subclass technique).
 *
 * @spec_ref task-skill-implement-ordinal-aware-provenance-composite (SPEC-084 follow-up, BUG-002)
 */

import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { runInsertWithAllocatedOrdinalAndProvenanceSuite } from "./insert-with-allocated-ordinal-and-provenance.shared.js";
import { actedStore } from "../../live-invocation.js";

runInsertWithAllocatedOrdinalAndProvenanceSuite({
  label: "InMemoryStore",
  createStore: () => actedStore(new InMemoryStore()),
  destroyStore: () => {
    // reason: no external resources to release — mirrors
    // provenance-writes.test.ts's identical no-op destroyStore.
  },
  supportsPkCollisionAtomicity: false,
});
