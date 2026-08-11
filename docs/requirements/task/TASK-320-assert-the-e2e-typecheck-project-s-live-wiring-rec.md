---
id: TASK-320
type: task
role: plan
title: "Assert the e2e typecheck project's LIVE wiring, record the missing reds, and reconcile the backup-durability comment with the code"
status: archived
priority: medium
phase: "coverage"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-077
plan: PLAN-077
---
Three gaps `lore assess` found in the merged phase-coverage work (see
`knowledge-assessment-close-two-typecheck-blind-spots-and`). ⛔ All three are AC/oracle DESIGN
defects, not implementer failures — do not treat them as rework of someone's mistake.

**1 (major, AC-TC-1) — the wiring is unasserted.** The prior oracle interrogated
`tsconfig.e2e.json` directly, so it was blind to whether `typecheck:dashboard-e2e` is in root
`package.json`'s chain. Deleting the script leaves the old oracle green. Write
`scripts/tests/typecheck-chain-contract.test.ts` with an `e2e-project-wired` case asserting BOTH
chain membership AND the ≥27 resolved-file floor.
⛔ Record BOTH reds separately: (a) remove the script from the chain → must fail; (b) point the
project's `include` at a zero-e2e-file directory → must fail. A single green run is not verification.

**2 (minor, AC-TC-1/AC-TC-2) — greens with no demonstrated failure mode.** Neither AC ever had an
`expected-fail` row. `tsconfig.tests.json`'s own history is the cautionary case: its exit 0 was the
exit code of checking NOTHING. Record a real `--result expected-fail` for the AC-TC-2 comment
assertion too (re-insert the stale phrase, observe the red, restore).

**3 (minor, AC-TC-3) — a comment asserts a durability the code does not deliver.** In
`scripts/tests/typecheck-script-contract.test.ts` the mkdtemp/rename backup is never READ BACK:
restoration writes the in-memory `originalBytes` and then `rmSync`s the backup dir, so the header's
claim that the aside-move "survives even a crash mid-test" is false. Also `result` is assigned and
unused after the try block.
⛔ SAME UNIT: either make restoration actually read the on-disk backup (delivering the claim), or
correct the comment to state what the code really guarantees. Do not leave the two disagreeing.

⛔ This task's own oracle must not repeat defect 1: assert the LIVE wiring, never merely that a
symbol or file exists.
