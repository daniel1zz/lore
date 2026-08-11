---
id: TASK-399
type: task
role: plan
title: "lore evidence and lore release accept an attestation from a worktree whose declared anchors are uncommitted — the corpus records a verified, unclaimed task backed by no commit"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-02
tags: []
parent: PRD-001
links:
  - {id: ADR-028, type: relates-to}
---
## Measured 2026-08-01

A dispatched implementer (T3 of `plan-implementation-assess-evidence-projection-and-absence`)
recorded SEVEN evidence rows — four of them `result=pass` with an `ac_ref`, each carrying a
real non-empty `output_tail` — and then ran `lore release`, while its entire implementation
sat as UNCOMMITTED working-tree state:

    $ git log --oneline main..worktree-agent-a1beb20b9ae4fd6a6
    (empty)
    $ git -C .claude/worktrees/agent-a1beb20b9ae4fd6a6 status --porcelain
     M packages/lore/src/ai/assess-template.ts
     M packages/lore/tests/unit/service/ai-provider-service-assess.test.ts
    ?? packages/lore/tests/unit/ai/assess-evidence-projection.test.ts

The corpus said the task was verified and unclaimed. Git said the branch was empty. The
orchestrator's routine post-merge cleanup (`git worktree remove` + `git branch -d` after
confirming the branch is merged) would have found nothing to merge, removed the worktree,
and DESTROYED the slice — while leaving four passing evidence rows in the permanent record
attesting a tree that no longer existed anywhere.

Recovered only because the standing CLAUDE.md rule ("verify `git log` on the branch BEFORE
merge+cleanup — 'Already up to date' on a branch that should carry work = STOP") was
followed manually.

## Why the existing guard did not catch it

`subagent-stop-commit-guard.mjs` has one documented gap: a LIVE background child at
hook-fire time slips past it. T3 had exactly that (a Monitor watching a long test run), so
this is that known gap manifesting — NOT a new hook defect, and the hook should not be
"fixed" for it.

What IS new is the consequence. The gap was catalogued as a risk of losing work. This
measurement shows it also produces FALSE CORPUS STATE: evidence rows and a release that
together assert a verification which no commit backs. The two sibling agents in the same
wave (T1, T4) both DID commit before stopping, so the difference is timing, not discipline
— which means it recurs at random.

## The missing mechanism (lore-side, not hook-side)

Grepped 2026-08-01 — there is NO git working-tree check anywhere on the evidence or release
paths:

    packages/lore/src/service/task-workflow-service.ts
    packages/lore/src/adapters/cli/commands/evidence.ts
    packages/lore/src/adapters/cli/commands/release.ts
    packages/lore/src/adapters/cli/evidence-precheck.ts
    → zero hits for porcelain / isDirty / uncommitted / "git status"

A claim already records its `worktree` path (`extra.claim.worktree`, SPEC-025/042), so the
predicate has everything it needs: when a `lore evidence --result pass` (or a `lore release`)
is issued from a claim whose recorded worktree has uncommitted modifications to the task's
DECLARED FILE ANCHORS, the attestation is unbacked.

This is the same family the corpus already catalogues under false oracles: the row is
`result`-true, but what it measured cannot be re-reached by anyone else.

## Design questions the implementation must settle

1. **Refuse or warn?** A refusal is the stronger mechanism but couples `lore` to git and
   would break any legitimate non-git corpus. Prefer scoping the refusal to the case where
   `extra.claim.worktree` is set AND that path is inside a git repo — outside that, silent
   no-op, never a fabricated pass.
2. **Which paths count as dirty?** Only the task's declared `extra.file_anchors` (precise,
   but blind to undeclared files — the same limitation `noAnchorOverlap` already has), or
   any modification in the worktree (loud, but fires on unrelated scratch files). The
   anchor-scoped variant is the coherent choice: the corpus already treats anchors as the
   task's declared surface.
3. **`release` too, or only `evidence`?** A release with uncommitted anchors is what makes
   the worktree eligible for cleanup, so it is arguably the more dangerous of the two.

## Oracle

- RED first: a test reproducing the exact shape above — a claimed task whose recorded
  worktree has an uncommitted modification to a declared anchor — must have `lore evidence
  --result pass` REFUSED, and must fail before the fix.
- CONTROL: the same call from a CLEAN worktree is accepted.
- CONTROL: a task with NO declared anchors, or a claim with no recorded worktree, is
  unaffected (no fabricated refusal).
- CONTROL: a corpus outside any git repository is unaffected.
- The refusal names the uncommitted path(s) and the exact repair (`git add` + path-scoped
  `git commit`), per the house rule that a refusal ends with the action.


## Proxy / Silence / Opt-in — ADR three-question review (2026-08-01, agent:main-orchestrator)

Answered per `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the` BEFORE
implementation. This review OVERRULES two of the three design questions above.

**Q1 Proxy — the fix proposed in design question 2 IS ITSELF A PROXY, and the anchor-scoped
variant is REJECTED as the primary predicate.**
Design question 2 above calls the anchor-scoped variant "the coherent choice". Concrete input
that satisfies it while violating the property: a task declaring anchor `A`, whose implementer
actually edits UNDECLARED file `B` and leaves `B` uncommitted — `A` is clean, the predicate
passes, and the attestation is still backed by no commit. That is the `noAnchorOverlap`
blindness reproduced one layer down, and it is NOT accepted here, because a strictly stronger
predicate costs the same: `git status --porcelain` over the recorded worktree already excludes
`.gitignore`d paths, so "any tracked-file modification in the claim's worktree" IS the property
(is this attestation backed by committed state), not a proxy for it.
**Decision: the predicate is whole-worktree `--porcelain` non-empty.** Declared anchors are
used ONLY to rank which paths the refusal message names first. The "fires on unrelated scratch
files" objection does not survive measurement: ignored scratch is invisible to porcelain, and
un-ignored scratch is itself an unrecorded artifact worth naming.

