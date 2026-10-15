---
id: TASK-1277
type: task
role: plan
title: "[C8] [Skill:test] rollback e2e: no baselines and no cites ⇒ byte-identical pre-slice outputs"
status: archived
priority: high
phase: "Phase C: services and surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1272, type: blocks}
---
Estimate: S
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`). QA-8
Covers: AC-BLS1-8

Scenarios (throwaway corpus via mkdtemp + lore init, compiled binary pattern of existing e2e tests):
- Control: seed a corpus (prd, spec with ACs, plan, task); capture `status --json`, `tree`, `list`, `ac list`.
- Create baseline root/branch/leaf + rules + cites; then soft-delete every baseline doc and remove every cite; capture again; assert byte-identical to control (normalising only timestamps/ids that the control also varies).
- Falsifier: emitting the `baseline` status key unconditionally turns this red.

AC:
- `bun run build` exit 0 on the branch under test before the run (the e2e drives the compiled binary).
- `ac add` output is captured in both runs too (the no-cite hint must not appear when the corpus has no baselines and no cites — otherwise record the exclusion explicitly in the test).
- `cd packages/lore && bun test tests/e2e/baseline-rollback.bun.test.ts` exit 0 on the implemented slice.
- ⛔ Never touches this repo's `.lore/`.
