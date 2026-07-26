---
id: KN-130
type: knowledge
role: knowledge
title: "Retro — SPEC-071 built under live multi-session concurrency: number race, stale-binary guard vindication, dual-suite contention"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: PRD-001
links:
  - {id: PLAN-051, type: informs}
---
## Context

While implementing SPEC-071 (execution liveness signals — the fix for multi-session collision windows), this session ran CONCURRENTLY with another session landing SPEC-068 hotfix + SPEC-069 attestation floor + SPEC-070 task-start on the same main checkout. The session therefore lived the exact problem class it was fixing. Three empirical findings worth keeping:

## Findings

1. **Spec-number races are real**: this session drafted its spec as "SPEC-069" while the concurrent session's merged work claimed 069 (and 070) in the same hours. Detected only at docs-sync time via the root CLAUDE.md index. Resolution: renumber title/slug/content to SPEC-071 but KEEP the already-recorded `AC-069-*` ids — AC ids are opaque tokens; renaming them would dangle every evidence `ac_ref` (17 entries). Evidence continuity > cosmetic consistency. Lesson: check the root CLAUDE.md Specs index AND `lore list --type spec` for the next free number at spec-create time, not at docs-sync time.
2. **The SPEC-061 stale-binary guard correctly catches concurrent merges**: two "mysterious" `bun run test` failures (stale-binary guard tripping right after a fresh `bun run build`) were NOT flaky — the concurrent session was merging source to main mid-run, making src mtimes newer than the just-built binary. The guard did exactly its job. Lesson: a guard trip that looks impossible is evidence of an unmodeled writer, not guard noise.
3. **Dual-session full-suite contention produces infra-layer exit 1 with all tests green**: vitest worker RPC "Timeout calling onTaskUpdate" (5449/5449 tests passed, exit 1, 12 concurrent test processes from two sessions). Remedy that worked: wait for `ps` test-process count to drain to 0, rebuild, rerun — attested green. Lesson: before diagnosing a full-suite failure, check for concurrent suite runs (`ps aux | grep -E "vitest|bun test"`); this generalizes the existing "serialize Playwright suites" standing lesson to ALL spawn-heavy suites.

## Accepted gaps (SPEC-071 assessment triage)

- Browser-safety of `session-actor.ts` rests on manual import review — `barrel-isolation.test.ts` pins only pinyin-pro/node-subpath reachability, not generic Node builtins. Candidate follow-up: a static import-graph test asserting the @lore/core default barrel reaches no Node builtins (assessment recommendation, deliberately not built mid-close to avoid colliding with the concurrent session's active barrel work).
- The F1 session-tier try/catch degrade (crash guard for sanitize-to-empty session ids) landed post-slice via the independent review loop rather than the planned slice — process-compliant (review finding → worktree fix → re-verify) but not pre-declared as Scope-Alt.
