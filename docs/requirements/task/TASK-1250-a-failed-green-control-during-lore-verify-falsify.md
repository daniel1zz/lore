---
id: TASK-1250
type: task
role: plan
title: "A failed green control during lore verify --falsify writes an evidence row labelled capture_source runner with no attestation block"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"false-label","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"515987b3-fed5-44c0-b0fc-7845732b9a21"}
---

Found by pilot-v3 excavation (agent Y, prove-a-red leaf). Root CLAUDE.md North Star names exactly this as a false label ('capture_source: runner with no attestation block is a false label'); it also contradicts live AC-CT-2's statement.

**Expected:** An inconclusive falsify run records a row whose label matches its provenance (no runner label without an attestation)
**Actual:** Row with capture_source runner and no attestation is persisted when the unmutated command already fails

Reported by: agent:main-orchestrator
