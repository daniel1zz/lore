---
id: TASK-1495
type: task
role: plan
title: "[Skill:implement] TG-13 declared test inputs drive the change selector"
status: draft
priority: high
phase: "Phase 4: selector"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1499, type: blocks}
  - {id: TASK-1497, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: L
Approach: Per the T1 decision. Each test that reads a repository file other than through a static import declares it (format from the ADR, e.g. a top-of-file @reads glob list), and the runner guard (T4 setup) fails a test that reads an undeclared repo path at run time. scripts/changed-tests.ts selects by static imports plus declared inputs; the blanket tree-scan-oracle rule is removed, and binary-consumer selection is narrowed per the ADR. Replay e58b9365 and report the selected count and that the 6 known readers of the fragment are selected.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-7.
Also: add the input declarations to every existing test that reads repository files other than by static import (at least the 28 tests selected today as tree-scan-oracle) so the run-time check lands green; cover reads made by child processes and by the compiled binary (state the mechanism, one fixture each).
