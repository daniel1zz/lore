---
id: SPEC-226
type: spec
role: spec
title: "Landing does the bookkeeping: claims start from main, parked work releases its hold, anchors follow moved files, landing runs done"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-20
tags: [redesign, integrate, claim]
---
## Overview/Goal

Second part of D3 in `adr-facts-live-once-next-to-what-they-describe-corpus-changes`, after `spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end`. It removes the hand work the orchestrator still does around every landing, by checking each fact once at the point that knows it.

Measured on 2026-10-19:
- **A branch carried another branch's work.** An implementer's worktree was cut from a feature branch instead of main and carried 43 unlanded commits. Integrate caught it only by luck, through a coverage failure.
- **A refusal did not say whom to ask.** A branch blocked under BR-1346 got the holder task's slug, but not who holds its claim or how long ago it was taken.
- **Deletions left drift behind.** A landing deleted a file that a spec still code-anchored, and the drift surfaced afterwards in every session's turn-end review.
- **`lore done` failed after landing.** The orchestrator ran it after each landing, and it often refused on a floor the implementer could have met while working: an anchored test file with no unfiltered pass, or no runner-produced red. Each refusal cost a round trip.

## Scope

**A claim starts from main.** A task's first claim from a linked worktree is refused (exit 4) when the worktree's HEAD carries any commit not on main (`main..HEAD` non-empty). The refusal names the commit count and, if it can be found, the branch those commits come from. A later claim of the same task, on the branch its claim already records, is not refused for that branch's own commits. So a worktree cut from anything but main cannot start work, and a branch never carries another task's unlanded commits from the start.

**A refusal says who holds what.** When integrate refuses a branch for a path that another live claim holds, the refusal names, for each held path or `path#Symbol`, the holding task, its claim's holder and the claim's age. Which claims hold at all is defined by BR-1346, owned by `task-own-diff-landing-gate-holds-a-path-only-while-its-holder`: released, committed branches hold nothing, so paused work never blocks and needs no parking verb.

**Code anchors move with the change that moves their files.** Before the floor, integrate reads the branch's own change (`git diff --name-status -M <merge-base> <tip>`) and finds every spec or knowledge doc whose `code_anchors` name a deleted path or the old side of a rename.
- A renamed path's anchors are rewritten to the new path when the branch lands, one version per doc, attributed to the landing.
- A deleted path refuses the landing (exit 4). The refusal lists each doc and anchor, until each anchor is removed or moved (`lore anchor rm`/`add`) or its doc is invalidated.

**Landing finishes the task.** After a successful landing, integrate runs the `lore done` walk for every task of the branch whose floors are met. For any task still blocked, it prints the floor and the exact command that satisfies it. The landing itself is never undone by a done refusal. The main agent no longer runs `lore done` after each landing.

**The definition of done is known at claim.** `lore claim` (and `lore feed task-start`) prints the evidence each `lore done` floor will demand of this task, computed from its anchors and ac_scope with the same predicates `lore done` uses:
- every anchored test file that needs an unfiltered runner-attested pass;
- whether a runner-produced red is required, for a declared ac_scope;
- the ACs whose script commands `lore verify` will run.

The list is computed, not hand-written, so it cannot drift from the floors.

Out of scope, for a later D3 spec: landing queues with batching and bisect, and hermetic incremental test reuse.

## Acceptance Criteria

Structured criteria AC-LB-1 to AC-LB-5 (`lore ac list`).


## Acceptance Criteria (structured)

- [⚑] [script] AC-LB-1: Throwaway repo with lore init, the main-ref guard installed (installShippedGuard after git checkout -q --detach main), floor_command 'true', and each fixture claim under its own CLAUDE_CODE_SESSION_ID with the ambient one stripped. (1) A worktree cut from unlanded branch A (2 commits, task TA claimed on A): lore claim TB from it exits exactly 4, stderr names BR-1353, '2' commits and branch A, and TB's claim is unchanged. (2) A worktree cut from main: claim TB exits 0. (3) TB's implementer commits, releases, and claims TB again on the same branch: exits 0. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a check that only compares HEAD to main's tip refuses (3); the test requires (3) to pass. Made red once by dropping the recorded-branch exemption.
  script: test — bun run test:file packages/lore/tests/integration/lb-claim-from-main.bun.test.ts && echo 'AC-LB-1 PASS: a first claim starts from main'
  other_command=5
