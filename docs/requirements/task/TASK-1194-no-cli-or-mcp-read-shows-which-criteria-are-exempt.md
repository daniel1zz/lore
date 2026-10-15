---
id: TASK-1194
type: task
role: plan
title: "No CLI or MCP read shows which criteria are exempted from the citation gate; lore status prints only a count"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"addressability","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"9442489e-b873-4bf4-a433-b54e7bb8634d"}
---

Found closing W2 of plan-baseline-review-branch-migration-the-first-branch-eligible. North Star property 3 (must be addressable). Workaround: a read-only sqlite query in the oracle script.

**Expected:** An exemption (spec, criterion, reason, expiry, grantor) is addressable from a read surface, e.g. lore ac list marks exempted criteria or lore ac exempt --list prints them
**Actual:** lore ac list --json omits exemption state; lore status --json shows only baseline.exemptions_active; the rows exist only in the ac_exemptions table. The review-branch bar-4 oracle had to open .lore/lore.db read-only with sqlite3 to check per-criterion coverage

Reported by: agent:main-orchestrator
