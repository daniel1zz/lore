---
id: TASK-989
type: task
role: plan
title: "RED test tasks merged to main keep bun run typecheck red until their implement task lands"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"oracle-noise","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a708d5d9-0173-4fea-97d3-990b1d82ab36"}
---

A [Skill:test] RED task that imports a symbol its paired implement task will create merges a TS2305/TS2339 into main; every concurrent worktree's typecheck oracle then reports errors it did not cause.

**Expected:** A RED test commit on main keeps the repo's typecheck green (e.g. RED tests excluded from tsc until their implement task archives, or the RED task declares the new symbol's signature), so typecheck stays a usable oracle for concurrent sessions
**Actual:** Typecheck on main stayed red across waves in this plan; implementers had to subtract a moving baseline of known TS errors by hand.

Reported by: agent:session-21d0be70
