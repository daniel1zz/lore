---
id: SPEC-243
type: spec
role: spec
title: "A plan's known defects are its own record of GitHub issues, not links to issue tasks"
status: approved
priority: high
created: 2026-10-25
updated: 2026-10-25
tags: []
links:
  - {id: SPEC-236, type: relates-to}
  - {id: SPEC-212, type: relates-to}
---
# A plan's known defects are its own record of GitHub issues, not links to issue tasks

## Overview/Goal

A plan whose milestone review fails closes "accepted with known defects" once every failed dimension has an open GitHub issue recorded for it (BR-1372, BR-1379). On main that record is a `known-defect` link from the plan to the issue's corpus mirror task (#404, migration 037), and coverage reads the mirror's `extra.milestone_findings`.

`spec-github-owns-issue-report-state-no-mirror-task-work-carries` (GS) deletes mirror tasks: GitHub owns a report's state and a corpus document exists only for WORK (a carrier, `extra.issues`), and filing creates no corpus document (GS D7). Landing GS on main (task-land-gs-integration-plan-github-owns-issue-report-state, branch land-gs) therefore has no target for a known-defect link. The landing branch's interim port (assess filing adopts an ad-hoc draft carrier task, links it) was reviewed on 2026-10-25 and found to:
- lose every existing known-defect record on migration (links to soft-deleted mirrors; the corpus has such links today, e.g. task-gh-1343388703-412/413);
- fail to link an issue GitHub's listing does not show yet (the #402 regression);
- count one carrier's dimensions for every issue it carries (a plan can close on an issue that does not record the failed dimension);
- create a corpus document on filing, contrary to GS D7, accumulating draft tasks that later read as `adopted (abandoned)`.

Goal (owner decision 2026-10-25): a known defect is a fact ABOUT the plan, not work. The plan records it itself:

`extra.known_defects: [{ repo_id, number, dimension, fingerprint }]`

Filing writes entries there and creates no document; plan-close coverage reads only these entries plus each issue's live GitHub state; the `known-defect` link type is retired; migration converts every existing known-defect link into entries before mirrors are removed. Archiving the plan never touches these issues (they are not `extra.issues`), which keeps #404's intent.

