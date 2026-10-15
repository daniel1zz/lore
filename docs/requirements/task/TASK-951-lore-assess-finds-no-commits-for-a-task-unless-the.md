---
id: TASK-951
type: task
role: plan
title: "lore assess finds no commits for a task unless the merge message carries the task slug"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"tool-quirk","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"45366535-4157-4739-af1a-046244996daf"}
---

assess discovers a task's commits by slug in commit messages; a merge without the slug leaves the task's work invisible ('no discoverable commits'), measured once at 14/14 tasks (user-17 prose). Documented today only as prose in the user layer (D4 of spec-rule-store-git-tracked-fragment-selection-on-demand-skill): the prose stays until this is fixed.

**Expected:** assess finds a task's commits from its claim's branch/worktree or recorded commit range, not only message text
**Actual:** Commits are attributed only by slug text

Reported by: agent:session-e25636da
