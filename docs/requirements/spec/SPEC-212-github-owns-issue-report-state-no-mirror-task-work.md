---
id: SPEC-212
type: spec
role: spec
title: "GitHub owns issue-report state: no mirror task, work carries the issues it resolves, every read is live and paginated"
status: approved
priority: critical
created: 2026-10-19
updated: 2026-10-19
tags: []
links:
  - {id: SPEC-150, type: supersedes}
  - {id: SPEC-109, type: supersedes}
  - {id: SPEC-139, type: supersedes}
  - {id: SPEC-147, type: supersedes}
  - {id: SPEC-177, type: supersedes}
  - {id: SPEC-175, type: relates-to}
  - {id: SPEC-074, type: relates-to}
  - {id: SPEC-145, type: relates-to}
---
Kind: tech · Governing ADR: `adr-github-owns-issue-report-state-the-corpus-owns-only-the` (supersedes `adr-a-tracker-is-replaceable-a-corpus-is-not-github-is-the`)
Baseline branch: `baseline-issue-loop` (leaves `file-a-defect-report`, `list-defect-reports`, `check-resolution-labels`,
`adopt-a-github-issue`, `resolve-a-defect-report`; plus `baseline-create-a-document` for BR-1083)
AC prefix: `AC-GS-*` (`lore ac list`). Rule changes: this spec's change set (`lore rule changes`).

Supersedes or narrows (each gets a `supersedes` edge on filing; their ACs that test the mirror are retired with the tests):

| Spec | Effect |
|---|---|
| spec-a-github-filed-defect-must-be-claimable-one-ingest-seam (AC-GR-*) | **superseded**: its ingest seam (mint a task per issue) is the thing removed |
| spec-issue-closure-loop-computed-resolution-agent-reachable (AC-ICL-*) | **superseded**: resolution is no longer computed from a corpus record |
| spec-the-defect-channel-cannot-be-honestly-maintained-an (AC-DC-*) | **superseded**: `adopted_by`, pointer checks, dangling adoption, all re-founded on carriers |
| spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired (AC-IS-*) | **superseded**: `--local` no longer exists |
| spec-archiving-the-work-that-resolves-a-defect-report-closes (AC-IC-*) | **narrowed**: close-on-archive kept, keyed on `extra.issues` instead of `resolves` |
| spec-completing-an-adopted-report-s-own-task-closes-its-github (AC-IT-*) | **superseded**: the report's "own task" is the carrier, so D3 below covers it |
| spec-the-defect-channel-reaches-no-machine-but-its-own-github (AC-GI-*) | **kept**: filing, auth taxonomy, redaction, receipts. Only its "mint a task" step is removed |
| spec-074-dashboard-issues-triage-surface-badge-list-in-place | **narrowed**: data source becomes the live listing |
| spec-073-report-issue-trigger-surfaces-error-path-hints | **kept** unchanged (BR-1170) |

## Overview/Goal

Today every GitHub issue has a corpus mirror task, and the mirror is supposed to own resolution. Measured 2026-10-19: 288 mirrors
plus 34 local-only reports, 157 mirrors still draft while GitHub says closed, 188 label divergences that `--sync` called "clean",
and two thirds of the issues invisible because intake reads one page. The goal:

1. **One owner per fact.** GitHub owns existence, open/closed, verdict and discussion. The corpus owns only work, and work names
   the issues it resolves (`extra.issues`).
2. **Every read is complete and live.** Pagination, PRs excluded, no local fallback; offline exits 8/9/10.
3. **"fixed" stays earned.** Only an archived carrier makes an issue `fixed`. A GitHub-only close is `closed (unverified)` and counted.
4. **No per-issue corpus record survives the migration**, and none can be created afterwards.

Non-goals: changing the filing contract (BR-489..504, 1240, 1170, 1153 kept); the review branch's approve/reject of documents.

## Scope

Terms. **IssueRef** = `{repo_id: number, number: number}` (`repo_id` = GitHub's numeric repository id; the repository name is
never part of identity, as in BR-512). **Carrier** = a `task` or `plan` whose `extra.issues` is a non-empty array of distinct IssueRefs.
**Live carrier** = a carrier not archived, not deprecated, not invalidated. **Archived carrier** = a carrier with status `archived`.

### D1. Carrier schema (core + corpus service)
- `extra.issues` is validated on every write path (CLI, MCP, HTTP, batch) in `CorpusService`: array of 1..50 distinct IssueRefs,
  both fields positive integers, allowed only on `task` and `plan`. A violation fails with exit 4, field `extra.issues`.
- `extra.issue_report` is a retired key: any write carrying it is refused with exit 4, field `extra.issue_report`, message naming
  `lore issues migrate --apply`.
- `LinkType` drops `resolves`. `lore link ... --type resolves` and any write creating one is refused with exit 4. The
  `corpus-service.ts:5335-5353` target check is deleted. migration-012's SQL CHECK is historical and is not rewritten. AC-GS-11
  asserts zero `resolves` rows post-migration.
- `lore create task|plan --issue <n>` (repeatable) replaces `--resolves` (BR-1083 modified). Each `<n>` must be an issue present in the
  live listing of the configured repository; the ref is written with that repository's `repo_id`. `lore create spec --issue` is refused
  with exit 4 (specs are not carriers).

### D2. GitHub intake port: complete listing (`github-intake-port.ts::listIssues`)
- Reads `repos/{repo}/issues?state=all&per_page=100` page by page (`Link: rel="next"`) until no next page, then drops every entry
  carrying `pull_request`. Returns `{issues, pages}`.
- Any failing page fails the whole listing with that page's error kind. A partial list is never returned.
- Requests per listing = number of pages = max(1, ceil(N/100)) (+1 when N is a non-zero exact multiple of 100 and GitHub still links an empty page),
  never one request per issue (BR-1241 modified).
