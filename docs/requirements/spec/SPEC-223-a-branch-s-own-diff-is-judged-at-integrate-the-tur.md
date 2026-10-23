---
id: SPEC-223
type: spec
role: spec
title: "A branch's own diff is judged at integrate; the turn-end helper review is removed"
status: approved
priority: critical
created: 2026-10-19
updated: 2026-10-19
tags: [redesign, integrate, turn-end-review]
---
## Overview/Goal

Implements the first part of D3 in `adr-facts-live-once-next-to-what-they-describe-corpus-changes`: work is judged where it enters main, on the branch's own diff, not by replaying activity logs at every turn end.

Measured on 2026-10-19:
- The turn-end helper review (`assets/hooks/stop-turn-review.mjs` step 4b, `lore session trail-review`, `packages/lore/src/service/helper-scope-review.ts`) took 117 s for one session's 1296 unjudged helpers. Its budget is 15 s.
- For each helper it rescans every helper and every edit record of every turn, so its cost grows with the square of the session's helper count.
- A timed-out review marks nothing judged, so every later turn submits a larger set and times out again. From then on helper work goes unreviewed while each turn still pays for the spawn.
- Run by hand, the review returned 24 findings. About 20 named files that entered a branch by merging main, or by merging one feature branch into another, as if the helper had written them. It judges activity (which files changed in a working copy) instead of the artifact that reaches main.

Work in a worktree affects nobody until it lands. The one place where it lands is `lore integrate`, and there the branch's own change is exactly `git diff <merge-base(main, branch)> <branch>`. Judging that once per landing costs time proportional to the branch's change, sees every write whatever tool made it, and excludes files merged in from main by construction.

## Scope

**Own-diff judgment at integrate.** Before the floor runs, `lore integrate <branch>` computes the branch's own change: the files and, for files with a symbol-scoped anchor, the top-level symbols changed between `merge-base(main, branch)` and the branch tip. Symbols are found by the same top-level symbol extraction the edit-time anchor gate uses. The branch is refused with exit 4, main and every working tree unchanged, and nothing landed, when:
1. no task belongs to the branch. The tasks of a branch are every task claimed on it (the claim records the branch) plus every task of a plan whose declared integration branch it is (`lore plan integration-branch`). Every clause below judges against the anchors of all of them; or
2. a changed path, or a changed top-level symbol, is held by an anchor of an unarchived task that is NOT a task of this branch and whose work has not landed (another live claim). The refusal names each such `path` or `path#Symbol` and the task that holds it. Holding follows the edit-time anchor gate's overlap rule: a whole-file anchor holds every symbol of the file, and a symbol anchor holds only that symbol. Changed paths include added, modified and deleted files and both sides of a rename. Changed symbols are top-level symbols whose text differs between the merge-base and the tip; a deleted symbol counts under its old name and a renamed one under both names. A change outside every top-level symbol counts as a change to the file only when the other task holds the whole file; or
3. the branch's own change matches a declared co-change rule's trigger and changes no file matching its required pattern. The refusal names the rule.

A branch's own change outside its own tasks' anchors, held by no other live claim, is not refused. The landing record lists those paths as the task's landed footprint (`outside_anchors`), so what actually landed is always visible and never needs a round trip to add anchors. Anchors exist to keep concurrent tasks off each other's work, not to pre-declare every file. Measured on the 11 branches landed on 2026-10-19 that the old review flagged: 9 changed files outside their anchors, mostly the task's own new test files and source files the plan had not foreseen. Whether any of them collided with another live claim at the time was not reconstructed. A branch carrying another feature branch's unlanded commits is refused by clause 2 whenever those commits touch what another live claim holds. Starting every agent worktree from main, which removes the residual case, belongs to the later D3 spec on dispatch and worktree base, and is out of scope here.
The judgment reads git and the claims, and writes nothing. Each refusal names the rule it enforces.

**The turn-end helper review is removed.**
- Delete step 4b of `stop-turn-review.mjs` (the helper snapshot, the `trail-review` spawn, the judged markers).
- Delete the `lore session trail-review` subcommand and `helper-scope-review.ts`, together with the code and tests that exist only for them.
- Delete the `helpers/<agent>.judged.json` files they wrote.

The turn-end hook does no work proportional to the number of helpers. The session trail itself (`lore session trail`, handoff file capture) and the main-session source-edit finding are unchanged.

**One turn-end check replaces the helper writes it covered.** The shared checkout is a read-only view of main. At turn end, the hook runs one `git status --porcelain` on the shared checkout. Any changed or untracked, not-ignored file there is a finding, listed by path, in the hook's single block. A clean checkout adds nothing. This replaces the review's "changed a file outside its own working copy", and its cost does not depend on how many helpers ran. A path the main-session source-edit finding already reports in the same turn is not listed again: that finding owns the main session's own edits, and this one reports what remains.

