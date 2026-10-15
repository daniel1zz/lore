---
id: TASK-1018
type: task
role: plan
title: "CLI still tells users to export LORE_ACTOR: os-fallback warning, anchor-overlap recovery hint, and ~30 --by help texts"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"stale-guidance","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"4f8d2b61-938e-4335-96e9-2a7353e44a36"}
---

Run-identity slice 1 deprecated LORE_ACTOR (D8) and purged it from shipped assets, but binary-side strings were not covered: utils.ts:668 (os-fallback warning), checkpoint-registry.ts:1341 (task-claim anchor-overlap recovery line), and the --by description on claim/release/evidence/done/verify/handoff/ac/phase/anchor/rule/baseline/etc.

**Expected:** Every user-facing string names the current identity path (agent integration supplies --harness-run; --by as an explicit claimed label) and none instructs exporting LORE_ACTOR
**Actual:** The same binary that prints 'LORE_ACTOR is deprecated' also recommends 'export LORE_ACTOR=agent:<slug>' in its fallback warning and its gate recovery hint, so an agent following lore's own output reintroduces the deprecated env var.

Reported by: agent:session-21d0be70
