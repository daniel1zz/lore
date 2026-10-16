---
id: TASK-1396
type: task
role: plan
title: "main is red at 8395a3b6 on five unrelated pre-existing failures (test budgets, store CLAUDE.md eviction floor, plan-close-cascade, mirror-status-parity baseline mappings, ac-ref ambiguity, anchor-coverage ledger)"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"red-main","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"aca6553d-1bc9-4adc-affb-b5230f4346c6"}
---

Triage of main's full suite on 2026-10-16 (all reproduced at 8395a3b6 with identical assertions): (1) scripts/tests/check-test-budgets.test.ts: ledger has 2 rows for the deleted gate-hooks.bun.test.ts, 3 stale rows, 15 cases with no declared timeout. (2) claude-md-eviction-floor.test.ts: packages/lore/src/store/CLAUDE.md is 14980 bytes vs floor 14746 since 424d463b. (3) plan-close-cascade.bun.test.ts:267 deep-equals a cascade result that gained issueClose: [] in 9f6ceb46. (4) mirror-status-parity.test.ts: 149 orphan_mapping rows for docs/requirements/baseline/ (MIRROR_TYPES excludes baseline). (5) check-ac-ref-integrity: task-ac-ic-1-harness-runs-out-of-sampling-budget-under-load is filed under a PRD and AC-IC-1 is declared on two specs, so resolution is ambiguous. (6) anchor-coverage-ratchet/stale-exemption: 10 specs approved 10-10..10-15 have no code anchors and no ledger row. Each landed while main's full suite was not run; see also #227.

**Expected:** main's bun run test:vitest and test:bun exit 0
**Actual:** vitest 15 failures, bun 5 failures at 8395a3b6 and HEAD

Reported by: agent:session-c1ffea04
