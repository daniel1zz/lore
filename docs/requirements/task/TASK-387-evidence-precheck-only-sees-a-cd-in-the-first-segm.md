---
id: TASK-387
type: task
role: plan
title: "evidence-precheck only sees a cd in the FIRST segment of a command chain, so it falsely refuses this repo's own mandated build-then-cd e2e form and nudges the author toward --oracle manual"
status: archived
priority: medium
created: 2026-08-02
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: ADR-028, type: relates-to}
---
Found by dogfooding `lore evidence` during a merge close-out, 2026-08-02. The refusal itself is
CORRECT and fail-loud — this task is about the population it wrongly refuses and where that pushes
the author.

## Measured

Two evidence calls, identical in shape, one accepted and one refused:

    ACCEPTED: cd packages/lore && bun test tests/integration/cli/assess-commit-derivation-archived-mismatch.bun.test.ts
    REFUSED:  bun run build && cd packages/lore && bun test tests/e2e/resume-coverage-compiled.bun.test.ts
      → Oracle file(s) not found: tests/e2e/resume-coverage-compiled.bun.test.ts.
        Checked root(s): /Users/apple/Projects/zz/lore.

Both files exist. Both use `--oracle` kinds that are checked (`evidence-precheck.ts:322` gates on
`test` OR `e2e`, so kind is not the difference). The difference is the position of `cd`:

    export function extractCdPrefixTarget(command: string): string | null {
      const match = /^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)/.exec(command);

The regex is anchored at `^`. A `cd` anywhere but the first segment of the chain is invisible, so
the precheck resolves the test path against the repo root instead of `packages/lore` and refuses.

## Why the refused form is not a misuse

This repo's compiled e2e tests REQUIRE a preceding build — CLAUDE.md's own standing lesson is that a
stale `dist/lore` makes such a run `inconclusive`. So `bun run build && cd packages/lore && bun test
<e2e file>` is not a sloppy variant; it is the only correct way to run that tier, and it is exactly
the shape the precheck cannot see. The same applies to any `bun install && cd … && …` in a fresh
worktree, which this repo's dispatch discipline mandates as the FIRST step.

## The actual harm — not a false pass, a push toward one

The refusal is fail-loud and names the root it checked, so it never fabricates evidence. The harm is
second-order and was live in the moment it happened: the cheapest way for an author to get past this
refusal is to switch to `--oracle manual`, which skips file checking entirely. That converts a
verifiable row into an unverifiable one, silently, as the path of least resistance — and the author
who does it is not cheating, they are working around a check that misread a correct command. A guard
whose false-refusal exit is "declare it unverifiable" degrades the corpus it protects.

## Proxy / Silence / Opt-in

- **Proxy** — "the command STARTS with `cd X`" is a proxy for "the test path resolves under X".
  Concrete input satisfying the property while violating the proxy: the REFUSED command above, whose
  execution directory genuinely is `packages/lore`. Not accepted: the fix is cheap and the
  false-refusal population is this repo's own mandated command shapes.
- **Silence** — none in the refusal itself (it is loud and names the checked roots, which is why the
  cause was diagnosable in one read). The silence lives downstream, in the `--oracle manual` escape
  it nudges authors toward. Consider whether `manual` deserves its own marker distinguishing
  "genuinely manual" from "script-shaped command recorded as manual".
- **Opt-in** — n/a for the parser. But note `manual` is effectively an opt-out of the whole check,
  chosen by whoever hits friction, which is the wrong selection criterion.

## Required

- Scan every `&&`/`;`-separated segment for a leading `cd`, not just the first, and apply the LAST
  one that precedes the test invocation (a later `cd` overrides an earlier one, matching shell
  semantics). Keep `extractCdPrefixTarget` pure and Node-builtin-free — the module header states it
  must stay importable from vitest.
- Keep the roots-naming behaviour in the refusal message exactly as is; extend it to name the cd
  target it derived, so a future mismatch is diagnosable without reading the source.

## Oracle

- RED first: `bun run build && cd packages/lore && bun test tests/e2e/resume-coverage-compiled.bun.test.ts`
  is currently REFUSED with an existing file; after the fix it is accepted. Must fail before.
- CONTROL: the already-working leading-`cd` form keeps working, byte-identical.
- CONTROL: a command with NO `cd` still resolves against the roots exactly as today.
- CONTROL: a genuinely missing file is STILL refused in every form — assert this with a cd-prefixed
  command naming a nonexistent path, so the fix cannot degrade into "always accept".
- BOUNDARY: two `cd` segments (`cd a && cd b && bun test f`) resolve against the LAST one; assert the
  derived target by value.
- CONTROL: `;` separators behave the same as `&&` (the current regex already accepts both).
