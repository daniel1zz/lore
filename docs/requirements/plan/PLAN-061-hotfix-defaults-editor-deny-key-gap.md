---
id: PLAN-061
type: plan
role: plan
title: "Hotfix — defaults.editor deny-key gap"
status: archived
priority: medium
created: 2026-07-21
updated: 2026-07-22
tags: []
parent: SPEC-062
---
# Hotfix — defaults.editor deny-key gap (SPEC-062 security defect)

## Goal

Close the deferred-execution RCE left open by SPEC-062's `CONFIG_DENY_KEYS` table: `defaults.editor` is a project-config key (`config.ts:369`) that `openEditor` spawns via `spawnSync` on the next interactive `lore create` / `lore set`, and it is currently writable over `PATCH /api/dashboard/config`.

## Sequencing

Single task. Blocks the Settings UI spec — the UI imports the same deny table and would otherwise render this key as editable.

## Exit Criteria

- AC-062-13 attested pass
- No regression in the existing 12 ACs' suites
