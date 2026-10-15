---
id: TASK-1079
type: task
role: plan
title: "An AC's attested pass keeps showing ✔ in lore ac list after its named test file no longer exists on main"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"correctness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"abbf22f8-c574-4224-8368-431407d0e270"}
---

Found by the slice 3b uncited-spec mapping (mapper B, batch ad), verified 2026-10-10.

**Expected:** lore ac list marks a script AC whose command names a test path absent from HEAD as stale / not-reproducible (count and name it), never as attested pass
**Actual:** spec-governance-weight-must-scale-with-measured-blast-radius-a AC-GRADE-4 shows '⚑✔(1/0, 1 attested)'; its command runs packages/lore/tests/integration/gate-class-totality.test.ts, which has never existed in git history (git log --all empty); running it on main exits 1. Evidence rows recorded 2026-08-26 with no execution_root.

Reported by: agent:main-orchestrator
