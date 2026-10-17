---
id: SPEC-080
type: spec
role: spec
title: "Bootstrap injection projection: tier-1/tier-2 payload split"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-10-17
tags: []
links:
  - {id: SPEC-041, type: relates-to}
---
## Overview / Goal

The SessionStart hook injects `lore bootstrap --json` (pretty-printed, then char-sliced at `BOOTSTRAP_CHAR_CAP = 8000`). Measured 2026-07-26 pre-archive: **10037 chars**, 77% of it `active_plans` (11 of 15 entries had `ready=0 ∧ claimed=0`) + `latest_handoffs` (15 per-plan entries). Because the report serializes `resume_hint` / `corpus` / `active_sessions` LAST, the char-slice evicted the FEED loop's highest-value signals while fully delivering dead-plan bulk — live-observed in a real session. Post-archive baseline is 6593 chars: under the cap today, but the failure mechanism is untouched.

**Goal**: split tier-1 injection (signals the AI wouldn't know to ask about + cheap pointers) from tier-2 retrieval (anything with an obvious scenario→command mapping), so the injection payload is small by construction, truncation-safe by field order, and never silently lossy — while every non-injection consumer (MCP `lore_bootstrap`, plain `lore bootstrap --json`, scripts) keeps the complete report.

**Tier principle**: tier-1 = resume_hint, my_claims, active_sessions, condensed armed-gate names, root pointer, pending count, actionable plans; tier-2 = full plan list (`lore ready` / `lore list --type plan`), per-plan handoffs (`lore feed session-resume --plan <p>`), review queue (`lore pending`), gate details (denial carries the SPEC-049 feeding pack).

## Module Boundary

**New public API**
- `@lore/core` `session.ts`: `buildBootstrapInjection(report: BootstrapReport, budgets: BootstrapInjectionBudgets): BootstrapInjectionResult` — pure, browser-safe, the **sole owner of ALL tier-1 trimming** (selection, count caps, char budget, omission accounting). No second truncation policy may exist anywhere.
- `bootstrapInjectionSchema` / `BootstrapInjection` — the projection's OWN Zod schema + type, never a patch on `bootstrapReportSchema`.
- CLI `lore bootstrap --injection` (strict-flags declared): renders the projection as **compact** JSON.
- Config `workflow.bootstrap_injection.{max_active_plans: 5, max_handoffs: 3, max_pending_slugs: 3, char_budget: 8000}` in `WorkflowConfigSchema` — knobs resolved in `app.ts` and threaded as scalars (`claimTtlMinutes` DI precedent); wired end-to-end, never decorative (SPEC-070 lesson).

**Explicitly unchanged (REGRESSION surface)**
- `BootstrapReport` shape, `bootstrapReportSchema`, `SessionService.bootstrap` output, MCP `lore_bootstrap`, plain `lore bootstrap --json` — byte-identical.
- `deriveResumeHint` / `deriveSessions` derivation inputs: the projection consumes the already-complete report, so "caps apply to reporting, never derivation" holds **by construction** (projection strictly downstream).
- SPEC-057 frozen-baseline suite (`session-service.test.ts`): extended, never re-frozen.

## Projection Contract

Field order IS the contract (high-value-first, truncation-safe by position):

1. `resume_hint` — unchanged
2. `my_claims` — unchanged
3. `active_sessions` — unchanged
4. `armed_gates` — condensed to `string[]` of checkpoint names (feeding-source detail is tier-2: denials self-carry the pack, SPEC-049)
5. `root` — unchanged
6. `pending_reviews` — `count` + slugs capped at `max_pending_slugs`
7. `active_plans` — filtered `ready>0 ∨ claimed>0`, sorted `last_activity_at` desc, capped at `max_active_plans`
8. `latest_handoffs` — newest `max_handoffs`
9. `corpus` — unchanged
10. `omitted` — **single typed ledger** `{active_plans, latest_handoffs, pending_slugs, budget_drops}`: every drop from ANY stage lands here; no free-text markers
11. `budget_exceeded?` — present-iff-true anomaly flag: count-capped payload still exceeded `char_budget` after entry drops

**Unknown-field rule (OCP)**: any `BootstrapReport` key not in the ordered list is appended **between `corpus` and `omitted`** in original report order — `omitted` and `budget_exceeded?` are ALWAYS the final two keys of the payload. A future report field degrades to "included, late position", never silently dropped.

**Char-budget rule**: applied INSIDE `buildBootstrapInjection`, after count caps, on compact-serialized length — drop whole trailing entries from `latest_handoffs` first, then `active_plans`, incrementing `omitted.budget_drops`; NEVER a mid-JSON char slice; both arrays empty and still over → `budget_exceeded: true`, payload returned intact.

**Hook role (Phase E)**: blind pipe — spawn args gain `--injection`, wrap stdout in the existing markdown block, zero shape knowledge. `BOOTSTRAP_CHAR_CAP` is renamed `INJECTION_BACKSTOP_CAP = 12000` and demoted to a degradation signal: when spawn stdout exceeds it, the hook **drops the bootstrap block entirely** and appends a degradation-report entry via the existing `degradations` array (naming the observed length) — it NEVER slices stdout; the projection contract's no-mid-JSON-slice rule holds at every layer, and a backstop fire indicates a binary-side bug to investigate, not a payload to trim. `CLAUDECODE=1` env and `--seat-branch` threading unchanged. Old-binary/new-hook skew: unknown `--injection` flag → strict-flags exit 2 → existing Phase E degradation report fires (fail-open precedent), converges on next `lore setup`.

## Public Interface (TypeScript)

```ts
export interface BootstrapInjectionBudgets {
  maxActivePlans: number;   // default 5
  maxHandoffs: number;      // default 3
  maxPendingSlugs: number;  // default 3
  charBudget: number;       // default 8000, compact-serialized length
}

export interface BootstrapInjectionResult {
  payload: BootstrapInjection;  // ordered per contract
  json: string;                 // compact; length <= charBudget unless budget_exceeded
}

export function buildBootstrapInjection(
  report: BootstrapReport,
  budgets: BootstrapInjectionBudgets,
): BootstrapInjectionResult;
```

## Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Where trimming lives | Separate core projection fn, NOT service-side caps on `BootstrapReport` | Tier-1 is an injection-rendering concern; service caps would silently starve MCP/CLI consumers that have no char budget; avoids a god-shape serving two masters |
| D2 | One trimming owner | Count caps AND char budget both inside `buildBootstrapInjection`, one `omitted` ledger | Two independent truncation policies that never share state re-create the original bug class (typed counts + untyped hook drops) |
| D3 | Hook role | Blind pipe via `--injection`; binary-side rendering | The hook is a standalone installed .mjs with no package import surface — hook-side shape logic is untestable duplication; this makes the hook dumber than today |
| D4 | Selection predicate | Hardcoded `ready>0 ∨ claimed>0`, consumer-named fn | Zero second consumer exists; no speculative predicate injection (a future dashboard panel wants different criteria and writes its own fn) |
| D5 | Config scope name | `workflow.bootstrap_injection.*`, not `workflow.bootstrap.*` | Knobs govern the injection projection only — must not imply they alter the bootstrap API |
| D6 | `--full`/`--slim` verbosity axis | Rejected | Redundant with granular budgets (SPEC-070 precedent); two overlapping knob systems |
| D7 | armed_gates condensation | Names-only `string[]` | Denials self-carry recovery (SPEC-049 feeding pack); feeding-source slug recoverable at denial time |
| D8 | Unknown report fields | Appended after `corpus`, original order | A manual field list silently omitting future fields is the next incident class |

## Test Plan (six-dimension)

- **HAPPY** — representative report → ordered payload, caps applied, `json.length ≤ charBudget`, ledger zeros.
- **NEGATIVE** — dead plans excluded regardless of recency; slugs beyond cap counted in ledger.
- **BOUNDARY** — exactly-at-cap (no drop, no flag); one-entry-over (`budget_drops: 1`); single oversized field with both droppable arrays empty (`budget_exceeded: true`); `maxActivePlans = 0`; empty-corpus report.
- **ERROR** — `bootstrapInjectionSchema` round-trip incl. the strip-hazard negative (field on type but not schema fails loudly — the `active_sessions` incident class).
- **STATE** — omitted-plan fixture: 3 actionable plans, cap 2, the omitted 3rd holds the corpus's only fresh claim → `active_sessions` still lists it (observes projection-downstream-of-derivation).
- **REGRESSION** — `lore bootstrap --json` byte-identical; SPEC-057 frozen baseline untouched-and-green; MCP shape pin; embedded-assets manifest freshness after hook edit; strict-flags accepts `--injection`.
- **E2E** — compiled `dist/lore bootstrap --injection` against a seeded throwaway corpus (never the repo's own `.lore/`; `slugify-compiled.bun.test.ts` precedent): parse, assert order + ledger.

## Rollout

Single release; no data migration. Files: `packages/core/src/session.ts`, `packages/core/src/config.ts`, `packages/lore/src/adapters/cli/commands/bootstrap.ts`, `packages/lore/src/app.ts`, `assets/hooks/session-start-resume.mjs` (SSOT — installed copies converge via `lore setup`, manifest freshness re-embedded). Old-binary/new-hook skew degrades loudly (D3), never silently.

## Provenance

Design produced via lore-design module mode: 4-perspective parallel review (coupling / cohesion / reuse / testing) 2026-07-26; key redirect from the original draft (service-side caps) to the projection model came from the coupling+cohesion convergence. Measurement evidence in Overview is from live `lore bootstrap --json` runs in this repo, 2026-07-26.


## Acceptance Criteria (structured)

- [⚑] [script] AC-080-1: buildBootstrapInjection unit suite passes: field order per contract, count caps 5/3/3 applied, single omitted ledger, boundary cases (exactly-at-cap zero drops; one-entry-over budget_drops=1; oversized-single-field budget_exceeded=true with payload intact; maxActivePlans=0; empty-corpus report), unknown-report-field appended after corpus, schema round-trip incl. strip-hazard negative
  script: test — bunx vitest run packages/core/tests/unit/bootstrap-injection.test.ts
- [⚑] [script] AC-080-2: SPEC-057 frozen baseline stays green untouched AND new omitted-plan fixture passes: 3 actionable plans with maxActivePlans=2 where only the omitted 3rd plan holds a fresh claim -> active_sessions still lists that session (projection never feeds derivation)
  script: test — bunx vitest run packages/lore/tests/unit/service/session-service.test.ts
- [⚑] [script] AC-080-4: Embedded assets manifest is fresh after the session-start-resume.mjs hook edit: embed-assets-manifest --check exits 0 (exit 3 = stale manifest fails this AC)
  script: build — node scripts/embed-assets-manifest.mjs --check
- [⊘] [script] AC-080-5: Monorepo typecheck passes with the new BootstrapInjection types and config schema extension: tsc --noEmit exits 0 across all packages and scripts
  script: tsc — bun run typecheck
- [⚑] [script] AC-080-3: Compiled-binary e2e: dist/lore bootstrap --injection against a seeded throwaway corpus returns compact JSON whose key order matches the literal contract list pinned in the test (resume_hint, my_claims, active_sessions, armed_gates, root, pending_reviews, active_plans, latest_handoffs, corpus, omitted last-two rule) with omitted ledger present; plain dist/lore bootstrap --json on the same corpus has exactly the literal 9-key set pinned in the test (root, active_plans, pending_reviews, my_claims, armed_gates, latest_handoffs, resume_hint, corpus, active_sessions)
  script: e2e — bunx --bun vitest run packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts
- [⚑] [script] AC-080-6: Config knobs reach the projection end-to-end (never decorative): the same compiled-binary e2e file seeds a throwaway corpus whose .lore/config.yaml sets non-default workflow.bootstrap_injection values (max_active_plans=1, max_handoffs=1, max_pending_slugs=1, char_budget=2000) and asserts the --injection payload reflects each (1 plan + omitted count, 1 handoff, 1 pending slug, json length <= 2000 or budget_exceeded)
  script: e2e — bunx --bun vitest run packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts

## Code anchors

- packages/core/src/session.ts#buildBootstrapInjection
- packages/core/src/config.ts
- packages/lore/src/adapters/cli/commands/bootstrap.ts
- assets/hooks/session-start-resume.mjs
