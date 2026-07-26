---
id: TASK-185
type: task
role: plan
title: "[Skill:test] T3r planUpdate five-state — RED test scenarios"
status: archived
priority: critical
phase: "Phase 2: Core freshness logic"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-040
plan: PLAN-040
links:
  - {id: TASK-184, type: blocks}
---
Estimate: S
Source: AC of task T3 (planUpdate five-state classifier) — SPEC-076 §C3 table + Downstream Handoff UpdatePlan type
TDD-Role: red | Paired-Impl: T3 (planUpdate implementation)

Scenarios:
- Given embedded manifest and installed manifest with equal tree digests, When planUpdate runs, Then summary="sync" and zero per-file sha comparisons occur (probe spy call count = 0)
- Given disk sha = manifest sha ≠ embedded sha for path P, Then P classified outdated and appears in writes
- Given disk sha ≠ manifest sha for path P (any embedded value), Then P classified diverged and appears in NO write set
- Given manifest entry P with no disk file, Then P classified missing and appears in writes (restore)
- Given disk file Q under a lore-managed dir absent from manifest, Then Q classified orphaned and appears in NO write/merge set
- Given ownership=user_once entry with any sha combination, Then it never appears in writes/markerRewrites
- Given ownership=merged entry outdated, Then it appears in merges not writes
- Given empty installed manifest (fresh target), Then every embedded entry classified missing (install-equivalent) — boundary
- Given malformed probe result (probe throws), Then planUpdate returns err(...) — never partial plan (ERROR dim)

AC:
- All scenarios exist as executable vitest tests in packages/lore/tests/unit/core/plan-update.test.ts
- Running the file exits non-zero with every failure reason = missing module/implementation, not test bugs (`bunx vitest run ... > out 2>&1; echo $?` recorded)
- Test count ≥ 9 and asserts are behavioral (no implementation-internal spying beyond the documented probe seam)
