---
id: TASK-928
type: task
role: plan
title: "[Skill:test] RED - falsify discovery refusal and exit 126/127 on the mutated run (#53)"
status: archived
priority: high
phase: "red-proof"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-153
plan: PLAN-153
links:
  - {id: TASK-927, type: blocks}
---
Estimate: S
Source: spec-evidence-labels-and-reds-are-honest AC-EH-10
TDD-Role: red | Paired-Impl: task-skill-implement-falsify-path-records-discovery-refusal-and
Scenarios:
- NEW packages/lore/tests/unit/service/falsify-discovery-refusal.test.ts (AC-EH-10 a-e2): scripted executor; (d) is the genuine-red control; (e)/(e2) declared 127/126.
Dimensions: HAPPY (d), NEGATIVE (a, c), BOUNDARY (e, e2 code equals declared), STATE (b no expected-fail row), REGRESSION (d).
AC:
- Run every listed file against current main; each new case must fail on an ASSERTION (wrong label / missing refusal / row written), not a harness error. A red that is a call to a not-yet-existing export the paired task adds (TypeError / undefined is not a function) is acceptable only for that export; say so in the evidence.
- At the moment of red, the agent that ran it records `lore evidence <this task> --oracle <test|e2e> --command "<exact command> 2>&1" --result expected-fail --capture`, one row per file (`2>&1` is required: --capture stores all stdout then all stderr, so without it the runner summary can fall out of the stored tail). Never transcribe a red later.
- Commit the tests on this task's branch; the paired implement task branches from that commit plus every merged predecessor; never merge red to main alone.
