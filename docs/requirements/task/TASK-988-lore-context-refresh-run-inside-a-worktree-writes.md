---
id: TASK-988
type: task
role: plan
title: "lore context refresh run inside a worktree writes into the main checkout's .claude/rules"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"worktree-isolation","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0579d2eb-27e0-4e34-af80-149ad0b6d920"}
---

Observed while purging LORE_ACTOR text in plan-run-identity-slice-1-harness-attested-runs: a refresh issued from .claude/worktrees/agent-* updated files under the main checkout rather than the worktree.

**Expected:** lore context refresh writes the project-scope rules of the checkout it runs in (the worktree), so the change is committed on the task branch and reviewed with it
**Actual:** The rendered rules land in the main checkout as uncommitted edits, outside the task's branch and anchors, where a concurrent session can see or overwrite them.

Reported by: agent:session-21d0be70
