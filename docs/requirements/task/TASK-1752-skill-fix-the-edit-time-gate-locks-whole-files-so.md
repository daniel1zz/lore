---
id: TASK-1752
type: task
role: plan
title: "[Skill:fix] The edit-time gate locks whole files, so disjoint edits to a hotspot like app.ts serialise across sessions"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem (observed 2026-10-19): the edit-time anchor gate locks whole files. `packages/lore/src/app.ts` (the composition root) is touched by nearly every wiring task, so one session's claim on it blocked GS-T9 twice in a row (first the outline-removal claim, then `task-removing-a-site-mapping-is-refused-while-main-still`), and DC2-22 waits on it too — although the edits are disjoint (different functions, additive lines). Whole-file mutual exclusion on a hotspot serialises unrelated work across sessions, which the North Star (many concurrent sessions) refuses.
Approach: anchors and the edit-time gate support symbol scope (`path#Symbol`, already the code-anchor grammar): a declare/edit on a file is refused only when the held anchor's scope and the edit's touched symbols overlap (whole-file anchors keep today's meaning); the hook computes the touched top-level symbols of an Edit from old_string's location. Measure the hook's added latency on the in-anchor path (must stay under 100 ms).
AC: throwaway repo: task A holds `app.ts#wireIssueCloseOnArchive`; task B declares `app.ts#buildIssueIntake` and edits a different function → allowed; B's edit inside wireIssueCloseOnArchive → denied naming A; a whole-file hold still denies any edit. Runner-produced red.