**Retired.**
- BR-1147 (per-helper anchor judgment at turn end) and BR-1148 (each helper end judged by exactly one review) are retired.
- BR-1152 (co-change judged per run at turn end) is retired. Clause 3 above replaces it, as a new rule on the integrate leaf.
- AC-ST-7, AC-ST-9 and AC-ST-10 are superseded by this spec's criteria.
- AC-ST-8 stays, under BR-1150: `lore run tasks` still lists a run's claimed tasks.

## Acceptance Criteria

Structured criteria AC-DJ-1 to AC-DJ-4 (`lore ac list`).


## Acceptance Criteria (structured)

- [⊘] [script] AC-DJ-1: Throwaway repo, lore integrate configured, floor_command 'true'. Task T is claimed on branch X with anchor src/a.ts. Task U is claimed on branch Y, not landed, with anchors src/b.ts#bar and src/e.ts. (1) X changes src/a.ts and the body of foo in src/b.ts, and adds src/c.ts: integrate exits 0, and T's landing record lists src/b.ts and src/c.ts under outside_anchors. (2) A fresh X2 also changes bar in src/b.ts and deletes src/e.ts: exits exactly 4; stderr names BR-1346, src/b.ts#bar, src/e.ts and task U; main's ref and every working tree are byte-unchanged. (3) After U is archived, X2 exits 0. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a judge that diffs against main's tip instead of the merge-base charges X with main's later changes; the fixture lands a change to src/e.ts on main after X3 was cut, merges main into X3 (which never touches src/e.ts itself), and asserts X3 exits 0. Made red once by switching the diff base to main's tip.
  script: test — bun run test:file packages/lore/tests/integration/dj-own-diff-scope.bun.test.ts && echo 'AC-DJ-1 PASS: own diff judged against claimed anchors'
  other_command=3
- [⚑] [script] AC-DJ-2: Throwaway repo, trivial floor, .lore/config.yaml declaring co_change rule {name: manifest, when: assets/**, require: gen/manifest.ts}. Task claimed on X anchors assets/ only. (1) X changes assets/x.txt without gen/manifest.ts: integrate exits exactly 4, stderr names BR-1347 and the rule name 'manifest'. (2) X also changes gen/manifest.ts (not anchored): exits 0 and lands. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a judge that treats the required file as out-of-anchor refuses case (2) under BR-1346; the test asserts case (2) lands. Made red once by dropping the co-change coverage clause.
  script: test — bun run test:file packages/lore/tests/integration/dj-co-change.bun.test.ts && echo 'AC-DJ-2 PASS: co-change judged on the own diff'
  other_command=3
- [⚑] [script] AC-DJ-4: In a mkdtemp state base and throwaway repo, with a PATH stub that counts lore invocations and a session trail holding 3000 helper records with unjudged ends: (1) the stop-turn-review hook on a clean shared checkout exits 0 silently, invokes 'lore session trail-review' zero times and writes no helpers/*.judged.json; (2) with an untracked not-ignored file src/x.ts in the shared checkout it blocks once and the block names src/x.ts and BR-1349; (3) 'lore session trail-review' exits exactly 2 as an unknown subcommand; (4) packages/lore/src/service/helper-scope-review.ts does not exist. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a hook that keeps the review but skips it when the trail is large passes (1) only by size; the fixture also runs with 2 helpers and asserts zero spawns. Made red once by restoring the trail-review spawn.
  script: test — bun run test:file packages/lore/tests/integration/dj-turn-end-no-helper-review.bun.test.ts && echo 'AC-DJ-4 PASS: no helper review; shared checkout checked once'
  other_command=2
- [⊘] [script] AC-DJ-3: Throwaway repo, floor_command 'true'. Plan P declares integration branch I (lore plan integration-branch P I). Tasks T1 (anchor src/a.ts) and T2 (anchor src/b.ts) of P are claimed on their own branches, which are merged into I; no task is claimed on I itself. Task U, outside P, is claimed on unlanded branch Y and holds src/z.ts. (1) integrate I, whose own change touches src/a.ts and src/b.ts, exits 0 and records the landing on T1 and T2. (2) A fresh I that also changes src/z.ts exits exactly 4 naming BR-1346, src/z.ts and U. (3) A branch J that belongs to no plan and has no claimed task exits exactly 4 naming BR-1348 and J. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a judge that reads only claims recorded on the branch treats T1 and T2 as other live claims and refuses (1); the test requires (1) to land. Made red once by ignoring the plan's integration branch.
  script: test — bun run test:file packages/lore/tests/integration/dj-integration-branch-tasks.bun.test.ts && echo 'AC-DJ-3 PASS: an integration branch is judged against its plan tasks'
  other_command=3

## Code anchors

- assets/hooks/stop-turn-review.mjs
- packages/lore/tests/integration/dj-turn-end-no-helper-review.bun.test.ts
