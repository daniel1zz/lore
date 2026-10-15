---
id: TASK-1268
type: task
role: plan
title: "A deterministic review rejection stays binding on a version after the defect is fixed by a write that does not bump the version (lore link --type parent), so a later approve judgment on that same version cannot unblock lore approve"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"judgment-staleness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"86f61c7d-c273-48b9-b287-2642bd69c559"}
---

lore link changes parent_id without logging a version; the review-judgment gate then sees both the earlier JUDGMENT_REJECTED (parent_contract fail) and the later approve for v1 and keeps refusing.

**Expected:** Either linking a parent bumps the version, or the newest judgment for the current version decides; an approve judgment issued after the fix unblocks lore approve
**Actual:** ADR v1: review -> reject (no parent); lore link <adr> <prd> --type parent; review -> approve 0.74, all checks pass; lore approve -> exit 4 JUDGMENT_REJECTED. Repro: create adr without parent, lore review, lore link --type parent, lore review, lore approve.

Reported by: agent:main-orchestrator
