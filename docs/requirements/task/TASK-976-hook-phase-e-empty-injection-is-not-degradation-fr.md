---
id: TASK-976
type: task
role: plan
title: "Hook Phase E: empty injection is not degradation, framing spawned only with a payload, pass --seat-worktree"
status: archived
priority: medium
phase: "hook"
created: 2026-10-11
updated: 2026-10-12
tags: []
parent: PLAN-157
plan: PLAN-157
links:
  - {id: TASK-972, type: blocks}
---
Covers: AC-SI-3, AC-SI-7, AC-SI-12. Spec: spec-session-start-injection-carries-only-the-session-s-own D2, D6, D11, D12. Phase E: for a linked-worktree seat spawn 'lore bootstrap --injection --seat-branch <branch> --seat-worktree <realpath of git rev-parse --show-toplevel>' FIRST (the existing --seat-worktree flag, SPEC-057 D2 — now required with --seat-branch in --injection mode); the main checkout passes neither. Exit 0 + empty stdout -> no bootstrap fence, no framing line, NO degradation entry, governance bootstrap-framing NOT spawned; non-empty -> framing line then json fence (unchanged rendering); non-zero exit still degrades; oversize backstop unchanged. Remove the hook's own 'Bootstrap is hook-injected' comment (~line 93; AC-SI-3(f), AC-SI-5's grep covers assets/hooks too). New assertions only in session-bootstrap-seat-injection.test.ts (AC-SI-3) and the new compiled e2e session-start-seat-injection-hook-compiled.bun.test.ts (AC-SI-12: real hook + compiled dist/lore + throwaway git repo with a linked worktree + mkdtemp corpus, never the repo .lore/); retired assertions deleted from session-bootstrap-injection.test.ts. Run session-seat-injection.test.ts (SPEC-047 AC-047-B argv pins, BR-1019) as a regression — update only the argv expectation the new flag changes. Regenerate the assets manifest (node scripts/embed-assets-manifest.mjs). Red-first, expected-fail evidence at the red run.
