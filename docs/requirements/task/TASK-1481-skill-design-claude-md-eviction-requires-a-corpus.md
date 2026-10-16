---
id: TASK-1481
type: task
role: plan
title: "[Skill:design] CLAUDE.md eviction requires a corpus write a worktree implementer is refused"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-197
plan: PLAN-197
---
Estimate: M
Approach: the CLAUDE.md content contract (lore governance claude-md, How to evict) makes the author of the edit that trips the eviction floor move the block into a corpus knowledge doc in the same change, but an implementer works in a linked worktree where lore create is refused (gate:corpus-write:foreign-provenance) and --corpus-scope covers only baseline rules/cites/maps. Extend the claim lease so a task can declare the knowledge docs it will create (e.g. a corpus-scope for knowledge/reference evictions bound to the task), or let the contract name the orchestrator as the eviction writer; pick one and make the gate and the contract agree.
Source: observed 2026-10-16 in task-skill-refactor-r0-4-evict-store-claude-md-below-its-floor: the worktree agent was refused twice; the orchestrator created knowledge-evicted-from-the-store-module-doc-lazy-libsql-load from main.
AC:
- A worktree implementer holding a claim can complete a CLAUDE.md eviction (knowledge doc + pointer) without the orchestrator writing to the corpus, or the contract and the dispatch rules state the orchestrator step explicitly and the gate refusal message names it
