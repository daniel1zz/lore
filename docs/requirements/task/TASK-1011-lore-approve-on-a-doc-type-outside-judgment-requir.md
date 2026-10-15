---
id: TASK-1011
type: task
role: plan
title: "lore approve on a doc type outside judgment_required_types says nothing when the latest review judgment is reject"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"silent-verdict","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"b989126a-a21b-485b-ade4-8db2499f0efa"}
---

workflow.review.judgment_required_types defaults to [spec, adr], so approving a plan never consults its review judgment. That is configured behaviour, but the approve output is silent about it: plan-run-only-write-identity-and-run-end-claim-release had a reject judgment (confidence 0.75, three findings) seconds earlier, and lore approve printed only 'Approved ... -> status: approved (v6)'. The approver has no signal that a blocking verdict exists, so an advisory verdict is indistinguishable from no verdict.

**Expected:** When the latest judgment on the current version is reject or escalate, approve still succeeds for a non-required type but prints one line naming the verdict, its confidence and the judgment id
**Actual:** approve prints only the status transition; the reject verdict is invisible at the moment of approval

Reported by: agent:session-e25636da
