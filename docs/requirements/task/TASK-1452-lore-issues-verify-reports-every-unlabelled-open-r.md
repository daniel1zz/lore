---
id: TASK-1452
type: task
role: plan
title: "lore issues --verify reports every unlabelled open report as drift (exit 11)"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"issue-loop","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f3a8205d-f103-4f0b-85de-8dc93b019dcb"}
---

Split from #97 item 4. issues.ts:522-527; github-intake-port.ts:117. A freshly filed issue carries no label.

**Expected:** An open report with no label is not drift
**Actual:** 61 false divergences, exit 11
**Repro command:** `lore issues --verify`

Reported by: agent:session-c1ffea04
