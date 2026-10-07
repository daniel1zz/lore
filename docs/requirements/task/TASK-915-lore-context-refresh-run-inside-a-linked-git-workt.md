---
id: TASK-915
type: task
role: plan
title: "lore context refresh run inside a linked git worktree writes the MAIN checkout's .claude/rules and reads its CLAUDE.md"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"worktree-root","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"41b09b15-466d-4fa7-8572-358c46f99c47"}
---

Observed 2026-10-07 (plan-context-fragments-config-driven-layered-rule-injection, D16 task): from /Users/apple/Projects/zz/lore/.claude/worktrees/agent-a4b4ead8de11b57a3, './dist/lore context refresh' reported the main checkout's 729-line CLAUDE.md candidate and wrote .claude/rules/lore-corpus-workflow-*.md into /Users/apple/Projects/zz/lore/.claude/rules (the main checkout), not the worktree. The project root used for CLAUDE.md and rules files appears to be resolved from the corpus location (main checkout's .lore via git common dir) instead of the current worktree's top level. Under concurrent worktree agents this lets one agent mutate files in the shared main checkout and makes worktree-local verification of refresh impossible.

**Expected:** Inside a linked worktree, refresh reads and writes CLAUDE.md and .claude/rules under that worktree's own top-level (git rev-parse --show-toplevel)
**Actual:** Refresh targets the main checkout's CLAUDE.md and .claude/rules
**Repro command:** `cd <linked worktree> && ./dist/lore context refresh && ls <main checkout>/.claude/rules`

Reported by: agent:main-orchestrator
