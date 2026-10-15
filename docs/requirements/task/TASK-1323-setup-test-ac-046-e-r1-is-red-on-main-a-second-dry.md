---
id: TASK-1323
type: task
role: plan
title: "setup.test AC-046-E.R1 is red on main: a second --dry-run right after a real install does not report every file as 'would skip'"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"test-red","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"694e5fe2-9701-4ad4-bebb-0afc8011f0ba"}
---

packages/lore/tests/integration/cli/setup.test.ts 'AC-046-E.R1: a second --dry-run right after a real install reports every file as would skip' fails; likely the same settings.json sha256 instability as #197.

**Expected:** The second dry-run after an install reports every file as would skip.
**Actual:** Measured red at df34b918 (main before any change of plan-two-helper-agent-types-lore-reader-and-lore-implementer) in a detached worktree, and again on main at 93be4580.

Reported by: agent:session-3f2e7715
