---
id: TASK-974
type: task
role: plan
title: "lore done archives a task whose commits are not reachable from main (no merge-state check)"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"done-floor","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"83ed57c5-f79d-4154-913d-74a6d53e401f"}
---

2026-10-12: a command chain ran git merge (which stopped on a manifest conflict, merge uncommitted) and then lore done task-rs-t12-edit-hook-notice-reaches-the-model-general-agent. done archived the task (approved -> active -> archived) although its commit 1d09f4b4 was not yet on main; the merge was committed afterwards. The rules say done belongs to whoever can assert the work is in main, but done itself never checks it.

**Expected:** lore done refuses (or warns loudly) when the task's recorded branch/commits are not ancestors of main HEAD, or when the repo is mid-merge
**Actual:** done archives regardless of merge state

Reported by: agent:session-e25636da
