---
id: TASK-1909
type: task
role: plan
title: "[Skill:fix] AU-T21 repair 6 test files red on main from this round's merge interactions (override port, bun:test imports, AC-TG-6 vs EI-6, pre-push steps) + live-owner stash not escalated"
status: archived
priority: medium
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: M
Approach: Full `bun run test` on main 2026-10-18 then a clean re-run of its failing files at 66f61467 left 6 files red, all from merge interactions this round:
(1) packages/lore/tests/unit/service/ac-exemption-satisfied.bun.test.ts (TG-44) and packages/lore/tests/integration/cli/write-attribution-matrix.bun.test.ts use `ac exempt` / `done --override-attestation` on bare services; since AU-T7 an override with no OverrideDecisionPort is refused (correct). Give them the explicit alwaysAutoOverridePort (packages/lore/tests/helpers/always-auto-override-port.ts) or the human-path loosening helper, never a bypass.
(2) packages/lore/tests/unit/store/autonomy-thresholds-store.bun.test.ts and migration-023.bun.test.ts import from "bun:test" and fail to load under the one runner (vitest on Bun: "Cannot use describe outside of the test runner"); switch to vitest imports like their siblings. Check whether any other test file imports "bun:test" (grep) and whether a check should refuse that import (check:static has none? if a guard is the end state, say why; otherwise just fix).
(3) packages/lore/tests/integration/cli/verify-missing-oracle-file.test.ts (AC-TG-6): EI-6 made a missing-oracle criterion with no evidence render not_measured, but AC-TG-6 (approved) requires a red-first criterion declared --allow-missing-path with no evidence to stay 'none' and not block done. Reconcile in deriveAcCoverageState (packages/core/src/acceptance.ts) with ONE rule: missing oracle + declared allow-missing + no pass on record -> none; any other missing oracle -> not_measured (AC-EI-2). Both AC-TG-6's and AC-EI-2's oracles must pass.
(4) packages/lore/tests/integration/pre-push-trip.bun.test.ts (AC-BFI-9): AU-T9 added `status --check-autonomy-thresholds` and `autonomy verify-pushed-heads --record` to hooks/pre-push without updating EXPECTED_LORE_STEPS; red since AU-T9's merge. Update the expected list from the hook (single source if the test can read it; otherwise list).
(5) lore stash prune escalates a stash whose proven owner run is still live (pending decision #84, 2026-10-18) — a live owner's stash should be kept without a pending decision and re-decided once the owner ends (AU-T12 version scheme). Check AC-AU-4's text before changing; if AC-AU-4 requires the escalation, report instead of changing.
Source: full-suite run 2026-10-18 (scratchpad full-suite.log, rerun16.log)
AC: each of the 6 files green via bun run test:file; AC-TG-6, AC-EI-2, AC-BFI-9, AC-AU-4 oracles pass; typecheck green.
