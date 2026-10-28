---
id: TASK-1513
type: task
role: plan
title: "ac set --correction of a command forces a citation, so batch repoints mint wrong cites"
status: deprecated
priority: high
created: 2026-10-17
updated: 2026-10-25
tags: []
parent: PLAN-197
plan: PLAN-197
---
> ⚠ INVALIDATED 2026-10-17T07:56:09.737Z; Premise wrong: the per-criterion citation requirement is an approved, deliberate rule in baseline-cite-a-baseline-rule (enforce mode on an armed branch: every added or revised criterion must cite a live rule; a criterion with no applicable rule takes a bounded exemption). It is not a gate stricter than BR-1007. The 2026-10-17 batch of wrong cites is handled by task-skill-review-tg-27-audit-the-133-citations-auto-added-by (user decision: add the missing rules, exempt in between).

Estimate: M
Approach: Measured 2026-10-17 during task-skill-implement-tg-23-one-runner-vitest-on-the-bun-runtime: a command-only `lore ac set <spec> <AC> --command ... --correction "<why>"` on an AC with no rule citation is refused with AC_CITE_REQUIRED, and the refusal prints "Cite one: lore ac cite <spec> <AC> BR-n". A scripted repoint of 322 ACs therefore added the first suggested BR to 131 ACs. Sampled 6 (AC-CTX-5→BR-1060, AC-DC-1→BR-489, AC-CMC-3→BR-427, AC-MIS-4→BR-700, AC-CP-6→BR-320, AC-RR-3→BR-700): only 2 are relevant. The gate turns a mechanical correction into a forced, mostly wrong citation, so the corpus records a traceability claim nobody made. Fix at the mechanism: a correction that changes only verify fields (command/timeout/falsifier) must not demand a new citation (the citation requirement belongs to statement edits and approval), or the refusal must not print a pasteable guess. Red-first test both directions.
Source: root CLAUDE.md North Star (the corpus must not lie); BR-1007 (approval requires a cited criterion)
AC: a command-only --correction on an uncited AC succeeds without --cite; a statement change still enforces the citation rule as today.
