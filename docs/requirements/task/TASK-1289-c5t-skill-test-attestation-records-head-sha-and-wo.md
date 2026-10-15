---
id: TASK-1289
type: task
role: plan
title: "[C5t] [Skill:test] attestation records head_sha and worktree_dirty — RED"
status: archived
priority: high
phase: "Phase C: services and surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
---
Estimate: S
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`). §C5
TDD-Role: red | Paired-Impl: C5
Covers: supports AC-BLS1-4

Scenarios (temp git repo fixture):
- Given a clean repo at commit X, When the verify runner records an attestation, Then attestation.head_sha = X and worktree_dirty=false.
- Given an uncommitted change, Then worktree_dirty=true.
- Given a linked worktree at commit Y, When verified from it, Then head_sha = Y (not the main checkout's HEAD).
- Given self-reported evidence, Then no head_sha is present even if supplied by the caller.
- Given git unavailable, Then the attestation omits head_sha (no throw).

AC:
- All scenarios are executable tests in the anchored file.
- Running the file's command yields every scenario RED, and each failure message names the missing behaviour (not a syntax/import error in the test itself).
- Record `lore evidence <this-task> --result expected-fail --oracle test --command "<cmd>"` AT THE MOMENT it runs red (not transcribed later).
