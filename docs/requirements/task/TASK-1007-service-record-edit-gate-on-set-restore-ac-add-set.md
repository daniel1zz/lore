---
id: TASK-1007
type: task
role: plan
title: "Service: record-edit gate on set/restore/ac add-set-remove + correction exit across CLI/MCP/HTTP"
status: archived
priority: medium
phase: "core-and-gate"
created: 2026-10-11
updated: 2026-10-18
tags: []
parent: PLAN-160
plan: PLAN-160
links:
  - {id: TASK-1006, type: blocks}
  - {id: TASK-1003, type: blocks}
  - {id: TASK-920, type: resolves}
  - {id: TASK-1206, type: resolves}
  - {id: TASK-1187, type: resolves}
---
Covers: AC-DR-2, AC-DR-3, AC-DR-10. Spec: spec-documents-are-living-or-records-a-locked-record-is-never D4, D6, D8, D10–D17, §Concurrency. (1) RecordLockService: facts (ever-approved from version history; ever-claimed from audit claim actions excluding a claim rolled back by its own failed write — VERIFY the rollback's audit shape at task-workflow-service.ts ~2859 first; member-plan status; NO evidence query here — reopen owns it) + assertEditable(doc, op, patch). (2) checkpoint 'record-edit' in checkpoint-registry.ts: GateContext fields, feed() rendering the change paths per kind WITHOUT mentioning lore reopen (the reopen task adds that clause — D18), PREDICATE_CONTRACTS entry, explicitly excluded from ALL_GATE_CHECKPOINTS like task-create; config workflow.gates."record-edit".enabled default on, disabled → existing config_disabled skip audit. (3) Call assertEditable BEFORE any write in: CorpusService.set — trigger on body/title DIFFERENT from stored (D14) and on extra.sub_type change (D13); VersionService.restore; AcService add/set/remove (cite untouched) and rewrite ac-service.ts header's 'ac add does not demote' note (D12); PhaseService add/rm/rename when the member plan is archived|deprecated (D16). (4) Correction: SetOptions.correction {reason} non-empty, bypasses gate, writes EXACTLY one version (no BR-722 demotion, no ledger re-approve second write — D15), reason in change_summary + audit. Wire it through set.ts (BOTH call sites ~420 and ~638), MCP lore_set (~1804) AND lore_batch set (~3532 — destructure correction like by, never spread into the patch), routes.ts update (~800), dashboard-routes.ts PATCH (~317); dashboard restore (~551) is refused through VersionService. (5) RecordLockService is a REQUIRED constructor dependency of CorpusService, VersionService, AcService, PhaseService; wire in app.ts (D17). Red-first per test file, expected-fail evidence at the red run.
 (6) Rewrite the stale demotion-notice comments in commands/ac.ts ~989-1000 and phase-service.ts ~422 ("log, do NOT demote" about ac add) to state that ac add/set/remove on a locked spec is refused.
