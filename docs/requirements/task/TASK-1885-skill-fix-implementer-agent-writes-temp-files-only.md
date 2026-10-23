---
id: TASK-1885
type: task
role: plan
title: "[Skill:fix] Implementer agent writes temp files only inside its worktree or a mktemp dir"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PRD-001
---
Twice on 2026-10-18/19 an implementer subagent wrote a temp file outside its worktree, at a mis-encoded copy of the parent session's scratchpad path (`/private/tmp/claude-501/-Users/apple-Projects-zz-lore/placeholder`, then `/private/tmp/claude-501/-Users/apple/Projects/zz/lore/<session>/scratchpad/edit_stdio.py`): the agent derived a scratchpad path it was never given and split the encoded `-Users-apple-…` segment into directories. The turn-end review caught both after the fact.

Change (shipped asset, read by every implementer at start): in `assets/agents/lore-implementer.md`, one rule in its existing working-copy/safety section: "Temporary files (scripts, logs, fixtures) go inside your own worktree under a gitignored path, or in a directory you create with `mktemp -d`; never derive or reuse a path from another session's scratchpad." Check whether the worktree has a gitignored scratch location already (e.g. `.claude/` or a `*.local` pattern in .gitignore); name the concrete one in the rule. Keep the agent definition's existing pins/tests green (grep tests for lore-implementer.md) and the assets manifest regenerated (`bun run build`). No test pins the new sentence.
