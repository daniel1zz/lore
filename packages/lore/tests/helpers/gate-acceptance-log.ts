/**
 * gate-acceptance-log.ts: test helpers for the decision log a gate acceptance lives in (#538, BR-1500).
 *
 * Purpose: a gate is accepted exactly when the decision log holds an effective human accept of class governance-loosen for
 *   subject `<plan id>:<dimension>` at the failure's root-cause fingerprint; tests that need an accepted gate append that
 *   record through the production writer (`DecisionService.decide` + `resolvePending`), never by planting a field on the plan.
 * Public surface: {@link humanAcceptGate}, {@link noDecisionLog}.
 * Side-effect class: IO (appends decision-log rows to the given store).
 */
import { ok } from "@lore/core";
import { DecisionService } from "../../src/service/decision-service.js";
import { GATE_ACCEPTANCE_CLASS, createGateAcceptanceLog, gateAcceptanceSubject, type GateAcceptanceLog } from "../../src/service/gate-acceptance-service.js";
import { issueHumanPartyProof } from "../../src/service/human-channel.js";
import { OVERRIDE_MEASURED_FACTS } from "../../src/service/override-decision.js";
import type { StoreInterface } from "../../src/store/store-interface.js";

/**
 * Appends the human accept of `dimension` of plan `planId` at `fingerprint` to the store's decision log and returns its record id.
 *
 * @throws Error when the decision cannot be recorded (a fixture defect)
 */
export async function humanAcceptGate(store: StoreInterface, planId: string, dimension: string, fingerprint: string): Promise<number> {
  const decisions = new DecisionService({ store, executorRun: null });
  const subject = gateAcceptanceSubject(planId, dimension, fingerprint);
  const decided = await decisions.decide(GATE_ACCEPTANCE_CLASS, subject, OVERRIDE_MEASURED_FACTS);
  if (!decided.ok) throw new Error(`fixture decide failed: ${JSON.stringify(decided.error)}`);
  const pending = await createGateAcceptanceLog(store).pendingId(subject);
  if (!pending.ok || pending.value === null) throw new Error(`fixture: no pending decision for ${subject.id}`);
  const answered = await decisions.resolvePending(pending.value, "accept", "fixture human accept", issueHumanPartyProof(new Date().toISOString()));
  if (!answered.ok) throw new Error(`fixture resolvePending failed: ${JSON.stringify(answered.error)}`);
  return answered.value.id;
}

/** A decision log with no rows: for batch fixtures that accept no gate. */
export function noDecisionLog(): GateAcceptanceLog {
  return createGateAcceptanceLog({ listDecisionLog: async () => ok([]) });
}
