---
id: TASK-403
type: task
role: plan
title: "The git safety gate's worktree rule matches only --force, and its header calls non-force removal safe — so it passed a removal of a LIVE peer's worktree on an unmerged branch, while the exact blocking predicate already sat one branch away at line 363"
status: archived
priority: high
created: 2026-08-02
updated: 2026-08-12
tags: []
parent: PRD-001
links:
  - {id: KN-215, type: relates-to}
---
`pre-bash-git-safety-gate.mjs` exists to stop exactly one thing: destroying a peer agent's worktree.
It was built after the "W4" incident, in which a `--force` removal blew away ~12 modified files
belonging to a peer. Its rule matches **only** when `--force`/`-f` is present, and its own header
lists `git worktree remove (no --force)` among the operations it considers SAFE.

That classification rests on a premise which is false in the one case that matters most.

## Measured 2026-08-02 by the orchestrator — the gate did not fire, and the harm happened

An orchestrator ran, with no `--force`:

    git worktree remove .claude/worktrees/agent-a3203d6e7af155a93

The gate passed it through. At that instant the branch carried **two commits not in main**
(`git branch -d` immediately afterwards refused: *"not fully merged"*), and a **live peer agent** was
working in that directory — its most recent commit was **90 seconds old** per
`git reflog show <branch> --date=iso`. The directory was deleted out from under a running agent.

Recovery was possible only by luck of timing: the tree happened to be clean (the agent had committed
seconds earlier), so nothing uncommitted existed to lose, and `git worktree add` restored it from the
branch tip. A removal 30 seconds earlier destroys uncommitted work — the precise W4 outcome the gate
was built to prevent, reached through the door the gate leaves open.

## Root cause — the predicate already exists and is simply not wired to this path

    line 418   pat: /\bgit\s+worktree\s+remove\b[^\n]*?\s(--force|-f)(?=\s|$)/
    line 363   'Assessment: worktree is clean but its branch "…" is NOT merged into <base>
                — removing loses these commit(s): …'

Line 363 is **exactly** the check that would have blocked the incident. It is already implemented,
already computes `git log <base>..<branch>`, and already renders the losing commits. It is only
reachable through the `--force` rule at line 418. Nothing needed inventing; the wiring stops one
branch short.

⛔ This is therefore NOT a "should we build a guard" question, and the standing
*"Escalation ≠ build — check whether the underlying tool already enforces the invariant"* lesson does
not apply here in the usual direction. It resolves the opposite way on measurement: git's protection
is **partial and asymmetric** — `git branch -d` refuses an unmerged branch (so COMMITS are safe), while
`git worktree remove` happily deletes a clean worktree on that same unmerged branch (so the
DIRECTORY, and any live peer using it, is not). The gate exists precisely because git's coverage has
holes; this is one of them.

## Second, independent hole — merged-ness is not liveness

Even a fully merged branch may have a live agent in its worktree, mid-run, about to commit again.
Merged-ness answers "will commits be lost", never "is someone in there". The only cheap signal that
answered correctly during the incident was branch **reflog recency**:

    git reflog show <branch> --date=iso | head -1

⛔ Do not substitute lore-side state for this. `active_sessions` was `[]` throughout (structurally
inert — see `task-active-sessions-derives-only-over-active-plans-tasks-with`), the claim lease read
1203 minutes old against a 120-minute TTL while the agent was demonstrably alive, and
`corpus.last_updated` had not moved in 20 hours because an implementer writes to git continuously and
to the corpus only at claim / evidence / release.

## Required

1. Extend the rule so **non-force** `git worktree remove` is assessed too, routing it through the
   existing line-363 predicate. Unmerged commits present → block with the losing commits listed.
2. Add a liveness component: if the branch's reflog shows activity within a recent window, warn or
   block regardless of merged-ness. Choose and justify the window — ⛔ do not silently pick one, and
   ⛔ do not make it a tunable that defaults to permissive.
3. Decide explicitly what a CLEAN + MERGED + QUIET worktree should do: staying permissive is
   defensible (it is the legitimate cleanup path CLAUDE.md mandates after merge) — but say so in the
   header rather than leaving today's blanket "no --force is safe" claim, which is now known false.
4. Correct the header's safe-operations list (line 39) and the `--force` rule's `safe:` text
   (line 420), which currently *recommends* the unguarded path: *"Legit cleanup of a merged worktree
   uses `git worktree remove` WITHOUT --force."* As written, the gate actively steers the operator
   toward the hole.

## Distribution

`assets/hooks/pre-bash-git-safety-gate.mjs` is the SSOT and it SHIPS; `~/.claude/hooks/` holds an
installed copy, verified **byte-identical** at filing time. ⛔ Fix the `assets/` copy and regenerate the
assets manifest — a fix landed only in `~/.claude/` does not exist for consumers
(`adr-distribution-first-every-improvement-names-its-consumer`). Re-assert parity after the change;
bidirectional divergence between these pairs has been observed before.

## Oracle

- **NEGATIVE (the incident, fails today)**: in a scratch repo, a worktree on a branch with ≥1 commit
  not in main, clean tree, `git worktree remove <path>` with NO `--force` → the gate BLOCKS and names
  the losing commits. Today it passes through silently.
- **NEGATIVE**: a worktree whose branch shows reflog activity inside the chosen window → blocked or
  warned, even when fully merged.
- **REGRESSION**: `--force` on a dirty worktree still blocks (the original W4 case), and its message
  is unchanged apart from item 4's correction.
- **REGRESSION (do not over-block)**: the mandated cleanup path — clean, merged, quiet — still
  succeeds, or fails with a message naming the exact override. CLAUDE.md requires this cleanup after
  every merge; a gate that blocks it trains operators to bypass the gate.
- **BOUNDARY**: a DETACHED-HEAD worktree (no branch) — the incident's sibling shape; must not crash
  and must not fail open.
- **CONTROL (anti-false-oracle)**: prove the new rule is live rather than vacuously passing — run the
  NEGATIVE case with the rule reverted and confirm it passes through, so the green is attributable to
  the rule and not to the fixture. A gate that silently stopped matching would look identical to a
  gate that never fires.
- ⛔ Consumer probe: after regenerating the manifest, verify from a FRESH `lore init` + `lore setup`
  that the installed hook carries the new rule — not merely that this repo's copy does.

## Provenance

`knowledge-three-signals-said-a-peer-s-worktree-was-safe-to` records the incident and the operator-side
lessons. That retro left "should a guard be built?" as an open question deferred to an explicit
decision; this task supersedes that framing with the measurement that the guard already exists,
already carries the predicate, and is wired only to the `--force` path.
