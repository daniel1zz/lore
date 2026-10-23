---
id: ADR-053
type: adr
role: decision
title: "GitHub owns issue-report state; the corpus owns only the work that resolves an issue"
status: draft
priority: critical
created: 2026-10-19
updated: 2026-10-19
tags: [defect-channel, github, ssot, adr]
links:
  - {id: ADR-037, type: supersedes}
  - {id: SPEC-212, type: governs}
---
**Date**: 2026-10-19
**Supersedes**: `adr-a-tracker-is-replaceable-a-corpus-is-not-github-is-the` (v3, approved 2026-08-23)
**Decision owner**: the repository owner (decision taken 2026-10-19)
**Governs**: the GitHub-owns-issue-state spec (AC-GS-*)

> All numbers below were measured on 2026-10-19 against `.lore/lore.db` (opened read-only)
> and `gh api --paginate repos/daniel1zz/lore/issues?state=all` (repo id 1343388703, public). Where a number differs from
> the figure handed to the drafting session, both are given.

## Context

The superseded ADR made GitHub the intake and visibility surface and kept resolution authority in the corpus. To do that,
every filed or adopted issue got a corpus mirror task (`task-gh-<repoid>-<n>`, carrying `extra.issue_report`), and the
`resolution:*` label on GitHub was a projection of a corpus-computed value. The ADR listed "projection lag" (R6) as an
accepted cost and said a lag detector was "required infrastructure". Two months later:

