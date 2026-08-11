---
id: TASK-559
type: task
role: plan
title: "[Skill:test] absence-as-assertion RED scenarios"
status: archived
priority: high
phase: "Phase 3: Absence-as-assertion + verification"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-111
plan: PLAN-111
links:
  - {id: TASK-563, type: blocks}
---
Estimate: S
Source: AC of the paired impl task (absence-as-assertion), spec DD-4
TDD-Role: red | Paired-Impl: reachability unknown + plan-close threading
Dimensions: D-FUNC

Scenarios — TWO files, matching the two ACs' oracle commands exactly:
A) packages/lore/tests/unit/service/checkpoint-registry.test.ts (vitest; group MUST contain "reachability unknown"):
- HAPPY: verifyReachability with planParentType undefined → unknown outcome, NOT "parent-not-spec".
- NEGATIVE: verifyReachability("prd", 0) → still "parent-not-spec" (true-negative preserved).
- BOUNDARY: verifyReachability("spec", 0) → "no-script-acs" unchanged.
- STATE: describeReachabilityWhy(unknown) output contains neither "no spec-tier ancestor" nor "zero script-mode".
B) packages/lore/tests/integration/plan-close-reachability.bun.test.ts (NEW file, bun runner):
- REGRESSION: build a throwaway corpus (mkdtemp + init; NEVER the repo .lore/) with a PRD → approved tech spec carrying >=1 script-mode AC → plan → a task with self-reported-only evidence, then attempt `lore set <plan> --status archived`; assert it denies on attestation grounds AND the stderr/pack NEVER contains "no spec-tier ancestor".

AC:
- Both files' scenarios executable; run → RED with "missing implementation" reasons (unknown outcome absent; pack still contains the false claim).
- Matched counts asserted > 0 for both AC filter commands.
