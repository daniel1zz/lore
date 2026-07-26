---
id: TASK-186
type: task
role: plan
title: "[Skill:implement] T2 ownership schema + manifest version fields + AssetSource declaration"
status: archived
priority: critical
phase: "Phase 1: Foundation"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-040
plan: PLAN-040
links:
  - {id: TASK-185, type: blocks}
  - {id: TASK-181, type: blocks}
  - {id: TASK-180, type: blocks}
---
Estimate: M
Approach: Additive Zod: assetFileSchema + setupEntrySchema gain ownership: z.enum(["managed","merged","user_once"]).optional(); setupManifestSchema top-level gains binary_version/installed_at/assets_digest (all optional). RealAssetSource (setup-args.ts) declares ownership per asset at load time (skills/hooks/agents/governance/project scripts → managed; settings-hook/gitignore → merged; config+tree templates → user_once; CLAUDE.md template → managed-marker handled by T6, declare "merged" for now with comment). Document kind∩ownership valid pairings as invariant I6 in setup-service.ts module header. Legacy manifest without ownership: derive-from-kind once at read with single stderr note.
Source: SPEC-076 §C1 §C4, D8; Domain review (explicit declaration, never inference)
Dimensions: D-FUNC, D-CODE
Scope-Alt: legacy derive-from-kind note can be silent if stderr wiring is awkward at that seam
Covers: AC-076-6 (schema half — field presence/parse)

AC:
- Given a pre-SPEC-076 manifest JSON (no new fields), When setupManifestSchema.parse runs, Then it succeeds and existing setup tests stay green (I3 regression)
- Given RealAssetSource.load(), Then every returned AssetFile carries a non-undefined ownership and each (kind, ownership) pair is in the documented I6 set (unit test enumerates)
- Given an unknown ownership string in a manifest entry, When parsed, Then Zod rejects loud (VALIDATION_ERROR path), never silent-defaults
- Integration: bunx vitest run packages/lore/tests/unit/core/setup-manifest.test.ts (or the file's existing home) green; tsc clean
