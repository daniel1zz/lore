---
id: TASK-1057
type: task
role: plan
title: "Hotfix F1 review tree_position rejects every parentless spec"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
Estimate: S
Source: spec-fresh-install-probe-fixes-a-fresh-consumer-can-run-the F1 (cannot be approved until this lands: its own review fails the same check)
Approach: red-first test packages/lore/tests/integration/review-tree-position-parentless.bun.test.ts; fix checkTreePosition (packages/core/src/review-checks.ts:186-211) so a parentless spec matches; parentless doc of a parent-requiring type still fails.
AC: AC-FIP-1 statement satisfied; verified by the orchestrator via lore verify once the spec is approved.
