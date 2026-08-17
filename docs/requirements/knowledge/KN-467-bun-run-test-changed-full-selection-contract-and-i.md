---
id: KN-467
type: knowledge
role: knowledge
title: "bun run test:changed — full selection contract and its three residuals"
status: approved
priority: medium
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PRD-001
---
# `bun run test:changed` — full selection contract and its three residuals

Evicted from root CLAUDE.md 2026-08-17 when an edit tripped the eviction floor. That file now carries
a one-line pointer here. The authoritative implementation contract is the module header of
`scripts/changed-tests.ts`; this doc is the operator-facing summary plus the measured residuals, which
the module header does not enumerate as failure modes.

## What it is

A deterministic worktree oracle: transitive reverse-dependency selection across BOTH runners (vitest
and `bun test`). Default base is `merge-base main HEAD`. `--list` previews the selection without
running it.

## The four selection rules

1. **changed-test** — a changed file that is itself a test file.
2. **reverse-dep** — tests that transitively import a changed file.
3. **binary-consumer** — tests that exercise the compiled binary (`dist/lore` / `LORE_BIN`) or the
   source entry (`INDEX_TS`). For the compiled variant the selector runs `bun run build` first; for
   the source variant it does not.
4. **tree-scanning oracle** — fires when a changed file falls inside THAT test's own scan scope. This
   is the rule meant to catch changes outside the traced universe.

**File universe** (`loadFileMap`): `packages/*/src/**/*.ts(x)`, `packages/*/tests/**/*.ts`, and
`scripts/**/*.ts`.

## Loud-zero

A NON-EMPTY changed-file set that selects 0 tests exits 1, in BOTH `--list` and executing mode — never
a silent green. The only legitimate 0-selection exit-0 is a genuinely EMPTY changed-file set.

⛔ Loud-zero does NOT protect against under-selection. If any rule matches anything, the selection is
non-empty and loud-zero stays quiet, even when the tests that actually guard the change were all
missed. Residual 3 below is exactly that case.

## Three measured residuals

**(a) Selection reads CONTENT MARKERS.** A subprocess or tree-scanning test that names no literal path
is invisible to rule 4. Naming the path in a comment is enough to make it visible.

**(b) reverse-dep walks STATIC imports only.** A test reaching its target through `await import()` in a
function body is NEVER selected. Measured. Run dynamic consumers by hand.

**(c) `hooks/**` and `assets/**` are outside the universe entirely.** Measured 2026-08-17 on the
AC-BFI-3 change set: editing `hooks/pre-push` and `assets/project/pre-push` selected NEITHER
`packages/lore/tests/unit/assets/pre-push-parity.test.ts` (the dedicated oracle for that byte-identical
pair) NOR any hook trip test on their own account. 169 files were selected, of which 157 came from the
binary-consumer rule — triggered only because `packages/lore/src/generated/assets-manifest.ts`
happens to live under `packages/`. A commit touching ONLY `hooks/pre-push` — the shipping surface every
`lore setup --project` consumer receives — runs neither guard and reports a confident green.

(c) compounds with (a): rule 4 exists to cover exactly this, but the parity test builds its targets as
`join(REPO_ROOT, "hooks", "pre-push")`, leaving no literal string to match.

Fixes, cheapest first: add literal `"hooks/pre-push"` / `"assets/project/pre-push"` strings to the
parity test (works today, one line, but leaves the next unmarked scan test invisible); widen the
universe with an `assets/**` + `hooks/**` rule so shipping-surface files select their guards by
construction (the real fix). Full analysis: `knowledge-five-governance-gaps-measured-while-landing-the`
§G8.
