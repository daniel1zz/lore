---
id: TASK-1369
type: task
role: plan
title: "lore context refresh run inside a linked worktree writes the project rules files into the MAIN checkout"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"data-integrity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"879e07a6-dbfe-4f53-a6a2-2122f0bd804a"}
---

Project-scope refresh resolves the project root to the main checkout (not the worktree it runs in), so it overwrites the shared checkout's .claude/rules/lore-*.md with the worktree's fragment render and leaves the worktree's own rules files stale; repo-local .lore/context fragments are rendered from main's copy.

**Expected:** From a linked worktree, refresh writes only inside that worktree (its .claude/rules and CLAUDE.md), rendering its own assets/context and .lore/context.
**Actual:** 2026-10-15, task-reword-the-ten-always-loaded-fragments-to-the-rule-only: ./dist/lore context refresh run in .claude/worktrees/agent-a75da41b6eeaa7428 wrote the regenerated rules files into /Users/apple/Projects/zz/lore/.claude/rules/; the implementer restored main from HEAD by hand (verified: main tracked-changes 0, 14328 B). Same class as #189 (worktree tests resolving the main checkout's .lore).

Reported by: agent:session-3f2e7715
