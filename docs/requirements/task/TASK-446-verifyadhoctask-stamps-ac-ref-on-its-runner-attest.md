---
id: TASK-446
type: task
role: plan
title: "verifyAdhocTask stamps ac_ref on its runner-attested evidence: retire the last shape difference between the ad-hoc and plan-owned verify channels"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
Follow-up explicitly named and deferred by `task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref`
(archived 2026-08-01) and carried forward as NS3 of `knowledge-handoff-agent-main-orchestrator-56`.

## What is true today

`VerifyRunnerService.verifyAdhocTask` passes `recordAcRef: false` into the shared
`_runVerification` tail, so an ad-hoc task's runner-attested evidence is written WITHOUT `ac_ref`
— while a plan-owned task's evidence from the very same tail carries it.

That flag used to encode a structural impossibility: `TaskWorkflowService.appendEvidenceEntry`
cross-validated any supplied `ac_ref` by walking `resolveDeclaredAcIds(task.parent_id)`, which
hard-requires a `type: "plan"` parent — and an ad-hoc task's parent is the corpus root PRD, so the
write was refused one layer deeper with `Expected a plan document; got type 'prd'`.

The predecessor task removed that impossibility: `appendEvidenceEntry` now BRANCHES on
`task.extra.adhoc` and resolves an ad-hoc task's declared AC ids through the injected
`resolveAdhocGoverningAcIds` port (`CorpusService.resolveDeclaredAcIdsForAdhocTask`, which runs the
SAME `resolveGoverningSpecByAcScope` search `verifyAdhocTask` itself runs). Supplying `ac_ref` from
this path would now succeed.

`recordAcRef: false` therefore survives only as a DELIBERATE, separately-scoped deferral: flipping
it changes this class's own recorded-evidence shape and invalidates its own suite's
`ac_ref intentionally omitted` assertions — outside the predecessor task's declared anchors.

## Required

1. `verifyAdhocTask` passes `recordAcRef: true`, so the ad-hoc channel's attested evidence is
   shape-identical to the plan-owned channel's — the LAST remaining difference between them goes
   away.
2. Update the two JSDoc blocks that currently document the omission as deliberate
   (`_runVerification`'s `@param recordAcRef`, and `verifyAdhocTask`'s own header) so they describe
   what the code now does. Keep the HISTORICAL explanation of WHY the flag existed — it is the only
   record of the parent_id/PRD structural fault — but stop asserting a deferral that has landed.
3. Update the suite assertions that pin the omission:
   `packages/lore/tests/unit/service/verify-runner-service.test.ts:888`
   (`expect(recorder.calls[0]?.entry.ac_ref).toBeUndefined()`), its case title at :856, and the
   file-header JSDoc at :15.
4. ⛔ Do NOT touch `packages/lore/tests/integration/cli/task-workflow.test.ts:438` — that
   `ac_ref` `toBeUndefined` assertion is about a `lore evidence` call that supplies no `--ac`, an
   unrelated invariant. Verify this claim before relying on it.

## Declared ACs

- **AC-069-15** — the flip itself, cross-validated through the ad-hoc port.
- **AC-069-16** — no new bypass: an undeclared criterion id is still refused, and the plan-owned
  `verifyPlan` path stays regression-identical in the `ac_ref` it stamps.

Both are script-bound to `-t "AC-069-15"` / `-t "AC-069-16"` filters on
`verify-runner-service.test.ts`. ⛔ A `-t` filter that matches nothing EXITS 0 with every test
reported `skipped` — the case titles you write MUST contain those literal ids, and you MUST read
the matched count (`Tests N passed (N)`, N > 0), never the exit code alone.

## Six-dimension coverage

The two ACs are the contract, not the test plan. The suite still owes HAPPY / NEGATIVE / BOUNDARY /
ERROR / STATE / REGRESSION for the changed behaviour — in particular the REGRESSION direction
(plan-owned path unchanged) and the STATE direction (the recorded entry's full shape, not just the
one new field).

## Oracle

`bunx vitest run packages/lore/tests/unit/service/verify-runner-service.test.ts` passes as a whole
file (not only under the two `-t` filters), plus `bun run typecheck`.
