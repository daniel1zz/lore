---
id: SPEC-244
type: spec
role: spec
title: "A task's landing is derived from git facts that evidence and lore done share (resolves #356, #304, #422, #329)"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-27
tags: [governance-mechanism-fixes, issue-356]
---
# A task's landing is derived from git facts that evidence and lore done share (resolves #356, #304, #422, #329)

## Overview/Goal

Whether a task's work has landed is a fact about git, computed by ONE predicate. Recording evidence, `lore done`, `lore integrate`'s post-landing archive and plan close all use that same predicate. A landing record is no longer the only proof of landing, and work that produced no commit needs no ritual.

**Mechanism (one design choice, four symptoms).** Today a landing exists only as a record written by `lore integrate` (`findNotLandedFloor`, packages/lore/src/service/task-workflow-service.ts, from line 4226). That record needs a branch with a commit and a claim that recorded `base_sha`, and the done floors read files from the shared checkout's working tree. So:

- #356: a task whose worktree produced no commit cannot be archived. The harness deletes the unchanged branch, and integrate refuses ("does not name a commit"). The only exit, `lore bulk deprecate`, records finished work as abandoned. On 2026-10-26 four read-only experiment tasks of `plan-evaluation-1-experiments-and-honest-metric-envelope` were stuck this way.
- #304: a corpus-only task needs a worktree claim for `lore evidence` (BR-159), and then that claim arms the not-landed floor, which nothing can satisfy.
- #422: a claim made before claims recorded `base_sha` can never receive a landing record. Integrate warns "its landing range has no start", and `lore done` loops by naming integrate as the fix.
- #329: integrate's post-landing archive checks AC oracle files before the shared checkout is refreshed, so a branch that adds its own AC test file stays unarchived with `[floor: missing-oracle-file]`.

**End state.**
1. Claims and branches:
   - A task that declares any file anchor changes tracked files, so it can be claimed only by naming its worktree and branch. A claim without one is refused (exit 4, `work-needs-branch`), and nothing is written.
   - A claim with no branch is legal only for corpus-only work: a task with no file anchors.
   - A branch claim records `start_head`, which is the claim's existing `base_sha` (task-workflow-service.ts:3282, recorded at claim since the base_sha change).
   - The claim records `end_tip`, the branch's HEAD, every time evidence is captured on it (the capture runs inside the worktree, so the branch exists at that moment) and again when the claim ends (`lore release`, or the run-end release of BR-1057). The newest recorded value wins. So the tip is a recorded git fact before any harness can remove the branch, whether or not a run-end hook fires.
2. Every evidence row already records `head_sha` and `worktree_dirty` (packages/core/src/task-workflow.ts:321-353).
3. One pure predicate, `landingOf(task, gitFacts)`, decides landed or not, and its kind, from git facts only:
   - **Evidence window**: only evidence recorded after the task's latest claim counts, for the tip and for BR-199 alike. A pass from before a re-claim never counts.
   - **Branch claim, work tip**: the claimed branch's tip if the ref exists; otherwise the newest `end_tip` recorded on the claim (at a capture or at the claim's end). If the ref is gone and no `end_tip` was recorded, the state is **unmeasurable** and done refuses. There is no default: the tip is never taken from `start_head`. Known limit: commits made after the last recorded tip on a branch that is then deleted by hand, with no capture or release, cannot be seen. The harness removes only an unchanged worktree (#356), so this needs a manual force-delete.
   - **Kind**: `no-change` when the range `start_head..tip` is empty; `commits` when it is non-empty.
   - **Branch claim, landed** iff `tip` is reachable from the integration branch (`git merge-base --is-ancestor tip main`) and the claimed worktree, if it still exists, has no uncommitted tracked change. **Premise:** reachability holds because `lore integrate` lands a branch with a merge commit (BR-1245: "the branch is merged onto the current main"). That keeps the branch tip and every pre-merge evidence head in main's history; a squash, rebase or cherry-pick landing would break it, and AC-ND-6 pins it.
   - **No-branch (corpus-only) claim, landed as `no-change`** iff at least one counted pass recorded its `head_sha` equal to main's head at capture (`attestation.main_head`, recorded at capture). A no-branch claim exists only for a task without file anchors (BR-1468), and adding an anchor to a task with an open no-branch claim is refused (see the implementation task's decision), so no file check is needed here. Other files in the checkout are not the task's and are never consulted, so an unrelated dirty shared checkout blocks nothing.
   - A missing object, or an unreadable ref or count, is **unmeasurable**, and that refuses, naming the remedy (for a gone branch with no recorded tip: release and claim again on a branch). There is no fail-open.
