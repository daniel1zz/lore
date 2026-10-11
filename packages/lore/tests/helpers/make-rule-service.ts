/**
 * Test helper: a `RuleService` over `store` with its node-creation port wired to a bare `CorpusService`
 * whose record-edit enforcer is an explicit, config-less `GateEnforcer` (gate on, no audit port).
 *
 * Purpose: `RuleService` requires its `createDoc` port (it builds no CorpusService of its own), so a unit
 * test that only needs a RuleService over a store builds the wiring here instead of repeating it.
 * Side-effect class: pure construction.
 */

import type { StoreInterface } from "../../src/store/store-interface.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { RuleService } from "../../src/service/rule-service.js";

/**
 * @param store - The store the rule writes and the created baseline nodes land in.
 * @returns A RuleService whose `addNode` creates through a `CorpusService` over the same store.
 */
export function makeRuleService(store: StoreInterface): RuleService {
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return new RuleService(store, corpus.create.bind(corpus));
}
