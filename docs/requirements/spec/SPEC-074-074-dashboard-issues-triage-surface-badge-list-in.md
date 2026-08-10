---
id: SPEC-74
type: spec
role: spec
title: "dashboard Issues triage surface: badge, list, in-place adjudication"
status: approved
priority: medium
created: 2026-07-24
updated: 2026-07-27
tags: [spec-074, report-issue, dashboard, triage]
parent: PRD-001
---
## Overview

SPEC-074 — dashboard Issues triage surface (PRD §20 F5, R-6; owner decision 2026-07-24: dashboard is THE visibility channel, SessionStart rejected). Incoming issue reports (draft tasks carrying `extra.issue_report` in this corpus) become prominently visible and fully triageable inside the dashboard: nav entry with open-count badge, dedicated Issues page (list + detail), in-place approve / reject-with-reason, and a compact incoming card on the dashboard home.

## Scope

**In**: one new read projection — `GET /api/issue-reports` (cookie or bearer, read-only: rows {id, slug, title, reporter_project, reporter_actor, lore_version, reported_at, possible_duplicates, status} + `open_count`); Issues page route in the dashboard SPA (list sorted reported_at desc, detail view rendering the full `extra.issue_report` payload + description body); approve / reject actions reusing the existing SPEC-022 cookie-gated adjudication routes (reject requires a reason — the reason the consumer-side `report-issue --list` echoes via the audit trail); nav badge (open count, hidden at 0) + home card (count + 3 most recent, links to the Issues page).
**Out**: any new write semantics (composes existing pending-review approve/reject paths); broader dashboard capability work (deferred to its own product round); cross-corpus aggregation (this corpus's incoming reports only); SessionStart/bootstrap changes.

## Design

- Backend: projection implemented in the HTTP adapter over existing CorpusService list/search (filter: type=task ∧ status ∈ {draft,in-review} ∧ extra.issue_report present); no service-layer changes expected — if a filter gap forces one, it lands as a narrow read method, never a write.
- Frontend: follows the dashboard's existing stack (Vite + React + shadcn, SPEC-015/022 conventions); Issues page is a sibling of the pending view; badge polls the same projection the page renders (one endpoint, no second count route).
- Auth: read = cookie or bearer (SPEC-062 GET precedent); adjudication = cookie-only (SPEC-022 invariant).
- E2E: Playwright against a throwaway corpus (global-setup pattern); reports seeded via the real `lore report-issue` CLI from a twin consumer fixture — the e2e exercises the REAL cross-corpus path, not hand-inserted rows.

## Acceptance Criteria

Structured via `lore ac add` (AC-074-1..5): 4 Playwright e2e + 1 route-auth test.


## Acceptance Criteria (structured)

- [✔] [script] AC-074-1: Seeded 2 incoming reports (filed via the real report-issue CLI from a twin consumer fixture): dashboard nav badge shows 2 and the Issues page lists 2 rows each showing title, reporter_project and reported_at, sorted newest first.
  script: e2e — cd packages/dashboard && bunx playwright test tests/e2e/issues.spec.ts -g 'AC-074-1'
- [✔] [script] AC-074-2: In-place approve: approving a report from its detail view drops the badge to 1, and the approved report appears in lore ready --adhoc output (CLI assertion inside the test) while leaving the other report untouched.
  script: e2e — cd packages/dashboard && bunx playwright test tests/e2e/issues.spec.ts -g 'AC-074-2'
- [✘] [script] AC-074-3: In-place reject: rejecting a report requires a non-empty reason (submit disabled or error when empty), drops the badge to 0, and the recorded reason is echoed by the consumer-side report-issue --list row for that report.
  script: e2e — cd packages/dashboard && bunx playwright test tests/e2e/issues.spec.ts -g 'AC-074-3'
- [✔] [script] AC-074-4: Home card: with open reports present the dashboard home shows an incoming-reports card with the open count and at most 3 most-recent titles linking to the Issues page; with 0 open reports the badge is hidden and the card shows an explicit empty state (not a blank region).
  script: e2e — cd packages/dashboard && bunx playwright test tests/e2e/issues.spec.ts -g 'AC-074-4'
- [✔] [script] AC-074-5: GET /api/issue-reports auth matrix: cookie session 200, bearer token 200 (read-only), no auth 401; response rows carry the 8 declared fields plus open_count, and a corpus with 0 reports returns open_count 0 with an empty rows array (not an error).
  script: test — bunx vitest run packages/lore/tests/unit/adapters/http-issue-reports.test.ts -t 'AC-074-5'

## Code anchors

- packages/lore/src/adapters/http/issue-reports-routes.ts#handleGetIssueReports
- packages/dashboard/src/components/IssueDetail.tsx
- packages/dashboard/src/components/IssueReportsCard.tsx
- packages/dashboard/tests/e2e/issues.spec.ts
