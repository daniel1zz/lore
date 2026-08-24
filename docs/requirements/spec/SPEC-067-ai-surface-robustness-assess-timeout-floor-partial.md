---
id: SPEC-067
type: spec
role: spec
title: "AI-surface robustness: assess timeout floor, partial-provider fail-loud, judge grounding downgrades"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-08-01
tags: []
parent: PRD-001
---
# SPEC-067 — AI-surface robustness: assess timeout floor, partial-provider fail-loud, judge grounding downgrades

## Overview/Goal

Three verified dogfood failures on the AI path (guyin 2026-07-22, verified against
HEAD e9e5188):

1. **P1-6a**: built-in `claude-cli` provider defaults `timeout_ms` to 60_000
   (`packages/core/src/ai.ts:136`) while a real `lore assess` judge round measures
   ~73s — the default times out on the flagship AI feature under its own normal
   load. Observed as two consecutive `claude-cli timeout after 60000ms`.
2. **P1-6b**: `.lore/config.yaml` `ai.providers.<name>` entries REPLACE built-in
   definitions wholesale (`ai/registry.ts:97-103`, deliberate shallow spread — the
   anti-surprise rationale stands). But a partial entry (only `timeout_ms`, no
   `command`/`args`) is accepted silently and the provider only fails LATER at call
   time — a silent-fallback-shaped failure. Guyin lost a debugging round to this.
3. **P1-7**: judge-output quality guards are advisory-only:
   `computeGroundingWarnings()` (`ai-provider-service.ts:180-227`) detects
   `based_on="absence"` dimension scores with no matching `unverifiable[]`/
   `truncated[]` entry, but only stamps `rubric_warning` — the ungrounded score
   keeps full weight. `truncated[]` tasks are recorded but `overall_score` and
   confidence are unaffected: 9 of 16 tasks were truncated in the observed run and
   the assessment still scored normally.

Goal: the AI surface's defaults survive its own measured workload; misconfiguration
fails loud at registry-build time; ungrounded or truncation-degraded judgments are
mechanically downgraded, not just annotated.

## Scope

- IN: raising the built-in claude-cli `timeout_ms` default; registry-build
  validation of merged provider entries; deterministic post-processing downgrades
  in assessment finalization (grounding + truncation); config docs for the
  replace-not-merge semantics.
- OUT: changing replace-not-merge to deep-merge (deliberate design, stays);
  prompt-level judge changes (v2 prompt untouched — downgrades are code, not
  prompt); retry/queue behavior of providers; non-assess AI surfaces' prompts.

## Design

**D1 — timeout floor from measured reality.** Built-in claude-cli default
`timeout_ms` 60_000 → 180_000 (measured judge round ~73s; 2× headroom + margin,
matching the 300s value guyin validated in production config without adopting its
full generosity). Schema default only — explicit config still wins.

**D2 — partial-provider fail-loud at build time.** `buildProviderRegistry`
validates every merged CLI-provider entry: `command` non-empty and `args` present,
else `err(VALIDATION_ERROR)` naming the config key, stating the replace-not-merge
rule, and echoing a complete minimal entry (command+args+timeout_ms) the user can
paste. No provider construction, no deferred failure.

**D3 — grounding downgrade is mechanical.** In assessment finalization: every
dimension whose score has `based_on="absence"` with no matching `unverifiable[]`/
`truncated[]` entry gets `confidence` forced to `low` (stamped, with reason) —
the existing `rubric_warning` text stays as the human-readable trace.

**D4 — truncation caps confidence.** If `truncated[]` covers > 25% of the plan's
tasks, the assessment's overall confidence is capped at `low` and the verdict is
stamped `degraded_by_truncation: true`; at 100% truncation the assessment refuses
a numeric `overall_score` entirely (score omitted, verdict `inconclusive`).
Thresholds live in one exported constant, not scattered literals.

## Acceptance Criteria

- AC-067-1: built-in claude-cli config resolves `timeout_ms == 180000` when no
  config override exists (unit test on the schema/registry).
- AC-067-2: a config `ai.providers.claude-cli: { timeout_ms: 300000 }` entry
  (missing command/args) fails registry build with `VALIDATION_ERROR`; the message
  names the key and contains a complete example entry.
- AC-067-3: a complete override entry builds a provider whose effective
  timeout equals the configured value.
- AC-067-4: a judgment fixture with an ungrounded absence-based dimension score
  emerges from finalization with that dimension's `confidence == "low"`.
- AC-067-5: a fixture with 5 of 16 tasks truncated (>25%) yields overall
  confidence `low` and `degraded_by_truncation: true`; a fixture with 100%
  truncation yields verdict `inconclusive` with no `overall_score`.
- AC-067-6: a fully-grounded, untruncated fixture passes finalization unchanged
  (no downgrade side effects on the healthy path).


## Acceptance Criteria (structured)

- [⚑] [script] AC-067-1: Built-in claude-cli provider resolves timeout_ms to 180000 when no config override exists
  script: test — bunx vitest run packages/lore/tests/unit/ai/provider-registry-validation.test.ts -t "AC-067-1"
- [⚑] [script] AC-067-2: A partial provider entry (timeout_ms only, no command/args) fails registry build with VALIDATION_ERROR naming the config key and containing a complete example entry
  script: test — bunx vitest run packages/lore/tests/unit/ai/provider-registry-validation.test.ts -t "AC-067-2"
- [⚑] [script] AC-067-3: A complete provider override builds successfully with the configured timeout value effective
  script: test — bunx vitest run packages/lore/tests/unit/ai/provider-registry-validation.test.ts -t "AC-067-3"
- [⚑] [script] AC-067-4: SUPERSEDED 2026-08-01 by spec-lore-assess-project-evidence-rows-instead-of-embedding-the D3: an ungrounded absence-based dimension score is now REMOVED from dimension_scores at finalization, with an unverifiable[] entry naming it added in its place — it is no longer merely confidence-downgraded to low with a stamped reason, and applyGroundingConfidenceDowngrade no longer exists. The oracle below still passes because the tests were retitled 'REGRESSION (superseded AC-067-4)' and updated to assert removal.
  script: test — bunx vitest run packages/lore/tests/unit/service/assessment-finalize-downgrade.test.ts -t "AC-067-4"
- [⚑] [script] AC-067-5: Truncation over 25 percent of tasks caps overall confidence at low with degraded_by_truncation true; 100 percent truncation yields verdict inconclusive with no overall_score
  script: test — bunx vitest run packages/lore/tests/unit/service/assessment-finalize-downgrade.test.ts -t "AC-067-5"
- [⚑] [script] AC-067-6: A fully-grounded untruncated judgment passes finalization byte-unchanged (healthy path regression)
  script: test — bunx vitest run packages/lore/tests/unit/service/assessment-finalize-downgrade.test.ts -t "AC-067-6"
