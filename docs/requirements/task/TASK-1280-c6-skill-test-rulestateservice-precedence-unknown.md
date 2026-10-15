---
id: TASK-1280
type: task
role: plan
title: "[C6] [Skill:test] RuleStateService precedence, unknown reasons, ambiguous ac_ref, git-free counts — RED"
status: archived
priority: high
phase: "Phase C: services and surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
---
Estimate: M
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`). §C6, §C7, QA-3/4/5
TDD-Role: red | Paired-Impl: C7
Covers: AC-BLS1-3, AC-BLS1-4, AC-BLS1-5

Scenarios (InMemoryStore + injected git port):
- Precedence: one citing AC failed latest attested run → contradicted; passes with changed anchors since head_sha → stale; attested pass, no change → verified; no executable citing AC → unverified.
- Self-reported pass only → never verified (unverified).
- Pass without head_sha → unknown(no-commit-recorded); worktree_dirty → unknown(dirty); sha not ancestor → unknown(not-ancestor); git port unavailable → unknown(git-unavailable).
- Each state returns its inputs (spec, AC id, evidence timestamp, sha, anchor paths) and computed_from.
- Git port called ≤ 1 time per distinct sha; identical output for identical (HEAD, corpus) inputs.
- Evidence ac_ref matching ACs in 2 specs → attributed to 0 rules, ambiguous_ac_ref = 1.
- counts mode: 0 git port calls; stale reported as not_computed with reason; p95 ≤ 1.5 s over 20 runs on a generated 1000-doc fixture.
- Falsifier: resolving evidence by bare ac_ref turns the ambiguity scenario red.

AC:
- All scenarios are executable tests in the anchored file.
- Running the file's command yields every scenario RED, and each failure message names the missing behaviour (not a syntax/import error in the test itself).
- Record `lore evidence <this-task> --result expected-fail --oracle test --command "<cmd>"` AT THE MOMENT it runs red (not transcribed later).
