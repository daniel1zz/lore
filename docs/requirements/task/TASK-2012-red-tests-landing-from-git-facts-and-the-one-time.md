---
id: TASK-2012
type: task
role: plan
title: "Red tests: landing from git facts and the one-time back-fill"
status: archived
priority: critical
phase: "P1 Red"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-250
plan: PLAN-250
links:
  - {id: TASK-2013, type: blocks}
---
Covers: AC-ND-1, AC-ND-2, AC-ND-3, AC-ND-4, AC-ND-5, AC-ND-6, AC-ND-7, AC-ND-9, AC-ND-10
TDD-Role: red
Approach: one real git repo per case (mkdtemp, git init, a main branch, worktrees) plus a throwaway corpus (lore init; never the repo's .lore/). Name each it() with its AC id. Cases per spec: branch deleted after a clean pass at start_head; 1 commit not on main, then the same commit reachable via another branch; dirty capture; anchored task claimed without a worktree (refused) and a corpus-only no-branch claim with an unrelated dirty shared checkout (#304); a pass before a re-claim; a branch gone without a recorded end_tip; branch and worktree deleted with no release and no run-end hook (AC-ND-10); uncommitted tracked change; missing tip object; two concurrent lore done; integrate of a branch adding its own oracle file (#329); back-fill fixture with a kind-less landing and a pre-base_sha claim (#422).
Done when: each AC-ND-1..7, AC-ND-9 and AC-ND-10 command runs red; lore evidence --result expected-fail --capture per AC.
