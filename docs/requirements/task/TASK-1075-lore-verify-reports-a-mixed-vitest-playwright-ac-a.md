---
id: TASK-1075
type: task
role: plan
title: "lore verify reports a mixed vitest + Playwright AC as inconclusive: Playwright spec files never count as executed"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"correctness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"04cd8b9b-a29f-4876-8b89-3812c659af4b"}
---

Measured 2026-10-10 on AC-P0C-8 (spec-p0-requirement-coverage-falsifying-criteria-for-the-8).

**Expected:** A Playwright spec file the command ran (reporter lists its tests) counts as executed, so a chain of vitest files and a Playwright file that all passed is an attested pass
**Actual:** Command 'cd packages/dashboard && bunx vitest run A B && bunx playwright test --config=... C' exits 0 with all tests passing, verify prints 'AC-P0C-8 inconclusive (ran 2 of 3 declared paths)'

Reported by: agent:main-orchestrator
