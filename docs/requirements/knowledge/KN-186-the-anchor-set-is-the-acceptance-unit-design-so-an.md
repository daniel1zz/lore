---
id: KN-186
type: knowledge
role: knowledge
title: "The anchor set IS the acceptance-unit design, so an omitted call site is an orchestrator defect no implementer can fix — three measured instances in one plan"
status: approved
priority: high
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PRD-001
---
# The anchor set IS the acceptance-unit design, so an omitted call site is an orchestrator defect that no implementer can fix

Measured across one session (2026-08-07) that dispatched six implementers on
`plan-land-oracle-tier-falsifiability-falsified-coverage`. THREE of them returned
`DONE_WITH_CONCERNS`, and all three concerns had the same root: **the anchor set I authored
omitted something the work structurally required.** Every implementer behaved correctly —
each flagged the gap rather than leaving its anchors or silently skipping. The defect was
never in the execution layer.

Root `CLAUDE.md` already carries the rule ("capability implementation is not production
wiring; the two MUST be one acceptance unit") with four prior measured instances. This doc
records what the rule looks like from the ORCHESTRATOR side, because that is where it is
violated, and adds the ripple half the existing rule does not cover.

## Instance 1 — the capability shipped DORMANT

`findPipeRefusal` was authored in `evidence-precheck.ts` with 13 tests, all green, merged.
`lore evidence` still accepted a piped self-report, because **neither call site
(`commands/evidence.ts`, `mcp/tools.ts`) was in the task's anchors.** Its bound criterion
asserted the pure decision function, so it went green with the defect fully intact.

The tell was visible at authoring time and I missed it: the AC's own wording said *"`lore
evidence` … exits 4"* while the anchor set contained no file that could produce an exit code.
⛔ **An AC that names a user-facing verb must have that verb's entry point in the anchors, or
its oracle will necessarily measure a proxy.**

Cost: one extra task, one extra dispatch, and three now-false "NOT YET WIRED" comments the
truthful first implementer had correctly written (a fixed gap turns its own honest record into
a stale assertion — the same-acceptance-unit rule again, one layer up).

## Instance 2 — the same omission, silently, for a script

The unclaimed-oracle check shipped as `scripts/check-unclaimed-oracle.ts` with a passing
criterion. Nothing invoked it. `lore status` gained the call only because a later audit asked
"which of these three mechanisms has an AC asserting a LIVE production call?" — the answer was
one of three.

⛔ That question is the cheap mechanical check. Run it over the whole AC set BEFORE dispatch:
for each mechanism, point at the criterion whose oracle exercises a real invocation. A
mechanism with no such criterion is not scheduled to become live.

## Instance 3 — a REQUIRED field is never a local change

M1 added `falsified` as a required field on the widely-shared `AcCoverageFact` and a new value
to the shared precedence derivation. Anchors: two files. Actual consumer closure: **12 files**,
plus one production type (`flows/task-feed-flow.ts`'s `AcceptanceView.coverage` union) and one
dashboard component that NO task in the plan anchored.

Merging M1 alone would have put `main` at `bun run typecheck` **exit 2**. I found this only
because the implementer refused to leave its anchors and enumerated the ripple in its report.

⛔ The deterministic planning-time probe, which costs one command and would have sized the
anchor set correctly up front:

    git branch integration-probe && git switch integration-probe
    # apply (or merge) the type change alone
    bun run typecheck        # every file it names belongs in the anchor set

⛔ Do NOT run this only at merge time — by then the anchors are already wrong and the fix costs
an extra task plus an integration branch. And ⛔ note typecheck stops at its FIRST failing
workspace sub-step, so one pass under-reports: the closure surfaces incrementally as each is
cleared. Budget for iterating it, or read the implementer's enumeration as authoritative.

⛔ Do NOT absorb a ripple by weakening the new field to optional. That trades a 12-file
mechanical fix for a permanent absent-vs-zero ambiguity in a production type — the exact
condition `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`'s Silence question
forbids. Test-fixture convenience is not a reason to make a production type lie.

## The transferable rule

**The anchor set is simultaneously a permission boundary and an acceptance-unit declaration,
and the implementer can only ever honour the first.** So three questions belong to whoever
writes the anchors, before dispatch:

1. **Call site** — for every new function/field/flag/column, which existing file must change
   for it to be REACHED in production? That file is in the anchor set, or the capability ships
   dormant.
2. **Live oracle** — does at least one bound criterion exercise a real invocation (a spawned
   process, a real command, a rendered surface)? ⛔ A grep or source scan proving the call
   exists is a proxy, not the property.
3. **Closure** — if this changes a shared TYPE, what is the consumer closure? Probe it with
   typecheck on a throwaway branch and anchor what it names.

⛔ When an implementer returns "implemented and tested, but not wired / but N files outside my
anchors also need changing", that is the anchor design failing, reported correctly. Attributing
it to the implementer — or worse, letting it merge because the ACs are green — is how a
mechanism ships inert while its criteria certify it.

## Corroboration from the plan's own assessment

`lore assess` (verdict met, 85/100) independently reached the same finding from the evidence
side and recommended exactly this doc:

> AC-FALS-7 says the command 'exits 4' and 'exits 0', but its oracle calls `findPipeRefusal`
> directly … The property is genuinely covered by AC-FALS-9's live-process oracle, so this is a
> wording/oracle mismatch rather than a coverage hole.

and

> Capture a knowledge doc on capability-vs-wiring anchoring: anchor the production call site in
> the same acceptance unit as the capability, and bind the oracle to a live process rather than
> a source scan.
