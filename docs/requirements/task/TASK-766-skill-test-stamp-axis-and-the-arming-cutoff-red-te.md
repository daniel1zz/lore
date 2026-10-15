---
id: TASK-766
type: task
role: plan
title: "[Skill:test] stamp axis and the arming cutoff — RED test scenarios"
status: deprecated
priority: high
phase: "P2 Stamp mechanisms"
created: 2026-08-23
updated: 2026-10-10
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-758, type: blocks}
  - {id: TASK-765, type: supersedes}
---
⛔ RESTRUCTURED 2026-08-23: this task ABSORBED `task-skill-implement-stamp-axis-classified-by-the-immutable` (now invalidated, superseded by this doc). Reason, measured: `lore done` carries THREE independent conjunctive floors, and the third — `findMissingUnfilteredTestFileRuns` (`packages/lore/src/service/task-workflow-service.ts:2934`) — demands, for EACH declared `.test.ts` anchor, an `oracle:test result:pass` row running that file UNFILTERED, and offers NO escape hatch (the other two floors do: `--override-attestation`, `--declare-no-new-tests`). A RED-only task whose declared anchor IS the failing test file can therefore never archive, which deadlocks the paired impl task that `blocks` on it. Collapsing the pair into ONE archival unit satisfies all three floors truthfully: the red row comes from stage RED's agent, the attested unfiltered pass from stage GREEN's `lore verify`.

Structure: TWO SEQUENTIAL CLAIMS ON ONE TASK — stage RED then stage GREEN, each claimed by a DIFFERENT agent. Plan A D-A3 is preserved: the party that records the red must have no stake in it passing; the claim lease serialises them, and stage GREEN claims only after stage RED has released.

## Stage RED

Estimate: S
Source: AC of the paired stamp-axis task; SPEC-143 AC-CT-3, C2, ADR-034 (v5, amended)
TDD-Role: red | Paired-Impl: the AC-CT-3 stamp-axis task
Dimensions: D-FUNC

Scenarios:
- Given a throwaway corpus and a stamp-less row whose audit.id is ABOVE arming_rev, When attestationFloor evaluates it, Then it is REFUSED (stamp = unbound).
- Given a stamp-less row whose audit.id is at or BELOW arming_rev, When the SAME floor evaluates it, Then it is ACCEPTED (stamp = legacy_unbound). ⛔ This half is the CONTROL; without it the test cannot distinguish the design from a blanket refusal.
- Given both rows, When the capture_source distribution is read, Then both appear DISTINCTLY labelled — neither silently dropped nor merged.
- Given an UNDEFINED recorded stamp, When stampCurrency classifies it, Then stamp is never "stamped".

AC:
- All four scenarios exist as executable tests against a throwaway corpus.
- RED before implementation, failing for missing-implementation reasons.
- ⛔ Red recorded by THIS agent at the moment it is red: `lore evidence <this task> --oracle test --command "<cmd>" --result expected-fail --ac AC-CT-3`.
  ⛔ The `--ac` reference is mandatory, not decoration: without it the red is free prose and "which ACs have an observed-red falsifier" stays unqueryable corpus-wide — the exact residual SPEC-143's own Falsifier-debt section names.


## Stage GREEN — absorbed verbatim from the invalidated impl task

Estimate: M
Approach: per SPEC-143 C2 and AC-CT-3 (v51), and ADR-034 as amended 2026-08-21. Classification uses arming_rev — MAX(id) FROM audit captured once in the arming commit and stored as a constant — compared against the row's audit.id. ⛔ A timestamp cutoff is explicitly rejected: it would be mintable by choosing when to write, while audit.id sits on an append-only hash-chained table.
Source: SPEC-143 C2, AC-CT-3, Revision Records R1/R9; ADR-034 Amendment.
Dimensions: D-FUNC
Scope-Alt: none — the accept-control half is mandatory and cannot be deferred.
Covers: AC-CT-3

Blocked by the P0 type foundation: consumes StampClass and writes stampCurrency's stamp-axis logic. ⛔ Shares gate-predicates.ts with P0, hence the blocks link rather than parallel dispatch.

⛔ This task owns the STAMP AXIS ONLY. The radius axis is AC-CT-4's, and the floor's two-axis precedence is AC-CT-9's (part B). Do not implement the radius branch here.

AC:
- Given a stamp-less row above arming_rev, When attestationFloor evaluates it, Then REFUSED.
- Given a stamp-less row at or below arming_rev, When the same floor evaluates it, Then ACCEPTED — so arming retro-fails nothing (N2).
- Given both, When the capture_source distribution is rendered, Then each appears under its own label with its own count.
- ⛔ Run both declared falsifiers once and record each: (a) make stampCurrency return "stamped" for an UNDEFINED recorded stamp → command exits EXACTLY 1; (b) set arming_rev to 0 so every legacy row reclassifies as unbound → the same command exits EXACTLY 1 on the accept half.


⛔ Stage GREEN closes with `lore verify`, NOT a hand-recorded pass — one attested run of the declared AC command must also be an UNFILTERED run of every `.test.ts` anchor on this task, or the third floor above will refuse the archive.
