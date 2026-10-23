---
id: TASK-1711
type: task
role: plan
title: "A corpus-only task with a captured pass can never be archived: evidence demands a worktree claim, done then demands a landing"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"gates","tags":["lore-done","evidence","landing"],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a844e448-9ac1-4856-9341-c65ff46a63c4"}
---

Observed 2026-10-19 (session 482f1e89) on task-retire-superseded-integrate-criteria-apply-the-main-guard, a corpus-only task (no code, no branch). Step 1: `lore evidence <task> --oracle other --result pass --command '<cmd>' --capture` from the shared checkout is refused because the claim recorded no worktree. Step 2: after `lore claim <task> --worktree <detached verification worktree>`, the pass is recorded, but `lore done <task> --declare-no-new-tests '<reason>'` is refused [floor: not-landed]. Step 3: re-claiming without --worktree does not clear it; creating a branch at main in that worktree and running `lore integrate <branch>` prints 'already integrated … nothing to do' and records no landing (the claim captured no branch while detached). The task stays open and blocks its plan's close. The same day, a corpus-only task claimed without a worktree whose pass came only from `lore verify` archived fine, so the trap opens when a pass is recorded with `lore evidence`.

**Expected:** A task whose claimed worktree never diverged from main (no tracked-file change to land) is archivable on its evidence alone; only work that changed tracked files needs a recorded landing. Evidence and done share one predicate for this.
**Actual:** Step 1: "Refused: `lore evidence --result pass` for task … — its claim recorded NO worktree, but this call is running from inside a git repository … Re-claim with `lore claim <task> --worktree \"$PWD\"`". Step 2: "Task … was claimed on …/.claude/worktrees/verify-p2b-482f and lore done archives only work whose landing lore integrate recorded: no landing is recorded on it. … [floor: not-landed]". Step 3: 'integrate: verify-p2b-482f is already integrated into main (9c8150a755db); nothing to do', and lore done refuses the same way.

Reported by: agent:session-482f1e89
