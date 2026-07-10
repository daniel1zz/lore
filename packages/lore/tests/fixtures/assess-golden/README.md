# `lore assess` golden fixtures (SPEC-040 §T3 D7)

Synthetic, hand-designed `PlanBundle` snapshots used by `scripts/assess-golden.ts` to
sanity-check a candidate assess judge prompt version against the incumbent version
before promoting it (`ASSESS_PROMPT_VERSION` bump in
`packages/lore/src/ai/assess-template.ts`).

## Fixture inventory

| Fixture | Expected label | Probes |
|---|---|---|
| `01-clean-full-delivery` | `met` | Baseline: every declared AC has passing evidence, no scope drift, a linked knowledge doc. A judge that can't reach "met" here has a systematic under-scoring bug. |
| `02-missing-evidence` | `not_met` | Zero evidence recorded anywhere. A judge that reaches "met" here is hallucinating unearned trust. |
| `03-partial-dangling-scope` | `partial` | One of two declared ACs evidenced; the plan's `extra.ac_scope` also claims a third id the spec no longer declares (`facts.scope.dangling`). |
| `04-attested-vs-self-reported` | `met` | One AC backed by runner-attested evidence (`lore verify`), the other by self-reported evidence (`lore evidence`) — both pass; probes whether the judge/coverage rendering distinguishes trust level without penalizing self-reported evidence outright. |
| `05-spec-less-plan` | `partial` | Plan hangs directly off a PRD (no spec parent) — no declared-AC table at all. Probes `computeAssessmentFacts`'s `scope: undefined` degrade path (AC-ADF-10) and the verbatim-goals prompt fallback. |
| `06-truncation-heavy` | `partial` | Plan/spec/task content and the attached diff all exceed `ai.assess.*` budgets, forcing every section to truncate and the diff Truncation Manifest (bugfix F3) to fire. Probes whether heavy truncation collapses scoring to "not_met" purely from missing materials. |

Fixture files are TypeScript modules (not raw JSON) typed against `@lore/core`'s
`PlanBundle`/`DocRecord` — `bun run typecheck` is the correctness oracle for fixture
shape, catching malformed hand-authored `extra` payloads at compile time that a raw
JSON snapshot would only surface at runtime (or not at all).

## Accrual note

This directory is a deliberately small, hand-curated set — it is NOT meant to grow
into a comprehensive corpus. Real point-in-time fixtures (an actual plan's materials
at the moment a specific prompt version judged it) accrue separately and automatically:
every `lore assess` run persists `extra.assessment.source_versions` (SPEC-040 §T2) — a
`{doc_id, version}` pin for every source doc the judge saw — on the resulting
`knowledge` doc. A future harness extension can replay a REAL assessment's exact
materials by resolving those pins, without this directory ever needing to check in a
second, larger snapshot corpus by hand.

## Running the harness

```bash
# List every fixture + expected label. Deterministic order. Zero provider calls.
bun scripts/assess-golden.ts --dry-run

# Score a candidate prompt version against the incumbent (invokes the configured AI
# provider — NOT run in CI/vitest; see scripts/assess-golden.ts's header for why).
bun scripts/assess-golden.ts --candidate 7 --incumbent 6
```
