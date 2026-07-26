---
id: TASK-238
type: task
role: plan
title: "[Skill:implement] machine-config write backend: saveGlobalConfig + GlobalConfigService"
status: archived
priority: high
phase: "Phase 1: Foundation + machine backend"
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: PLAN-059
plan: PLAN-059
links:
  - {id: TASK-243, type: blocks}
---
Estimate: L
Approach: mirror SPEC-062 ConfigService.update shape (validate-then-write, deny-key enforcement via findDeniedConfigKeys, expectedHash CAS inside the service, audit row per accepted write) for the machine-scope GlobalLoreConfig; add saveGlobalConfig as the atomic writer.
Source: SPEC-064 D1/D7; packages/core/src/config-node.ts (loadGlobalConfig has NO writer), config-service.ts (the shape to mirror), GlobalLoreConfigSchema (.strict(), defaults only)
Dimensions: D-FUNC, D-CODE
Covers: AC-064-3, AC-064-4

Add `saveGlobalConfig(config, path?)` to `packages/core/src/config-node.ts` — validate-then-write against GlobalLoreConfigSchema, atomic (tmp+rename), creates parent dirs when the XDG path does not exist (D7). A schema-invalid merge writes exactly 0 bytes and leaves any pre-existing file byte-identical. Then create `packages/lore/src/service/global-config-service.ts` — GlobalConfigService with read() (redacted, though machine scope has no redact keys today) and update(patch, opts): rejects any patch touching a CONFIG_DENY_KEYS entry (defaults.editor → exactly 1 denied key, VALIDATION_ERROR naming it, 0 bytes) via findDeniedConfigKeys; accepts defaults.format/defaults.color; enforces expectedHash CAS INSIDE the service (not only at a future route); writes an audit row per accepted update. Reuse @lore/core/setup-manifest or config-service hashing helper — do NOT hand-roll a second sha256 of a stable-stringified config.

AC:
- saveGlobalConfig is validate-then-write + atomic: an invalid merge writes 0 bytes / leaves any existing file byte-identical; a valid write to a non-existent XDG path creates parent dirs and round-trips via loadGlobalConfig (packages/lore/tests/unit/core/global-config.test.ts).
- GlobalConfigService.update rejects a defaults.editor patch (1 denied key, VALIDATION_ERROR, 0 bytes), accepts defaults.format/color, and rejects a stale expectedHash with 0 bytes written (packages/lore/tests/unit/service/global-config-service.test.ts).
- Covers AC-064-3 (bunx vitest run packages/lore/tests/unit/core/global-config.test.ts) and AC-064-4 (bunx vitest run packages/lore/tests/unit/service/global-config-service.test.ts).
