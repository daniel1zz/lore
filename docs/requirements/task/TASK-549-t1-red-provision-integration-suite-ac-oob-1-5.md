---
id: TASK-549
type: task
role: plan
title: "[T1] RED: provision integration suite (AC-OOB-1..5)"
status: archived
priority: medium
phase: "RED"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-105
plan: PLAN-105
links:
  - {id: TASK-547, type: blocks}
---
Author packages/lore/tests/integration/report-issue-provision.bun.test.ts covering AC-OOB-1..5, each as a -t addressable case. MUST be observed RED before any Phase-2 implementation lands (record the red run as expected-fail evidence). Every case uses a mkdtemp throwaway consumer corpus + a mkdtemp throwaway upstream corpus — NEVER this repo's .lore/. Cases: (1) unconfigured non-TTY without --auto-config exits 4, stderr carries the literal --auto-config command and ZERO hand-edit-YAML template lines; (2) --auto-config with resolvable upstream writes feedback.upstream, the value parses under FeedbackConfigSchema, report lands as a draft task upstream, exit 0; (3) unresolvable upstream exits 4 and leaves consumer config.yaml byte-identical; (4) idempotency + preservation of every pre-existing top-level config key; (5) identity-pin rejection when the candidate's root PRD does not match. Note: this file spawns the compiled binary, so bun run build FIRST or the oracle silently tests stale behaviour.
