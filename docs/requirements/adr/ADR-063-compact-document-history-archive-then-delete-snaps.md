---
id: ADR-063
type: adr
role: decision
title: "Compact document history: archive, then delete snapshots that record no reviewable change"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PRD-001
links:
  - {id: ADR-062, type: relates-to}
  - {id: SPEC-256, type: informs}
---
## Context

`adr-a-history-entry-records-content-working-state-is-recorded` stops new working-state-only snapshots but, by its D8, leaves every existing `versions` row untouched and names pruning "a separate, irreversible decision". This is that decision. User decision 2026-10-26: "应该要清理" (the history should be cleaned).

Measured on this repo's corpus (2026-10-26, read-only): `versions` holds ~1.2 GB of a 2.5 GB file. Rows of action `update` that are neither a document's first nor its latest row, and whose content, title, status, slug and `extra` minus the type's working-state keys (and, for baselines, the retired `site_map`) equal the previous row's: 34,936 rows, ~781 MB (baseline 20,380 / 613 MB, mostly `site_map` churn written 2026-10-08..20 by a writer that no longer exists; task 13,881 / 158 MB; spec 488; plan 183; adr 2; knowledge 2). Separately, 115 baseline leaves still carry `extra.site_map` in their current state, which AC-RIC-6 of spec-refusal-sites-declare-their-rule-in-code-baseline-leaf says must be gone (issue #362).

## Decision

D1. **Compact, never rewrite.** A compaction deletes whole `versions` rows chosen by the rule above and changes no other row. No kept row is edited; no `docs` row, audit row or link changes.

D2. **Archive first, verified, restorable, and only archived rows are deleted.** Before any delete, every candidate row is written verbatim (all columns, by name) to a gzip JSONL archive beside the resolved `lore.db`, whose header carries the row count and the sha256 of the row lines; the file is read back and both are checked. A failed or unverified archive refuses the run with nothing deleted. A row is deleted only if it is in the verified archive AND still eligible inside the deleting transaction, so a concurrent write that turns a former latest row interior can never get an unarchived row deleted. A restore command re-inserts an archive's rows without overwriting any existing row and verifies byte-equality afterwards, so the deletion can be undone. Archives are never pruned by lore; they have the durability of `lore.db` itself (both local, both git-ignored), and `lore status --check-history-archives` fails when an archive named in the audit trail is missing or altered.

D3. **The information moves to the audit trail.** Each deleted row gets one appended audit row (`history-compact`) naming the row's version (also as `new_version`), the previous version, the archive path and sha256, every row column other than content and extra (summary, author, time, action, run), and the working-state delta from the previous row (the `state_change` shape of a working-state-only write). For a retired key (`site_map`) the delta names the key and the sha256 of the old and new value; the values stay in the archive. Working state at version v = the latest kept row r ≤ v plus the `state_change` entries with version in (r.version, v], in version order; after a restore re-inserts row k, a replay starts at or after k and never applies k's compaction delta twice.

D4. **Dry run by default; one runner; space on request.** Without `--apply` the command only reports what it would delete. Compact and restore take the same renewed store lease so they never interleave. `--vacuum` reclaims file space afterwards (VACUUM, then a WAL checkpoint) and refuses with exit 5, naming the reason, when another connection holds the database. A corpus with `sync.enabled` is refused (exit 4): compacting a replica would diverge from its primary. This repo's corpus has no sync configured (measured), so the reclaim applies to it.

D5. **The retired key leaves the current state by migration.** A schema migration removes `extra.site_map` from every baseline that has it, as ordinary content writes (one version, one audit row each), so every corpus, consumer ones included, converges without a manual step.

D6. **Readers first.** The command ships only after the gap-aware readers of the prior spec (bare diff, restore, AC retirement, closest-earlier-row resolution) have landed; deleting interior rows before them would break those readers on ~35k documents.

## Rejected options

| Option | Why rejected |
|---|---|
| Rewrite kept rows (strip `site_map` from every snapshot) | History would no longer show that the field existed; a kept row would no longer be what was written |
| Delete without an archive | Irreversible; one wrong selection rule would destroy history with no way back |
| Delete all working-state-only rows including a document's latest row | The latest row anchors replay and every "closest earlier row" lookup |
| Leave old rows, only stop growth | ~781 MB of rows that record no reviewable change stay in every copy of the corpus (local file, backups, worktree snapshots taken by integrate) forever |
| A one-off script | Consumer corpora and later corpora could not run it; no oracle would hold it |

## Consequences

- At the measured state, ~35k rows (~781 MB) leave `versions`; the file shrinks only after `--vacuum`.
- ~35k audit rows are added, each a small delta (working-state values ~0.2–1.6 KB; retired keys as hashes) plus the row metadata.
- Review judgments, calibration and AC retirement keep working through closest-earlier-row resolution (prior ADR D4): a deleted row's content equals the row before it.
- Remote replicas are not compacted by this change.
