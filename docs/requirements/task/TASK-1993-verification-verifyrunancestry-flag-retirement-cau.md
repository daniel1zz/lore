---
id: TASK-1993
type: task
role: plan
title: "Verification: verifyRunAncestry, flag retirement, cause-specific refusals"
status: approved
priority: critical
phase: "P2 Carrier and verification"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-253
plan: PLAN-253
links:
  - {id: TASK-1932, type: blocks}
---
Covers: AC-RV-3, AC-RV-4, AC-RV-5, AC-RV-9 (per-session boundary, user decision D19)
Approach: verifyRunAncestry per the spec's Verification table: walk from process.pid through parentOf to pid 1, compare runs.harness_pid and harness_pid_start; process-table port gains parentOf and startTimeOf (ps -o ppid=,lstart=). resolveInvocationIdentity reads env[HARNESS_RUN_ENV], refuses a flag with harnessRunFlagRetired() (exit 2), and on marker-without-value reads the effective settings for the Bash PreToolUse hook (installed: ENV_REMOVED_CAUSE; not installed: lore setup). Falsifier literals verbatim, once each. No fallback for legacy runs.
Branching: branches from the carrier task's branch (plan I5). Scoped-oracle floor: every importer of run-identity-node.ts and invocation-node.ts.
