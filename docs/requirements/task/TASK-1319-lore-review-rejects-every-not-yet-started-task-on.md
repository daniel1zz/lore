---
id: TASK-1319
type: task
role: plan
title: "lore review rejects every not-yet-started task on evidence_completeness, so the pre-claim review verdict carries no signal"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"silent-verdict","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"6828bde4-ca38-454c-b28c-9048b408bd68"}
---

evidence_completeness fails for any task with no verification_evidence, including a task reviewed before it is claimed. Combined with #159 (approve says nothing about a reject verdict on types outside judgment_required_types), a genuine reject on a task is indistinguishable from this structural one.

**Expected:** Before a task is claimed, review either skips evidence_completeness (as it does for non-task docs: 'skipped, not a task doc') or reports it as not-applicable, so a reject verdict means something is actually wrong with the task.
**Actual:** 2026-10-15: lore review task-t1-agent-definitions-dispatch-hooks-setup-retirement-test and task-t2-fragment-audiences-and-skill-references (both freshly created, unclaimed) each returned 'Decision: reject (confidence: 1.00)' with the only failing check 'evidence_completeness: task has no verification_evidence entries'; lore approve then approved both with no mention of the reject.

Reported by: agent:session-3f2e7715
