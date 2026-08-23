---
id: TASK-783
type: task
role: plan
title: "[Skill:test] migration integrity and dry-run RED scenarios"
status: archived
priority: high
phase: "P3: Migration"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
---
Estimate: S
Source: AC-GI-11 of the governing spec; Risk PR-5 (halfway create-then-PATCH)
TDD-Role: red | Paired-Impl: the migration task in this phase

Scenarios:
- Given the 12 filed reports and dry-run mode, When migration runs, Then it reports 12 planned creations and 2 planned closures and performs ZERO network writes
- Given a successful migration, When the target repo is read, Then exactly 12 issues exist and exactly 2 of them are closed with a state_reason
- Given each migrated issue, When its body front matter is compared field by field against its corpus source, Then all six fields are equal
- Given each migrated corpus record, When it is read, Then extra.issue_report.github carries repo and number, and extra.issue_report.idempotency_key is present
- Given a simulated failure between the create and the PATCH of one report, When the log is read, Then that report has an intent with no outcome and is reported as needing reconciliation — never silently counted as migrated

AC:
- Every scenario exists as an executable bun test case in the anchored file
- The anchored file exits non-zero before the paired implementation lands
- The dry-run scenario asserts zero writes by injecting a runner that fails on any mutating verb
- `lore evidence --result expected-fail` recorded BY THIS TASK when the red is observed
