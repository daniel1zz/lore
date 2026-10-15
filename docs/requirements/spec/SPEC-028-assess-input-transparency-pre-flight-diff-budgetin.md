---
id: SPEC-028
type: spec
role: spec
title: "Assess input transparency: pre-flight diff budgeting + file-boundary truncation"
status: deprecated
priority: high
created: 2026-07-03
updated: 2026-10-10
tags: [assess, ai, spec-028]
---
# SPEC-028 — Assess Input Transparency: pre-flight diff budgeting + file-boundary truncation

> Origin: SPEC-027 self-hosted assessment loop (2026-07-03). Round-1 assess silently truncated 88% of a 204k-char diff against the 24k `max_diff_chars` budget; `judgment.truncated` recorded only the opaque marker `"diff"`, so neither the caller nor the judge knew WHICH files were invisible. A controlled rerun with an untruncated curated diff moved source-blind AC scores (AC-DH-5 88→90, AC-DH-7 85→87), proving truncation opacity directly degrades judgment quality.

## 1. Problem

`lore assess --diff/--diff-file` truncates oversized diffs by a blind character cutoff:
1. No pre-flight signal — the caller learns about truncation only from `judgment.truncated: ["diff"]` after paying for the AI call.
2. Tail truncation cuts mid-file and drops whatever happens to sort last, regardless of relevance (source files may vanish while test bulk survives).
3. `truncated` granularity is a single opaque `"diff"` marker — no record of which files the judge never saw.

## 2. Acceptance Criteria

- **AC-AE-1 (pre-flight warning)** When the supplied diff exceeds `ai.assess.max_diff_chars`, `lore assess` prints a warning to stderr BEFORE invoking the provider: actual char count, configured budget, and remediation advice (`--diff-file` with a curated diff, or raising `ai.assess.max_diff_chars` in `.lore/config.yaml`). `--json` stdout payload stays clean (warning is stderr-only).
- **AC-AE-2 (file-boundary truncation)** Diff truncation is file-aware: the unified diff is split into per-file chunks; whole-file chunks are kept in priority order — production source (`src/`) first, then tests, then everything else (docs/generated/config) — until the budget is exhausted. No chunk is cut mid-file (a file either appears complete or not at all; if the single highest-priority file alone exceeds the whole budget, fall back to labeled head-truncation of that file and record it).
- **AC-AE-3 (truncation transparency)** `judgment.truncated` records what was actually dropped: one `"diff:<file-path>"` entry per omitted file (schema stays `string[]` — backward compatible; existing section markers like `"plan"`/`"spec"` unchanged). The deterministic content rendering of the assessment doc surfaces the dropped-file list.
- **AC-AE-4 (no-op when within budget)** When the diff fits the budget: no warning, byte-identical prompt diff section to current behavior, `truncated` contains no `diff:*` entries.
- **AC-AE-5 (tests)** Six-dimension coverage for the new truncation module (pure function, unit-testable): HAPPY (fits), NEGATIVE (oversized mixed src/tests/docs → correct keep/drop sets), BOUNDARY (exactly-at-budget; single file > whole budget), ERROR (malformed diff header handled fail-loud or passthrough — documented choice), STATE (priority ordering stable/deterministic), REGRESSION (opaque `"diff"` marker no longer emitted when file paths are known).

## 3. Non-goals

- AC→file-anchor relevance mapping (judge-guided diff selection) — future work.
- Changing the `max_diff_chars` default (24000) or other section budgets (`max_plan_chars`, `max_spec_chars`, `max_task_chars`).
- Chunked multi-call judging.

## 4. Constraints

- Truncation logic lives as a pure exported function (browser-safe if placed in `@lore/core`; otherwise in `packages/lore/src/ai/` — implementer picks with rationale) so vitest covers it without provider mocks.
- Fail-loud: malformed inputs must not silently produce an empty diff section.
- `extractAssessmentJson` / retry semantics / prompt version handling untouched.


## Code anchors

- packages/lore/src/ai/diff-truncation.ts
