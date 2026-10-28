---
id: PLAN-224
type: plan
role: plan
title: "GitHub owns issue-report state"
status: archived
priority: critical
created: 2026-10-19
updated: 2026-10-26
tags: []
parent: SPEC-212
phases:
  - {name: "foundation"}
  - {name: "surfaces"}
  - {name: "migration"}
---
## Goal
Implement spec-github-owns-issue-report-state-no-mirror-task-work-carries: GitHub owns issue-report state; work carries extra.issues; live paginated reads; one-time migration.

## Invariants
- Every task's anchors are disjoint; a file appears in exactly one task.
- One landing: every GS task branches from and merges into the feature branch `gs-integration` (the main agent merges each finished task branch into it from its own worktree after the task's floor passes there); main moves once, by `lore integrate gs-integration`, after T10. No commit on main ever accepts both the old and the new shape, and the migrate command ships with the refusal.
- Tests use a stubbed GitHub (GhRunner double or a recording gh on PATH); never the real API; never the repo .lore/.
- All corpus writes, including the migration, go through the one CorpusService write route (no bypass).
- Red-first runs are runner-produced (--capture or verify).

## Phases
1. foundation: T7 filing, T2 pagination, T1 carrier schema.
2. surfaces: T3 status, T4 close-on-archive, T5 lore issues, T6 adopt/resolve, T8 status check, T9 HTTP+dashboard.
3. migration: T10 migrate command.
Corpus operations after T10 are the main agent's, in this order: (1) `lore integrate gs-integration`; (2) `lore done` every GS task (they are archived BEFORE the migration, so their `resolves` links count as archived resolvers); (3) `lore rule apply` for this spec's change set; (4) `lore issues migrate` dry-run, read in full; (5) `lore issues migrate --apply`; (6) `lore issue resolve <n> --state superseded --superseded-by <this spec> --reason "made moot by <this spec>: <one line per report>"` for the 7 moot reports; (7) `lore verify`, `lore assess`.

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| the old shape is refused before the migrate command ships | H | single landing of gs-integration after T10 |
| HTTP/dashboard need gh credentials on the server | M | error state, never empty list (AC-GS-14) |
| Migration writes to GitHub (public) | H | dry-run first, main agent reads the full plan before --apply |
| DCL-3b holds packages/lore/src/service/ | M | T1, T2, T3, T4 and T7 claims wait for its release |

## Task map (AC, reports, anchors; every file in exactly one task)
| Task | AC | Reports (--resolves) | Anchors |
|---|---|---|---|
| GS-T7 filing | AC-GS-10, AC-GS-15 | #294 | adapters/cli/report-issue-wiring.ts, service/issue-task-shaping.ts, adapters/mcp/tools.ts |
| GS-T2 pagination | AC-GS-1 | #288 | service/github-intake-port.ts |
| GS-T1 carrier schema + old shape refused | AC-GS-11 | — | core/src/schemas.ts, service/corpus-service.ts, adapters/cli/create-resolves.ts, commands/create.ts, commands/link.ts |
| GS-T3 status derivation | AC-GS-3 | — | service/issue-resolution.ts, core/src/issue-resolution-vocab.ts, service/github-issue-listing.ts |
| GS-T4 close on archive | AC-GS-8 (includes BR-1082's archived-prose warning, which lives in the close-on-archive path) | — | service/issue-close-on-archive.ts, service/task-workflow-service.ts, service/resolution-projector.ts |
| GS-T5 lore issues + sync | AC-GS-2, AC-GS-16 | — | commands/issues.ts, adapters/cli/issues-sync.ts |
| GS-T6 adopt/resolve | AC-GS-5, AC-GS-6, AC-GS-7 | — | commands/issue.ts |
| GS-T8 status check | AC-GS-4, AC-GS-9 | — | commands/status.ts, adapters/cli/status-issue-check.ts |
| GS-T9 HTTP + dashboard | AC-GS-14 | — | adapters/http/issue-reports-routes.ts; packages/dashboard/src/components/{IssueReportsCard,IssuesList,IssueDetail}.tsx; packages/dashboard/src/routes/{issues.tsx, issues_.$id.tsx, p.$name.issues.tsx, p.$name.issues_.$id.tsx}; packages/dashboard/src/lib/issue-reports-query.ts |
| GS-T10 migrate | AC-GS-12, AC-GS-13 | — | commands/issues-migrate.ts (new), adapters/cli/index.ts |

All 16 AC-GS ids are covered exactly once. D10 fold-in: #288 (T2) and #294 (T7) are fixed by code and bound to those tasks with --resolves. The moot ones (#204 #285 #289 #290 #291 #292 #293) are not bound to any task (no code fixes them): after the landing they are closed with `lore issue resolve <n> --state superseded --superseded-by spec-github-owns-issue-report-state-no-mirror-task-work-carries`, per the spec's D10. #16 #259 #286 stay open (out of scope).

## Test files and ownership notes
- Each task writes its AC tests as NEW files `packages/lore/tests/integration/gs-<task>-*.bun.test.ts` (or `packages/core/tests/gs-*`), and updates the EXISTING tests its own change breaks, so the feature branch stays coherent: the 7 mirror e2e files are anchored to the task that changes their behaviour (issue-adopt-compiled -> T6; issue-check -> T8; issue-closed-state, issue-closure -> T3; issue-close-on-archive-compiled, issue-closure-e2e, issue-task-done-close-compiled -> T4); any other existing test a task breaks is declared (`lore anchor add`) before it is edited, and the anchor-overlap check arbitrates.
- Close-on-archive: corpus-service.ts's archive transitions and sweep (~:3663, ~:3928) already call `IssueCloseOnArchive.onArchived` and keep calling it unchanged; GS-T4 changes only what onArchived does (keyed on extra.issues), so it does not edit corpus-service.ts. AC-GS-8 covers `lore archive` of a plan carrier through that unchanged call.
- DCL-3b (plan-write-path-everywhere) currently holds the whole `packages/lore/src/service/` directory as its anchor, so every task here with a service/ anchor (T1, T2, T3, T4, T7) waits for its release; T5, T6, T8, T9, T10 do not.

## Landing order (encoded as blocks links)
1. T7 and T2 (both wait for DCL-3b's release of service/).
2. T1 (after T7 and T2: its --issue check reads the paginated listing).
3. T3 (after T1 and T2) and T4 (after T1), in parallel.
4. T5 (after T3 and T4) and T9 (after T3), in parallel; then T6 (after T5: AC-GS-7 reads `lore issues --json`).
5. T8 (after T5): AC-GS-4 checks `lore issues` output.
6. T10 (after T1-T7). Then the main agent lands `gs-integration` with `lore integrate` and runs the corpus operations.

## Migration under the refusal
T1's refusal applies to the incoming write payload: a write whose extra carries `issue_report`, or that creates a `resolves` link, is refused. The migration's writes never carry either: re-homing a mirror writes its extra without `issue_report` (plus `extra.issues`), stamping a carrier adds `extra.issues`, deleting a `resolves` link is a deletion, and retiring a mirror is a soft delete. So `lore issues migrate --apply` runs after the landing through the same CorpusService route with no exemption. A mirror whose GitHub writes fail is left exactly as it was (its stored `issue_report` is not rewritten) and is picked up by the next run.

## Closing this plan's own reports
Only #288 (GS-T2) and #294 (GS-T7) are bound with `--resolves`, the only binding that exists before T1. Step (2) archives T2 and T7 before step (5); when they are archived onArchived is already keyed on `extra.issues`, so archiving alone does not close the issues. Step (5) converts their `resolves` links into each task's `extra.issues`, and the migration's final D3 pass closes #288 and #294 as completed, naming the task in the comment. The 7 moot reports close once, in step (6), as superseded. No issue is closed twice: the migration's D3 pass only closes open issues, and step (6) refuses an issue with a live carrier (none exists for the moot ones).

## MCP
The MCP adapter's only issue surface is the filing tool `lore_report_issue` (tools.ts), changed by GS-T7 (AC-GS-15). There is no MCP issue-listing or status tool, so no later task needs tools.ts.

## Gates on the feature branch
- Merging a finished task branch into `gs-integration` requires: the task's AC tests green (runner-captured), `bun run typecheck`, and `bun run check:floor`, all on the merged result. Existing tests that an earlier task broke on the branch (e.g. T1's refusal breaking mirror e2e fixtures anchored to T3/T4/T6/T8) may be red between merges; the task owning each such file makes it green when it lands on the branch.
- The single landing (`lore integrate gs-integration`) waits for ALL of T1-T10 (T8 and T9 included) to be merged into the branch, and for a full `bun run test` on the branch to be green.

## How T10 reads the old shape after T1
T1 refuses only WRITES carrying the old shape; stored rows are untouched and remain readable. `LinkType` (the write-side enum) drops `resolves`, but the store's link read returns the raw stored type string, and T10 reads `resolves` rows and `extra.issue_report` payloads through a read-only legacy row type (`LegacyIssueMirror`, `LegacyResolvesLink`) defined in issues-migrate.ts and parsed with its own schema. Reads are outside the write-route invariant (which governs writes); every T10 write (stamp extra.issues, delete a resolves link, soft-delete a mirror, re-home a mirror) goes through CorpusService. Deleting a `resolves` link is a deletion and is not refused by T1.
