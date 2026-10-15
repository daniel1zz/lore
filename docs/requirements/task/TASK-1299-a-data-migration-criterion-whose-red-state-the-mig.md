---
id: TASK-1299
type: task
role: plan
title: "A data-migration criterion whose red state the migration itself destroys cannot satisfy lore done's red-first floor once the red was not recorded as evidence"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"attestation-floor","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"76e81a0a-af8f-472c-a49c-6232f7793e31"}
---

plan-a-spec-carries-its-rule-changes-the-baseline-takes-them: AC-CS-5 checks the live rule registry (0 rows in lifecycle deprecated). Its red (7 rows) was measured while writing the spec, before any task existed, so it was written into the AC statement but not recorded as an expected-fail evidence row. The migration (done with lore commands) consumed the red state; lore verify then recorded the attested pass. lore done refuses: ac_scope declared with no expected-fail/fail row; there is no audited escape for this floor (only for attestation and empty scope), and no honest way to re-create the red without reverting the migration. Process lesson: create the carrying task when an AC's red is measured. Tool question: should a red measured at AC-declaration time be recordable against the spec (or the AC) so it survives until a task exists?

**Expected:** Either the red measured at declaration can be recorded as evidence before a task exists, or the floor has an audited escape naming the measured red
**Actual:** Task task-migrate-the-live-corpus-to-the-change-set-model cannot be archived; the plan cannot close

Reported by: agent:session-cb37af5d
