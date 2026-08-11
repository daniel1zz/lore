---
id: SPEC-063
type: spec
role: spec
title: "Verify execution-root correctness under linked worktrees"
status: approved
priority: medium
created: 2026-07-21
updated: 2026-07-27
tags: []
parent: PRD-001
---
# SPEC-063 — Verify execution-root correctness under linked worktrees

## Overview

`lore verify` derives the directory it spawns AC commands in from the corpus
database location:

```
// app.ts
const repoRoot = dirname(dirname(dbPath));   // "<repoRoot>/.lore/lore.db"
```

and `findLoreDbPath` walks **up** from `process.cwd()` looking for
`.lore/lore.db`. A linked git worktree carries no `.lore/` of its own, so that
walk necessarily lands on the **main checkout's** corpus — and therefore
`repoRoot` becomes the main checkout, no matter which worktree the caller is
standing in.

Consequence: **an agent running `lore verify` inside its own worktree
attests against the main checkout, not against the code it just wrote.** Its
declared AC commands execute on a tree that may not contain its changes at all.
The resulting evidence is `attestation`-stamped and exit-code-derived — every
trust marker present — while describing a different tree than the one under
test.

Found 2026-07-21 by a worktree implementer that ran `lore verify` for two ACs
it had just authored: one came back attested `fail` and one attested `pass`,
both computed against the main checkout. Because evidence is append-only, both
poisoned entries are permanently in that task's log; the implementer flagged
it rather than working around it, and a re-run from the main checkout produced
the correct verdicts.

This is the third distinct false-attestation vector found in two days, after
SPEC-061's under-match oracle and SPEC-060's mistyped AC paths. The pattern
across all three: **the trust markers were intact and the answer was still
wrong**, because nothing verified that the oracle measured the intended
subject.

## Scope

### In

- **D1 — pure execution-root resolution.** New
  `resolveVerifyExecutionRoot({corpusRoot, callerCwd, gitFacts})` in
  `@lore/core`, returning
  `{root: string, mode: "corpus_root" | "worktree", warning?: string}`:
  - `callerCwd` inside a linked worktree (its resolved `--git-common-dir`
    differs from its `--git-dir`) whose root differs from `corpusRoot`
    → `{root: <worktree root>, mode: "worktree"}`.
  - otherwise → `{root: corpusRoot, mode: "corpus_root"}` (today's behaviour,
    byte-identical).
  Pure: git facts arrive as data, never probed here (the `GitPort`/`FsProbe`
  precedent).
- **D2 — verify uses it.** `VerifyRunnerService` spawns AC commands from the
  resolved root. When `mode === "worktree"`, `lore verify` prints the execution
  root on its own line before running anything — a silent switch would trade
  one invisible wrong root for another.
- **D3 — attestation records the root.** `attestation` gains optional
  `execution_root?: string` and `execution_mode?: "corpus_root" | "worktree"`,
  so any past record can be audited for which tree it measured. Absent on
  pre-existing records (present-iff-computed), so historical evidence parses
  unchanged.
- **D4 — `lore verify --execution-root <path>` escape.** An explicit override
  for layouts the heuristic cannot infer; when passed, `mode` is reported as
  the explicit value and D2's line always prints.

### Out

- Changing `findLoreDbPath` / corpus resolution itself — the corpus is
  legitimately shared across worktrees (that is what makes cross-worktree
  session registry and anchor gating work). Only the **execution** root is
  wrong, not the corpus root.
- Retroactively re-judging or deleting the two poisoned evidence entries
  (evidence is append-only by design; the corrective entries and this spec are
  the record).
- Non-verify consumers of `repoRoot` (`SeatService`'s `RealGitPort`, etc.) —
  they legitimately want the main checkout; this spec deliberately narrows to
  the command-spawning root.
- Detecting that a worktree's branch lacks the commits under test (a different,
  harder question than which directory to run in).

## Design

The resolution is pure and data-driven so it is testable without a real repo;
the CLI adapter supplies git facts via the existing `RealGitPort`, which
already exposes worktree knowledge for SPEC-057's seat model. `VerifyRunnerService`
receives the resolved root rather than computing it, keeping the service free
of git/process probing (mirrors how `repoRoot` is injected today).

## Acceptance Criteria

- **AC-063-1** — `resolveVerifyExecutionRoot` returns `mode: "worktree"` and the
  worktree root when given git facts describing a linked worktree whose root
  differs from `corpusRoot`; returns `mode: "corpus_root"` and `corpusRoot`
  when the facts describe a main checkout.
- **AC-063-2** — REPRO: a verify run whose caller cwd is a linked worktree
  spawns its AC command with cwd equal to that worktree root, proven by an AC
  command that writes its own `pwd` and asserting the captured value equals the
  worktree root, not the corpus root.
- **AC-063-3** — REGRESSION: a verify run invoked from the main checkout spawns
  with cwd equal to `corpusRoot`, and its recorded evidence is byte-identical
  in every pre-existing field to a run recorded before this change.
- **AC-063-4** — When `mode === "worktree"`, `lore verify`'s stdout contains the
  resolved execution root before the first AC result line; when
  `mode === "corpus_root"`, stdout contains no execution-root line (byte-identical
  to today).
- **AC-063-5** — `attestation.execution_root` and `execution_mode` are present
  on evidence written by a run under this change, and an evidence record lacking
  both still parses against `evidenceEntrySchema` (optional-field regression).
- **AC-063-6** — `lore verify --execution-root <path>` spawns from exactly that
  path and reports it, overriding the inferred value.


## Acceptance Criteria (structured)

- [✔] [script] AC-063-1: resolveVerifyExecutionRoot returns mode=worktree with the worktree root for git facts describing a linked worktree whose root differs from corpusRoot, and mode=corpus_root with corpusRoot for main-checkout facts, across at least 6 table-driven cases
  script: test — bunx vitest run packages/core/src/verify-execution-root.test.ts
- [✔] [script] AC-063-2: REPRO: a verify run whose caller cwd is a linked worktree spawns its AC command with cwd exactly equal to that worktree root, proven by capturing the command's own pwd output and asserting string equality with the worktree root and inequality with the corpus root
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-execution-root.test.ts -t 'REPRO'
- [✔] [script] AC-063-3: REGRESSION: a verify run invoked from the main checkout spawns with cwd exactly equal to corpusRoot and its evidence record is byte-identical in all pre-existing fields to a pre-change run
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-execution-root.test.ts -t 'REGRESSION'
- [✔] [script] AC-063-4: When mode=worktree the verify stdout contains the resolved execution root on a line preceding the first AC result line; when mode=corpus_root the stdout contains exactly 0 execution-root lines
  script: test — bunx vitest run packages/lore/tests/unit/adapters/verify-render-execution-root.test.ts
- [✔] [script] AC-063-5: attestation.execution_root and execution_mode are present on evidence written under this change, and an evidence record lacking both fields still parses against evidenceEntrySchema with 0 validation errors
  script: test — bunx vitest run packages/core/src/task-workflow.test.ts -t 'execution_root'
- [✔] [script] AC-063-6: lore verify --execution-root path spawns from exactly that path and reports it, overriding the inferred value in at least 2 cases covering main checkout and worktree
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-execution-root.test.ts -t 'explicit override'

## Code anchors

- packages/core/src/verify-execution-root.ts
- packages/lore/src/adapters/cli/verify-render.ts
