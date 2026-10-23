---
id: PLAN-217
type: plan
role: plan
title: "D3a: judge a branch's own diff at integrate; remove the turn-end helper review"
status: archived
priority: critical
created: 2026-10-19
updated: 2026-10-19
tags: [redesign, integrate]
parent: SPEC-223
---
## Goal

Implement `spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end`. Priority: the turn-end helper review costs every turn a spawn that times out, so task B goes first. Task A starts after task B lands (a blocks link): both may change shipped assets and so the generated assets manifest, which one task at a time owns. Each task's file anchors are its ownership list; edit-scope.ts holds no symbol extractor, so B's import change there does not touch A's work.

## Tasks

- **B: remove the turn-end helper review; one shared-checkout check (AC-DJ-4).**
  - Delete: step 4b of `stop-turn-review.mjs`; `runTrailReview`, `snapshotUnjudgedHelpers` and `markHelpersJudged` in `assets/hooks/lib/session-trail.mjs`; the `lore session trail-review` subcommand; `helper-scope-review.ts`; their tests.
  - Move the git-ignore probe (`spawnGitCheckIgnore`, `IgnoreProbeFn`) that `edit-scope` borrows from `helper-scope-review.ts` into its own module.
  - Keep `co-change-review.ts`, which task A uses.
  - Add the `git status --porcelain` check on the shared checkout (BR-1349). A path the main-session source-edit finding already reports in the same turn is not listed again. Regenerate the assets manifest.
- **A: own-diff judgment at `lore integrate` (AC-DJ-1, AC-DJ-2, AC-DJ-3).**
  - Before the floor: compute the tasks of the branch (BR-1348) and the own change between `merge-base(main, branch)` and the tip, per path and per top-level symbol. Refuse only what another live claim holds (BR-1346, collision-only; corrected 2026-10-19). Record the own change outside the branch's own anchors on the landing record as `outside_anchors`. Judge co-change (BR-1347) by reusing `co-change-review.ts`.
  - Exit 4 refusals name the rule; nothing is written.
  - Top-level symbol extraction is shared with the edit-time gate, not duplicated.

## After both land (main agent)

- After B lands: delete every `helpers/*.judged.json` under the session state base on this machine in one pass (`find ~/.claude/session-state/sessions -name '*.judged.json' -delete`), then confirm none remain. The product ships no sweep: nothing reads the markers any more, and consumer trails are removed by the existing SessionStart retention (AC-ST-5).
- Supersede AC-ST-7, AC-ST-9 and AC-ST-10 of `spec-session-trail-a-session-local-record-of-what-each-run-4` with AC-DJ-2, AC-DJ-1 and AC-DJ-4.
- Remove BR-1147 from AC-ST-8's citations.
- Run `lore rule apply` on the spec, which lands its whole change set: it retires BR-1147, BR-1148 and BR-1152, and makes BR-1346, BR-1347, BR-1348 and BR-1349 live (BR-1347, on the integrate leaf, replaces BR-1152). Check the output lists all seven.
- Run `lore setup --yes` so the shipped hook is reinstalled.
