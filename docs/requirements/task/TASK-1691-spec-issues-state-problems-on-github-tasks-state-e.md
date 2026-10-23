---
id: TASK-1691
type: task
role: plan
title: "spec-issues-state-problems-on-github-tasks-state-execution: the close guidance's route separation (lore defects vs the project's own tracker) is tested but not an acceptance criterion"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"spec-coverage","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"ddddd7bd-e052-4a0a-9660-c996506795cb"}
---

The shipped close fragment (assets/context/corpus-workflow-4-close.md) separates two routes: a lore defect goes through lore report-issue to lore's repository; any other unfixed problem goes to the project's own issue tracker, never through lore report-issue. Without it, a consumer project would file its own red tests and stale ledgers into lore's upstream. packages/lore/tests/unit/context/issue-channel-guidance.test.ts asserts this as AC-IGH-1(a2), but neither AC-IGH-1 nor AC-IGH-2 states it, and BR-1153 only says 'the project's issue repository'. lore assess on plan-issues-on-github-tasks-execute-shipped-close-guidance-and (knowledge-assessment-issues-on-github-tasks-execute-shipped, verdict met 87) flagged it as a scope_fidelity gap: a test pinning wording the spec never asked for.

**Expected:** The route separation is a declared acceptance criterion of the spec, citing BR-1153, with its own falsifier. Ideally BR-1153's wording also names both routes, so the behaviour is required by the spec and not only by a test.
**Actual:** Only an extra test case enforces it; the spec's ACs and BR-1153 are silent. A later edit could delete AC-IGH-1(a2) with every declared AC still green.

Reported by: agent:session-b2737a57
