---
id: SPEC-257
type: spec
role: spec
title: "Claims released before tips were recorded are classified unrecoverable once, so landing measures only measurable claims (resolves #473)"
status: approved
priority: critical
created: 2026-10-26
updated: 2026-10-26
tags: [governance-mechanism-fixes, issue-473]
links:
  - {id: SPEC-244, type: relates-to}
---
# Claims released before tips were recorded are classified unrecoverable once, so landing measures only measurable claims (resolves #473)

## Overview/Goal

A task whose earlier claim branch was removed before #356 recorded branch tips can still be archived once its current work is proven. Landing judges only the claims that can be measured. Each claim that can never be measured is classified once, recorded with its reason, and listed. It is never silently dropped.

Today `TaskWorkflowService.measureLanding` (packages/lore/src/service/task-workflow-service.ts, about lines 4442-4492) builds landing candidates from ALL claim audit rows (`landingCandidateNames` over `claimRows`). Consider a historical claim branch that the harness removed before #356, when release did not record `end_tip`. It has no ref and no tip, so `landingOf` returns `unmeasurable` for the whole task, permanently. Migration 039's back-fill (#356 D7) resolved only OPEN legacy claims, not released ones, and re-claiming cannot help, because the old branch stays in the candidate set.

On 2026-10-26 (main d8c44ee9), the four plan-evaluation-1 experiment tasks were refused with `[floor: not-landed] unmeasurable: the branch is gone and no tip was recorded`. They have no file anchors, their research documents are persisted, and they hold fresh pass evidence at main's head under a no-branch claim. The refusals named the branches `worktree-agent-ab8d0aa760dca3031` and `worktree-agent-a3683d4e54bf494e7`. This blocks `task-close-plan-356-verify-apply-rules-close-the-four` (step 3).

**Mechanism.** The landing candidate set includes historical claims whose facts were never recorded, and nothing classifies them. One unmeasurable history entry therefore makes every later proof irrelevant.

**End state (user decision D25).**
1. A one-time store migration (migration 040) marks each RELEASED claim that named a branch, holds no `start_head` and has no recorded `end_tip` as `unrecoverable`, with the reason `released before tips were recorded`. It writes exactly one audit entry per claim it marks, and it is idempotent. These are recorded facts only, with no timestamp and no git:
   - Since #356, the claim schema refuses a branch claim without a sha `start_head` (packages/core/src/task-workflow.ts:850-853), so every branch claim made since then carries one.
   - Migration 039 back-filled `start_head` only on OPEN claims.
   - So a released branch claim with neither `start_head` nor `end_tip` can only be a pre-#356 claim. Its work range cannot be measured, because it has no start. Its branch ref, where it still exists, can still show unlanded work, and landing checks for that (step 2).
2. `measureLanding` / `landingOf` judge only the claims that are not marked `unrecoverable`. The landing output lists the unrecoverable claims and their count, so nothing is dropped silently. For each unrecoverable claim, landing (which already reads git) checks its branch ref:
   - ref gone: listed and excluded;
   - ref exists and its tip is reachable from main: listed and excluded, because its work is on main;
   - ref exists and its tip is NOT reachable from main: refused, exit 4 `[floor: not-landed]` `unrecoverable-claim-branch-unlanded`, naming the branch and telling the holder to land it (`lore integrate <branch>`) or delete it.
3. A claim made after #356 always has a `start_head`, so it is never selected. If its branch is gone with no tip, it still makes the task `unmeasurable`. The classification is a recorded fact written once by the migration, not a runtime skip rule, so no new silent path exists.

Issue: GitHub #473 (carried by this spec's plan). It corrects the behaviour of the approved and landed `spec-lore-done-closes-a-commitless-task-through-an-audited-no` (#356). That spec is locked with evidence, so the record lock routes this behaviour change to a new spec.

## Scope

