---
id: PLAN-141
type: plan
role: plan
title: "Retire SPEC-146's split debt — repoint the eight stale claude-md-check references, one of them a live error message"
status: archived
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: SPEC-146
phases:
  - {name: "P1-repoint", description: "Repoint all 8 present-tense claude-md-check references (7 JSDoc + 1 live PurityCheckError message) at the three split modules, preserving the 4 history-marked mentions. Gate: AC-SPLITDEBT-1."}
---
## Goal

Retire the naming debt SPEC-146's three-way split left behind: `claude-md-check.ts` no
longer exists, but eight sites in tracked source still speak about it in the PRESENT
TENSE, and one of them is not a comment at all — it is a live `PurityCheckError` message.

AC-SPLITDEBT-1 is the single gate. Measured red before this plan: `unmarked=8 marked=4`,
exit 1.

## Why this is a plan and not a footnote

The split's own task anchors covered the modules being split, not the places that
DESCRIBE them. That is the failure this repo already has a standing rule for — fixing a
gap and updating the comments that record it are one acceptance unit — and the rule did
not bind, because nothing enforces it. This plan pays the debt; the mechanism that would
have prevented it (pointing the reference grammar at a second discovery set: source and
test comments) is recorded as F2 in
`knowledge-five-governance-findings-measured-while-closing-the` and is NOT in scope here.

## Scope

In — repoint or delete, per site:

| File | Sites | Shape |
|---|---|---|
| `packages/core/src/config.ts` | 4 | JSDoc attributing live behaviour (`lintMemoryFiles`, `computeHeadroom`, the `eviction_required` finding) to the deleted path |
| `packages/lore/src/service/context-facts.ts` | 2 | JSDoc citing "`claude-md-check.ts`'s identical stance" / "a `claude-md-check.ts` lint concern" |
| `packages/lore/src/ai/assess-template.ts` | 1 | JSDoc citing the `Buffer.byteLength` convention as living there |
| `scripts/check-claude-md-purity.ts` | 1 | ⛔ RUNTIME `PurityCheckError` text: tells the reader "the three-way split of claude-md-check.ts has not landed yet" on the live missing-target path, where the truthful diagnosis is that a declared target was deleted or renamed AFTER the split landed |

Correct destinations: `lintMemoryFiles`/`computeHeadroom`/`computeHeadroomWarnings` →
`packages/lore/src/service/claude-md-budget.ts`; `checkReferenceExistence`/
`detectNarrativeSmells`/`checkSlugPointers`/`measureEmphasis`/`runMemoryFileChecks` →
`claude-md-admission.ts`; the finding-kind unions → `claude-md-findings.ts`.

Out — ⛔ the four mentions that CORRECTLY record provenance ("pre-split", "former",
"Extracted from", "split of") MUST survive. AC-SPLITDEBT-1's second conjunct exists
precisely to refuse a sweep that deletes them, so a green run is not obtainable by
deleting every occurrence.

Out — every mention under `packages/lore/tests/**`: those files' headers narrate the
red-first state they were written in, which was true when written.

## Risks

- `scripts/check-claude-md-purity.ts` is AC-PURE-1's own oracle. The message body changes;
  ⛔ the guard's CONDITION and exit behaviour must not. Re-run AC-PURE-1 after editing it.
- `packages/core/src/config.ts` is high fan-in: `bun run test:changed` over it is measured
  to over-select toward a full suite, which a worktree forbids. Run the scoped oracles the
  task names by hand instead.
