---
id: TASK-544
type: task
role: plan
title: "[T5] Unlock the SPEC-073 hint's unconfigured branch"
status: archived
priority: medium
phase: "GREEN"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-105
plan: PLAN-105
links:
  - {id: TASK-546, type: blocks}
---
buildReportIssueHint(errClass, upstreamConfigured) currently returns null when upstream is unconfigured (SPEC-073's deliberate byte-absence) — which is exactly what makes the channel invisible to every fresh consumer. Change the unconfigured branch to return exactly ONE line pointing at the provision path (the --auto-config command), keeping the single-wording-SSOT role. The CONFIGURED branch's wording must stay byte-identical to the SPEC-073 baseline (plan invariant 3). Satisfies AC-OOB-6.
