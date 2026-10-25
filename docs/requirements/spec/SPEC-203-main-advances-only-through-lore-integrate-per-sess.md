---
id: SPEC-203
type: spec
role: spec
title: "Main advances only through lore integrate: per-session integration worktrees, CAS ref update, hook-enforced"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-19
tags: []
---
## Overview/Goal

Implements adr-main-advances-only-by-lore-integrate-per-session (accepted 2026-10-18, option A chosen by the user). Several sessions share one main checkout today and edit, test and merge there; measured failures: a peer's `git commit` concluded another session's in-progress merge (e1599818), uncommitted peer edits blocked merges, and a peer's uncommitted edit turned a green test run red (TG-46, reverted d45029c6). End state: no session edits tracked files, runs tests or merges in the shared checkout; each session integrates from its own detached integration worktree; main moves only through `lore integrate`, by a compare-and-swap ref update that git itself refuses when main moved underneath.

## Scope

In scope:
1. `lore integrate <branch>|origin/main`: merge onto current main in the session's integration worktree, run the post-merge floor (`bun run check:static` in this repo; the floor command is project config), advance refs/heads/main by CAS; at most 3 attempts per call, exit 75 after the third lost race (nothing half-done); conflicts exit 4 naming paths, worktree reset; a re-run after a crash past the CAS is a no-op (merge-base --is-ancestor).
2. A reference-transaction hook installed by `lore setup` refusing any update of refs/heads/main not made by `lore integrate` (git >= 2.28, refused loudly below).
3. The first integrate detaches a shared checkout that is on branch main (same commit; edits kept).
4. `lore status` lists branches that lost races with their loss counts.
5. Shipped asset text (worktree-dispatch, autopilot, project rule) tells orchestrators to integrate with `lore integrate` and never to edit, test or merge in the shared checkout; lore corpus commands keep running there (corpus home).

Out of scope: pushing to origin (unchanged); fairness tickets.

## Acceptance Criteria

AC-INT-1..3 (`lore ac add`).


## Acceptance Criteria (structured)

- [⚑] [script] AC-INT-1: CONCURRENT INTEGRATIONS KEEP THEIR OWN COMMITS AND NEVER LEAVE A HALF STATE. Throwaway repo with real git worktrees: (1) two processes integrate two branches at once: both land on main as their own merge commits with their own messages, neither concludes the other's merge, the loser prints a lost race and its retry; (2) four concurrent integrators: each lands or exits exactly 75 naming the integrations that moved main, main contains exactly the landed merges, and the loss count each printed is recorded; (3) a crash simulated after the CAS: re-running integrate is a no-op (exit 0, main unchanged); (4) a failing post-merge floor: exit 1, main unchanged; (5) after a branch's integrate exits 75, lore status lists that branch with its consecutive loss count (also in --json), and the entry disappears once the branch lands.
  script: test — bunx --bun vitest run packages/lore/tests/integration/lore-integrate.test.ts -t 'AC-INT-1' && echo 'AC-INT-1 PASS: concurrent integrations land as their own merges; lost races retry at most 3 times; nothing half-done'
  other_command=1
- [·] [script] AC-INT-2: CONFLICTS AND FOREIGN MOVES OF MAIN ARE REFUSED. Throwaway repo: (1) a conflicting branch: integrate exits exactly 4 naming the conflicting paths; main, the branch and every worktree's files are unchanged; after main is merged into the branch and committed in the branch's worktree, integrate lands it; (2) with the hook installed by lore setup, git update-ref refs/heads/main and a commit on branch main made outside integrate are refused (output contains 'ref updates aborted by hook') and main is unchanged; (3) integrate origin/main from a bare remote fast-forwards local main by the same CAS. (Former item (4), the first integrate detaching a shared checkout on main, moved to setup: spec-no-working-copy-can-check-out-main-the-main-ref-guard AC-MG-3.)
  script: test — bunx --bun vitest run packages/lore/tests/integration/lore-integrate.test.ts -t 'AC-INT-2' && echo 'AC-INT-2 PASS: conflicts exit 4 with nothing changed; main moves only through integrate'
  other_command=9
- [⚑] [script] AC-INT-3: A SESSION'S TEST RUN NEVER SEES ANOTHER SESSION'S EDITS, AND THE SHIPPED WORKFLOW SAYS SO. (1) Two processes: a bun run test:file run in session A's worktree exits 0 while process B edits a tracked file in the shared checkout during the run (the TG-46 case, now impossible by construction); (2) lore setup into a throwaway HOME installs worktree-dispatch, the autopilot skill and the project rule text that name lore integrate as the only way to land a branch and contain no instruction to run git merge, tests or file edits in the shared checkout (literal scan of the installed files: zero 'git merge <branch> --no-ff' occurrences).
  script: test — bunx --bun vitest run packages/lore/tests/integration/lore-integrate.test.ts -t 'AC-INT-3' && echo 'AC-INT-3 PASS: test runs are isolated per session worktree; shipped workflow integrates only through lore integrate'
