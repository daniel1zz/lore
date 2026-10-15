---
id: TASK-990
type: task
role: plan
title: "lore done floors cannot be met by the implement half of a TDD pair"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"done-floor","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"891ff4dc-2c0e-4dcd-9037-af2c131db9af"}
---

In plan-run-identity-slice-1-harness-attested-runs every [Skill:implement] task paired with a [Skill:test] RED task needed --declare-no-new-tests: the red run is recorded on the RED task, the implement task carries no expected-fail row, and the test file it greens is anchored on the other task.

**Expected:** A TDD-paired implement task closes on its own evidence when its paired RED task (blocks link) already carries an expected-fail row for the same AC scope
**Actual:** lore done refuses with 'no expected-fail evidence'; the only exit is the audited --declare-no-new-tests escape, whose reason text is unchecked prose, so the escape is used on the normal path and stops signalling anything.

Reported by: agent:session-21d0be70
