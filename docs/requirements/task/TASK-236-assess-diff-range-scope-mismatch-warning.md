---
id: TASK-236
type: task
role: plan
title: "assess diff-range scope-mismatch warning"
status: archived
priority: medium
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: PLAN-057
plan: PLAN-057
---
# assess diff-range scope guard: warn when the diff doesn't match the plan's tasks

Mechanizes a discipline that failed 3× (2026-07-21 main~8..main; 2026-07-22 SPEC-062 and SPEC-064 both needed re-runs): feeding `lore assess --diff` a too-wide git range silently converts unrelated work into false `scope_fidelity` gaps naming files no plan task touched. The discipline "derive the range from the plan's own task commits" is pure prompt today.

## Change

`lore assess` already assembles the plan bundle (`CorpusService.getPlanBundle` → `{plan, spec?, tasks[]}`; each task carries `extra.file_anchors`). Add a NON-BLOCKING scope-mismatch warning:

- Parse the diff's changed-file set from the `--diff`/`--diff-file` text (the `diff --git a/… b/…` headers — a pure `parseDiffFilePaths(diffText): string[]` helper, put it in `@lore/core` for testability).
- Compute the intersection of the diff's files with the union of the plan's task `file_anchors` (anchors may be directory scopes with trailing `/` — reuse `@lore/core`'s `anchorsOverlap`/path-prefix semantics; a diff file under a declared directory anchor counts as intersecting).
- When fewer than HALF the diff's files intersect the plan's task anchors AND ≥1 task declares anchors → emit a non-blocking warning: `⚠ diff touches N files, only M intersect this plan's task anchors — the range may be too wide; derive it from the plan's own task commits.` Surface it in `--json` under a stable key (e.g. `data.scope_warning`) AND in text output.
- When NO plan task declares anchors → SKIP the check entirely (no warning, not an error — many older plans have no anchors; a warning there would be noise).
- The assessment STILL runs and persists in both cases — this is advisory only, never blocks or changes the verdict/exit code.

## Constraints
- Non-blocking: never changes exit code or whether the assessment persists.
- The warning is computed from FACTS (diff files ∩ task anchors), not the LLM judge's opinion — it's a deterministic pre/post-check around the existing assess call.
- Do NOT touch the verify path or attestation-completeness — that's a sibling task on disjoint files.

## Required tests (six dimensions) — `packages/lore/tests/unit/service/ai-provider-service-assess.test.ts`
- HAPPY: a diff whose files all fall under the plan's task anchors → 0 warning
- NEGATIVE/STATE: a diff dominated by files OUTSIDE the task anchors (< half intersect) → exactly 1 warning naming the counts
- BOUNDARY: a plan with zero task anchors → check skipped, 0 warning; a diff with exactly half intersecting → boundary behavior asserted explicitly
- REGRESSION: the assessment result/persistence is unchanged whether or not the warning fires
Write the "no anchors → skip" and "all-intersect → no warning" assertions FIRST and confirm they'd fail against a naive "always warn when any file is outside" rule before settling.

## Acceptance
- AC-040-SCOPE-1: `bunx vitest run packages/lore/tests/unit/service/ai-provider-service-assess.test.ts`
on `spec-spec-040-assessment-dimension-framework-v2-facts-judgment-s`. Also `bun run typecheck` (exit 0).
