---
id: TASK-225
type: task
role: plan
title: "[Skill:implement] FixA wiring+core — surrogate clip, tolerant evidence, precedence SSOT, ac_scope fail-loud, aux err propagation, dup-read elim, test hardening"
status: archived
priority: high
phase: "wiring-core"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-048
plan: PLAN-048
---
Estimate: L
Approach: Seven review findings in the wiring/core layer, each with a named mechanical fix:
(F1/AC-070-10) task-feed-wiring.ts:144 — replace the bare `.slice(0, PRIOR_FAILURE_TAIL_CHARS)` with `headChars` from @lore/core (the repo-wide surrogate-safe primitive; see packages/core/src/truncate.ts header for BUG-001 context). Test with an astral-plane fixture (emoji at the boundary) asserting no unpaired surrogate.
(F2/AC-070-11) task-feed-wiring.ts:138-140 — extractEvidence is whole-array fail-closed (correct for coverage counting, wrong for this advisory consumer): replace with local per-entry tolerant parsing (safeParse each raw entry of task.extra.verification_evidence; collect parseable fails, count unparseables). Bundle carries the unparseable count; the flow's constraints section renders an explicit degraded line (e.g. "(N evidence entries unparseable — history may be incomplete)") whenever count>0. A non-empty raw array must never silently render "(no prior failures)". Document the deliberate divergence from extractEvidence at both sites.
(F3/AC-070-12) precedence unification — add a pure `deriveAcCoverageState(fact): "fail"|"attested_pass"|"pass"|"none"` to packages/core/src/acceptance.ts with FAIL-FIRST ordering (matching commands/ac.ts::coverageBadge's established convention); rewrite wiring's deriveCoverageLabel and ac.ts's coverageBadge to consume it (ac.ts keeps its rendering, loses its own precedence logic). Test pass>0&&fail>0 → "fail" label in the pack.
(F4/AC-070-13) task-feed-wiring.ts:110 — a PRESENT but planAcScopeSchema-invalid plan.extra.ac_scope currently falls through to undefined (= unscoped, suppresses dangling reporting): make getTaskBundle return err VALIDATION_ERROR naming plan.extra.ac_scope. Absent ac_scope stays legal.
(F5/AC-070-14) task-feed-wiring.ts:201,225 — aux bindings manufacture success on refetch failure (invalidated:false rows; title=slug handoff). Propagate those inner failures as err(...) so the flow's existing section-level degrade fires. Tests force each refetch failure and assert the unavailable-note renders and no manufactured row appears.
(F10/AC-070-17) duplicate-read elimination — thread the first corpusService.get(task)'s navigation.related through TaskBundle so listLinkedKnowledgePointers stops re-fetching the task (call-count assertion via counting fakes); restructure computeAcCoverage (packages/core/src/acceptance.ts) to single-pass: extract+parse each task's evidence once, bucket by ac_ref into a Map, aggregate per criterion — output must stay equal on existing fixtures (existing core acceptance tests are the floor). The per-pointer full-get for isInvalidated (cap 20) may stay.
(F9/AC-070-18 + import-filter hardening) tests/unit/flows/task-feed-flow.test.ts AC-070-1 import scanner: collect full multi-line import statements (balanced braces) before scanning for forbidden names, so a future multi-line import cannot leak past the filter. tests/integration/cli-feed-task-start.bun.test.ts: add a phase-start HAPPY-path full-output regression pin (currently only its error paths are pinned).
New wiring tests live in NEW packages/lore/tests/unit/adapters/task-feed-wiring.test.ts (vitest, InMemoryStore or counting fakes — wiring is vitest-safe, see phase-wiring precedent).
Source: spec AC-070-10..14,17,18; review synthesis in plan content; packages/core/src/truncate.ts; commands/ac.ts:337-354.
Dimensions: D-FUNC, D-CODE, D-TEST
Scope-Alt: F10's computeAcCoverage restructure may be dropped ONLY if its existing-fixture equality proves unattainable this session — record the deviation; everything else is non-negotiable.
Covers: AC-070-10, AC-070-11, AC-070-12, AC-070-13, AC-070-14, AC-070-17, AC-070-18

AC:
- Given an astral-plane tail at the clip boundary, when constraints render, then no unpaired surrogate (AC-070-10)
- Given 2 parseable fails + 1 malformed entry, when constraints render, then both fails + explicit degraded count line (AC-070-11)
- Given pass>0 and fail>0 on one criterion, when the pack and lore ac list label it, then both say fail via the one shared helper (AC-070-12)
- Given schema-invalid ac_scope present, when getTaskBundle runs, then VALIDATION_ERROR naming plan.extra.ac_scope (AC-070-13)
- Given a forced refetch failure in each aux port, when the pack builds, then the section's unavailable-note renders and no manufactured rows (AC-070-14)
- Given counting fakes, when the pack builds, then the task doc is fetched exactly once and evidence parsed once per task (AC-070-17)
- Given the integration suite, when phase-start happy path runs, then full-output pin passes (AC-070-18)

Integration: `lore feed task-start <task>` against a throwaway corpus with mixed pass/fail evidence renders the fail-precedence label end-to-end.

Oracle scope (SCOPED only): bunx vitest run packages/lore/tests/unit/adapters/task-feed-wiring.test.ts; bunx vitest run packages/lore/tests/unit/flows/task-feed-flow.test.ts; existing core acceptance test file(s) matching acceptance (find exact path, assert matched count); bun run build then cd packages/lore && bun test tests/integration/cli-feed-task-start.bun.test.ts; bunx vitest run --changed <merge-base>; bun run typecheck.
