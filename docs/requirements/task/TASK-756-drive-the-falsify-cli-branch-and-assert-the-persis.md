---
id: TASK-756
type: task
role: plan
title: "Drive the --falsify CLI branch and assert the PERSISTED inconclusive row, and record inconclusive when the green control fails to LAUNCH"
status: archived
priority: medium
phase: "surface-oracle"
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PLAN-136
plan: PLAN-136
---
Closes two findings from `knowledge-assessment-close-the-falsify-green-control-gap-an`, both machine-verified by the orchestrator before dispatch.

## MAJOR (outcome, AC-FR-11) — the oracle never reaches the layer the criterion promises

> The AC's oracle observes an injected recorder spy in attested-red.test.ts (recorder.calls[0].entry), not a persisted evidence row, and no test drives the --falsify branch in commands/verify.ts. The task explicitly forbade service-level-only evidence for this criterion.

Confirmed: `grep -rln falsify packages/lore/tests scripts/tests` returns only service-level and scripts-level files — zero CLI/integration coverage.

⛔ The FUNCTION is not broken. The orchestrator ran `lore verify <plan> --task <task> --falsify AC-FR-11` by hand against the real corpus: the CLI printed 'Green control failed for AC-FR-11 … result:inconclusive, no attestation recorded. Nothing was mutated.' and a row `inconclusive | runner | NO-attestation` was persisted. So do NOT re-implement the behaviour — build the ORACLE that pins it, which is what AC-FR-12 now declares.

Build `packages/lore/tests/integration/cli/verify-falsify-green-control.test.ts`:

- Drive the REAL CLI, following the source-entry spawn shape the sibling files in `packages/lore/tests/integration/cli/` already use.
- ⛔ Use a THROWAWAY corpus (mkdtemp + `lore init`, cwd inside it) — see `packages/dashboard/tests/e2e/global-setup.ts`. ⛔ NEVER write to this repo's own `.lore/`; that is the team's live knowledge base and a prior run polluted it with 6 foreign docs.
- Assert by READING THE ROW BACK out of that corpus: `result === 'inconclusive'` and `attestation === undefined`. ⛔ An injected recorder spy does not satisfy AC-FR-12 — that is the exact gap being closed.
- Assert the CLI's exit code is 3 and its message names the green control. ⛔ Measure the exit code WITHOUT a pipe (`cmd > out 2>&1; echo $?`) — the orchestrator already measured 0 through a `| tail` and had to retract it.
- Cover both RED directions AC-FR-12 declares: (a) CLI prints success/exits 0 -> must fail; (b) runner skips the inconclusive record -> read-back must fail finding the row.

## MINOR (outcome, AC-FR-11) — launch failure records nothing

> a green control that fails to LAUNCH returns err(STORE_ERROR) and records nothing, so that unrunnable-environment shape produces no inconclusive row at all — inconsistent with the outcome the criterion names for an unusable scratch environment.

A spawn that cannot launch at all is the SAME class of unusable environment as one that launches and exits nonzero, so it must record `inconclusive` too, not vanish into an error with no corpus trace. Fix in `_runFalsifier` and cover it in the new test.

## Regression duty

This plan's first commit changed `packages/lore/tests/unit/service/falsifier-execution-root.bun.test.ts` (its fixture command now exits 0 unmutated) and `attested-red.test.ts`. AC-FR-2 and AC-FR-3 both run `attested-red.test.ts` and neither has a post-change oracle run. They are in YOUR ac_scope: re-run both and record evidence, so the change to their subject file is not left unverified.

## Constraints

- ⛔ RED FIRST, recorded by YOU at the moment it is red: `lore evidence <task> --oracle test --command '<cmd>' --result expected-fail`.
- ⛔ Every AC-bound evidence row must come from `lore verify`, NOT `lore evidence --capture`. Measured this session: `--capture` stamps `capture_source: runner` but produces NO attestation block, so 4 of the previous task's 5 rows certify nothing. `lore verify <plan> --task <this-task> --ac <id>` is the only attested path.
- Scoped oracle only: `bun run test:changed $(git merge-base main HEAD)`. Known pre-existing failure, NOT yours and NOT to be fixed: `tests/integration/cli/dashboard-sigterm.bun.test.ts` (2/2 on clean baseline, a --dev-mode Vite child never registers as a descendant).
- Stop at `lore release`. ⛔ Do NOT run `lore done` and do NOT re-approve the spec.
