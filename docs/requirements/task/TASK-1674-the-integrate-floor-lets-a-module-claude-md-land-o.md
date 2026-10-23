---
id: TASK-1674
type: task
role: plan
title: "The integrate floor lets a module CLAUDE.md land over its byte ceiling"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"checks","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"63a8dd97-518a-4b91-bbd7-6cd88b95c0e9"}
---

check:memory-files (lore context refresh --check) fails only when the ROOT CLAUDE.md is over its ceiling or a lore-managed file would change. Module CLAUDE.md files have their own ceilings (lore status --check-claude-md: module max_bytes 16384), but nothing in the floor enforces them, so a merge can push one over and land; it is caught later by the turn-end review instead.

**Expected:** the floor refuses a branch whose result puts any CLAUDE.md (root or module) over its ceiling, naming the file and the byte count
**Actual:** packages/lore/src/adapters/cli/CLAUDE.md landed at 16499/16384 bytes through lore integrate (floor green); lore status --check-claude-md reports it over
**Repro command:** `lore status --check-claude-md`

Reported by: agent:session-a979eecd
