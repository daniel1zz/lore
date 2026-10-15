---
id: TASK-1258
type: task
role: plan
title: "A falsifier may declare expected exit code 0, and lore verify --falsify then records a runner-attested expected-fail for a check that PASSED"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"falsifier-semantics","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"da961b40-4f59-47d6-b3bb-6975896f69f9"}
---

acceptance.ts:167-172 accepts any integer (0 and negatives); verify-runner-service.ts:1965 matches observed==declared and records result expected-fail with attestation exit_code 0. Found by pilot v3 probe author (probe v3 Q6), verified on a throwaway corpus.

**Expected:** A falsifier's expected exit code must be non-zero (1-255) at declaration, and an observed 0 can never be recorded as an attested red
**Actual:** ac add --falsifier-exit-code 0 -> exit 0; verify --falsify -> 'Attested red recorded ... exit 0 (declared 0) — result:expected-fail, capture_source:runner'

Reported by: agent:main-orchestrator