4. An attested pass counts toward BR-199 only when all of these hold:
   - it was recorded after the task's latest claim (the same window as step 3);
   - for a branch claim, its recorded commit (`head_sha`) is reachable from main. A dirty claimed worktree cannot produce a pass at all: BR-159 refuses the capture, and it is the only clean-worktree rule;
   - for a no-branch claim, its `head_sha` equals the main head recorded at capture.

   Evidence and done share this predicate, so they never disagree (#304).
5. `lore evidence` on a no-branch claim records the pass from wherever it runs, with `main_head` added to its attestation; the pass counts only when its `head_sha` equals that `main_head`. Uncommitted files elsewhere there do not refuse it, because they are not the task's work. On a branch claim, `lore evidence` refuses a capture while the claimed worktree is dirty (BR-159).
6. The missing-oracle-file floor (BR-1179) resolves each oracle path in the integration branch's tree (`git cat-file -e main:<path>`), never in a working tree (#329).
7. When `lore done` archives a task, it writes `extra.landing = { kind, start_head, tip, integration_head, measured_at }` from the predicate. `lore integrate` keeps recording its landing (kind `commits`), now with the same fields. The two never disagree, because both call `landingOf`. Legacy integrate landings written before this spec are back-filled once (step 8) with `kind: "commits"` and, where it is known, `tip` = the landing's recorded `branch_head` (the branch tip it landed), never its `landing_commit` (the merge commit on main), because `tip` means the branch tip. `start_head` stays absent only on those pre-back-fill `commits` landings, and no reader needs it for them: a `commits` landing is already archived history, and no predicate recomputes its range.
8. One-time back-fill, with no read-time default:
   - every stored landing without `kind` gets `kind: "commits"`;
   - every open branch claim without `start_head` (claimed before base_sha existed, #422) gets `merge-base(main, tip)`. The tip is the ref's tip, or, when the branch is gone, the newest `head_sha` its evidence recorded after the claim; that head is a recorded git fact of this claim, and it is used only here, once. The same value becomes its `end_tip`.
   - A legacy claim for which neither exists is not given an invented start. The back-fill releases it, with one audit entry naming the reason (`no start or tip recordable`) and the remedy (claim again on a branch). The task then has no open claim, and a re-claim records real facts.
   - Every open no-branch claim on a task that declares a file anchor is released, with one audit entry per claim naming the reason (BR-1468: work that changes files must name its branch) and the remedy (claim again on a branch). After the back-fill, the claim invariant (BR-1468) refuses such a claim, so none can exist again.
   - After the back-fill, the schema requires `kind` on every landing and a sha `start_head` on every open branch claim. A record without them fails to parse instead of being read as something; no `unmeasured` variant exists.

The former `--declare-no-change` declaration is dropped. Its preconditions are all facts the predicate already measures, so a ritual would only restate them.

Issues: #356 (carried by this spec's plan), #304, #422 and #329 (each carried by the task that resolves it).

## Scope

**In**
- Claim `start_head`; `landingOf` in `@lore/core` (pure; git facts come through a port).
- The evidence counting rule; evidence for a claim with no working copy.
- The not-landed and missing-oracle-file floors; `lore done`'s landing record; integrate's post-landing archive using the same predicate.
- Plan close; milestone review's commit range (a `no-change` task adds none).
- `lore get` / `lore log` showing `Landing: no-change` or `Landing: commits <tip>`.
- The one-time back-fill.

**Out**
- Changing how `lore integrate` merges (BR-1245). Its merge-commit landing is a premise of this design (End state 3), and AC-ND-6 asserts it.
- Re-labelling tasks already closed by `lore bulk deprecate`.
- The attested-pass command choice (BR-200 stays: any runner-attested pass, now only when clean and landed).

## Design

### Predicate facts (port `GitFacts`)
- `refTip(branch)`: sha or absent.
- `isAncestor(sha, main)`: true, false, or unmeasurable when the object is missing.
- `rangeCount(start, tip)`.
- `dirtyTracked(worktree)`: list or absent when the worktree is gone.
- `existsInTree(main, path)`.

Implemented once by extending the existing git adapter `packages/lore/src/adapters/real-git-port.ts` (the one adapter `TaskWorkflowService` may import, service module invariant).

### Concurrency
- Two `lore done` calls on one task: the archive walk is CAS-guarded (`expected_version`), so the loser re-reads, finds `archived`, and reports BR-198 (exit 0).
- Integrate and done racing on one task: both compute the same landing from the same facts, so exactly one landing write lands (CAS) and the other is a no-op re-read.
- A commit made to the branch after `lore done` archived the task is outside the recorded `tip`. Integrate later lands it as usual.

### Public interface (falsifier literals, verbatim, once each)

- `packages/core/src/landing.ts`:
  - `const kind = workCount === 0 ? "no-change" : "commits";`
  - `if (!reachable.value) return notLanded("tip-not-on-main"`
  - `if (dirty.length > 0) return notLanded("uncommitted-work"`
  - `if (reachable.kind === "unmeasurable") return notLanded("unmeasurable"`
- `packages/core/src/task-workflow.ts`: `const counts = afterLatestClaim(row, claim) && passLanded(row, claim);`
- `packages/lore/src/service/task-workflow-service.ts` (claim): `if (opts.worktree === undefined && fileAnchors.length > 0) return refuseClaim("work-needs-branch"`.
- `packages/lore/src/service/task-workflow-service.ts`: `facts.existsInTree(integrationHead, oraclePath)`
- `packages/lore/src/store/migrations/landing-backfill.ts`: the back-fill transform (called by the numbered migration) contains `kind: "commits"`, `merge-base` and `no start or tip recordable`.
- `packages/lore/src/service/task-workflow-service.ts` (evidence capture on a branch claim): `recordClaimTip(claim, attestation.head_sha)`.
- `packages/core/src/landing.ts`: `if (claim.workingCopy === undefined) return landedWithoutBranch(counted, mainHeads);` and `if (tip === undefined) return notLanded("unmeasurable"` (gone branch with no recorded `end_tip`).
- `task-workflow-service.ts`: the landing write and the first archive step are CAS-guarded with `expected_version: landingBase.version`.
- `packages/lore/src/service/milestone-review.ts`: `if (landing.kind === "no-change") continue;` (no commit range for a no-change task).

## Design Decisions

Decided with Sequential Thinking; widened per user decision D20 (2026-10-26).

| # | Choice | Chosen | Rejected (why) |
|---|---|---|---|
| D1 | What proves landing | Git facts through one predicate (`landingOf`) | A record written only by integrate (today): no record for commitless, corpus-only or pre-`base_sha` work. A `--declare-no-change` declaration (S2 draft): a ritual restating facts the predicate measures |
| D2 | Start of the work range | `start_head` recorded at claim | Counting `main..branch` (S2 draft, review eng-1): work that reached main another way, or a branch carrying earlier unlanded commits, is misjudged |
| D3 | Tip when the branch is gone | `end_tip` recorded at every capture on the branch and at the claim's end; the newest wins; none recorded means unmeasurable | Record it only at release or run end (S4 draft): the harness may remove the branch before any run-end hook fires, so every commitless harness task would come out unmeasurable. Newest evidence head as an unrecorded fallback, else `start_head` (S3): `start_head` hides commits; the capture-time tip is now a recorded fact instead |
| D4 | Which passes count | A pass counts by its recorded commit: reachable from main (branch claim) or equal to main's head at capture (no-branch claim). Cleanliness is enforced once, by refusing the capture on a dirty claimed worktree (BR-159) | Any attested pass (today): an unlanded run proves code main does not have. Recording a dirty pass and not counting it (S4 draft): two layers for one rule, and the dirty case could not even be produced through the CLI |
| D5 | Legacy records | One back-fill, then required fields | Read-time default (`kind` absent read as integrate): the corpus keeps two readings forever |
| D6 | Oracle files | Resolved in main's tree | Re-ordering integrate to refresh first (#329's first suggestion): fixes one caller only, and done from a stale checkout keeps the bug |
| D7 | Legacy claims the predicate cannot measure (no recordable start or tip; or a no-branch claim on a task with file anchors) | Released once by the back-fill, one audit entry each naming the reason and re-claim | Default to main's head (S3 draft): reads as landed with no measurement. A permanent `unmeasured` schema variant (S3 rework): a legacy state and predicate branch kept forever. Leaving anchored no-branch claims open: they could close as no-change without their file changes ever measured |
| D8 | Work without a branch | A task with file anchors must claim its worktree (refused otherwise); a no-branch claim is corpus-only work, proven by a pass recorded at main's head; adding an anchor to a task while it holds an open no-branch claim is refused | Skip the landing check for every no-branch claim (S3 draft): a task changing files could close unlanded. A per-pass 'anchored files clean' clause (S4 draft): vacuous, since no-branch tasks have no anchors |
| D9 | Reachability premise | State and cite BR-1245 (merge-commit landing), assert it in AC-ND-6 | Patch-equivalence matching (`git cherry`) to tolerate squash or rebase: needed only for a merge strategy lore does not use |
| D10 | Evidence window | After the latest claim, for BR-199 and the tip alike | Any pass ever recorded (today): a pre-re-claim pass could satisfy BR-199 for work the new claim never measured |
| D11 | Anchor added after a no-branch claim | Refused (exit 4, nothing written) in the one anchor writer `commitAnchors` (anchor add, set, lore_anchor_set), telling the holder to re-claim on a branch; a branch claim may add anchors (BR-1468) | Release the no-branch claim when an anchor is added: silently changes another run's lease mid-work and lets a different run take the task |
| D12 | Worktree on no branch | lore claim --worktree <abs path> is refused (exit 4, worktree-without-branch, nothing written) only when the path exists, is a readable git worktree and is on detached HEAD; a nonexistent or non-git path behaves as before (AC-OWN-4: claim() never throws on a nonexistent worktree path); a same-holder refresh already carrying a branch is allowed | Record it as a follow-up issue: leaves a claim with no measurable start_head, a silent path. Refuse every unreadable or nonexistent path: breaks AC-OWN-4 |

## Acceptance Criteria

Stored with `lore ac add`; repeated here for readers of the body.

- **AC-ND-1** (BR-1423, BR-1291): no-change case. In a throwaway corpus and repo, a task is claimed on a worktree and a clean captured pass is recorded at `start_head`. `lore release` then records `end_tip` = `start_head`, the branch is deleted, and `lore done <t> --declare-no-new-tests "read-only"` runs. Result: exit 0, status exactly `archived` (never `deprecated`), `extra.landing.kind` `no-change`, and `lore get` prints `Landing: no-change`. No `--declare-no-change` flag exists (the command with it exits 2). Test: `packages/lore/tests/integration/cli/landing-from-git-facts.bun.test.ts` `-t 'AC-ND-1'`.
- **AC-ND-2** (BR-1423, BR-1291): commits case. A branch with 1 commit after `start_head`, not on main, gets exit 4 `[floor: not-landed]` naming the branch and `tip-not-on-main`. After that commit reaches main through a different branch, the same `lore done` exits 0 with kind `commits`. A branch whose last commit came after its last evidence and was then released and deleted is judged by its recorded `end_tip`, never by the evidence head.
- **AC-ND-3** (BR-199, BR-159): evidence window and branch-claim predicate. A capture on a dirty claimed worktree is refused at capture (exit 4, BR-159; no row is written). These do not count (exit 4 `[floor: attested-pass]`): a pass at a head not reachable from main, and a pass recorded before the task's latest re-claim, even at a main commit.
- **AC-ND-4** (BR-1423, BR-1292): an existing claimed worktree with an uncommitted tracked change gives exit 4 `[floor: not-landed]` `uncommitted-work`. A branch that is gone with no recorded `end_tip` gives exit 4 `unmeasurable`, naming release and re-claim on a branch. A tip object missing from the repository also gives `unmeasurable`. In all three cases nothing is written.
- **AC-ND-5** (BR-208, BR-198): two concurrent `lore done` processes on one task both exit 0, with exactly one landing write and one archive walk. Done racing integrate on the same task leaves one landing whose `kind`, `start_head` and `tip` equal both computations; `measured_at` (and `integration_head`, if main moves between them) legitimately differ and are not compared.
- **AC-ND-6** (BR-1179, BR-1356, BR-1245): `lore integrate` of a branch that adds its own AC test file archives the task in the same run, with no `missing-oracle-file` (#329). After integrate, the branch tip is an ancestor of main (a merge commit), which is the premise of the predicate.
- **AC-ND-7** (BR-1336): the back-fill on a fixture corpus gives kind `commits` to every kind-less landing. A pre-`base_sha` claim whose branch exists gets `merge-base(main, tip)` (#422, which then closes with `lore done`). A legacy claim with a gone branch and post-claim evidence gets `start_head` and `end_tip` from that evidence head. A legacy claim with neither is released, with one audit entry naming the re-claim. A second run changes nothing. Afterwards, a landing without `kind`, or an open branch claim without a sha `start_head`, fails schema parsing. Test: `packages/lore/tests/unit/store/landing-backfill.bun.test.ts`.
- **AC-ND-8** (BR-1291): wiring with the compiled binary. `lore_done` over the tool protocol, plan close, and milestone review (a no-change task adds no commit range) all use `landingOf`. Test: `packages/lore/tests/e2e/landing-from-git-facts-compiled.bun.test.ts`.
- **AC-ND-9** (BR-1468, BR-1423): no-branch claims, both sides.
  - Refused: `lore claim <t>` without `--worktree` on a task declaring a file anchor exits 4 `work-needs-branch`, and no claim is written.
  - Accepted: a task with no file anchors, claimed without a worktree, records a captured pass whose recorded `main_head` equals its `head_sha`, while another file in the shared checkout is uncommitted. `lore done` archives it as `no-change`.
  - Not counted: a no-branch pass whose `head_sha` differs from the main head at capture, so `lore done` exits 4 `[floor: attested-pass]`.
  - Test: `packages/lore/tests/integration/cli/landing-from-git-facts.bun.test.ts` `-t 'AC-ND-9'`.
- **AC-ND-10** (BR-1423, BR-1291): harness ordering. With NO `lore release` and no run-end hook firing:
  - a task whose clean pass was captured at `start_head` has its worktree and branch deleted; `lore done` archives it as `no-change`, using the tip recorded at capture;
  - a task that committed once, then captured a pass (tip recorded = that commit, not on main), has its worktree and branch deleted; `lore done` exits 4 `[floor: not-landed]` `tip-not-on-main`.
  - Test: `packages/lore/tests/integration/cli/landing-from-git-facts.bun.test.ts` `-t 'AC-ND-10'`.


## Acceptance Criteria (structured)

- [⚑] [script] AC-ND-1: No-change case: in a throwaway corpus and repo, a task claimed on a worktree records a clean captured pass at start_head; lore release records end_tip = start_head; the branch is deleted; lore done <t> --declare-no-new-tests 'read-only' exits 0; status is exactly archived (never deprecated); extra.landing.kind is no-change; lore get prints 'Landing: no-change'; lore done --declare-no-change exits 2 (no such flag). False green guarded: exit 0 with a deprecated task fails the exact-status assertion.
  script: test — bun run test:file packages/lore/tests/integration/cli/landing-from-git-facts.bun.test.ts -t 'AC-ND-1' && echo 'AC-ND-1 PASS: commitless work is archived as landed with no change'
  other_command=2
- [⚑] [script] AC-ND-2: Commits case: a branch with 1 commit after start_head that is not on main makes lore done exit 4 with '[floor: not-landed]', the branch name and 'tip-not-on-main'; after that commit reaches main through a different branch the same lore done exits 0 with kind commits; a branch whose last commit came after its last evidence, then released and deleted, is judged by its recorded end_tip, never by the evidence head. False green guarded: taking the tip from evidence would archive the post-evidence commit as landed; that case is asserted.
  script: test — bun run test:file packages/lore/tests/integration/cli/landing-from-git-facts.bun.test.ts -t 'AC-ND-2' && echo 'AC-ND-2 PASS: landing follows reachability from main, by any route'
  other_command=2
- [⚑] [script] AC-ND-3: Evidence window and branch-claim predicate: a capture on a dirty claimed worktree is refused at capture (exit 4, BR-159; no evidence row is written); a pass at a head not reachable from main, and a pass recorded before the task's latest re-claim (even at a main commit), do not count: lore done exits 4 with '[floor: attested-pass]'. False green guarded: counting every landed pass passes the reachability case; the pre-re-claim case is asserted.
  script: test — bun run test:file packages/lore/tests/integration/cli/landing-from-git-facts.bun.test.ts -t 'AC-ND-3' && echo 'AC-ND-3 PASS: only clean passes at landed commits after the latest claim count'
  other_command=2
- [⚑] [script] AC-ND-4: An existing claimed worktree with an uncommitted tracked change makes lore done exit 4 with '[floor: not-landed]' 'uncommitted-work'; a branch gone with no recorded end_tip makes it exit 4 'unmeasurable', naming release and re-claim on a branch; a tip object missing from the repository also gives 'unmeasurable'; nothing is written in any case. False green guarded: defaulting a gone branch's tip to start_head would archive it as no-change; the refusal is asserted.
  script: test — bun run test:file packages/lore/tests/integration/cli/landing-from-git-facts.bun.test.ts -t 'AC-ND-4' && echo 'AC-ND-4 PASS: unlanded or unreadable work refuses and writes nothing'
  other_command=2
- [⚑] [script] AC-ND-5: Two concurrent lore done processes on one task both exit 0 and the task carries exactly one landing write and one archive walk; lore done racing lore integrate on the same task leaves one landing whose kind, start_head and tip equal both computations, while measured_at (and integration_head, if main moves between them) legitimately differ and are not compared. False green guarded: running the calls one after another hides a missing compare-and-set; the processes are started together.
  script: test — bun run test:file packages/lore/tests/integration/cli/landing-from-git-facts.bun.test.ts -t 'AC-ND-5' && echo 'AC-ND-5 PASS: concurrent closers write one landing'
  other_command=2
- [⚑] [script] AC-ND-6: lore integrate of a branch that adds its own AC test file archives the task in the same run, with no missing-oracle-file refusal (#329); after integrate the branch tip is an ancestor of main (merge commit, the BR-1245 premise of the predicate); a criterion naming a file absent from main still refuses with '[floor: missing-oracle-file]'. False green guarded: treating every oracle file as present passes the first case; the absent-file case is asserted.
  script: test — bun run test:file packages/lore/tests/integration/cli/landing-from-git-facts.bun.test.ts -t 'AC-ND-6' && echo 'AC-ND-6 PASS: oracle files are read from main, not a stale checkout'
  other_command=2
- [⚑] [script] AC-ND-7: The one-time back-fill on a fixture corpus gives kind commits to every kind-less landing; a pre-base_sha claim whose branch exists gets merge-base(main, tip) (#422, then closes with lore done); a legacy claim with a gone branch and post-claim evidence gets start_head and end_tip from that evidence head; a legacy claim with neither is released with one audit entry naming re-claim; a second run changes nothing; afterwards a landing without kind, or an open branch claim without a sha start_head, fails schema parsing. False green guarded: inventing a start for the tipless claim would archive it; its release is asserted.
  script: test — bun run test:file packages/lore/tests/unit/store/landing-backfill.bun.test.ts && echo 'AC-ND-7 PASS: legacy landings and claims are back-filled once, then required'
  other_command=2
- [⊖] [script] AC-ND-8: Wiring through the compiled binary: lore_done over the tool protocol archives the no-change task; plan close of a plan whose only task has a no-change landing passes; that plan's milestone review input adds no commit range for the task. False green guarded: a service-only test passes while a caller keeps its own landing logic; every caller is exercised through dist/lore.
  script: test — bun run test:file packages/lore/tests/e2e/landing-from-git-facts-compiled.bun.test.ts && echo 'AC-ND-8 PASS: every closer and reader uses the one landing predicate'
  other_command=2
- [⚑] [script] AC-ND-9: No-branch claims, both sides: lore claim <t> without --worktree on a task declaring a file anchor exits 4 'work-needs-branch' and writes no claim; a task with no file anchors claimed without a worktree records a captured pass whose recorded main_head equals its head_sha while another file in the shared checkout is uncommitted, and lore done archives it as no-change; a no-branch pass whose head_sha differs from the main head at capture does not count (lore done exits 4 '[floor: attested-pass]'). False green guarded: skipping the landing check for every no-branch claim passes the corpus-only case; the anchored-task refusal is asserted.
  script: test — bun run test:file packages/lore/tests/integration/cli/landing-from-git-facts.bun.test.ts -t 'AC-ND-9' && echo 'AC-ND-9 PASS: work that changes files needs its branch; corpus-only work is proven at main head'
  other_command=2
- [⚑] [script] AC-ND-10: Harness ordering, with no lore release and no run-end hook firing: a task whose clean pass was captured at start_head has its worktree and branch deleted and lore done archives it as no-change from the tip recorded at capture; a task that committed once and then captured a pass (recorded tip = that commit, not on main) has its worktree and branch deleted and lore done exits 4 with '[floor: not-landed]' 'tip-not-on-main'. False green guarded: recording the tip only at release would make the first case unmeasurable; both cases run without release.
  script: test — bun run test:file packages/lore/tests/integration/cli/landing-from-git-facts.bun.test.ts -t 'AC-ND-10' && echo 'AC-ND-10 PASS: the capture-time tip decides after the harness removes the branch'
  other_command=2

## Code anchors

- packages/core/src/landing.ts#landingOf
- packages/lore/tests/integration/cli/landing-from-git-facts.bun.test.ts
- packages/lore/tests/unit/store/landing-backfill.bun.test.ts
