---
id: TASK-529
type: task
role: plan
title: "P2 — CLI verbs: lore issue resolve + lore issues"
status: archived
priority: medium
phase: "P2 surfaces"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-103
plan: PLAN-103
links:
  - {id: TASK-532, type: blocks}
---
## Objective

Ship the two CLI verbs that make issues actionable and visible from a terminal: `lore issue resolve` and `lore issues`.

## Deliverables

- **D3** — `lore issue resolve <issue> --state rejected|wontfix --reason <r>`: persists the explicit terminal state + reason into `extra.issue_report.resolution`. `--state fixed` MUST exit non-zero with stderr naming `lore link --type resolves` as the only path to `fixed`, and MUST NOT write anything. A target lacking `extra.issue_report` is rejected.
- **D4** — `lore issues [--open|--resolved|--all] [--json]`: upstream-side listing of filed reports — title, slug, reporter_project, reported_at, age, computed resolution. Default `--open`. Pull-only (no SessionStart/bootstrap injection — that stays rejected per §20 F4).

## Acceptance Criteria

AC-ICL-3, AC-ICL-4, AC-ICL-5.
Oracle: `cd packages/lore && bun test tests/e2e/issue-closure.bun.test.ts -t AC-ICL-3` (and `-t AC-ICL-4`, `-t AC-ICL-5`).

## Constraints

- Consumes `computeIssueResolution` from P1 — do NOT reimplement the computation.
- Throwaway corpora only (`mkdtemp` + `lore init`); NEVER write to this repo's `.lore/`.
- These tests spawn `dist/lore` — run `bun run build` before the oracle.
- Six-dimension coverage. Red before green.

## Added after P1 landed (2026-07-29) — collapse the duplicated link-type SSOT

P1 added `"resolves"` to `linkTypeSchema` and surfaced that the link-type list exists in THREE places. Two of them are yours:

- **`packages/lore/src/adapters/cli/commands/link.ts`** — its own `VALID_LINK_TYPES: LinkType[]` array (line ~22) does not contain `"resolves"`, so `lore link --type resolves ...` exits 2 at the CLI layer before ever reaching the validated service path. P3's live backlog closure depends on that exact command, so this blocks the plan.
  **Fix the root cause, not the symptom**: derive the CLI's accepted set from `linkTypeSchema.options` instead of appending one more string to a hand-maintained copy. A second hardcoded list will drift again on the ninth link type.
- **`packages/lore/tests/unit/core/schemas.test.ts`** — its `"linkTypeSchema accepts all 7 link types"` case iterates a fixed list and never asserts exhaustiveness, so it stayed green through a schema change that should have reddened it. Make it assert against `linkTypeSchema.options` exhaustively (and fix the stale count in the title) so the next added member fails loudly.

Add these two paths to your anchors before claiming (already declared on the task).
