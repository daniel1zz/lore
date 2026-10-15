---
id: TASK-959
type: task
role: plan
title: "baseline-remove-a-seat holds code-measured, uncited rules (BR-375, BR-377, BR-378) at unconfirmed where BR-623 says observed"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"baseline","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"cdf9140e-13ba-4eb4-aeb9-def97cd9cd77"}
---

lore review of baseline-remove-a-seat escalates repeatedly (2026-10-12, v113-v121) on a pre-existing point: the leaf says BR-375/377/378 match the code as read on 2026-10-09 and no criterion cites them, which under the parent's confidence method BR-623 is the 'observed' tier, yet they are held at 'unconfirmed'. Either the tier is wrong or method v2 supersedes BR-623 for this branch and the leaf should say so. Unrelated to BR-1070/BR-1079; it blocks every approval of this leaf.

**Expected:** Each rule's confidence follows the branch's stated method, or the leaf names the method that overrides BR-623
**Actual:** Three code-measured uncited rules held at unconfirmed; review escalates on every revision

Reported by: agent:session-cb37af5d
