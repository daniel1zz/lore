---
id: TASK-1154
type: task
role: plan
title: "Distribution branch: 12 suspected defects (init half state, setup flags and ledgers, dashboard)"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"distribution","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d3b29e11-dff2-4483-9919-6646366f6949"}
---

Suspected defects reported by the fast-mode excavator of this branch (plan-baseline-fast-mode-migration-of-the-remaining-9-branches), file:line under packages/lore/src unless noted. Grouped per branch in fast mode; NOT independently re-verified by the orchestrator; duplicates of #66 #67 #68 #83 #85 #86 #3 removed. Each is also recorded as an unconfirmed (suspected-defect) rule where the excavator could state it.

**Expected:** Each listed behaviour is fixed, or recorded as intended in the baseline branch named in the title
**Actual:** (1) init leaves a half-made .lore on config write failure so a retry is refused; DB creation failure throws unhandled init.ts:68-94; (2) --force-diverged silently ignored outside install setup.ts:980-1001,1067-1091; (3) setup --check treats any read failure as never installed setup-check.ts:238-242; (4) health probe checks the vendor tracker, not the project-hosted one; setup --check exits 8 with assets in sync but no gh setup-github-health.ts:56-60; (5) overwrites an existing core.hooksPath, not restored on uninstall setup-project-flow.ts:1161-1182; (6) a corrupt project ledger is treated as absent while a corrupt global ledger refuses with exit 4 :548-575; (7) the setup --project rules file is not in the project ledger and survives uninstall setup.ts:576-611; (8) governance exits 4 (invalid input) when its shipped text is unreadable governance.ts:197-216; (9) local key file reused without checking the key still exists local-key.ts:61-66 vs dashboard.ts header; (10) unreadable machine config silently mounts no other projects dashboard.ts:140-142; (11) browser opener spawn failure is an unhandled async error :166-177; (12) header claims packaged mode validates --dashboard-port; code never parses it

Reported by: agent:main-orchestrator
