---
id: ADR-062
type: adr
role: decision
title: "A history entry records content; working state is recorded in the audit trail"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PRD-001
links:
  - {id: SPEC-255, type: informs}
---
## Context

`versions` is the corpus history: one full snapshot (content, title, status, whole `extra`) per write. A document's `extra` mixes two kinds of fields: content a reviewer judges (acceptance criteria, phases, rule changes) and working state machines rewrite during execution (claims, evidence, landings, anchors, progress). Every working-state write therefore snapshots the whole document.

Measured on this repo's corpus (2026-10-26, read-only):

- `versions` holds ~61k rows and ~1.2 GB of a 2.5 GB file.
- Of 23,455 successive task versions, 14,703 (63%) differ from the previous one only in working-state keys (claim, verification_evidence, red_first, landing, landing_history, commit_range, assignee, milestone_findings): ~164 MB of snapshots that record no change a reviewer could judge. Plans: 197 of 1,353; specs: 505 of 6,973 (code_anchors only). Task `file_anchors` and `issues`, and baseline `pending`, are kept as content: they are declared scope or the revisions a review judges.
- `docs.version` is also the optimistic-concurrency token: `expectedVersion` / `STALE_VERSION` appear at ~142 / ~148 sites across services, the three stores and HTTP `If-Match`. Several consumers assume exactly +1 per write (approve's acted-on version `version - 1`; `retired-ac-service.ts` reading the row at `new_version - 1`); 84 test files assert version numbers.
- Precedents already break "one bump, one row": `writeDocKeepingVersion` (reject: audit row, no bump, no row) and `allocateOrdinalForExisting` (bump, no row).
- `lore restore` writes back the snapshot's whole `extra`, so restoring an old version overwrites the current claim, evidence, landing and anchors.
- Commit `0babc621` already worked around the noise: the plan milestone fingerprint hashes the reviewed state instead of the version.

## Decision

D1. **A history entry records content; working state is recorded in the audit trail.** One list per document type in `@lore/core` names the working-state keys of `extra`. A write whose `docs` columns (other than `version` and `updated_at`) and every non-listed `extra` key are unchanged is working-state-only: it writes NO `versions` row; everything else about the write is as today. In particular `docs.version` still rises by one on every write and the CAS check against it is unchanged, so a stale concurrent writer is still refused. The write's audit row carries `details.state_change`: each changed key with its new and previous value, each removed key with its previous value, and for a list that only grew just the added entries. The version raise and that audit row are committed in one transaction (`updateWithProvenance`), so a bump without its delta cannot be stored.

D2. **Unknown means content.** `extra` schemas are passthrough; a key not on the list, including any unknown key, counts as content, so the failure mode of an incomplete list is an extra snapshot, never a lost history entry.

D3. **One classifier, every path.** A single pure function decides working-state-only; every path that decides to write a `versions` row consults it. No path keeps a private copy of the key list. Inserts, soft-delete, undelete and ordinal-only writes are never classified.

D4. **A stored version number with no row means the closest earlier row.** A working-state-only bump leaves content identical to the latest row below it, so a version number the system stored (a review judgment's `doc_version`, a calibration record's acted-on version, an AC retirement's previous version) or derives (a bare `lore diff`'s "from") resolves to the closest earlier `versions` row, whose content is exactly what was reviewed or acted on. Approve's acted-on `version - 1` only compares judgment numbers and never reads a row. A number a person types into `lore diff` or `lore restore` that has no row still exits 3: it names no snapshot.

D5. **Replay starts from a snapshot.** The working state at any version is the latest `versions` row at or below it (each row holds the whole `extra`, working state included) plus the `details.state_change` of the audit rows after it, applied in order. Every write before this change, every insert and every mixed content-plus-state write leaves such a row, so audit rows from before this change (which carry no `state_change`) never need replaying. `audit` is one of the tables `lore sync push` replicates (`sync-push.ts::REPLICATED_TABLES`), alongside `versions`, so the working-state history reaches every device the snapshots reached.

D6. **Restore makes content equal to the old version.** Restore copies `content`, `title` and every content key of the old version's `extra`, removes content keys the old version did not have, and keeps the current working-state keys.

D7. **History says what it does not show.** `lore log` lists content versions only and states how many working-state changes happened in the span shown, naming the audit query that lists them.

D8. **No rewrite of the past.** Existing rows are not pruned or rewritten by this change; whether historical working-state-only snapshots may be deleted is a separate, irreversible decision.

## Rejected options

| Option | Why rejected |
|---|---|
| Split `docs.version` into a content version plus a new `revision` CAS token | Moves ~142 concurrency sites and breaks every +1 consumer; high error probability for the same storage result |
| Move working state out of `extra` into new tables | Every reader of claims, evidence and landings changes; the storage problem is the snapshot, not where the field lives |
| Content-hash dedup of snapshot rows | Saves space but keeps a history entry per working-state write, so the version history stays noise |
| Classify by explicit "content keys" list | An unknown or newly added key would silently lose history; listing the working-state keys fails safe (D2) |

## Consequences

- Version numbers in `versions` have gaps; `lore diff`/`restore` address only versions that exist (a missing number exits 3 as today).
- Working-state history moves to the hash-chained audit trail, which is tamper-evident where snapshots were not.
- Size of what replaces a snapshot (measured): an evidence entry averages ~1.6 KB (max 7.6 KB), a claim ~0.24 KB (~0.5 KB with its previous value), a landing ~0.6 KB; a task snapshot averages ~10 KB (max ~195 KB). Each replaced snapshot becomes a delta roughly 6–20× smaller, in an audit row that was written anyway.
- Baseline growth is unaffected: its bulk (~18k `site_map` versions, 2026-10-08..20) came from a writer that no longer exists.
- Review binding, approve and CAS behave as before: content writes still bump by one and write one row.
