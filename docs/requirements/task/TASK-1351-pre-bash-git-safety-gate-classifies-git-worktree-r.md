---
id: TASK-1351
type: task
role: plan
title: "pre-bash-git-safety-gate classifies git worktree remove of a relative path as UNSAFE ('could not read the worktree status') when the shell cwd is not the repo root"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"hook-false-deny","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"27320701-8d14-46dc-b575-6e598196428c"}
---

Measured 2026-10-15: after cd into .claude/worktrees/baseline-probe, 'cd <repo> && git worktree remove .claude/worktrees/baseline-probe' and a $W-variable form were both blocked with 'could not read the worktree's status (git failed) — treat as UNSAFE', although the worktree was clean and detached at a merged commit. 'git -C <repo> worktree remove <absolute path>' went through. The gate resolves the path against its own cwd, not the command's effective cwd after cd.

**Expected:** The gate resolves the worktree path the way git will (after any leading cd / -C), so a clean, merged worktree is assessed as removable
**Actual:** Relative or variable paths after a cd are unreadable to the gate and refused as unsafe

Reported by: agent:session-66711aa8