**Q2 Silence — design question 1's "outside that, silent no-op" is a Q2 violation and is
REJECTED as written.**
Three preconditions can be absent: no recorded `extra.claim.worktree`; the path is not inside a
git repo; `git` unavailable. A row written under an unmeasured precondition must not be
indistinguishable from one written against a verified-clean tree. Required: the row records the
measurement's OUTCOME as a distinct value (`measured-clean` / `not-measured-no-worktree` /
`not-measured-not-a-repo`), and every consumer that scores attestation quality
(`attested_evidence_ratio`) treats not-measured as NOT-clean — never as clean.

**Q3 Opt-in — an opt-in the task body never names, and it must be closed or accepted in
writing.**
The predicate can only fire when the claim recorded a worktree, and `--worktree` is ALWAYS
explicit by SPEC-025/042 design. An implementer who claims without `--worktree` bypasses the
entire mechanism — exactly "constrains only the population that did not need constraining".
Making `--worktree` implicit contradicts a landed spec decision, so the coherent close is at
the other end: when `lore evidence --result pass` is issued from a cwd that IS a git worktree
while the claim recorded NO worktree, that mismatch is itself the loud signal. Record which
route the implementation takes. A silent bypass is not one of the options.

**⛔ Concurrency note — RE-MEASURE before dispatch; do not trust this paragraph.**
Between 21:19 and 21:41 on 2026-08-01 a CONCURRENT orchestrator session — resolving to the SAME
`agent:main-orchestrator` actor as this review's author, so invisible in `active_sessions` — ran
four agents in `.claude/worktrees/agent-{a0bd2615…, a313f70c…, a63979673…, adcccee23…}` and merged
two of them into `main` mid-review: `main` moved `63c3537` → `955c26d` in four minutes.
The files this task must touch were inside that window's write set:
- `packages/lore/src/adapters/cli/commands/evidence.ts`
- `packages/lore/src/adapters/cli/evidence-precheck.ts`
- `packages/lore/src/adapters/mcp/tools.ts`

⛔ Whether they are STILL contended is not knowable from this document. `--porcelain` and
ahead-counts are not durable facts — the first version of this very paragraph asserted
"uncommitted, branch empty" about worktrees that were merged before it was four minutes old.
Before dispatching, re-measure:

    git worktree list && git log --oneline -3
    for w in $(git worktree list --porcelain | awk '/^worktree/{print $2}'); do \
      printf '%s: %s dirty, %s ahead\n' "$w" \
        "$(git -C "$w" status --porcelain | wc -l)" \
        "$(git -C "$w" log --oneline main..HEAD 2>/dev/null | wc -l)"; done

Then re-read the MERGED state of the files above: a landed concurrent change may have moved the
seam this task's fix targets. See `task-lore-handoff-reports-modified-files-none-while-four`.

**Second live instance of this very defect — corrected framing (measured 2026-08-01).** Four
worktrees were each measured holding substantial uncommitted implementation while
`git log main..<branch>` was EMPTY — the exact state this task describes, in which an evidence row
and a release would attest a tree no commit backs. What did NOT happen is loss: all four were
committed by their own agents and merged by the live orchestrator that owned them. So the window
is REAL and recurs at random (it was open for minutes, across four agents, on this repo, today),
but it closes on its own whenever the agent survives to commit. The defect is therefore
probabilistic exposure, not certain destruction — which is a weaker claim than this task's
original measurement and does not reduce the need for the predicate: the corpus said "verified,
unclaimed" while the window was open, and nothing in the corpus could tell the two apart.

## Recurrence rate, measured across one orchestrated session (2026-08-01/02)

The original filing called this "timing, not discipline — which means it recurs at random". One
session's direct observation puts a number on "at random":

| agent | observed state | how it resolved |
|---|---|---|
| 4 worktrees of a CONCURRENT session (`a0bd2615`, `a313f70c`, `a63979673`, `adcccee23`) | all four measured with substantial uncommitted implementation while `git log main..<branch>` was EMPTY | all four self-committed and were merged by their live owner |
| `aad7d6d8` (assess derivation) | dirty + empty branch at first notification | self-committed before its next stop |
| `a09f929c` (resume arming) | committed before first notification | n/a |
| `a3203d6e` (assess registry) | killed by the harness watchdog mid-run; **458 insertions across 7 files, branch EMPTY, claim held, zero evidence** | only committed after the orchestrator resumed it with an explicit "commit FIRST, before anything else" instruction |

**Six of seven observed agents passed through the state this task describes.** It is not a rare
race — it is the normal mid-flight condition of any dispatched agent, and the window closes only if
that agent survives to its own commit step.

`a3203d6e` is the case the original filing predicted but could not exhibit: it did NOT survive. Its
harness worktree was then DELETED while it was still running, and it lost Bash entirely — so the
uncommitted 458 lines existed only inside a directory that no longer existed, with a live claim in
the corpus asserting the task was being worked. Recovery required a human-directed resume whose
first instruction was to commit. Nothing in lore would have surfaced any of this: the claim looked
healthy, and had the agent recorded evidence before stalling (it had not yet reached that step, by
luck rather than by design), the corpus would have carried a verified, released task backed by no
commit and no directory.

This raises the priority of the predicate in this task: the failure is not a tail risk to be
accepted, it is the majority state, and the only thing standing between it and false corpus state
is whether the agent happens to reach `git commit` before something kills it.
