---
id: PLAN-227
type: plan
role: plan
title: "Defect clusters round 2 part B"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: SPEC-215
phases:
  - {name: "wave-1"}
  - {name: "wave-2"}
  - {name: "wave-3"}
  - {name: "wave-6"}
  - {name: "wave-7"}
---
## Goal
Implement spec-defect-clusters-round-2-part-b-review-pending-queue-corpus (defect clusters round 2, part B): one task per group, each making its AC green and closing its bound reports when archived.

## Invariants
- One task per Dn group; anchors are files, never directories; a file shared by two tasks is serialized by a blocks link.
- Red-first runs are runner-produced (`--capture` or `lore verify`); passes recorded with `--capture`. A corpus-data task (D17) proves red by running its check script against a deliberately broken criterion command, as its AC states.
- Tests use throwaway repos/corpora only (HOME and XDG_CONFIG_HOME in temp dirs); never the repo .lore/; never assume port 8787.
- An edit outside a task's anchors is declared before it is made (`lore anchor add`, overlap-checked).
- Before integrate: `check:floor` green and baseline coverage previewed; the main agent maps new coverage pairs.

## Tasks (wave, AC, reports, anchors, blocked by)
| Task | Group | Wave | AC | Reports | Anchors | Blocked by |
|---|---|---|---|---|---|---|
| task-skill-fix-dc2-9-the-judge-sees-the-whole-document-under | D9 review-judge-input | 3 | AC-DC2-9 | #34, #114 | packages/lore/src/ai/review-template.ts; packages/lore/src/service/checkpoint-registry.ts; packages/lore/src/service/review-service.ts; packages/lore/src/service/ai-provider-service.ts; packages/lore/tests/integration/dc2-review-judge-input.bun.test.ts | D10, D13, D15 |
| task-skill-fix-dc2-10-review-command-output-states-what-happened | D10 review-cli-output | 2 | AC-DC2-10 | #67, #71, #82 | packages/lore/src/adapters/cli/commands/reject.ts; packages/lore/src/service/review-service.ts; packages/lore/src/adapters/cli/review-render.ts; packages/lore/src/adapters/cli/commands/review.ts; packages/lore/tests/integration/dc2-review-cli-output.bun.test.ts | D11 |
| task-skill-fix-dc2-11-the-review-queue-includes-in-review | D11 pending-queue | 1 | AC-DC2-11 | #68, #93, #69 | packages/lore/src/service/pending-queue.ts; packages/lore/src/service/review-service.ts; packages/lore/src/adapters/cli/commands/pending.ts; packages/lore/tests/integration/dc2-pending-queue.bun.test.ts | — |
| task-skill-fix-dc2-12-the-claim-scoped-corpus-guard-is-armed-in | D12 corpus-scope-guard | 7 | AC-DC2-12 | #57, #63, #72 | packages/lore/src/app.ts; packages/lore/src/adapters/cli/loader.ts; packages/lore/src/service/foreign-corpus-write-guard.ts; packages/lore/src/service/ac-service.ts; packages/lore/src/service/rule-service.ts; packages/lore/src/service/corpus-service.ts; packages/lore/tests/integration/dc2-corpus-scope-guard.bun.test.ts | D16, D18 (part C), D22 (part C) |
| task-skill-fix-dc2-13-a-citation-can-be-repaired-without | D13 ac-cite-gate | 1 | AC-DC2-13 | #135, #141 | packages/lore/src/service/gate-predicates.ts; packages/lore/src/service/ac-cite-gate.ts; packages/lore/src/service/ac-write-chokepoint.ts; packages/lore/src/service/checkpoint-registry.ts; packages/lore/tests/integration/dc2-ac-cite-gate.bun.test.ts | — |
| task-skill-fix-dc2-14-a-criterion-detail-that-belongs-to | D14 ac-falsifier-refusal | 1 | AC-DC2-14 | #29 | packages/lore/src/adapters/cli/commands/ac.ts; packages/core/src/acceptance.ts; packages/lore/tests/integration/dc2-ac-falsifier-refusal.bun.test.ts | — |
| task-skill-fix-dc2-15-a-single-criterion-can-be-superseded-by | D15 ac-supersede | 2 | AC-DC2-15 | #154 | packages/core/src/acceptance.ts; packages/lore/src/service/ac-service.ts; packages/lore/src/service/verify-runner-service.ts; packages/lore/src/adapters/cli/commands/ac.ts; packages/lore/tests/integration/dc2-ac-supersede.bun.test.ts | D14 |
| task-skill-fix-dc2-16-every-ac-scope-id-must-be-a-criterion-the | D16 ac-scope-check | 6 | AC-DC2-16 | #225 | packages/lore/src/service/corpus-service.ts; packages/lore/src/service/task-workflow-service.ts; packages/lore/src/service/phase-workflow-service.ts; packages/lore/src/service/gate-predicates.ts; packages/lore/tests/integration/dc2-ac-scope-check.bun.test.ts | D13, D20 (part C) |

## Shared files and their serialization
- `packages/core/src/acceptance.ts`: D14, D15 (serialized by blocks links)
- `packages/lore/src/adapters/cli/commands/ac.ts`: D14, D15, D18, D23 (serialized by blocks links)
- `packages/lore/src/adapters/cli/loader.ts`: D12, D22 (serialized by blocks links)
- `packages/lore/src/app.ts`: D2, D12, D22 (serialized by blocks links)
- `packages/lore/src/service/ac-service.ts`: D12, D15, D18 (serialized by blocks links)
- `packages/lore/src/service/checkpoint-registry.ts`: D9, D13 (serialized by blocks links)
- `packages/lore/src/service/corpus-service.ts`: D6, D7, D8, D12, D16, D20, D25 (serialized by blocks links)
- `packages/lore/src/service/gate-predicates.ts`: D13, D16 (serialized by blocks links)
- `packages/lore/src/service/review-service.ts`: D9, D10, D11 (serialized by blocks links)
- `packages/lore/src/service/rule-service.ts`: D12, D18 (serialized by blocks links)

## Cross-part dependencies
- D12 waits for D18 (part C), encoded as a blocks link.
- D12 waits for D22 (part C), encoded as a blocks link.
- D16 waits for D20 (part C), encoded as a blocks link.

## Rule changes
- D15 adds a per-criterion supersession rule to baseline-declare-an-acceptance-criterion after landing; D9 may supersede AC-DN5-1 through D15 if the review prompt moves to v6.

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| a shared file edited by two concurrent tasks | M | blocks links above; edit-time anchor gate |
| a fix changes an established rule | M | the change set named under Rule changes |
| a later wave starts before its cross-part blocker lands | M | blocks links are checked by lore ready |
