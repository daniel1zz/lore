---
id: TASK-1797
type: task
role: plan
title: "check:ac-oracle-ownership scans only what changed so the integrate floor halves"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Measured 2026-10-19 (knowledge-measured-cost-of-a-lore-integrate-attempt-2026-10-19): `check:ac-oracle-ownership` takes a median 84 s of a 152 s integrate floor — 55 % of every attempt — and is therefore most of the window in which another session's integration can win the CAS race. It re-scans every spec's criteria and every test file on every run.

End state: the check is incremental and stays exact. It judges only what can have changed its verdict since the last green run on the base it merges onto: criteria of specs changed in the corpus since that run, and test files changed in the merged tree's diff against main (plus files referencing changed ids). Any input it cannot bound (no prior verdict, unreadable cache, schema change of the check) falls back to the full scan, loudly labelled as such — never a silently partial check. Same findings, same exit, on every input.

AC: red-first — (a) on the real tree, a floor run after a change touching one test file finishes the step in under 15 s and reports the same findings as a full scan on that tree; (b) a seeded unowned-ac-reference introduced in the changed file is still found; falsifier: a cache that skips the changed file (the check stays green with the seeded finding).
