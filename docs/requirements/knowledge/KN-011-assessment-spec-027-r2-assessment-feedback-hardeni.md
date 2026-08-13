---
id: KN-011
type: knowledge
role: knowledge
title: "Assessment: SPEC-027 R2 — assessment-feedback hardening (2026-07-03)"
status: approved
priority: medium
created: 2026-07-03
updated: 2026-07-08
tags: []
parent: PLAN-008
links:
  - {id: PLAN-008, type: informs}
---
# Assessment: met (92/100)

Scope: plan `01KWK6WQR3PBW025AAQ1Y9WP38`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DH-11 | 92 | Restore route adds `?confirm=true` gate → RESTORE_REQUIRES_CONFIRM (400); nonexistent version explicitly returns DOC_NOT_FOUND (404), reasoning documented in module header. Client (apiRestoreVersion) always sends confirm=true. Tests assert confirm gate, falsy-confirm, and pinned 404 contract. | task-restore-confirm-gate-version-not-found-contract-delete-no-c (vitest evidence: RESTORE_REQUIRES_CONFIRM + DOC_NOT_FOUND cases pass; diff shows route + mutations changes) |
| AC-DH-12 | 93 | New REGRESSION describe block asserts DELETE without confirm → 400 DELETE_REQUIRES_CONFIRM AND verifies doc.deleted_at stays null (gate actually blocks write, not cosmetic). Second case covers explicit confirm=false. Independent of UI dialog per AC intent. | task-restore-confirm-gate-version-not-found-contract-delete-no-c (dashboard-routes.test.ts regression cases in diff; vitest 1921 tests pass) |
| AC-DH-13 | 93 | cors.bun.test.ts adds explicit toBeNull() negative assertions for disallowed Origin across read (GET /api/docs), write (POST /api/dashboard/docs), health, and OPTIONS preflight; also asserts no Allow-Credentials leak and look-alike/substring origins rejected. 12 pass / 0 fail evidenced. | task-cors-negative-assertion-lock-disallowed-origin-emits-no-all (bun test: 12 pass, exact toBeNull assertions on read+write+preflight surfaces) |

## Gaps

- Closeout task (task-closeout-r2-oracles-assess-with-curated-diff...) is status=draft with zero recorded evidence — the final full-suite oracle rerun and the assess/informs-link step for this R2 plan itself have not been executed or verified in the provided materials.
- Oracle evidence for AC-DH-11/12/13 lives on the two archived subtasks (typecheck/vitest/bun/e2e all pass), but there is no independent closeout-level confirmation that all four suites are jointly green at plan close.
- Write-surface CORS negative test (POST /api/dashboard/docs) relies on a 401 unauthenticated path; it does not additionally assert the header absence on an authenticated cookie write, though the read-surface authenticated case does cover the authorized path.

## Recommendations

- Execute the closeout task: run the full four-runner oracle suite and record evidence, then run `lore assess` with the curated source-only --diff-file and verify the informs-link to the plan is created.
- Optionally add an authenticated (cookie/bearer) disallowed-origin write case to lock header absence independent of the auth outcome on the write surface.
- Mark/archive the closeout task with its oracle evidence so the plan's evidence trail is self-contained rather than distributed across subtasks.

## Judgment

- Provider: claude-cli
- Prompt version: 1
- Duration: 32210ms
- Retried: false
- Truncated sections: (none)
