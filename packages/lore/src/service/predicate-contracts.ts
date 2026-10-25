/**
 * `plan-close`'s predicate CONTRACT TABLE (spec-plan-close-predicates-measure-
 * invariants-an-applicability §D7) — every field `checkPlanClose`
 * (checkpoint-registry.ts) can emit gets a machine-readable record of what its
 * predicate EXISTS to protect (`invariant`), what it actually computes
 * (`measured`), and the deltas between the two that are ALREADY known facts
 * (`known_false_pass`/`known_false_block`). This module exists so an operator
 * blocked on correctly-executed work reads the delta instead of reaching for
 * an exemption — the alternative this spec removes: `deriveAttestationSummary`'s
 * own JSDoc already stated its ratio condition "can be satisfied while the
 * guarantee is violated", and that self-admitted delta ran as the invariant
 * across many plan closes because nothing downstream read the comment.
 *
 * Public surface: {@link PredicateContract}, {@link PlanCloseField},
 * {@link PREDICATE_CONTRACTS}, {@link renderPredicateContractsExplain} (the
 * `lore gate --explain <checkpoint>` render function, wired from
 * `adapters/cli/commands/gate.ts`).
 *
 * ⛔ SCOPE (§Scope's out-of-scope entry, deliberate): this table is exhaustive
 * over `plan-close` ONLY, BY CONSTRUCTION — {@link PlanCloseField} is a union
 * built directly from `checkPlanClose`'s own emitted-field constants
 * (gate-predicates.ts), so `Record<PlanCloseField, PredicateContract>` is a
 * TypeScript compile error the moment a member lacks an entry. Do NOT widen
 * this to the other six checkpoints — a partially-filled `Record` over all
 * seven would itself be a completeness proxy, exactly the defect class this
 * spec exists to remove. Other checkpoints join this mechanism when THEY are
 * next touched, each with its own exhaustive-by-construction field union.
 *
 * ⛔ An empty `known_false_pass`/`known_false_block` array means "no delta
 * recorded yet", NEVER "no delta exists" — do not treat an empty array as
 * proof a predicate is delta-free; it only means nobody has measured one.
 * Entries here are seeded from each predicate's OWN JSDoc
 * (packages/lore/src/service/gate-predicates.ts) and the task body that
 * commissioned this module — never invented.
 *
 * Side-effect class: pure. No store, no IO, no config access.
 */

import { PLAN_CLOSE_FIELD, MILESTONE_REVIEW_FIELD } from "./gate-predicates.js";

/**
 * One `plan-close` predicate's contract: the invariant it exists to protect,
 * the proxy it actually measures, and the known deltas between the two.
 */
export interface PredicateContract {
  /** What the predicate EXISTS to protect — plain-language, not the code. */
  readonly invariant: string;
  /** What it actually computes — the concrete proxy/inputs, naming the SSOT function it delegates to. */
  readonly measured: string;
  /** Cases where `measured` PASSES but `invariant` is VIOLATED. Empty = "none recorded", never "none exist". */
  readonly known_false_pass: readonly string[];
  /** Cases where `measured` FAILS but `invariant` HOLDS. Empty = "none recorded", never "none exist". */
  readonly known_false_block: readonly string[];
}

/**
 * The field constants `checkPlanClose` (checkpoint-registry.ts) can emit,
 * imported directly from their owning predicates (gate-predicates.ts) rather
 * than re-typed as string literals — a renamed constant's VALUE propagates
 * here automatically; only a genuinely NEW predicate/field requires a
 * deliberate edit to this array (and, structurally, to {@link PlanCloseField}
 * below and {@link PREDICATE_CONTRACTS}).
 */
export const PLAN_CLOSE_FIELDS = [PLAN_CLOSE_FIELD, MILESTONE_REVIEW_FIELD] as const;

/**
 * The union of `field` values `checkPlanClose` can emit — built FROM
 * {@link PLAN_CLOSE_FIELDS} (§D7). `Record<PlanCloseField, PredicateContract>`
 * below is therefore exhaustive BY CONSTRUCTION: omitting a contract for any
 * member fails `bun run typecheck`, never a runtime `undefined` lookup.
 */
export type PlanCloseField = (typeof PLAN_CLOSE_FIELDS)[number];

/**
 * The `plan-close` predicate contract table (§D7). See this module's header
 * for the exhaustiveness mechanism and the "empty ⇒ not-recorded" convention.
 * Every `invariant`/`measured` string is seeded from the named predicate's own
 * JSDoc in gate-predicates.ts; every `known_false_*` entry is a delta named
 * explicitly in the task body that commissioned this table (never invented).
 */
export const PREDICATE_CONTRACTS: Record<PlanCloseField, PredicateContract> = {
  [PLAN_CLOSE_FIELD]: {
    invariant:
      "A plan that has opted into UAT (extra.requires_uat) may close only when its " +
      "user-acceptance verdict actually shows P0 acceptance.",
    measured:
      "Two caller-precomputed booleans (uatP0Accepted): whether ANY UAT verdict is linked " +
      "to the plan (informs), and isP0Accepted of the LATEST linked verdict.",
    known_false_pass: [],
    known_false_block: [],
  },
  [MILESTONE_REVIEW_FIELD]: {
    invariant:
      "A plan closes only over a milestone review of the state it is actually in: the review's seven " +
      "dimensions (correctness against ACs, spec conformance, regression, design necessity, snapshot " +
      "accuracy, concurrency safety, security) each hold, and nothing about the plan changed since.",
    measured:
      "milestoneReviewCurrent over assessMilestoneCurrency: the latest knowledge/milestone-review doc " +
      "informs-linked to the plan, its stored fingerprint (plan id@version, every task id@version, the " +
      "main commit that last landed one of its tasks) compared with the fingerprint now, and its " +
      "dimensions checked for a `fail`. No review, a review of an older state, or a failing dimension refuses (BR-1372).",
    known_false_pass: [
      "the judge is a model: a dimension it marks pass can still be wrong, which is why every dimension carries " +
        "a reason and a reference a person can check, and a failing review never closes",
      "a diff that could not be derived (no recorded landing) leaves the code-facing dimensions judged from " +
        "documents and evidence only; the review records the diff source it had",
    ],
    known_false_block: [
      "any edit to the plan or one of its tasks after the review (even a cosmetic one that bumps a version) makes " +
        "the review stale; the recovery is to run `lore assess` again",
    ],
  },
};

