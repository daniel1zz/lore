---
id: TASK-1482
type: task
role: plan
title: "[Skill:implement] A dirty-tree verify cannot launder a stale rule; plan-close deny names the stale spec and AC"
status: draft
priority: high
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-197
plan: PLAN-197
---
Estimate: M
Approach: rule-state-service.ts:304-306 maps a pass recorded from a dirty worktree to unknown(dirty), and the plan-close cited-rule-state gate refuses only stale/contradicted, so one dirty-tree lore verify replaces a stale verdict with unknown and the gate passes without anything proven. Make the latest attested result per (spec, AC) ignore dirty-tree runs when deciding (keep the previous clean verdict), or treat unknown(dirty) as not satisfying the gate; also fix checkpoint-registry.ts:1906-1910 and corpus-service.ts:4152-4155, whose deny text says 'this plan's tasks' and suggests 'lore verify <this plan>' although staleness is corpus-wide (BR-984): name the stale spec and AC and the verify command for ITS plan.
Source: diagnosis of the plan-round-0-make-main-green close refusal, 2026-10-16.
AC:
- a dirty-tree verify after a stale verdict leaves the rule stale and the gate still refuses; the deny text names the stale (spec, AC) and the verify command for the owning plan
