/**
 * Decision wiring: the composition roots' one-liners that arm the decision gate (BR-1476).
 *
 * Purpose: keep `app.ts` (two composition roots) to one call per root: {@link buildDecisionGate} makes the gate over the
 *   real git port, {@link armDecisionGate} arms a `RuleService` and returns it so a root arms and constructs in one expression.
 * Public surface: {@link buildDecisionGate}, {@link armDecisionGate}.
 * Invariants: the git port asks its questions at the repository of `cwd` (the invoking checkout), resolved on first use.
 * Side-effect class: pure construction.
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, D2.
 */

import { DecisionGate } from "./decision-gate.js";
import { SpawnDecisionGitPort } from "./decision-git-port.js";
import type { RuleService } from "./rule-service.js";

/**
 * The decision gate of one composition root.
 *
 * @param cwd - the invocation's directory (`AppAmbient.cwd`)
 */
export function buildDecisionGate(cwd: string): DecisionGate {
  return new DecisionGate(new SpawnDecisionGitPort(cwd));
}

/**
 * Arm `ruleService` with `gate` and return it.
 *
 * @param ruleService - the service whose baseline node verbs are gated
 * @param gate - the root's gate
 */
export function armDecisionGate(ruleService: RuleService, gate: DecisionGate): RuleService {
  ruleService.setDecisionGate(gate);
  return ruleService;
}
