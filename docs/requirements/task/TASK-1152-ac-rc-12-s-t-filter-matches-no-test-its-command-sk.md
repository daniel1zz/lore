---
id: TASK-1152
type: task
role: plan
title: "AC-RC-12's -t filter matches no test: its command skips all 74 tests and exits 0, so the criterion always passes"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"false-oracle","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"6b3a98f2-69f7-4a02-8bee-6e00f262b868"}
---

Found by a fidelity judge in the fast-mode remediation (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1) and re-run by the orchestrator. Its BR-363 citation is removed in R1. Also check whether any attested pass exists for AC-RC-12 and why the zero-match guard did not refuse it.

**Expected:** AC-RC-12's verify command runs at least one test that asserts 'multi-actor exits zero', and an all-skipped run is refused as evidence (SPEC-061 zero-match guard)
**Actual:** Measured on main 2026-10-09: 'bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "multi-actor exits zero"' -> exit 0, 'Tests 74 skipped (74)', 'Test Files 1 skipped'. The criterion is on spec-resume-ticket-coverage-a-shipped-upper-bound-left-the and is cited by baseline rule BR-363 (session branch)

Reported by: agent:main-orchestrator
