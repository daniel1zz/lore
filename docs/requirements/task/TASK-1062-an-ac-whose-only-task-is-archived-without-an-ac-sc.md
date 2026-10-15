---
id: TASK-1062
type: task
role: plan
title: "An AC whose only task is archived without an ac_scope can never get a fresh attested pass"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"correctness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"97a9ac17-2f48-4aec-b7bc-c9c3b1a50b48"}
---

Measured 2026-10-11: AC-047-B (SPEC-047) needed a pass newer than a test change (eb79573f) to support raising BR-1019 to established.

**Expected:** lore verify can re-run a spec's criterion on demand (e.g. lore verify --spec <spec> --ac <id>) and record an attested row, independent of whether the original task is archived or declared a scope
**Actual:** lore verify plan-implementation-spec-047-... --task task-implement-seat-briefing-asset-worktree-aware-hook-injection -> exit 4 'has no declared ac_scope'; an archived task cannot be re-scoped, so the criterion's newest attested pass stays 2026-07-16 forever

Reported by: agent:main-orchestrator
