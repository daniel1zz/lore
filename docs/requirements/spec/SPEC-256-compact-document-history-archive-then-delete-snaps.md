---
id: SPEC-256
type: spec
role: spec
title: "Compact document history: archive, then delete snapshots that record no reviewable change"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-26
tags: []
links:
  - {id: SPEC-255, type: relates-to}
---
# Compact document history: archive, then delete snapshots that record no reviewable change

## Overview/Goal

Remove the existing `versions` rows that record no change a reviewer could judge (working-state-only and retired-key-only snapshots), without losing what they recorded: each is archived verbatim and restorable, and its delta and row metadata are appended to the audit trail. Also remove the retired `extra.site_map` from current baseline state (issue #362).

Decision record: `adr-compact-document-history-archive-then-delete-snapshots-that` (D1–D6). Builds on `spec-history-records-content-a-working-state-only-write-adds-no` (working-state key list, `state_change` shape, closest-earlier-row resolution, gap-aware readers). User decision 2026-10-26: "应该要清理".

**Baseline**: change set on `baseline-read-a-document-s-history` and `baseline-measure-completeness` (`lore rule changes` on this spec). BR-766 and BR-770 are already modified by the unlanded change set of `spec-history-records-content-a-working-state-only-write-adds-no`; that spec's modifies are corrected to cover compaction (one owner per rule id), not duplicated here.

**Precondition (ordering)**: the compaction command ships only after the gap-aware readers of the prior spec have landed (bare `lore diff`, `lore restore`, AC retirement, closest-earlier-row resolution); the implementing plan links them with `blocks`.

## Scope

1. **Compactable keys.** `packages/core/src/working-state.ts` gains `RETIRED_KEYS: Record<DocType, readonly string[]>` (baseline: `site_map`; every other type: none) and `isCompactable(type, previousRow, row): boolean` = true iff `row.action === "update"` and `content`, `title`, `status`, `slug` are equal and `extra` minus `WORKING_STATE_KEYS[type] ∪ RETIRED_KEYS[type]` is deep-equal. (`versions` stores no parent, priority, tags or ordinal; a write that changed only those leaves a row whose stored columns equal the previous row's, and such a row is compactable: its metadata is kept by Scope 5.)
2. **Selection.** A `versions` row of document d is a candidate iff it is not d's lowest-version row, not d's highest-version row, and `isCompactable(type(d), the row just below it, it)`.
3. **Command.** `lore history compact [--apply] [--vacuum] [--json]`.
   - Without `--apply`: prints per-type candidate counts and bytes (`length(content)+length(extra)`) and the archive path it would write; writes nothing; exit 0.
   - With `--apply`: acquires the `history-compact` lease on the existing review-lease table (held → exit 5 naming the holder) and renews it on a timer while running; computes the candidates; writes and verifies the archive (Scope 4); then deletes in transactions of at most 500 rows through one store composite (`compactVersionsWithAudit`) that, per row, re-checks eligibility AND membership in the verified archive, deletes it and appends its audit row (Scope 5) in the same transaction. A candidate that is no longer eligible is skipped; a row eligible now but absent from the archive is never deleted. Prints rows deleted, rows skipped, bytes, archive path and sha256; exit 0.
   - `--vacuum` (only with `--apply`): after the deletes runs `VACUUM` then `PRAGMA wal_checkpoint(TRUNCATE)` with a busy timeout of 5 s. The outcome is read from what SQLite reports, not assumed: VACUUM failing busy → exit 5 `vacuum skipped: database in use by another connection; rerun 'lore history compact --apply --vacuum' when idle`; VACUUM done but the checkpoint result row reports busy=1 → exit 5 `vacuum done; file not yet shrunk: a reader holds the WAL; rerun when idle`. Either way the deleted rows stay deleted. Needs free disk space of up to twice the database size (SQLite).
   - `sync.enabled` → exit 4 before any write, naming that replicas are not compacted.
4. **Archive.** Written next to the resolved `lore.db` (`<db dir>/archive/history-compact-<UTC yyyymmddThhmmssZ>.jsonl.gz`, never under a worktree), never pruned by lore. Line 1 is a header `{ "kind": "history-compact-archive", "rows": N, "rows_sha256", "columns": [...], "created_at", "corpus_schema" }`, `rows_sha256` = sha256 of the decompressed row lines; then one JSON object per candidate with every `versions` column by name. After writing, the file is read back; N and `rows_sha256` must match, else exit 1, the file is removed, nothing is deleted.
5. **Audit.** Per deleted row: action `history-compact`, `doc_id`, `details = { version, new_version: version, previous_version, archive (absolute path), archive_sha256, row_meta, state_change }` where `row_meta` = every `versions` column of the row except `content` and `extra` (change_summary, created_by, created_at, action, slug, harness_run, and any column a later migration adds), and `state_change = buildStateChange(type, previous.extra, row.extra)` restricted to working-state keys, plus `retired: { <key>: { previous_sha256, sha256 } }` per retired key that changed. `new_version` makes these rows count in `lore log`'s "working-state changes not shown" exactly like a working-state-only write; a version that has a `versions` row again (restored) is listed and not counted, so a restore never double-counts. The audit action is not in any versions-completeness family, so it cannot satisfy a completeness check.
6. **Replay.** The working state at version v is the latest `versions` row r with r.version ≤ v, plus every audit `state_change` whose version (`details.new_version`) lies in (r.version, v], applied in version order. After a restore re-inserts row k, a replay to v ≥ k starts at or after k and never applies k's own compaction delta, so nothing is applied twice.
7. **Restore.** `lore history restore-archive <file> [--json]` acquires the same lease; checks the header (`kind`, `columns` ⊆ current `versions` columns, else exit 4) and `rows_sha256` (mismatch → exit 4, nothing written); inserts every row by column name with `INSERT OR IGNORE`; then verifies that every archived `(doc_id, version)` is present and byte-equal on every archived column; any absent or differing row → exit 1 naming it (a differing existing row is never overwritten). Appends one audit row `history-restore` with the file, rows inserted and rows already present. The `history-compact` audit rows stay (append-only).
8. **Archive check.** `lore status --check-history-archives` reads every distinct archive named by `history-compact` audit rows and exits 1 naming each one that is missing or whose `rows_sha256` no longer matches; 0 otherwise.
9. **Retired key in current state.** A schema migration (number chosen at landing; another approved spec also adds one) removes `extra.site_map` from every non-deleted baseline doc that has it (115 at measurement: 93 approved, 21 draft, 1 deprecated), as one content write each: version +1, one `versions` row with action `update`, one audit row whose action is added to the update completeness family in `audit-service.ts` (as `migrate-schema-028/029` were). Status is unchanged. Re-running changes nothing. AC-RIC-6 of `spec-refusal-sites-declare-their-rule-in-code-baseline-leaf` reads the live corpus and turns green once `lore migrate schema` has run on it.

## Out of scope

- Compacting remote replicas.
- Deleting audit rows or any row other than candidate `versions` rows.
- Compacting the first or latest row of a document, or rows of any action other than `update`.

## Design Decisions

- **D1 — first and latest rows are anchors.** Every replay and every closest-earlier lookup lands on a kept row.
- **D2 — delete = eligible now AND archived.** Selection can change between archiving and deleting (a write turns the former latest row interior); requiring archive membership makes "nothing unarchived is deleted" hold under concurrent writers.
- **D3 — hashes for retired keys, everything else verbatim.** `site_map` values are large and have no reader; the archive holds them, the audit row proves which ones were removed. Row metadata is copied in full so no summary, author or time leaves the corpus.
- **D4 — restore never overwrites.** A row that differs from the archive is reported, not replaced: the corpus is the SSOT and the archive is evidence.

## Non-functional

| Concern | Response |
|---|---|
| Size reclaimed | ~781 MB of `versions` rows at the measured state; file shrinks after `--vacuum` |
| Audit growth | ~35k rows, each a small delta, row metadata, or two hashes |
| Concurrency | lease (renewed) for compact and restore; ≤500 rows per transaction; per-row eligibility and archive membership re-checked inside the transaction |
| Reversibility | archive + `restore-archive` + `--check-history-archives` |
| Durability | the archive lives beside `lore.db` and has the same durability: both are local, both git-ignored (`.gitignore` `.lore/*`) |
| Disk | archive ~ compressed size of the candidates; `VACUUM` up to 2× the database size |

## Edge cases

| Situation | Result |
|---|---|
| Dry run | counts and bytes printed, nothing written |
| Archive write or verification fails | exit 1, no row deleted, partial file removed |
| A write lands on a document between archiving and deleting | its former latest row, now interior, is not deleted (not archived); the run's other rows proceed |
| Second run with no writes in between | 0 rows selected: eligibility compares content with the row below and content equality is transitive |
| Another session runs compact or restore at the same time | exit 5 naming the lease holder |
| `--vacuum` while another connection holds the db | deletions committed, exit 5 with the rerun line |
| Restore of an archive whose sha256 does not match, or with a column the table lacks | exit 4, nothing inserted |
| Restore when a row with the same key but different content exists | that row kept, exit 1 naming it |
| Restore of an archive already restored | 0 inserted, all present, exit 0 |
| `sync.enabled` | exit 4 |
| Review judgment pointing at a deleted version | resolves to the closest earlier row (content equal) |
| Archive file deleted by hand | `lore status --check-history-archives` exit 1 naming it |

## Acceptance Criteria

Declared with `lore ac add`; each cites its rule and names its falsifier.


## Acceptance Criteria (structured)

- [·] [script] AC-CP-1: On a SQLite fixture corpus whose task has versions 1 (create), 2 (body edit), 3-5 (evidence only), 6 (body edit), 7 (evidence only, latest), whose baseline has rows differing only in site_map, and whose spec has an approve row equal in content to the row below: selection is exactly task 3, 4, 5 and the interior site_map-only baseline rows; task 7 (latest), 1 (first), 2 and 6 (content) and the approve row are kept; 'lore history compact' without --apply exits 0, prints per-type counts and bytes, and leaves every table and the archive directory unchanged; a second --apply run with no writes in between selects 0 rows. Falsifier: drop the 'not the latest row' condition; task 7 must then be selected and the test fail.
  script: test — bun run test:file packages/lore/tests/integration/history-compact-selection.bun.test.ts && echo 'AC-CP-1 PASS: compaction selects only interior no-content-change update rows'
- [·] [script] AC-CP-2: compact --apply writes <db dir>/archive/history-compact-*.jsonl.gz whose header rows and rows_sha256 match the deleted rows; with the archive write forced to fail (unwritable directory) the run exits 1, deletes nothing and leaves no partial file; restore-archive re-inserts every row by column name so the versions table equals its pre-compaction content (row-set equality) and appends one history-restore audit row; restoring it again inserts 0 rows (exit 0); a byte-modified archive and an archive naming a column the table lacks are each refused with exit 4 and insert nothing; when a row with the same (doc_id, version) but different content already exists, it is kept and restore exits 1 naming it. Falsifier: skip the read-back verification; the forced-failure case must then delete rows and the test fail.
  script: test — bun run test:file packages/lore/tests/integration/history-compact-archive.bun.test.ts && echo 'AC-CP-2 PASS: archive first, verified, restorable'
- [·] [script] AC-CP-3: After compacting the AC-CP-1 fixture: exactly one history-compact audit row exists per deleted row, carrying version, new_version equal to version, previous_version, archive (absolute path), archive_sha256, row_meta with that row's change_summary, created_by and created_at, and state_change (task 4's lists the evidence entry it added under appended.verification_evidence); a deleted site_map-only baseline row carries retired.site_map with previous_sha256 and sha256 and no site_map value; replaying the task's working state to each deleted version (latest kept row at or below it plus later state_change entries up to it, in version order) reproduces that version's claim and evidence; lore log on the task reports the compacted versions in state_changes_not_shown; 'lore audit --verify' exits 0. Falsifier: order replay by audit row id instead of version; the reproduced evidence of version 4 must then differ and the test fail.
  script: test — bun run test:file packages/lore/tests/integration/history-compact-audit.bun.test.ts && echo 'AC-CP-3 PASS: each removed entry leaves its delta in the audit chain'
- [·] [script] AC-CP-4: With the history-compact lease held by another holder, compact --apply and restore-archive each exit 5 naming the holder and write nothing; a write to a document injected after the archive is verified and before the first delete batch makes that document's former latest row interior, and that row is neither archived nor deleted while the run's other candidates are deleted; with a second connection holding a read transaction, compact --apply --vacuum commits its deletions and exits 5 printing 'vacuum skipped: database in use by another connection'; with no other connection, --vacuum exits 0 and after the WAL checkpoint the database file is smaller than before; a corpus whose config sets sync.enabled is refused with exit 4 before any write. Falsifier: delete by re-selection without the archive-membership check; the injected-write case must then delete the unarchived row and the test fail.
  script: test — bun run test:file packages/lore/tests/integration/history-compact-concurrency.bun.test.ts && echo 'AC-CP-4 PASS: one runner, explicit vacuum refusal, sync refused'
- [·] [script] AC-CP-6: The compiled dist/lore in a throwaway corpus (mkdtemp + lore init) with a task whose history has interior evidence-only versions (written with the task workflow before this binary's no-snapshot behaviour, inserted as fixture rows): 'lore history compact --json' reports them without writing; 'lore history compact --apply --json' exits 0 reporting the same count and an archive path; 'lore history restore-archive <path>' exits 0 and the versions table then equals its pre-compaction content; 'lore audit --verify' exits 0 after both. Falsifier: make restore-archive skip the insert; the versions table must then differ and the test fail.
  script: e2e — bun run test:file packages/lore/tests/e2e/history-compact-compiled.bun.test.ts && echo 'AC-CP-6 PASS: shipped binary compacts and restores'
- [·] [script] AC-CP-5: Upgrading a fixture corpus with three baseline leaves carrying extra.site_map (one an empty object) and one without: afterwards no baseline row in docs has the key site_map (key absence, empty object included); each of the three gained exactly one versions row and one audit row naming the migration, and the fourth is unchanged; running the upgrade again changes nothing. Falsifier: remove only non-empty site_map objects; the empty-object leaf must then keep the key and the test fail.
  script: test — bun run test:file packages/lore/tests/unit/store/migration-drop-site-map.bun.test.ts && echo 'AC-CP-5 PASS: the retired site_map leaves current baseline state'
- [·] [script] AC-CP-7: After a compaction, 'lore status --check-history-archives' exits 0; after deleting the archive file it exits 1 naming the file; after changing one byte inside a row line of the archive it exits 1 naming the file; a corpus with no history-compact audit rows exits 0. Falsifier: check only that the file exists; the altered-byte case must then exit 0 and the test fail.
  script: test — bun run test:file packages/lore/tests/integration/history-compact-archive-check.bun.test.ts && echo 'AC-CP-7 PASS: a missing or altered archive is reported'