/**
 * The `field` value of `record-edit`'s one predicate — the checkpoint id itself, because the gate has
 * exactly one conjunct and emits no `field` sub-discriminator (its refusal is `gate:record-edit`).
 */
export const RECORD_EDIT_FIELD = "record-edit" as const;

/**
 * The `record-edit` contract (spec-documents-are-living-or-records D4/D6/BR-1048). A SEPARATE table
 * from {@link PREDICATE_CONTRACTS} on purpose: that one is exhaustive over `checkPlanClose`'s field
 * union by construction and its test asserts the key set equals that union, so widening it would
 * break the very exhaustiveness the header above defends. Same record shape, same "empty means not
 * recorded" convention.
 */
export const RECORD_EDIT_CONTRACT: Record<typeof RECORD_EDIT_FIELD, PredicateContract> = {
  [RECORD_EDIT_FIELD]: {
    invariant:
      "A record that has been accepted (an approved spec/adr/knowledge record, a claimed task, a " +
      "closed plan and its phases) is never rewritten in place; a substantive change is a new " +
      "document that the old one points to, and a typo-level fix goes through the audited correction.",
    measured:
      "RecordLockService.assertEditable resolves resolveLock (@lore/core doc-standing) over facts it " +
      "gathers: ever-approved from version history, ever-claimed from audit `claim` rows minus claims " +
      "rolled back by their own failed write, and the member plan's status. It is consulted only when " +
      "the write would change body/title (compared to the stored values), extra.sub_type, criteria, " +
      "phase structure, or restores a version.",
    known_false_pass: [
      "metadata-only writes (tags, priority, slug, links, anchors, claims, evidence) pass by design, " +
        "so a locked record can still change meaning through its links",
      "a phase edit can pass while its plan is being archived on another doc (accepted residual, " +
        "spec §Concurrency)",
    ],
    known_false_block: [
      "a rewrite that only reformats or fixes a typo is refused unless the caller passes --correction " +
        "with a reason",
    ],
  },
};

/**
 * Renders `lore gate --explain <checkpoint>`'s output (§D7) — per predicate:
 * field, invariant, measured proxy, and both known-delta lists. Pure string
 * builder; the CLI wiring (`adapters/cli/commands/gate.ts`) writes the result
 * to stdout.
 *
 * Checkpoint-scoped by design (§Scope): {@link PREDICATE_CONTRACTS} is
 * exhaustive over `plan-close` ONLY today. Any other checkpoint name renders a
 * one-line "not recorded" notice rather than an empty or misleading table —
 * this function never widens `PREDICATE_CONTRACTS` itself, and never throws
 * on an unrecognized checkpoint name.
 *
 * @param checkpoint - The checkpoint name to explain (e.g. `"plan-close"`).
 * @returns Multi-line, human-readable text — never JSON (this is an
 *   operator-facing explanation, not a machine-consumed payload).
 * @example
 * renderPredicateContractsExplain("plan-close");
 *   // => "Predicate contract table — plan-close:\n\nfield: uat\n..." (both fields)
 * @example
 * renderPredicateContractsExplain("spec-create");
 *   // => "No predicate contract table is recorded for checkpoint \"spec-create\" yet — ..."
 */
export function renderPredicateContractsExplain(checkpoint: string): string {
  const entries: ReadonlyArray<readonly [string, PredicateContract]> | undefined =
    checkpoint === "plan-close"
      ? PLAN_CLOSE_FIELDS.map((field) => [field, PREDICATE_CONTRACTS[field]] as const)
      : checkpoint === "record-edit"
        ? [[RECORD_EDIT_FIELD, RECORD_EDIT_CONTRACT[RECORD_EDIT_FIELD]] as const]
        : undefined;
  if (entries === undefined) {
    return (
      `No predicate contract table is recorded for checkpoint "${checkpoint}" yet — ` +
      `contract tables exist for "plan-close" and "record-edit" only ` +
      `(spec-plan-close-predicates-measure-invariants-an-applicability §Scope). Empty here ` +
      `means "not built yet", never "this checkpoint has no predicates worth explaining".`
    );
  }
  const lines: string[] = [`Predicate contract table — ${checkpoint}:`];
  for (const [field, contract] of entries) {
    lines.push("");
    lines.push(`field: ${field}`);
    lines.push(`invariant: ${contract.invariant}`);
    lines.push(`measured: ${contract.measured}`);
    lines.push(
      `known_false_pass: ${
        contract.known_false_pass.length > 0 ? contract.known_false_pass.join(" | ") : "(none recorded)"
      }`,
    );
    lines.push(
      `known_false_block: ${
        contract.known_false_block.length > 0 ? contract.known_false_block.join(" | ") : "(none recorded)"
      }`,
    );
  }
  return lines.join("\n");
}
