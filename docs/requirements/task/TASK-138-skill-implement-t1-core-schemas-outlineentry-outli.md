---
id: TASK-138
type: task
role: plan
title: "[Skill:implement] T1 core schemas: outlineEntry/outline_budget/prd_sync_exempt + SPEC_KINDS domain-overview + verification profile"
status: draft
priority: critical
phase: "Phase 1: Core schemas & outline writer"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-136, type: blocks}
  - {id: TASK-132, type: blocks}
  - {id: TASK-128, type: blocks}
---
Estimate: M
Approach: mirror acceptance.ts (AC-as-code SSOT) module shape — new packages/core/src/outline.ts owns outlineEntrySchema/outlineBudgetSchema/prdSyncExemptSchema + z.infer types; SPEC_KINDS literal extension in schemas.ts; workflow.verification_profiles.domain-overview default in config.ts WorkflowConfigSchema.
Source: SPEC-080 C1 (OutlineEntry TS shape), C2 (SPEC_KINDS + profile), C3 (outline_budget incl. extra_prose_chars default 1000)
Dimensions: D-FUNC, D-CODE
Scope-Alt: verification profile default may ship as config-schema-only (no seeded template) if SPEC-058 template seeding proves out of scope.
Covers: AC-080-3

AC:
- Given outline.ts exported schemas, When `bun run typecheck` runs, Then exit 0 and dashboard barrel-safety grep (fs/path/os/pinyin-pro in core index chain) reports 0 hits.
- Given SPEC_KINDS, When grepped, Then exactly one definition site lists feature|tech|design|domain-overview, and a documented grep sweep of all SPEC_KINDS consumers is recorded in the task evidence (R4 mitigation).
- Given T1r RED suite, When run post-implementation, Then all GREEN.
- Given `lore create spec --kind domain-overview --parent <prd>` on a throwaway corpus, When executed, Then exit 0 (AC-080-3 half); `--kind bogus` exits 4.

Integration: schemas are imported by PrdOutlineService (T2), budget check (T4), predicate (T5) — export via @lore/core barrel (browser-safe, no Node imports).
