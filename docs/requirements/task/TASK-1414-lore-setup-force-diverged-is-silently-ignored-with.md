---
id: TASK-1414
type: task
role: plan
title: "lore setup --force-diverged is silently ignored with --dry-run, --uninstall or --project"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"setup-flags","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"1b6edd34-24b9-441d-a2f7-792bc0d53aa6"}
---

Split from #101 item 2. validateSetupFlags (setup.ts:1225-1230) never sees --force-diverged; only --check rejects it.

**Expected:** exit 2, as with --check
**Actual:** ignored silently
**Repro command:** `lore setup --uninstall --force-diverged`

Reported by: agent:session-c1ffea04
