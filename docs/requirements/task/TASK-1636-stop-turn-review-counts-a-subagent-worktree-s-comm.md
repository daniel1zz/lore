---
id: TASK-1636
type: task
role: plan
title: "stop-turn-review counts a subagent worktree's committed branch as main-session source edits after the session's cwd moves into that worktree"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hooks","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"067f5e84-3680-4129-87dd-9f86f733fa3d"}
---

The main session ran a read-only 'cd <repo>/.claude/worktrees/agent-a3ede63bd92c70cd7 && grep ...' to inspect a returned lore-implementer branch, and Claude Code moved the session's primary working directory into that worktree. At turn end, stop-turn-review finding (a) reported 590 'main-session source edits' (14 files, all 'source unknown') and blocked. The worktree was clean (git status: 0 lines); every listed change is in the implementer's commits 8de16355, 6dbd98bd, 2c16c45e (19:07-19:14, before the turn started). The turn-start snapshot was taken in the shared checkout and the end tree in the subagent worktree, so the diff is the branch-vs-main diff, not the turn's edits.

**Expected:** Finding (a) measures the same working tree it snapshotted (or re-snapshots on cwd change), and counts only uncommitted edits the main session made; a clean subagent worktree contributes nothing.
**Actual:** Turn-end review: Main-session source edits (590 changed lines; allowance 3 ...): packages/core/src/session.ts (19 changed lines, source unknown) ... Source changes belong to an implementer subagent.
**Repro command:** `In the main session: cd <shared checkout>/.claude/worktrees/<returned implementer worktree> && git status --short; end the turn`

Reported by: agent:session-95a34914
