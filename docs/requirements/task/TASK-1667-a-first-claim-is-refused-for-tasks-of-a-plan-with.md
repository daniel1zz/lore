---
id: TASK-1667
type: task
role: plan
title: "A first claim is refused for tasks of a plan with an integration branch: BR-1353 counts the integration branch's own commits as foreign"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"claims","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"59fefbb7-88dc-4588-bb6b-70741c7379e9"}
---

BR-1353 (landed 2026-10-20, D3b-A) refuses a task's first claim from a worktree whose HEAD carries commits not on main, exempting only the branch the claim already records. A plan with a declared integration branch (lore plan integration-branch, BR-1348) needs its sub-task worktrees to start from that integration branch, whose commits are by definition not on main yet. Observed: plan-rq-every-refusal-carries-its-rule-required-type-checked declares rq-integration (7 commits ahead of main). Its six labelling tasks cannot be claimed from a worktree cut from rq-integration. The only way to comply is to cut from main, claim, then merge rq-integration, which defeats the base check.

**Expected:** A first claim from a worktree whose commits not on main all lie on the claiming task's plan's declared integration branch is accepted; commits from any other unlanded branch are still refused.
**Actual:** The claim is refused (exit 4) naming the integration branch's commits as carried work.
**Repro command:** `lore plan integration-branch <plan> I; git worktree add w I; cd w; lore claim <task of plan> --worktree $PWD  # exit 4, BR-1353`

Reported by: agent:session-c1ffea04
