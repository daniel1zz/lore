---
id: TASK-953
type: task
role: plan
title: "A baseline rule decided ahead of its implementation has no honest lifecycle value; every review escalates on 'live but not built'"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"baseline","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"41273f2a-2764-4ae6-87c1-3c6a31f8e1ef"}
---

Baseline rules carry lifecycle live|deprecated|retired and enforced_by guaranteed|both|prompt-only. A rule decided at S2 for behaviour a plan will build (the batched-governance norm: the leaf is edited before the code) can only be recorded as live. lore review then escalates or rejects on every revision of the leaf: 'a rule cannot be both live and not implemented' (measured 2026-10-12 on baseline-remove-a-seat v113-v121, baseline-link-two-documents v104-v106, baseline-resolve-a-defect-report). Holding it at confidence unconfirmed with an open question is the current workaround; the judge does not accept it consistently, and switching enforced_by to prompt-only is equally flagged. Approval then depends on judge luck.

**Expected:** A rule state that says 'decided, enforcement pending <spec>' (e.g. lifecycle planned, promoted to live when its citing criteria pass), recognised by the judge and by rule impact
**Actual:** Only live is available; reviewers flag every ahead-of-implementation rule as inconsistent

Reported by: agent:session-cb37af5d
