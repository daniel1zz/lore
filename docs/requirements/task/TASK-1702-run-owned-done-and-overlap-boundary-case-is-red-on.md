---
id: TASK-1702
type: task
role: plan
title: "run-owned-done-and-overlap BOUNDARY case is red on main: done is refused although the fresh claim's run has ended with a clean worktree"
status: draft
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Measured 2026-10-19 on main: 'bun run test:file packages/lore/tests/integration/run-owned-done-and-overlap.bun.test.ts' gives 1 failed, 12 passed. The failing case is 'lore done decides the holder by run (spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-3) > BOUNDARY: a fresh claim whose run has ended with a clean worktree no longer blocks another run's done': expect(done.ok).toBe(true) at line 226 receives false. The test file last changed 2026-10-18 (e3fe38ac), so a later product change broke it; the floor runs no tests, so nothing caught it. Find the commit that turned it red (git bisect over main with this one file), and fix the product or the test, whichever the governing AC (AC-ROI-3) says is wrong. Found by the D3b-A implementer while running scoped oracles.