Relates to (approved, locked; this spec carries the change set): `spec-plans-close-themselves-level-triggered-reconciliation-of` (the PCR spec, AC-PCR-4/5), `spec-github-owns-issue-report-state-no-mirror-task-work-carries` (D7, AC-GS-12), the known-defect link plan `plan-known-defects-stay-open-one-issue-per-defect-falsely` (R1, #404).

## Scope

In:
- Core schema: `extra.known_defects` on plans only (array of `{repo_id: number, number: number, dimension: MilestoneDimension, fingerprint: string}`, unique by (repo_id, number, dimension)); refused on any other doc type.
- Filing (`IssueFilingService` / `assess-file-issues.ts`, the review batch): findings are grouped by root-cause fingerprint as today; each fingerprint is filed or reused (dedupe against OPEN issues) as ONE GitHub issue, and the plan gains one entry (that issue, dimension) for every failed dimension whose findings carry that fingerprint — so one issue may hold several entries, one per dimension. Entries are appended to the plan with the plan's expected version (CAS); no corpus document, no link. The filer already knows the number of an issue it just created, so no listing read is needed for it.
- Plan-close coverage (`coverageOfFailedDimensions`, corpus-service.ts): every failed dimension has at least one entry for that dimension whose issue is open on GitHub, read per issue number (single-issue read, never only the paginated listing); a closed or unreadable issue does not cover (unreadable → refusal naming the issue and the read error, never a pass).
- `known-defect` link type: retired — `lore link --type known-defect` refused (exit 4) naming `extra.known_defects`; the link type is removed by the same schema migration that converts the links (see Migration), so no link of a removed type can remain.
- Migration: a corpus schema migration (the next store migration number after main's latest; run by `lore migrate schema`, which `lore integrate` runs after landing) converts every plan → task `known-defect` link into entries (issue ref from the target's report ref). Source of the dimension and fingerprint, in order: the target's `extra.milestone_findings` (one entry per element); else the `Dimension:` and `Root-cause fingerprint:` lines lore's own filer writes into the issue body, which the mirror's content holds verbatim (one entry); the migration prints which source each conversion used. It deletes the links and removes the link type, in one transaction. reads link targets whether or not they are soft-deleted. If any link is unconvertible (no issue ref, or neither source yields a valid dimension) the migration fails before writing, naming each link, so the corpus stays on the previous schema — never a partial conversion. Because a failed schema migration blocks every command on that corpus, the landing runs the conversion's check against a copy of the live corpus first and lands only when it reports zero unconvertible links. Measured 2026-10-25: 46 links; 44 carry findings; task-gh-1343388703-340 and -348 carry none but their content holds `Dimension: spec_conformance` / `Dimension: concurrency_safety` with fingerprints, so all 46 convert. This conversion is corpus-only and independent of `lore issues migrate` (which writes GitHub and needs the owner's approval), so there is no window in which both models exist.
- Display: `lore get <plan>` shows a "Known defects" section (issue, dimension, live state); `lore issues` shows such an issue as `open` (no carrier) unless someone adopts it.
- The interim port on land-gs (ad-hoc draft carrier in assess-file-issues.ts, carrier refs in coverage) is replaced by this design before land-gs lands.

Out: adopting a known defect as work (unchanged: `lore issue adopt`); the milestone review's dimensions and fingerprints (unchanged).

## Design Decisions

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| D1 | Where a known defect lives | the plan's `extra.known_defects` (owner, 2026-10-25) | a carrier task per issue (+ link); keep mirror tasks | a known defect is a fact about the plan, not work; filing creates no document (GS D7); no orphan drafts |
| D2 | Dimension per entry | each entry names one dimension | dimensions on a shared carrier | an issue covers only the dimension it was filed for |
| D3 | Open-state read | per issue number | listing only | a just-filed issue may be missing from the listing (#402) |
| D4 | Concurrency | append with the plan's expected version; a lost race re-reads and re-appends (idempotent by key) | unconditional write | two batches or sessions may file for one plan |
| D5 | Old links | converted by a corpus schema migration in the same transaction that removes the type | convert inside `lore issues migrate`; keep both | `lore issues migrate` waits for the owner (GitHub writes), which would leave a window with two models |

## Acceptance Criteria

Declared with `lore ac add`:
- AC-KD-1 schema: plan-only, keyed (repo_id, number, dimension), dimension validated.
- AC-KD-2 filing: one entry per failed dimension, no document or link created, a just-created issue absent from the listing still recorded, dedupe by fingerprint, concurrent appends both land.
- AC-KD-3 coverage: per dimension, per issue read by number; closed or unreadable issue refuses naming it.
- AC-KD-4 schema migration: findings source and body-line source both convert, soft-deleted targets read, one unconvertible link leaves the corpus byte-identical, link type gone.
- AC-KD-5 display and archive: Known defects section on the plan; archiving the plan closes none of them.

## Structure

```
packages/core/src/ (schema: known_defects on plans)
packages/lore/src/service/issue-filing-service.ts, packages/lore/src/adapters/cli/assess-file-issues.ts (append entries, no doc)
packages/lore/src/service/corpus-service.ts (coverageOfFailedDimensions; known-defect link refused)
packages/lore/src/store/migrations/migration-<next>.ts (link -> entries, link type removed; one transaction)
packages/lore/src/adapters/cli/commands/get*.ts or the plan renderer (Known defects section)
```


## Acceptance Criteria (structured)

- [⚑] [script] AC-KD-1: Schema: a plan's extra.known_defects accepts [{repo_id, number, dimension, fingerprint}] with a valid milestone dimension; the same field on a task, spec or knowledge doc is refused naming extra.known_defects; a duplicate (repo_id, number, dimension) and an unknown dimension are refused naming the entry (describe 'AC-KD-1'). Falsifier: drop the doc-type check -> the task case goes red.
  script: test — f=$(mktemp); bun run test:file packages/core/tests/unit/known-defects-schema.test.ts -t 'AC-KD-1' > "$f" 2>&1; rc=$?; tail -6 "$f"; [ $rc -eq 0 ] && grep -qE 'Tests +[1-9][0-9]* passed' "$f" && echo 'AC-KD-1 PASS: known_defects is a plan-only, keyed, validated record'
  other_command=3
- [⚑] [script] AC-KD-2: Filing through the review batch with a fake judge and a fake issue port: a plan failing regression and security with two different fingerprints files two issues and its record gains exactly one entry per failed dimension; findings of two dimensions sharing one fingerprint file ONE issue and add two entries for it; the corpus document count and link count are unchanged (no task, no link created); a just-created issue absent from the port's open listing is still recorded (its number comes from the create call); a second batch with the same fingerprint while the issue is open files nothing and adds no duplicate entry; two concurrent appends to one plan both land (describe 'AC-KD-2'). Falsifier: create a carrier task on filing -> the document-count case goes red.
  script: test — f=$(mktemp); bun run test:file packages/lore/tests/integration/plan-progress.test.ts -t 'AC-KD-2' > "$f" 2>&1; rc=$?; tail -6 "$f"; [ $rc -eq 0 ] && grep -qE 'Tests +[1-9][0-9]* passed' "$f" && echo 'AC-KD-2 PASS: filing records known defects on the plan and creates no document'
  other_command=3
- [⚑] [script] AC-KD-3: Plan-close coverage with per-number issue reads: failed {regression, security} and entries #50/regression (open) and #51/security (open) -> covered; #50/regression only -> refused naming security even though #50 is open; #51 closed -> refused naming #51; #51 unreadable (read error) -> refused naming #51 and the error, never a pass; #51 missing from the listing but open by its own read -> covered (describe 'AC-KD-3'). Falsifier: ignore the entry's dimension -> the regression-only case goes red.
  script: test — f=$(mktemp); bun run test:file packages/lore/tests/unit/service/known-defect-coverage.test.ts -t 'AC-KD-3' > "$f" 2>&1; rc=$?; tail -6 "$f"; [ $rc -eq 0 ] && grep -qE 'Tests +[1-9][0-9]* passed' "$f" && echo 'AC-KD-3 PASS: coverage is per dimension, per issue, read by number'
  other_command=3
- [⚑] [script] AC-KD-4: Schema migration over a fixture corpus: a plan -> task known-defect link whose target carries milestone_findings for regression and security becomes two plan entries; a link whose target has no findings but whose content has 'Dimension: concurrency_safety' and 'Root-cause fingerprint: <fp>' lines becomes one entry with that dimension and fingerprint; a soft-deleted target converts the same way; links are gone and the link type no longer exists; adding one link whose target has neither source makes the migration return an error naming that link and leave the corpus byte-identical (schema version unchanged, other links unconverted); afterwards compiled 'lore link <plan> <task> --type known-defect' is refused as an unknown type (describe 'AC-KD-4'). Falsifier: convert link by link and skip the unconvertible one -> the byte-identical case goes red.
  script: e2e — f=$(mktemp); bunx --bun vitest run packages/lore/tests/integration/cli/known-defects-migrate.bun.test.ts -t 'AC-KD-4' > "$f" 2>&1; rc=$?; tail -8 "$f"; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' "$f" && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' "$f" && echo 'AC-KD-4 PASS: known-defect links converted atomically by the schema migration, type removed'
  other_command=3
- [⚑] [script] AC-KD-5: Compiled 'lore get <plan>' with a stub gh: a plan with entries #50/regression (open) and #51/security (closed) prints a Known defects section listing both with their dimension and live state; archiving that plan closes neither issue (no close call in the stub log) (describe 'AC-KD-5'). Falsifier: put known defects into extra.issues -> the archive case records a close call and goes red.
  script: e2e — f=$(mktemp); bunx --bun vitest run packages/lore/tests/integration/cli/plan-known-defects-display.bun.test.ts -t 'AC-KD-5' > "$f" 2>&1; rc=$?; tail -8 "$f"; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' "$f" && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' "$f" && echo 'AC-KD-5 PASS: known defects shown on the plan and never closed by its archive'
  other_command=3
