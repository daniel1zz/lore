---
id: TASK-1651
type: task
role: plan
title: "evidence --capture records a Playwright pass but refuses a Playwright expected-fail, so a Playwright oracle can never meet red-first"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"evidence","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"7aace6d4-dcd5-4572-96d7-2eeb9eaf22d7"}
---

lore evidence --capture accepts a passing Playwright run (oracle e2e) but refuses to record a failing one: the red recorder requires a recognised runner summary (vitest Test Files/Tests pair, or bun test Ran N tests across M files) and Playwright output has none it recognises. The recorder is asymmetric, so a task whose oracle is a Playwright spec cannot satisfy the red-first floor of lore done.

**Expected:** Playwright's own summary lines (N passed / N failed) are recognised for both pass and expected-fail captures
**Actual:** capture refused: the stored output tail carries no runner summary this check recognises; Playwright output cannot be captured as a red

Reported by: agent:session-a979eecd
