---
id: TASK-1400
type: task
role: plan
title: "lore worktree sweep marks a worktree an agent is actively using as removable"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"worktree-occupancy","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c835aaf1-3cf1-476a-a77c-625422596c26"}
---

On 2026-10-16 'lore worktree sweep' (report mode) listed /private/tmp/.../scratchpad/wt.slzs as removable while a lore-reader subagent of the live session was running baseline tests in it (a detached worktree it created via git worktree add). The occupancy clauses (owning run / open claim / process cwd / live session) did not see it: the worktree has no claim, the agent's shell cwd is reset between calls, and the session owner is not recorded for a detached worktree. 'sweep --apply' at that moment would have deleted a worktree in use.

**Expected:** A worktree created by a live session's agent is keep (occupied) until that session or run ends, even without a claim or a process whose cwd is inside it
**Actual:** verdict removable for an in-use detached worktree
**Repro command:** `lore worktree sweep  # while a subagent works in a detached worktree it created`

Reported by: agent:session-c1ffea04
