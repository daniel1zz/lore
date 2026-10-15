---
id: TASK-1113
type: task
role: plan
title: "lore baseline fidelity judges a citation without the named test's code, so it cannot apply the fixed rule's second half (the test would fail if the rule were false)"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"oracle-strength","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2a09ff8e-ea29-478c-8d7d-69a6ecb2c82f"}
---

packages/lore/src/service/fidelity-sample.ts citationBody() sends the criterion statement, its verify JSON and the rule text only; CITATION_INSTRUCTIONS ask whether the criterion 'exercises or verifies' the rule. The AC-BLS2-13/14 protocol (knowledge-ac-bls2-14-re-measurement-after-105-fidelity-93-6-of) judges faithful iff the criterion asserts the rule's main claim AND its named test would fail if the rule were false, which the independent judges decided by reading the test file's assertions. A measurement from this command is therefore weaker and not comparable to the recorded 89.1% / 93.6%. Gap in my own spec (AC-BLS2-21 did not require the test code).

**Expected:** The judge input carries, per pair, the assertions of the test file(s) named by the criterion's verify command (bounded, fenced as data, omission counted), and the instructions state the two-part rule; the record says which rule version was applied
**Actual:** Judge sees criterion text + command string only

Reported by: agent:main-orchestrator
