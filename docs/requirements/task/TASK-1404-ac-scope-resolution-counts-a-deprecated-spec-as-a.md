---
id: TASK-1404
type: task
role: plan
title: "ac_scope resolution counts a deprecated spec as a candidate, so an AC id re-declared on its successor spec becomes ambiguous"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"ac-scope-resolution","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d25faabf-6c27-4aa9-bbda-62f05cef0a16"}
---

A task filed directly under a PRD resolves its governing spec only through ac_scope. task-ac-ic-1-harness-runs-out-of-sampling-budget-under-load claims AC-IC-1, which is declared on spec-report-issue-has-no-specified-concurrency-contract-ac-072 (status deprecated) and on spec-archiving-the-work-that-resolves-a-defect-report-closes (approved). The resolver (packages/core/src/acceptance.ts:1036) treats both as candidates and fails as ambiguous, so scripts/check-ac-ref-integrity.ts exits 2 on main (scripts/tests/check-ac-ref-integrity.test.ts red at 8395a3b6 and HEAD); core :461 forbids an exemption for this case. A deprecated spec no longer governs anything.

**Expected:** ac_scope resolution ignores deprecated (and invalidated) specs; the task resolves to the single live spec declaring the id
**Actual:** ambiguous resolution between a deprecated and an approved spec; check-ac-ref-integrity exits 2
**Repro command:** `bun scripts/check-ac-ref-integrity.ts; echo $?`

Reported by: agent:session-c1ffea04
