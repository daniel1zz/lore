---
id: TASK-413
type: task
role: plan
title: "vitest run silently drops a .bun.test.ts named alongside a valid file — exit 0 on a partial run; the loud 'no test files found' guard is defeated by a quorum of one"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: ADR-027, type: relates-to}
  - {id: KN-233, type: relates-to}
---
A concrete, reproducible instance of the sixth false-oracle face named in root `CLAUDE.md`
("`lore evidence` accepts an UNFILTERED multi-file `--result pass` with no proof any file ran") —
here the runner itself manufactures the false pass.

## Measured 2026-08-01 by the orchestrator at `99ed7cd`

    $ bunx vitest run packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts \
                      packages/lore/tests/integration/cli/assess-ai.bun.test.ts
    exit=0
     Test Files  1 passed (1)
          Tests  12 passed (12)
     ✓ packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts (12 tests)

TWO files named on the command line. ONE ran. Exit 0. **No warning, no error, no mention of the
dropped file.** The `.bun.test.ts` file is excluded by vitest config (it needs `bun:sqlite`), and an
explicitly-named argument does not override that exclusion.

## The precise defect shape — a loud guard defeated by a quorum of one

vitest DOES fail loudly when the excluded file is the ONLY argument:

    $ bunx vitest run packages/lore/tests/integration/cli/assess-ai.bun.test.ts
    No test files found, exiting with code 1
    exit=1

So the protection exists — and is annihilated by adding any single matching file to the same
invocation. That is the whole bug: **"no test files found" is evaluated over the invocation, not
per named argument.** A mixed-runner command is therefore a silent partial run whose exit code is
indistinguishable from a full pass.

## Why this is worth mechanizing rather than remembering

- The repo's two-runner split (`.bun.test.ts` → `bun test`, everything else → vitest) makes mixed
  commands an easy and natural mistake, especially for an agent listing "the files I touched".
- It was hit for real this session: an implementer recorded one `lore evidence` row whose `--command`
  named 3 vitest files plus a `.bun.test.ts`. It self-caught and filed corrective entries — but only
  because it happened to re-run the command and read the file count. The exit code gave it nothing.
- Root `CLAUDE.md` already documents `lore evidence`'s unfiltered-multi-file hole as the sixth
  false-oracle face. This is that face with a specific, cheaply-detectable signature.

## Required — decide WHERE, then mechanize

Two candidate homes; weigh both explicitly and justify the choice, do not silently pick one:

1. **`lore evidence` precheck** (`packages/lore/src/adapters/cli/evidence-precheck.ts`) — refuse an
   `--oracle test|e2e --result pass` whose `--command` is a single `vitest` invocation naming ≥1
   `.bun.test.ts` path (provably a partial run), or a single `bun test` invocation naming a non-`.bun`
   test file. This composes with the two prechecks already there (missing-oracle-file, filtered-pass
   matched-count) and is shared verbatim with MCP `lore_evidence_add` — follow that established
   CLI/MCP split, do not duplicate the logic.
   ⛔ Note the existing design constraint documented in `evidence.ts`'s header: NO `--matched <n>`
   flag, because "a bare integer is as fabricable as the false `pass` it would gate". A path-shape
   check is not fabricable in that way — it reads the command the author actually supplied. Say why
   that distinction holds.
2. **A repo guard** asserting no script/test-invocation in the repo mixes runners.

Prefer (1) if the failure mode is "an agent records a misleading evidence row"; prefer (2) or both if
committed scripts also mix. Check whether any do before deciding.

Whichever is chosen:
- ⛔ Fail LOUD with the repair named (split into two commands, one per runner) — never warn-and-continue.
- ⛔ Do not attempt to fix vitest's behaviour or add a wrapper that reorders arguments; the defect being
  mechanized is the AUTHOR's mixed command, not vitest's exclusion logic (which is correct on its own
  terms).

## Oracle

- NEGATIVE: `--oracle test --result pass --command "bunx vitest run a.test.ts b.bun.test.ts"` → refused,
  exit 4, message names the runner split and the repair.
- HAPPY: the same command split in two, each recorded separately → both accepted.
- HAPPY: `cd packages/lore && bun test tests/x.bun.test.ts` → accepted unchanged.
- BOUNDARY: a `vitest run` naming only non-`.bun` files → accepted (regression: unfiltered commands
  stay unaffected, as the SPEC-061 header promises).
- BOUNDARY: `--result fail` / `expected-fail` → unaffected, matching how every other precheck scopes
  itself to `pass` only.
- REGRESSION: the two existing prechecks (missing-oracle-file, filtered-pass matched-count) behave
  identically.
- If the MCP surface is in scope, assert it too — `lore_evidence_add` once bypassed the
  oracle-file precheck entirely for exactly this reason (fixed 2026-07-26).
