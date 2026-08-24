---
id: TASK-809
type: task
role: plan
title: "skill-implement: repoint the 8 stale claude-md-check references, including the PurityCheckError message on a live failure path"
status: draft
priority: medium
phase: "P1-repoint"
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-141
plan: PLAN-141
---
## Objective

Repoint all 8 present-tense references to the deleted `packages/lore/src/service/claude-md-check.ts`
at the three modules SPEC-146's split created, and preserve the 4 that correctly record
provenance.

## The 8 sites (measured 2026-08-24, `unmarked=8 marked=4`, oracle exit 1)

| File:line | Current text (abridged) | Correct target |
|---|---|---|
| `packages/core/src/config.ts:1040` | "`…/claude-md-check.ts`'s `lintMemoryFiles` (downstream task) consumes …" | `claude-md-budget.ts` |
| `packages/core/src/config.ts:1119` | "`computeHeadroom` (`…/claude-md-check.ts`) marks a metric as …" | `claude-md-budget.ts` |
| `packages/core/src/config.ts:1136` | "`eviction_required` finding from `lintMemoryFiles` (`…/claude-md-check.ts`)" | `claude-md-budget.ts` |
| `packages/core/src/config.ts:2048` | "`…/claude-md-check.ts`'s `lintMemoryFiles`/…" | `claude-md-budget.ts` |
| `packages/lore/src/service/context-facts.ts:65` | "`claude-md-check.ts`'s identical stance" | `claude-md-budget.ts` |
| `packages/lore/src/service/context-facts.ts:76` | "a `claude-md-check.ts` lint concern" | `claude-md-budget.ts` |
| `packages/lore/src/ai/assess-template.ts:407` | "`Buffer.byteLength(text, \"utf8\")` convention (`claude-md-check.ts`)" | `claude-md-budget.ts` |
| `scripts/check-claude-md-purity.ts:120` | ⛔ RUNTIME `PurityCheckError`: "the three-way split of claude-md-check.ts has not landed yet" | see below |

Symbol map: `lintMemoryFiles` / `computeHeadroom` / `computeHeadroomWarnings` →
`packages/lore/src/service/claude-md-budget.ts`. `checkReferenceExistence` /
`detectNarrativeSmells` / `checkSlugPointers` / `measureEmphasis` / `runMemoryFileChecks` /
`ISO_DATE_DENSITY_THRESHOLD` / `OFFICIAL_LINE_TARGET` → `claude-md-admission.ts`.
`MemoryFileFindingKind` / `AdvisoryFindingKind` / `MemoryFileRecord` → `claude-md-findings.ts`.
⛔ Verify each with `grep -n "^export" ` before writing it — do not trust this table.

## The purity-script site is NOT a comment

`scripts/check-claude-md-purity.ts:116-123` throws `PurityCheckError` when a declared
purity target is missing, and explains it as "the three-way split of claude-md-check.ts has
not landed yet". The split HAS landed, so on the live failure path — someone deleted or
renamed `claude-md-budget.ts` / `claude-md-admission.ts` — the tool now states a false
cause and misdirects the reader.

⛔ Change the MESSAGE only. The guard's condition (`TARGET_FILES.filter(path => !existsSync(...))`),
its throw, and its exit behaviour MUST NOT change: this script is AC-PURE-1's own oracle.
The replacement must still say why a missing file is not the same as a clean file.

## Out of scope

⛔ The 4 history-marked mentions MUST survive — `claude-md-admission.ts:5` ("pre-split"),
`claude-md-budget.ts:5` ("former"), `claude-md-findings.ts:7` ("Extracted from"),
`scripts/check-claude-md-purity.ts:27` ("split of"). AC-SPLITDEBT-1's second conjunct
(`marked >= 4`) refuses a sweep that deletes them, so a green run is NOT reachable by
deleting every occurrence.

⛔ Everything under `packages/lore/tests/**`: those headers narrate the red-first state they
were written in, which was true when written.

⛔ No behaviour change anywhere. Comments and one error-message string only.

## Oracles to run in your worktree

1. AC-SPLITDEBT-1's declared command (`lore verify`-driven; it is a `git grep` pair, so it
   sees your worktree's tracked files).
2. `bun run typecheck` — `packages/core/src/config.ts` is high fan-in; a JSDoc edit cannot
   break it, but prove it.
3. AC-PURE-1's oracle: `bun scripts/check-claude-md-purity.ts` — must still exit 0.
4. ⛔ Do NOT run `bun run test:changed` over `packages/core/src/config.ts`: it is measured to
   over-select toward the full suite, which a worktree forbids. Run the three above.
5. ⛔ Falsification for the purity guard, required: temporarily rename one entry in
   `TARGET_FILES` to a nonexistent path, confirm the script exits non-zero AND that your new
   message names the real cause, then restore. Record it with
   `lore evidence --result expected-fail`.
