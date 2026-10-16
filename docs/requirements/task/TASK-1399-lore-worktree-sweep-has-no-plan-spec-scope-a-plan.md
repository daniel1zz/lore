---
id: TASK-1399
type: task
role: plan
title: "lore worktree sweep has no plan/spec scope: a plan's worktrees cannot be cleaned up together when the plan closes"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"worktree-lifecycle","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0ef01431-cf12-4f8a-abf8-75d6c1989b51"}
---

Claims record each task's worktree and owning run, and lore done removes the task's own worktree when removable, but there is no way to remove every worktree of one plan at plan close: sweep is repository-wide only. Worktrees whose task done ran from a different checkout, or whose removal was refused at done time, are left behind until someone runs a repo-wide sweep. Also, 'not-measured' rows for worktree directories that no longer exist (git worktree exited 128) are never pruned.

**Expected:** lore worktree sweep --plan <plan> [--apply] resolves the plan's tasks' claimed worktrees and removes exactly the removable ones; stale admin entries of missing directories are pruned or reported with the prune command
**Actual:** sweep only works repo-wide; 7 not-measured stale entries remain

Reported by: agent:session-c1ffea04
