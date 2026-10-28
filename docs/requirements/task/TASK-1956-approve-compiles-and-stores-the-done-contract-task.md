---
id: TASK-1956
type: task
role: plan
title: "Approve compiles and stores the done-contract; tasks carry a kind (AC-DCT-1..3)"
status: deprecated
priority: high
phase: "P2 Contract, kinds and implementer verbs"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1941, type: blocks}
---
Covers: AC-DCT-1, AC-DCT-2, AC-DCT-3, AC-DCT-15
TDD-Role: green
Approach: new done-contract-service.ts exports compileDoneContract(task, plan, spec, reader): Result<DoneContract, DoneContractRefusal>. It reuses the existing exported predicates in task-workflow-service.ts (definitionOfDone, findMissingUnfilteredTestFileRuns) by import; it does not copy them. ReviewService.approve calls it for doc.type task after the existing transition and override checks and before the write, so a refusal writes nothing; the contract is stored in extra.done_contract through a dedicated writer (key added to DEDICATED_EXTRA_KEYS so lore set cannot write it). lore create task gains --kind code|check|corpus (default code), stored as extra.kind; lore approve gains --no-red <reason> (AC-DCT-15), which commands/approve.ts passes through. app.ts constructs the service and passes it to ReviewService (capability and wiring in one task). Refusal collects every cause before returning (done-contract-uncompilable).
Done when: AC-DCT-1, 2, 3 and 15 commands pass; lore verify attests each; typecheck passes; the anchored files contain no second copy of a done predicate.
