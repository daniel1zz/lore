---
id: TASK-235
type: task
role: plan
title: "Verify trust extensions: build-freshness + -t case-count guard"
status: archived
priority: medium
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: PLAN-056
plan: PLAN-056
---
# Verify trust extensions: build-freshness precheck + -t matched-case guard

Mechanizes the last two un-mechanized false-oracle vectors (CLAUDE.md eval-log 2026-07-21 "four false-oracle vectors"). Both extend SPEC-061's completeness→`inconclusive` machinery in the SAME two files, so they ship together.

## Part A — build-freshness (vector 4: stale compiled binary)

A `script:test` AC whose command spawns the COMPILED `dist/lore` can attest `pass` against a binary that predates the session's source changes. There is already a pure precedent: `packages/lore/tests/integration/helpers/assert-fresh-binary.ts` (`assertFreshBinary` — newest `.ts` mtime under `packages/{lore,core}/src` vs `dist/lore` mtime), used by 7 spawn-based `.bun.test.ts` files. The gap: `lore verify` itself does NOT check this.

- Extract the PURE freshness comparison into a reusable predicate (put it in `@lore/core` — e.g. alongside `attestation-completeness.ts` — so both the test helper AND `VerifyRunnerService` call ONE implementation; the git-facts-as-DATA / FsProbe precedent applies — the predicate takes mtimes/paths as input, the caller does the `stat`). Optionally refactor `assert-fresh-binary.ts` to delegate to it (DRY) — only if it stays byte-behavior-identical; if that widens scope, leave the helper and just share the predicate.
- In `VerifyRunnerService`: BEFORE trusting a `script:test` AC result whose command string references the compiled binary path (a `commandReferencesCompiledBinary(cmd)` pure predicate — match `dist/lore` / the resolved binary path), run the freshness check. Stale or missing binary → record `result: "inconclusive"` (SPEC-061's existing result, NEVER `pass`) + a warning naming `bun run build`. A fresh binary → byte-identical to today. A command NOT referencing the binary → completely unaffected (REGRESSION).

## Part B — -t matched-case count (vector 2 refinement)

`judgeCompleteness` (`packages/core/src/attestation-completeness.ts`) today compares FILE counts only. A `-t 'REPRO'` filter running 1 of N cases inside a matched FILE still judges `complete`. Extend it: when the command carries a `-t`/`--testNamePattern` filter, parse the runner's matched-CASE count (`parseExecutedUnits` already reads vitest `Tests N passed` / bun `Ran N tests`); 0 matched cases → `zero_match`, ≥1-but-fewer-than-declared → `under_match` (both → `inconclusive`). A filterless command keeps the existing file-count-only behavior BYTE-IDENTICAL (REGRESSION-frozen).

## Constraints
- Reuse SPEC-061's `inconclusive` result + `attestation.completeness` field — do NOT invent a new result kind.
- Fail-OPEN on any anomaly (can't stat the binary, unrecognised runner) → `pass` unchanged, never a false block — mirrors SPEC-061's `unknown_runner` fail-open.
- Do NOT touch the assess path or any file outside the anchors.

## Required tests (six dimensions)
- `packages/core/tests/attestation-completeness.test.ts`: the pure freshness predicate + the case-count judgeCompleteness extension (HAPPY/BOUNDARY/zero/under/REGRESSION-filterless-unchanged). Write the "filterless command byte-identical" REGRESSION assertion and confirm it'd fail against a naive "always parse cases" change before settling.
- `packages/lore/tests/unit/service/verify-completeness.test.ts`: the VerifyRunnerService integration — a stale-binary-referencing command → inconclusive + warning; a fresh binary → pass; a non-binary command → unaffected.

## Acceptance
- AC-061-9 (build-freshness): `bunx vitest run packages/lore/tests/unit/service/verify-completeness.test.ts`
- AC-061-10 (case-count): `bunx vitest run packages/core/tests/attestation-completeness.test.ts`
on `spec-spec-061-attestation-completeness-guard-detect-zero-match-u`. Also `bun run typecheck` (exit 0).
