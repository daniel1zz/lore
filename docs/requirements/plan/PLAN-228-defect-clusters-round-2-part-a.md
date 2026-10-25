---
id: PLAN-228
type: plan
role: plan
title: "Defect clusters round 2 part A"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: SPEC-214
phases:
  - {name: "wave-1"}
  - {name: "wave-2"}
  - {name: "wave-3"}
---
## Goal
Implement spec-defect-clusters-round-2-part-a-sessions-seats-setup-init (defect clusters round 2, part A): one task per group, each making its AC green and closing its bound reports when archived.

## Invariants
- One task per Dn group; anchors are files, never directories; a file shared by two tasks is serialized by a blocks link.
- Red-first runs are runner-produced (`--capture` or `lore verify`); passes recorded with `--capture`. A corpus-data task (D17) proves red by running its check script against a deliberately broken criterion command, as its AC states.
- Tests use throwaway repos/corpora only (HOME and XDG_CONFIG_HOME in temp dirs); never the repo .lore/; never assume port 8787.
- An edit outside a task's anchors is declared before it is made (`lore anchor add`, overlap-checked).
- Before integrate: `check:floor` green and baseline coverage previewed; the main agent maps new coverage pairs.

## Tasks (wave, AC, reports, anchors, blocked by)
| Task | Group | Wave | AC | Reports | Anchors | Blocked by |
|---|---|---|---|---|---|---|
| task-skill-fix-dc2-1-session-snapshot-and-resume-report-what | D1 session-bootstrap-counts | 2 | AC-DC2-1 | #3, #267, #269 | packages/lore/src/service/session-service.ts; packages/core/src/session.ts; packages/lore/src/adapters/cli/commands/bootstrap.ts; packages/lore/tests/integration/dc2-session-bootstrap-counts.bun.test.ts | D11 (part B) |
| task-skill-fix-dc2-2-a-seat-is-a-plan-s-seat-and-removing-it | D2 seat | 1 | AC-DC2-2 | #270, #271, #272, #301 | packages/lore/src/service/seat-service.ts; packages/lore/src/adapters/real-git-port.ts; packages/lore/src/app.ts; packages/lore/src/adapters/cli/commands/seat.ts; packages/lore/tests/integration/dc2-seat-lifecycle.bun.test.ts | — |
| task-skill-fix-dc2-3-install-check-and-flag-validation-agree | D3 setup-install | 1 | AC-DC2-3 | #115, #196, #257, #258 | packages/core/src/setup-manifest.ts; packages/core/src/plan-update.ts; packages/lore/src/service/setup-service.ts; packages/lore/src/adapters/cli/setup-check.ts; packages/lore/src/adapters/cli/setup-args.ts; packages/lore/src/adapters/cli/commands/setup.ts; packages/lore/tests/integration/dc2-setup-install-retired-files.bun.test.ts | — |
| task-skill-fix-dc2-4-project-uninstall-reverses-everything | D4 setup-project-uninstall | 2 | AC-DC2-4 | #260, #261 | packages/lore/src/flows/setup-project-flow.ts; packages/lore/src/flows/setup-project-uninstall.ts; packages/lore/src/adapters/cli/commands/setup.ts; packages/lore/tests/integration/dc2-setup-project-uninstall-reversal.bun.test.ts | D3 |
| task-skill-fix-dc2-5-lore-init-is-one-atomic-scaffold-that | D5 init-scaffold | 2 | AC-DC2-5 | #207, #256, local: lore init does not seed the verification-profiles config, local: spec-create gate missing-rule-doc remediation points to a dev-repo script | packages/lore/src/adapters/cli/commands/init.ts; packages/lore/src/flows/init-corpus.ts; packages/lore/src/adapters/cli/commands/gate.ts; assets/governance/write-spec-rule.md; scripts/seed-write-spec-rule.ts; packages/lore/src/generated/assets-manifest.ts; packages/lore/tests/integration/dc2-init-scaffold.bun.test.ts | D21 (part C) |
| task-skill-fix-dc2-6-a-deleted-document-is-not-addressable-and | D6 soft-delete-lifecycle | 2 | AC-DC2-6 | #70, #83, #86, #295 | packages/lore/src/service/resolve.ts; packages/lore/src/service/corpus-service.ts; packages/lore/src/adapters/cli/commands/undelete.ts; packages/lore/src/adapters/cli/index.ts; packages/lore/src/adapters/cli/commands/delete.ts; packages/lore/src/adapters/mcp/tools.ts; packages/lore/tests/integration/dc2-soft-delete-lifecycle.bun.test.ts | D8 |
| task-skill-fix-dc2-7-one-parent-link-that-always-agrees-with | D7 link-integrity | 3 | AC-DC2-7 | #249, #250, #251 | packages/lore/src/store/sqlite-store.ts; packages/lore/src/store/turso-store.ts; packages/lore/src/store/in-memory-store.ts; packages/lore/src/store/store-interface.ts; packages/lore/src/store/write-context-store.ts; packages/lore/src/store/migrations/migration-026.ts; packages/lore/src/service/corpus-service.ts; packages/core/src/errors.ts; packages/lore/src/adapters/cli/utils.ts; packages/lore/tests/integration/dc2-link-integrity.bun.test.ts | D6, D22 (part C) |
| task-skill-fix-dc2-8-lore-set-validates-titles-and-protects | D8 set-validation | 1 | AC-DC2-8 | #246, #247 | packages/core/src/schemas.ts; packages/core/src/dedicated-extra-keys.ts; packages/lore/src/service/corpus-service.ts; packages/lore/tests/integration/dc2-set-validation.bun.test.ts | — |

## Shared files and their serialization
- `packages/core/src/dedicated-extra-keys.ts`: D8, D25 (serialized by blocks links)
- `packages/core/src/schemas.ts`: D8, D20 (serialized by blocks links)
- `packages/lore/src/adapters/cli/commands/gate.ts`: D5, D23 (serialized by blocks links)
- `packages/lore/src/adapters/cli/commands/setup.ts`: D3, D4 (serialized by blocks links)
- `packages/lore/src/adapters/mcp/tools.ts`: D6, D18 (serialized by blocks links)
- `packages/lore/src/app.ts`: D2, D12, D22 (serialized by blocks links)
- `packages/lore/src/generated/assets-manifest.ts`: D5, D20, D21 (serialized by blocks links)
- `packages/lore/src/service/corpus-service.ts`: D6, D7, D8, D12, D16, D20, D25 (serialized by blocks links)
- `packages/lore/src/store/turso-store.ts`: D7, D22 (serialized by blocks links)

## Cross-part dependencies
- D1 waits for D11 (part B), encoded as a blocks link.
- D5 waits for D21 (part C), encoded as a blocks link.
- D7 waits for D22 (part C), encoded as a blocks link.
- D1 calls `isPendingReviewDoc` from pending-queue.ts, created by D11; the D11→D1 blocks link encodes it.

## Rule changes
- BR-807 (D5, `lore init` seeds the write-spec rule document) is modified by this spec's change set.

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| a shared file edited by two concurrent tasks | M | blocks links above; edit-time anchor gate |
| a fix changes an established rule | M | the change set named under Rule changes |
| a later wave starts before its cross-part blocker lands | M | blocks links are checked by lore ready |
