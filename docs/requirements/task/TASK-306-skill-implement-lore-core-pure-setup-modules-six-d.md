---
id: TASK-306
type: task
role: plan
title: "[Skill:implement] @lore/core pure setup modules + six-dimension test (AC-046-A)"
status: archived
priority: critical
phase: "core-pure"
created: 2026-07-16
updated: 2026-07-16
tags: []
parent: PLAN-033
plan: PLAN-033
links:
  - {id: TASK-304, type: blocks}
  - {id: TASK-305, type: blocks}
---
Estimate: M
Approach: Implement three PURE, browser-safe @lore/core modules (Zod only, NO node builtins) + export from the default barrel + one six-dimension vitest. Follow the code-anchors.ts / file-anchors.ts pure-module precedent.
Source: SPEC-046 Design (@lore/core pure layer); barrel-safety rule from root CLAUDE.md.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none — all three modules are consumed by the services phase.
Covers: AC-046-A

Modules:
- setup-manifest.ts — `setupEntrySchema`/`setupManifestSchema` (Zod; SetupEntry {path, kind: skill|agent|hook|governance|settings-hook|mcp, sha256, written_at}); `planInstall(currentManifest, payload, existingFiles) => InstallPlan {writes, skips, backups, removals}` (PURE — params only, never reads fs).
- merge-settings.ts — `mergeSettings({existing, loreEntries}) => Result<object>` (NARROW input — never the manifest object). Malformed existing JSON → err(VALIDATION_ERROR).
- register-mcp.ts — pure MCP args builder for `claude mcp add -s user lore -- lore --mcp-server` (and the remove args).
- barrel: re-export all three from packages/core/src/index.ts (pure → default barrel is correct; keep node-free).

AC:
- Given `bunx vitest run packages/lore/tests/unit/core/setup-pure.test.ts`, When it runs, Then it exits 0 with six-dimension coverage across all three modules.
- Given a malformed `existing` settings string, When `mergeSettings` is called, Then it returns `err` with code VALIDATION_ERROR and produces NO partial object (I1 pure-half).
- Given a currentManifest + payload + existingFiles where some files already match, When `planInstall` runs, Then matching entries appear in `skips` (not `writes`) and to-be-overwritten files appear in `backups` (I2 pure-half).
- Given the register-mcp builder, When invoked, Then it yields the exact argv `["mcp","add","-s","user","lore","--","lore","--mcp-server"]` (add) and the corresponding remove argv.
- Dimensions: HAPPY/NEGATIVE(malformed→err)/BOUNDARY(empty manifest, empty payload)/ERROR/STATE(skip vs write vs backup partition)/REGRESSION.
- Oracle: `bunx vitest run packages/lore/tests/unit/core/setup-pure.test.ts` exits 0.
