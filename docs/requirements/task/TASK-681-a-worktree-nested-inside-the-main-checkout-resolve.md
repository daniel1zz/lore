---
id: TASK-681
type: task
role: plan
title: "A worktree nested inside the main checkout resolves the LIVE corpus, so any corpus-writing test run from it pollutes the shared corpus"
status: draft
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PRD-001
---
Root cause of the mirror-churn every implementer in this session fought, isolated by the vocabulary-relocation agent: harness worktrees live at <main>/.claude/worktrees/agent-*, i.e. NESTED inside the main checkout. findLoreDbPath walks cwd upward, so from a worktree it resolves /Users/apple/Projects/zz/lore/.lore — verified: 'lore status' run from a worktree reports the live 1406-doc corpus. Consequently the export-family tests (spec-loop-e2e, mirror-*, export-docs-*) run from a worktree WRITE INTO THE LIVE TEAM CORPUS and dirty the MAIN checkout's docs/requirements/ working tree while the orchestrator is working in it.

That is why every agent this session saw the spec-loop-e2e pollution guard fire, why three of them had to park mirror churn to satisfy the evidence guard, and why one deliberately refused to run test:changed at all (its @lore/core barrel edit selected 561 files including that family) rather than corrupt the shared corpus.

⛔ The upward walk is deliberate (SPEC M4: a fresh 'git worktree add' tree needs no local .lore/). The defect is that it makes a WRITE path reach a corpus the caller does not own. Candidate fixes to weigh: refuse corpus WRITES when the resolved corpus lives outside the cwd's own git worktree unless an explicit opt-in is passed; or have the test harness provision a throwaway corpus per worktree. ⛔ Do not 'fix' it by making the tests skip — the tests are correct, the resolution is what surprises.
