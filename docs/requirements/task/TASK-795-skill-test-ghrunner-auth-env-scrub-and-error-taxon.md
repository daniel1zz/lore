---
id: TASK-795
type: task
role: plan
title: "[Skill:test] GhRunner auth, env-scrub and error-taxonomy RED scenarios"
status: draft
priority: high
phase: "P0: Runner + error taxonomy"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-794, type: blocks}
---
Estimate: S
Source: AC-GI-2 and AC-GI-8 of spec-the-defect-channel-reaches-no-machine-but-its-own-github
TDD-Role: red | Paired-Impl: the GhRunner implementation task in this phase

Scenarios:
- Given no `gh` binary on PATH, When GhRunner.run is called, Then it returns err with code AUTH_REQUIRED and the message contains the literal `cli.github.com`
- Given `gh` present but `gh auth status` reporting unauthenticated, When GhRunner.run is called, Then it returns err with code AUTH_REQUIRED and the message contains the literal `gh auth login`
- Given a process env carrying GH_REPO, GH_HOST, GH_CONFIG_DIR and GH_ENTERPRISE_TOKEN, When GhRunner invokes the child process, Then none of those four names is present in the child env
- Given a child process exiting non-zero with stderr text, When GhRunner.run is called, Then it returns err carrying a bounded stderr tail rather than throwing
- Given a network-level failure, When GhRunner.run is called, Then the error code is TRANSPORT_UNAVAILABLE, distinct from AUTH_REQUIRED
- Given a 403 rate-limit response, When GhRunner.run is called, Then the error code is RATE_LIMITED and carries the reset value

AC:
- Every scenario above exists as an executable vitest case in the anchored files
- Running the anchored test files exits non-zero before the paired implementation lands
- Each failure reason is a missing module or missing export, not an assertion authored against the wrong contract
- `lore evidence --result expected-fail` is recorded BY THIS TASK at the moment the red is observed, with the exact command and its output tail
