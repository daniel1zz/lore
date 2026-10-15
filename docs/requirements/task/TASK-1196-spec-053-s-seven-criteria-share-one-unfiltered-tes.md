---
id: TASK-1196
type: task
role: plan
title: "spec-053's seven criteria share one unfiltered test command, so no criterion's pass is attributable to its own assertion"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"oracle-granularity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"319583d4-0ac0-4cb4-907d-0aeae79e5c1e"}
---

Found while placing review-branch criteria (W2 of plan-baseline-review-branch-migration-the-first-branch-eligible); affects citation fidelity, since a cited rule's falsifying test cannot be identified from the AC command alone.

**Expected:** Each script criterion's command selects the tests that decide that criterion (e.g. a -t filter naming the AC id), so an attested pass and a falsifier are per-criterion
**Actual:** All 7 criteria of spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review run the same three-file vitest command with no -t; a failure in any one file reds all seven and a pass proves nothing per criterion

Reported by: agent:main-orchestrator
