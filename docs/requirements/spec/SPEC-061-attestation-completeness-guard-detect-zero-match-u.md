---
id: SPEC-061
type: spec
role: spec
title: "Attestation completeness guard: detect zero-match / under-match test oracles"
status: approved
priority: medium
created: 2026-07-21
updated: 2026-07-31
tags: []
parent: PRD-001
---
# SPEC-061 — Attestation completeness guard: detect zero-match / under-match test oracles

## Overview

SPEC-039's trusted runner makes one load-bearing promise: an evidence record's
`result` is **derived from the process exit code, never caller-asserted**. The
2026-07-21 SPEC-060 run proved that promise has a blind spot that inverts it in
practice.

AC-060-7 declared this command:

```
bun run test:vitest packages/lore/tests/unit/setup-service.test.ts \
  packages/lore/tests/unit/assets-ssot.test.ts \
  packages/lore/tests/unit/real-setup-ports.test.ts
```

Two of those three paths do not exist (the real files live under
`tests/unit/service/` and `tests/unit/adapters/`). **vitest treats positional
arguments as filename filters and silently ignores non-matching ones**, so it
ran the single suite that happened to match, exited 0, and `lore verify`
recorded a fully attested `pass` — for a regression guarantee that had never
executed. The attestation was exit-code-true and semantically false.

It defeated both the orchestrator and `lore verify`. It was caught only by the
LLM-as-judge `lore assess` pass reading the evidence `output_tail` and noticing
`Test Files 1 passed (1)` under a three-path command — i.e. by the *advisory*
layer, not the deterministic one. That inversion (soft oracle catching what the
hard oracle missed) is the defect this spec closes.

The failure class is general, not vitest-specific: any runner that accepts path
filters and treats a zero-match set as success (vitest, `bun test`, jest,
pytest with `-k`) can produce a green exit code having executed nothing.

## Scope

### In

- **D1 — runner-output parsing.** New pure module
  `packages/core/src/attestation-completeness.ts`:
  - `countExplicitPathArgs(command: string): number` — counts argv tokens that
    look like test-file paths (contain a `/` and end in a known test extension),
    ignoring flags and their values.
  - `parseExecutedUnits(stdout: string): ExecutedUnits | null` — recognises the
    summary lines of the runners this repo actually uses (vitest
    `Test Files N passed (M)`; bun `Ran N tests across M files`), returning
    `{files, tests}`; `null` when no known summary is present.
  - `judgeCompleteness(args): CompletenessVerdict` — pure decision:
    `"complete" | "under_match" | "zero_match" | "unknown_runner"`.
- **D2 — `inconclusive` evidence result.** `evidenceEntrySchema`'s `result`
  union gains `"inconclusive"` alongside `pass`/`fail`. It is
  **runner-issued only** (same restriction SPEC-039 §M2 puts on `attestation`):
  public evidence write paths reject caller-supplied `inconclusive` loud.
- **D3 — verify integration.** For an `oracle: "test"` script AC whose process
  exits 0, `VerifyRunnerService` runs D1's judgement over the captured stdout:
  - `zero_match` or `under_match` → record `result: "inconclusive"`, never
    `pass`; CLI renders `⚠ AC-x inconclusive (ran 1 of 3 declared paths)` and
    `lore verify` exits **3** (the established "oracle found a problem" code,
    matching `status --check-drift`), not 0.
  - `unknown_runner` → record `pass` unchanged (fail-open — an unrecognised
    runner must not block a legitimate oracle) but set
    `attestation.completeness: "unknown_runner"` so it is queryable.
  - `complete` → byte-identical to today's behaviour.
- **D4 — attestation field.** `attestation` gains optional
  `completeness?: "complete" | "under_match" | "zero_match" | "unknown_runner"`
  and `executed_files?: number` (present-iff-parsed), so a past run's
  completeness is auditable rather than recomputed from a text tail.
- **D5 — AC coverage accounting.** `computeAcCoverage` counts an
  `inconclusive` entry as **not** covering its AC (it is neither
  `attested_pass` nor `attested_fail`); `lore ac list` renders `⚑?`.

### Out

- Rewriting or validating AC commands at authoring time (a path-existence lint
  at `lore ac add` is a plausible sibling but needs repo-root resolution
  semantics this spec does not define).
- Runners beyond vitest and `bun test` (the two this repo runs) — others hit
  the `unknown_runner` fail-open path by design.
- Non-`test` oracles (`tsc`/`lint`/`build`/`e2e`) — their zero-work-green modes
  differ and need separate analysis.
- Retroactively re-judging historical evidence records.

## Design

`attestation-completeness.ts` is pure and browser-safe (no Node builtins,
mirroring `ac-quality.ts`/`staleness.ts`). `VerifyRunnerService` is the sole
caller — it already owns the captured stdout and is already the only site
permitted to mint `attestation`, so D2's runner-issued-only restriction needs no
new enforcement seam beyond the existing one.

The guard runs **only on exit 0**: a nonzero exit is already a `fail` and its
completeness is irrelevant.

## Acceptance Criteria

