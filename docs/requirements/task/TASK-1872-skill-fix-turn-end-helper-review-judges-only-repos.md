---
id: TASK-1872
type: task
role: plan
title: "[Skill:fix] Turn-end helper review judges only repository content: gitignored paths are not anchor findings"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: S
Problem (reported by a peer session 2026-10-19, helper acfb2e95): the turn-end helper review reports a helper's `.scratch/*` files as "changed files outside the anchors of its task". `.scratch/` is gitignored (.gitignore:57) and is where lore-implementer.md tells helpers to put temp files, so two shipped assets contradict each other. Source: packages/lore/src/service/helper-scope-review.ts ~L223-256 — `inside` collects every Write/Edit path in the working copy, ignored or not.
Approach: anchor coverage judges repository content only: a path the helper's working copy's git ignores (git check-ignore, run in that working copy) is not judged against anchors. One criterion, git's ignore rules; no `.scratch/` special case, no allowlist. A probe failure is reported, never silently treated as ignored.
AC: unit test with a throwaway repo: an edit under an ignored dir is not a finding; an edit to a tracked path outside anchors still is; a failing ignore probe yields a "not measured" finding naming the path. Make the first go red once.
