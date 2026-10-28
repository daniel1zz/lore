---
id: SPEC-252
type: spec
role: spec
title: "Write provenance: every record names the build that wrote it, and an audit groups records by build"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-28
tags: []
links:
  - {id: SPEC-134, type: relates-to}
---
# Write provenance: every record names the build that wrote it, and an audit groups records by build

## Overview/Goal

An audit must be able to tell a record written by today's lore from one written by a build whose defect is already fixed. Today it cannot: no record carries the build that wrote it, and no issue carries the builds it affects, so old defect output pollutes every audit as if it were new, and the records a known defect corrupted are not singled out although gates still read them.

Decision record: `adr-every-corpus-write-names-the-lore-build-that-made-it-issues` (its D1–D7, benchmarks, rejected options); this spec's own Design Decisions are D1–D6 below. User decisions 2026-10-26: build identity is the commit sha; source and dirty runs may write but are marked; rows written before this change are grouped `unstamped` and their build is never inferred; those rows additionally get a time-based estimate per fixed issue, labelled as such and kept out of every group (decision after approval, spec reopened at v50).

**Why (measured 2026-10-26 on this repo's corpus)**: `scripts/build.ts` embeds `build_commit`/`build_dirty`/`built_at` into the binary but only `lore status --check-binary-provenance` reads it; `audit` (76,490 rows), `versions` (61,011), `decision_log` (643) and `review_judgments` (2,067) carry no build; `package.json` is `0.1.0`, never bumped; issue #456's body names no version.

**Baseline**: change set on `baseline-query-the-audit-trail`, `baseline-file-a-defect-report`, `baseline-resolve-a-defect-report` (`lore rule changes` on this spec). BR-494 (field block contents) also needs a `modify`; it is held by the unlanded change set of `spec-a-defect-report-states-its-mechanism-or-is-marked-symptom` (linked `blocks`), so that modify is added when that spec lands, before this spec's change set is applied.

## Scope

1. **Build registry.** Migration 039 adds `builds(id TEXT PK, commit, dirty, run_kind, schema_version, assets_hash, first_seen_at)`. `id` = sha256 of the canonical JSON of the five identity fields, so every replica derives the same id. A process registers its build on its first write with `INSERT OR IGNORE`.
   - `compiled`: commit and dirty from the embedded build provenance (`binary-provenance.ts::readEmbeddedBuildProvenance`).
   - `source` (`bun run dev`, tests): commit = `git rev-parse HEAD` and dirty = `git status --porcelain` non-empty, both run in lore's own source root (the repository containing the entry module), never the process cwd. Read once per process.
   - `unknown`: neither readable. `commit` holds the literal `unknown`; never NULL or empty.
2. **Stamping.** `build_id TEXT` on `audit`, `versions`, `decision_log`, `review_judgments`. Each store implementation (SQLite, Turso, InMemory) is constructed with the process's build and binds `build_id` on every insert into these tables, including the rule-registry version rows built inside the store and rows inserted by later migrations. This sits beside the existing `harness_run` stamping at the `write-context-store.ts` chokepoint, but at the store level so an unwrapped store stamps too.
3. **Unstamped writes are counted, not refused.** No trigger: a binary built before this change can still write to an upgraded corpus, and those rows carry NULL `build_id`. They are never hidden: the audit by build reports, per table, `unstamped_after_start` — NULL-build rows whose own time column (audit `timestamp`, versions `created_at`, decision_log `ts`, review_judgments `created_at`) is at or after this corpus's provenance start, the earliest `builds.first_seen_at`. A non-zero count is the trace of an old binary still writing. Missed insert sites in this codebase are refused by AC-WP-1 (zero NULL rows after the full write matrix on every store).
4. **Chain.** `canonicalAuditPayload` (an object) includes `build_id` as a key only when the row carries one. `computeDecisionEntryHash` (a positional array) appends `[detail ?? null, build_id]` when `build_id` is present and is unchanged otherwise, so `detail` and `build_id` can never occupy the same slot. Rows written before this change hash byte-identically. `versions` and `review_judgments` are not chained (see Known limits).
5. **found_in.** `issue-front-matter.ts`'s strict field schema gains an optional `found_in: {commit, dirty, run_kind}`; `lore report-issue` fills it from the reporting process's build. Bodies without it still parse.
6. **fixed_in.** When lore closes an issue as completed — the archive path or the `lore issues --sync` repair path — the closing comment adds `fixed_in: <landing.branch_head> (landed as <landing.landing_commit>)` from the archived task. A task with no landing, or a plan carrier (plans record no landing), adds `fixed_in: unknown (no landing recorded on <slug>)`.
7. **Taint declaration.** `extra.taints[]` on a task that names at least one issue. Each entry is `<table>:<field>=<value>`; table ∈ {audit, versions, decision_log, review_judgments}; field allow-list: audit `action`; versions `action`, `doc_type` (resolved by joining `docs.type`); decision_log `class`; review_judgments `kind`, `decision`. Validated in `CorpusService` for every write path (CLI, MCP, HTTP, batch, `lore set`), like `extra.issues`. Refused: bare table or unlisted table/field (exit 2), a task naming no issue (exit 4), any change once the task is archived (exit 4). Commands: `lore taint add|rm|list`.
8. **Replication.** `sync-push.ts::REPLICATED_TABLES` gains `builds`, ordered before `versions` and `audit`, so every pushed `build_id` has its `builds` row on the remote. The push report's per-table reconciliation covers it. `decision_log` and `review_judgments` are not replicated today and stay unreplicated (out of scope); an audit by build on a remote covers only what it holds. NULL-build rows push like any other row.
9. **Audit by build.** `lore audit --by-build [--since <iso>] [--lore-repo <path>] [--json]`. `--since` filters on each table's own time column. "Lore's history" = a git repository (default: cwd) containing lore's root commit `0040ec74669e34833dda001e1ac35c7ff4720b31` in which every `fixed_in` of an archived taint-declaring task resolves; anything else is refused with exit 4 naming the path or the commit, and no group is printed. Each row lands in exactly one group, evaluated in this order:
   1. `unstamped`: `build_id` NULL.
   2. `uncertain` (no history check possible): the `build_id` has no `builds` row in this corpus, or the build commit is the literal `unknown`, or does not resolve in lore's history (each named in `uncertain_commits` with its reason). Git is never run on `unknown`; this test precedes every ancestry call.
   3. `known-defect`: for some archived taint-declaring task, neither its `branch_head` nor its `landing_commit` is an ancestor-or-equal of the build commit (`git merge-base --is-ancestor <fix> <build>` exits 1 for both) AND the row matches one of that task's taints. Applies to compiled, source and dirty builds alike: a dirty or source build at a commit lacking the fix lacks it too.
   4. `uncertain`: dirty or `source` build not caught by rule 3.
   5. `current`: every other row.
   Output: per-group counts, their sum and the rows read (equal); `known_defect_by_issue` (a row matching two issues is listed under both, counted once in the group); `needs_reverification` (every known-defect row); `fixed_in_unknown` (issues whose task has taints but no landing; they exclude nothing); `unstamped_after_start` per table with the provenance start it was measured against (a part of `unstamped`, not a fifth group); `estimated_by_time` (below). Row keys: audit `id`, versions `<doc_id>:<version>`, decision_log `id`, review_judgments `id`. Ancestry results are cached per (fix, build) pair within one run.

10. **Time-based estimate for unstamped rows.** So that today's corpus, written before any build was recorded, can also be audited per issue: for each archived taint-declaring task with a landing, `estimated_by_time` lists the `unstamped` rows that match one of its taints and whose own time column is before `extra.landing.recorded_at`. Each entry carries `{repo_id, number, task, landed_at, basis: "time", count, rows: [{table, key}]}`. The estimate never moves a row into another group and never changes any group count; the human output prints it under its own heading `Estimated by time (not proven)`. A task without a landing contributes no estimate.

## Non-functional

| Concern | Response |
|---|---|
| Write-path cost | One extra TEXT bind per insert; one `INSERT OR IGNORE` into `builds` per process. Compiled runs do no git work; source runs do two git calls once per process |
| Size | ≈64 bytes per new row; all 140k existing fact rows stamped would be ≈9 MB against a 2.5 GB file |
| Audit cost | One `git merge-base --is-ancestor` per distinct (fix, build) pair, cached per run; distinct builds are few |
| Migration | `ADD COLUMN` (nullable) ×4, `CREATE TABLE builds`: metadata-only on SQLite, no row rewrite; runs only through `lore migrate schema`, the same path migration 038 used, which is also how Turso replicas receive it |
| Concurrency | `builds.id` is content-derived and inserted with `INSERT OR IGNORE`, so two sessions with one build converge on one row; taint writes are ordinary versioned doc writes |
| Rollback | None needed for readers or writers: the nullable columns and `builds` are ignored by older code, which keeps working against an upgraded corpus |

## Known limits

- An old binary keeps writing unstamped rows until rebuilt; they are counted in `unstamped_after_start`, not prevented. That count trusts the writer's clock, so an old binary on a machine whose clock is behind the provenance start is counted as a pre-start row.
- `versions` and `review_judgments` are not hash-chained, so a `build_id` edited there is not detected; audit and decision rows are. The grouping reports which tables each count came from.
- The time-based estimate errs both ways: a stale binary still writing after the fix landed is missed, and a branch that already held the fix writing before it landed is wrongly included. That is why it is a labelled reference list and never a group.
- A build from before the defect was introduced also lacks the fix, so its rows of a declared kind are grouped `known-defect` too. Accepted: the commit that introduced a defect is not recorded (`found_in` only bounds when it was seen), and the cost is extra re-verification, never a hidden finding.
- A build that contains the fix under a different commit (rebase, cherry-pick) is grouped `known-defect`: accepted; the cost is extra re-verification, never a hidden new finding from a build that contains the original fix.
- Automatic regression detection, reducing `versions` snapshots for operational writes, and backfilling old rows are out of scope.

## Out of scope

- Stamping derived or ephemeral tables (`runs`, `sessions`, leases, `check_outcomes`, `trace_*`, FTS).
- Taints on plans (a plan records no landing, so its `fixed_in` is unknown).

## Design Decisions

- **D1 — stamp in the store, refuse regressions by test, count the rest.** The store binds the build on every fact-table insert; AC-WP-1 fails on any NULL row the current code writes; rows from old binaries are counted (`unstamped_after_start`). Rejected (third review round): a `BEFORE INSERT` trigger refusing NULL rows after a per-corpus cutoff. `lore sync push` copies rows with `INSERT OR IGNORE`, which does not ignore a trigger abort, and corpora upgrade at different times, so rows one corpus legitimately wrote before its own upgrade would be refused forever by a remote that upgraded earlier.
- **D2 — absent key / trailing slot, not a formula version.** Old payloads stay byte-identical; the decision chain's trailing `[detail, build_id]` pair removes slot ambiguity.
- **D3 — taints are declared by the fixer, on the task, with a field.** The fixer knows what the defect wrote; requiring a field stops a declaration from swallowing a whole table; freezing on archive stops a later session from moving rows out of the audit.
- **D4 — ancestry of branch head OR landing commit, never time.** The landing commit is the merge; a build from the branch tip contains the fix without containing the merge.
- **D5 — refuse rather than guess.** No lore history, or a missing fix commit, refuses the audit; an unknown or foreign build commit is `uncertain`, never treated as affected.
- **D6 — an estimate is labelled, never a group.** The ADR rejects inferring an old row's build from its time; that still holds: no row is assigned a build and no group moves. The estimate answers a different question ("which old rows of this kind predate the fix landing?") and says so in its label. Rejected: putting estimated rows in `known-defect` (would turn a guess into an exclusion); no estimate at all (today's whole corpus would stay unauditable per issue, the original problem).

