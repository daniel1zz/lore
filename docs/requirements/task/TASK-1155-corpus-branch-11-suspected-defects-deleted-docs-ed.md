---
id: TASK-1155
type: task
role: plan
title: "Corpus branch: 11 suspected defects (deleted docs editable, empty titles, links, restore status)"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"corpus","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"32cdfe2e-8cc7-4008-9abb-0d7fc3809b7d"}
---

Suspected defects reported by the fast-mode excavator of this branch (plan-baseline-fast-mode-migration-of-the-remaining-9-branches), file:line under packages/lore/src unless noted. Grouped per branch in fast mode; NOT independently re-verified by the orchestrator; duplicates of #66 #67 #68 #83 #85 #86 #3 removed. Each is also recorded as an unconfirmed (suspected-defect) rule where the excavator could state it.

**Expected:** Each listed behaviour is fixed, or recorded as intended in the baseline branch named in the title
**Actual:** (1) deleted docs stay readable, editable and invalidatable store/sqlite-store.ts:927, corpus-service.ts:2083, validity-service.ts:420; (2) empty title accepted on edit core schemas.ts:807; (3) list with unknown --type/--status values is silently empty, exit 0 list.ts:454; (4) a second parent link keeps the old one corpus-service.ts:4701; (5) unlinking a parent leaves the doc under it :4763; (6) unlink prints Unlinked when nothing was removed unlink.ts:46; (7) self-links and links to deleted docs accepted corpus-service.ts:4618; (8) restore moves archived/deprecated docs back to draft and records the doc author, not the caller version-service.ts:244,278; (9) restore brings back old criteria bypassing criterion checks :241 (code); (10) sync-docs treats a missing folder as empty, exit 0 sync-docs-service.ts:260; (11) v1 import writes no audit entry, ignores version-write failures, file errors exit 0 migration-service.ts:372-394, migrate.ts; invalidate, restore and migrations bypass the foreign-corpus refusal (code)

Reported by: agent:main-orchestrator
