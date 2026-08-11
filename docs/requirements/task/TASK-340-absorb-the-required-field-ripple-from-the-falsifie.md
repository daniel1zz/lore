---
id: TASK-340
type: task
role: plan
title: "Absorb the required-field ripple from the falsified dimension so the integrated branch typechecks and its consumer tests stay green"
status: archived
priority: critical
phase: "mechanisms"
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PLAN-081
plan: PLAN-081
---
⛔ This task exists because MY anchors were wrong, not because the M1 implementer erred. It flagged the entire ripple accurately and refused to leave its anchors — the correct behaviour.

Adding `falsified` as a REQUIRED field on the widely-shared `AcCoverageFact`, plus a new value in the shared precedence derivation, has a deterministic ripple across ~12 consumer files. MEASURED on an isolated integration branch: `bun run typecheck` exits 2 with 6 errors in `packages/core/src/evidence-panel.test.ts` alone — and typecheck stops at its first failing sub-step, so the rest surface only as each is cleared.

## Base — read carefully

⛔ Your worktree is cut from `main`, which does NOT contain M1. FIRST run `git merge --ff-only integration-fals-m1` (a descendant of main carrying M1's commit), THEN `bun install`. Verify with `git log --oneline -2` that you see the integrate commit.

## Two classes of fix

**Type-only** (hand-built `AcCoverageFact` literals missing `falsified: N`):
`packages/core/src/evidence-panel.test.ts` (6 sites) · `packages/lore/tests/unit/adapters/cli-ac-coverage-badge.bun.test.ts:57` · `packages/lore/tests/unit/core/phase-completion.test.ts` (3) · `packages/lore/tests/unit/service/feed-attestation-ac-diagnostics.test.ts` (6) · `packages/lore/tests/unit/service/outline-render.test.ts:332` · `packages/lore/tests/unit/service/plan-close-vacuity-guard.test.ts` (2)

**Expected-value updates** (the derivation legitimately changed):
`packages/core/src/acceptance.test.ts` (3 assertions) · `packages/lore/tests/unit/adapters/task-feed-wiring.test.ts` (1) · `packages/lore/tests/unit/service/outline-service.test.ts` (1) · `packages/lore/tests/integration/cli-feed-task-start.bun.test.ts:412` (asserts literal `[pass]`, now genuinely renders `[pass_unfalsified]`)

**The unowned production gap** — this is the one nobody's anchors covered:
`packages/lore/src/flows/task-feed-flow.ts:140` — `AcceptanceView.coverage` is typed `"attested_pass" | "pass" | "fail" | "none"` and needs `"pass_unfalsified"` added. That omission is what makes `packages/lore/src/adapters/cli/task-feed-wiring.ts:103` fail typecheck.

**Stale doc, same acceptance unit:** `packages/core/src/CLAUDE.md:13` still states the old four-state precedence `"fail" > "attested_pass" > "pass" > "none"`. Per root CLAUDE.md, fixing a gap and updating the comment that records it are ONE acceptance unit — update it to the new five-state order.

## Discipline

⛔ Do NOT touch `packages/core/src/acceptance.ts` — M1's derivation is merged and correct. If you believe it is wrong, STOP and report; do not edit it.
⛔ Do NOT weaken `falsified` to optional to spare the fixtures. An absent-vs-zero ambiguity is exactly what the governing ADR's Silence question forbids: an empty result and a not-measured result must never be the same value.
⛔ `"pass_unfalsified"` sits BELOW `attested_pass` and above plain `pass` in the precedence — when updating an expected value, derive it from that order, do not guess.
⛔ Measure every exit status in a statement SEPARATE from any pipe (`cmd > log 2>&1` then `echo $?`). Never `cmd | tail`.
⛔ Red-first: the reds already exist on this base — capture them BEFORE fixing, one row per AC with its own `--ac` ref.
