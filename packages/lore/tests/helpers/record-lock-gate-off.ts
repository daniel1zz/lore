/**
 * Test helper: a RecordLockService whose `record-edit` gate is switched off through the SAME config knob
 * production uses (`workflow.gates."record-edit".enabled: false`, BR-1053).
 *
 * Why it exists: `RecordLockService` is a REQUIRED dependency of CorpusService / VersionService /
 * AcService / PhaseService (spec-documents-are-living-or-records D17), and with the gate on an approved
 * spec / ADR / knowledge record is never rewritten. Suites that were written to pin the PRE-LOCK
 * behaviour of those writes (BR-722 approved->draft demotion, the ledger reset-then-re-approve pair,
 * `ac add|set` on an approved spec) keep pinning it through the one sanctioned switch instead of being
 * rewritten; the gate's own behaviour is pinned in `record-lock-gate.test.ts` and
 * `record-lock-ac-restore.test.ts`.
 */

import { LoreConfigSchema } from "@lore/core";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import type { StoreInterface } from "../../src/store/store-interface.js";

/**
 * @param store - The store the owning services share.
 * @returns A RecordLockService that never refuses (the gate is disabled by config).
 */
export function recordLockGateOff(store: StoreInterface): RecordLockService {
  const config = LoreConfigSchema.parse({
    project: { name: "record-lock-gate-off", author: "tester" },
    workflow: { gates: { "record-edit": { enabled: false } } },
  });
  return new RecordLockService(store, new GateEnforcer(config));
}
