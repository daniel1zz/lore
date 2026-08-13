---
id: TASK-710
type: task
role: plan
title: "Add the two ownership read surfaces: lore territory and lore session, both registered in the CLI registry"
status: archived
priority: medium
phase: "surface"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-129
plan: PLAN-129
---
Implements the spec's L0 read side.

lore territory --json partitions every worktree and branch CORPUS-WIDE (never plan-scoped) into mine / foreign / unowned / unmeasured, and every foreign entry names its holder session_id and worktree path - copying git's own refusal, which names the holding worktree.

lore session list|show joins corpus claims with process liveness probed from pid PLUS process start time. Claim age must not influence the verdict: a fresh claim held by a dead process reports dead, and a stale claim held by a live process reports alive.

Both commands must be entered in adapters/cli/index.ts. Per the module contract, that registry is the only true command count - a command file with no registry entry is not a command.

New service and command files are not declared as anchors because the anchor gate refuses paths absent from disk at create time.
