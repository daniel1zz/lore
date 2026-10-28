---
id: KN-897
type: knowledge
role: knowledge
title: "Evicted from the service module doc: single write path consumers"
status: draft
priority: medium
created: 2026-10-23
updated: 2026-10-23
tags: []
---
Evicted verbatim from the module CLAUDE.md on 2026-10-23 (task G3: bring the file under its eviction floor). These are the pre-eviction lines; the module file keeps the rule and points here.

- ⛔ **One write route: `CorpusService.writeDoc` / `insertDoc` / `moveRule` / `allocateRule` / `assignOrdinalForRepair`** (AC-DCL-3) — foreign-corpus refusal, record lock, ONE `updateWithProvenance` transaction, version + audit row naming the CALLER (never `created_by`, never `system`), no-op writes nothing. `VersionService`, `MigrationService`, `OrdinalMigrationService`, `PhaseMigrationService`, `ValidityService`, `RuleService`, `PhaseService`, `TreeCheckService`, `RequirementService` take it as a `DocWritePort` and never call `store.update`/`insertVersion`/`appendAuditEntry`/`*WithProvenance` (`single-write-path.bun.test.ts` scans; unmigrated modules are pinned there). `restore` is append-only: it inserts an `action: "restore"` row, never deletes newer entries.
