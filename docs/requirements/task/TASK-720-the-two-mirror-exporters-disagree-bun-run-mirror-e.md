---
id: TASK-720
type: task
role: plan
title: "The two mirror exporters disagree: bun run mirror:export never rewrites a changed file but the test suite does, so the documented 're-export and commit before the run' remedy is unreachable"
status: draft
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: PRD-001
---
Sharper symptom of 01KZVAXZQAT4S9F4HGQT45YTT9, measured 2026-08-13 with a controlled before/after.

Sequence, all on main:
1. Edited spec-multi-session-concurrency-queryable-ownership-checkout via lore set (Goal paragraph rewritten), corpus reached v20.
2. Ran 'bun run mirror:export' -> exit 0. Committed the result as ec645f29. That commit contains exactly two files: .lore/export-index.json and ONE newly created task mirror. It did NOT touch SPEC-142.
   git show ec645f29:docs/requirements/spec/SPEC-142-....md | grep -c 'Goal, scoped to what actually gates'  ->  0
3. Ran the full suite. It went red on spec-loop-e2e.bun.test.ts's repo-pollution-guard, reporting the corpus dirty BEFORE that file's own suite ran, offending path SPEC-142.
4. Inspected the working tree afterwards:
   grep -c 'Goal, scoped to what actually gates' docs/requirements/spec/SPEC-142-....md  ->  1

So the file WAS rewritten with the new content - by something inside the test run, not by the script the repo tells you to run. The two writers disagree about whether a content change warrants a rewrite.

Why this is worse than the original filing. CLAUDE.md documents the remedy for the standing hazard as: any corpus write reddens the next full-suite run until the mirror is re-exported AND committed. That remedy cannot be executed for a doc whose CONTENT changed:
  - the manual export is a no-op on it, so 'git status' reports clean and there is nothing to commit;
  - the suite then rewrites it and the guard fires;
  - re-running after committing the suite's output works only until the next content edit.
An operator following the documented procedure exactly will still be red, with no signal that the procedure did not do what it claims.

This also means every green full-suite verdict recorded after a content-only corpus edit was green only because no test happened to rewrite that particular file first - the ordering, not the state, decided it.
