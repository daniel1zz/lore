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

Measured 2026-08-17 on a change set of exactly `hooks/pre-push` + `assets/project/pre-push`:
`vitest: selected 0`, `bun: selected 0`, `FAIL: 0 tests selected despite 2 changed file(s)`, exit 1.
So a hook-only edit is REFUSED, not silently passed. That is the good case.

⛔ But loud-zero does NOT protect against under-selection. The moment the change set also contains any
file the rules do match — e.g. `packages/lore/src/generated/assets-manifest.ts`, which a hook edit
normally requires regenerating — the selection is non-empty, loud-zero stays quiet, and the tests that
actually guard the hook are still absent. That combination is the realistic shape of a hook change, and
it IS a silent green. Residual (c) below.

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

### ⛔ The obvious fix does not work — measured, do not retry it

An earlier revision of this doc (and of the retro's §G8) proposed "add literal `"hooks/pre-push"` /
`"assets/project/pre-push"` strings to the parity test so rule (d) can see it — one line, works today".
**That is false.** It was implemented, the literals were committed, and the selection was byte-identical
before and after: still 0 selected, still exit 1. Two independent blockers in `scripts/changed-tests.ts`:

1. **Membership** gates on `BARE_MAIN_INVOCATION_RE = /\bmain\(\)/` (line 509, tested at 545) — a test
   qualifies as a tree-scanning oracle only if it contains a bare `main()` invocation. Literal path
   strings never enter that decision, and the parity test has no reason to call `main()`.
2. **Scope** excludes these paths regardless of content: `"packages-test-tree"` requires
   `startsWith("packages/")`, and `"repo-tracked-text-source"` defers to `hasTextSourceExtension`,
   which returns **false** for an extensionless file (verified directly: `hooks/pre-push` → false,
   `assets/project/pre-push` → false, `scripts/changed-tests.ts` → true). The function's own JSDoc uses
   `hooks/pre-push` as its worked example of `hasNoExtension`.

The literals were kept anyway — they make the suite greppable — but they buy no selection.

**The only real fix is a change to `scripts/changed-tests.ts`**: give rule (d) a hook/asset scope, or
widen the universe so shipping-surface files select their guards by construction. Until then, a change
touching `hooks/**` or `assets/**` must run `packages/lore/tests/unit/assets/pre-push-parity.test.ts`
and `packages/lore/tests/integration/pre-push-binary-provenance-trip.bun.test.ts` BY HAND.

Full analysis: `knowledge-five-governance-gaps-measured-while-landing-the` §G8.
