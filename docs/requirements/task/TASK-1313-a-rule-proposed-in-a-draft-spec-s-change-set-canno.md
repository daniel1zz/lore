---
id: TASK-1313
type: task
role: plan
title: "A rule proposed in a draft spec's change set cannot be corrected or withdrawn before it lands"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"rule-change-set","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"ba74dbf5-a357-4099-b2d9-8dce88029fd9"}
---

Measured 2026-10-15 on spec-interception-moves-off-every-tool-call-one-turn-end-review: review found BR-1089 (proposed add) ambiguous. lore rule set BR-1089 -> 'Document not found: BR-1089'; lore rule propose <spec> modify BR-1089 -> 'a modify names a LIVE rule: BR-1089 is proposed by <spec> and not in the baseline yet'; lore rule changes has no edit or withdraw; there is no lore rule propose ... withdraw. The only routes are landing the wrong text and fixing it after apply, or proposing a duplicate add that also lands.

**Expected:** While the spec is draft, its own proposed add can be restated (statement/examples/enforced-by) or withdrawn, versioned on the spec like any change-set entry
**Actual:** No command edits or withdraws a proposed rule; review findings on a proposed statement can only be fixed after the rule is live
**Repro command:** `lore rule propose <draft-spec> add --leaf <leaf> --statement x --enforced-by guaranteed; lore rule propose <draft-spec> modify <the reserved BR-n> --statement y`

Reported by: agent:session-66711aa8
