---
id: TASK-1324
type: task
role: plan
title: "check-shipped-defaults AC-GD-1 fresh-install clause is red on main"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"test-red","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c04b6230-1b53-4a2c-97ae-799ab936f326"}
---

scripts/tests/check-shipped-defaults.test.ts 'AC-GD-1 fresh-install clause: a genuinely fresh corpus materialises 1200000 / 80000 via the REAL resolution consumers' fails.

**Expected:** The test passes on main.
**Actual:** Measured red at df34b918 (main before any change of plan-two-helper-agent-types-lore-reader-and-lore-implementer) in a detached worktree, and again on main at 93be4580.

Reported by: agent:session-3f2e7715
