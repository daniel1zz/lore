---
id: SPEC-255
type: spec
role: spec
title: "History records content: a working-state-only write adds no version snapshot"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-28
tags: []
---
# History records content: a working-state-only write adds no version snapshot

## Overview/Goal

A document's history (`versions`) should record what a reviewer could judge, not every machine write. Today every claim, evidence entry, landing and anchor update snapshots the whole document: 63% of successive task versions (14,703 of 23,455, ~164 MB) differ only in working-state keys. This spec makes a working-state-only write keep the concurrency token moving and the audit trail complete, while writing no snapshot; and fixes `lore restore`, which today overwrites current working state with the old version's.

Decision record: `adr-a-history-entry-records-content-working-state-is-recorded` (D1–D8, rejected options, measurements). User decision 2026-10-26: "直接改，按照你认为的最佳设计" (the AI chose the design; recorded in the ADR).

**Baseline**: change set on `baseline-revise-a-document`, `baseline-restore-an-earlier-version`, and modifies of BR-766, BR-768, BR-770, BR-127, BR-142, BR-1041, BR-1195, BR-1213, BR-1355 (`lore rule changes` on this spec). BR-721 stays true: `lore set` cannot write working-state keys (they have dedicated writers), so every accepted `set` edit is a content write.

## Scope

