---
id: TASK-1242
type: task
role: plan
title: "lore evidence --capture --result expected-fail accepts any non-zero exit, so a red caused by a broken command (failed cd, grep syntax error, jq error) satisfies the red-first floor"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"false-red","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"3d2a84f6-8db7-4ff7-8de2-5768a02ce667"}
---

Measured 3 times in one session: W0a v3 (jq error), W1b v3 (grep 'parentheses not balanced'), task-skill-test-red-retire-vs-cite-race-ac-bls2-3 v3 (4 ms run, failed cd from the wrong cwd). Each was recorded as a runner-attested expected-fail and would clear lore done's red-first floor. A red must prove the TEST failed, not that the shell did.

**Expected:** For --oracle test|e2e, an expected-fail capture requires the tail to contain a recognised runner summary with >= 1 failed case (the classifier evidence-precheck already has for passes); other failures are refused or recorded as inconclusive
**Actual:** Exit code 1 from 'cd: no such file' or a jq parse error is recorded as expected-fail with capture_source runner and attestation

Reported by: agent:main-orchestrator