**In**
- Migration 040 and its registration in both store implementations (`sqlite-store.ts`, `turso-store.ts`) and `schema-version.ts`.
- The `unrecoverable` marker on a claim's audit row.
- The candidate filter in `measureLanding`.
- Listing unrecoverable claims in the landing output (`lore done`, `lore get`).
- BR-1423 rule text.

**Out**
- Open legacy claims: migration 039 already handles them.
- Claims made after #356.
- Any runtime rule that skips tipless claims.

## Design

- **Selection (migration 040, run once):** among claim audit rows and claim records, those that (i) named a branch, (ii) are released (a later release or run-end row of the same claim, or a later claim), (iii) carry no `start_head`, and (iv) carry no `end_tip`. Each one gets `unrecoverable: { reason: "released before tips were recorded", marked_by: "migration-040" }` and one `claim-unrecoverable` audit entry. A no-branch (corpus-only) claim never qualifies, because it needs no start.
- **Where it runs, and repository access:** it runs inside the store migration chain under the migration write lock, like migration 039 (`migration-039.ts`). Unlike 039 it reads NO git, so it behaves identically for the SQLite store and the Turso embedded replica, with or without a local checkout. It has no refusal path that could block later store use.
- **Cutoff without a timestamp:** applied migration times are not recorded (only `PRAGMA user_version`), so no wall-clock cutoff is used. The cutoff is the recorded absence of `start_head` on a released branch claim (above). On a fresh corpus where 039 and 040 apply in the same run, there are no claims, so both change nothing.
- **Landing:** candidates are the claims without `unrecoverable`. Each unrecoverable claim's branch ref is checked as in End state 2: a ref whose tip is not on main refuses with `unrecoverable-claim-branch-unlanded` (literal `if (ref !== undefined && !ref.reachableFromMain) return notLanded("unrecoverable-claim-branch-unlanded"`); a gone ref, or one whose tip is on main, is excluded. The output adds `unrecoverable claims: <n> (<branches>)`. If every claim of the task is unrecoverable (no measurable claim remains), `lore done` refuses with exit 4 `[floor: not-landed]` `no-measurable-claim`, naming the remedy: claim again (on a branch, or without one for corpus-only work), record evidence, then `lore done`. Nothing is guessed.
- **Registration:** migration 040 is added, like 039, to the migration lists of BOTH store implementations, `packages/lore/src/store/sqlite-store.ts` and `packages/lore/src/store/turso-store.ts` (the files that register migration 039), and to `schema-version.ts`.

### Public interface (falsifier literals, verbatim, once each)

- `task-workflow-service.ts` (`measureLanding`): `.filter((claim) => claim.unrecoverable === undefined)`.
- `packages/lore/src/store/migrations/migration-040.ts`: `reason: "released before tips were recorded"` and the selection literal `claim.start_head === undefined && claim.end_tip === undefined && claim.branch !== undefined && isReleased(claim)`.

## Design Decisions

| # | Choice | Chosen | Rejected (why) |
|---|---|---|---|
| D1 | How to treat historical claims that can never be measured | Classify them once in a migration, record and list them (D25) | A runtime rule that skips every tipless claim: a new silent path for post-#356 claims. `lore bulk deprecate` of the stuck tasks: records finished work as abandoned. Requiring a re-claim: does not help, because the old branch stays in the candidate set |
| D2 | Where the rule change lives | This new spec modifies BR-1423 | An audited correction on the #356 spec: refused, because a landed rule-change entry is history and the record lock routes behaviour changes to a new spec |
| D3 | Which claims are eligible | Released branch claims with neither `start_head` nor `end_tip`: recorded facts only | 'Made before 039 applied' (S1 draft of this spec): no applied time is stored. Every tipless claim: would hide post-#356 defects |
| D4 | Git access in migration 040 | None: the selection is over recorded facts; runs in the store migration chain like 039 | Read branch refs as 039 does, with an exit-1 refusal when no repository is reachable: would block every later store use on a corpus without a local checkout (for example a Turso replica host), and the classification needs no ref, because landing checks the ref at read time (D5) |
| D5 | An unrecoverable claim whose branch ref still exists | Landing checks the ref: tip on main means excluded; tip not on main is refused with `unrecoverable-claim-branch-unlanded`, naming the branch | Exclude every unrecoverable claim regardless of its ref: a branch holding commits that never landed would let `lore done` archive the task, and the corpus would lie |

