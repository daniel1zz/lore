---
id: KN-120
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-063 verify execution-root correctness (2026-07-21)"
status: approved
priority: medium
created: 2026-07-21
updated: 2026-07-24
tags: []
parent: PLAN-064
links:
  - {id: PLAN-064, type: informs}
---
# Assessment: partially_met (76/100)

Scope: plan `01KY1RMKBKE41PZ08KS1GF18EE`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-063-1 | 92 | Attested run of packages/core/src/verify-execution-root.test.ts shows 16 tests passing; diff shows a table-driven suite with 8 cases (≥6 required) covering main checkout, worktree, nested cwd, unresolved probe, degenerate equal-root, null root, inconsistent facts, trailing slash. Pure resolver matc… | 01KY1RMME8DXK5QY6BDG26Z6AN (evidence [10], human-attested, 16/16 pass) |
| AC-063-2 | 62 | Attested REPRO run passes (1 test), but the test does NOT satisfy the statement: it injects a hand-built opts.executionRoot into the service with a stub executor and asserts spawnSpec.cwd. No real linked worktree, no caller cwd, no capture of the command's own pwd output as the AC explicitly requir… | 01KY1RMME8DXK5QY6BDG26Z6AN (evidence [11]; 1 passed, 4 skipped) |
| AC-063-3 | 70 | Attested REGRESSION run passes (2 tests) and shows omitted executionRoot → cwd === corpusRoot. But 'byte-identical in all pre-existing fields' is asserted via toMatchObject against hand-written expectations, not a diff against an actual pre-change run; first_seen/completeness/executed_files are exp… | 01KY1RMME8DXK5QY6BDG26Z6AN (evidence [12]) |
| AC-063-4 | 76 | Attested run: 12 tests pass on verify-render-execution-root.test.ts, covering worktree-prints-before-header, corpus_root prints exactly 0 lines, override forcing. Tests exercise the pure buildVerifyHeaderLines helper, not actual CLI stdout; ordering vs the first AC line is simulated by array concat… | 01KY1RMME8DXK5QY6BDG26Z6AN (evidence [13]) |
| AC-063-5 | 90 | Attested run: 4 tests pass on task-workflow.test.ts -t execution_root. Diff shows optional execution_root (min 1) + execution_mode enum on evidenceEntrySchema, HAPPY both modes, BOUNDARY enum rejection, and REGRESSION safeParse success with both fields absent — a direct match to the statement. | 01KY1RMME8DXK5QY6BDG26Z6AN (evidence [14]) |
| AC-063-6 | 62 | Attested run passes 2 override cases. But both bypass the CLI: they pass executionRoot directly to the service, proving only that the service honors the opt. The --execution-root flag parsing, resolvePath normalization, and synthetic-fact composition in resolveCliExecutionRoot are untested. | 01KY1RMME8DXK5QY6BDG26Z6AN (evidence [15]; 2 passed, 3 skipped) |

## Gaps

- The REPRO test contradicts its own AC statement's oracle: it asserts on a stubbed executor's spawn spec cwd instead of capturing the command's own pwd output from a real run inside a real linked worktree. The class of bug being closed (a real spawn landing in the wrong tree) is therefore proven only at the seam the fix itself introduces, not end to end.
- gatherVerifyGitFacts — the sole production path that decides isLinkedWorktree/worktreeRoot via three git rev-parse shell-outs and resolvePath normalization — is entirely untested. A defect there (e.g. --git-common-dir relative-path resolution, symlinked /private/var-style macOS paths) would silently degrade every real invocation to corpus_root, restoring the original bug while all six ACs stay green.
- AC-063-6 says 'lore verify --execution-root path spawns from exactly that path and reports it', but both attested cases feed executionRoot straight to VerifyRunnerService. Neither flag parsing nor the reporting half (the always-print rule) is exercised through the CLI.
- 'Byte-identical to a pre-change run' is asserted via toMatchObject on hand-written fields, with first_seen/completeness/executed_files deliberately excluded — a weaker oracle than the statement claims (a snapshot against actual pre-change output would be the literal check).

