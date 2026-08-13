---
id: KN-008
type: knowledge
role: knowledge
title: "Assessment: SPEC-027 Implementation — Dashboard Hardening (2026-07-03)"
status: approved
priority: medium
created: 2026-07-03
updated: 2026-07-08
tags: []
parent: PLAN-006
links:
  - {id: PLAN-006, type: informs}
---
# Assessment: met (88/100)

Scope: plan `01KWJZCQJ28J7ESK85RYDPQEH5`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DH-1 | 90 | docs.$id.tsx adds key={data.doc.id} remounting DocDetail per doc; DocDetail.write.test.tsx pins cached A→B leak (pre-fix stash run failed 4 tests). Diff + evidence corroborate. | task-fix-write-path-bugs-cross-doc-edit-leak-transition-if-match |
| AC-DH-2 | 88 | handleTransition now passes {version} to apiPatchDoc and handles ConflictError with loud toast + onMutated, no silent overwrite. Pre-fix stash confirmed regression tests catch missing version/no-conflict-msg. | task-fix-write-path-bugs-cross-doc-edit-leak-transition-if-match |
| AC-DH-3 | 88 | Both Save and Cancel clearTimeout(draftSaveTimerRef) before clearDraft. Pre-fix stash failed Cancel/Save draft-resurrection tests; post-fix all 6 pass. | task-fix-write-path-bugs-cross-doc-edit-leak-transition-if-match |
| AC-DH-4 | 90 | New DiffView.tsx; duplicated line-coloring removed from both HistoryTab DiffModal and ConflictModal, both now consume DiffView. Diff shows deletions at both sites. Vitest green. | task-extract-shared-diffview-from-historytab-conflictmodal-ac-dh |
| AC-DH-5 | 90 | corsHeaders drops wildcard; applyCorsOrigin/isOriginAllowed echo Origin only when in ALLOWED_ORIGINS with Vary:Origin, applied at fetch boundary. New cors.bun.test.ts + middleware tests pass. | task-cors-echo-allowed-origin-instead-of-wildcard-ac-dh-5 |
| AC-DH-6 | 87 | DELETE cookie route added (confirm gate, telemetry source=dashboard); DeleteConfirmDialog + onDeleted navigate-away; apiDeleteDoc sends confirm=true. DocDetail.delete.test.tsx + e2e delete scenario pass. | task-dashboard-delete-restore-surface-cookie-routes-ui-tests-ac |
| AC-DH-7 | 87 | POST /restore cookie route reuses VersionService.restore (append-only N+1); HistoryTab restore button + apiRestoreVersion; onRestored invalidates queries. HistoryTab tests + e2e restore scenario pass. | task-dashboard-delete-restore-surface-cookie-routes-ui-tests-ac |
| AC-DH-8 | 85 | Component test files for all six components exist (Editor/ConflictModal/NewDocModal/StatusPill/LinksPanel by T5, HistoryTab by T4). StatusPill test surfaced a real defect (dropdown opens while pending), fixed and green. | task-component-tests-editor-newdocmodal-statuspill-linkspanel-co, task-fix-statuspill-pending-guard-pass-disabled-to-dropdownmenut |
| AC-DH-9 | 90 | Closeout evidence: typecheck 0, vitest 1916/1916, bun test 530, playwright 8 passed incl restore+delete. All four oracles recorded pass by main-agent. | task-closeout-claude-md-sync-full-oracle-suite-assess-eval-ac-dh |
| AC-DH-10 | 88 | CLAUDE.md diff updates purpose, invariants (8 endpoints, key={doc.id}, timer clear), component inventory incl DiffView, e2e write-flow suite, test layout, non-goals. Matches post-change reality. | task-closeout-claude-md-sync-full-oracle-suite-assess-eval-ac-dh |

## Gaps

- Restore route has no confirm gate and no version-existence pre-check surfaced beyond VersionService.restore's own error; relies on service to reject invalid version.
- Component test contents (specific interaction/error paths) are asserted only via aggregate pass counts, not shown in materials — coverage depth taken on evidence.
- e2e claim of 'new restore + delete scenarios' verified only by pass count, not by scenario listing.

## Recommendations

- Consider adding an explicit disallowed-origin negative test assertion snapshot in cors.bun.test.ts to lock the no-header behavior.
- Document restore's server-side behavior when version does not exist (expected 422 VALIDATION vs NOT_FOUND) to avoid ambiguity.
- Add a regression test ensuring apiDeleteDoc without confirm=true is rejected by the server (defense-in-depth gate).

## Judgment

- Provider: claude-cli
- Prompt version: 1
- Duration: 88455ms
- Retried: true
- Truncated sections: (none)