## Acceptance Criteria

- **AC-UC-1** (BR-1423, BR-1291): on a fixture corpus and repo:
  - (a) A task with a released branch claim carrying no `start_head` and no `end_tip` (its branch gone), plus a fresh no-branch claim with clean evidence at main's head: migration 040 marks the old claim unrecoverable, and the task then closes with `lore done --declare-no-new-tests` (exit 0, landing kind `no-change`, the unrecoverable claim listed with its count).
  - (b) A claim made under the current schema (it has `start_head`) whose branch is gone with no tip is never marked and is still refused: `lore done` exits 4 with `[floor: not-landed]` `unmeasurable`.
  - (c) Running migration 040 twice writes exactly one audit entry per unrecoverable claim and changes nothing the second time.
  - (d) The refusal path: a task whose only claim is unrecoverable is refused by `lore done` with exit 4 and the refusal name `[floor: not-landed]` `no-measurable-claim`.
  - (e) Migration 040 run on a fixture corpus whose directory is not inside any git repository applies, marks the same claims as in (a), and leaves the store usable (a following `lore list` exits 0).
  - (f) A task whose unrecoverable claim's branch ref still exists with a tip NOT reachable from main, plus a fresh no-branch claim with clean evidence at main's head, is refused: `lore done` exits 4 with `[floor: not-landed]` `unrecoverable-claim-branch-unlanded` and the branch name. After that branch's tip is merged into main, the same `lore done` exits 0.
  - Test: `packages/lore/tests/integration/cli/landing-unrecoverable-claims.bun.test.ts`. Simplest false green: a runtime skip of every tipless claim passes (a) but fails (b).

## Rule changes

Modified: BR-1423 on `baseline-archive-a-task`. An unknown tip refuses, except a claim released before tips were recorded, which is marked unrecoverable once and listed.


## Acceptance Criteria (structured)

- [⚑] [script] AC-UC-1: Issue #473 on a fixture corpus and repo: (a) a released branch claim with no start_head and no end_tip (branch gone) plus a fresh no-branch claim with clean evidence at main's head: migration 040 marks the old claim unrecoverable and lore done --declare-no-new-tests exits 0 (landing no-change, the claim listed with its count); (b) a claim with start_head, branch gone, no tip: never marked, lore done exits 4 '[floor: not-landed]' 'unmeasurable'; (c) migration 040 twice: one audit entry per unrecoverable claim, second run changes nothing; (d) only claim unrecoverable: exit 4 '[floor: not-landed]' 'no-measurable-claim'; (e) migration 040 outside any git repository applies and a following lore list exits 0; (f) an unrecoverable claim whose branch ref still exists with a tip not reachable from main: lore done exits 4 '[floor: not-landed]' 'unrecoverable-claim-branch-unlanded' naming the branch, and exits 0 after that tip is merged into main. False green guarded: excluding every unrecoverable claim passes (a) but fails (f).
  script: test — bun run test:file packages/lore/tests/integration/cli/landing-unrecoverable-claims.bun.test.ts && echo 'AC-UC-1 PASS: unrecoverable historical claims are classified once and listed; new tipless claims still refuse'
  other_command=3

## Code anchors

- packages/core/src/landing.ts#unrecoverableBranchVerdict
- packages/lore/src/store/migrations/migration-040.ts
- packages/lore/tests/integration/cli/landing-unrecoverable-claims.bun.test.ts
