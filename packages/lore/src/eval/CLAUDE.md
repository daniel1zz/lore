# Module: eval

## Purpose

Read-only evaluation scenarios that measure corpus health and search quality. Six scenarios are re-exported from `index.ts` and consumed by `lore eval`. Each scenario is pure-ish: input + App state → structured result; never mutates the corpus. Source: SPEC-013.

## Key Invariants

- **Read-only.** Scenarios call `app.corpusService` / `app.treeCheckService` / etc. for queries; they never invoke `create` / `update` / `delete` / `addLink` / `removeLink`. Anything that mutates the corpus belongs in a service, not here.
- **Never throws.** Any error path surfaces as `passed: false` (or a typed error field) in the structured result. The CLI runner relies on this for clean exit-code mapping.
- **Idempotent.** Same input + same App state ⇒ same output. No clocks, no randomness, no env reads in scenario bodies.
- **Result schemas are Zod SSOTs.** `<Scenario>ResultSchema` is exported alongside the `run<Scenario>` function; the TS type comes from `z.infer<typeof Schema>`. Don't hand-write parallel interfaces.
- **`scenarios/` is the only subdirectory** — one file per scenario. New scenarios are added to `index.ts` re-exports and `lore eval` registration only after the file exists.

## Patterns

- **Function shape**: `runX(input, app) → Promise<XResult>`. Async because services are async; `input` is a Zod-parsed shape so callers can validate upstream.
- **Default thresholds live as exported constants** — `DEFAULT_RECALL_THRESHOLD = 0.8`, `DEFAULT_TOP_K = 5`, `DEFAULT_THRESHOLDS` (type-distribution). These are SPEC-013 §7 source values; updating them requires updating the spec.
- **Fixtures stay in-file** — `DEFAULT_FTS_QUERIES` lives next to `runFtsRecall`. Don't centralise into `core/` — scenarios are independently versioned.

## Scenarios

- `runMigrationCoverage` — confirms `imported + already_existed === source files` after a v1 import (SPEC-013 §3.1).
- `runTreeConsistency` — runs `TreeCheckService.check` against the blueprint and reports drift count (§3.2).
- `runLinkIntegrity` — every `LinkRecord.from_id` / `to_id` resolves to a live doc (§3.3).
- `runTypeDistribution` — actual doc-type counts fall within `DEFAULT_THRESHOLDS` ranges (§3.4).
- `runFtsRecall` — for each `{query, expected_slugs}` pair, expected slugs appear in `corpusService.search` top-K; recall ≥ `pass_threshold` (§3.5 / §7 row 1).
- `runPlaceholderParse` — `OutlineService.resolve` on every doc emits no fatal warnings; whitelisted components round-trip cleanly (§3.6).

## Links

- Depends on: [`@lore/core`](../../../../core/src/CLAUDE.md), [`../service`](../service/CLAUDE.md), [`../store`](../store/CLAUDE.md) (transitively via App).
- Entry point: [`../adapters/cli`](../adapters/cli/CLAUDE.md) `lore eval`.
