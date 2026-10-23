---
id: TASK-1637
type: task
role: plan
title: "lore evidence --capture and lore release run from a checkout other than the claimed worktree are accepted"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"evidence","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"bbaa24e9-5213-4c27-8f83-a5d177656672"}
---

No gate compares the caller's checkout with the claim's recorded worktree. checkUncommittedAttestationWorktree (task-workflow-service.ts:5602-5641) refuses only when the RECORDED worktree measures dirty; callerCwd is consulted only when the claim records no worktree (:5630). head_sha / worktree_dirty are stamped from the caller's cwd (evidence-capture.ts:335,345; git-state-stamp.ts:64-122), so an attestation can describe a different checkout than the one the claim names. Seen live: an implementer whose worktree had been auto-removed claimed, built, ran Playwright and recorded e2e evidence and release from the shared primary checkout (which this project's rules make read-only); all writes were accepted. Separate root cause from #330 (claim-time validation).

**Expected:** lore evidence --capture and lore release on a claimed task refuse (exit 4, naming both paths) when the caller's cwd does not resolve to the claim's recorded worktree.
**Actual:** From the primary checkout, with the claim recording a deleted worktree path: 'lore evidence task-repro-task --oracle other --command "echo PASS" --result pass --capture' -> Recorded ... exit 0 (attestation head_sha = primary HEAD, worktree_dirty=true, stamp_unbound_reason=dirty_tree); 'lore release task-repro-task' -> Released exit 0.
**Repro command:** `cd <primary checkout> && lore evidence <task claimed with --worktree elsewhere> --oracle other --command 'echo PASS' --result pass --capture`

Reported by: agent:session-a979eecd
