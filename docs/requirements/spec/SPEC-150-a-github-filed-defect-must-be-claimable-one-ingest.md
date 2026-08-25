---
id: SPEC-150
type: spec
role: spec
title: "A GitHub-filed defect must be claimable: one ingest seam turns a listed issue into a corpus task"
status: approved
priority: critical
created: 2026-08-24
updated: 2026-08-25
tags: [defect-channel, github, intake, read-side, claimable]
parent: PRD-001
links:
  - {id: SPEC-145, type: relates-to}
  - {id: SPEC-147, type: relates-to}
  - {id: SPEC-143, type: relates-to}
  - {id: ADR-037, type: relates-to}
  - {id: SPEC-145, type: implements}
---
## Overview

A defect filed into GitHub cannot be picked up. Measured 2026-08-24 on this corpus (`feedback.upstream.repo = daniel1zz/lore`, public): `lore issues` exits 4, `lore report-issue --list` exits 4, and `fileGithubIssue()` (`adapters/cli/report-issue-wiring.ts`) writes only the local v2 receipt log — it makes **no** `CorpusService` write. Since `corpus-service.ts:4487` refuses a `resolves` edge whose target is not a task carrying `extra.issue_report`, and both everyday verbs (`lore claim <task>`, `lore issue resolve <ISSUE>`) address a corpus task, a GitHub-filed defect is unclaimable and unresolvable. The channel files reports into a hole.

The everyday flow this spec is judged by is **list an open defect → CLAIM it to fix → change its state**, not "a listing renders".

Almost every part of that flow already exists and is attested. `GitHubIntakePort.listIssues()` (`service/github-intake-port.ts:344`) reads every issue in ONE `gh api` call. `parseIssueBody` (`packages/core/src/issue-front-matter.ts:197`) decodes the six closed front-matter fields. `commands/issue.ts:576-579` already reads `readGithubIssueRef(updated.extra)` after a verdict lands and pushes `resolution:<state>` back through `app.resolutionProjector`. **The missing piece is one seam**: nothing ever turns a listed GitHub issue into a corpus task carrying `extra.issue_report.github`. Supply that, and claim and status-change work with zero further code.

**THREE** refusal sites name "a later phase of `spec-the-defect-channel-reaches-no-machine-but-its-own-github`": `commands/issues.ts:329-348` (listing), `commands/report-issue.ts:318-330` (`--list`), and `adapters/mcp/tools.ts:2921-2930` — where `lore_report_issue` refuses to **file** at all under the GitHub shape, so an agent on the MCP surface has no path to a defect record whatsoever. That spec's Migration Plan stops at P5. **No phase in it ever carried either the GitHub-backed read source or the MCP filing path** — all three refusals promise a phase no spec defines. This spec is that phase, and it closes all three stubs.

⛔ The third site was found by running AC-GR-8's oracle before declaring it (measured: 5 matches, exit 1), not by reading the two sites the handoff named. Recorded because it is the reason AC-GR-8's scan covers all of `packages/lore/src` and is never narrowed to the file list this spec's own anchors happen to name — a structural AC is only as wide as the file list it greps, and deriving that list from the spec's anchors (each from the other) is how a known gap survives a green scan.

## Goals / Non-Goals

**Goals**

- G1. A GitHub-filed defect becomes a corpus task that `lore claim` and `lore issue resolve` accept unchanged.
- G2. Two concurrent sessions ingesting the same issue converge on ONE task, by a store-enforced mechanism — never by agent diligence.
- G3. The read surface never lies: a row with no corpus task is distinguishable from a row whose computed resolution is `open`.
- G4. The read surface never writes. `lore issues` stays a read; ingest happens at declared write moments only. Oracle: **AC-GR-12** — added only after `lore review` named G4 as the one goal with no falsifier, which is itself the answer to "what refuses this when it is violated?"
- G5. The corpus identity of a defect survives a GitHub repository rename.

**Non-Goals**

