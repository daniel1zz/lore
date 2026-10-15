---
id: TASK-1186
type: task
role: plan
title: "lore review <doc> --pending silently ignores the named document and reviews the whole queue"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"cli-usage","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"694e25c5-b1bc-4b79-819b-f114bedd609a"}
---

Found by the W5 probe author of plan-baseline-review-branch-migration-the-first-branch-eligible; not fixed there.

**Expected:** Naming a document together with --pending is a usage error (exit 2), or reviews only that document
**Actual:** lore review <doc> --pending reviews the pending queue and drops the positional argument without a message

Reported by: agent:main-orchestrator
