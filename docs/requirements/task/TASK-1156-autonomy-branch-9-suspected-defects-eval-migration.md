---
id: TASK-1156
type: task
role: plan
title: "Autonomy branch: 9 suspected defects (eval migration writes, feed silent drops, UAT and ledger)"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"autonomy","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"7313b190-9f84-4a2d-8db8-f448feb88f62"}
---

Suspected defects reported by the fast-mode excavator of this branch (plan-baseline-fast-mode-migration-of-the-remaining-9-branches), file:line under packages/lore/src unless noted. Grouped per branch in fast mode; NOT independently re-verified by the orchestrator; duplicates of #66 #67 #68 #83 #85 #86 #3 removed. Each is also recorded as an unconfirmed (suspected-defect) rule where the excavator could state it.

**Expected:** Each listed behaviour is fixed, or recorded as intended in the baseline branch named in the title
**Actual:** (1) eval migration imports into the current corpus despite its read-only claim, never secret-scans, --skip-secret-scan ignored eval/migration-coverage.ts:160-161, eval.ts:44,62; (2) eval fts uses hardcoded Lore queries fts-recall.ts:162, eval.ts:306; (3) calibration --doc-type unvalidated though its header promises exit 4 calibration.ts:15,59; (4) feed --parent unresolved is silently dropped feed-flow.ts:313; invalidated skill docs still feed rules corpus-service.ts:4487-4496; (5) gate preflight hint names a script that exists only in the Lore repo gate.ts:315; rule lookup failure swallowed :1334; (6) an invalidated UAT verdict is still read as latest corpus-service.ts:3645; (7) MCP lore_set can rewrite a UAT verdict; no writer check on edit corpus-service.ts:2400, tools.ts:414; (8) ledger edit-of-approved is two writes, not atomic as documented corpus-service.ts:2900 vs service/CLAUDE.md:14 and AC-TIER-2; (9) AC-JV-6 names a test file that never existed; stale comments ai-provider-service.ts:87,1199,1235. See also #94 (census cannot reach uat/eval subcommands).

Reported by: agent:main-orchestrator