- N1. Bidirectional sync. GitHub-side edits stay advisory; only `lore issue resolve` ratifies a corpus verdict (unchanged from the parent spec's authority table).
- N2. Migrating the pre-GitHub local reports (D11).
- N3. Changing `daniel1zz/lore`'s visibility. It stays public; R1's redaction (`AC-GI-6`, attested) was designed for exactly that case. Deferred with that reason, not overlooked.
- N4. Mirroring GitHub comment threads.

## Scope

**In**

| Layer | Path | Change |
|---|---|---|
| core | `packages/core/src/schemas.ts` | `createDocInputSchema` gains an optional **verbatim** `slug` (D2) |
| service | `packages/lore/src/service/corpus-service.ts` | `create` uses a supplied `slug` verbatim, skipping `slugifyWithCollision`; absent → today's behaviour byte-for-byte |
| service (new, pure) | `packages/lore/src/service/issue-task-shaping.ts` | write-time: `githubIssueTaskSlug`, `toIssueTaskInput` |
| service (new, pure) | `packages/lore/src/service/github-issue-listing.ts` | read-time: `joinListing` |
| service | `packages/lore/src/service/github-intake-port.ts` | `verifyTarget` returns the repo's numeric `id` it already fetches and discards (D1) |
| service | `packages/lore/src/service/resolution-projector.ts` | `GithubIssueRef` gains `repo_id`; live calls use the CONFIGURED repo string (D9) |
| adapter | `packages/lore/src/adapters/cli/report-issue-wiring.ts` | `fileGithubIssue` also creates the corpus task (D8); new `resolveGithubIssueListing(cfg)` port seam (D5) |
| adapter | `packages/lore/src/adapters/cli/commands/issues.ts` | GitHub branch: exit-4 refusal DELETED, replaced by listing + join |
| adapter | `packages/lore/src/adapters/cli/commands/report-issue.ts` | `--list` exit-4 stub DELETED, delegates to the shared read path (D10) |
| adapter | `packages/lore/src/adapters/cli/commands/issue.ts` | new `adopt <number>` subcommand |
| adapter | `packages/lore/src/adapters/mcp/tools.ts` | `lore_report_issue` GitHub-shape refusal DELETED, wired onto the same `fileGithubIssue` the CLI uses (D12) |

**Out**

- Deleting `lore report-issue --list`. It keeps working, delegating to one read path (D10) — removing a shipped flag is a breaking change this spec does not need.
- Adding `not_ingested` to the 9-state vocabulary (D6).
- A second tracker. The `gh-` slug prefix reserves the namespace; nothing else is built for it.

## Module Boundary

- **Public API** — `issue-task-shaping.ts`: `githubIssueTaskSlug(repoId, number): Slug`, `toIssueTaskInput(issue, ref, rootPrdId): Result<CreateDocInput, LoreError>` (D13). `github-issue-listing.ts`: `joinListing(issues, ingestedTasks, currentRepoId, resolveOne): readonly GithubIssueRow[]`.
- **Internal** — front-matter → `extra.issue_report` field mapping; slug composition.
- **Dependencies** — `@lore/core` (`parseIssueBody`, `Result`, `LoreError`, `DocRecord`, `CreateDocInput`, `Slug`), and `GithubIssueRef` imported from `resolution-projector.ts` (D4). ⛔ Never `GhRunner`, `child_process`, `GitHubIntakePort`, or `CorpusService` — both modules are store-free and total, exactly like `issue-resolution.ts`.

```
commands/issues.ts ──▶ report-issue-wiring.ts::resolveGithubIssueListing ──▶ GitHubIntakePort ──▶ GhRunner
        │                                                                                          │
        ├──▶ github-issue-listing.ts::joinListing ◀── resolveOne closure ──▶ issue-resolution.ts   │
        │                                                                                          │
commands/issue.ts::adopt ──▶ issue-task-shaping.ts ──▶ CorpusService.create ──▶ store (UNIQUE slug)
        │
        └──▶ resolution-projector.ts ──────────────────────────────────────────────────────────────┘
```

No cycle: both new modules import only `@lore/core` plus a type from `resolution-projector.ts`; neither is imported by anything they import.

## Design Decisions

| # | Decision | Rationale (measured) | Trade-off |
|---|---|---|---|
| D1 | Identity = GitHub's numeric **repo id** + issue number. Slug `task-gh-<repo_id>-<number>` | `owner/repo` is mutable, and `slugSchema` is `^[a-z][a-z0-9-]{1,62}[a-z0-9]$` — no underscores, no uppercase — so sanitizing collides `owner_a/repo` with `owner-a/repo`. `verifyTarget()` ALREADY calls `gh api repos/${repo}` and discards the payload, so the id costs zero extra calls | Slug is opaque; readability moves to the doc title, and `extra.issue_report.github.repo` keeps the string for display |
| D2 | Idempotency via a **verbatim** optional `slug` on `createDocInputSchema` + the store's UNIQUE index | `create` always calls `slugifyWithCollision`, which appends `-2` on collision — aliasing, not convergence — and ignores any caller slug (`slug` is on `docPatchSchema:787`, absent from create input). `docs.slug` IS UNIQUE and maps to a typed `DUPLICATE_SLUG` (`sqlite-store.ts:556`, `turso-store.ts:690`). Making that the sole arbiter means the losing concurrent writer gets a refusal and recovers the winner by RE-DERIVING the deterministic slug — ⛔ NOT via the error's `existing_id`, which is a false label; see Review Revisions round 4 | Touches a core write path every caller shares; the field is additive and optional |
| D3 | TWO pure modules, split by lifecycle moment | `toIssueTaskInput`/`githubIssueTaskSlug` run at filing/adopt time; `joinListing` runs at read time. No shared state, no shared caller. Matches this repo's own split of `issue-resolution.ts` (compute) vs `resolution-projector.ts` (project) over the same `extra.issue_report` bag | One more file and import per call site |
| D4 | `GithubIssueRef` (`resolution-projector.ts:110`) is imported, never re-derived | The writer becomes type-linked to `readGithubIssueRef`, its canonical reader, instead of agreeing on an untyped shape by convention | A write-time module depends on a type declared in a projection module |
| D5 | ONE port-construction seam, `resolveGithubIssueListing(cfg)` | Three read sites would each construct `GhRunner` + `GitHubIntakePort` — the exact duplication `classifyFeedbackUpstream` exists to prevent | One more wiring export |
| D6 | `not_ingested` stays OUT of `IssueResolution` | The vocabulary is derived from `extra` on a REAL task; `not_ingested` describes the ABSENCE of one. Adding it breaks `issue-resolution-vocab.ts`'s SSOT invariant (exactly one array literal constructs the members) and adds switch arms nothing can reach | The read surface carries a row-kind the resolution vocabulary does not |
| D7 | The read path NEVER writes (CQS) | If `lore issues` ingested, two sessions polling it would race to mint one task. Under the North Star's many-concurrent-sessions target that is the normal case, not an edge case | An issue filed elsewhere needs one explicit `adopt` before it is claimable |
| D8 | A GitHub filing that lands while the corpus write fails MUST name the filed number and URL | Mirrors `github-intake-port.ts:320-330`'s existing STORE_ERROR for the receipt-log half ("the upstream issue itself was NOT lost") — the same split, so the same honesty | The caller must handle a partial-success error shape |
| D9 | Live GitHub calls use the CONFIGURED repo string; the stored one is provenance only | Latent rename defect in existing code: `readGithubIssueRef` returns the STORED `{repo, number}` and `ResolutionProjector` calls GitHub with it, so after a rename it is stale | The ref carries two repo facts with different authorities |
| D10 | `report-issue --list` delegates to the shared read path | An exit-4 stub promising an undefined phase is precisely the falsehood this spec exists to remove; deleting a shipped flag is a needless break | Two verbs reach one listing |
| D11 | The 34 pre-GitHub local reports (27 of them open) stay local-only, permanently, un-backfilled | Measured: `lore issues --local --all` totals 34 and `--open` totals 27, and all 34 migration candidates skip for missing `reporter_corpus`/`reporter_root_prd`/`tags`. Those are PROVENANCE fields never observed for them; filling them from today's environment mints a fabricated origin — a corpus that lies. They stay reachable via `lore issues --local` | The GitHub listing is not a census of all defects, and must say so (AC-GR-10) |
| D12 | MCP `lore_report_issue` is wired onto the SAME `fileGithubIssue` the CLI calls — never a second filing path | Its refusal (`tools.ts:2921-2930`) promises the same undefined phase, and with D8 minting the corpus task inside `fileGithubIssue`, leaving MCP refused means the MCP surface has no path to a CLAIMABLE defect. One call site, so the corpus write cannot be present on one surface and absent on its neighbour — the failure mode this repo already measured once, where the second copy had silently drifted because nothing compared them | The MCP handler must resolve an actor explicitly (SPEC-025 precedent: MCP requires `by`, the CLI falls back) |
| D13 | The minted task is **adhoc** — `extra.adhoc = true`, NO `extra.plan_id`, and `parent_id` **OMITTED ENTIRELY** so `CorpusService._createImpl`'s adhoc branch resolves it to the root PRD — never a plan member | Measured 2026-08-24: all 6 sampled pre-existing issue-report tasks carry `adhoc=true`, `plan_id=None`, `parent=prd`. That is the shape `lore issues --local` and `computeIssueResolution` already read, so a plan-parented defect would be a SECOND shape for one concept. A filed defect has no plan by definition — it arrives before anyone decides who owns it, which is what `lore issue resolve --state adopted --adopted-by <plan\|task>` exists to record later | `toIssueTaskInput` cannot take a `planId`, so its signature loses that parameter; an adhoc task also needs an explicit (possibly empty) `ac_scope` |

## Perspective Tensions Resolved

| Tension | Perspectives | Resolution | Why |
|---|---|---|---|
| One `github-issue-ingest.ts` vs two modules | Cohesion (split) vs Coupling (one seam is simpler) | Split (D3) | The two halves share no state and no caller; the repo's own precedent is one file per lifecycle moment |
| Deterministic slug from `owner/repo` vs numeric id | Reuse (rename-proof) vs addressability (readable slug) | Numeric id (D1) | A rename silently reclassifies an ingested issue as `not_ingested` and re-mints a duplicate. Readability is recoverable from the title; identity is not recoverable at all |
| Verbatim slug on a core schema vs adapter-local dedup | Coupling+Cohesion+Reuse+Testing all chose the schema | D2 | Only the store-enforced option has a deterministic "exactly one task" oracle; the alternatives are flaky-by-construction or leave orphans with no cleanup oracle |
| `resolveOne` callback vs importing `computeIssueResolution` | Coupling (inversion) vs Cohesion (fewer seams) | Keep the callback | `computeIssueResolution` needs store-fetched `resolvesInEdges`/`sourceDocs`; a store-free joiner cannot gather them |

## Review Revisions — round 2

Recorded per the discipline that a criterion or interface changed after it was written must carry its reason, its measurement, and why it is a correction rather than a weakening.

7. **`toIssueTaskInput`'s signature took a `planId` the real shape has no room for.** Round 1's Module Boundary was derived from `createDocInputSchema`'s GENERAL task rule (a `task` requires `parent_id` and `extra.plan_id`) rather than from how issue reports are actually created. Measured after P1 had already landed the interface: every sampled pre-existing issue-report task is `adhoc=true` / `plan_id=None` / `parent=prd`. The signature is corrected to `toIssueTaskInput(issue, ref, rootPrdId)` and the shape is pinned as **D13**.

⛔ This is a CORRECTION, not a weakening, and the distinction is checkable rather than asserted: no acceptance criterion loosened. AC-GR-5 and AC-GR-6 — both already attested — are untouched, because neither asserts anything about the minted document's parentage. What the change does is make **AC-GR-9** satisfiable at all: a task minted with a fabricated `plan_id` would either be refused at creation or be unclaimable, so the real-CLI oracle would have gone red at P2 regardless. The spec was wrong; the oracle was right.

⛔ Named as a design gap this round did NOT close: no AC asserts the minted task's document SHAPE directly. AC-GR-9 catches a wrong shape only indirectly, by failing to claim. A reader should not mistake "AC-GR-9 is green" for "the adhoc shape is asserted".

## Review Revisions — round 3

8. **D13 said "parented to the ROOT PRD", which reads as an instruction to SET `parent_id`. Doing that fails.** Measured live during P2 (reproduced through the AC-GR-9 e2e, not reasoned): `PARENT_TYPE_CONTRACT.task = ["plan"]` (`packages/core/src/doc-type-rules.ts:13`), and the general parent-type validation fires whenever `CreateDocInput.parent_id` is present at all. The root-PRD parentage is reached ONLY through `_createImpl`'s SPEC-069 adhoc branch, which requires `parent_id === undefined` — `packages/core/src/schemas.ts:650-665` relaxes the *requirement* for an adhoc task but never widens the *contract*. So an explicit `parent_id: <root prd>` returns `INVALID_PARENT_TYPE`. D13 now says OMITTED.

⛔ A correction, not a weakening, and again checkable: no AC changed, and AC-GR-9 is what CAUGHT it — the real-CLI oracle went red with `INVALID_PARENT_TYPE` on the spec-as-written. Twice now (round 2 and round 3) a surface AC has corrected this spec's own prose about the corpus write. That is the argument for surface ACs, stated once here rather than re-derived: `parent_id` and `extra.plan_id` are two different fields with two different relaxation rules, and no amount of reading the schema substituted for driving the CLI.

⛔ Residual, recorded not fixed: `toIssueTaskInput`'s `rootPrdId` parameter is now a PRECONDITION GUARD that never reaches the output. Its caller `fileGithubIssue` already refuses a corpus with no root PRD, so the same precondition is asserted in two places. Deliberate (a pure function defending its own contract) but redundant; noted so a future reader does not mistake the parameter for the thing that sets the parent.

## Review Revisions — round 4

9. **D2 said the loser "reads the winner back". Measured during P4: it cannot, through the field whose name promises exactly that.** `SQLiteStore` (`store/sqlite-store.ts:~556`) and `TursoStore` (four insert sites) construct `DUPLICATE_SLUG` with `existing_id: doc.id` — the id of the NEW doc that was just REJECTED and therefore never persisted. `InMemoryStore` (`store/in-memory-store.ts:93`) gets it right, resolving the conflicting doc through `findSlugConflict`. Reproduced during `lore issue adopt`'s implementation: `corpusService.get(error.existing_id)` returns `DOC_NOT_FOUND` every time.

⛔ This is a **false label** in the North Star's exact sense — the field name asserts "the id of the doc that already holds this slug" and the value is an id that exists nowhere. ⛔ Nothing catches it, and the reason is structural: the two stores that get it wrong are the two needing a real database, and the one that gets it right is the test double every unit test uses.

D2's convergence mechanism still HOLDS — the UNIQUE index is still the sole arbiter, and the loser is refused rather than aliased. Only the RECOVERY step changes: the caller re-derives `githubIssueTaskSlug(repo_id, number)`, which it already knows. `lore issue adopt`'s idempotent path does exactly that, with the measurement recorded at its call site.

⛔ The store defect is NOT fixed here — it is a shared write path far outside these anchors, routed to its own task. Recorded because D2's original wording, left standing, would send the next implementer to a field that returns nothing.

## Vacuous-Pass Traps (closed by construction)

Two empty sets would make a naive end-to-end assertion pass while proving nothing, both measured today:

1. `gh api 'repos/daniel1zz/lore/issues?state=all&per_page=100' --jq length` → **0**. Any AC over the live repo asserts nothing. ⇒ every surface AC seeds a stub `gh` on `PATH` returning a fixed 3-issue payload and asserts the ROW COUNT, so an empty listing fails.
2. A fresh corpus has zero ingested tasks, so `joinListing` returning all-`not_ingested` satisfies "a listing renders". ⇒ AC-GR-2 seeds 3 issues of which exactly 1 is ingested and asserts BOTH row kinds appear.

## Acceptance Criteria

Structured criteria are declared via `lore ac add`; the prose below states each one's intent. ⛔ Every AC naming the CLI drives the REAL CLI and measures its exit code — a service-layer unit test may never stand in for a surface claim. The live counter-example this rule comes from: `AC-GI-12` is green on a vitest unit test over `GitHubIntakePort` while `lore issues` exits 4 on the same config.

- **AC-GR-1** Read surface reaches GitHub: with a stub `gh` returning 3 issues, real `lore issues` in a throwaway GitHub-configured corpus exits **0** and prints exactly 3 rows. *Falsifier: restore the `classification.kind === "github"` refusal → exit 4.*
- **AC-GR-2** Rendering is injective: of 3 seeded issues exactly 1 is ingested; the output prints that row's computed resolution and the other 2 under a token that is NOT any member of `IssueResolution`. *Falsifier: render `not_ingested` as `open` → the two tokens collide.*
- **AC-GR-3** The everyday bar, end to end: seed an issue → real `lore issue adopt <n>` exit 0 → real `lore claim <task>` exit 0 → real `lore issue resolve <task> --state wontfix --reason …` exit 0, and the stub `gh` records a `resolution:wontfix` label write for that number. *Falsifier: drop the `extra.issue_report.github` write → the projector has no ref → no label write.*
- **AC-GR-4** Concurrency converges: two simultaneous `create` calls carrying the same verbatim slug against one SQLite file yield exactly **1** task, the loser getting `DUPLICATE_SLUG`. *Falsifier: remove the verbatim-slug path so `slugifyWithCollision` runs → 2 tasks.* (`.bun.test.ts` — needs `bun:sqlite`.)
- **AC-GR-5** Identity survives a rename: a listing whose `owner/repo` differs from the stored string but whose repo id matches still joins as `ingested`. *Falsifier: key the join on the repo string → the row flips to `not_ingested`.*
- **AC-GR-6** The slug function is total and injective over GitHub's namespace: a property test asserts every output satisfies `slugSchema` and that no two distinct `(repo_id, number)` pairs collide. *Falsifier: key on a sanitized `owner/repo` → `owner_a/repo` and `owner-a/repo` collide.*
- **AC-GR-7** A partial success is named: when the corpus write fails after a successful filing, the error message contains BOTH the issue number and its URL. *Falsifier: a generic store-error message.*
- **AC-GR-8** No stub survives: a case-sensitive literal scan of `packages/lore/src` finds zero occurrences of the GitHub-shape refusal wording ("is not yet supported", "a later phase of spec-the-defect-channel-reaches"). *Falsifier: leave either refusal in place.*
- **AC-GR-9** Filing makes it claimable with no extra command: real `lore report-issue` against the stub `gh`, then real `lore claim` on the derived slug, exits 0. *Falsifier: remove the corpus create from `fileGithubIssue` → the slug resolves to nothing.*
- **AC-GR-12** The read path never writes (G4's oracle): against a corpus holding 3 un-ingested GitHub issues, the count of tasks carrying `extra.issue_report` and every target doc's version-log row count are byte-equal before and after a real `lore issues` run. *Falsifier: have the read path create a task for an un-ingested row → the count rises 0 → 3.*
- **AC-GR-11** The MCP surface files and lands a claimable task: the `lore_report_issue` handler, obtained through the REAL tool-registration entry point (never a re-instantiated copy of its logic), returns a success payload naming the created corpus task's slug under a GitHub-shaped `feedback.upstream`. ⛔ Stated limit, not papered over: this drives the registered handler, not a spawned stdio server — no MCP stdio harness exists in this repo (`tests/unit/adapters/mcp-*.test.ts` all call handlers directly), so the widest available driving is the registration path. *Falsifier: restore the `isGithubUpstreamCfg(cfg)` refusal branch → the payload becomes the refusal error.*
- **AC-GR-10** The GitHub listing is not a census of all defects: with 27 local reports present and 3 seeded GitHub issues, `lore issues` (GitHub shape) prints exactly 3 rows and names the `--local` boundary. *Falsifier: union the two sources → 30 rows.*

## Review Revisions — round 1

Recorded per the discipline that a criterion changed after it was written must carry its reason. All six were raised by `lore review` on v3, **before any AC carried evidence** — none is a post-red weakening.

1. **G4 had no oracle.** "The read surface never writes" was argued in D7 and asserted nowhere: no AC falsified a regression where the read path silently ingests. Added **AC-GR-12** rather than reworded — the gap was a missing falsifier, not unclear prose.
2. **AC-GR-8's needle was reader-supplied.** The AC said "the GitHub-shape refusal wording" without quoting it, so two implementers could scan for different substrings and both go green, and the recorded 5-match figure was not reproducible from the AC text. Both literals are now pinned verbatim in the statement.
3. **AC-GR-10's "names the boundary" had no oracle.** A bare `--local`, a sentence, or an omitted-row count would all pass or fail by reader. Pinned to one exact required substring, which thereby becomes that line's wording SSOT.
4. **AC-GR-11 named no discriminator** for "the real registration entry point", so a handler reconstructed from the same module could satisfy a literal reading. Now names `registerTools` (`adapters/mcp/tools.ts:1434`).
5. **D11 mixed two figures** — "27 local reports" against "34 of 34 candidates". Reconciled by measurement: 34 total, 27 open, all 34 unmigratable.
6. **D12 preceded D11** in the table, breaking the D8→D12 partial-success chain. Reordered.

## Downstream Handoff

- **implement** — interfaces are in Module Boundary; no new dependency. `exactOptionalPropertyTypes: true` (omit keys, never `{k: undefined}`); intra-package imports are relative `.js`; `@lore/core`'s default barrel stays browser-safe.
- **test harness — reuse these, do not reinvent** (measured precedent, `tests/integration/cli/github-intake-reach.bun.test.ts`):
  - Surface ACs spawn the COMPILED `dist/lore` via `Bun.spawnSync`, and MUST call `assertFreshBinary(binPath, srcDirs)` (`tests/integration/helpers/assert-fresh-binary.ts`) first — without it a stale binary yields a verdict about code that is not under test.
  - ⛔ A NEW **payload-serving** gh stub is required; `healthyGhStubDir()` (`tests/integration/helpers/healthy-gh-stub.ts`) is `#!/bin/sh\nexit 0` with EMPTY stdout by design (its only consumer, `runGitHubHealthCheck`, inspects exit codes only). Reusing it makes `listIssues()` parse empty stdout into a `VALIDATION_ERROR` — a FALSE red that looks like a real failure. Add a sibling helper serving fixtures for `api user`, `api repos/<repo>` (including the numeric `id` D1 needs) and `api repos/<repo>/issues?...`; ⛔ do not widen the memoized `healthyGhStubDir`, whose current consumers depend on its silence.
  - Every surface AC seeds a THROWAWAY corpus (`mkdtemp` + `lore init`, cwd inside it) and never the repo's own `.lore/`.
- **test** — invariants: exactly-one-task under concurrent ingest; injective rendering; slug totality. `.bun.test.ts` for anything touching `bun:sqlite`; every surface claim drives the real CLI. A vitest run never proves a symbol is exported unless the test CALLS it.
- **deploy** — no env var, no migration. `dist/lore` must be rebuilt after merge (`hooks/pre-push --check-binary-provenance` blocks on a binary older than HEAD).

## Quality Gates

- [x] No circular dependencies — both new modules import only `@lore/core` + one type from `resolution-projector.ts`; neither is imported by what it imports.
- [x] Every module has a single clear responsibility — split by lifecycle moment (D3).
- [x] Public API sufficient for black-box testing — both modules are pure and total; every AC above is expressible against them or the real CLI.
- [x] Dependencies injectable — the listing arrives as an argument; `resolveOne` is a caller-supplied closure; no concrete GitHub client is imported.


## Acceptance Criteria (structured)

- [⚑] [script] AC-GR-1: Read surface reaches GitHub: with a payload-serving gh stub returning exactly 3 issues, the REAL compiled dist/lore 'issues' in a throwaway GitHub-configured corpus exits 0 and prints exactly 3 rows. Covered by describe 'AC-GR-1: lore issues reaches the GitHub shape'. Falsifier: restore the classification.kind === github refusal in commands/issues.ts and the exit becomes 4.
  script: e2e — bun test packages/lore/tests/integration/cli/github-issue-read-surface.bun.test.ts -t 'AC-GR-1' 2>&1 && echo 'AC-GR-1 PASS: real dist/lore issues exits 0 and prints exactly 3 rows against a 3-issue gh stub'
- [⚑] [script] AC-GR-2: Rendering is injective: of 3 seeded issues exactly 1 is already ingested as a corpus task; the output prints that row's computed resolution AND prints the other 2 under a token that is not any member of IssueResolution. Covered by describe 'AC-GR-2: not_ingested renders distinguishably from open'. Falsifier: render the not_ingested kind as 'open' and the two tokens collide.
  script: e2e — bun test packages/lore/tests/integration/cli/github-issue-read-surface.bun.test.ts -t 'AC-GR-2' 2>&1 && echo 'AC-GR-2 PASS: an un-ingested row and a computed-open row render as different tokens'
- [⚑] [script] AC-GR-3: The everyday bar end to end: seed one GitHub issue, then real dist/lore 'issue adopt <n>' exits 0, real dist/lore 'claim <task>' exits 0, real dist/lore 'issue resolve <task> --state wontfix --reason ...' exits 0, and the gh stub records a resolution:wontfix label write for that issue number. Covered by describe 'AC-GR-3: adopt then claim then resolve round-trips the label'. Falsifier: drop the extra.issue_report.github write from toIssueTaskInput and no label write is recorded.
  script: e2e — bun test packages/lore/tests/integration/cli/github-defect-claim-lifecycle.bun.test.ts -t 'AC-GR-3' 2>&1 && echo 'AC-GR-3 PASS: a GitHub-filed defect was adopted, claimed, resolved, and its label round-tripped'
- [⚑] [script] AC-GR-4: Concurrency converges on ONE task, with the interleaving PINNED so two sequential calls cannot satisfy the text: bun:sqlite writes are synchronous, so a genuine race needs SEPARATE PROCESSES — the mechanism this repo's 'many concurrent sessions' target actually means. The test spawns TWO child processes via Bun.spawn, each opening its own SQLiteStore on the SAME db file and each attempting CorpusService.create with the SAME verbatim slug, released together off a shared barrier file, repeated for 20 iterations with a fresh slug per iteration. Per iteration it asserts EXACTLY 1 doc carries that slug, EXACTLY 1 process exited ok, and the loser's error code is EXACTLY DUPLICATE_SLUG — never a -2 aliased slug and never a generic STORE_ERROR. Falsifier: remove the verbatim-slug path so slugifyWithCollision runs, and the per-iteration doc count becomes 2 with zero DUPLICATE_SLUG.
  script: test — bun test packages/lore/tests/unit/store/verbatim-slug-concurrency.bun.test.ts 2>&1 && echo 'AC-GR-4 PASS: two concurrent verbatim-slug creates yield exactly 1 task and one DUPLICATE_SLUG'
- [⚑] [script] AC-GR-5: Identity survives a repository rename: a listing whose owner/repo string differs from the string stored on the ingested task, but whose numeric repo id matches, still joins as ingested. Falsifier: key the join on the repo string and the row flips to not_ingested.
  script: test — bunx vitest run packages/lore/tests/unit/service/github-issue-listing.test.ts 2>&1 && echo 'AC-GR-5 PASS: a renamed repo still joins by numeric repo id, not by the stored owner/repo string'
- [⚑] [script] AC-GR-6: The slug function is total and injective over GitHub's namespace, with the search space PINNED so a 10-case run cannot claim what a 10000-case run proves: a property test generates AT LEAST 1000 cases with repo_id drawn from [1, 2^53-1] and issue number from [1, 10^6], asserting every githubIssueTaskSlug output satisfies slugSchema (^[a-z][a-z0-9-]{1,62}[a-z0-9]$, 3-64 chars) and that no two distinct (repo_id, number) pairs collide. It ADDITIONALLY asserts the two adversarial repo names the rejected owner/repo design collided on — owner_a/repo and owner-a/repo, distinct repositories on GitHub that any underscore-to-hyphen sanitizer maps together — now yield distinct slugs, since they carry distinct repo ids. Falsifier: key the slug on a sanitized owner/repo and that named pair collides.
  script: test — bunx vitest run packages/lore/tests/unit/service/issue-task-shaping.test.ts 2>&1 && echo 'AC-GR-6 PASS: githubIssueTaskSlug is total against slugSchema and injective over (repo_id, number)'
- [⚑] [script] AC-GR-7: A partial success is named, never generic: when the corpus write fails after the GitHub filing already landed, the returned error message contains BOTH the filed issue number and its URL. Falsifier: emit a generic store-error message and the assertion on those two substrings fails.
  script: test — bunx vitest run packages/lore/tests/unit/service/github-filing-split-write.test.ts 2>&1 && echo 'AC-GR-7 PASS: a corpus-write failure after a landed filing names the issue number and URL'
- [⚑] [script] AC-GR-8: No refusal stub survives on any surface — TWO conjuncts, because the single-conjunct form was measured VACUOUS. (a) STRUCTURAL, unchanged: a CASE-SENSITIVE scan of packages/lore/src finds zero occurrences of 'is not yet supported' or 'a later phase of spec-the-defect-channel-reaches'. (b) BEHAVIOURAL, added 2026-08-25: against a GitHub-configured upstream with a payload gh stub, EACH of --open, --resolved, --all, --severity, --category and --verify makes 'lore issues' exit 0 — not 4. ⛔ WHY (b) EXISTS, recorded rather than quietly patched: conjunct (a) reported 0 while commands/issues.ts:482 still refused those six flags with exit 4. The surviving refusal reads 'are not yet supported by' (plural) and cites 'a later phase of spec-a-github-filed-defect-must-be-claimable' — a DIFFERENT spec — so it matched neither pinned needle. The AC's own residual note had anticipated the generic needle firing on unrelated future text; it did NOT anticipate a REWORDED refusal evading it, which is the direction that actually happened. ⛔ A substring scan can only ever falsify the wordings its author imagined; only a behavioural conjunct measures the property. ⛔ The refusal it missed cited a later phase of THIS spec, which declares no such phase — the exact falsehood this spec's Overview exists to condemn, reproduced by it.
  script: lint — c=$(grep -rn --include='*.ts' -e 'is not yet supported' -e 'a later phase of spec-the-defect-channel-reaches' packages/lore/src | wc -l | tr -d ' '); test "$c" = '0' && bun test packages/lore/tests/integration/cli/github-issue-read-surface.bun.test.ts -t 'AC-GR-8' 2>&1 && echo 'AC-GR-8 PASS: 0 refusal stubs by scan AND all six read flags exit 0 against a stubbed GitHub upstream'
- [⚑] [script] AC-GR-9: Filing makes a defect claimable with no extra command: real dist/lore 'report-issue' against the gh stub, then real dist/lore 'claim' on the deterministic derived slug, exits 0. Covered by describe 'AC-GR-9: filing alone makes the defect claimable'. Falsifier: remove the corpus create from fileGithubIssue and the slug resolves to nothing, so claim exits nonzero.
  script: e2e — bun test packages/lore/tests/integration/cli/github-defect-claim-lifecycle.bun.test.ts -t 'AC-GR-9' 2>&1 && echo 'AC-GR-9 PASS: a report filed through the CLI is claimable with no adopt step'
- [⚑] [script] AC-GR-10: The GitHub listing is not a census of all defects: with local-only pre-GitHub reports present in the same corpus AND 3 seeded GitHub issues, the GitHub-shape listing prints EXACTLY 3 rows and its output contains the PINNED literal boundary line "pre-GitHub local-only reports are not listed here (see 'lore issues --local')" — pinned so 'names the boundary' is a substring assertion, not a reader's judgment. Covered by describe 'AC-GR-10: the GitHub listing excludes local-only reports and says so'. Falsifier: union the two sources and the row count exceeds 3; or drop the boundary line and the substring assertion fails.
  script: e2e — bun test packages/lore/tests/integration/cli/github-issue-read-surface.bun.test.ts -t 'AC-GR-10' 2>&1 && echo 'AC-GR-10 PASS: the GitHub listing shows only the 3 GitHub issues and names the --local boundary'
- [⚑] [script] AC-GR-11: The MCP surface files and lands a claimable task: the test MUST obtain the handler by importing 'registerTools' (packages/lore/src/adapters/mcp/tools.ts:1434) and registering against a real McpServer — naming the symbol so a handler reconstructed from the same module cannot satisfy a literal reading — and the lore_report_issue handler then returns a success payload naming the created corpus task's slug under a GitHub-shaped feedback.upstream. Stated limit, not papered over: this drives the REGISTERED handler, not a spawned stdio server, because this repo has no MCP stdio harness (every tests/unit/adapters/mcp-*.test.ts calls handlers via registerTools). Falsifier: restore the isGithubUpstreamCfg refusal branch in adapters/mcp/tools.ts and the payload becomes the refusal error.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-github-filing.test.ts 2>&1 && echo 'AC-GR-11 PASS: the registered lore_report_issue handler files under the GitHub shape and names the created task slug'
- [⚑] [script] AC-GR-12: The read path never writes (G4's oracle, absent until the review named the gap): against a corpus holding 3 un-ingested GitHub issues, the count of corpus tasks carrying extra.issue_report and the target docs' version-log row counts are BYTE-EQUAL before and after a real dist/lore 'issues' run. Covered by describe 'AC-GR-12: lore issues mutates nothing'. Falsifier: have the read path call CorpusService.create for an un-ingested row and the task count rises from 0 to 3.
  script: e2e — bun test packages/lore/tests/integration/cli/github-issue-read-surface.bun.test.ts -t 'AC-GR-12' 2>&1 && echo 'AC-GR-12 PASS: a real lore issues run left the task count and every version log unchanged'

## Code anchors

- packages/lore/src/service/issue-task-shaping.ts#toIssueTaskInput
- packages/lore/src/service/github-issue-listing.ts#joinListing
- packages/lore/src/adapters/cli/report-issue-wiring.ts#resolveGithubIssueListing
- packages/lore/src/adapters/cli/commands/issues.ts
- packages/lore/src/adapters/cli/commands/issue.ts
- packages/lore/src/adapters/mcp/tools.ts
- packages/core/src/schemas.ts