## Public Interface

```
lore audit --by-build [--since <iso>] [--lore-repo <path>] [--json]
  exit 0 printed | 4 refused (not lore's history / fix commit missing) | 2 usage
  JSON: { rows_read, total, groups: { current, known_defect, uncertain, unstamped },
          by_table: { audit: {...}, versions: {...}, decision_log: {...}, review_judgments: {...} },
          known_defect_by_issue: [{ repo_id, number, task, fixed_in: {branch_head, landing_commit}, taints, count }],
          needs_reverification: [{ table, key, issue }],
          uncertain_commits: [{ commit, reason }], fixed_in_unknown: [{ repo_id, number, task }],
          unstamped_after_start: { start, audit, versions, decision_log, review_judgments },
          estimated_by_time: [{ repo_id, number, task, landed_at, basis: "time", count, rows: [{ table, key }] }] }
lore taint add  <task> --kind <table:field=value>   exit 0 | 2 bad selector | 4 no issue / archived
lore taint rm   <task> --kind <table:field=value>   exit 0 | 4 archived
lore taint list <task> [--json]
```

## Edge cases

| Situation | Result |
|---|---|
| Build containing the fix (via branch head or landing commit) | `current` |
| Build lacking the fix, kind not declared | `current` |
| Build lacking the fix, declared kind | `known-defect`, under its issue, in `needs_reverification` |
| Build on a branch split before the fix, never merged | `known-defect` if declared kind, else `current` |
| Dirty or `source` build lacking the fix, declared kind | `known-defect` (rule 3 before rule 4) |
| Dirty or `source` build containing the fix, or undeclared kind | `uncertain` |
| Build commit `unknown` | `uncertain`; git never run |
| Build commit absent from lore's history | `uncertain`, named in `uncertain_commits` |
| Row matching two issues | listed under both, counted once |
| NULL `build_id` | `unstamped`, whatever its time |
| NULL `build_id`, declared kind, dated before the fix landed | `unstamped`; also listed in `estimated_by_time` for that issue |
| NULL `build_id`, declared kind, dated after the fix landed | `unstamped` only |
| Old binary writes to an upgraded corpus | written with NULL build; `unstamped`, counted in `unstamped_after_start` |
| `lore sync push` of NULL-build rows to an upgraded remote | accepted |
| `build_id` with no `builds` row (e.g. pushed from a corpus that never pushed `builds`) | `uncertain`, reason `build not on record` |
| Task with taints, no landing | excludes nothing; listed in `fixed_in_unknown` |
| `--lore-repo` an unrelated git repository | exit 4 naming the path |
| `build_id` edited on a chained row mid-chain | `lore audit --verify` reports `hash_mismatch` at that row |