| Measure | ADR's assumption | Measured 2026-10-19 |
|---|---|---|
| Volume | "12 reports in 11 days" | **301 GitHub issues** (0 PRs); **322** corpus report tasks = 288 `task-gh-*` mirrors + 34 local-only reports |
| Label divergence | `--verify` is the drift oracle | `lore issues --local --verify` listed **188** label divergences while `lore issues --sync` printed "clean" (two detectors, two answers) |
| Mirror lag | lag is short and detected | **157** mirror tasks are `draft` while their GitHub issue is CLOSED (handed-over figure: 109; it grew) |
| Adopted but closed | adoption has a live owner | 14 issues `adopted` in the corpus are closed on GitHub (handed-over figure) |
| Intake completeness | one batched call reads "every issue" (`github-intake-port.ts:400`) | the call is `per_page=100` with no pagination (#288, BR-514): ~200 of 301 issues were invisible to list, adopt, dedupe and the label check |
| Label integrity | "loses any other resolution label" (BR-533) | **8** issues carry two `resolution:*` labels at once (7 × `adopted,fixed`, 1 × `resolving,fixed`) |
| Fixed without a corpus fix | — | 122 issues are "closed as completed" on GitHub; of the 116 that have a mirror, **10** have no archived resolver of any kind, and 6 more have no mirror at all |

R6 is no longer a risk; it has happened. The two-copies design produced exactly the failure the superseded ADR attributed to
bidirectional sync ("two writable copies have no single truth; reconciler failure is silent"), only with the corpus as the
copy nobody updates. The corpus currently lies on the issue loop: 157 records say "open work" for issues that are closed.

Two structural facts make the mirror unfixable by more reconciliation:

1. **People close issues on GitHub.** That is where the discussion and the notification are. Any rule that says "the corpus
   is the truth about open/closed" is contradicted every time someone presses a GitHub button, and lore has no way to stop it.
2. **The mirror carries no work.** Adoption is recorded only as `extra.issue_report.resolution.adopted_by=<plan ULID>`
   (188 records, all pointing at 10 plans; 9 of them `plan-defect-backlog-*`/`plan-repository-upkeep-backlog`, which together
   hold 15 tasks). The mirror is a ledger row, not a unit of work. The 130 `resolves` links into mirrors (79 from archived tasks,
   31 from archived plans, 19 from approved specs, 1 from a deprecated spec; the handed-over figure of 81 is out of date) are
   the only places the corpus says something GitHub cannot: *which corpus work fixed this issue*.

## Decision

**GitHub is the single owner of every issue-report fact. The corpus owns only work, and a piece of work names the issues it
resolves.** There is no per-issue corpus record.

- The corpus keeps no mirror task. A task or plan that resolves issues carries `extra.issues: [{repo_id, number}, ...]`
  (the "carrier"). A task is created when an issue is adopted (`lore issue adopt <n> [--plan <plan>]`).
- Archiving a carrier closes each named issue as **completed**, sets `resolution:fixed`, and comments the carrier's slug. This
  is the push direction that exists today via `resolves` links (`issue-close-on-archive.ts::onArchived`), re-keyed on the
  carrier field.
- Every read (`lore issues`, `lore issue adopt`, the dashboard, MCP, HTTP, `lore status --check-issues`) reads GitHub live,
  with pagination, pull requests excluded.
- Offline is a named error: exit 8 (gh missing or not logged in), 9 (network), 10 (rate limited), never a local fallback,
  because nothing local exists to fall back to.
- **"fixed" is a joined fact**: an issue is shown `fixed` only when it is closed on GitHub AND an archived carrier naming it
  exists. A GitHub "Close as completed" with no archived carrier is shown **`closed (unverified)`** and counted.

### Per-field authority

| Field | Authority | Where it lives | Read back as truth by lore? |
|---|---|---|---|
| existence, number, title, body, reporter metadata block | GitHub | the issue | yes, live |
| severity, category, tags | reporter (body front-matter, unchanged) | issue body | yes, live |
| open / closed, `state_reason` | GitHub | native state | yes, live |
| rejected / wontfix / superseded / duplicate | GitHub, written by maintainers (`lore issue resolve` or the web UI) | `state_reason` + one `resolution:<verdict>` label | yes, live. Labels need push access, so a third-party reporter cannot set one |
| discussion, supersession/duplicate pointer, rejection reason | GitHub | comments (`lore issue resolve` writes the reason as a comment) | yes, live |
| **which corpus work resolves the issue** | **corpus** | `extra.issues` on a task or plan | yes. This is the corpus's only issue fact |
| **"fixed" (verified)** | **joined**: GitHub closed AND corpus carrier archived | computed, never stored | computed per read |
| adopted / resolving (in work) | **corpus**: a live carrier exists (resolving = one of its task carriers is claimed) | computed from carrier status and claim | computed per read |
| `resolution:fixed` label | written by lore on archive-close | label | **no**. Display only; "fixed" is never read from it |
| `resolution:adopted`, `resolving`, `closed`, `open` labels | retired | removed by the migration | no; lore no longer writes them |

### Displayed status (total over GitHub state × carriers)

| GitHub | `state_reason` / verdict label | Carriers naming the issue | Shown as | Counted in `lore status --check-issues` |
|---|---|---|---|---|
| open | — | none | `open` | — |
| open | — | at least one live carrier, none of them a task with an open claim | `adopted` | — |
| open | — | a live **task** carrier holds an open claim | `resolving` | — |
| open | — | an archived carrier exists | `fixed (close pending)` | `close_pending_count` (repaired by `lore issues --sync`) |
| open | — | carriers exist, all deprecated or invalidated | `adopted (abandoned)` | `adopted_abandoned_count` |
| closed | completed | an archived carrier exists | `fixed` | — |
| closed | completed | no archived carrier | `closed (unverified)` | `closed_unverified_count` |
| closed | not_planned + `resolution:rejected\|wontfix\|superseded` | any | that verdict | — |
| closed | duplicate, or `resolution:duplicate` | any | `duplicate` | — |
| closed | not_planned, no verdict label | any | `closed (no verdict)` | `closed_no_verdict_count` |

Nine states survive (`open`, `adopted`, `resolving`, `fixed`, `closed`, `rejected`, `wontfix`, `superseded`, `duplicate`),
with `closed` now split into two honest sub-states, and three counted anomaly states.

## The three objections of the superseded ADR, answered

### 1. "GitHub's Close as completed becomes a permanent back door around the unconditional `--state fixed` rejection" (BR-527)

The back door existed because the old design asked "is it fixed?" of a record that someone else could close. The new
design never reads "fixed" from GitHub alone:

- `fixed` requires an **archived carrier in the corpus**. A carrier reaches `archived` only through `lore done` /
  `lore archive`, both service-layer gated (claims, evidence, AC verification). Closing on GitHub cannot create a carrier.
- A Close-as-completed without one is rendered `closed (unverified)`, never `fixed`, and counted in
  `lore status --check-issues --json` as `issues.closed_unverified_count` (today: 16 = 10 with a mirror but no archived resolver,
  plus 6 with no mirror). The count is an addressable, re-verifiable list (`--enumerate`), not a silent drop.
- `lore issue resolve --state fixed` is still refused with exit 4 before GitHub is contacted (BR-527, kept in modified form).

So a GitHub user can close an issue. That is GitHub's fact to own. They cannot make lore say it was fixed by corpus work.
The superseded ADR's real concern ("unclosable because you cannot disable a GitHub button") is met by making the button's
effect visible and labelled instead of trying to disable it.

### 2. "9 resolution states collapse to 7" (`corpus-service.ts:4487`, now `:5335-5353`)

The collapse happened only because the old design required a `resolves` edge to point at a corpus task carrying
`extra.issue_report`. A pointer-only record had nothing for `resolves` to point at, so `fixed` and `resolving` became
unreachable. In the new design `resolves` is replaced by the carrier field on the work itself, so no target record is needed:

| State | Old source | New source |
|---|---|---|
| open | default | GitHub open, no carrier |
| adopted | `resolution.adopted_by` on the mirror | a live carrier, none claimed |
| resolving | `resolves` link from a non-active doc | a live task carrier with an open claim (work in progress) |
| fixed | `resolves` link from an active/archived doc | GitHub closed + archived carrier |
| closed | mirror archived without verdict | GitHub closed-completed without archived carrier (`closed (unverified)`) |
| rejected / wontfix / superseded | `resolution.state` on the mirror | `state_reason=not_planned` + verdict label |
| duplicate | `resolution.state` on the mirror | `state_reason=duplicate` (or label) |

All nine stay reachable (AC-GS-3 tests each table row). One deliberate change: `fixed` no longer accepts an `active`
(non-archived) resolver. Under the decided rule only archived work verifies a fix.

### 3. "`isDanglingAdoption` goes blind to label-only adoption"

It went blind because adoption was a label on GitHub plus a pointer on the mirror, and neither had to stay alive. Now
adoption **is** a corpus document: the carrier. The dangling check becomes a join with no hidden state:

- `adopted (abandoned)` = the issue is open on GitHub AND every carrier naming it is `deprecated` or invalidated (no live
  carrier, no archived carrier).
- `fixed (close pending)` = the issue is open AND an archived carrier exists (the archive-close failed). It is not abandonment
  and is repaired by `lore issues --sync`.

`isDanglingAdoption`'s input changes from `{computedResolution, ownerStatus}` to `{githubState, carrierStatuses[]}`. Its truth
table is AC-GS-9. Its blind spot was a missing owner record; that blind spot cannot occur because the owner record is the
adoption itself.

## Quality Attributes Affected

| Attribute | Impact | Scenario |
|---|---|---|
| Integrity (corpus must not lie) | **+** no second copy of open/closed or verdict exists, so it cannot drift. The 157 lying drafts are removed | QA-1: close an issue on GitHub; the next `lore issues` shows it closed with no lore write |
| Integrity of "fixed" | **+** "fixed" now needs archived work (stricter than today, which accepted an `active` resolver) | QA-2: Close-as-completed without work, shown `closed (unverified)` and counted |
| Completeness | **+** pagination; every read sees all 301 issues | QA-3: 250-issue stub, all 250 listed |
| Concurrency | **+** two sessions adopting the same issue both compute the same deterministic slug `task-issue-<repo_id>-<n>` (suffix `-r<k>` when k earlier carriers exist), so the store's slug uniqueness lets exactly one insert win, without relying on exclusivity (today's BR-1169 mechanism, re-keyed); two sessions resolving the same issue race only on GitHub, where last-writer-wins on a label is visible in the issue timeline | QA-4 |
| Availability | **−** listing, adopting, resolving and the status check need GitHub. Offline gives exit 8/9/10. Archiving a carrier still works offline: the close is recorded as `issue_close_failed` and repaired by `--sync` | QA-5 |
| Performance | **−** each listing = ceil(N/100) requests (4 for today's 301), about 0.7 s p50 each (superseded ADR's measurement). Grows by one request per 100 issues, never per issue | QA-6 |
| Modifiability | **−** swapping trackers now moves issue history with the tracker. Corpus work is unaffected: carriers name `{repo_id, number}`, a tracker-neutral key | — |

