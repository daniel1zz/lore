---
id: TASK-1412
type: task
role: plan
title: "lore setup --check probes the vendor GitHub repo regardless of feedback.upstream"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"setup-check","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"b595250c-1d12-4075-8eee-3bf86e0b00d6"}
---

Split from #101 item 4. Self-acknowledged gap at setup-github-health.ts:56-62; setup.ts:1123-1125 returns exit 8.

**Expected:** The configured upstream is probed, and missing gh does not fail an in-sync check
**Actual:** Wrong repo when self-hosted; exit 8 without gh even when assets are in sync
**Repro command:** `no gh on PATH: lore setup --check`

Reported by: agent:session-c1ffea04