## Acceptance Criteria

Declared with `lore ac add`; each cites the rule it proves and names its falsifier (the smallest mutation that must turn it red).


## Acceptance Criteria (structured)

- [·] [script] AC-WP-1: After running the full CLI write matrix (create, set, link, delete, evidence, claim, release, approve, review, rule add and move, decision, migrate) against SQLite, Turso (embedded replica) and InMemory stores, the count of rows with NULL build_id in audit, versions, decision_log and review_judgments added by the run is 0 and every build_id resolves to one builds row; a source run in a mkdtemp corpus records lore's own HEAD (not the cwd's) with run_kind=source; two concurrent writers with one build yield one builds row. Falsifier: drop the build_id bind from one versions insert site in turso-store.ts; the NULL count must be 1 or more.
  script: test — bun run test:file packages/lore/tests/integration/write-provenance-stamp.bun.test.ts && echo 'AC-WP-1 PASS: every fact-table insert carries a resolvable build_id'
- [·] [script] AC-WP-2: A fixture audit chain and decision chain recorded before this change hash byte-identically after it and 'lore audit --verify' passes; a fully stamped chain of 10 rows passes verify; editing build_id on row 5 makes verify report hash_mismatch at row 5; a decision row with detail=X and no build and one with no detail and build_id=X produce different hashes. Falsifier: remove build_id from canonicalAuditPayload; the row-5 edit must then verify clean and the test fail.
  script: test — bun run test:file packages/lore/tests/unit/service/write-provenance-chain.test.ts && echo 'AC-WP-2 PASS: build_id is chained, legacy rows hash unchanged'
