---
id: PLAN-226
type: plan
role: plan
title: "Defect clusters round 2 part C"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: SPEC-216
phases:
  - {name: "wave-1"}
  - {name: "wave-2"}
  - {name: "wave-3"}
  - {name: "wave-5"}
---
## Goal
Implement spec-defect-clusters-round-2-part-c-criterion-data-demotion (defect clusters round 2, part C): one task per group, each making its AC green and closing its bound reports when archived.

## Invariants
- One task per Dn group; anchors are files, never directories; a file shared by two tasks is serialized by a blocks link.
- Red-first runs are runner-produced (`--capture` or `lore verify`); passes recorded with `--capture`. A corpus-data task (D17) proves red by running its check script against a deliberately broken criterion command, as its AC states.
- Tests use throwaway repos/corpora only (HOME and XDG_CONFIG_HOME in temp dirs); never the repo .lore/; never assume port 8787.
- An edit outside a task's anchors is declared before it is made (`lore anchor add`, overlap-checked).
- Before integrate: `check:floor` green and baseline coverage previewed; the main agent maps new coverage pairs.

## Tasks (wave, AC, reports, anchors, blocked by)
| Task | Group | Wave | AC | Reports | Anchors | Blocked by |
|---|---|---|---|---|---|---|
| task-skill-fix-dc2-17-corpus-criterion-data-corrected-to | D17 ac-command-data | 3 | AC-DC2-17 | #74, #75, #103, #187 |  | D15 (part B) |
| task-skill-fix-dc2-18-every-demotion-is-announced-and-the-help | D18 demotion-notice | 3 | AC-DC2-18 | #176, local: lore ac add/set 静默把 approved spec 打回 draft (scoped to the still-open `ac set` half), #116, #110 | packages/lore/src/service/rule-service.ts; packages/lore/src/service/ac-service.ts; packages/lore/src/adapters/cli/commands/rule.ts; packages/lore/src/adapters/cli/commands/ac.ts; packages/lore/src/adapters/mcp/tools.ts; packages/lore/src/adapters/cli/commands/evidence.ts; packages/lore/tests/integration/dc2-demotion-notice.bun.test.ts | D6 (part A), D15 (part B) |
| task-skill-fix-dc2-19-the-site-census-records-where-it-stops | D19 site-census-not-measured | 1 | AC-DC2-19 | #94, #112, #118 | packages/lore/src/service/site-census.ts; packages/lore/src/adapters/cli/commands/baseline.ts; packages/lore/tests/integration/dc2-site-census-not-measured.bun.test.ts | — |
| task-skill-fix-dc2-20-the-knowledge-sub-type-set-and-create-s | D20 knowledge-subtype-message | 5 | AC-DC2-20 | #17, #88, local: lore create --help never marks per-type required flags | packages/core/src/types.ts; packages/core/src/schemas.ts; packages/lore/src/service/corpus-service.ts; packages/lore/src/adapters/cli/commands/create.ts; packages/lore/src/adapters/cli/create-task-validation.ts; packages/lore/src/adapters/cli/decision-status-validation.ts; assets/context/corpus-workflow-2-produce.md; packages/lore/src/generated/assets-manifest.ts; packages/lore/tests/unit/adapters/cli-create.bun.test.ts; packages/lore/tests/integration/dc2-knowledge-subtype-message.bun.test.ts | D5 (part A), D8 (part A), D25 (part D) |
| task-skill-fix-dc2-21-the-red-step-lives-in-the-implementing | D21 tdd-red-pairing | 1 | AC-DC2-21 | #23, #26 | assets/skills/lore-plan/SKILL.md; assets/skills/lore-plan/references/mode-create.md; assets/skills/lore-plan/references/workflow-examples.md; packages/lore/src/generated/assets-manifest.ts; packages/lore/tests/integration/dc2-tdd-red-pairing.bun.test.ts | — |
| task-skill-fix-dc2-22-with-sync-enabled-every-route-reads-and | D22 store-selection | 2 | AC-DC2-22 | #84 | packages/lore/src/adapters/cli/loader.ts; packages/lore/src/app.ts; packages/lore/src/store/turso-store.ts; packages/lore/src/adapters/cli/commands/dashboard.ts; packages/lore/tests/integration/dc2-store-selection.bun.test.ts | D2 (part A), D29 (part D) |

## Shared files and their serialization
- `packages/core/src/schemas.ts`: D8, D20 (serialized by blocks links)
- `packages/lore/src/adapters/cli/commands/ac.ts`: D14, D15, D18, D23 (serialized by blocks links)
- `packages/lore/src/adapters/cli/commands/baseline.ts`: D19, D23 (serialized by blocks links)
- `packages/lore/src/adapters/cli/commands/dashboard.ts`: D22, D29 (serialized by blocks links)
- `packages/lore/src/adapters/cli/loader.ts`: D12, D22 (serialized by blocks links)
- `packages/lore/src/adapters/mcp/tools.ts`: D6, D18 (serialized by blocks links)
- `packages/lore/src/app.ts`: D2, D12, D22 (serialized by blocks links)
- `packages/lore/src/generated/assets-manifest.ts`: D5, D20, D21 (serialized by blocks links)
- `packages/lore/src/service/ac-service.ts`: D12, D15, D18 (serialized by blocks links)
- `packages/lore/src/service/corpus-service.ts`: D6, D7, D8, D12, D16, D20, D25 (serialized by blocks links)
- `packages/lore/src/service/rule-service.ts`: D12, D18 (serialized by blocks links)
- `packages/lore/src/store/turso-store.ts`: D7, D22 (serialized by blocks links)

## Cross-part dependencies
- D17 waits for D15 (part B), encoded as a blocks link.
- D18 waits for D6 (part A), encoded as a blocks link.
- D18 waits for D15 (part B), encoded as a blocks link.
- D20 waits for D5 (part A), encoded as a blocks link.
- D20 waits for D8 (part A), encoded as a blocks link.
- D20 waits for D25 (part D), encoded as a blocks link.
- D22 waits for D2 (part A), encoded as a blocks link.
- D22 waits for D29 (part D), encoded as a blocks link.

## Rule changes
- BR-925 (D22, sync through the embedded replica) is modified by this spec's change set.

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| a shared file edited by two concurrent tasks | M | blocks links above; edit-time anchor gate |
| a fix changes an established rule | M | the change set named under Rule changes |
| a later wave starts before its cross-part blocker lands | M | blocks links are checked by lore ready |
