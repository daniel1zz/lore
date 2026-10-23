---
id: TASK-1829
type: task
role: plan
title: "Root coverage reports a declared command that no longer exists as a stale declaration with its fix, not a census error"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Gap from the assessment of plan-complete-coverage-integrate-floor (knowledge-assessment for that plan, 2026-10-19): in root coverage (packages/lore/src/adapters/cli/commands/baseline.ts runCoverage) every declared leaf command goes through resolveCommandEntry; a declaration whose command was renamed or removed throws a SiteCensusError, so `lore baseline coverage <root>` and the integrate floor step check:baseline-coverage fail with a census error instead of naming the stale declaration and its fix. It fails loud (not silent), but the refusal is not self-sufficient: the branch author must read the census error to learn which leaf declares the vanished command.

End state: a declared command that no longer resolves in the analysed tree is reported like any other coverage defect — per leaf, `stale command <cmd>` with the fix `lore baseline map <leaf> --remove-command "<cmd>"` (and, when the registry now lists a runnable command the same leaf could declare, that is listed as undeclared with its own fix) — and makes coverage incomplete (exit 1), never a census error (exit 4). Census errors stay for genuinely unanalysable trees.

AC: a fixture where leaf A declares `gamma` and the registry no longer has it: root coverage exits exactly 1 naming `stale command gamma` on leaf A with the --remove-command fix; falsifier: today's behaviour (census error, exit 4).