- [·] [script] AC-WP-3: In a real temporary git repo with commits A, B (fix, landed as merge M) and C, plus a branch D split from A and never merged: rows of a declared kind from builds A and D are known_defect; from B (branch head), M and C are current; an undeclared kind from A is current; dirty and source builds at A of a declared kind are known_defect; dirty and source builds at C are uncertain; a commit 'unknown' row is uncertain and no git process is spawned for it; a commit absent from the repo is uncertain and listed in uncertain_commits; a NULL row is unstamped; a row matching two issues is listed under both and counted once; group counts sum to rows_read; needs_reverification keys are audit id, versions doc_id:version, decision_log id, judgment id; a taint-declaring task with no landing appears in fixed_in_unknown and excludes nothing. Falsifier: swap the two arguments of the ancestry call; A and D must then not be known_defect and the test fail.
  script: test — bun run test:file packages/lore/tests/unit/service/audit-by-build.test.ts -t partition && echo 'AC-WP-3 PASS: A/B/M/C/D fixture lands in the expected groups, sum equals rows_read'
- [·] [script] AC-WP-4: A NULL-build row timestamped after a fix landed stays unstamped; --since excludes rows older than the given time from every group and rows_read; --lore-repo set to a non-git directory and to an unrelated git repository (lacking root commit 0040ec74) each exit 4 naming the path; a fix commit absent from the repository exits 4 naming the commit; an unparseable --since exits 2; in each refusal stdout carries no group count. Falsifier: replace the root-commit check with 'is a git repository'; the unrelated-repo case must then exit 0 and the test fail.
  script: test — bun run test:file packages/lore/tests/unit/service/audit-by-build.test.ts -t refusal && echo 'AC-WP-4 PASS: no time inference; missing history refused with exit 4'
