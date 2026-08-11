---
id: TASK-394
type: task
role: plan
title: "The uncommitted-worktree guard treats 'no claim at all' as 'a claim that recorded no worktree', so every orchestrator post-merge evidence call from a main checkout is falsely refused with a message about a claim that does not exist"
status: archived
priority: critical
created: 2026-08-02
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: TASK-399, type: relates-to}
  - {id: TASK-396, type: relates-to}
  - {id: ADR-028, type: relates-to}
---
Measured 2026-08-02 by the orchestrator, against its own workflow, minutes after the guard's first
real activation. Not a regression — the guard shipped in `9a34739` but only reached the CLI when
`dist/lore` was rebuilt at 22:31 (`lore` is a symlink to it). Its first live effect was a false
refusal.

## Measured

Recording orchestrator re-verification evidence on an ARCHIVED-CANDIDATE task whose `extra.claim`
is `null` (the implementer had already released it):

    $ lore evidence <task> --oracle test --result pass --command "…" --output-tail-file …
    Error: Validation failed on field 'extra.claim.worktree': Refused: `lore evidence --result pass`
    — its claim recorded NO worktree, but this call is running from inside a git repository
    ("/Users/apple/Projects/zz/lore") … Re-claim with `lore claim <task> --worktree "$PWD"` …

Verified with `lore get --json`: `extra.claim` is `null`, and `extra`'s only keys are
`adhoc`, `file_anchors`, `verification_evidence`. **There is no claim at all.** The message asserts
a fact about a claim that does not exist, and the repair it prescribes (re-claim a task somebody
else already released, from the main checkout) is wrong for this caller.

## Root cause, and why the MCP side does not have it

`checkUncommittedAttestationWorktree` reads the claim's `worktree` field. Both "a claim exists but
recorded no worktree" and "there is no claim at all" arrive as `worktree === undefined`, so the Q3
opt-in close (added by `task-lore-evidence-and-lore-release-accept-an-attestation-from`) fires for
both. Its own CONTROL required the opposite: *"a claim with no recorded worktree … unaffected — no
fabricated refusal"*, and the MCP sibling task's AC-7 stated it outright: *"the CLI's Q3 close
targets a claim that RECORDED NO WORKTREE, not the absence of a claim; do not widen that."*

The MCP adapter (`81d5208`) hit this same collapse and worked around it IN THE ADAPTER, adding
`hasRecordedTaskClaim()` and forcing a sentinel when no claim exists. That fix is correct for MCP
and left the CLI untouched — so the two adapters now disagree about identical input, and a third
adapter would inherit whichever behaviour it happens to copy.

⛔ **Fix this in the SERVICE, not by porting `hasRecordedTaskClaim` into the CLI.** Two adapters
each carrying their own copy of "is there actually a claim" is how the next divergence hides — the
same argument this corpus just used to make `deriveCommitSetForPlan`'s parameters required.

## Why the miss was not caught by the guard's own tests

The guard shipped with 21 tests including "a claim with no recorded worktree … unaffected". Those
exercise the SERVICE with a constructed claim object. The uncovered combination is the one this
repo's orchestrator hits on every merge close-out: **no claim at all, CLI caller, cwd inside a git
repo**. The CONTROL was written from the claim's point of view, so the claim-less case was never
constructed.

## Proxy / Silence / Opt-in

- **Proxy** — `claim?.worktree === undefined` is a proxy for "this claim declined to declare a
  worktree". Concrete input satisfying the proxy while violating the property: any task with no
  claim. Not accepted; it is the defect.
- **Silence** — inverted here: the failure is LOUD but MISLEADING. The message states a fact about a
  nonexistent claim and prescribes a repair that is wrong for the caller. A refusal that names the
  wrong cause costs more than a silent one, because it sends the reader to fix something that is
  not broken. Whatever value the service returns must distinguish `no-claim` from
  `claim-without-worktree`, and the message must be derived from that value.
- **Opt-in** — unchanged; nothing new to opt into.

## Blast radius

Every `lore evidence --result pass` from a main checkout on an unclaimed task is refused. That is
the orchestrator's standard post-merge re-verification path — the one this corpus relies on to
archive work whose implementer evidence is unusable. It fired 2 of 3 times in the close-out that
discovered it.

## Oracle

- RED first: `lore evidence --result pass` on a task with `extra.claim === null`, run from inside a
  git repo, is currently REFUSED; after the fix it is ACCEPTED. Must fail before.
- CONTROL: a task WITH a claim that recorded no worktree, called from inside a git repo, is STILL
  refused — assert the message names that state, not the no-claim one.
- CONTROL: a claim with a recorded, CLEAN worktree is accepted; with a DIRTY one, refused. Both
  byte-identical to today.
- CONTROL: the MCP path's behaviour is unchanged, and after the service distinguishes the two
  states, state whether `hasRecordedTaskClaim` in `tools.ts` becomes redundant — if it does, remove
  it, so the two adapters cannot drift again.
- CONTROL: the guard's existing 21-test suite stays green (`packages/lore/tests/unit/service/task-workflow-uncommitted-worktree-guard.test.ts`).
- ⛔ Add the missing combination as a permanent test: no claim + CLI caller + cwd inside a git repo.

## Recurrence, measured again 15 minutes later

The refusal is not a one-off of the first task it hit. Recording orchestrator re-verification on a
SECOND, unrelated archived-candidate task (`task-computescopemismatchwarning-cannot-distinguish-a-too-wide`,
`extra.claim === null`) from the main checkout:

    EVIDENCE_EXIT=4
    Error: Validation failed on field 'extra.claim.worktree': Refused … its claim recorded NO
    worktree … Re-claim with `lore claim <task> --worktree "$PWD"` …

Running tally for this close-out session: **4 refusals across 3 distinct tasks**, every one of them
a task with no claim at all. Zero true positives so far — the guard has not yet refused a single
genuinely-dirty worktree in live use, because the population it actually meets from a main checkout
is "unclaimed task, orchestrator re-verifying after merge".

Operational consequence, already happening: the orchestrator's re-verification results are being
written into `lore done --override-attestation` free text instead of into `verification_evidence`
rows, because that is the only path left open. That is strictly worse for the corpus — an audited
prose reason is not queryable, carries no `output_tail`, and does not count toward
`attested_evidence_ratio`. **A guard whose false-refusal exit is "write your evidence as prose"
degrades exactly the record it was built to protect** — the same second-order shape already
catalogued for the cd-prefix precheck pushing authors toward `--oracle manual`.