- Every consumer of the listing (`lore issues`, filing's duplicate hint BR-501, `lore issue adopt` BR-522, `--sync`, status check,
  MCP, HTTP) uses this one method. No consumer issues its own `gh api .../issues` call (the second copy at `commands/issues.ts:941` is deleted).

### D3. Close on archive (`issue-close-on-archive.ts`, `task-workflow-service.ts:4143`, `corpus-service.ts:3663`/`:3928`)
- When a carrier reaches `archived` by any path (`lore done`, `lore archive`, `lore archive --apply` sweep), each IssueRef whose
  issue is open on GitHub is closed with `state_reason=completed`, label `resolution:fixed` added, other `resolution:*` labels removed,
  and one comment `Fixed by <type> <slug> (<id>) archived <date>` posted.
- An IssueRef whose issue is already closed with a verdict (not_planned / duplicate) is left untouched and reported as
  `skipped: closed as <verdict>`. Archiving never reopens or relabels a verdict.
- An IssueRef whose issue is already closed as completed gets `resolution:fixed` (other `resolution:*` labels removed) and the
  `Fixed by` comment if not already present (hidden marker), and is never reopened. One closed `not_planned` with no verdict label is
  left untouched and reported as `skipped: closed not_planned without verdict` (counted as `closed (no verdict)`, D4).
- A failure is printed, recorded as audit `issue_close_failed` (existing action), never undoes the archive, and the archive command's
  exit code is unchanged. Repair: `lore issues --sync`.
- The `IssueCloseOnArchive.onTaskCompleted` path and "the report's own task" concept are deleted. `onArchived` is keyed on `extra.issues`.
- The archived-prose warning ("text claims to close #n with no link", BR-1082) now names `--issue` / the carrier field.

### D4. Displayed status (pure function, `issue-resolution.ts` rewritten)
- `deriveIssueStatus(issue: ListedIssue, carriers: CarrierFact[]): IssueStatus` is total over the ADR's status table. Inputs:
  GitHub `state`, `state_reason`, labels; each carrier's type, status/validity and (tasks) whether it holds an open claim. Task status `active` is unused in practice (0 of 1696 tasks on 2026-10-19), so claim, not status, marks work in progress.
- Statuses: `open`, `adopted`, `resolving`, `fixed`, `fixed (close pending)`, `adopted (abandoned)`, `closed (unverified)`,
  `closed (no verdict)`, `rejected`, `wontfix`, `superseded`, `duplicate`.
- Carrier precedence on an open issue: an archived carrier wins over live ones (`fixed (close pending)`), so `lore create task --issue <n>`
  naming an issue that already has an archived carrier still yields `fixed (close pending)` until `--sync` closes it.
- Verdict precedence: a closed issue's verdict (`state_reason` / verdict label) wins over carriers. An open issue's labels are ignored
  (a stray `resolution:rejected` on an open issue does not make it rejected; it is shown `open`/`adopted`/... and the label is reported
  by `--sync` as `stray label`).
- `isDanglingAdoption` is replaced by the `adopted (abandoned)` row. `computeIssueResolution`, `readExplicitResolutionState`,
  `checkResolutionPointer`, `EXPLICIT_RESOLUTIONS`, `ADOPTED_RESOLUTION_POINTER` are deleted.
- Unfinished = `open`, `adopted`, `resolving`, `fixed (close pending)`, `adopted (abandoned)`. Finished = all others (BR-508 modified).

### D5. `lore issues` (`commands/issues.ts`, `github-issue-listing.ts::joinListing`)
- Always reads the live listing (D2) and joins it with the carrier index (one corpus query: all tasks and plans with `extra.issues`,
  including archived ones). Prints the repository and the corpus it read first.
- Switches kept: `--resolved`, `--all` (mutually exclusive, exit 2), `--severity`, `--category` (BR-508/509 modified), `--json`.
- `--local` and `--verify` are removed (no local reports, no projection to verify). `--sync` stays as the **push-only repair**: it closes
  every `fixed (close pending)` issue (D3 semantics), removes retired labels (`resolution:adopted|resolving|closed|open`) and stray
  verdict labels on open issues, and prints one line per change. It prints `clean` only after a complete listing showed nothing to do.
  It exits 0 when all repairs succeed, and with the failing call's exit kind otherwise.
- No destination configured → exit 4 (BR-506 behaviour now for both commands). Offline/auth/rate → 9/8/10, nothing listed.
- `not ingested` disappears (BR-507 retired): an issue without a carrier is simply `open`.

### D6. `lore issue adopt <n> [--plan <plan>]` and `lore issue resolve` (`commands/issue.ts`)
- **adopt** creates one draft task carrying `extra.issues=[ref]`, member of `--plan` (must be a live plan, else exit 4) or ad-hoc under
  the root (BR-524). Title = issue title; body = a link to the issue plus the filing block's expected/actual/repro (the work description,
  frozen at adoption). Slug `task-issue-<repo_id>-<n>` (`-r<k>` when k earlier carriers of the same ref exist). The slug's
  `DUPLICATE_SLUG` is the race arbiter: the loser prints `Already adopted: <slug>` and exits 0 (concurrency, replaces BR-1169).
  An issue that already has a live carrier → `Already adopted: <slug>`, exit 0, nothing created. An issue closed on GitHub, or with an
  archived carrier, → exit 4 (nothing to adopt; names `--sync` for the close-pending case). GitHub is only read.
  BR-520..523 unchanged except that they now see the paginated list.
