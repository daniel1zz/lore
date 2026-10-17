---
id: SPEC-061
type: spec
role: spec
title: "Attestation completeness guard: detect zero-match / under-match test oracles"
status: approved
priority: medium
created: 2026-07-21
updated: 2026-10-17
tags: []
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

## ⛔ CORRECTION 2026-08-21 — every `--falsify` row on AC-061-18/19/20/21 is VACUOUS

Four falsifiers were declared on these criteria and run through `lore verify --falsify`. All
recorded `result: "expected-fail"`, `capture_source: "runner"`, observed exit 1 matching the
declared 1. **None of them exercised its mutation.** The recorded tails, read afterwards:

- `AC-061-18`, `AC-061-19`, `AC-061-20` — `Could not resolve 'vitest/config' in vitest.config.ts`
  / `Cannot find package 'vitest'`. One of the AC-061-18 rows even shows a `bun install` having
  run (`Resolved, downloaded and extracted [172] / Saved lockfile`) and STILL failing to resolve,
  so an install step alone does not fix the scratch worktree.
- `AC-061-21`, first row — `The following filters did not match any test files: packages/lore/tests/e2e/ac-add-path-precheck-compiled.bun.test.ts`. The
  file was untracked, and the scratch worktree is built from `git stash create` WITHOUT
  `--include-untracked`, so the file under test simply was not there.
- `AC-061-21`, second row — `stale-binary guard: … does not exist`. `dist/lore` is gitignored, so
  the compiled binary the e2e drives is never present in the scratch copy.

Three distinct causes, one shared consequence: every one exits 1, and 1 is the natural declared
value for "this mutation should make the test fail". So the false-match rate for
compiled-binary and node_modules-dependent criteria in this repo is effectively total.

**Where the real discriminating power for these four comes from**, and it IS real: the
implementer's manual RED→GREEN cycle — reverting both functions to their pre-fix flat-scan and
first-match-wins shapes, rebuilding `dist/lore`, and running all three vitest filters plus the
compiled e2e, which failed exactly as predicted (phantom-token counts; `{files:1,tests:18}`
instead of `{files:2,tests:34}`; the echo-prose refusal firing again) — then restoring and
re-running green. Those rows are self-reported and they are the evidence.

⛔ The implementer reported this gap itself rather than adjusting a declared exit code to
manufacture a discriminating-looking result. That is the behaviour that surfaced cause 2 and 3;
neither was reachable from the run's own exit status.

Full mechanism, why no exit code can fix it, and the required repair:
`knowledge-lore-verify-falsify-compares-only-the-exit-code-so-an`.


## Acceptance Criteria (structured)

- [⚑] [script] AC-061-1: countExplicitPathArgs returns exactly 3 for the literal AC-060-7 command, exactly 0 for a command with no path arguments, and counts 0 path args from flag values such as --reporter json
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts -t 'countExplicitPathArgs'
- [⚑] [script] AC-061-2: parseExecutedUnits returns files=1 for a vitest 'Test Files  1 passed (1)' tail, files=70 for a bun 'Ran 963 tests across 70 files.' tail, and null for unrecognised output
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts -t 'parseExecutedUnits'
- [⚑] [script] AC-061-3: judgeCompleteness returns under_match when executed_files < declared_paths, zero_match when executed_files equals 0 with at least 1 declared path, complete when the two counts are equal, and unknown_runner when parsing yielded null
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts -t 'judgeCompleteness'
- [⚑] [script] AC-061-4: A verify run against a script AC reproducing AC-060-7's three-declared-paths-two-missing shape records result=inconclusive rather than pass, and the run exits with code 3
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-completeness.test.ts -t 'REPRO'
- [⚑] [script] AC-061-5: A verify run whose declared path count equals the executed file count records result=pass with attestation.completeness=complete, and an unrecognised-runner run records result=pass with completeness=unknown_runner; neither exits 3
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-completeness.test.ts -t 'REGRESSION'
- [⚑] [script] AC-061-6: A caller-supplied result=inconclusive through the public lore evidence path is rejected with VALIDATION_ERROR and exit code 4
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-completeness.test.ts -t 'caller-supplied inconclusive'
- [✘] [script] AC-061-7: computeAcCoverage counts an inconclusive entry as neither attested_pass nor attested_fail, and coverage totals for a corpus with 0 inconclusive entries stay byte-identical to the pre-change values
  script: test — bunx vitest run packages/core/tests/acceptance.test.ts
