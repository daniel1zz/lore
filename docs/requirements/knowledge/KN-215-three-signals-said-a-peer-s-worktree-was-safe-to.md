---
id: KN-215
type: knowledge
role: knowledge
title: "Three signals said a peer's worktree was safe to remove; two could not have said otherwise, and the one that answered correctly was git reflog"
status: approved
priority: medium
created: 2026-08-02
updated: 2026-08-02
tags: []
parent: PRD-001
---
An orchestrator removed a LIVE peer agent's worktree directory. It consulted three signals first.
Two of them were structurally incapable of reporting the truth, and the third was misread. The one
signal that would have answered correctly lives outside lore entirely.

## What happened

Resuming `knowledge-handoff-agent-main-orchestrator-70`, the orchestrator found a worktree at
`.claude/worktrees/agent-a3203d6e7af155a93` on branch `worktree-agent-a3203d6e7af155a93`, judged it
abandoned, and ran `git worktree remove`. The removal succeeded. The branch's owning agent was alive
and had committed **90 seconds earlier**.

Recovery: the branch and both commits survived (`git branch -d` refused — "not fully merged"), the
worktree was restored from the branch tip with `git worktree add`, `git status` came back clean, and
`bun install` replaced the gitignored `node_modules` that removal had deleted. **No source was lost.**
That outcome was luck of timing, not of judgment: `git worktree remove` refuses a dirty tree, and the
agent had committed seconds before. A removal 30 seconds earlier destroys uncommitted work.

## The three signals

**1. `git branch --merged main` — misread, and the misreading was invited by the shell call.**
Both commands ran in ONE `Bash` invocation separated by an `echo` banner:

    git branch --merged main | cat; echo "--- ALL BRANCHES ---"; git branch -a | cat

`--merged` printed only `main`. `-a` printed `main` plus the worktree branch. Read as one visual
block, the worktree branch appeared to be under the `--merged` heading. ⛔ The mechanization is not
"read more carefully": `git branch --merged` emits a LIST whose shape is identical to every other
`git branch` listing, so its output cannot be distinguished from a neighbour's by shape alone. Use a
predicate whose output shape encodes the answer — `git log --oneline main..<branch>`, where **empty
means merged** and any line at all is a refusal. An empty result cannot be confused with a list of
branches, and it cannot be absorbed into an adjacent command's output.

**2. `active_sessions: []` — could not have been non-empty.** Derived only over tasks parented to an
ACTIVE plan; this corpus has 114 plans, all archived, and adhoc tasks are parented to the root PRD by
construction. Filed separately as
`task-active-sessions-derives-only-over-active-plans-tasks-with` — that is the mechanism root and it
carries the full measurement.

**3. `claim.at` age 1203 min vs `claim_ttl_minutes: 120` — a lease, not a heartbeat.** `claim.at` is
written once and never refreshed while an agent works, so a long-running implementer's lease reads
"stale" by an order of magnitude while it is demonstrably alive. `isClaimStale` is honest about what
it measures; the error was treating lease expiry as death. Compounding it, `corpus.last_updated`
equalled that claim's timestamp, which read as "nothing has happened in 20 hours" — but an
implementer writes to **git** continuously and to the **corpus** only at claim / evidence / release.
⛔ Corpus write recency is not agent activity, and the gap between them is exactly the duration of
the work.

## The signal that worked

    git reflog show <branch> --date=iso

It timestamped the branch's last commit at 90 seconds old and settled the question immediately. It
was only consulted because the user pushed back — "会不会是其他 Session 处理的呢？" — after the
removal. ⛔ Note what this means: a knowledge platform whose "who else is working" question is
answered by `git reflog` has ceded that question to git.

## Root cause

Two failures compounded, and either alone was survivable:

- **Signal-shape**: a merged-ness check whose output is a list, batched next to another list.
- **Liveness-by-proxy**: three lore-side quantities (`active_sessions`, claim age, corpus recency)
  were each read as liveness evidence. None of them measures liveness. Two of them cannot.

The deeper pattern is the standing one this session violated: *shared mutable state must be
re-evidenced in the turn you assert it*. It was violated in an unusual direction — not by reusing a
stale in-context snapshot, but by querying fresh values that were **structurally silent**. A
fresh-but-inert reading feels like evidence and is not. ⛔ Re-querying is necessary and not
sufficient; a field that can only say one thing has told you nothing.

## Standing lesson candidate

Before removing any worktree: merged-ness is `git log --oneline main..<branch>` **empty**, never
`git branch --merged` read beside other git output; and liveness is branch **reflog recency**, never
`active_sessions`, claim age, or corpus write recency. ⛔ CLAUDE.md is at capacity (root 24544/24576
bytes, 206/220 lines; measured this session), and
`knowledge-handoff-agent-main-orchestrator-70` NS4 forbids raising the ceiling — landing this line
requires evicting a whole standing lesson into the corpus first. Recorded here pending that trade.

## Mechanism — RESOLVED by measurement: the guard already exists, wired one branch short

This section originally posed "should a `PreToolUse` guard be built?" as an open question. Measuring
instead of speculating answered it, and in an unexpected direction: **the guard was already there.**

`assets/hooks/pre-bash-git-safety-gate.mjs` (SSOT; it SHIPS, and `~/.claude/hooks/` held a
byte-identical installed copy) exists specifically to prevent destroying a peer's worktree — built
after the "W4" incident, in which a `--force` removal blew away ~12 modified peer files. It contains,
at line 363, the exact predicate that would have blocked this incident:

    'Assessment: worktree is clean but its branch "…" is NOT merged into <base>
     — removing loses these commit(s): …'

That predicate is reachable ONLY through the rule at line 418, whose pattern requires `--force`:

    pat: /\bgit\s+worktree\s+remove\b[^\n]*?\s(--force|-f)(?=\s|$)/

The removal in this incident used no `--force`, so the gate never evaluated it. Worse, the header's
safe-operations list (line 39) names `git worktree remove (no --force)` as safe, and the `--force`
rule's own remediation text actively STEERS the operator into the hole: *"Legit cleanup of a merged
worktree uses `git worktree remove` WITHOUT --force."*

The standing lesson *"Escalation ≠ build — check whether the underlying tool already enforces the
invariant"* was applied, and it resolved the opposite way from usual: git's protection is **partial
and asymmetric**. `git branch -d` refuses an unmerged branch, so COMMITS are safe. `git worktree
remove` deletes a clean worktree on that same unmerged branch, so the DIRECTORY — and any live peer
inside it — is not. The gate exists because git's coverage has holes; this is one of them.

Filed as `task-the-git-safety-gate-s-worktree-rule-matches-only-force-and`, which carries the full
required-work list, the distribution constraint (fix `assets/`, regen manifest, re-assert parity,
probe from a fresh `lore setup`), and an anti-false-oracle control. ⛔ Note for whoever takes it: a
merged-ness check alone is still insufficient — merged-ness answers "will commits be lost", never
"is someone in there". Reflog recency is the liveness half.
