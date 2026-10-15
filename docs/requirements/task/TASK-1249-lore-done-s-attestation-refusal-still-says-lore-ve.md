---
id: TASK-1249
type: task
role: plan
title: "lore done's attestation refusal still says lore verify is the SOLE issuer of attestation, but a --capture pass carries one and clears the floor"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"stale-refusal-text","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"4b09f81c-a109-40dc-8cca-77a6b0d86996"}
---

task-workflow-service.ts:857-865 user-facing text, plus comments at :13, :225, done.ts:17-19. Measured since SPEC-143 C5 (knowledge-lore-evidence-capture-now-clears-the-attested-floor); re-found by pilot v2/v3 probes and excavation. Agents follow the refusal text and are misdirected.

**Expected:** The refusal names both routes that clear the floor (lore verify, or lore evidence --capture) and what distinguishes them
**Actual:** Refusal text: '(1) lore verify <plan> — the SOLE issuer of attestation ...'

Reported by: agent:main-orchestrator