- [·] [script] AC-WP-5: lore report-issue through a fake GitHub port produces a body whose front matter parses with issue-front-matter's schema and carries found_in equal to the reporting process's build {commit, dirty, run_kind}; a process with no readable commit records commit 'unknown'; a body filed before found_in existed (fixture) still parses with found_in absent. Falsifier: omit found_in from the report-issue payload; the parsed field must be absent and the test fail.
  script: test — bun run test:file packages/lore/tests/unit/service/report-issue-found-in.test.ts && echo 'AC-WP-5 PASS: filed body names the reporter build'
- [·] [script] AC-WP-6: Through a fake closer port: archiving a task with a landing posts a closing comment containing 'fixed_in: <branch_head> (landed as <landing_commit>)'; the sync repair of an archived task whose issue is still open posts the same line; a task with no landing and a plan carrier each post 'fixed_in: unknown (no landing recorded on <slug>)'. Falsifier: drop the fixed_in line from the comment builder; all four cases must fail.
  script: test — bun run test:file packages/lore/tests/unit/service/issue-close-fixed-in.test.ts && echo 'AC-WP-6 PASS: closing comment names the landing commit'
- [·] [script] AC-WP-7: Through the CLI taint command and lore set: review_judgments:kind=review on a task naming an issue is stored (exit 0); a bare table (review_judgments), an unlisted table (docs:status=draft) and an unlisted field (versions:title=x) each exit 2 naming the allowed tables or fields; a task naming no issue and an archived task each exit 4; lore taint rm removes exactly the named selector; lore taint list --json returns the stored list. Falsifier: move the validation from CorpusService into the taint command only; the lore set case must then store a bare table and the test fail.
  script: test — bun run test:file packages/lore/tests/unit/service/taint-declaration.test.ts && echo 'AC-WP-7 PASS: selector allow-list and exit codes enforced'
