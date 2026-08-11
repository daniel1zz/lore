---
id: TASK-474
type: task
role: plan
title: "archive-sweep gate-disable is silently inert — a wholesale config overwrite drops the required project block"
status: archived
priority: high
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Task

`archive-sweep-cli.bun.test.ts`'s `disablePlanCloseGate()` helper does not disable
the gate. The suite has been running with `plan-close` **fully armed** while
reading as though it were disabled — a false oracle, not a flaky one.

## Verified cause (every link measured at source on main, 2026-07-31)

1. `packages/lore/tests/integration/archive-sweep-cli.bun.test.ts:~64-72` —
   `disablePlanCloseGate()` **overwrites** `.lore/config.yaml` with only
   `workflow.gates."plan-close".enabled: false`. It is a `writeFileSync`, not a
   merge, so everything `lore init` wrote is discarded.
2. `packages/core/src/config.ts:771-776` — `project: z.object({name, author}).strict()`
   carries **no `.optional()`** (contrast `sync` on the very next line). A config
   without a `project:` block therefore FAILS validation.
3. `packages/lore/src/adapters/cli/loader.ts:229-233` — every config parse failure
   other than an invalid `ai` block keeps the **historical silent fallback**:
   `rawConfig = undefined`, with a comment marking it a documented SPEC-030
   non-goal. No warning, no non-zero exit.

Net effect: the gate-disable stanza is never read, `rawConfig` is `undefined`, and
the gate stays armed. The original reporter measured the behavioural half directly
— a claim blocked with the overwritten config in place, succeeding once the
`project:` block was appended.

## Blast radius — this is a CLASS, not one test

Any test that writes `.lore/config.yaml` wholesale is affected. Audit at minimum:
- `packages/lore/tests/integration/gate-config-disable.bun.test.ts` — a suite whose
  entire subject is disabling gates by config; if it overwrites the same way, it is
  asserting the opposite of what it believes.
- Every other test constructing a config file rather than patching one.

## What to do

1. Fix the helper to **append/merge** rather than overwrite (or write a complete
   valid config including `project:`), and add a live CONTROL asserting the gate is
   genuinely off — e.g. an operation that the armed gate would refuse must now
   succeed. Without that control the fix is unverifiable and can silently rot again.
2. Sweep the class above and fix every instance found.
3. Consider the mechanism root: a config that fails validation resolving to
   `undefined` in silence is what made this invisible. `loader.ts:229-233` marks it
   a deliberate SPEC-030 non-goal, so changing it is a SEPARATE decision with its
   own blast radius — do NOT change it as a side effect of this task. If the audit
   shows the silent fallback causing more than this one class of defect, report that
   as its own finding rather than widening scope here.

## Oracle

Failure-first: assert the CURRENT state is broken before fixing it — with the
overwritten config in place, the plan-close gate must be observably armed. Then fix
and show it observably off. A green run that was never red proves nothing here,
because "gate armed" and "gate disabled" produce the same green today for every
assertion the suite currently makes.
