---
id: TASK-553
type: task
role: plan
title: "[T5] close AC-WH-1 rendering clause + oracle coverage (assess major gap)"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-29
tags: []
parent: PLAN-106
plan: PLAN-106
---
Assessment knowledge-assessment-implementation-workflow-hardening-m1-m4 major gap: AC-WH-1 claims 'stored verbatim with distinct rendering' and non-green classification in verify summaries / assess evidence facts, but no renderer changed and the AC oracle only covers AC-coverage aggregation. Implement distinct rendering for expected-fail (CLI coverage badge in ac.ts renders expected-fail-only distinctly from never-verified; evidence list rendering labels expected-fail) + add classification assertions in the read-site suites the M1 report enumerated (evidence-panel summarize math). Then the orchestrator extends AC-WH-1's verify command to include those suites. RED-first.
