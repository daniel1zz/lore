---
id: PLAN-169
type: plan
role: plan
title: "Fix #104: the site census follows dependency-injected functions"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: SPEC-157
phases:
  - {name: "fix", description: "RED then implement"}
---
# Fix #104: the site census follows dependency-injected functions

governance_mode: unattended (owner: "继续，快速全部做完")

## Acceptance
AC-BLS2-20 on SPEC-157.

## Invariants
- RED first by a separate tester; the implementer never edits test assertions.
- No silent fallback; exit codes measured without pipes.
- Every armed branch is at 0 coverage gaps when this plan closes; between task 2's merge and task 3's mapping new sites may show as gaps; task 3 runs in the same session as the merge, and the plan cannot close while any branch is red.

## Tasks
1. RED (tester, worktree)
2. Implement (implementer, worktree)
3. Map new sites (orchestrator on main, blocked by 2): `lore baseline map` each newly reported site; exit when all 12 branches report coverage exit 0 — task-map-104-s-newly-found-census-sites-on-main-and-restore-0

## Risk register
| Risk | Impact | Mitigation |
|---|---|---|
| Change reaches consumers of the touched module | M | test:changed + main re-run after merge |
| Site keys or not_measured counts shift on armed branches (AC-BLS2-5/15/12/18) | M | re-run AC-BLS2-5/15 and all-12 coverage on main after merge; task 3 maps |
| Session ends inside the red window | M | handoff names task 3 as first next step; plan-close refuses while red |


## Answers to the plan review (2026-10-10)
- **Determinism (C1)**: following injection stays static — the census resolves an injected call through the declared type of the injected parameter/property (TypeScript checker), never by running code. Where the type names an interface with no single implementation reachable from the command's composition root, the call is reported `not_measured` (C1's existing rule, unchanged), so no amendment-log entry is needed.
- **New sites on armed branches**: the implementer reports every newly found site per branch in its return. A worktree cannot write the corpus (#72), so the orchestrator maps them on main after merge (`lore baseline map`) and re-runs the 12-branch coverage check; the plan closes only when every branch is back at 0 gaps. The invariant may be red between merge and mapping; that window is this plan's task 3.
3. Orchestrator after merge: map new sites, re-run all 12 branch coverage (exit 0 each).

## Answers to the escalation (2026-10-10, second round)
- **AC-BLS2-20** lives on SPEC-157 (= spec-baseline-slice-2-completeness-census-per-branch-citation) as a structured criterion added with `lore ac add` (SSOT: `lore ac list SPEC-157`); oracle `test`, file `packages/lore/tests/unit/service/site-census-injection.test.ts`, cites BR-659, BR-660. `ac add` logs a version on the spec; no body edit was needed.
- **C1**: unchanged. C1 already says a call the static analysis cannot resolve to one target is `not_measured`; resolving an injected call through its declared type to a single implementation is the same static resolution C1 applies to ordinary calls, not a new dispatch rule. AC-BLS2-5/15 stay as they are and are re-run as regression.
- **Invariant reworded**: "Every armed branch is at 0 coverage gaps when this plan closes. Between the merge of task 2 and task 3's mapping, new sites may show as gaps; task 3 runs in the same session as the merge, and the plan cannot close while any branch is red."
- **Task 3** is now a formal task (blocked by task 2).


## Post-RED oracle change (recorded 2026-10-10, by agent:main-orchestrator on main, commit after merge ef7a281b)
- **Original**: `/^packages\/lore\/src\/store\/[^#]+#[^#]*insertWithProvenance#[A-Z_]+/` (required a literal code).
- **Measured failure**: after the fix the census lists `TursoStore.insertWithProvenance#dynamic:err(await this.getDuplicateSlugErrorFor(...))`; that method's only refusal is a non-literal code, and SQLiteStore.insertWithProvenance has none of its own (its refusals are listed under insertDocSync).
- **Why a correction**: AC-BLS2-20 requires that the injected store sites be LISTED; the dynamic key is that listing. The implementer did not edit the assertion — the orchestrator did, after measurement, and the commit message carries the same three items.
- Assessment findings filed: #118 (single visible binding followed as the only implementation). All-12 coverage evidence recorded on task 3 (captured, exit 0).
- **Independent review of the oracle change** (lore-reviewer agent, read-only, 2026-10-10): verdict CORRECTION. The original regex had no possible match on the real repo (turso-store.ts:813 refuses with a non-literal code; sqlite-store.ts:1724 has none of its own, its DUPLICATE_SLUG is built in insertDocSync at :642). The one degradation the looser regex no longer catches (Turso site degrading from literal to dynamic) is closed by a new pin: `expect(keys()).toContain("...SQLiteStore.insertDocSync#DUPLICATE_SLUG")` (committed on main, 10/10 pass).
