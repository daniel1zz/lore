---
id: TASK-932
type: task
role: plan
title: "[Skill:test] RED - runner-unattested label, readers and injective counts (#48)"
status: archived
priority: high
phase: "capture-label"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-153
plan: PLAN-153
links:
  - {id: TASK-931, type: blocks}
---
Estimate: M
Source: spec-evidence-labels-and-reds-are-honest AC-EH-1, AC-EH-2
TDD-Role: red | Paired-Impl: task-skill-implement-runner-unattested-capture-label-for-the
Scenarios:
- RE-BASELINE packages/lore/tests/unit/service/attested-red.test.ts:684, packages/lore/tests/integration/cli/verify-falsify-green-control.test.ts:350 and :519, packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts:1310 (AC-EH-1 a-c): expect 'runner-unattested'. Record each original 'runner' assertion and why (issue #48, BR-1073) in the evidence note.
- RE-BASELINE packages/core/src/task-workflow.test.ts:552 (CAPTURE_SOURCES toEqual) and EXTEND packages/lore/tests/unit/service/capture-source-required.test.ts (AC-EH-2 a, b, b2, f — (f) writes the pass/runner-unattested row directly into the store).
- EXTEND packages/lore/tests/unit/adapters/capture-source-visibility.test.ts (AC-EH-2 c, d, e): fixture of 2 runner, 1 self-report, 1 runner-unattested, 1 legacy row.
Dimensions: HAPPY (label written), NEGATIVE (unknown value rejected), ERROR (label + attestation refused by both writers), STATE (counts sum; done floor), REGRESSION (legacy absent value read as self-report).
AC:
- Run every listed file against current main; each new case must fail on an ASSERTION (wrong label / missing refusal / row written), not a harness error. A red that is a call to a not-yet-existing export the paired task adds (TypeError / undefined is not a function) is acceptable only for that export; say so in the evidence.
- At the moment of red, the agent that ran it records `lore evidence <this task> --oracle <test|e2e> --command "<exact command> 2>&1" --result expected-fail --capture`, one row per file (`2>&1` is required: --capture stores all stdout then all stderr, so without it the runner summary can fall out of the stored tail). Never transcribe a red later.
- Commit the tests on this task's branch; the paired implement task branches from that commit plus every merged predecessor; never merge red to main alone.
