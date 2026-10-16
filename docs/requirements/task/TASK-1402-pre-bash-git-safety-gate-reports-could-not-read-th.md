---
id: TASK-1402
type: task
role: plan
title: "pre-bash-git-safety-gate reports 'could not read the worktree status (git failed)' for git worktree remove $VAR, because it parses the literal segment and never expands shell variables"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"output-contract","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"98fdbc8b-63d5-44f6-99ad-dcc31f419e1f"}
---

The gate evaluates the command text statically. For 'W=/abs/path; git worktree remove $W' it tries to read the status of the literal string '$W', fails, and blocks with the reason 'could not read the worktree's status (git failed) — treat as UNSAFE'. Blocking an unresolvable path is the right fail-safe, but the stated reason is wrong: git did not fail on the worktree, the gate could not resolve the path. The author is sent to check a worktree that is in fact clean, merged and unoccupied (lore worktree check said removable).

**Expected:** When a worktree-remove path contains a shell expansion the gate cannot resolve, it still blocks but says so: 'path contains a shell variable/expansion the gate cannot resolve — pass the literal absolute path'
**Actual:** Segment 'git worktree remove $W 2>&1' blocked with 'Assessment: could not read the worktree's status (git failed) — treat as UNSAFE'; the same removal with the literal absolute path passed

Reported by: agent:session-2f964849
