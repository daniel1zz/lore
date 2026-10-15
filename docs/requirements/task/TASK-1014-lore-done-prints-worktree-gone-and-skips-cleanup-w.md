---
id: TASK-1014
type: task
role: plan
title: "lore done prints 'worktree: gone' and skips cleanup when the claim recorded a branch name instead of a path; lore claim --worktree accepts any string"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"correctness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"4a9e0503-f79e-4599-b7e3-6f192839a6a4"}
---

Observed 2026-10-11 on task-core-doc-standing-table-and-resolvelock: claimed with --worktree "$(git branch --show-current)" (value worktree-agent-ac9044b9314b5f1f3, a branch name, as the user-level orchestration rule prescribes). lore done printed 'worktree: gone worktree-agent-ac9044b9314b5f1f3' while the worktree directory .claude/worktrees/agent-ac9044b9314b5f1f3 still exists and git worktree list still registers it. Cause: worktree-cleanup.ts gatherWorktreeFacts (~271) tests probe.pathExists(recorded.path) on the raw recorded value, so any non-path value reads as 'gone' (reason 'path does not exist'). lore claim --help says 'Worktree path' but the claim accepts any string, so the mismatch is only discovered at done time, silently. Related: #119 (same mechanism on lore worktree sweep), #106.

**Expected:** lore claim --worktree refuses a value that is not an existing git worktree directory (or resolves a branch name to its worktree path and records the path); lore done never reports 'gone' for a worktree git still registers.
**Actual:** Claim stores the branch name; done reports 'gone' and leaves the worktree and branch in place, so cleanup falls back to a human/hook.

Reported by: agent:session-cb37af5d
