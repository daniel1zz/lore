---
id: TASK-1282
type: task
role: plan
title: "[C1] [Skill:test] RuleService, baseline verbs and replace guard — RED"
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
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`). §C3, QA-2
TDD-Role: red | Paired-Impl: C2
Covers: AC-BLS1-2

Scenarios (InMemoryStore):
- Given a leaf, When `rule add`, Then a BR-n id is returned and the leaf version increments; editing an approved leaf demotes it to draft.
- Given a rule, When `rule set --lifecycle retired` without a note, Then refused; with a note accepted; then `--lifecycle live`, Then refused.
- Given `baseline add` with node=leaf under a branch, Then created; node=leaf under prd, Then refused.
- Given `baseline depends <leaf> --add BR-x` where BR-x does not exist, Then refused; existing, Then stored on the leaf.
- Given corpusService.set patching extra.rules (same array reordered, a replaced array, or a dropped key) on a baseline doc, Then refused naming the writer — for the CLI path, the MCP lore_set handler and the HTTP doc route handler.
- Falsifier: a drop-only guard (refusing only when the key is absent) turns the replaced-array scenario red.

AC:
- All scenarios are executable tests in the anchored file.
- Running the file's command yields every scenario RED, and each failure message names the missing behaviour (not a syntax/import error in the test itself).
- Record `lore evidence <this-task> --result expected-fail --oracle test --command "<cmd>"` AT THE MOMENT it runs red (not transcribed later).
