---
id: SPEC-029
type: spec
role: spec
title: "Assess reliability: reasoning-length resilience + surface-correct error hints"
status: deprecated
priority: high
created: 2026-07-03
updated: 2026-10-10
tags: [assess, reliability, spec-029]
---
# SPEC-029 — Assess Reliability: reasoning-length resilience + surface-correct error hints

> Origin: round-2 self-hosted loop (2026-07-03), findings filed in knowledge doc 01KWK9ATQAWNKH8SC18P3YYGH7. Both defects reproduced live on the claude-cli provider, prompt v1.

## 1. Problem

1. **Verbose-but-valid judgment is fatal.** The first PLAN-R2 assess attempt failed with `ac_scores.0.reasoning: String must contain at most 300 character(s)` — AFTER the one corrective retry. The corrective prompt embeds the Zod parse error, but the judge still wrote long reasoning; a judgment that is semantically perfect but wordy kills the whole run and wastes two provider calls. The 300-char cap lives in `llmAssessmentOutputSchema` (`packages/core/src/assessment.ts`).
2. **Misleading recovery hint.** The `AI_PROVIDER_ERROR` path prints `Retry with --no-ai to use the editor instead`, but assess has NO non-AI mode (`--no-ai` always exits 2 per SPEC-026). The hint is inherited from the create/set flow and actively misleads.

## 2. Acceptance Criteria

- **AC-AR-1 (prompt states the limit)** Both the base judge prompt and the corrective-retry prompt explicitly state the per-AC `reasoning` ≤300-character limit (and that exceeding it will be clipped). Tests assert the statement is present in both prompt texts.
- **AC-AR-2 (lenient clip, never fatal)** Before Zod validation, the service clips any `ac_scores[].reasoning` longer than 300 chars to fit (preserving a trailing ellipsis marker like `…`), so an otherwise-valid judgment never fails on reasoning length. Clipping is implemented as a pure exported function with unit tests.
- **AC-AR-3 (clipping is recorded, not silent)** When any reasoning was clipped, the fact is recorded observably — a `reasoning_clipped` marker in `judgment` metadata (schema stays backward-compatible: additive optional field) — and surfaces in the deterministic rendered content.
- **AC-AR-4 (SPEC-026 contract preserved)** Structurally invalid JSON (missing fields, wrong types, unparseable) still follows: one corrective retry → second failure → `AI_PROVIDER_ERROR` with raw-output prefix, and no document is created. Existing regression tests stay green.
- **AC-AR-5 (surface-correct hint)** The assess CLI failure path never suggests `--no-ai`. It prints assess-specific guidance: retry the command, check the provider (`ai.provider` config / claude binary availability), and inspect the included raw-output prefix. A test pins the hint text (and pins the ABSENCE of `--no-ai`).
- **AC-AR-6 (six-dimension tests)** The clip function has HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE/REGRESSION coverage (incl. exactly-300 boundary, multi-AC partial clipping, unicode safety — no mid-surrogate cut). An integration test drives InMemoryAIProvider sequence mode with an overlong-reasoning judgment → assess succeeds, doc persisted, `reasoning_clipped` visible.

## 3. Non-goals

- Raising the 300-char cap (bloats docs; cap is a product choice, resilience is the fix).
- Chunked or multi-turn judging; changing retry counts.
- Generalizing the clip to other judge fields (only `reasoning` has shown this failure mode; extend later if observed).

## 4. Constraints

- `@lore/core` stays browser-safe; the clip helper is a pure function.
- Additive-only schema change (`judgment.reasoning_clipped?: boolean` or string[] of clipped AC ids — implementer picks with rationale); existing persisted assessments must still validate.
- Fail-loud preserved for genuinely malformed output.
