---
id: PLAN-174
type: plan
role: plan
title: "Baseline pilot v3: populate the execution branch with method v2 and re-probe across two branches"
status: deprecated
priority: medium
created: 2026-10-08
updated: 2026-10-10
tags: []
parent: SPEC-156
phases:
  - {name: "P0 Freeze"}
  - {name: "P1 Build"}
  - {name: "P2 Measure"}
  - {name: "P3 Assess"}
---
# Plan: Baseline pilot v3 — populate the execution branch with method v2, re-probe across two branches

Parent: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations. Exit criterion: AC-BLS1-13 (bars registered before this plan and before any v3 measurement). Authorised by the project owner choosing option A after pilot v2 (`knowledge-pilot-assessment-v2-baseline-migration-method-v2-on`), which supersedes v2's "no v3 inside this delegation" clause for exactly this step.

## Goal
Answer the one question v2 left open: does a baseline covering MORE than one branch let a blind reader answer questions that span those branches, with the v2 method (written placement ADR, falsifying citations, downgrade of uncited rules) applied to a second branch?

## Changes vs v2
- Probe v3 is restricted to the two populated branches (ADR Q2 classification recorded per question) and frozen before the first execution-branch document.
- Placement disagreement is counted at FULL granularity (assess recommendation on v2), and the sample must put >= 20 ACs on BR rules, else the placement bar counts as not measured (v2's validity gap: 68/70 out of branch).
- Sample: 80 ACs, seed 20261009, disjoint from the v1 specs and the v2 sample, keyword filter covering both branches.
- Placement ADR as amended after v2 (mixed-AC main-assertion rule, configuration tie-break, same-leaf tie-break).

## Execution constraint
All tasks write the live corpus; worktree agents cannot (issue #39). Agents analyse read-only and return structured drafts; the orchestrator applies them from main as agent:main-orchestrator. No source code changes.

## Phases
- P0 Freeze: probe v3; AC sample v3.
- P1 Build: excavate execution branch (rules verified against code, falsifying citations proposed); apply branch + leaves + rules; citation coverage + downgrades across both branches.
- P2 Measure: two mappers; blind reader + independent grader.
- P3 Assess against AC-BLS1-13.

## Stop rule
If v3 fails any bar, stop and return the direction to the owner; no v4 without an explicit owner choice.

## Exit criterion record (verbatim; structured ACs are the SSOT — issue #40: the plan judge sees only the spec body)
```json
{
  "id": "AC-BLS1-13",
  "statement": "Pilot v3 exit (specification + execution branches, method v2): on a NEW seeded sample of at least 60 ACs disjoint from the v1 and v2 samples, two independent mappers disagree on at most 30% at FULL granularity (exact BR id, branch name, ARCH or GAP) and at least 20 sampled ACs are placed on a BR rule by at least one mapper; 0 established or observed rules in either populated branch lack a citing script-mode AC; and a blind reader scores at least 9 of 10 with 0 confident-wrong on a NEW 10-question probe set, frozen before the first execution-branch baseline document, whose every question the placement ADR assigns to the specification or execution branch",
  "verify": {
    "mode": "ai",
    "rubric": "Pass only if the v3 assessment records: (1) sample size >= 60 with seed and freeze time, disjoint from the v1 and v2 samples; (2) full-granularity disagreements / sample <= 30%; (3) in-tree count (ACs placed on a BR rule by >= 1 mapper) >= 20, else bar 2 counts as not measured and fails; (4) established|observed rules without a citing script-mode AC == 0 across both branches; (5) blind score >= 9/10; (6) confident-wrong == 0; and the probe v3 creation time precedes the first execution-branch baseline document. Fail if any number is missing or any bar moved after its measurement"
  }
}
```
