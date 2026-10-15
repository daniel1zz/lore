---
id: TASK-1286
type: task
role: plan
title: "[C5b] [Skill:implement] phase evidence path refuses caller-supplied head_sha / worktree_dirty"
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
Approach: adopt the exported `rejectCallerGitStamp` (packages/lore/src/service/task-workflow-service.ts, landed by [C5]) in `PhaseWorkflowService._addEvidenceImpl` — the parallel phase evidence path that [C5] reported unguarded.
Source: Spec `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` §C5 ("Self-reported evidence never carries them"); [C5] return concern 2.
Covers: supports AC-BLS1-4 (no forged head_sha can make a rule look fresh)
TDD: write the test first, run it red, record `--result expected-fail` on this task, then implement.

Scenarios (vitest, InMemoryStore):
- Given a phase doc, When evidence is added with a caller-supplied head_sha, Then VALIDATION_ERROR naming head_sha and no row written.
- Same for worktree_dirty; same inside capture_attestation.
- Control: evidence without those fields is accepted (guard does not refuse everything).

AC:
- `bunx vitest run packages/lore/tests/unit/service/phase-evidence-git-stamp.test.ts` exit 0 with `Tests  N passed`, N ≥ 4, after a recorded expected-fail run of the same file on this task.
- Existing phase workflow suites green; `bun run typecheck` exit 0.
