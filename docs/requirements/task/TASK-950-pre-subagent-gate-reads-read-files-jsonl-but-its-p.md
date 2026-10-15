---
id: TASK-950
type: task
role: plan
title: "pre-subagent-gate reads read-files.jsonl but its producer post-read-mark is not shipped, so every main-agent edit is reported as 'file not Read this turn'"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hook-state","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2e19c393-efb2-4f75-bdf8-fc8b3b400a7c"}
---

assets/hooks/pre-subagent-gate.mjs decides the 3-line exemption from <turn>/read-files.jsonl. No shipped hook writes that file: post-read-mark exists only outside assets/ and is not in HOOK_REGISTRATIONS (noted by task-gh-1343388703-156 and task-rs-t12). Measured 2026-10-12: an Edit right after a Read in the same turn got the notice 'Reason: file not Read this turn'. Same class as #156 (consumer shipped without its producer); the #156 pairing test covers only stop-doc-sync.

**Expected:** The producer of every state file a shipped hook reads is shipped and registered, and the producer/consumer pairing test covers pre-subagent-gate too
**Actual:** The exemption can never apply; the notice misstates the reason

Reported by: agent:session-e25636da