- [·] [script] AC-WP-8: The compiled dist/lore, run against a throwaway corpus (mkdtemp + lore init), stamps every row it writes with a builds row whose commit equals its embedded build_commit and run_kind=compiled; 'lore audit --by-build --json --lore-repo <this repo>' exits 0 with groups summing to rows_read; with --lore-repo set to the throwaway directory it exits 4. Falsifier: build without the provenance define; rows must then record run_kind other than compiled and the test fail.
  script: e2e — bun run test:file packages/lore/tests/e2e/write-provenance-compiled.bun.test.ts && echo 'AC-WP-8 PASS: shipped binary stamps and audits by build'
- [·] [script] AC-WP-9: Migration 039 on a corpus copy adds build_id to the four tables and the builds table and rewrites no row (every row's hash before and after is equal; 'lore audit --verify' still passes); afterwards a NULL-build insert into each table succeeds (no refusal); an audit by build counts in unstamped_after_start, per table, exactly the NULL rows dated at or after the earliest builds.first_seen_at, and none dated before it; the output names that provenance start. Falsifier: count every NULL row as unstamped_after_start; the pre-start rows must then be counted and the test fail.
  script: test — bun run test:file packages/lore/tests/integration/write-provenance-migration.bun.test.ts && echo 'AC-WP-9 PASS: migration rewrites nothing; post-start unstamped rows are counted apart'
- [·] [script] AC-WP-10: The compiled dist/lore's real report-issue command and real archive closer, run with a recording gh shim on PATH, send a body whose front matter carries found_in equal to the binary's embedded build, and a closing comment carrying fixed_in from the archived task's landing. Falsifier: wire report-issue with an empty build; the shim-recorded body must lack found_in and the test fail.
  script: e2e — bun run test:file packages/lore/tests/e2e/issue-build-binding-compiled.bun.test.ts && echo 'AC-WP-10 PASS: shipped commands send found_in and fixed_in'
- [·] [script] AC-WP-11: lore sync push from a migrated local corpus to a migrated remote libsql file: builds rows arrive before the versions and audit rows that name them (every pushed build_id resolves on the remote) and the push report lists builds with local_rows equal to remote_rows; NULL-build rows of any date push without error; on the remote, an audit by build classes a row whose build_id has no builds row as uncertain with reason 'build not on record'. Falsifier: remove builds from REPLICATED_TABLES; pushed build_ids must then not resolve and the test fail.
  script: test — bun run test:file packages/lore/tests/integration/write-provenance-sync-push.bun.test.ts && echo 'AC-WP-11 PASS: builds replicate ahead of the rows naming them; unstamped rows still push'
- [·] [script] AC-WP-12: Fixture: issue #N's archived task declares review_judgments:kind=review and landed at time L; issue #M's archived task declares the same taint and has no landing; three NULL-build judgment rows: r1 kind=review before L, r2 kind=review after L, r3 kind=other before L. Expected: estimated_by_time has exactly one entry, for #N, with count 1, rows [r1], basis 'time' and landed_at L; #M has no entry and is listed in fixed_in_unknown; every group count and rows_read are identical with and without the estimate; the human output prints the #N entry under 'Estimated by time (not proven)'. Falsifier: drop the declared-kind filter from the estimate; r3 must then be listed and the test fail.
  script: test — bun run test:file packages/lore/tests/unit/service/audit-by-build.test.ts -t estimate && echo 'AC-WP-12 PASS: time estimate lists only declared pre-landing unstamped rows, groups unchanged'