## Recommendations

- Require that an AC whose statement names a concrete observable (e.g. 'the command's own pwd output') be verified by a test that produces that observable; reject stub-level substitutes at review time.
- Add a task covering gatherVerifyGitFacts against a real tmpdir worktree, a main checkout, a non-git directory, and a symlinked path (macOS /private/var).
- Attach the captured red REPRO output as evidence when an exit criterion requires a fail-first demonstration, rather than asserting it in the commit message.
- Write a knowledge doc generalizing the false-attestation failure class across SPEC-060/061/063 (wrong path, under-matching oracle, wrong tree) with a checklist for future verify changes.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 72739ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-063-1, AC-063-2, AC-063-3, AC-063-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.75 | evidence | Resolver, service wiring, schema fields, CLI flag and render line all present and coherent in the diff; all 6 ACs have attested passing runs. Weakness is proof depth, not missing implementation. |
| evidence_integrity | 66 | 0.7 | evidence | Every AC has a human-recorded attested run with output tails, 0 fails. But three ACs' tests substitute stubs for the behavior their statements demand, and full-suite/typecheck claims are self-reporte… |
| scope_fidelity | 90 | 0.8 | evidence | Single-slice change as planned; touches exactly the resolver, service, schema, app wiring, CLI. The verify-render.ts extraction is justified and moves formatAcResultLine verbatim. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-063-2 | The REPRO test contradicts its own AC statement's oracle: it asserts on a stubbed executor's spawn spec cwd instead of capturing the command's own pwd output from a real run inside a real linked worktree. The class of bug being closed (a real spawn landing in the wrong tree) is therefore proven only at the seam the fix itself introduces, not end to end. |
| outcome | major | — | gatherVerifyGitFacts — the sole production path that decides isLinkedWorktree/worktreeRoot via three git rev-parse shell-outs and resolvePath normalization — is entirely untested. A defect there (e.g. --git-common-dir relative-path resolution, symlinked /private/var-style macOS paths) would silently degrade every real invocation to corpus_root, restoring the original bug while all six ACs stay green. |
| evidence_integrity | minor | AC-063-6 | AC-063-6 says 'lore verify --execution-root path spawns from exactly that path and reports it', but both attested cases feed executionRoot straight to VerifyRunnerService. Neither flag parsing nor the reporting half (the always-print rule) is exercised through the CLI. |
| evidence_integrity | minor | AC-063-3 | 'Byte-identical to a pre-change run' is asserted via toMatchObject on hand-written fields, with first_seen/completeness/executed_files deliberately excluded — a weaker oracle than the statement claims (a snapshot against actual pre-change output would be the literal check). |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require that an AC whose statement names a concrete observable (e.g. 'the command's own pwd output') be verified by a test that produces that observable; reject stub-level substitutes at review time. | Three of six ACs here pass against stubs that do not produce the observable their statements specify. |
| plan | Add a task covering gatherVerifyGitFacts against a real tmpdir worktree, a main checkout, a non-git directory, and a symlinked path (macOS /private/var). | It is the only untested component on the production decision path; a defect there silently restores the original bug. |
| process | Attach the captured red REPRO output as evidence when an exit criterion requires a fail-first demonstration, rather than asserting it in the commit message. | Exit Criteria demanded the REPRO be shown red first; only prose supports it. |
| spec | Write a knowledge doc generalizing the false-attestation failure class across SPEC-060/061/063 (wrong path, under-matching oracle, wrong tree) with a checklist for future verify changes. | Third instance in two days and 0 knowledge docs linked. |

## Unverifiable Materials

- bun run typecheck, bun run test:vitest, cd packages/lore && bun test results: Self-reported by the implementing agent (evidence [7]-[9]); no human-attested run or captured output tail.
- Pre-fix red run of the AC-063-2 REPRO test: Claimed in the commit message via a scoped git stash; no evidence record or output captured.
- Actual lore verify stdout under a linked worktree: Only the pure render helper is tested; no end-to-end CLI output was captured.

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.40
