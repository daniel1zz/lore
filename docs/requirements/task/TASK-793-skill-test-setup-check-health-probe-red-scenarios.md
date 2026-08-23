---
id: TASK-793
type: task
role: plan
title: "[Skill:test] setup --check health probe RED scenarios"
status: archived
priority: medium
phase: "P0: Runner + error taxonomy"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
---
Estimate: S
Source: AC-GI-2 of the governing spec; QA-2's remedy-discoverability half
TDD-Role: red | Paired-Impl: the setup health-check task in this phase

Scenarios:
- Given `gh` absent from PATH, When the health check runs, Then it reports the gh-missing condition and names `cli.github.com`, and the overall check result is a failure
- Given `gh` present but unauthenticated, When the health check runs, Then it reports the auth condition and names `gh auth login`
- Given `gh` present and authenticated but the target repo unreadable, When the health check runs, Then it distinguishes that from the auth failure
- Given every precondition satisfied, When the health check runs, Then it reports success and performs no write of any kind

AC:
- Every scenario exists as an executable vitest case in the anchored file
- The anchored file exits non-zero before the paired implementation lands
- No scenario performs a write — the check is read-only by construction, asserted by injecting a runner that fails the test if a mutating gh verb is invoked
- `lore evidence --result expected-fail` recorded BY THIS TASK at the moment the red is observed
