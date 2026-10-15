---
id: TASK-1111
type: task
role: plan
title: "Census follows an injected property's single visible binding as the only implementation even when assignments, untyped literals or spreads could bind others, so sites can be silently omitted"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"census-honesty","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d98910c7-509f-4cce-850c-f5d60ee84995"}
---

Found by lore assess on plan-fix-104-the-site-census-follows-dependency-injected (2026-10-10): valuesBoundTo in packages/lore/src/service/site-census.ts returns opaque:false for properties while ignoring assignment writes, untyped object literals and spreads; one visible binding is then followed as THE implementation and no dynamic (not_measured) site is recorded. Same silent-incompleteness class as #94/#104.

**Expected:** Any binding form the analysis does not model (assignment, spread, untyped literal, Object.assign) makes the property opaque, producing a not_measured dynamic site
**Actual:** Followed as single implementation; no not_measured

Reported by: agent:main-orchestrator
