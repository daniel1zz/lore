---
id: TASK-1136
type: task
role: plan
title: "Merged worktrees of finished tasks are never cleaned up by lore: cleanup depends on an orchestrator remembering, and the safe predicate lives only in a user hook"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"workflow","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"86d8f798-8d2d-49fd-af2c-5eb31d520236"}
---

After a task is merged and archived, its claim-recorded worktree and branch stay on disk until someone removes them by hand. In session 6b85319e three merged, clean worktrees (agent-ac4bee199ca6bb078, agent-a6bb520b1071fce6c, agent-a48e6a74c3d718aae) stayed for hours; the orchestrator wrongly reached for --force, the user-level git-safety hook blocked it, and the work was handed to the owner although a non-force remove was safe. The safe predicate (clean tree, >=1 own commit already in main, never a zero-commit branch, quiet reflog, owning task archived) exists only in ~/.claude/hooks/pre-bash-git-safety-gate.mjs, which does not ship to consumers. Prior learnings: knowledge-git-branch-merged-lists-every-worktree-branch-that, knowledge-three-signals-said-a-peer-s-worktree-was-safe-to.

**Expected:** lore owns worktree cleanup: when a task whose claim recorded a worktree is archived (lore done), or via a sweep verb, lore removes that worktree (non-force) and deletes its branch when the predicate holds, and reports each kept worktree with the reason; it never touches a worktree no lore claim recorded
**Actual:** No lore verb or lifecycle step removes worktrees; cleanup is prose in user rules and a user-level hook, so it is skipped or done unsafely

Reported by: agent:main-orchestrator
