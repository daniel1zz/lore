---
id: TASK-949
type: task
role: plan
title: "main red: check-ac-ref-integrity exits 2 on a dangling AC-IC-1 ref from archived task-ac-ic-1-harness-runs-out-of-sampling-budget-under-load"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"main-red","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"4756c24b-e928-481a-a039-63bc1caf9149"}
---

bun scripts/check-ac-ref-integrity.ts on main (2026-10-12, a3c29ae6+) reports 1 dangling ac_ref: task-ac-ic-1-harness-runs-out-of-sampling-budget-under-load (archived 2026-08-12) evidence carries ac_ref AC-IC-1 with no governing spec resolvable. The check passed earlier on 2026-10-12, so a recent corpus change (spec archive/invalidate or record-lock work in a concurrent session) left the reference dangling. scripts/tests/check-ac-ref-integrity.test.ts fails as a result.

**Expected:** Either the governing spec still resolves AC-IC-1, or the ref is in scripts/ac-ref-exemption-ledger.json with a reason
**Actual:** check-ac-ref-integrity exits 2 on main
**Repro command:** `bun scripts/check-ac-ref-integrity.ts`

Reported by: agent:session-e25636da