- [⚑] [script] AC-LB-2: Throwaway repo with lore init, the main-ref guard installed, floor_command 'true', each fixture claim under its own CLAUDE_CODE_SESSION_ID with the ambient one stripped. Task U holds a claim on src/x.ts, taken by holder H. Branch X (task T) changes src/x.ts: integrate exits exactly 4, and stderr names BR-1346, src/x.ts, U, H and the claim's age in minutes. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a refusal naming only the slug passes the exit-code check; the test asserts H and the age are present. Made red once by dropping the holder and age from the message.
  script: test — bun run test:file packages/lore/tests/integration/lb-park.bun.test.ts && echo 'AC-LB-2 PASS: parked work releases its hold'
  other_command=8
- [⚑] [script] AC-LB-3: Throwaway repo with lore init, the main-ref guard installed (installShippedGuard after git checkout -q --detach main), floor_command 'true', and each fixture claim under its own CLAUDE_CODE_SESSION_ID with the ambient one stripped. Spec P code-anchors src/x.ts and src/z.ts. (1) Branch X (claimed task) renames src/x.ts to src/y.ts: integrate exits 0 and lore get P --json lists src/y.ts and not src/x.ts, with one new version of P. (2) Branch W deletes src/z.ts: exits exactly 4; stderr names BR-1355, P and src/z.ts; main unchanged. (3) After lore anchor rm P src/z.ts, W exits 0. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a rename detected without -M looks like delete+add and is refused under (2); the test requires (1) to land. Made red once by dropping rename detection.
  script: test — bun run test:file packages/lore/tests/integration/lb-anchor-follow.bun.test.ts && echo 'AC-LB-3 PASS: anchors follow moved files at landing'
  other_command=6
- [⚑] [script] AC-LB-4: Throwaway repo with lore init, the main-ref guard installed (installShippedGuard after git checkout -q --detach main), floor_command 'true', and each fixture claim under its own CLAUDE_CODE_SESSION_ID with the ambient one stripped. (1) Task T on branch X with complete runner-attested evidence (its anchored test file run unfiltered and passing): integrate exits 0 and T is archived with no separate lore done. (2) Task T2 on branch X2 whose anchored test file has only a filtered (-t) pass: integrate exits 0, X2 is on main, T2 stays unarchived, and stdout names the unfiltered-test-file floor and a lore evidence command for that file. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a landing that rolls back main when done refuses passes (1) and fails (2) silently; the test asserts main contains X2 in (2). Made red once by skipping the post-landing done walk.
  script: test — bun run test:file packages/lore/tests/integration/lb-landing-runs-done.bun.test.ts && echo 'AC-LB-4 PASS: landing archives tasks whose floors are met'
  other_command=6
- [⊘] [script] AC-LB-5: Throwaway corpus (lore init). Task T anchors tests/a.test.ts, tests/b.test.ts, src/c.ts and the symbol anchor src/d.ts#Foo (accepted and stored as written, BR-1358), declares ac_scope AC-X-1 of a spec whose AC-X-1 is script-mode. lore claim T --json prints a definition_of_done naming exactly tests/a.test.ts and tests/b.test.ts as unfiltered-pass files, red_required true, and verify_acs [AC-X-1]; a task with no ac_scope and no test anchors prints red_required false and empty lists. The same lists come from the lore done floor predicates: a unit test feeds one task to both and asserts equality. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a hand-written list that names every anchor passes the counts only if src/c.ts is excluded; the test asserts src/c.ts is absent. Made red once by listing all anchors.
  script: test — bun run test:file packages/lore/tests/integration/lb-definition-of-done.bun.test.ts && echo 'AC-LB-5 PASS: claim prints the definition of done'
  other_command=5
