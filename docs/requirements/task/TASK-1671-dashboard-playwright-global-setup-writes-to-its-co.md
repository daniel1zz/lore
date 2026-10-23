---
id: TASK-1671
type: task
role: plan
title: "Dashboard Playwright global setup writes to its corpus with no known party, so every e2e spec fails since writes require one"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"tests","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d6c08562-9767-4aaf-a293-b31327bd875c"}
---

packages/dashboard/tests/e2e global setup seeds its throwaway corpus with lore create prd (and other writes) run as a plain child process. Since spec-every-write-is-made-by-a-known-party-an-attested-agent-run landed (71801cc2), a write with no attested run and no human session is refused (BR-1351), so the setup exits 4 and every dashboard e2e spec (issues.spec.ts, issues-resolution.spec.ts, ...) fails before running.

**Expected:** the e2e setup writes as a known party (a registered human session for its throwaway checkout, or a registered run passed with --harness-run), and the specs run
**Actual:** global setup: lore create prd exits 4 — 'Every write is made by a known party ...'

Reported by: agent:session-a979eecd
