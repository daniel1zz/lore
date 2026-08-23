---
id: TASK-784
type: task
role: plan
title: "[Skill:test] cross-machine reachability e2e against a dedicated target repo — RED"
status: archived
priority: critical
phase: "P2: Intake"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
---
Estimate: M
Source: AC-GI-1 of the governing spec; Decisions Log D-3 (dedicated permanent e2e target repo); Invariant 2 (no vacuous pass)
TDD-Role: red | Paired-Impl: the GitHubIntakePort + service rewiring task in this phase

⛔ This e2e makes REAL network calls against a REAL gh binary. It is not gated behind an env var: an env-gated skip that reports green is the single most-recorded false-green in this repo. It targets a dedicated repo used by nothing else — NEVER `daniel1zz/lore` (Invariant 5).

Scenarios:
- Given a temp cwd containing no `.lore/` directory and no clone of the upstream repo, When `lore report-issue` runs with the required flags, Then it exits 0 and prints an issue number
- Given that issue number, When `gh api` reads the issue, Then the body carries all six front-matter fields with the values supplied
- Given the same temp cwd, When the filing completes, Then a receipt intent line AND a matching outcome line exist for one idempotency key
- Given a retry with the same idempotency key, When `lore report-issue` runs again, Then no second issue is created and the existing issue number is reported
- Given the live filing path, When it executes, Then it reads no `feedback.upstream.corpus_path` value — asserted by running with that key absent from config entirely, which is the whole point of the migration

AC:
- Every scenario exists as an executable bun test case in the anchored file
- The anchored file exits non-zero before the paired implementation lands
- No scenario is skipped, env-gated, or conditional (Invariant 2)
- No scenario targets `daniel1zz/lore` (Invariant 5)
- `lore evidence --result expected-fail` recorded BY THIS TASK when the red is observed
