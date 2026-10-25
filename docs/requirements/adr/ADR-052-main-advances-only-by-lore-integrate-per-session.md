---
id: ADR-052
type: adr
role: decision
title: "Main advances only by lore integrate: per-session integration worktree, compare-and-swap fast-forward, the shared checkout is a read-only view"
status: approved
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PRD-001
links:
  - {id: TASK-1565, type: relates-to}
---
## Context

Several Claude sessions share ONE main checkout (/Users/apple/Projects/zz/lore): they edit, run tests and `git merge <agent-branch> --no-ff` there, while implementers work in .claude/worktrees/agent-*. One index and one working tree shared by N writers produced three incidents on 2026-10-18 (task-skill-design-au-t15-concurrent-sessions-merging-in-one): a peer's `git commit` concluded this session's staged merge (e1599818); peers' uncommitted edits blocked merges twice; a peer's uncommitted edit turned a `test:file` run red (TG-46, reverted in d45029c6 because it guarded the symptom). North Star: many concurrent sessions, unattended — an answer that relies on exclusivity is a refusal of the target state. Shipped text that causes it: assets/context/worktree-dispatch.md (line 10), .claude/rules/lore-worktree-dispatch.md (line 5), assets/skills/lore-autopilot/SKILL.md Phase 4 step 1 ("Merge immediately — git merge <branch> --no-ff", run in the orchestrator's cwd = the main checkout).

## Measured facts (throwaway repos, git 2.50.1, Apple Git-155, 2026-10-18)

| # | Experiment | Result |
|---|---|---|
| E1 | `git branch -f main s1` while main is checked out in the shared checkout | refused: `fatal: cannot force update the branch 'main' used by worktree at '.../repo'` (128) |
| E2 | `git fetch . s1:main` | refused: `fatal: refusing to fetch into branch 'refs/heads/main' checked out at '.../repo'` (128) |
| E3 | `git update-ref refs/heads/main NEW OLD` while main is checked out in the shared checkout | ACCEPTED (exit 0), no warning; the shared checkout's `git status` then shows `D  g` staged — the inverse of the landed change. A commit there would revert it. |
| E4 | `update-ref` with a stale old value | refused: `cannot lock ref 'refs/heads/main': is at 17169e2… but expected 2d09886…` (128) — a real compare-and-swap |
| E5 | shared checkout DETACHED at main; main moved by update-ref | view untouched (status clean, HEAD old); `git checkout --detach main` refreshes it (exit 0) |
| E5b | refresh with a dirty edit to a file the new main changes | `checkout` refuses: `Your local changes … would be overwritten` (exit 1); nothing lost |
| E6 | `git push . s1:main` (main checked out on branch) | default: `[remote rejected] (branch is currently checked out)`; with `receive.denyCurrentBranch=updateInstead`: lands and updates the tree, but a dirty shared tree refuses it `(Working directory has unstaged changes)` — couples main's progress to peers' dirt again |
| E7 | `reference-transaction` hook (state `prepared`) refusing `refs/heads/main` unless `LORE_INTEGRATE` is set | plain `update-ref` → `fatal: ref updates aborted by hook` (128); `git commit` on branch main → same refusal (128); marked update-ref → exit 0. Note: the hook must ignore no-op rows (old==new) — `git reset` emitted one |
| E8 | two processes, two integration worktrees, each `checkout --detach main; merge --no-ff agentN; sleep (floor); update-ref main HEAD base`, started together | `agent2 landed after 1 tries` / `agent1 CAS lost: … is at 240c150` / `agent1 landed after 2 tries`; main = `merge(agent1)` over `merge(agent2)`, each with its own commit and message; `git branch --merged main` lists agent1 and agent2 (lore done's precondition holds) |
| E9 | lock ref `git update-ref refs/lore/merge-lock HEAD 000…0` twice | 1st exit 0; 2nd `reference already exists` (128). Releasing it with `git update-ref -d` typed by an agent is REFUSED by the shipped git-safety gate (`git update-ref -d deletes a ref`) — only a lore verb could release it |

Cost per merge on a full clone of this repo (5207 tracked files, .git 97M):

| Step | Time |
|---|---|
| `git worktree add --detach` (first / second) | 0.94 s / 1.33 s |
| `bun install` in a fresh worktree (cold / warm) | 1.96 s / 0.12 s |
| `git fetch` (local) | 0.07 s |
| `git checkout --detach main` | 0.07 s |
| `git merge --no-ff` (real merge) | 0.11 s |
| `git update-ref` CAS | 0.03 s |
| post-merge floor `bun run check:static` | 109.9 s (build 11.5, typecheck 69.3, checks ~25); warm rerun: typecheck 68.1, build 9.5 — no incremental gain |

Git mechanics cost < 0.3 s; the floor (~110 s) is the whole cost and is the window in which another integration can move main. Corpus-dependent checks read the repository's one corpus at its specified location: a linked worktree resolves `.lore` beside the git common dir (spec-corpus-resolution-carries-provenance-and-a-foreign-write §M4, product semantics — the corpus is untracked, per-repository state, not part of any tree, so the detached view's age does not affect it). Reads from the integration worktree are therefore the same corpus every session sees; corpus WRITES from a linked worktree stay refused by the foreign-write guard (BR-802/BR-1242), see Corpus home below.

## Options

### A. Per-session integration worktree + CAS fast-forward of main (`lore integrate`)
Each session owns a lore-created, detached integration worktree (.claude/worktrees/integrate-<session>, created on first use: ~1 s + ~2 s install). `lore integrate <branch>…`: checkout --detach main (base), merge --no-ff each branch with the task slug in the message, run the floor, `update-ref refs/heads/main HEAD <base>` under LORE_INTEGRATE; on CAS loss redo from the new main (merge + floor again). Conflicts surface in the session's own worktree, where the session resolves them.
- Correctness, two sessions: separate index and tree per integration (no one can conclude another's merge); git's ref lock + old-value check refuses a lost race (E4, E8); a lore-installed reference-transaction hook refuses every other move of main, including a commit on branch main anywhere (E7).
- Main checkout: kept DETACHED at main as a read-only view, refreshed by `lore integrate` after a successful CAS with `checkout --detach main` only when clean (E5/E5b); never left on branch main, because a ref move under it stages the inverse diff (E3).
- Cost: ~110 s per attempt; a CAS loss repeats one floor. Contention estimate (not measured beyond 2 processes): with K sessions each integrating every T, P(loss) ≈ 1 − exp(−(K−1)·110 s / T); K=4, T=10 min → ~0.42.
- Crash: before CAS, main is untouched and the next run resets its own detached worktree (it holds nothing not in refs); after CAS, re-run is a no-op (`merge-base --is-ancestor`). No lock can go stale.
- Hooks: needs no agent-typed destructive git; pre-push unchanged (pushing to origin stays separate); `lore done` unchanged (`git branch --merged main`, E8).
- Human sees: main checkout at the latest main (or a "view stale: dirty" line from integrate); merge commits named per task.

### B. Repo-level merge lock + one shared integration worktree
- Correctness rests on every session honouring the lock; the one shared integration worktree reproduces today's failure in miniature for any actor that skips it — exclusivity, which the North Star rejects.
- Cost: same floor, held under the lock: throughput ≤ 1 merge/110 s, waiting replaces retrying.
- Crash: a dead holder leaves the lock ref (E9) and a half-merged shared tree; recovery needs liveness proof of the holder (process-reap class) plus a reset of a tree another session last wrote (irreversible-local, escalates under adr-autonomy-is-decided-by-measured-facts-one-decision-function). Agent-typed release is gate-refused (E9).

### C. Merge queue with one lore-owned integrator process
- Correctness: one writer to main by construction.
- Cost: no wasted floors; but a daemon lifecycle (who starts it, supervision, queue persistence) and a non-LLM integrator cannot resolve conflicts — it must bounce them back to the enqueuing session, which then needs its own worktree anyway (A's machinery plus a daemon).
- Crash: queue stalls until restarted; unattended operation needs a supervisor.

| | A CAS per session | B lock + shared worktree | C queue + integrator |
|---|---|---|---|
| What refuses the violation | git ref lock (E4) + ref-transaction hook (E7) | lock convention | single writer |
| Relies on exclusivity | no | yes | yes (one process) |
| Per-merge cost | ~110 s, ×(1+losses) | ~110 s + wait | ~110 s + wait |
| Crash residue | own detached worktree only | stale lock + dirty shared tree | stalled queue |
| New moving parts | 1 verb + 1 hook | verb + lock + lease | daemon + queue + bounce path |
| Conflict resolution | in the session's own worktree | in a shared tree under lock | bounced back |

## Recommendation (draft — the user decides)
Option A. It needs no exclusivity, every refusal is git's own (CAS, hook), crash leaves nothing shared, and the measured git overhead is < 0.3 s. Accepted cost: a lost race repeats one ~110 s floor.

**Retry bound.** One `lore integrate` call makes at most 3 attempts (merge onto the current main, floor, CAS). Each lost CAS proves another integration landed, so the system as a whole always progresses (lock-free); only one session can lose repeatedly. On the third loss the call exits 75 (EX_TEMPFAIL) printing `integrate: lost 3 races; main moved by <shas>`, leaves the branch and main untouched and its integration worktree reset to main — nothing half-done. The caller (or the next round) re-runs it; a branch that stays un-integrated is listed by `lore status` with its loss count, so starvation is visible, never silent. The implementation AC measures K=4 concurrent integrators (not only the 2 measured here) and records the observed loss rate.

**Conflicts.** `lore integrate` never resolves conflicts in the integration worktree. On a conflicting merge it exits 4 naming the conflicting paths and resets its worktree to main. The session resolves where its work lives: it merges main into its own branch in its own worktree, commits the resolution, and re-runs `lore integrate`; the resolution is a commit on the branch, so it survives any number of lost races and is never redone.

**Upstream.** Commits from other machines or people enter local main through the same verb: `lore integrate origin/main` fetches, then fast-forwards (or merges, with the same floor) and advances main by the same CAS. The hook therefore refuses `git pull`/`merge` on main by design — there is one path that moves main, inbound or local. Pushing to origin stays a separate step, unchanged.

**Installation and migration.** `lore setup` installs the reference-transaction hook (refusing loudly, naming the version, on git < 2.28) and the shipped asset text below. The first `lore integrate` in a repository whose shared checkout is still on branch `main` detaches it with `git checkout --detach main`: same commit, so tracked edits and untracked files stay exactly as they are (nothing is discarded, a dirty tree is fine), and from then on moving main cannot stage a reverse diff in it (E3). A view that cannot be detached (e.g. a merge in progress there) makes integrate exit 4 naming it, before anything moves.

**Corpus home.** The shared checkout stays the corpus's home: sessions keep running lore corpus commands there (`lore done`, `verify`, `evidence`, `create`, `ac`), which write `.lore`, not tracked files. What leaves the shared checkout is editing tracked files, running tests and merging — those happen only in a session's own worktree. `lore integrate` performs its git work in the integration worktree and its corpus writes (if any) through the corpus root, so the foreign-write guard needs no exception.

## Consequences
- No session edits, tests or merges in the shared main checkout; each session works in its own worktree (Claude Code worktree session, or `lore` creating .claude/worktrees/session-<id>) and integrates only through `lore integrate`.
- Main checkout is detached at main; `git switch main` there becomes pointless (the hook refuses commits on main).
- AC (a) is E8 as a test; AC (b) follows from per-session trees; AC (c) is the asset change below.
- Named limits: the LORE_INTEGRATE marker is settable by any same-user process (the hook stops accidents, not deliberate forgery — same limit as D7 of the autonomy ADR); P(loss) at K>2 is an estimate, to be measured; reference-transaction needs git ≥ 2.28.

## Asset text changes
- assets/context/worktree-dispatch.md line 10 and .claude/rules/lore-worktree-dispatch.md line 5: replace "Merge each returned branch at once with `git merge <branch> --no-ff`, task slug in the merge message." with "Integrate each returned branch at once with `lore integrate <branch>` (from your session's worktree, never the main checkout): it merges onto the latest main in your integration worktree, runs the post-merge floor and fast-forwards main; on a conflict it stops in that worktree for you to resolve."
- Same files, "Post-merge static floor" bullet: "`lore integrate` runs `bun run check:static` before main moves; do not re-run it in the main checkout."
- assets/skills/lore-autopilot/SKILL.md Phase 4 step 1: "Merge immediately — `git merge <branch> --no-ff`" → "Integrate immediately — `lore integrate <branch>`; gate every downstream step on its exit code"; remove the untracked-file-collision advice (cannot occur in a clean detached integration tree); line 90 "The full suite runs ONCE, on main" → "…ONCE, in the session's integration worktree after `lore integrate` lands".
- New rule line in both dispatch files: "Never edit, test, commit or merge in the main checkout; it is a read-only view of main."
