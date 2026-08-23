---
id: TASK-765
type: task
role: plan
title: "[Skill:implement] stamp axis classified by the immutable arming_rev cutoff, with the mandatory accept control"
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
