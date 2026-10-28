/**
 * Test fixture: the complete decision an agent's write to a non-draft target carries as CLI flags (BR-1476).
 *
 * Purpose: a suite that is about something else (a demotion notice, a pending revision, a census) but whose fixture or
 * assertion performs an agent write the decision gate now covers appends these flags instead of re-typing a decision.
 * Public surface: {@link DECIDED_FLAGS}.
 * Invariants: a reason, one premise of tier A on an `issue:` source (no git is asked), one rejected alternative; no gates.
 * Side-effect class: pure.
 */

/** reason, premise (tier A, issue source) and alternative: what a gated write is refused without. */
export const DECIDED_FLAGS: readonly string[] = [
  "--reason", "the suite performs this write as a fixture",
  "--premise", "the suite needs the write|issue:#1|A",
  "--alt", "skip the write|the suite would assert nothing",
];

/** The same decision as a service-call draft (`opts.decision` of `RuleService.setRule|addRule`, `AcService` verbs, ...). */
export const DECIDED_DRAFT = {
  reason: "the suite performs this write as a fixture",
  premises: [{ claim: "the suite needs the write", tier: "A", source: { kind: "issue", number: 1 } }],
  alternatives: [{ option: "skip the write", why_rejected: "the suite would assert nothing" }],
} as const;

/** {@link DECIDED_FLAGS} plus the judged gate a `rule set --statement` must state (BR-1477). */
export const DECIDED_STATEMENT_FLAGS: readonly string[] = [
  ...DECIDED_FLAGS,
  "--gate", "meaning-unchanged|pass|the suite rewords the rule without changing what it means",
];

/** premise and alternative only: for a verb whose own `--reason` is the decision's reason (`ac supersede`, `ac exempt`). */
export const DECIDED_FLAGS_OWN_REASON: readonly string[] = [
  "--premise", "the suite needs the write|issue:#1|A",
  "--alt", "skip the write|the suite would assert nothing",
];