1. **Working-state key list (SSOT).** `packages/core/src/working-state.ts` (browser-safe, no imports) exports `WORKING_STATE_KEYS: Record<DocType, readonly string[]>`:
   - task: `claim`, `verification_evidence`, `red_first`, `landing`, `landing_history`, `commit_range`, `assignee`, `milestone_findings`
   - phase: `claim`, `verification_evidence`, `checklist`, `track` (progress notes), `migrated_from`, `migrated_to`
   - plan: `progress`, `known_defects`, `integration_branch`
   - spec: `code_anchors`
   - knowledge: `code_anchors`
   - prd: `outline_budget`
   - adr, baseline: none (a baseline node's `pending` holds the revisions its review judges, BR-1338, BR-628)
   Deliberately content: task and phase `file_anchors` (declared scope, judged in task review), task and plan `issues` (which issues a landing closes), spec `allow_missing_path_declarations` (written only by `ac add|set`, already a content write). Every other key, including unknown passthrough keys, is content.
2. **Classifier.** `isContentChange(type, before, after): boolean` in the same module, pure: false iff every `docs` column other than `version`, `updated_at` and the `fts_*` shadow columns is equal (content, title, status, slug, parent_id, priority, tags, ordinal, deleted_at) and `extra` minus that type's working-state keys is deep-equal (key order ignored); true otherwise. A `versions` row is written iff it returns true. A write that changes nothing at all is still stopped before this point by `writeDoc`'s existing unchanged-patch check (`patchedFieldsUnchanged`, corpus-service.ts): no version raise, no audit row, no versions row, unchanged by this spec. "Working-state-only" below means some working-state key changed and `isContentChange` returned false. Inserts (`insertWithProvenance`, `insertWithAllocatedOrdinalAndProvenance`), soft-delete and undelete are never classified: they always write their row as today. Ordinal-only paths (`allocateOrdinalForExisting`, `assignOrdinalForRepair`) keep today's behaviour exactly.
3. **Write behaviour.** Every path that today decides to write a `versions` row consults the classifier with the stored row and the new row: `CorpusService.writeDoc`, `set`, `cascadeArchiveOnPlanClose`, `archiveSweepCandidate`, plan progress (`store/plan-progress.ts::buildPlanProgressWrite`), rule-leaf writes (`rule-leaf-companion-writes.ts`, `applyRuleLeafPatch*` in the three stores; these write baseline and spec content, so they classify as content unless only `code_anchors` changed), and `updateWithProvenance`'s `also_update` companions. When working-state-only:
   - `docs.version` still rises by one and the CAS check (`expectedVersion`) is unchanged;
   - no `versions` row is inserted;
   - the audit row is written as today, and its `details.state_change` = `{ keys, values, previous, appended, removed }`: a key whose old value is an array prefix of its new value goes to `appended` (only the added entries); a key that was deleted goes to `removed` (name) and `previous` (old value); every other changed key goes to `values` (new value) and `previous` (old value, absent when the key is new). So one audit row alone shows both the old and the new holder of a stolen claim. The working state at any version is the latest `versions` row at or below it plus the `state_change` of the later audit rows applied in order (ADR D5); inserts and mixed writes always leave such a starting row. The version raise and the audit row of a working-state-only write commit in one transaction (`updateWithProvenance`), as every write does today. `details` is inside the audit hash, so these entries are tamper-evident.
4. **Consumers that assumed one row per bump.** A version number the system stored or derives (review judgments, calibration, AC retirement, a bare diff's "from") that has no row resolves to the closest earlier row (ADR D4); a number a person types into `lore diff`/`lore restore` with no row still exits 3. `retired-ac-service.ts` reads the latest `versions` row with a version below `new_version` instead of `new_version - 1`. `lore diff <doc>` with no `from` compares the latest row with the closest earlier row that exists (today `toVer - 1`, `version-service.ts:131`). Approve's acted-on `version - 1` stays correct (it compares judgment numbers, never reads a row). Ordinal-repair assertions are unaffected because ordinal paths are not classified.
5. **Restore.** `lore restore <doc> <n>` takes `content`, `title` and the content keys of `extra` from version n, removes content keys version n did not have, keeps the current values of the type's working-state keys, and writes as today (status draft, summary names the version restored from). `keepStoredPlanProgress` stays: it also protects every plan edit that rebuilds `extra` without `progress`.
6. **Log.** `lore log` (CLI, MCP, HTTP) lists `versions` rows as today and adds `state_changes_not_shown: N` (JSON) / a closing line `N working-state changes not shown: lore audit --doc <slug>` (human). N counts the doc's audit rows carrying `details.state_change` whose `details.new_version` lies above the oldest listed row's version and, when the listing does not start at the newest row, below the next newer row not listed; with offset 0 there is no upper bound. N = 0 prints nothing.
7. **Unchanged.** Existing `versions` rows (this spec neither prunes nor rewrites them; pruning is decided separately by spec-compact-document-history-archive-then-delete-snapshots); `docs.version` semantics as the CAS token; review binding to `doc.version`; audit-verify completeness (versions → audit, one-way, already tolerant of audit rows without a version row).

## Out of scope

- Pruning historical working-state-only snapshots (ADR D8; decided separately by spec-compact-document-history-archive-then-delete-snapshots).
- Baseline `site_map` leftovers (no current writer).
- Moving working state out of `extra`.

## Design Decisions

- **D1 — list the working state, not the content.** An incomplete list costs an extra snapshot, never a lost history entry (ADR D2).
- **D2 — the token keeps moving.** CAS and every "+1" consumer keep working; only the snapshot is skipped. Rejected: a separate `revision` column (ADR).
- **D3 — record the delta in the audit row.** The audit chain already records every write; adding the changed values there keeps working-state history recoverable and tamper-evident, at a fraction of a full snapshot.
- **D4 — `appended` for growing lists.** Evidence and landing history only grow; storing the added entries avoids re-storing the whole list on every append.

## Non-functional

| Concern | Response |
|---|---|
| Storage | At the measured rate, ~63% of task writes stop snapshotting the whole doc; each is replaced by a delta in an audit row that is written anyway |
| Write cost | One extra deep-compare of two `extra` objects per write (already both in memory on every path listed) |
| Concurrency | Unchanged: CAS on `docs.version` at every existing site |
| Migration | None (no schema change) |
| Rollback | Revert the code; rows written meanwhile simply lack snapshots for working-state-only writes, which their audit rows still describe |

## Edge cases

| Situation | Result |
|---|---|
| Evidence appended to a task | version +1, no versions row, audit `state_change.appended.verification_evidence` = [new entry] |
| Claim taken then released | two writes, version +2, no versions rows; the first audit row has `values.claim`, the second `removed: ["claim"]` and `previous.claim` |
| AC edited on a spec | one versions row (content) |
| Unknown extra key `foo` changed | one versions row (unknown = content) |
| Red-first declared again with the same value | nothing written (existing unchanged-patch check): version, versions rows and audit unchanged |
| One write changes a content key and a working-state key | one versions row |
| `lore done` status walk approved→active→archived | rows as today (status is content) |
| Concurrent evidence writes from two sessions | second refused with exit 5 (`STALE_VERSION`), as today |
| Restore of a version older than the current claim | claim, evidence, landing kept; body/title/content keys restored |
| `lore diff <doc> <n>` where n was a working-state-only bump | exit 3 (no such version), as for any missing version |
| `lore diff <doc>` when the latest row is 9 and 6–8 were working-state bumps | compares 9 with 5 |
| Claim released | `removed: ["claim"]`, `previous.claim` = the released claim |
| Claim stolen | `values.claim` = new holder, `previous.claim` = old holder, in one audit row |
| Rule added to a baseline leaf | one versions row (baseline has no working-state keys) |
| Task `file_anchors` or `issues` changed | one versions row (content) |
| Plan edit whose patch omits `progress` | progress kept (`keepStoredPlanProgress`), as today |
| Retire an AC when the previous row is not `new_version - 1` | the latest row below is read |

## Acceptance Criteria

Declared with `lore ac add`; each cites its rule and names its falsifier.


## Acceptance Criteria (structured)

- [⚑] [script] AC-HC-1: On SQLite, Turso (local file) and InMemory stores, for each working-state key of task (claim, verification_evidence, landing), phase (checklist), plan (progress), spec and knowledge (code_anchors) and prd (outline_budget): a write changing only that key raises docs.version by exactly 1, adds 0 versions rows and exactly 1 audit row whose details.state_change names the key; an evidence append records only the new entry under appended.verification_evidence; replacing landing records values.landing and previous.landing; a release records removed ['claim'] and previous.claim; starting from the task's create row and applying the later audit rows' state_change in order reproduces its final claim, evidence and landing; a review judgment recorded at a working-state-only version resolves to the closest earlier versions row; a second writer using the old version is refused with STALE_VERSION. Falsifier: make isContentChange always return true; the 0-rows assertions must fail.
  script: test — bun run test:file packages/lore/tests/integration/working-state-writes.bun.test.ts && echo 'AC-HC-1 PASS: working-state-only writes bump version, add no snapshot, carry their delta in audit'
  other_command=2
- [⚑] [script] AC-HC-2: isContentChange returns true when content, title, status, slug, parent_id, priority, tags, ordinal or deleted_at differ, and when any extra key outside WORKING_STATE_KEYS[type] differs (including an unknown key 'foo'); false when the only differences are listed working-state keys (key order ignored) and false when nothing differs; every DocType has an entry in WORKING_STATE_KEYS; no file under packages/ other than packages/core/src/working-state.ts declares a list containing both 'verification_evidence' and 'landing'. Falsifier: drop the unknown-key-is-content branch (compare only a list of known content keys); the 'foo' case must then return false and the test fail.
  script: test — bun run test:file packages/lore/tests/unit/core/working-state.test.ts && echo 'AC-HC-2 PASS: classifier fails safe, single key list'
- [·] [script] AC-HC-3: Content writes keep one row per write: editing a spec AC, a task body, a title, task file_anchors, task issues, adding a rule to a baseline leaf, a status walk via lore done (approved, active, archived), and one write setting both a task body and its claim each add exactly one versions row per write; a plan edit whose patch omits progress keeps the stored progress; approve still records version - 1 as the acted-on version in calibration; retiring an AC when the previous versions row is two numbers below reads that row. Falsifier: make the classifier ignore status; the lore done walk must then add 0 rows and the test fail.
  script: test — bun run test:file packages/lore/tests/integration/working-state-content-writes.bun.test.ts && echo 'AC-HC-3 PASS: content writes still snapshot; gap-tolerant previous-row read'
- [·] [script] AC-HC-4: A task at version 9 holding a claim, two evidence entries and a landing, and a content key 'foo' added at version 7, is restored to version 3: content, title and content extra keys equal version 3's, 'foo' is removed, and claim, verification_evidence and landing equal their values before the restore; status is draft and the new versions row's summary names version 3; a plan restored to an old version keeps its current progress. Falsifier: restore the whole extra from the snapshot; the claim must then revert and the test fail.
  script: test — bun run test:file packages/lore/tests/unit/service/restore-keeps-working-state.test.ts && echo 'AC-HC-4 PASS: restore brings back content, keeps working state'
- [·] [script] AC-HC-5: lore log on a task with content versions 1, 5 and 9 and working-state-only writes at versions 2-4 and 6-8 lists 3 entries; its JSON carries state_changes_not_shown: 6 and the human output ends with '6 working-state changes not shown: lore audit --doc <slug>'; with --limit 2 (entries 9 and 5) it reports 3 (versions 6-8); with --limit 1 --offset 1 (entry 5) it reports 3 (versions 6-8, between 5 and the next newer entry 9); HTTP log returns the same counts; a doc with no working-state writes prints no such line and returns 0. Falsifier: count all audit rows instead of those with details.state_change; the full-listing count must then exceed 6 and the test fail.
  script: test — bun run test:file packages/lore/tests/unit/service/log-state-changes-not-shown.test.ts && echo 'AC-HC-5 PASS: history says what it leaves out'
- [·] [script] AC-HC-6: Ticking a phase checklist item, appending a phase progress note (extra.track), declaring red-first on a task that was not red-first, and a landing rewriting a spec's code anchor after a rename each raise docs.version by 1, add 0 versions rows and exactly 1 audit row with details.state_change; declaring red-first again changes nothing (version, versions rows and audit rows unchanged); a checklist change and a progress note against a stale version each exit 5. Falsifier: route the checklist write around the classifier (always snapshot); its 0-rows assertion must fail.
  script: test — bun run test:file packages/lore/tests/integration/working-state-verbs.bun.test.ts && echo 'AC-HC-6 PASS: checklist, red-first and anchor-rewrite are working-state writes'
  other_command=2
- [·] [script] AC-HC-7: The compiled dist/lore in a throwaway corpus (mkdtemp + lore init): create a spec and a task, approve the task, claim, add two evidence entries, release (claim and release leave status unchanged); the task's versions rows are exactly create and approve (2), docs.version equals 1 plus the number of writes, 'lore audit --verify' exits 0, and 'lore log <task>' ends with '4 working-state changes not shown'. Falsifier: build with isContentChange forced to return true; the task's versions rows must then exceed 2 and the test fail.
  script: e2e — bun run test:file packages/lore/tests/e2e/working-state-history-compiled.bun.test.ts && echo 'AC-HC-7 PASS: shipped binary writes no snapshot for working state'
- [·] [script] AC-HC-8: write-path-everywhere.bun.test.ts's matrix asserts each write's class: content writes add one versions row per bump; working-state-only writes add none and carry details.state_change; inserts, soft-delete and undelete still add their row; the matrix covers writeDoc, set, plan progress reconciliation, rule-leaf writes, also_update companions, archive cascade and sweep; 'lore audit --verify' passes after the whole matrix on SQLite and Turso. Falsifiers, one per path class: skip the classifier in plan-progress.ts (progress row then adds a versions row); skip it in the also_update companion branch of updateWithProvenance (a companion working-state write then adds a row); route softDeleteWithProvenance through the classifier (delete then adds no row). Each must turn the test red.
  script: test — bun run test:file packages/lore/tests/integration/write-path-everywhere.bun.test.ts && echo 'AC-HC-8 PASS: every write path classifies its write'
  other_command=2
- [·] [script] AC-HC-9: With versions rows 1, 5 and 9 (6-8 working-state bumps), a bare 'lore diff <doc>' exits 0 comparing 9 with 5; 'lore diff <doc> 7' exits 3; 'lore diff <doc> 5' compares 5 with 1; the same through HTTP. Falsifier: restore 'fromVer = toVer - 1'; the bare diff must then exit 3 and the test fail.
  script: test — bun run test:file packages/lore/tests/unit/service/version-diff-gaps.test.ts && echo 'AC-HC-9 PASS: diff defaults to the closest existing earlier version'
- [⚑] [script] AC-HC-10: Run A claims a task, run B steals it: exactly one audit row carries previous.claim naming run A and values.claim naming run B, and no versions row is added; a forced release by run C records removed ['claim'], previous.claim naming run B and the given reason in one audit row; 'lore audit --doc <task>' prints both rows. Falsifier: omit previous from state_change; the steal row must then lack run A and the test fail.
  script: test — bun run test:file packages/lore/tests/integration/claim-history-in-audit.bun.test.ts && echo 'AC-HC-10 PASS: claim steals and forced releases are recorded in the audit trail'
  other_command=2
