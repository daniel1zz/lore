---
id: TASK-1355
type: task
role: plan
title: "Worktree under repo root resolves @lore/core from the main checkout's node_modules, so spawned-CLI tests exercise main's source"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"worktree","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"3e920180-baf8-4250-9599-1d02efa11095"}
---

A worktree at <repo>/.claude/worktrees/x has no node_modules/@lore; bun resolves @lore/core by walking up to <repo>/node_modules/@lore/core (main checkout). Integration tests that spawn 'bun run src/index.ts' therefore ran against main's core, giving a false red/green until symlinks were added by hand.

**Expected:** Worktree tests resolve the worktree's own packages
**Actual:** They resolve the main checkout's packages
**Repro command:** `cd packages/lore && bun -e 'console.log(import.meta.resolve("@lore/core"))'`

Reported by: agent:session-66711aa8
