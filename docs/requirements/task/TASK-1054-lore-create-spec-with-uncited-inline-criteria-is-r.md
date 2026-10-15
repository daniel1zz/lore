---
id: TASK-1054
type: task
role: plan
title: "lore create spec with uncited inline criteria is refused with a hint (lore ac add <slug> ... --cite) for a spec that was never created"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"correctness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2e7ff44b-a7f3-4604-b043-5db5413219e6"}
---

Found 2026-10-11 by the F8 fix (AC-FIP-5): the hint is correct for a refused ac add, not for a refused create.

**Expected:** the create refusal suggests re-running lore create spec with the criteria's --cite (or --ac ... --cite) so the create itself succeeds
**Actual:** the hint names lore ac add <slug> ..., but <slug> does not exist because the create was refused

Reported by: agent:main-orchestrator
