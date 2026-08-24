---
id: KN-539
type: knowledge
role: knowledge
title: "Under vitest, importing a name a module does not export is green unless you call it, so a vitest oracle never proves an export exists"
status: approved
priority: high
created: 2026-08-24
updated: 2026-08-24
tags: [false-oracle, vitest, esbuild, typecheck, ac-design, retro]
parent: PRD-001
links:
  - {id: SPEC-149, type: relates-to}
---
# Under vitest, importing a name a module does not export is GREEN unless you call it — so "the test imports it" never proves the export exists

Measured 2026-08-24 with a two-sided probe (both sides run, both results recorded), vitest via
`bunx vitest run`, this repo's toolchain.

## The probe, and both outcomes

`mod.ts` exports `realExport` and keeps `privateOne` module-private:

```ts
export function realExport(): string { return "real"; }
function privateOne(): string { return "private"; }
```

| probe | what it does with the non-exported name | result |
|---|---|---|
| A | imports `privateOne`, **never calls it** | **1 passed** — fully GREEN |
| B | imports `privateOne`, **calls it** | `TypeError: privateOne is not a function`, 1 failed |

B is the control: it proves the probe can detect the condition at all, so A's green is a real
green and not a probe that never ran.

`tsc` catches the same condition at compile time in BOTH cases:
`TS2459: Module '...' declares 'privateOne' locally, but it is not exported.`

## Mechanism

vitest transforms with esbuild, which does not verify named-export existence across module
boundaries. The import resolves to `undefined` and the module loads normally. Nothing on the
import path throws; the failure surfaces only where the binding is USED as a function.

## What this invalidates

⛔ **"The test imports X" is not a vitest-checkable assertion that X is exported.** Any AC whose
oracle is a vitest run, and whose intent is "this symbol is now part of the public surface",
is satisfiable by a test that imports the symbol and never exercises it. The AC passes, the
export does not exist, and the two facts are indistinguishable from the runner's output.

Two properties of THIS repo make it sharper:

1. Typecheck is a SEPARATE script (`bun run typecheck`) from either test runner. A contributor
   or agent who runs only `bunx vitest run` sees green on a defect tsc would name precisely.
2. The convention is that BOTH runners must pass (`test:vitest` + `test:bun`). Neither of them
   is a compile-time check, so "both runners green" carries no export-existence guarantee at
   all.

## The rule that follows

⛔ To assert a symbol is exported, the oracle must either CALL it (probe B's shape) or be
`tsc`. Prefer calling it — a call is also evidence the export is usable, not merely present,
which is the same distinction as "capability implemented" vs "capability wired" already
recorded for anchors and ACs in root CLAUDE.md.

## Where this was met

`spec-the-retired-shape-refusal-message-has-two-byte-identical` AC-MS-2 asserts that
`buildRetiredFeedbackUpstreamError` becomes exported AND that the MCP handler's refusal message
equals its output. That AC is red today only because the probe CALLS the builder — measured:
`TypeError: (0 , buildRetiredFeedbackUpstreamError) is not a function` under vitest, `TS2459`
under tsc, same missing `export`. Had the probe merely imported it for a type position or
referenced it without invoking, the AC would have been green against a non-existent export.
⛔ That was not a designed safeguard — it happened to be the shape the test needed. The AC's
own `--command` pairs the vitest run with a `grep -q 'export function
buildRetiredFeedbackUpstreamError'`, which is what actually makes the export-existence half
non-vacuous, and that pairing is the transferable part.
