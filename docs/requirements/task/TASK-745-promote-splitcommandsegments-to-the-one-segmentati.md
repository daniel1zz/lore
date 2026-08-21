---
id: TASK-745
type: task
role: plan
title: "Promote splitCommandSegments to the one segmentation seam and make all three path-parsing consumers read runner segments"
status: draft
priority: high
phase: "root-fix"
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PLAN-134
plan: PLAN-134
---
# Task Objective

Make command-string path extraction segment-aware in ONE place and have all three consumers
read it, then prove the fix at the compiled-CLI surface. Close all four criteria
`AC-061-18` … `AC-061-21`.

# Spec Reference

`spec-spec-061-attestation-completeness-guard-detect-zero-match-u` §D1 (the module that owns
`countExplicitPathArgs` / `parseExecutedUnits` / `judgeCompleteness`), and
`spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a` §D8 + D1 (which promoted
the file-existence primitives into `@lore/core` and owns the declaration-time consumer).

Read `knowledge-four-governance-gaps-measured-while-resuming-handoff` sections 5, 7, 8 and
"What the pattern in 5, 7 and 8 actually is" FIRST. Every figure there carries its
reproduce command; do not re-derive them from this document.

# Acceptance Criteria

Four, already declared on the spec. ⛔ Read them with
`lore ac list spec-spec-061-attestation-completeness-guard-detect-zero-match-u` — the
statements are the contract, this summary is not.

| AC | Runner | Oracle file |
|---|---|---|
| `AC-061-18` | vitest | `packages/core/tests/attestation-completeness.test.ts`, case name must contain `runner-segment-scope` |
| `AC-061-19` | vitest | same file, case name must contain `multi-runner-credit` |
| `AC-061-20` | vitest | `packages/lore/tests/unit/service/ac-service.test.ts`, case name must contain `echo-prose-not-a-path` |
| `AC-061-21` | bun | `packages/lore/tests/e2e/ac-add-path-precheck-compiled.bun.test.ts` — **you create this file** |

⛔ The `-t` filters above are part of the declared commands. If your case names do not contain
those substrings, vitest matches nothing, exits 0, and the completeness guard reports
`zero_match` — you will have written a passing suite that the oracle cannot see.

# Context Digest — the three manifestations, with the code read 2026-08-21

**Manifestation 1 + 3 (AC-061-18) — the flat scan.**
- `tokenizeCommand` (`packages/core/src/attestation-completeness.ts:157`) is a bare
  `/"([^"]*)"|'([^']*)'|(\S+)/g` loop. It never sees `&&`, `;`, `|`, or subshells, so
  `countExplicitPathArgs` (line 195) walks the WHOLE chain as one argv list.
- `extractTestFileTokens` (`packages/core/src/oracle-file-existence.ts:104`) is
  `command.match(TEST_FILE_TOKEN_PATTERN)` over the raw string — same blindness, and it also
  scans quoted prose, which is manifestation 3.
- `splitCommandSegments` ALREADY EXISTS at `oracle-file-existence.ts:151`, is quote-aware,
  and is used only by the `cd`-prefix derivation. ⛔ Promote and reuse it. Do NOT write a
  second splitter — the whole point of this task is that two walkers over one string are two
  definitions of the same rule, and they disagreed in opposite directions.
- Decide and record what counts as a "runner segment". `bunx vitest run …`, `bun test …`,
  `bun run <script> …`, `bunx playwright test …` are the shapes this repo actually declares
  (grep the corpus's declared commands for the real distribution before fixing the list).
  A segment matching none of them contributes NO path tokens AND is reported as
  unclassified — never silently as zero.

**Manifestation 2 (AC-061-19) — first-match-wins.**
`parseExecutedUnits` (`attestation-completeness.ts:572`) tries the bun pattern, returns if it
hits, else tries vitest. A stdout holding both summaries credits one runner. Measured:
`executed_files: 1, declared_paths: 2, completeness: under_match, exit_code: 0`, while both
files ran green. ⛔ A single-summary stdout must stay byte-identical in behaviour — pin that
as a regression case, not as an afterthought.

**The consumers you must not break.** `judgeCompleteness` feeds
`VerifyRunnerService` (`packages/lore/src/service/verify-runner-service.ts`) and the evidence
guard. `AC-061-15` is a standing REGRESSION criterion over
`packages/lore/tests/unit/service/verify-runner-service.test.ts` plus the attestation
suite with NO `-t` filter — run it.

# Verification discipline

- ⛔ Red first, and the red is recorded BY YOU at the moment it is red:
  `lore evidence <task> --oracle test --command "<cmd>" --result expected-fail`, from inside
  this worktree. A red described in your final report and transcribed later by the
  orchestrator is not evidence. Measured last round: 13 of 14 red-first records were
  transcriptions; independent re-run rate was 7%.
- ⛔ Every AC pass must be ATTESTED: use `lore verify <plan> --task <this task>`.
  `lore evidence --capture` is NOT attested — it labels `capture_source: runner` but issues
  no `attestation` block, so pass/fail is still yours to type. Use it only for observations
  outside the four ACs.
- ⛔ For each of the four, name the smallest mutation that turns it red and RUN it. Then
  declare it as a real falsifier — `lore ac set <spec> <AC> --falsifier-path
  --falsifier-find --falsifier-replace --falsifier-exit-code` (all four flags required) —
  and run `lore verify --falsify` while THIS PLAN IS STILL LIVE. Measured 2026-08-21: a
  falsifier whose governing plan is archived can never be re-run
  (`knowledge-the-falsifier-mechanism-is-shipped-but-inert-a` F2), so a declaration made
  after this plan closes is dead on arrival.
- ⛔ `lore ac set` DEMOTES SPEC-061 to `draft`. Do this as your LAST step, report that you
  did it, and do NOT try to re-approve — the orchestrator restores the spec after merging.
- ⛔ Scoped oracles only inside this worktree: `bun run test:changed <base>` is the
  deterministic selector. It STILL under-selects a tree-scanning test that names no literal
  path and any consumer reached through a dynamic `await import()` — run those BY HAND. It is
  also structurally blind to `.bun.test.ts` via `vitest --changed`, so run your new
  `.bun.test.ts` file explicitly. The full suite is the orchestrator's job on main.
- ⛔ `packages/core` is a monorepo sub-package. If you export a new symbol from `@lore/core`,
  BUILD it before typechecking any consumer in `packages/lore` — tsc cannot see an unbuilt
  export, and the resulting red is an artifact, not a defect.
- ⛔ `@lore/core`'s default barrel must stay browser-safe: no top-level `fs`/`path`/`os`
  import. Node-only IO belongs in `@lore/core/node`.
- ⛔ Never write to this repo's own `.lore/` from a test. The compiled-CLI e2e suite MUST use
  a throwaway corpus (`mkdtemp` + `lore init`) — copy the pattern from a sibling in
  `packages/lore/tests/e2e/`, and resolve the binary through the freshness-asserted dist
  constant those suites already use, never a bare `lore` on PATH.

# File Anchors

- `packages/core/src/attestation-completeness.ts`
- `packages/core/src/oracle-file-existence.ts`
- `packages/core/tests/attestation-completeness.test.ts`
- `packages/lore/src/service/ac-service.ts`
- `packages/lore/tests/unit/service/ac-service.test.ts`
- `packages/lore/tests/e2e/ac-add-path-precheck-compiled.bun.test.ts`
