---
id: TASK-1665
type: task
role: plan
title: "Removing a leaf's command declaration is refused even when another leaf already declares that command"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"baseline","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"fa4d377d-209d-47f5-b024-fbc05f5ab758"}
---

lore baseline map <leaf> --remove-command <cmd> is refused while main's registry still has <cmd> as runnable, on the grounds that removal 'would leave the command undeclared'. The guard does not check whether another leaf declares the same command, so moving a command's declaration from one leaf to another is impossible: the new leaf declares it, but the old declaration can never be removed while the command exists.

**Expected:** removal is allowed when at least one other leaf still declares the command; refused only when it would leave the command declared by no leaf
**Actual:** lore baseline map baseline-declare-a-code-anchor --remove-command 'anchor scope' --remove-command 'anchor declare' -> 'cannot remove command declaration(s) ... main's registry still has "anchor scope", "anchor declare" as runnable. Removing them now would leave the command(s) undeclared' although baseline-claim-a-task declares both
**Repro command:** `lore baseline map baseline-declare-a-code-anchor --remove-command 'anchor scope'`

Reported by: agent:session-a979eecd
