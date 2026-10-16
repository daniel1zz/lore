---
id: TASK-1362
type: task
role: plan
title: "A pass evidence row that was later disproved cannot be retracted, so it keeps counting toward its AC's pass total"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"silent-verdict","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"09ec4ac8-0e25-4b75-8756-93746bf9fd2a"}
---

Only a fail can be superseded (fail_superseded by a newer attested pass). There is no way to mark a self-reported pass as refuted; coverage counts it forever, so the corpus overstates an AC's support.

**Expected:** lore evidence can record that an earlier pass row on an AC was refuted (naming the refuting assessment or evidence), and coverage/assess render it as refuted, not as a pass.
**Actual:** 2026-10-16: task-reword-the-ten-always-loaded-fragments-to-the-rule-only carries a manual AC-RW-5 pass (v26) that knowledge-assessment-always-loaded-lore-fragments-state-the (score 65) disproved; the correction could only be recorded as a new expected-fail row on a different task. Assessment -5 still counts it: 'still counts in the AC-RW-5 pass total (3 pass, 1 attested)'.

Reported by: agent:session-3f2e7715
