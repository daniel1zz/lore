---
id: TASK-1110
type: task
role: plan
title: "lore worktree sweep reports a relative or descriptive recorded worktree as gone, and silently omits worktrees whose claims predate base_sha recording"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"worktree-cleanup","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"69a5739c-0c19-4534-9930-3630728c3deb"}
---

Measured 2026-10-10 right after #106 landed: 'lore worktree sweep' printed 3 rows, all 'gone (path does not exist)', for recorded worktree values 'worktree-agent-ad35e1fa2ebd602b9' (the directory .claude/worktrees/agent-ad35e1fa2ebd602b9 exists), 'main', and '/Users/apple/Projects/zz/lore (main checkout)'. None of the ~12 agent worktrees claimed earlier today with absolute --worktree paths (before #106's merge, so without base_sha) was listed at all, although the implementer described them as not-measured.

**Expected:** A recorded value that is not an absolute path is resolved against the repo's worktree list (by branch/dir name) or reported not-measured with that reason; every claim-recorded worktree of an archived/deprecated task is listed, pre-#106 ones as not-measured (no claim-time base)
**Actual:** Relative names read as gone; pre-#106 claims omitted with no row

Reported by: agent:main-orchestrator
