---
id: TASK-531
type: task
role: plan
title: "P2 — HTTP projection + dashboard Issues page render computed resolution"
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

Make the human triage surface tell the same truth as the CLI. §20 F5's Issues page currently reads raw doc status — leaving it unchanged would fix one surface and keep the other lying.

## Deliverables

- **D7 (HTTP half)** — the issue-reports projection (`packages/lore/src/adapters/http/issue-reports-routes.ts`) returns each report's computed resolution.
- **D8** — the dashboard Issues surface renders it: `IssuesList` and `IssueDetail` show the computed resolution; `IssueReportsCard` / the nav badge count computed-`open` reports rather than `draft` docs.

## Acceptance Criteria

AC-ICL-9. Oracle: `cd packages/dashboard && bunx playwright test tests/e2e/issues-resolution.spec.ts`.

## Constraints

- Consumes `computeIssueResolution` from P1 — do NOT reimplement.
- `packages/dashboard/src/**` must NEVER import `@lore/core/node` (Node builtins blank the SPA in Vite dev). Import from `@lore/core` only.
- Playwright suites must be SERIALIZED against a fixed dev-server port — concurrent runs produce phantom "browser has been closed" failures.
- Seed a throwaway corpus via the canonical `packages/dashboard/tests/e2e/global-setup.ts` pattern. NEVER the repo's own `.lore/`.

## Added after P1 landed (2026-07-29) — third copy of the link-type list

`packages/dashboard/tests/component/LinksPanel.test.tsx:138` hardcodes the 7-member link-type array and is RED as of P1's merge (measured: `Test Files 1 failed (1)`, `Tests 1 failed | 11 passed`). It is the third copy of a list that should have exactly one source.

Fix it the same way its siblings are being fixed: assert against `linkTypeSchema.options` rather than a literal array, so the next added link type cannot silently diverge. Do NOT simply append `"resolves"` to the literal — that reproduces the defect one member later.
