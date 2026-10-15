---
id: TASK-925
type: task
role: plan
title: "[Skill:test] RED - archive --apply leaves floor-refused stragglers open (#173)"
status: archived
priority: high
phase: "archive-sweep-floors"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-154
plan: PLAN-154
links:
  - {id: TASK-926, type: blocks}
---
Estimate: S
Source: spec-approval-and-plan-closure-go-through-the-same-checks-on AC-AP-10
TDD-Role: red | Paired-Impl: task-skill-implement-archive-apply-honours-the-done-floor-port
Scenarios:
- NEW packages/lore/tests/integration/archive-apply-done-floors.bun.test.ts (AC-AP-10 cases a-e): mkdtemp + lore init, CLI subprocess 'bun run src/index.ts'; an archived plan with open unclaimed T2 (no evidence), T1 (attested pass), and an expired R3 handoff; --apply, --apply --json, then --sweep exit 3.
- RE-BASELINE packages/lore/tests/integration/archive-sweep-cli.bun.test.ts: the existing straggler case in integration/archive-sweep-cli.bun.test.ts (~lines 150-200, the oracle of locked AC-097-3: `archive --apply` archives an evidence-less straggler and the re-sweep exits 0) goes red under U2 / spec D8. Re-baseline it so the HAPPY straggler carries an attested pass (still archived, re-sweep exits 0), and add a floor-refused straggler case: an evidence-less straggler stays open, `archive --apply` prints `[SKIPPED] <slug> — refused by attested-pass`, and the re-sweep exits 3. Record the original assertion and why (issue #173, BR-1072) in the evidence note. The new floor-refused case must be red against current main (today the straggler is archived).
Dimensions: HAPPY (b, e), NEGATIVE (a), STATE (d still reported), ERROR (c json floor), REGRESSION (handoff sweep unchanged).
AC:
- Run every listed file against current main. New cases must fail on ASSERTIONS, not harness errors; a red that is a call to the not-yet-existing method the paired task adds (TypeError ... is not a function) is acceptable only for that method; say so in the evidence.
- At the moment of red, the agent that ran it records `lore evidence <this task> --oracle <test|e2e> --command "<exact command> 2>&1" --result expected-fail --capture`, one row per file (`2>&1` is required: --capture stores all stdout then all stderr, so without it the runner summary can fall out of the stored tail). Never transcribe a red later.
- Commit the tests on this task's branch; the paired implement task branches from that commit; never merge red to main alone.