- **AC-061-1** — `countExplicitPathArgs` returns 3 for the literal AC-060-7
  command, 0 for a command with no path arguments, and ignores flag values
  (e.g. `--reporter json` contributes 0).
- **AC-061-2** — `parseExecutedUnits` returns `{files: 1}` for a vitest
  `Test Files  1 passed (1)` tail, `{files: 70}` for a bun
  `Ran 963 tests across 70 files.` tail, and `null` for unrecognised output.
- **AC-061-3** — `judgeCompleteness` returns `under_match` when
  `executed_files < declared_paths`, `zero_match` when `executed_files === 0`
  with ≥1 declared path, `complete` when equal, and `unknown_runner` when
  parsing yielded `null`.
- **AC-061-4** — REPRO: a verify run against a script AC reproducing AC-060-7's
  exact three-path-two-missing shape records `result: "inconclusive"` (not
  `pass`) and the run exits 3.
- **AC-061-5** — REGRESSION: a verify run whose command's declared path count
  equals the executed file count records `result: "pass"` with
  `attestation.completeness: "complete"`, and a run against an unrecognised
  runner records `pass` with `completeness: "unknown_runner"` — neither exits 3.
- **AC-061-6** — A caller-supplied `result: "inconclusive"` through the public
  `lore evidence` path is rejected with `VALIDATION_ERROR` (exit 4), mirroring
  the existing attestation-injection rejection.
- **AC-061-7** — `computeAcCoverage` counts an `inconclusive` entry as neither
  `attested_pass` nor `attested_fail`, and the existing coverage totals for a
  corpus with zero `inconclusive` entries are byte-identical to before.

## Post-implementation findings (2026-07-21, measured)

Implementation + a live dogfood run against this spec's own AC set corrected
two assumptions in the sections above. Recorded here rather than silently
edited, because the correction is the useful part.

### The real blind spot is `under_match`, not `zero_match`

The Overview frames zero-match and under-match as one failure class. Measured
behaviour differs:

- **All declared paths miss** → vitest reports "No test files found" and exits
  **1**. That is already a loud `fail`; the guard never sees it (it runs only
  on exit 0), and no attestation was ever at risk.
- **Some declared paths miss** → vitest runs the matching subset and exits
  **0**. This is the case that produced SPEC-060's false attestation
  (3 declared, 1 matched, recorded `pass`).

So `zero_match` is a real state of `judgeCompleteness` but, for vitest, an
unreachable one in practice. It is kept because (a) other runners do exit 0 on
an empty selection, and (b) an unreachable-but-correct branch costs nothing
while a missing one costs an incident.

Demonstrated live: this spec's own AC-061-7 declared
`packages/core/tests/acceptance.test.ts`, which does not exist (core colocates
its tests under `src/`). `lore verify` recorded it `fail (exit 1)` — not
`inconclusive` — confirming the above. AC-061-8 is its corrected replacement
(the real path, `packages/core/src/acceptance.test.ts`); AC-061-7 is retained
rather than removed so its evidence trail stays intact, exactly as SPEC-060's
AC-060-7/8 pair.

### Deferred gaps (flagged by the implementer, not silently closed)

1. `PhaseWorkflowService._addEvidenceImpl` has no runtime `"inconclusive"`
   rejection of its own — it inherits only the compile-time exclusion via the
   shared `EvidenceInput` type, so an `as EvidenceInput` cast through the
   phase-target dispatch path could still smuggle the value.
   `TaskWorkflowService`'s path (what AC-061-6 covers) is fully guarded.
2. D5's `lore ac list` `⚑?` badge is unimplemented; only the numeric exclusion
   in `computeAcCoverage` (which every AC actually tests) shipped. An AC whose
   only evidence is `inconclusive` currently renders `·`, indistinguishable
   from "no evidence at all" — a reporting gap, not a correctness one.


## Acceptance Criteria (structured)

- [✔] [script] AC-061-1: countExplicitPathArgs returns exactly 3 for the literal AC-060-7 command, exactly 0 for a command with no path arguments, and counts 0 path args from flag values such as --reporter json
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts -t 'countExplicitPathArgs'
- [✔] [script] AC-061-2: parseExecutedUnits returns files=1 for a vitest 'Test Files  1 passed (1)' tail, files=70 for a bun 'Ran 963 tests across 70 files.' tail, and null for unrecognised output
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts -t 'parseExecutedUnits'
- [✔] [script] AC-061-3: judgeCompleteness returns under_match when executed_files < declared_paths, zero_match when executed_files equals 0 with at least 1 declared path, complete when the two counts are equal, and unknown_runner when parsing yielded null
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts -t 'judgeCompleteness'
- [✔] [script] AC-061-4: A verify run against a script AC reproducing AC-060-7's three-declared-paths-two-missing shape records result=inconclusive rather than pass, and the run exits with code 3
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-completeness.test.ts -t 'REPRO'
- [✔] [script] AC-061-5: A verify run whose declared path count equals the executed file count records result=pass with attestation.completeness=complete, and an unrecognised-runner run records result=pass with completeness=unknown_runner; neither exits 3
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-completeness.test.ts -t 'REGRESSION'
- [✔] [script] AC-061-6: A caller-supplied result=inconclusive through the public lore evidence path is rejected with VALIDATION_ERROR and exit code 4
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-completeness.test.ts -t 'caller-supplied inconclusive'
- [✘] [script] AC-061-7: computeAcCoverage counts an inconclusive entry as neither attested_pass nor attested_fail, and coverage totals for a corpus with 0 inconclusive entries stay byte-identical to the pre-change values
  script: test — bunx vitest run packages/core/tests/acceptance.test.ts
