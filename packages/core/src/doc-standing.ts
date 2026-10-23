/**
 * Document standing — which document kinds are `living` (edited in place) and which are
 * `record` (locked once settled, replaced rather than rewritten), plus the pure resolver
 * that turns a document's facts into a lock verdict.
 *
 * Public surface: `DocStanding`, `StandingRule`, `DOC_TYPE_STANDING`,
 * `KNOWLEDGE_SUB_TYPE_STANDING`, `LockInput`, `LockReason`, `LockState`, `resolveLock`.
 * Invariants: both tables are exhaustive `Record`s (a new `DocType` / `KnowledgeSubType`
 * fails `tsc` until classified); `resolveLock` never defaults a missing required fact — it
 * throws naming the field. Data + pure resolution only: no user-facing prose (the refusal
 * text lives with the `record-edit` checkpoint in the service layer, spec D18).
 * Side effects: none (pure; browser-safe — no Node builtin imports).
 *
 * Sibling of `DOC_TYPE_ROLE_MAP` (types.ts) but a DIFFERENT question: that map says what
 * role a type plays; this one says whether its documents may be rewritten (spec D2).
 *
 * Spec: spec-documents-are-living-or-records-a-locked-record-is-never (D1, D2, D3, D17).
 * Baseline rules: BR-1046 (classification), BR-1047 (lock point).
 */

import type { DocStatus, DocType, KnowledgeSubType } from "./types.js";

/** Whether a document kind is edited in place (`living`) or locked once settled (`record`). */
export type DocStanding = "living" | "record";

/** How a doc type's standing is decided. */
export type StandingRule =
  | { kind: "fixed"; standing: DocStanding }
  | { kind: "by-sub-type" }
  | { kind: "by-plan-state" };

/**
 * Standing rule per doc type. Exhaustive: adding a `DocType` fails `tsc` here.
 * prd / baseline are living; spec / adr / task are records; knowledge follows its
 * sub-type; plan and phase are living while their plan is open (spec D3).
 */
export const DOC_TYPE_STANDING: Record<DocType, StandingRule> = {
  prd: { kind: "fixed", standing: "living" },
  baseline: { kind: "fixed", standing: "living" },
  spec: { kind: "fixed", standing: "record" },
  adr: { kind: "fixed", standing: "record" },
  task: { kind: "fixed", standing: "record" },
  knowledge: { kind: "by-sub-type" },
  plan: { kind: "by-plan-state" },
  phase: { kind: "by-plan-state" },
};

/**
 * Standing per knowledge sub-type. Exhaustive: adding a `KnowledgeSubType` fails `tsc`.
 * reference / skill / prompt are maintained in place; the rest document a moment.
 */
export const KNOWLEDGE_SUB_TYPE_STANDING: Record<KnowledgeSubType, DocStanding> = {
  reference: "living",
  skill: "living",
  prompt: "living",
  ideation: "record",
  retro: "record",
  research: "record",
  assessment: "record",
  "milestone-review": "record",
  handoff: "record",
  uat: "record",
};

/**
 * Facts `resolveLock` needs. Which optional fact is REQUIRED depends on `type`;
 * a missing required fact throws — it is never defaulted (a silent `false` would
 * leave a record unlocked).
 */
export interface LockInput {
  type: DocType;
  /** Current status of the document itself. */
  status: DocStatus;
  /** Required for knowledge. */
  subType?: KnowledgeSubType;
  /** Required for spec, adr and knowledge records: version history ever held `approved`. */
  everApproved?: boolean;
  /** Required for task: a claim was ever taken and not rolled back by its own failed write. */
  everClaimed?: boolean;
  /** Required for plan (its own status) and phase (its member plan's status). */
  planStatus?: DocStatus;
}

/** Why a record is locked. */
export type LockReason = "approved" | "claimed" | "closed";

/** Verdict of {@link resolveLock}. */
export type LockState =
  | { standing: "living" }
  | { standing: "record"; locked: false }
  | { standing: "record"; locked: true; reason: LockReason };

/** Plan statuses that close a plan (and with it, its phases). */
const CLOSED_PLAN_STATUSES: ReadonlySet<DocStatus> = new Set<DocStatus>(["archived", "deprecated"]);

function requireFact<T>(value: T | undefined, field: string, type: DocType): T {
  if (value === undefined) {
    throw new Error(`resolveLock: input.${field} is required for type "${type}" but was not supplied`);
  }
  return value;
}

/**
 * Resolve whether a document is a locked record.
 *
 * - spec | adr | knowledge record: locked `"approved"` iff `everApproved`
 * - task: locked `"claimed"` iff `everClaimed`
 * - plan | phase: living while `planStatus` is not archived/deprecated, else locked `"closed"`
 * - prd | baseline | knowledge reference/skill/prompt: always living
 *
 * @throws Error naming the field when a fact required for `input.type` is missing.
 */
export function resolveLock(input: LockInput): LockState {
  const rule = DOC_TYPE_STANDING[input.type];
  switch (rule.kind) {
    case "fixed":
      return rule.standing === "living"
        ? { standing: "living" }
        : resolveRecord(input);
    case "by-sub-type": {
      const subType = requireFact(input.subType, "subType", input.type);
      return KNOWLEDGE_SUB_TYPE_STANDING[subType] === "living"
        ? { standing: "living" }
        : resolveRecord(input);
    }
    case "by-plan-state": {
      const planStatus = requireFact(input.planStatus, "planStatus", input.type);
      return CLOSED_PLAN_STATUSES.has(planStatus)
        ? { standing: "record", locked: true, reason: "closed" }
        : { standing: "living" };
    }
    default: {
      const unreachable: never = rule;
      throw new Error(`resolveLock: unhandled standing rule ${JSON.stringify(unreachable)}`);
    }
  }
}

/** Lock verdict for a document already classified as a record (task, or settled-on-approval kinds). */
function resolveRecord(input: LockInput): LockState {
  if (input.type === "task") {
    return requireFact(input.everClaimed, "everClaimed", input.type)
      ? { standing: "record", locked: true, reason: "claimed" }
      : { standing: "record", locked: false };
  }
  return requireFact(input.everApproved, "everApproved", input.type)
    ? { standing: "record", locked: true, reason: "approved" }
    : { standing: "record", locked: false };
}
