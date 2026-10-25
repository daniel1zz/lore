---
id: TASK-1638
type: task
role: plan
title: "lore claim --worktree accepts a value that resolves to no worktree"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"claim","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"4d07fc6d-ceff-4335-a900-daa74f193ded"}
---

claim.ts:125 passes args.worktree verbatim; task-workflow-service.ts:1609-1620 refuses only blank values and phase-workflow-service.ts:965 stores it as extra.claim.worktree. resolveClaimWorktree (worktree-cleanup.ts:441-449) is only consulted later by lore done, which then prints 'worktree: gone ... is not an absolute path; no worktree has branch ...'. A claim naming a deleted or misspelled worktree is therefore recorded as the task's working copy, and every later check keyed on it (dirty-tree attestation, done cleanup) silently measures nothing (measureWorktreeCleanliness returns not-measured-not-a-repo, task-workflow-service.ts:2194-2207). Seen live: an implementer resumed after its harness worktree was auto-removed claimed with the deleted path and was accepted. Reproduced in a throwaway repo + lore init corpus with a human session.

**Expected:** lore claim refuses (exit 4, naming the value) a --worktree that resolveClaimWorktree cannot resolve to an existing worktree of this repository (absolute path of a listed worktree, or a branch checked out in one).
**Actual:** lore claim task-repro-task --worktree /nonexistent/deleted-wt -> 'Claimed task-repro-task by tester (v2)' exit 0; --worktree not-a-branch-xyz -> 'Claimed ... (v3)' exit 0; extra.claim.worktree stores the unresolvable string.
**Repro command:** `lore claim <task> --worktree /nonexistent/deleted-wt`

Reported by: agent:session-a979eecd
