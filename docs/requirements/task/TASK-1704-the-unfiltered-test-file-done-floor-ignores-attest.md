---
id: TASK-1704
type: task
role: plan
title: "The unfiltered-test-file done floor ignores attested runs made from a verification worktree"
status: deprecated
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem: the lore done floor [unfiltered-test-file] accepts a runner-produced pass only when the command runs the test file 'from the repo root'. A verifier who follows the project rule 'never run tests in the shared checkout' must run from another worktree, e.g. --command "cd /…/.claude/worktrees/verify-x && bun run test:file <f>" --capture. Observed 2026-10-19 on task-coverage-exits-1-only-for-undeclared-commands-the-floor: seven such rows (v22-v27, exit 0, runner-attested) were all ignored and the floor still listed every anchor. The orchestrator can satisfy it only by claiming from that worktree (corpus-write foreign-provenance gate) or by running tests in the shared checkout, which the workflow forbids.

End state: the floor recognises an attested run by the file it executed and the execution root it ran in (as lore verify --execution-root does), so a run from any checkout of the landed commit counts, without parsing the command's leading cd.

AC: on a throwaway repo, a task whose test-file anchor was attested by 'lore evidence --capture' from a second worktree at the same commit passes the unfiltered-test-file floor; a filtered (-t) run from that worktree still does not.
