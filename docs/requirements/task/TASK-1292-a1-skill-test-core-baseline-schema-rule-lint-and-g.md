---
id: TASK-1292
type: task
role: plan
title: "[A1] [Skill:test] core baseline schema, rule lint and guard table — RED"
status: archived
priority: critical
phase: "Phase A: core contracts"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
---
Estimate: S
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`). §C1, §C3 (lint, DEDICATED_EXTRA_KEYS), §C4 (cites field)
TDD-Role: red | Paired-Impl: A2a, A2b
Covers: AC-BLS1-7, AC-BLS1-9

Structure: two describe blocks — `describe("baseline schema and lint")` (owned by A2a: node/parent rules, lifecycle, id grammar, examples, lint) and `describe("dedicated keys and cites")` (owned by A2b: guard table, AC cites).

Scenarios:
- Given a baseline doc with node=branch carrying rules, When validated, Then it is refused (rules only on leaves).
- Given node=root, When parent type is baseline, Then refused; node=branch|leaf with parent prd, Then refused.
- Given a rule with lifecycle retired and no retired_note, When validated, Then refused.
- Given a lifecycle transition retired→live or deprecated→live, When checked by the transition helper, Then refused; live→deprecated→retired accepted.
- Given rule ids, Then `^BR-[1-9][0-9]*$` accepted; `BR-0`, `BR-01`, `br-3`, `BR-3a` refused.
- Given examples count 0 or 4, Then refused; 1..3 accepted.
- Given lint fixture FORBIDDEN (an existing repo path such as packages/lore/src/app.ts, `#Foo`, `doThing(`, `--force`, `LORE_X=1`, `workflow.gates.enabled`), Then each token is flagged with its kind; Given fixture ALLOWED ("the user's test file", "exit code 3", "a spec"), Then 0 flags.
- Given DEDICATED_EXTRA_KEYS, Then baseline registers node, rules, depends_on, glossary, label each with a writer hint.
- Given an AcceptanceCriterion with cites [BR-1, BR-1], Then refused (unique); cites of 11 ids refused; malformed id refused.

AC:
- All scenarios are executable tests in the anchored file.
- Running the file's command yields every scenario RED, and each failure message names the missing behaviour (not a syntax/import error in the test itself).
- Record `lore evidence <this-task> --result expected-fail --oracle test --command "<cmd>"` AT THE MOMENT it runs red (not transcribed later).
