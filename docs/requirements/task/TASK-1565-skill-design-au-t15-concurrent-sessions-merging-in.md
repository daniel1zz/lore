---
id: TASK-1565
type: task
role: plan
title: "[Skill:design] AU-T15 no session edits, tests or merges in the shared main checkout — each works and integrates from its own worktree (absorbs TG-46)"
status: archived
priority: high
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: M
Approach: Root cause: several sessions use ONE shared main checkout as a workspace (edit, test, merge). Evidence:
(1) 2026-10-18 this session's in-progress merge of AU-T10 (conflict resolved, staged) was concluded by a peer's `git commit` in the same tree (e1599818, provenance repaired in 0e97fb5b);
(2) peers' uncommitted edits in the shared tree blocked merges twice (ledger);
(3) 2026-10-18 `bun run test:file` on main went red (35/35 passed, exit 1) because the repo-write guard saw a peer's uncommitted edit to packages/lore/tests/fixtures/design-necessity/end-state-spec.md (TG-46). TG-46 first fixed (3) by running tests from a private copy of the tree (merged b9d0004b), then was reverted (d45029c6): it guarded the shared-checkout invariant instead of removing its cause (design-necessity v5 class a; a peer session made the same case).
End state: no session edits, tests or merges in the shared main checkout. Every session works AND integrates from its own worktree; main advances only by a lore verb that fast-forwards (or merges under a repo-level lock in a dedicated integration worktree), so a run in one tree cannot see another session's edits by construction and no session can conclude another's merge. Measure the options, decide via ADR (the user decides if it changes their workflow), then implement; update shipped assets (worktree-dispatch, autopilot) that tell the orchestrator to merge in the main checkout.
Source: incidents 2026-10-18 (e1599818, 0e97fb5b, TG-46 b9d0004b/d45029c6); peer session lore-fd
AC: (a) two concurrent merges into main from two sessions both land with their own commits and messages; neither can conclude the other's merge (two processes); (b) a test:file run in one session's tree stays green while another session edits a tracked file in its own tree (two processes); (c) shipped assets no longer instruct merging or testing in the shared checkout.
