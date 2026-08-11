---
id: TASK-344
type: task
role: plan
title: "Derive falsified as a fourth coverage dimension and add the pass_unfalsified state"
status: archived
priority: high
phase: "mechanisms"
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PLAN-081
plan: PLAN-081
links:
  - {id: TASK-339, type: blocks}
---
Per the governing spec M1 (derivation half only — surfacing is a separate task).

Add a per-criterion `falsified` count to `computeAcCoverage`: `ac_ref` rows whose `result` is `expected-fail` or `fail`. Derive it in the SAME single pass `pass`/`fail`/`attested_pass`/`attested_fail` already use — no second traversal.

Add `pass_unfalsified` to `deriveAcCoverageState`, inserted BELOW `pass` in the fail-first precedence so an attested pass never degrades.

Context: `expected-fail` refs are today counted in NEITHER bucket (`acceptance.ts:209`) — the raw material exists, only the derivation is missing.

⛔ Do NOT touch any CLI/adapter file. Surfacing belongs to the `surfacing` phase task, whose anchors cover it.
⛔ Do NOT add any gate or refusal. This mechanism is report-only by decision (82% of the corpus would violate).
