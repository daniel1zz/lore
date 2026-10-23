---
id: PLAN-225
type: plan
role: plan
title: "Defect clusters round 2 part D"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: SPEC-217
phases:
  - {name: "wave-1"}
  - {name: "wave-4"}
---
## Goal
Implement spec-defect-clusters-round-2-part-d-store-selection-runs (defect clusters round 2, part D): one task per group, each making its AC green and closing its bound reports when archived.

## Invariants
- One task per Dn group; anchors are files, never directories; a file shared by two tasks is serialized by a blocks link.
- Red-first runs are runner-produced (`--capture` or `lore verify`); passes recorded with `--capture`. A corpus-data task (D17) proves red by running its check script against a deliberately broken criterion command, as its AC states.
- Tests use throwaway repos/corpora only (HOME and XDG_CONFIG_HOME in temp dirs); never the repo .lore/; never assume port 8787.
- An edit outside a task's anchors is declared before it is made (`lore anchor add`, overlap-checked).
- Before integrate: `check:floor` green and baseline coverage previewed; the main agent maps new coverage pairs.

## Tasks (wave, AC, reports, anchors, blocked by)
| Task | Group | Wave | AC | Reports | Anchors | Blocked by |
|---|---|---|---|---|---|---|
| task-skill-fix-dc2-23-every-cli-read-goes-through-the-app-s | D23 cli-store-reuse | 4 | AC-DC2-23 | #152 | scripts/check-store-construction.ts; package.json; packages/lore/src/adapters/cli/commands/get.ts; packages/lore/src/adapters/cli/commands/log.ts; packages/lore/src/adapters/cli/commands/status.ts; packages/lore/src/adapters/cli/commands/gate.ts; packages/lore/src/adapters/cli/commands/ac.ts; packages/lore/src/adapters/cli/commands/baseline.ts; packages/lore/src/adapters/cli/commands/baseline-adopt.ts; packages/lore/src/adapters/cli/commands/calibration.ts; packages/lore/src/adapters/cli/commands/stash.ts; packages/lore/src/adapters/cli/commands/autonomy.ts; packages/lore/src/adapters/cli/status-autonomy-thresholds.ts; packages/lore/src/adapters/cli/status-decision-log.ts; packages/lore/src/adapters/cli/pending-decisions-render.ts; packages/lore/src/adapters/cli/decide-flow.ts; packages/lore/tests/integration/dc2-cli-store-reuse.bun.test.ts | D5 (part A), D18 (part C), D19 (part C), D22 (part C) |
| task-skill-fix-dc2-24-a-run-records-what-it-was-given-and-only | D24 run-registry | 1 | AC-DC2-24 | #167, #230 | packages/lore/src/service/run-service.ts; packages/lore/src/adapters/cli/commands/run.ts; packages/lore/tests/integration/dc2-run-registry.bun.test.ts | — |
| task-skill-fix-dc2-25-a-malformed-requirement-list-or-criteria | D25 requirements-parse | 4 | AC-DC2-25 | #111, #279 | packages/lore/src/service/requirement-service.ts; packages/lore/src/service/corpus-service.ts; packages/core/src/dedicated-extra-keys.ts; packages/lore/tests/integration/dc2-requirements-parse.bun.test.ts | D7 (part A), D8 (part A) |
| task-skill-fix-dc2-26-lore-context-says-what-it-did-and-never | D26 context-cmd | 1 | AC-DC2-26 | #90, #92, #266 | packages/lore/src/adapters/cli/commands/context.ts; packages/lore/src/flows/context-flow.ts; packages/lore/tests/integration/dc2-context-cmd.bun.test.ts | — |
| task-skill-fix-dc2-27-lore-fragments-check-covers-every-agent | D27 fragments-check-scope | 1 | AC-DC2-27 | #35, #265 | packages/lore/src/flows/fragments-flow.ts; packages/lore/src/adapters/cli/commands/fragments.ts; packages/lore/tests/integration/dc2-fragments-check-scope.bun.test.ts | — |
| task-skill-fix-dc2-28-lore-agent-uses-one-argument-style-and | D28 cli-agent | 1 | AC-DC2-28 | #91, #240 | packages/lore/src/adapters/cli/commands/agent.ts; packages/lore/src/adapters/http/auth.ts; packages/lore/tests/integration/dc2-cli-agent.bun.test.ts | — |
| task-skill-fix-dc2-29-the-dashboard-reports-an-unreadable | D29 dashboard-cmd | 1 | AC-DC2-29 | #262, #263 | packages/core/src/config-node.ts; packages/lore/src/adapters/cli/commands/dashboard.ts; packages/lore/tests/integration/dc2-dashboard-cmd.bun.test.ts | — |

## Shared files and their serialization
- `packages/core/src/dedicated-extra-keys.ts`: D8, D25 (serialized by blocks links)
- `packages/lore/src/adapters/cli/commands/ac.ts`: D14, D15, D18, D23 (serialized by blocks links)
- `packages/lore/src/adapters/cli/commands/baseline.ts`: D19, D23 (serialized by blocks links)
- `packages/lore/src/adapters/cli/commands/dashboard.ts`: D22, D29 (serialized by blocks links)
- `packages/lore/src/adapters/cli/commands/gate.ts`: D5, D23 (serialized by blocks links)
- `packages/lore/src/service/corpus-service.ts`: D6, D7, D8, D12, D16, D20, D25 (serialized by blocks links)

## Cross-part dependencies
- D23 waits for D5 (part A), encoded as a blocks link.
- D23 waits for D18 (part C), encoded as a blocks link.
- D23 waits for D19 (part C), encoded as a blocks link.
- D23 waits for D22 (part C), encoded as a blocks link.
- D25 waits for D7 (part A), encoded as a blocks link.
- D25 waits for D8 (part A), encoded as a blocks link.

## Rule changes
- D23 reads BR-925 as modified by part C (reads go through the selected store); no rule change of its own.

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| a shared file edited by two concurrent tasks | M | blocks links above; edit-time anchor gate |
| a fix changes an established rule | M | the change set named under Rule changes |
| a later wave starts before its cross-part blocker lands | M | blocks links are checked by lore ready |