- [⚑] [script] AC-061-8: REGRESSION (corrects AC-061-7's path: core colocates tests in src/, so packages/core/tests/acceptance.test.ts does not exist): computeAcCoverage counts an inconclusive entry as neither attested_pass nor attested_fail across exactly 1 test file
  script: test — bunx vitest run packages/core/src/acceptance.test.ts
- [⊘] [script] AC-061-G1: A caller-supplied result=inconclusive through the phase-target evidence dispatch path (including an as EvidenceInput type-bypass cast) is rejected with VALIDATION_ERROR field=result and exit code 4, matching the task-path rejection byte-for-byte across code/field/message/value
  script: test — bunx vitest run packages/lore/tests/unit/service/phase-workflow-inconclusive-guard.test.ts
- [⚑] [script] AC-061-G2: lore ac list renders a distinct ⚑? badge for an AC whose only evidence is inconclusive, keeps · for an AC with zero evidence refs, and keeps ⚑✔ for an attested-pass AC, across a 14-case coverageBadge suite (6 pre-existing + 8 new SPEC-061 cases)
  script: test — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-ac-coverage-badge.bun.test.ts
- [⚑] [script] AC-061-9: When a script:test AC command references the compiled binary path (dist/lore), VerifyRunnerService checks binary freshness (newest mtime under packages/{lore,core}/src vs dist/lore mtime) before trusting the result: a stale-or-missing binary records result inconclusive (never pass) with a warning naming 'bun run build'; a fresh binary is byte-identical to today; a command NOT referencing the binary is unaffected; at least 1 test file runs and exits 0
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-completeness.test.ts
- [⚑] [script] AC-061-10: judgeCompleteness parses the runner's matched-CASE count when the command carries a -t/--testNamePattern filter: a matched-case count of 0 yields zero_match and >=1-but-fewer-than-declared yields under_match (both -> inconclusive), while a filterless command keeps existing file-count-only behavior byte-identical; at least 1 test file runs and exits 0
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts
- [·] [script] AC-061-11: lore evidence --result pass whose --command carries a -t/--testNamePattern case filter and supplies NO --output-tail/--output-tail-file is REFUSED with VALIDATION_ERROR (exit 4), and the refusal message names the missing matched-count proof
  script: test — bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts -t 'AC-061-11'
- [·] [script] AC-061-12: The same filtered --result pass whose --output-tail holds a runner-summary line parsing to ZERO matched cases is REFUSED (exit 4) naming zero_match, and one whose tail is present but carries NO parseable summary line is likewise REFUSED (fail-CLOSED, per adr-lore-evidence-proves-a-filtered-pass-with-the-runner-s-own)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts -t 'AC-061-12'
- [·] [script] AC-061-13: A filtered --result pass whose --output-tail parses to N>0 matched cases is ACCEPTED, and CONTROL: an UNFILTERED --command records a pass unchanged with no output-tail requirement — the guard adds zero friction to whole-file runs
  script: test — bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts -t 'AC-061-13'
- [·] [script] AC-061-14: Single definition site: a source scan of packages/lore/src proves the evidence guard imports filter detection and summary parsing from @lore/core's attestation-completeness module and declares no second copy of either rule (no local regex duplicating commandHasCaseFilter or the runner-summary parse)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts -t 'AC-061-14'
- [○] [script] AC-061-15: REGRESSION: lore verify's runner behaviour is unchanged — the verify-runner and attestation-completeness suites both pass with NO modification to either file (whole-file commands, no -t filter, so a zero-match exits 1 loudly)
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-runner-service.test.ts packages/core/tests/attestation-completeness.test.ts
- [·] [script] AC-061-16: From a throwaway corpus driven by the compiled dist/lore binary: lore evidence --result pass with a -t-filtered command and no output tail exits 4 AND writes no evidence row (the task's verification_evidence length is unchanged), while an unfiltered pass on the same task writes exactly one
  script: e2e — bunx --bun vitest run packages/lore/tests/e2e/evidence-completeness-guard-compiled.bun.test.ts
- [·] [script] AC-061-17: GATE PARITY: the MCP lore_evidence_add tool refuses the same filtered-pass-without-proof input the CLI refuses, by consuming the SAME shared decision function (mirroring findMissingOracleFilesForEvidence's CLI+MCP split) — asserted by driving the MCP tool handler directly, not by inspecting imports
  script: test — bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts -t 'AC-061-17'
- [⚑] [script] AC-061-18: PATH EXTRACTION IS SCOPED TO RUNNER SEGMENTS, NEVER THE WHOLE CHAIN (root fix for two of three measured manifestations). splitCommandSegments — already present and quote-aware at packages/core/src/oracle-file-existence.ts:151 but consumed by neither path extractor — becomes the ONE exported segmentation seam that BOTH countExplicitPathArgs (attestation-completeness.ts, today a flat tokenizeCommand walk over the raw string) and extractTestFileTokens (oracle-file-existence.ts, today a bare command.match over the raw string) call. A second walker over the unsegmented string is a second definition of 'what counts as a path here', and the two disagreed in opposite directions. Measured 2026-08-19: countExplicitPathArgs returned 3 for a chain whose two shell-builtin existence checks contributed the two extra tokens, so lore verify reported 'ran 1 of 3 declared paths' and lore done refused an already-finished task on the attestation floor; separately findMissingOracleFiles reported a bare basename appearing inside a success-echo message as a path that does not exist and refused the declaration outright. Both are one root. REQUIRED: a segment that is not a recognised runner invocation contributes NO path tokens, and a segment whose shape cannot be classified is reported as unclassified rather than silently contributing zero — a confident wrong answer is the failure mode here, not an absent one. RED: revert either consumer to the flat unsegmented scan and that consumer's case must fail naming the phantom token it re-admits. Covered by the describe block named runner-segment-scope in packages/core/tests/attestation-completeness.test.ts.
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts -t runner-segment-scope 2>&1 && echo 'AC-061-18 PASS: both path extractors read runner segments only, a non-runner segment contributes no tokens, and an unclassifiable segment is reported as unclassified'
- [⚑] [script] AC-061-19: EXECUTED-UNIT CREDIT SUMS EVERY RECOGNISED RUNNER SUMMARY IN ONE CAPTURED STDOUT (third manifestation of the same root, and the one that made a whole class of criteria unattestable). parseExecutedUnits today returns on the FIRST match — it tries the bun pattern, returns if it hits, else tries the vitest pattern — so a stdout carrying BOTH summaries credits exactly one runner. Measured 2026-08-19 on a chained vitest-then-bun command where both files genuinely ran green (16/16 and 18/18): executed_files 1 against declared_paths 2, verdict under_match, result inconclusive, exit_code 0, lore verify exit 3. This repo has TWO runners BY DESIGN, so before this fix any criterion spanning both was structurally unattestable and the only remedy was to split it by runner. REQUIRED: parseExecutedUnits (or its replacement seam) accounts for EVERY recognised summary present, files and tests summed across them, and judgeCompleteness reads that total; a stdout with one summary is byte-unchanged in behaviour. RED: restore the first-match-wins return and the two-summary case must report 1 file where 2 ran. ⛔ This AC does NOT retire the split-by-runner practice for oracles that need two runner PROCESSES — it removes the tooling's inability to credit them, nothing more. Covered by the describe block named multi-runner-credit in packages/core/tests/attestation-completeness.test.ts.
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts -t multi-runner-credit 2>&1 && echo 'AC-061-19 PASS: executed units sum across every recognised runner summary in one stdout, and the single-summary path is unchanged'
- [⚑] [script] AC-061-20: SERVICE LAYER: AcService.addCriterion and setCriterion ACCEPT a declaration whose only extra path-shaped token appears as prose inside a success-echo segment, and STILL REFUSE a genuinely missing path in a runner segment. The second half is load-bearing: a fix that merely stops looking would trade a false refusal for a false accept, and D8's whole design rests on the refusal working. Measured 2026-08-19: a declaration naming a real integration test path was refused because the human-readable echo at the end of the same command mentioned that file's bare basename; the documented workaround was to reword the echo so it spells no basename, which makes the success line LESS informative and is the exact opposite of what the evidence-tail legibility rule wants. RED (both halves required): (a) revert to whole-string extraction and the echo-prose declaration must be refused again; (b) point a runner segment at a path that does not exist and the refusal must still fire with its D8 --allow-missing-path message intact. Covered by the describe block named echo-prose-not-a-path in packages/lore/tests/unit/service/ac-service.test.ts.
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-service.test.ts -t echo-prose-not-a-path 2>&1 && echo 'AC-061-20 PASS: the service accepts a declaration whose only extra path-shaped token is echo prose, and still refuses a genuinely missing runner-segment path'
- [⚑] [script] AC-061-21: PRODUCTION WIRING, COMPILED BINARY (the bun-runner half split out of AC-061-20 because this repo's two runners cannot share one attestable command): driven from a throwaway corpus by the compiled dist binary, a real lore ac add whose command ends in a success echo mentioning a bare test basename is ACCEPTED and writes the criterion, while the same invocation naming a nonexistent path in its runner segment exits 4 and writes NOTHING. ⛔ This exists because an attested service-layer pass certifies an unreachable capability when the AC's prose promises a user-facing surface: gap 8 was measured AT THE CLI, so the CLI is what must be driven. ⛔ Never assume a lore on PATH is this build — resolve the binary through the freshness-asserted dist constant the sibling e2e suites already use. RED: revert the extractor and this suite's accept case must exit 4.
  script: e2e — bunx --bun vitest run packages/lore/tests/e2e/ac-add-path-precheck-compiled.bun.test.ts 2>&1 && echo 'AC-061-21 PASS: the compiled CLI accepts the echo-prose declaration, writes the criterion, and still exits 4 writing nothing for a genuinely missing runner-segment path'
- [⚑] [script] AC-061-22: A RUNNER SEGMENT IS IDENTIFIED BY ITS LEADING INVOCATION, NEVER BY A SUBSTRING ANYWHERE IN IT (gap 8 reintroduced by its own fix, found by lore assess after AC-061-18/20 were attested and merged). Measured 2026-08-21 on merged main: classifyCommandSegment anchors four arms at ^\s* (VITEST_SEGMENT_PATTERN, PLAYWRIGHT_SEGMENT_PATTERN, BUN_TEST_SEGMENT_PATTERN, BUN_RUN_SEGMENT_PATTERN) but tests the fifth, COMPILED_BINARY_TOKEN_PATTERN = /\bdist\/lore\b/, ANYWHERE in the segment. Probe run against the merged source: for the command 'bunx vitest run packages/core/tests/a.test.ts 2>&1 && echo "PASS: dist/lore rebuilt, see packages/lore/tests/e2e/x.bun.test.ts"' the classifier returned [vitest, lore-cli], extractTestFileTokens returned BOTH paths including the one that exists only inside the echo prose, and countExplicitPathArgs returned 2 where 1 is correct. ⛔ So the exact defect AC-061-20 closes is live again for every success echo that mentions the compiled binary — and this repo's own AC statements mention dist/lore routinely, so the blast radius is the criteria most likely to be authored next. REQUIRED: the compiled-binary arm identifies a segment by its LEADING token like the other four; a mention inside a quoted echo argument classifies the segment as unclassified and contributes NO path tokens. ⛔ Keep AC-061-9's real dogfooding shape ('./dist/lore verify plan-1 <paths>') classified as a runner — that is why the anchor was loosened, and re-tightening it must not re-break that. RED: revert the arm to an unanchored substring test and the echo-prose case must report 2 declared paths again. Covered by the describe block named leading-token-classification.
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts -t leading-token-classification 2>&1 && echo 'AC-061-22 PASS: a compiled-binary mention inside echo prose leaves the segment unclassified and contributes no path tokens, while a real leading dist/lore invocation still classifies as a runner'
- [⚑] [script] AC-061-23: EVERY OCCURRENCE OF A RUNNER SUMMARY IS CREDITED, NOT ONE PER PATTERN (AC-061-19 delivered half its stated property). Measured 2026-08-21 on merged main: parseExecutedUnits calls BUN_SUMMARY_PATTERN.exec(stdout) once and VITEST_SUMMARY_PATTERN.exec(stdout) once, both non-global regexes, so it sums across the two PATTERNS rather than across every summary present. Probe against the merged source: a stdout holding TWO vitest summaries ('Test Files 1 passed (1) / Tests 5 passed (5)' followed by 'Test Files 1 passed (1) / Tests 7 passed (7)') returned {files:1,tests:5} where {files:2,tests:12} is correct, while the mixed vitest-plus-bun case returned {files:2,tests:12} correctly. So AC-061-19's oracle is green because it exercises only the mixed case that gap 7 measured. ⛔ The consequence is the same under-match refusal AC-061-19 exists to remove, for any AC chaining two invocations of the SAME runner — a shape this repo's split-by-runner practice makes more likely, not less. REQUIRED: scan all occurrences (matchAll or a global-flagged clone; ⛔ never mutate a shared regex's lastIndex, which makes the function order-dependent), summing files and tests across every match; a stdout with exactly one summary stays byte-identical in behaviour. RED: restore either single exec call and the two-same-runner case must report 1 file where 2 ran. Covered by the describe block named every-summary-occurrence.
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts -t every-summary-occurrence 2>&1 && echo 'AC-061-23 PASS: two summaries from the same runner sum to two files, the mixed-runner case is unchanged, and the single-summary path is byte-identical'

## Code anchors

- packages/core/src/attestation-completeness.ts
- packages/lore/src/service/verify-runner-service.ts