- [✔] [script] AC-061-8: REGRESSION (corrects AC-061-7's path: core colocates tests in src/, so packages/core/tests/acceptance.test.ts does not exist): computeAcCoverage counts an inconclusive entry as neither attested_pass nor attested_fail across exactly 1 test file
  script: test — bunx vitest run packages/core/src/acceptance.test.ts
- [✘] [script] AC-061-G1: A caller-supplied result=inconclusive through the phase-target evidence dispatch path (including an as EvidenceInput type-bypass cast) is rejected with VALIDATION_ERROR field=result and exit code 4, matching the task-path rejection byte-for-byte across code/field/message/value
  script: test — bunx vitest run packages/lore/tests/unit/service/phase-workflow-inconclusive-guard.test.ts
- [✔] [script] AC-061-G2: lore ac list renders a distinct ⚑? badge for an AC whose only evidence is inconclusive, keeps · for an AC with zero evidence refs, and keeps ⚑✔ for an attested-pass AC, across a 14-case coverageBadge suite (6 pre-existing + 8 new SPEC-061 cases)
  script: test — bun test tests/unit/adapters/cli-ac-coverage-badge.bun.test.ts
- [✔] [script] AC-061-9: When a script:test AC command references the compiled binary path (dist/lore), VerifyRunnerService checks binary freshness (newest mtime under packages/{lore,core}/src vs dist/lore mtime) before trusting the result: a stale-or-missing binary records result inconclusive (never pass) with a warning naming 'bun run build'; a fresh binary is byte-identical to today; a command NOT referencing the binary is unaffected; at least 1 test file runs and exits 0
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-completeness.test.ts
- [✔] [script] AC-061-10: judgeCompleteness parses the runner's matched-CASE count when the command carries a -t/--testNamePattern filter: a matched-case count of 0 yields zero_match and >=1-but-fewer-than-declared yields under_match (both -> inconclusive), while a filterless command keeps existing file-count-only behavior byte-identical; at least 1 test file runs and exits 0
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts
- [·] [script] AC-061-11: lore evidence --result pass whose --command carries a -t/--testNamePattern case filter and supplies NO --output-tail/--output-tail-file is REFUSED with VALIDATION_ERROR (exit 4), and the refusal message names the missing matched-count proof
  script: test — bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts -t 'AC-061-11'
- [·] [script] AC-061-12: The same filtered --result pass whose --output-tail holds a runner-summary line parsing to ZERO matched cases is REFUSED (exit 4) naming zero_match, and one whose tail is present but carries NO parseable summary line is likewise REFUSED (fail-CLOSED, per adr-lore-evidence-proves-a-filtered-pass-with-the-runner-s-own)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts -t 'AC-061-12'
- [·] [script] AC-061-13: A filtered --result pass whose --output-tail parses to N>0 matched cases is ACCEPTED, and CONTROL: an UNFILTERED --command records a pass unchanged with no output-tail requirement — the guard adds zero friction to whole-file runs
  script: test — bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts -t 'AC-061-13'
- [·] [script] AC-061-14: Single definition site: a source scan of packages/lore/src proves the evidence guard imports filter detection and summary parsing from @lore/core's attestation-completeness module and declares no second copy of either rule (no local regex duplicating commandHasCaseFilter or the runner-summary parse)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts -t 'AC-061-14'
- [·] [script] AC-061-15: REGRESSION: lore verify's runner behaviour is unchanged — the verify-runner and attestation-completeness suites both pass with NO modification to either file (whole-file commands, no -t filter, so a zero-match exits 1 loudly)
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-runner-service.test.ts packages/core/tests/attestation-completeness.test.ts
- [·] [script] AC-061-16: From a throwaway corpus driven by the compiled dist/lore binary: lore evidence --result pass with a -t-filtered command and no output tail exits 4 AND writes no evidence row (the task's verification_evidence length is unchanged), while an unfiltered pass on the same task writes exactly one
  script: e2e — cd packages/lore && bun test tests/e2e/evidence-completeness-guard-compiled.bun.test.ts
- [·] [script] AC-061-17: GATE PARITY: the MCP lore_evidence_add tool refuses the same filtered-pass-without-proof input the CLI refuses, by consuming the SAME shared decision function (mirroring findMissingOracleFilesForEvidence's CLI+MCP split) — asserted by driving the MCP tool handler directly, not by inspecting imports
  script: test — bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts -t 'AC-061-17'

## Code anchors

- packages/core/src/attestation-completeness.ts
- packages/lore/src/service/verify-runner-service.ts