## Alternatives Considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. GitHub owns issue facts; corpus owns carriers (this decision)** | one owner per fact; nothing to reconcile; "fixed" still needs gated corpus work; corpus loses ~300 ledger rows that carried no work | network needed for every read; HTTP server needs gh credentials | **Chosen** |
| B. Keep corpus SSOT, fix bidirectional sync (paginate, reconcile both ways, make `--sync` and `--verify` agree, auto-archive mirrors on GitHub close) | offline reads keep working; zero migration | still two writable copies, now with a reconciler that must run on every machine and session to stay correct. The measured failure (188 divergences behind a "clean" sync, 157 lying drafts) is the steady state of this design, not a bug in it. A GitHub close would still have to be ratified by `lore issue resolve` on some machine, and unattended no one does. Its "no human present" answer is "drift accumulates" | Rejected: it is the superseded ADR's own rejected "bidirectional sync" option, now with data showing the cost |
| C. Keep the mirror as a read-only cache of GitHub (refreshed on read, never authoritative) | fast offline display | a cache that is shown offline is the stale fallback the decision forbids; one that is not shown offline is useless | Rejected: violates "offline is a named error" |
| D. Keep mirrors, only for adopted issues | fewer records | still a per-issue record with no work in it; adoption without a task stays the dangling case | Rejected: the adopted task **is** the record (Decision) |
| E. Self-hosted tracker behind `lore serve` | no third party | rejected in the superseded ADR for build-vs-buy; nothing changed | Rejected |