- **resolve** `lore issue resolve <n> --state rejected|wontfix|superseded|duplicate --reason <text> [--of <n>|--by <doc|n>]`:
  - `--state fixed` → exit 4 before the repository is resolved or GitHub contacted, naming "archive a carrier" as the way (BR-527 modified).
    `adopted`, `closed`, `open`, `resolving` → exit 4 listing the four valid values. Blank reason → exit 4.
  - Writes **only to GitHub**: one comment carrying the reason and pointer, then close with `state_reason` (`duplicate` for duplicate,
    `not_planned` otherwise), then the verdict label, removing other `resolution:*` labels. No corpus write of any kind (no doc, version
    or audit row). `--of <n>` must be another issue in the listing; `--by` an issue number or an existing corpus doc.
  - An issue that has a live carrier is refused (exit 4, naming the carrier): retire the work first (deprecate it). This prevents a
    rejected issue with live work. An issue shown `fixed` (closed as completed with an archived carrier) is refused (exit 4): a fixed
    issue is not re-judged.
  - Partial GitHub failure (comment posted, close failed) → exit with the failure's kind (8/9/10/4), printing which steps landed.
    Re-running is idempotent: an existing identical comment (matched by a hidden marker `<!-- lore-resolve:<state> -->`) is not re-posted.
    This removes the "recorded, label stale → exit 4" ambiguity (#290, BR-535) because nothing is recorded locally.

### D7. Filing (`report-issue-wiring.ts`, MCP `tools.ts:3324`)
- Filing creates the GitHub issue, records intent and outcome in the filing log (BR-497/498 kept), prints number and URL, exits 0.
  **It creates no corpus document.** `mintIssueTask` and `issue-task-shaping.ts` are deleted. BR-495/496 retired.
- The MCP `lore_report_issue` description says the report becomes a GitHub issue in the configured repository; its result carries
  `{number, url}` and no task slug (#294).

### D8. `lore status` (`commands/status.ts`, `status-issue-check.ts`)
- Plain `lore status` makes no GitHub call. Its JSON carries `issues: {checked: false}` and the text prints
  `issues: not checked (lore status --check-issues)`. It never prints a count it did not compute this run.
- `lore status --check-issues` reads the listing and the carrier index and reports `closed_unverified_count`,
  `adopted_abandoned_count`, `close_pending_count`, `closed_no_verdict_count`, `stale_open_count`, `unknown_ref_count` (carriers naming a
  number absent from the live listing; writes outside `lore create --issue` / `lore issue adopt` check the IssueRef shape only) (existing stale-open rule, re-keyed), each
  enumerable with `--enumerate <field>` as sorted `#<n>` lists. Offline → 8/9/10 for the whole command.
  `adopted_abandoned_count` leaves the default status payload.

### D9. HTTP + dashboard (`issue-reports-routes.ts:277`, `IssueReportsCard`, `IssuesList`, `IssueDetail`, `routes/issues*.tsx`)
- `GET /api/issue-reports` returns the D5 join (same function, not a parallel implementation) for unfinished issues, `?scope=resolved|all`.
  Errors map through `middleware.ts` (401 auth, 503 transport, 429 rate with `reset`). It never falls back to `listFull({type:"task"})`.
- The dashboard shows the HTTP error state with the gh hint. The triage card's decision buttons (BR-990's approve/reject of a mirror
  task) are removed: verdicts are made on GitHub or via `lore issue resolve`. The card shows counts per D4 status and links each row
  to its GitHub URL and, when present, its carrier.

### D10. Fold-in of open issue-loop defects

| # | Title (short) | Disposition under this spec |
|---|---|---|
| 16 | guard-order invariant unfalsifiable in `classifyFeedbackUpstream` | **Not moot.** Filing-config code is kept. Stays adopted; out of scope, listed so the plan does not lose it |
| 204 | helper-agent filing refused on local task write (foreign provenance) | **Moot**: filing writes no corpus doc (D7, AC-GS-10) |
| 259 | `lore setup --check` probes the vendor repo | **Not moot**. Setup is out of scope; stays adopted |
| 285 | deprecated report computes `open` forever | **Moot**: no report doc. A deprecated carrier yields `adopted (abandoned)` (D4) |
| 286 | dedupe on exact title only | **Not moot**: BR-499 is kept as a recorded suspected defect; out of scope. D2 does widen the duplicate hint to all pages |
| 288 | no pagination | **Fixed here** (D2, AC-GS-1) |
| 289 | `--verify` flags every unlabelled open report | **Moot**: `--verify` removed (D5) |
| 290 | label-update failure exits 4 like a refusal | **Moot**: resolve writes nothing locally. Exit kinds are distinct per failure (D6, AC-GS-6) |
| 291 | resolve overwrites without `expectedVersion` | **Moot**: resolve writes no corpus doc (BR-536 retired) |
| 292 | adopted accepts archived/deprecated owner | **Moot**: `--state adopted` removed. `adopt --plan` requires a live plan (D6, AC-GS-7) |
| 293 | review rejection of a report still reads open | **Moot**: no report doc to review (BR-515 retired) |
| 294 | MCP description says "upstream review queue" | **Fixed here** (D7, AC-GS-15) |

On landing, the closing carrier tasks carry `extra.issues` for #288, #294 and the moot ones; the moot ones are closed by
`lore issue resolve <n> --state superseded --by <this spec>`, not as `fixed`, because no code fixed them.

### New rules (added on landing, to the leaves named)

| Leaf | New rule text |
|---|---|
| list-defect-reports | An issue is shown as fixed only when it is closed on GitHub and a task or plan naming it in its issue list is archived. An issue closed as completed with no such document is shown as 'closed (unverified)', never as fixed, and is counted by the issue check. |
| list-defect-reports | An open issue whose every naming task or plan is deprecated or retracted is shown as 'adopted (abandoned)' and counted; one with an archived naming document is shown as 'fixed (close pending)' and counted, and the sync closes it. |
| list-defect-reports | Listing, adopting, resolving and the issue check never fall back to anything held locally: when GitHub cannot be read they fail by kind (exit 8, 9 or 10) and list nothing. |
| adopt-a-github-issue | Adopting creates one draft task naming the issue in its issue list, inside the given live plan or, with none given, as an ad-hoc task. An issue that already has a live naming task or plan is reported 'Already adopted' (exit 0) and nothing is created; when two sessions adopt at once exactly one task is created. |
| resolve-a-defect-report | Recording a verdict writes only to GitHub (a comment with the reason, the closing state, the verdict label) and nothing to the corpus; an issue that a live task or plan still names is refused (exit 4) naming that document. |
| create-a-document | Only tasks and plans may name issues; a document carrying the retired per-report field, or a resolving link, is refused (exit 4) on every write path. |

## Migration

One shipped command, `lore issues migrate [--apply] [--json]`. Without `--apply` it reads everything, prints the full plan (one line per
mirror and per link with its disposition, plus totals) and writes nothing to the corpus or GitHub. With `--apply` it executes the plan.
It needs GitHub (reads the paginated listing; writes comments/labels/closures); offline → exit 8/9/10 before any write.

**Ordering and atomicity.** Per mirror, all GitHub writes happen first. The corpus writes for that mirror (stamp carriers, delete
links, retire the mirror) then commit in one store transaction. A GitHub failure leaves that mirror and its links untouched and the run
continues with the next. The command exits with the first failure's kind and prints `N of M migrated`. Re-running is idempotent: a migrated
mirror no longer exists; GitHub comments carry a hidden marker `<!-- lore-migrate:<doc-id> -->` and are not re-posted; label writes are set-based.

**Concurrency.** Each mirror's corpus transaction uses `expectedVersion` on every doc it writes (mirror, carriers). A concurrent edit
fails that mirror with exit 5 and the next run picks it up. Two concurrent `migrate --apply` runs are safe for the same reason.

**Retirement of a mirror** = soft delete (`deleted_at`) plus audit row `issue_mirror_retired` with
`{issue: IssueRef, prior_resolution, prior_status, disposition, links_rewritten: [...]}`. The record stays addressable by id through the
audit log; it is excluded from every list/search like any deleted doc.

### Per-category dispositions (counts measured 2026-10-19; the migration recomputes them)

**Links into mirrors (130 `resolves`, 11 `relates-to`, 1 `informs`):**

| Link | Count | Disposition | Meaning preserved by |
|---|---|---|---|
| `resolves` from archived **task** | 79 links / 49 tasks (9 tasks resolve 2-10 issues each) | append the mirror's IssueRef to the task's `extra.issues` | the task is now an archived carrier → `fixed` once GitHub is closed |
| `resolves` from archived **plan** | 31 links / 9 plans | append to the plan's `extra.issues` | same |
| `resolves` from **spec** (19 approved, 1 deprecated) | 20 links / 7 specs | GitHub comment `Addressed by spec <slug> (<id>)` on the issue; link deleted | the comment (GitHub owns discussion). Measured: every spec-resolved issue except #183 also has an archived task/plan resolver, so no `fixed` verdict is lost; #183 stays open/adopted per its other facts |
| `relates-to` (10 approved specs, 1 knowledge) and `informs` (1 knowledge) | 12 | GitHub comment `Referenced by <type> <slug> (<id>) as <link type>`; link deleted | the comment |

Writing `extra.issues` onto archived/approved docs goes through the one corpus write route (CorpusService, per
spec-defect-clusters-round-1 D3 / spec-no-module-writes-around-the-write-path-the-remaining-17): an extra-only change of a carrier
leaves body, title and criteria untouched, so the record lock and the approved->draft demotion do not apply; each stamped doc gets one
version row and one audit row attributed to the migrating actor. If the route refuses such a write, that refusal is the defect to fix;
the migration never writes around the route.

**Mirrors with a GitHub ref (288):**

The two explicit-verdict rows are evaluated first (a verdict outranks a resolver, as in today's `computeIssueResolution`); then the
remaining rows top to bottom; the first match wins. Links are rewritten onto carriers in every case before the mirror is retired.

| Mirror state (corpus) | GitHub now | Disposition |
|---|---|---|
| mirror itself `archived` (completed via `lore done`, BR-1084) | any | **keep as carrier** (see last-but-one row) |
| has an archived task/plan resolver (now a carrier) | any | retire mirror after its links are rewritten; an `adopted_by` on it is dropped (the fix outranks the adoption) |
| explicit verdict `rejected` / `wontfix` / `superseded` / `duplicate` | closed with matching `state_reason` + label | retire mirror |
| explicit verdict | open, or closed with a different reason/label | GitHub: comment with the recorded reason + pointer, close with the matching `state_reason`, set the verdict label; then retire. (The corpus verdict was a maintainer decision; GitHub now becomes its owner.) |
| `adopted_by` a live plan (187 today) | open | **re-home**: the mirror becomes a work task: `extra.plan_id=<plan>`, `extra.adhoc` removed, `extra.issues=[ref]`, `extra.issue_report` removed. Slug kept (addressability). Not retired |
| `adopted_by` a live plan | closed (14 cases in the handed-over evidence) | retire mirror; the issue shows `fixed`/`closed (unverified)`/verdict per D4; listed in the ledger as `adoption dropped: closed on GitHub` |
| `adopted_by` an archived/deprecated plan (1 today) | any | retire mirror; ledger `adoption dropped: owner <slug> <status>`. The plan is **not** stamped (that would turn a dangling adoption into `fixed`) |
| mirror itself `archived` via `lore done` (completing its own task, BR-1084) | any | **keep as carrier**: `extra.issues=[ref]`, `extra.issue_report` removed. It was the work |
| draft, no verdict, not adopted (open-state mirrors) | any | retire mirror; GitHub state stands as-is |

**Final D3 pass.** After all carriers are stamped, every issue that is open on GitHub and has an archived carrier is closed exactly as
D3 does on archive. Measured: 0 of the 288 filed issues are in that state today, so only newly filed local-only reports reach it.

**Retired labels.** For every issue in the listing: remove `resolution:adopted`, `resolution:resolving`, `resolution:closed`,
`resolution:open`. Remove `resolution:fixed` from issues that are not `fixed` under D4. Remove a verdict label from an open issue.
(Today 8 issues carry two resolution labels; 121 + 7 + 1 carry `adopted`/`resolving`.)

**Local-only reports (34, no GitHub issue).** Measured: 5 archived (no verdict), 15 draft (no verdict), 2 adopted, 2 duplicate,
10 rejected; 21 inbound `resolves`, 2 `relates-to`, 1 `informs`. They exist only in this repository's corpus (the retired SQLite
transport only reached a shared filesystem). Recommended disposition (user decision 2):

- **File each to GitHub first** through the normal filing path (same body contract, same redaction, a minted filing key, receipt logged),
  so every report fact gets its one owner. Then apply the table above to the now-filed mirror:
  - 15 draft/no-verdict: 10 have an archived resolver (7 archived plans, 3 archived tasks), which become carriers, so the new issue is
    closed as completed by the migration's final D3 pass. The other 5 have none: the issue stays open, mirror retired.
  - 5 archived/no-verdict → the mirror was completed work: kept as a carrier; the new issue is closed as completed (one of them is also
    resolved by an archived plan and a deprecated spec).
  - 2 adopted → both also have an archived resolver (1 plan, 1 task), so the fix wins: carriers stamped, issue closed as completed,
    mirror retired (an adoption of fixed work is not re-homed).
  - 10 rejected, 2 duplicate → filed, then closed with the matching `state_reason`, label and the recorded reason as a comment.
- In a consumer corpus (not expected to hold any), the same rule applies.

**Post-conditions (asserted by AC-GS-12, and by the command itself before it prints `migrated`):**
zero live docs carrying `extra.issue_report`; zero `resolves` links; every retired mirror has exactly one `issue_mirror_retired`
audit row; every previous `resolves` source that was a task/plan names that IssueRef in `extra.issues`; the dry-run total equals the applied total.

**After the migration ships**, every issue surface (D5-D9) refuses with exit 4 naming `lore issues migrate --apply` while any live doc
still carries `extra.issue_report`. That is the D1 invariant checked on read. Nothing reads the retired shape.

## Acceptance Criteria

Full statements, commands and citations: `lore ac list`. Every cited rule was confirmed live with `lore rule show` on 2026-10-19, and
`cite_texts` holds that live text verbatim. No AC cites a rule this spec retires. Ten cited rules are **modified** by this spec
(BR-505, 508, 514, 527, 528, 990, 1082, 1083, 1084, 1241). Their ACs assert the `new_text_if_modify` in `rule-changes.json`, so the
`lore rule set` for each must land in the same change as the AC (the AC is red against the current text by design).

All tests use a stubbed GitHub: unit tests inject a `GhRunner` double; integration tests run the compiled binary with PATH holding only a
recording `gh` stub and a throwaway corpus (`mkdtemp` + `lore init`), as `tests/integration/cli/issue-read-surfaces-gh.bun.test.ts` does
today. No test calls the real API or writes the repository's own `.lore/`.

Summary:

| AC | Proves | Cites |
|---|---|---|
| AC-GS-1 | listing paginates, excludes PRs, ceil(N/100) requests, fails whole on a failed page | BR-514, BR-1241, BR-505 |
| AC-GS-2 | offline/auth/rate → exit 9/8/10, zero rows, no local fallback even with carriers present | BR-504, BR-505 |
| AC-GS-3 | `deriveIssueStatus` covers every status-table row; nine states reachable | BR-508, BR-505 |
| AC-GS-4 | Close-as-completed without archived carrier → `closed (unverified)` + counted; archived carrier → `fixed` | BR-1082, BR-508 |
| AC-GS-5 | `resolve --state fixed` refused exit 4 with zero gh calls | BR-527 |
| AC-GS-6 | resolve writes only GitHub (comment, close, label), zero corpus writes, idempotent re-run; partial failure exit kind | BR-527, BR-528, BR-504 |
| AC-GS-7 | adopt creates one carrier task (plan or ad-hoc), idempotent, concurrent-safe, refuses non-live plan | BR-522, BR-524, BR-520 |
| AC-GS-8 | archiving a multi-issue carrier closes each, skips verdict-closed, failure audited, archive exit unchanged | BR-1082, BR-1084 |
| AC-GS-9 | abandoned / close-pending counts in `status --check-issues`; plain status makes no gh call | BR-1082, BR-508 |
| AC-GS-10 | filing creates zero corpus docs; receipt intent/outcome still written | BR-494, BR-497, BR-498 |
| AC-GS-11 | `extra.issue_report` and `resolves` refused on every write path; `--issue` writes the carrier; spec refused | BR-1083 |
| AC-GS-12 | migration: dry-run writes nothing; apply reaches post-conditions; second run no-op | BR-1082, BR-1084 |
| AC-GS-13 | migration GitHub failure leaves mirror and links intact, exit kind, resumable | BR-504 |
| AC-GS-14 | HTTP route live join; 401/503/429; never lists from corpus | BR-990, BR-504 |
| AC-GS-15 | MCP filing description and result name GitHub, no task | BR-494 |
| AC-GS-16 | `--sync` closes close-pending, strips retired labels, prints `clean` only after a complete listing | BR-1084, BR-1241 |


## Acceptance Criteria (structured)

- [·] [script] AC-GS-1: GitHubIntakePort.listIssues, driven by an injected GhRunner stub serving 3 pages (100, 100, 52 entries; pages 1 and 2 carry Link rel="next"; 2 of the 252 entries carry a pull_request key; page 3 holds issue #1), returns exactly 250 issues including #1 and no entry whose number belongs to a PR, and the stub records exactly 3 calls. A second stub whose page 2 fails with TRANSPORT_UNAVAILABLE makes listIssues return err with code TRANSPORT_UNAVAILABLE and no issues (never the 100 from page 1). Simplest case where the goal fails yet stays green: a single-page fixture of <=100 issues passes with or without pagination, so the fixture must exceed 100 and the asserted issue (#1) must sit on the last page. Made red once by: reverting listIssues to the single `per_page=100` call (returns 100, misses #1, 1 call).
  script: test — bun run test:file packages/lore/tests/unit/service/github-intake-port-pagination.test.ts -t "AC-GS-1" && echo 'AC-GS-1 PASS: listing paginates, drops PRs, fails whole on a failed page'
  other_command=4
- [⚑] [script] AC-GS-2: In a throwaway corpus (mkdtemp + lore init) holding one task carrying extra.issues=[{repo_id:1,number:7}], the compiled `lore issues --all --json` with PATH holding only a recording gh stub that fails as a network error exits exactly 9, with a stub failing as not-logged-in exits exactly 8 and stderr names 'gh auth login', and with a stub failing as rate-limited exits exactly 10 and stderr carries the reset time; in all three cases stdout parses to no rows and contains neither '#7' nor the task's slug. `lore issues --local` exits exactly 2 (unknown switch). Simplest case where the goal fails yet stays green: a fallback that prints the local carrier rows AND exits 9 passes an exit-code-only check, so the row-absence assertion on '#7' is required. Made red once by: catching TRANSPORT_UNAVAILABLE in commands/issues.ts and listing the carrier index instead.
  script: test — bun run test:file packages/lore/tests/integration/cli/issues-live-only.bun.test.ts -t "AC-GS-2" && echo 'AC-GS-2 PASS: offline exits 8/9/10 by kind and lists nothing'
- [⚑] [script] AC-GS-3: deriveIssueStatus is table-driven over every row of the ADR status table (12 rows: open/no carrier -> open; open/live carriers none claimed -> adopted; open/live task carrier with an open claim -> resolving; open/archived carrier -> 'fixed (close pending)'; open/only deprecated or invalidated carriers -> 'adopted (abandoned)'; closed completed/archived carrier -> fixed; closed completed/no archived carrier -> 'closed (unverified)'; closed not_planned + resolution:rejected|wontfix|superseded -> that verdict (3 rows); closed duplicate -> duplicate; closed not_planned/no verdict label -> 'closed (no verdict)') and returns exactly the listed status for each; the set of returned statuses over the table has 12 members, so all twelve statuses are reachable. An open issue carrying a stray resolution:rejected label and no carrier returns open. Simplest case where the goal fails yet stays green: an implementation reading `resolution:fixed` from the label returns fixed for the 'closed completed + label fixed + no carrier' row; that row is in the table and must return 'closed (unverified)'. Made red once by: returning fixed whenever state_reason=completed.
  script: test — bun run test:file packages/lore/tests/unit/service/issue-status-derivation.test.ts -t "AC-GS-3" && echo 'AC-GS-3 PASS: every status-table row derives exactly'
  other_command=1
- [·] [script] AC-GS-4: With the gh stub listing issue #5 as closed/state_reason=completed with label resolution:fixed, and a throwaway corpus holding no carrier for #5, `lore issues --resolved --json` shows #5 with status 'closed (unverified)' (exit 0) and `lore status --check-issues --json` reports issues.closed_unverified_count == 1 and `--enumerate closed_unverified_count` prints '#5'. Adding a DRAFT task carrying #5 leaves both unchanged (status 'closed (unverified)', count 1). After that task is archived (bare service write in setup, no gh close), #5 shows 'fixed' and the count is 0. Simplest case where the goal fails yet stays green: treating any carrier (not only an archived one) as verification passes the archived case, so the draft-carrier case must assert 'closed (unverified)'. Made red once by: relaxing the carrier predicate in deriveIssueStatus from status==='archived' to 'any carrier'.
  script: test — bun run test:file packages/lore/tests/integration/cli/issues-closed-unverified.bun.test.ts -t "AC-GS-4" && echo 'AC-GS-4 PASS: GitHub-only close is unverified and counted; archived carrier verifies'
  other_command=2
- [⚑] [script] AC-GS-5: `lore issue resolve 5 --state fixed --reason x` in a throwaway corpus exits exactly 4, stderr names archiving a carrier (contains 'archive' and '--issue') as the way to reach fixed, and the recording gh stub's log is empty (zero calls, not even `gh api user`); `--state FIXED`, `--state adopted` and `--state closed` each exit exactly 4 and list the four valid values 'rejected, wontfix, superseded, duplicate'. Simplest case where the goal fails yet stays green: a refusal issued after reading the listing still exits 4, so the zero-call assertion on the stub log is required. Made red once by: moving the state check after the listing read.
  script: test — bun run test:file packages/lore/tests/integration/cli/issue-resolve-github-owned.bun.test.ts -t "AC-GS-5" && echo 'AC-GS-5 PASS: fixed is refused before GitHub is contacted'
  other_command=1
- [⚑] [script] AC-GS-6: `lore issue resolve 5 --state rejected --reason 'not a defect'` against a gh stub listing #5 open with no carrier exits 0 and the stub log shows, in order: one comment POST whose body contains 'not a defect' and '<!-- lore-resolve:rejected -->', one PATCH state=closed state_reason=not_planned, one label write adding resolution:rejected and removing every other resolution:* label; the corpus row counts of docs, versions and audit are byte-identical before and after. Re-running the same command posts no second comment (stub shows 0 comment POSTs on the second run) and exits 0. With a stub that fails the PATCH as a network error after the comment, the command exits exactly 9 and stdout names 'comment: posted' and 'close: failed'. With #5 named by a draft task's extra.issues, the command exits exactly 4 naming that task's slug and the stub log has no write. Blank --reason exits exactly 4. Simplest case where the goal fails yet stays green: a resolve that also writes an audit row passes all GitHub assertions, so the corpus row-count equality is required. Made red once by: re-adding the corpus resolution write (`corpusService.set` of extra.issue_report.resolution).
  script: test — bun run test:file packages/lore/tests/integration/cli/issue-resolve-github-owned.bun.test.ts -t "AC-GS-6" && echo 'AC-GS-6 PASS: resolve writes only GitHub, idempotent, exit kind on partial failure'
  other_command=1
- [⚑] [script] AC-GS-7: `lore issue adopt 7 --plan <live plan>` against a stub listing #7 open (#7 on page 2 of a 2-page listing) exits 0 and creates exactly one draft task with slug task-issue-<repo_id>-7, extra.plan_id = the plan's id, extra.issues == [{repo_id,number:7}], no extra.issue_report and no extra.adhoc; the stub log shows only GET calls, and `lore issues --json` then shows #7 as adopted. A second identical run prints 'Already adopted: task-issue-<repo_id>-7', exits 0 and the task count is unchanged. Two concurrent runs (Promise.all of two spawned binaries) create exactly one task, both exit 0, exactly one stdout starts with 'Already adopted'. `--plan` naming an archived plan exits exactly 4 and creates nothing. Adopting #8 listed closed exits exactly 4. Simplest case where the goal fails yet stays green: an implementation reading only page 1 passes when #7 is on page 1, so #7 sits on page 2. Made red once by: dropping the DUPLICATE_SLUG handling so the loser exits 4.
  script: test — bun run test:file packages/lore/tests/integration/cli/issue-adopt-work-task.bun.test.ts -t "AC-GS-7" && echo 'AC-GS-7 PASS: adopt creates one carrier task, idempotent and race-safe'
  other_command=1
- [⚑] [script] AC-GS-8: In a throwaway corpus, a claimed task carrying extra.issues=[#11,#12,#13] with a stub listing #11 open, #12 open, #13 closed state_reason=not_planned label resolution:rejected: `lore done <task>` exits 0 and the stub log shows, for #11 and #12 each, one comment naming the task slug, one PATCH state=closed state_reason=completed, one label write adding resolution:fixed; for #13 no write at all, and stdout says '#13 skipped: closed as rejected'. With a stub that fails #12's PATCH as a network error, `lore done` still exits 0, the task is archived, stdout/stderr names #12 and 'lore issues --sync', and exactly one audit row with action issue_close_failed names #12. Archiving a PLAN carrier via `lore archive` closes its issues the same way. Simplest case where the goal fails yet stays green: an implementation closing only extra.issues[0] passes a single-issue fixture, so the fixture names three issues and asserts #12. Made red once by: making onArchived read only the first IssueRef.
  script: test — bun run test:file packages/lore/tests/integration/cli/issue-close-on-archive-carrier.bun.test.ts -t "AC-GS-8" && echo 'AC-GS-8 PASS: archiving a carrier closes each named issue, skips verdicts, audits failures'
- [·] [script] AC-GS-9: With a stub listing #20 open, #21 open, #22 open: corpus has a DEPRECATED task naming #20 (only carrier), a deprecated plan AND a draft task naming #21, and an ARCHIVED task naming #22. `lore status --check-issues --json` exits 0 with issues.adopted_abandoned_count == 1 (enumerates '#20'), issues.close_pending_count == 1 (enumerates '#22'); #21 counts in neither. Plain `lore status --json` exits 0, reports issues == {checked:false}, carries no adopted_abandoned_count key, and the recording gh stub log is empty. Simplest case where the goal fails yet stays green: a predicate that ignores sibling carriers counts #21 as abandoned (count 2), so #21's live sibling is in the fixture and the count must be exactly 1. Made red once by: computing abandonment per carrier instead of per issue.
  script: test — bun run test:file packages/lore/tests/integration/cli/status-check-issues-live.bun.test.ts -t "AC-GS-9" && echo 'AC-GS-9 PASS: abandoned and close-pending are counted per issue; plain status makes no gh call'
  other_command=4
- [·] [script] AC-GS-10: `lore report-issue --title T --description D --expected E --actual A --severity low --category c` in a throwaway corpus with a create-issue gh stub exits 0 and prints the issue number and URL; SELECT count(*) FROM docs and FROM versions are equal before and after; the filing log (issue-receipts-v2.jsonl) gains exactly one intent and one outcome line with the same filing key. Repeating the command prints 'Already filed' and exits 0 with zero gh create calls. The same filing run as a helper agent after `lore release` (the #204 setup) exits 0. Simplest case where the goal fails yet stays green: a filing that mints its task under a new slug prefix passes a 'no task-gh-* slug' check, so the assertion is on total doc count. Made red once by: re-enabling the mintIssueTask call in report-issue-wiring.ts.
  script: test — bun run test:file packages/lore/tests/integration/cli/report-issue-no-mirror.bun.test.ts -t "AC-GS-10" && echo 'AC-GS-10 PASS: filing creates zero corpus docs and keeps the receipt log'
  other_command=4
- [⚑] [script] AC-GS-11: Through CorpusService (the layer CLI, MCP and HTTP share), creating or `set`-ing a task with extra.issue_report returns err VALIDATION_ERROR field 'extra.issue_report' whose message names 'lore issues migrate --apply'; creating a link of type 'resolves' returns err VALIDATION_ERROR; a spec with extra.issues returns err field 'extra.issues'; extra.issues with a duplicate ref, a zero number or 51 refs each return err. Via the CLI each of these exits exactly 4. `lore create task --issue 7 --issue 9` (stub listing #7 and #9) exits 0 and the task's extra.issues == [{repo_id,7},{repo_id,9}]; `--issue 99` (not listed) exits exactly 4 and writes nothing. Simplest case where the goal fails yet stays green: a check only in the CLI adapter passes CLI cases while MCP/batch writes slip through, so the refusal is asserted at the service level. Made red once by: removing 'extra.issue_report' from the retired-key list in CorpusService.
  script: test — bun run test:file packages/lore/tests/unit/service/issue-carrier-schema.test.ts -t "AC-GS-11" && echo 'AC-GS-11 PASS: retired shapes refused at the service layer; --issue writes the carrier'
  other_command=1
- [⚑] [script] AC-GS-12: A fixture corpus with one mirror per migration category (verdict matching GitHub; verdict not on GitHub; adopted by live plan with issue open; adopted by live plan with issue closed; adopted by archived plan; mirror archived via done; open un-adopted; archived task resolving 3 mirrors; archived plan resolving 1; approved spec resolving 1; knowledge relates-to 1; local-only rejected report) and a recording gh stub: `lore issues migrate --json` exits 0, its plan lists every mirror and link with the disposition named in spec.md § Migration, and docs/links/versions/audit row counts and the stub's write log are unchanged. `lore issues migrate --apply` exits 0, then: zero live docs carry extra.issue_report; zero links of type resolves; the 3-mirror archived task's extra.issues has all 3 refs; the archived-plan owner of a dropped adoption has no extra.issues; the live-plan adoption is re-homed (same slug, extra.plan_id set, extra.issues=[ref]); every retired mirror has exactly one issue_mirror_retired audit row; the spec and knowledge links became exactly one comment each carrying '<!-- lore-migrate:'; the local-only report produced one create-issue call followed by a close with state_reason not_planned. A second `--apply` exits 0 with zero gh writes and zero corpus writes. Simplest case where the goal fails yet stays green: deleting all mirrors and links reaches the zero-mirror/zero-link post-conditions while losing every meaning, so the per-carrier refs, the re-home and the comment assertions are required. Made red once by: skipping the link-rewrite step before retiring a mirror.
  script: test — bun run test:file packages/lore/tests/integration/cli/issues-migrate.bun.test.ts -t "AC-GS-12" && echo 'AC-GS-12 PASS: migration reaches its post-conditions losslessly and is idempotent'
  other_command=1
- [⚑] [script] AC-GS-13: In the AC-GS-12 fixture with a stub that fails the close of the 'verdict not on GitHub' mirror's issue as a network error, `lore issues migrate --apply` exits exactly 9, prints 'N of M migrated' with N == M-1, and that mirror still exists with its extra.issue_report and its inbound links unchanged (version unchanged) while every other mirror is migrated; rerunning with a healthy stub exits 0 and posts no second comment for that issue (one '<!-- lore-migrate:' comment total). With the stub offline before any call, `--apply` exits exactly 9 and the corpus row counts are unchanged. Simplest case where the goal fails yet stays green: a run that writes the corpus first and GitHub second leaves a retired mirror whose verdict never reached GitHub yet still exits 9, so the mirror's continued existence is asserted. Made red once by: committing the corpus transaction before the GitHub writes.
  script: test — bun run test:file packages/lore/tests/integration/cli/issues-migrate.bun.test.ts -t "AC-GS-13" && echo 'AC-GS-13 PASS: a GitHub failure leaves the mirror intact and the run resumable'
  other_command=1
- [·] [script] AC-GS-14: handleGetIssueReports with an injected intake-port stub listing #30 open and a corpus draft task carrying #30 (unclaimed) returns 200 with exactly one row {number:30, status:'adopted', carrier:<slug>}; with the port returning AUTH_REQUIRED it returns 401 with body code AUTH_REQUIRED, with TRANSPORT_UNAVAILABLE 503, with RATE_LIMITED 429 carrying reset; in the three error cases the body has no rows key. A corpus holding a legacy draft task with extra.issue_report (inserted via the bare store) and an empty listing yields zero rows, never the legacy task. The dashboard IssuesList renders the 401 state with the 'gh auth login' hint and no list items. Simplest case where the goal fails yet stays green: a route still built on listFull({type:'task'}) returns the carrier row too when the listing is empty, so the empty-listing case must return zero rows. Made red once by: restoring listFull({type:'task'}) as the route's source.
  script: test — bun run test:file packages/lore/tests/unit/adapters/http-issue-reports-live.test.ts -t "AC-GS-14" && echo 'AC-GS-14 PASS: HTTP route serves only the live join and maps gh errors'
  other_command=2
- [·] [script] AC-GS-15: The registered MCP tool lore_report_issue's description contains 'GitHub issue' and contains none of 'upstream', 'review queue', 'pending-review', 'draft ad-hoc task'; calling it with a create-issue stub returns a payload with keys number and url and without task_slug, slug or task_id, and the corpus doc count is unchanged. Simplest case where the goal fails yet stays green: a description containing both 'GitHub issue' and 'review queue' passes a contains-only check, so the forbidden phrases are asserted absent. Made red once by: restoring the old description string.
  script: test — bun run test:file packages/lore/tests/unit/adapters/mcp-report-issue-description.test.ts -t "AC-GS-15" && echo 'AC-GS-15 PASS: MCP filing describes and returns a GitHub issue only'
  other_command=3
- [⚑] [script] AC-GS-16: With a 2-page stub listing where #40 (page 2) is open and named by an archived task, #41 is open with labels resolution:adopted and resolution:fixed and no carrier, and #42 is closed/completed with a verified archived carrier: `lore issues --sync` exits 0 and the stub log shows exactly: #40 closed completed + resolution:fixed + one comment; #41 both labels removed; nothing for #42; the issue fetches equal the page count (2). A second run prints 'clean' and exits 0 with zero writes. With a stub whose page 2 fails as a network error, `--sync` exits exactly 9 and stdout does not contain 'clean'. Simplest case where the goal fails yet stays green: a sync reading page 1 only prints 'clean' when #40 sits on page 2 (the measured 188-divergence/clean contradiction), so #40 is on page 2 and the failed-page case must not print 'clean'. Made red once by: printing 'clean' when the planned-change list is empty regardless of listing completeness.
  script: test — bun run test:file packages/lore/tests/integration/cli/issues-sync-push-only.bun.test.ts -t "AC-GS-16" && echo 'AC-GS-16 PASS: sync repairs close-pending and labels, says clean only after a complete listing'
