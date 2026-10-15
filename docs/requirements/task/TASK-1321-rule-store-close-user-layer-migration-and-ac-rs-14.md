---
id: TASK-1321
type: task
role: plan
title: "Rule store close: user-layer migration and AC-RS-14"
status: archived
priority: medium
phase: "close"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-159
plan: PLAN-159
---
## Goal

Close-phase human step of plan-rule-store-option-a: apply the 'User-layer migration table' to `~/.config/lore/context/` on this machine, refresh the user layer, and record AC-RS-14.

## Done (2026-10-15, main session, user-authorized "直接做")

- Deleted user-03, user-04, user-05, user-06 and all `.bak-*` files.
- user-02: `delivery: skill` + description (now `~/.claude/skills/lore-user-02-agent-browser/`).
- user-15: deleted lines 8-9 (bundle + watermarks) and the then-empty `## Subagent 派发` heading; lines 10-19 kept pending the NS2 hook-registration decision.
- user-16: deleted lines 12-13 (Stop Protocol).
- user-17: kept only line 8 (`worktree.baseRef`).
- `lore context refresh --scope user` exit 0 (5 pruned, 3 updated); `lore fragments check` exit 0.
- Backup of the pre-migration layer: session scratchpad `context-backup-1792045510/`.

## AC-RS-14 measurement

dups=0 bytes=29199 check=0 (ceiling 33818). Red control: adding the pre-migration user-17 rendering to the file set gives dups=1.

No repo file anchors: every edited file lives outside the repository.
