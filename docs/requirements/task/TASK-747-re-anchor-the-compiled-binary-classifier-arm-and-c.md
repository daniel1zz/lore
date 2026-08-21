---
id: TASK-747
type: task
role: plan
title: "Re-anchor the compiled-binary classifier arm and credit every runner summary occurrence"
status: draft
priority: critical
phase: "root-fix"
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PLAN-134
plan: PLAN-134
---
# Task Objective

Close two defects that `lore assess` found in ALREADY-MERGED, ALREADY-ATTESTED code from the
same plan. Both were invisible to the four ACs that certified the slice.

# Spec Reference

`spec-spec-061-attestation-completeness-guard-detect-zero-match-u`, `AC-061-22` and `AC-061-23`.
⛔ Read the statements with `lore ac list` — they carry the exact probe outputs measured on
merged main, which is what you must reproduce as your red.

# Defect 1 (`AC-061-22`) — gap 8 is LIVE again, reintroduced by its own fix

`classifyCommandSegment` (`packages/core/src/oracle-file-existence.ts:333-338`) anchors four
arms at `^\s*`:

    VITEST_SEGMENT_PATTERN    = /^\s*(?:bunx\s+)?vitest\b/
    PLAYWRIGHT_SEGMENT_PATTERN= /^\s*(?:bunx\s+)?playwright\s+test\b/
    BUN_TEST_SEGMENT_PATTERN  = /^\s*bun\s+test\b/
    BUN_RUN_SEGMENT_PATTERN   = /^\s*bun\s+run\s+\S+/

and then tests the fifth ANYWHERE in the segment:

    COMPILED_BINARY_TOKEN_PATTERN = /\bdist\/lore\b/

Measured on merged main, probe run directly against the source:

    command: bunx vitest run packages/core/tests/a.test.ts 2>&1 && echo 'PASS: dist/lore rebuilt, see packages/lore/tests/e2e/x.bun.test.ts'
    classify        -> ["vitest", "lore-cli"]     <-- the ECHO segment is treated as a runner
    extractTestFileTokens -> both paths, including the one that exists only inside the echo prose
    countExplicitPathArgs -> 2                     <-- 1 is correct

⛔ That is exactly gap 8 — the defect `AC-061-20` exists to close — alive again through a
narrower door, in the same commit that fixed it. And the blast radius is the criteria most
likely to be written next: this repo's AC success-echoes mention `dist/lore` routinely.

⛔ The anchor was loosened for a real reason. `AC-061-9`'s own dogfooding shape
`./dist/lore verify plan-1 <paths>` MUST stay classified as a runner. Re-tightening must keep
that working — identify a segment by its LEADING token (which `./dist/lore …` satisfies), not by
a substring scan. There is a standing regression pair for this:
`bunx vitest run packages/lore/tests/unit/service/verify-completeness.test.ts` — run it.

# Defect 2 (`AC-061-23`) — one summary per PATTERN, not per occurrence

`parseExecutedUnits` (`packages/core/src/attestation-completeness.ts:660-680`) calls
`BUN_SUMMARY_PATTERN.exec(stdout)` once and `VITEST_SUMMARY_PATTERN.exec(stdout)` once. Both
regexes are non-global, so it sums across the two PATTERNS, never across every occurrence.

Measured on merged main:

    two vitest summaries in one stdout -> {files:1, tests:5}    <-- {files:2, tests:12} is correct
    vitest + bun in one stdout         -> {files:2, tests:12}   <-- correct, and the only case AC-061-19's test covers

So `AC-061-19` is green because its cases exercise only the mixed-runner shape gap 7 measured.
Any AC chaining two invocations of the SAME runner still gets the under-match refusal
`AC-061-19` exists to remove.

⛔ Scan all occurrences (`matchAll`, or a global-flagged clone). ⛔ Never mutate a shared
regex's `lastIndex` — that makes the function order-dependent and its next caller wrong.
⛔ A stdout with exactly one summary must stay byte-identical in behaviour; pin that as a case.

# Why the existing ACs missed both

`AC-061-18/19/20/21` are all green and attested. Neither defect is reachable from their cases:
no case feeds an echo mentioning `dist/lore`, and no case feeds two same-runner summaries. ⛔ The
lesson to apply while writing your cases, not just to note: an AC proves only the point it
explicitly asserts, and the gap between "goal met" and "AC green" is the AC author's
responsibility. Ask for each case you write what the smallest input is that keeps it green while
the goal fails.

# Verification discipline

- ⛔ Your `-t` case names MUST contain `leading-token-classification` (AC-061-22) and
  `every-summary-occurrence` (AC-061-23) — the declared commands filter on those substrings. A
  mismatch makes vitest run nothing, exit 0, and the completeness guard report `zero_match`.
- ⛔ Red first, recorded by YOU at the moment it is red, in your worktree:
  `lore evidence <task> --oracle test --command "<cmd>" --result expected-fail`. Both reds are
  trivially reachable — the defects are live on main, so write the case, watch it fail, record.
- ⛔ ATTEST each pass with `lore verify plan-fix-the-flat-command-tokenizer-at-its-root-one --task <this task>`.
  `lore evidence --capture` is NOT attested and does not count for an AC.
- ⛔ Do NOT use `lore verify --falsify`. Measured 2026-08-21: 11 of 11 invocations were vacuous —
  the scratch worktree cannot run the commands at all and the runner compares only the exit code
  (`knowledge-lore-verify-falsify-compares-only-the-exit-code-so-an`). It would hand you a
  green-looking artifact that proves nothing. Your manual red IS the evidence here.
- ⛔ Do NOT run `lore ac set` — the orchestrator handles the spec's lifecycle.
- ⛔ Run the whole `packages/core/tests/attestation-completeness.test.ts` file unfiltered (92
  cases on main) and `packages/lore/tests/unit/service/ac-service.test.ts` (40) — both host the
  earlier ACs and must stay green.
- ⛔ `packages/core` is a monorepo sub-package: build before typechecking a `packages/lore`
  consumer, or the red you read is an artifact.
- ⛔ `@lore/core`'s default barrel stays browser-safe: no top-level `fs`/`path`/`os`.

# File Anchors

- `packages/core/src/oracle-file-existence.ts`
- `packages/core/src/attestation-completeness.ts`
- `packages/core/tests/attestation-completeness.test.ts`
