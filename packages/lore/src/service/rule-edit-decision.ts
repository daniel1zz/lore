/**
 * Rule edit decision: what `lore rule set` owes beyond the common decision (BR-1477): the confidence-raise refusal, the
 * written gate `meaning-unchanged`, the computed gate `evidence-s-to-c` and the replaced statement (`before`).
 *
 * Purpose: ONE home for the rule-specific half of a decision-carrying `rule set`, so `RuleService` asks one function and
 *   never re-derives the trivial test, the raise test or either gate.
 * Public surface: {@link judgeRuleEdit}, {@link RuleEditFacts}.
 * Invariants:
 *   - Pure over its inputs plus the injected {@link DecisionGate}; asks git only through that gate (file premises).
 *   - A trivial patch (examples only, or confidence lowered only) is judged `required: false`: a supplied decision is still
 *     validated, none is demanded.
 *   - A confidence raise is refused whatever decision accompanies it (D7: it goes through a spec's change set).
 *   - `evidence-s-to-c` is always lore's own verdict (`computed: true`); a writer-supplied gate of that id is discarded, not
 *     trusted (a declared verdict for a computable fact invites a false declaration, D7). A D or E premise makes it `fail`:
 *     recorded, never a refusal.
 *   - `meaning-unchanged` must be writer-given and `pass` for a statement change; missing or `fail` is a refusal.
 * Side-effect class: pure (git is asked only through the injected gate).
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, "Refusal" (statement changes on `rule set`), D3, D7;
 *   BR-1477.
 */

import {
  GATE_EVIDENCE_S_TO_C,
  GATE_MEANING_UNCHANGED,
  err,
  isConfidenceLowered,
  isStrongTier,
  isTrivialRulePatch,
  ok,
  type DecisionGate as StoredGate,
  type DecisionRecord,
  type LoreError,
  type Result,
} from "@lore/core";
import { DECISION_FIELD, type DecisionDraft, type DecisionGate } from "./decision-gate.js";

/** What the service knows about one `rule set` call. */
export interface RuleEditFacts {
  /** The write carries a decision at all (agent run, leaf with an approved version). */
  readonly carriesDecision: boolean;
  /** The rule as it reads before the patch (the pending revision laid over the approved version). */
  readonly current: { readonly statement: string; readonly confidence: string };
  /** The fields the patch sets (`SetRulePatch`). */
  readonly patch: Readonly<Record<string, unknown>>;
  /** What the writer supplied. */
  readonly draft: DecisionDraft | undefined;
}

function refuse(message: string): LoreError {
  return { code: "VALIDATION_ERROR", field: DECISION_FIELD, message: `${message} Nothing was written.`, rule: "BR-1477" };
}

/** The gate lore computes: pass when every premise is tier S..C. */
function computeEvidenceGate(draft: DecisionDraft | undefined): StoredGate {
  const premises = draft?.premises ?? [];
  const weak = premises.filter((premise) => !isStrongTier(premise.tier));
  if (weak.length === 0) {
    return { id: GATE_EVIDENCE_S_TO_C, verdict: "pass", evidence: `all ${premises.length} premise(s) are tier S..C`, computed: true };
  }
  return {
    id: GATE_EVIDENCE_S_TO_C,
    verdict: "fail",
    evidence: `weak premise(s): ${weak.map((premise) => `"${premise.claim}" (tier ${premise.tier})`).join("; ")}`,
    computed: true,
  };
}

/**
 * Judge one `rule set` call.
 *
 * @param gate - the root's decision gate
 * @param facts - see {@link RuleEditFacts}
 * @returns `ok(undefined)` when nothing is required and nothing was supplied; `ok(record)` with `before` and both gates on a
 *   statement change; otherwise the refusal (confidence raise, missing or failing `meaning-unchanged`, or the common
 *   missing-parts refusal).
 * @example
 * judgeRuleEdit(gate, { carriesDecision: true, current: { statement: "A", confidence: "established" }, patch: { statement: "B" }, draft });
 */
export function judgeRuleEdit(gate: DecisionGate, facts: RuleEditFacts): Result<DecisionRecord | undefined, LoreError> {
  const required = facts.carriesDecision && !isTrivialRulePatch(facts.current.confidence, facts.patch);
  if (!required) return gate.judge({ required: false, draft: facts.draft });

  const wanted = facts.patch["confidence"];
  if (typeof wanted === "string" && isConfidenceLowered(wanted, facts.current.confidence)) {
    return err(
      refuse(
        `Raising a rule's confidence (${facts.current.confidence} to ${wanted}) is not a direct edit: propose it in a spec's change set with ` +
          "`lore rule propose <spec> modify <BR-n> ...`.",
      ),
    );
  }

  const statement = facts.patch["statement"];
  const changesStatement = typeof statement === "string" && statement !== facts.current.statement;
  if (!changesStatement) return gate.judge({ required: true, draft: facts.draft });

  const writerGates = (facts.draft?.gates ?? []).filter((stored) => stored.id !== GATE_EVIDENCE_S_TO_C);
  const withComputed: DecisionDraft = { ...(facts.draft ?? {}), gates: [...writerGates, computeEvidenceGate(facts.draft)] };
  const judged = gate.judge({ required: true, draft: withComputed });
  if (!judged.ok) return judged;
  if (judged.value === undefined) return judged;

  const meaning = (judged.value.gates ?? []).find((stored) => stored.id === GATE_MEANING_UNCHANGED && !stored.computed);
  if (meaning === undefined) {
    return err(refuse(`A statement change must state the gate meaning-unchanged: --gate "${GATE_MEANING_UNCHANGED}|pass|<evidence the new text means what the old did>".`));
  }
  if (meaning.verdict !== "pass") {
    return err(refuse(`The gate ${GATE_MEANING_UNCHANGED} is ${meaning.verdict}: a change of meaning is not a rewording; propose it in a spec's change set with \`lore rule propose <spec> modify <BR-n> ...\`.`));
  }
  return ok({ ...judged.value, before: facts.current.statement });
}
