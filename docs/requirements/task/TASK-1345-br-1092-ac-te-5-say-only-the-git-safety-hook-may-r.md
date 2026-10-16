---
id: TASK-1345
type: task
role: plan
title: "Repo-only hooks (pre-no-general-agent-gate, pre-dispatch-isolation-gate) ship to consumers as managed hooks but are never registered"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"rule-wording","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"16052fd4-aa6a-40d3-96e5-a1e6461a0640"}
---

Raised by lore assess on plan-interception-moves-off-every-tool-call-turn-end-review-and (2026-10-15). distribution-hooks.ts:15,149 says these two orchestration-policy hooks are deliberately not registered, but the files are in assets/hooks and the embedded manifest, so lore setup installs them into every consumer's hooks dir unwired. AC-TE-5's scan covers registered hooks only.

**Expected:** Either the two files leave the shipped asset set (they are this repo's orchestration policy) or BR-1092 names them as the registered-only exception; AC-TE-5 asserts whichever is chosen
**Actual:** Shipped-but-unregistered deny hooks sit outside the rule's wording and the AC's scan

Reported by: agent:session-66711aa8
