---
id: TASK-763
type: task
role: plan
title: "[Skill:implement] blastRadiusChanged returns RadiusMeasurement, resolvability by pathspec validity"
status: draft
priority: high
phase: "P2 Stamp mechanisms"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-758, type: blocks}
---
Estimate: M
Approach: per SPEC-143 C3 and AC-CT-4 (v51). Implementation MUST be `git diff --quiet <recorded HEAD> HEAD -- <pathspecs>`; the return type is RadiusMeasurement from P0, NOT `boolean | "unmeasured"` (retired in R9 as the loose primitive-plus-sentinel union real-git-port.ts forbids in its own source). Memoize per distinct digest — measured ~10.9ms per spawn, ruinous per row.
Source: SPEC-143 C3, AC-CT-4, D4, Revision Record R8 (the measured git exit semantics).
Dimensions: D-FUNC
Scope-Alt: memoization could ship separately, but 200 rows = 2.2s of pure fork, so it is in scope.
Covers: AC-CT-4

Blocked by P0 (consumes RadiusMeasurement).

⛔ RESOLVABILITY IS A PATHSPEC PROPERTY, NOT AN EXISTENCE PROPERTY. Measured 2026-08-20: `git diff --quiet <rev> HEAD -- <p>` exits 1 for a path created after `<rev>`, 1 for one deleted after it, and 0 if it never existed — existence is irrelevant to soundness. An existence-based rule would classify every red-first AC unmeasured (29% of this corpus vs 6% under the pathspec rule).

AC:
- Given a peer commit inside the declared radius, Then stale; outside it, Then bound.
- Given a pathspec absent at the recorded HEAD but created by a peer, Then stale; live control — one that never exists stays bound.
- Given an AC yielding no pathspec, Then unmeasured; live control — a sibling yielding one still classifies bound.
- ⛔ Run both declared falsifiers once and record each: (a) swap the diff for `merge-base --is-ancestor` → exits EXACTLY 1, and note (b) still passes under ancestry while (a) breaks; (b) make resolvability require existence → exits EXACTLY 1 on the created-pathspec half.
