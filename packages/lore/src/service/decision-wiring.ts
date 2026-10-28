/**
 * Decision wiring: the composition roots' one-liners that arm the decision gate (BR-1476).
 *
 * Purpose: keep `app.ts` (two composition roots) to one call per root: {@link buildDecisionGate} makes the gate over the
 *   real git port, {@link armDecisionGate} arms a gated service and returns it so a root arms and constructs in one expression.
 * Public surface: {@link buildDecisionGate}, {@link armDecisionGate}.
 * Invariants: the git port asks its questions at the repository of `cwd` (the invoking checkout), resolved on first use.
 * Side-effect class: pure construction.
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, D2.
 */

import { DecisionGate } from "./decision-gate.js";
import { SpawnDecisionGitPort } from "./decision-git-port.js";
import type { StoreInterface } from "../store/store-interface.js";
import { buildWeightTableLookup } from "./weight-table-service.js";

/**
 * The decision gate of one composition root.
 *
 * @param cwd - the invocation's directory (`AppAmbient.cwd`)
 * @param store - the corpus store, where a decision's weight table is looked up (BR-1482)
 */
export function buildDecisionGate(cwd: string, store: StoreInterface): DecisionGate {
  return new DecisionGate(new SpawnDecisionGitPort(cwd), buildWeightTableLookup(store));
}

/** A service that refuses its decision-carrying writes without a decision once armed (`RuleService`, `RuleChangeService`, `AcService`). */
export interface DecisionGated {
  setDecisionGate(gate: DecisionGate): void;
}

/**
 * Arm `service` with `gate` and return it, so a composition root arms and constructs in one expression.
 *
 * @param service - the service whose decision-carrying writes are gated
 * @param gate - the root's gate
 */
export function armDecisionGate<T extends DecisionGated>(service: T, gate: DecisionGate): T {
  service.setDecisionGate(gate);
  return service;
}