## Consequences

**Offline.** `lore issues`, `lore issue adopt|resolve`, `lore status --check-issues`, the MCP issue tools, the HTTP
`/api/issue-reports` route and the dashboard issues pages fail with the existing taxonomy (CLI exit 8/9/10/4, HTTP
401/503/429 via `middleware.ts:109-114`; any other GitHub error keeps its existing CLI exit 4 mapping), and print nothing that looks like a list. `lore done` / `lore archive` of a carrier
still succeed offline. The close is recorded as `issue_close_failed` (already exists, BR-1082) and shown as
`fixed (close pending)` once online. Plain `lore status` (no `--check-issues`) prints `issues: not checked` rather than a stale count.

**Rate limits.** Authenticated REST budget is 5000/h (measured: `gh api rate_limit` → limit 5000). A listing costs
ceil(N/100) (4 today). The migration costs roughly one read per page + one write per changed issue (estimated ≤ 400). The dashboard
must not poll: a listing is fetched on page open and on explicit refresh. Exit 10 carries the reset epoch.

**gh auth for consumers.** Unchanged for filing (BR-489..504). New: reading the list now needs gh where it previously could
fall back to `--local`. A consumer without gh can still file nothing and list nothing, loudly (exit 8, install/login hint).

**HTTP server and dashboard.** They read through the same `GitHubIntakePort` as the CLI, so the host running `lore serve` needs
`gh` logged in, or `GH_TOKEN` in its environment. BR-503 keeps ignoring the *caller's* repo/host/enterprise overrides; the repository
still comes only from project settings. A dashboard with no credential shows the 401 error state, never an empty list.

**Retired mechanisms.** `extra.issue_report` on tasks, the `resolves` link type (from `LinkType`; migration-012's SQL CHECK is
historical and not rewritten), `lore issues --local` and `--verify`, the resolution projector's computed labels
(`adopted|resolving|closed|open`), `lore issue resolve --state adopted`, the mirror minting in `report-issue-wiring.ts::mintIssueTask`
and `issue-task-shaping.ts`. Rules retired and modified: `rule-changes.json`.

**Migration.** One shipped command, `lore issues migrate [--apply]`, converts every mirror (spec.md § Migration). There is no dual-run
period. After it, any issue surface that finds a doc still carrying `extra.issue_report` refuses with exit 4 naming the command.
That is a permanent schema invariant ("the key is retired"), not a compatibility path.

## Validation Plan

1. **Non-authority of the corpus for state**: close an issue on the GitHub stub; `lore issues` shows it closed with zero corpus writes (AC-GS-2/3).
2. **Back door closed**: stub a Close-as-completed with no carrier → `closed (unverified)` + count 1. Add an archived carrier → `fixed` + count 0 (AC-GS-4).
3. **Nine states reachable**: table-driven over the status table above (AC-GS-3).
4. **Completeness**: 250-issue paginated stub with 2 PRs → 250 rows (AC-GS-1).
5. **Offline fails loud**: transport failure → exit 9, zero rows, even with carriers in the corpus (AC-GS-2).
6. **Migration is lossless**: fixture with every mirror category → after `--apply`, 0 `extra.issue_report`, 0 `resolves` links, every link's meaning recorded on a carrier or as a GitHub comment, every retired mirror audited (AC-GS-12/13).
