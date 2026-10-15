---
id: KN-485
type: knowledge
role: knowledge
title: "AC coverage counts evidence by plan lineage and ignores ac_scope, and an oracle generation cannot see its own test file being rewritten"
status: archived
priority: high
created: 2026-08-21
updated: 2026-10-10
tags: []
parent: PRD-001
links:
  - {id: SPEC-139, type: relates-to}
  - {id: KN-475, type: relates-to}
  - {id: SPEC-101, type: relates-to}
---
Measured 2026-08-21 while dispositioning `knowledge-handoff-agent-main-orchestrator-109`
NS7 ("AC-TC-1 and AC-TC-2 carry 0 tagged records — attribution gap, not capability"). NS7's
framing was right and the mechanism underneath is worse than an attribution gap. Every figure
below names the query that produced it.

## F1 — an AC's coverage counts evidence by the recording task's PLAN LINEAGE, and silently ignores `ac_scope`

`lore ac list spec-two-runner-changed-test-selection-deterministic-test` prints
`⚑✔(2/0, 1 attested)` for `AC-TC-1`. The store holds, for `ac_ref = "AC-TC-1"`:

| recording task | its plan | plan's parent | rows | counted? |
|---|---|---|---|---|
| `task-t1-changed-tests-selector-script-package-script-claude-md` | `plan-implementation-test-changed-two-runner-selector` | the TC spec | 1 self pass + 1 ATTESTED pass | **YES** |
| `task-add-an-e2e-tsconfig-project-covering-all-27-test-tree` | `plan-close-two-typecheck-blind-spots-and-correct-the-stale` | a DIFFERENT spec | 1 self pass + 1 ATTESTED pass | **no** |
| `task-assert-the-e2e-typecheck-project-s-live-wiring-record-the` | same as above | a DIFFERENT spec | 2 self `expected-fail` + 1 self pass + 1 ATTESTED pass | **no** |

`2/0, 1 attested` is exactly the first row. So four `pass` rows, two of them ATTESTED, are
excluded.

⛔ The inversion is what makes this a defect rather than a scoping choice:

- The two EXCLUDED tasks each declare `extra.ac_scope = ["AC-TC-1","AC-TC-2","AC-TC-3"]` —
  they explicitly claim the criterion.
- The one INCLUDED task declares **no `ac_scope` at all** (the field is null).

So the flag whose own `--help` says it is "consumed by `lore verify`'s declared-scope
intersection" does not make evidence count, and its absence does not stop evidence counting.
Plan lineage decides, and an agent reading the flag documentation would conclude the opposite.

⛔ And nothing says so. `lore ac list` prints one number with no indication that a filter ran.
This is the North Star's second property failing on the AC surface: *filtering must leave a
trace in the count*. A reader cannot distinguish "two runs happened" from "six runs happened
and four were scoped out", and the two demand opposite actions.

Reproduce:

    sqlite3 -separator ' | ' .lore/lore.db "SELECT json_extract(e.value,'\$.ac_ref'), json_extract(e.value,'\$.result'), CASE WHEN json_extract(e.value,'\$.attestation') IS NULL THEN 'self' ELSE 'ATT' END, d.slug, json_extract(d.extra,'\$.plan_id') FROM docs d, json_each(json_extract(d.extra,'\$.verification_evidence')) e WHERE json_extract(e.value,'\$.ac_ref')='AC-TC-1' ORDER BY json_extract(e.value,'\$.recorded_at');"
    lore ac list spec-two-runner-changed-test-selection-deterministic-test | grep AC-TC-1

## F2 — `oracle_generation` equates "the oracle" with the COMMAND STRING, so a stable command over a rewritten target file never bumps

`AcService.setCriterion`'s own invariant, verbatim from `packages/lore/src/service/ac-service.ts:24`:
*"bumps the criterion's `oracle_generation` EXACTLY WHEN the resulting script-mode
`verify.command` differs from the stored one"*, and at line 1061: *"An acceptance criterion's
ORACLE is its script-mode `verify.command`."* The bump is `resolveOracleGeneration(...) + 1`
(line 1098), reached only on a command difference.

`AC-TC-1`'s command has never changed. Its ONE counted attested row, recorded
2026-07-28T05:36:33Z, carries the tail `Test Files 1 passed (1) / Tests 22 passed (22)`.
Measured today, the same command against the same path:

    bunx vitest run packages/lore/tests/unit/scripts/changed-tests-selector.test.ts
    → Test Files 1 passed (1) / Tests 63 passed (63), exit 0

`git log --since=2026-07-28 -- packages/lore/tests/unit/scripts/changed-tests-selector.test.ts`
returns **7 commits**, including `9c8f91a8` (added selection rule (d)) and `e26122c1` (made
tree-scan scopes additive instead of pre-emptive — a behaviour change to the very logic under
test).

⇒ The criterion's evidence history spans two materially different oracles — 22 cases versus 63,
with rule changes in between — which is the exact condition M5 of
`spec-the-defect-channel-cannot-be-honestly-maintained-an` exists to make visible. The
generation mechanism cannot see it, because the string it watches did not move. The AC reads
green on a measurement of a body of assertions that no longer exists.

⛔ This is NOT the backfill gap, and must not be dismissed as one. The mechanism IS live: 173
of 4430 evidence rows carry `ac_oracle_generation` and 18 of 866 criteria carry
`oracle_generation`, so it stamps from its arming date forward as designed. Even fully armed
and fully backfilled, `AC-TC-1` would still read generation 1 forever, because the command is
stable. The blind spot is in the DEFINITION of an oracle, not in coverage of the rollout.

⇒ A candidate signal that a content-addressed check could observe: the content hash (or last
commit touching) each path the declared command names, stamped alongside the generation at
record time. ⛔ Not proposed as the design — proposed as the thing to MEASURE before designing,
because pinning an AC to a field that does not exist yet is its own recorded failure mode.

## Why both of these were found by accident, again

Neither was reachable from a green run. F1 surfaced only because a printed count (2) was
compared against the store (6) by hand; F2 only because an evidence tail happened to quote a
test count that no longer matched. Both are instances of the standing pattern that a governance
surface reporting a confident, specific, wrong number has no second source an agent can catch
it with.

## Where these are filed, and why that is itself the problem

⛔ Neither is in the defect channel. `lore issues --all`, measured 2026-08-21: the 10 reports
filed by this project are all `open`, all `draft`, and the cap refuses every new one. Two of the
ten were re-probed for staleness on 2026-08-20 rather than assumed stale, and both were still
valid, so no honest closure is available to free a slot. So these land in a knowledge doc that
no `--check` reads — the same degradation `knowledge-four-governance-gaps-measured-while-resuming-handoff`
§4 records for gaps 5 through 8.

`plan-land-m7-an-adopted-state-that-frees-defect-channel-quota` exists to end that. When M7
lands, FILE BOTH of these, and the four gaps that doc is holding.
