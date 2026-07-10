---
id: TASK-101
type: task
role: plan
title: "T5: hook shims G1/G2 + .claude/settings.json wiring"
status: archived
priority: high
phase: Phase 3 — hook bridge + loop
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-024
plan: PLAN-024
links:
  - {id: TASK-100, type: blocks}
---
Approach: hooks/g1-spec-create.sh (PreToolUse matcher lore_create; if input.type==spec pipe to lore gate spec-create) + hooks/g2-spec-promote.sh (PreToolUse matcher Bash lore approve|set --status; extract id → lore gate spec-promote). Wire both into .claude/settings.json hooks.
Source: spec §4.2, §3.
AC: shell assertions — mock toolInput with exit 4 → shim emits permissionDecision:deny with reason=gate stdout; exit 0 → allow. settings.json contains both hook entries (grep). G2 parse-fail → fail-open-with-log (R2).
Integration: end-to-end interception active in a real Claude Code session (verified by T6).
Estimate: M
