---
id: TASK-1100
type: task
role: plan
title: "Two service-layer sites construct another service directly instead of receiving it from app.ts (RuleService -> ungated CorpusService, baseline-status -> AcExemptionService)"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"architecture","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"004e24d2-8cf1-4ab9-a768-867eeeaba657"}
---

The service module contract says composition lives in app.ts and services do not import each other. packages/lore/src/service/rule-service.ts:69 imports CorpusService and its constructor (line ~203) builds 'new CorpusService(store)' when no createDoc port is passed; that bare instance has no GateEnforcer, so baseline node creation through any RuleService built without the port is ungated. packages/lore/src/service/baseline-status.ts:259 calls 'new AcExemptionService(store).counts()' inside a status computation. Found while authoring the architecture tree standards (AC-BLS3-9).

**Expected:** Every service collaborator is injected by app.ts (or a pure store-less module is shared); no service file imports and constructs another store-holding service class.
**Actual:** rule-service.ts imports and constructs CorpusService as a construction default; baseline-status.ts constructs AcExemptionService inline.
**Repro command:** `grep -rnE '^import \{[^}]*Service[,} ]' packages/lore/src/service | grep -v 'import type' | grep 'from "./'`

Reported by: agent:arch-author
