---
id: TASK-941
type: task
role: plan
title: "[Skill:test] RED - declaration-time pipe refusal on service and CLI (#19)"
status: archived
priority: high
phase: "pipe-refusal"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-153
plan: PLAN-153
links:
  - {id: TASK-942, type: blocks}
---
Estimate: S
Source: spec-evidence-labels-and-reds-are-honest AC-EH-6, AC-EH-7
TDD-Role: red | Paired-Impl: task-skill-implement-one-shared-pipe-detector-ac-add-set-refuse
Scenarios:
- NEW packages/lore/tests/unit/service/ac-command-pipe-refusal.test.ts (AC-EH-6 a-h): InMemoryStore + write spy; (b) covers e2e, tsc, lint, build; (c) asserts the advisory for other; (h) the CorpusService.create path.
- NEW packages/lore/tests/e2e/ac-command-pipe-compiled.bun.test.ts (AC-EH-7 a-f): compiled binary, mkdtemp + lore init; (a) is the issue's own repro; (b) asserts 'advisory:' on stderr with exit 0.
- Run AC-EH-6's full stored command once too: its structural half must be red today (measured 2026-10-12: one file, evidence-precheck.ts).
Dimensions: HAPPY (other with advisory, quoted bar, logical or), NEGATIVE (test/e2e/tsc/lint/build pipe), BOUNDARY (pipefail false positive), STATE (statement-only edit not re-checked), REGRESSION (existing stored commands untouched).
AC:
- Run every listed file against current main; each new case must fail on an ASSERTION (wrong label / missing refusal / row written), not a harness error. A red that is a call to a not-yet-existing export the paired task adds (TypeError / undefined is not a function) is acceptable only for that export; say so in the evidence.
- At the moment of red, the agent that ran it records `lore evidence <this task> --oracle <test|e2e> --command "<exact command> 2>&1" --result expected-fail --capture`, one row per file (`2>&1` is required: --capture stores all stdout then all stderr, so without it the runner summary can fall out of the stored tail). Never transcribe a red later.
- Commit the tests on this task's branch; the paired implement task branches from that commit plus every merged predecessor; never merge red to main alone.
