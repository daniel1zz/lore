---
id: PLAN-063
type: plan
role: plan
title: "SPEC-046 amendment — vendor SubagentStop commit guard"
status: archived
priority: medium
created: 2026-07-21
updated: 2026-07-21
tags: []
parent: SPEC-046
---
# SPEC-046 amendment — vendor the SubagentStop commit guard

## Goal

Ship `subagent-stop-commit-guard.mjs` through `lore setup` like every other
core governance/safety hook, so a fresh machine inherits the data-loss
backstop instead of only the owner's machine having it.

## Why this is a distribution concern, not personal config

The guard prevents a worktree subagent from terminating with unpersisted work.
Any team using worktree-isolated agents faces the identical failure (this repo
hit it twice in two days). That places it with `pre-bash-git-safety-gate`
(governance/safety, auto-registered) rather than with `pre-subagent-gate`
(orchestration policy, deliberately not registered).

## Exit Criteria

- Hook vendored + declared in HOOK_REGISTRATIONS; both conformance manifests green.
- `lore setup --dry-run` shows the hook and its settings.json registration.
