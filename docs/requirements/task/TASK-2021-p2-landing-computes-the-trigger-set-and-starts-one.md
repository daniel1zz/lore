---
id: TASK-2021
type: task
role: plan
title: "P2 landing computes the trigger set and starts one detached review batch under a renewable lease; outcomes, retry and owner path"
status: archived
priority: medium
phase: "P"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-268
plan: PLAN-268
links:
  - {id: TASK-2022, type: blocks}
---
Spec: spec-plans-close-themselves-level-triggered-reconciliation-of (corrected v30: findings are filed by root-cause fingerprint, one issue per fingerprint linked to every plan sharing it, deduplicated against open issues; a failing main suite is one fingerprint). Rule BR-1379. References: Rails counter_cache; Sentry fingerprint grouping. The existing lore assess --file-issues (packages/lore/src/adapters/cli/assess-file-issues.ts, D4) files one issue per plan per dimension: replace it with the grouped filing, so both the manual flag and the automatic batch use one implementation. Delete-by-default; no compat path.
