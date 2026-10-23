---
id: SPEC-222
type: spec
role: spec
title: "No working copy can check out main: the main-ref guard refuses it at checkout, and integrate requires the guard"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: [integrate, main-guard, worktree]
links:
  - {id: SPEC-203, type: relates-to}
---
# No working copy can check out main: the main-ref guard refuses it at checkout, and integrate requires the guard

## Overview/Goal

Extends `spec-main-advances-only-through-lore-integrate-per-session`. Today one mistaken `git worktree add <p> main` (observed 2026-10-19: an implementer's red-run worktree) blocks every session's `lore integrate` (BR-1273), and nothing refuses it when it happens: the only signal is other sessions' failed integrations, and a human or a peer session has to find the owner. Git's own one-branch-one-worktree lock does not help, because integrate keeps the shared checkout detached so that its compare-and-swap of `refs/heads/main` never stages an inverse diff in a checked-out tree.

End state: everything about `main` has one owner, the shipped `reference-transaction` hook (`assets/project/reference-transaction`, installed by `lore setup --project`).

- The hook refuses, in the `prepared` state, any transaction that points a `HEAD` at `refs/heads/main` (`ref:refs/heads/main`), in every working copy, the shared checkout included. Measured on git 2.50.1 in a throwaway repository: `git checkout main`, `git switch main`, `git symbolic-ref HEAD refs/heads/main`, `git checkout -B main` and `git worktree add <p> main` each exit 128 with `fatal: ref updates aborted by hook`, and `worktree add` creates no worktree; `git checkout --detach main` and checking out any other branch are untouched. The hook cannot tell which working copy a `worktree add` targets (it runs in the main working tree), so the rule has no shared-checkout exception; none is needed, the shared checkout is a detached view by design. Bypass is the existing marker (`LORE_INTEGRATE=1`), same named limit as BR-1247. Git floor: 2.46. Git passes symbolic-ref updates of HEAD to the `reference-transaction` hook only since the symref-transaction series by Karthik Nayak (git mailing list, March to May 2024, merged for v2.46.0, July 2024; listed in GitLab's 2.46 release notes); before it, a checkout writes HEAD outside any transaction and the hook never sees it. Evidence tier: mailing-list patch plus vendor release notes, not measured on an older git. So `lore setup --project` raises its git floor from 2.28 to 2.46, and integrate checks the same floor on every run (a downgraded git would silently drop the guard).
- `lore integrate` stops discovering the mistake and instead requires the guard: it refuses, before anything moves, when the hook in the active hooks directory is missing or is not byte-identical to the one this binary ships, naming `lore setup --project`. The worktree scan for a checked-out main and the shared-checkout detach step are deleted from integrate.
- `lore setup --project`, when it installs the hook, detaches every working copy that has main checked out (same commit, uncommitted edits and untracked files byte-identical) and names each in its receipt. After that, the state cannot recur. A repository whose main has no commit yet is refused by setup (nothing to detach at, and its first commit would leave the shared checkout on main); `lore kickoff` does not run setup, and integrate needs a born main anyway.
- Unchanged invariant, stated because the guard depends on it: integrate sets the marker only on its compare-and-swap (`integrate-service.ts`, the single `update-ref` call with `INTEGRATE_MARKER_ENV`), never on other git subprocesses, so no checkout made during an integration passes the guard.

## Scope

In:
- `assets/project/reference-transaction` and this repository's installed copy `hooks/reference-transaction` (kept byte-identical).
- `packages/lore/src/service/integrate-service.ts` (and its CLI adapter): the hook precondition replaces the worktree scan and the shared-checkout detach.
- `packages/lore/src/flows/setup-project-flow.ts`: detach-on-install with a receipt line per working copy.
- Rule change set below; criteria of `spec-main-advances-only-through-lore-integrate-per-session` that pin the removed integrate steps are reworded or retired in the same plan.

Accepted costs (chosen, not overlooked):
- A lore upgrade that changes the shipped hook stops integration until `lore setup --project` re-installs it; the refusal names that command. A guard that may lag the binary would let an older guard silently miss what the newer one refuses.
- A repository that chains its own `reference-transaction` hook is refused by the byte-identity check; such a repository must fold its logic into lore's hook upstream, not beside it.

Out:
- Authenticating the marker (BR-1247's named limit stands).
- Remote (`origin/main`) handling: unchanged.

## Acceptance Criteria

Structured criteria are on this spec (`lore ac list`). Every script criterion runs on a throwaway repository and corpus (`mkdtemp` + `git init` + `lore init`), never this checkout.


## Acceptance Criteria (structured)

- [⚑] [script] AC-MG-1: Throwaway repo with the shipped hook installed by 'lore setup --project': 'git checkout main', 'git switch main', 'git symbolic-ref HEAD refs/heads/main', 'git checkout -B main' (in a linked worktree and in the shared checkout) and 'git worktree add <p> main' each exit exactly 128 with stderr containing 'ref updates aborted by hook' and the hook's detach hint; HEAD is unchanged and 'worktree add' leaves no new entry in 'git worktree list'. 'git worktree add --detach <p> main', 'git checkout --detach main' and checking out another branch exit 0; with LORE_INTEGRATE=1 'git checkout main' exits 0.
  script: test — bun run test:file packages/lore/tests/integration/main-checkout-guard.test.ts && echo 'AC-MG-1 PASS: every way of checking out main is refused at checkout, detached and other branches are not'
  other_command=2
- [⚑] [script] AC-MG-2: Throwaway repo and corpus: with no reference-transaction hook in the active hooks directory, 'lore integrate <branch>' exits exactly 4 naming 'lore setup --project' and refs/heads/main is unchanged; with the hook differing from the shipped asset by one byte, the same; with git reported as 2.45.2 (an injected version reader), exit exactly 4 naming '2.45.2'; with the shipped hook installed on a git >= 2.46, the same branch lands (exit 0).
  script: test — bun run test:file packages/lore/tests/integration/lore-integrate-requires-guard.test.ts && echo 'AC-MG-2 PASS: integrate refuses a missing or stale guard and lands with the current one'
  other_command=3
- [⚑] [script] AC-MG-3: Throwaway repo whose shared checkout and one linked worktree each have main checked out with an uncommitted edit and an untracked file: 'lore setup --project' exits 0, afterwards both are detached at the commit main points to, every edited and untracked file is byte-identical, and the setup receipt names both working copies. With git reported as 2.45.2 (an injected version reader) setup exits exactly 4 naming '2.45.2' and 'git 2.46'; on a fresh 'git init' with no commit it exits exactly 4 naming the first commit; in both refused cases no file under the repository changes.
  script: test — bun run test:file packages/lore/tests/integration/setup-project-detaches-main.test.ts && echo 'AC-MG-3 PASS: installing the guard detaches every checkout of main without losing edits'
  other_command=2
- [⚑] [script] AC-MG-4: The repository's installed hook is byte-identical to the shipped asset, the asset refuses HEAD pointing at main (contains 'ref:refs/heads/main'), and integrate-service.ts no longer contains the checked-out-main worktree refusal ('checked out; moving').
  script: other — cmp hooks/reference-transaction assets/project/reference-transaction && grep -q 'ref:refs/heads/main' assets/project/reference-transaction && ! grep -n 'checked out; moving' packages/lore/src/service/integrate-service.ts && echo 'AC-MG-4 PASS: one guard owns main; integrate no longer scans for it'
  other_command=2
