---
id: TASK-1653
type: task
role: plan
title: "Migration 028 turned rule changes already landed by a spec into pending revisions"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"baseline","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"7ecb44e3-ec03-4edc-9af6-d2199e3f9b69"}
---

Before BR-1211's change, lore rule apply wrote a spec's change set onto a leaf and demoted the leaf to draft. Migration 028 converts a draft node by taking each item's approved version from the node's last approved version and making every difference a pending revision. So rule changes that a spec's change set had already landed (reviewed and approved through the spec, BR-1211) became pending: baseline-integrate-a-branch-into-main holds BR-1346/1347/1348 (and BR-1247, BR-1273, BR-1342, BR-1343) as pending; baseline-check-a-turn-at-its-end holds BR-1349 and the retirements of BR-1147/1148/1152 as pending. Rules landed after 028 went live directly, so identical actions now have different states depending on timing, and live code cites rules the baseline reports as not live.

**Expected:** a revision whose content equals an applied entry of a spec's change set (applied_at set) is the item's approved version; only differences no landed change set accounts for become pending
**Actual:** lore rule show BR-1346 -> Document not found; the rules sit in extra.pending of their leaves
**Repro command:** `lore rule show BR-1346`

Reported by: agent:session-a979eecd
