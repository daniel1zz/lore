---
id: TASK-1546
type: task
role: plan
title: "[Skill:implement] AU-T7 self-grantable overrides call decide() and escalate below threshold"
status: draft
priority: high
phase: "Phase 1c: overrides, calibration, integrity"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
links:
  - {id: TASK-1543, type: blocks}
---
Estimate: M
Approach: approve --override-judgment/--override-no-judgment (review-service.ts ~715-780), done --override-attestation(-cite) (task-workflow-service), ac exempt (ac-exemption-service), verify --yes for a command with no attested row on the task (verify-runner-service ~1069) each call decide() with their class; escalate -> exit 4, nothing else written, pending decision id + the lore decide line printed (no nonce). Red-first halves (1)-(4).
Source: spec-autonomy-phase-1-decision-function-human-channel-lore; decision: adr-autonomy-is-decided-by-measured-facts-one-decision-function
AC: AC-AU-7.
