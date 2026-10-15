---
id: TASK-1322
type: task
role: plan
title: "plan-close cascade AC-097-2 is red on main: a plan with no children is not archived"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"test-red","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f32a0642-fbe0-4eeb-8715-fc2b4bbae4f5"}
---

packages/lore/tests/integration/plan-close-cascade.bun.test.ts 'AC-097-2: the plan itself is archived even when it has no children at all' fails (7 pass, 1 fail).

**Expected:** Closing a childless plan archives the plan.
**Actual:** Measured red at df34b918 (main before any change of plan-two-helper-agent-types-lore-reader-and-lore-implementer) in a detached worktree, and again on main at 93be4580.

Reported by: agent:session-3f2e7715
