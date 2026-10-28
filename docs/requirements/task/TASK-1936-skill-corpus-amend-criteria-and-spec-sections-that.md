---
id: TASK-1936
type: task
role: plan
title: "[Skill:corpus] Amend criteria and spec sections that list MCP beside other surfaces"
status: archived
priority: medium
phase: "Phase 3: Reconcile the corpus"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1933, type: blocks}
---
Estimate: L
Approach: main agent, corpus commands only, after T6 lands. Amend criteria and spec sections that list MCP beside other surfaces: `lore ac set <spec> <AC-ID> --statement …` dropping the MCP half (record the original text on the AC per the AC-design rule), or `lore set --correction` on a locked doc; then `lore review` + `lore approve` per demoted spec. Skip lore-81's docs (I5).
Source: corpus map of 2026-10-27.
Dimensions: D-CORPUS
Scope-Alt: wording-only mentions (≈40 specs that only list "CLI/MCP/HTTP" in prose) stay as historical text
Covers: (supporting the spec's Goal: the corpus states no rule about a removed surface)

Criteria: 01M4QDF4MT AC-EH-9, AC-EH-11; 01KX01KEVS AC-VRF-2, AC-VRF-10; 01KYRC3F2G AC-CP-4; 01KYS2TZC5 AC-RC-4; 01M4QD3EH1 AC-AP-2; 01M4NFN7Q7 AC-DR-5; 01M4NN36Q3 AC-ROI-1; 01M5A80YV1 AC-HID-1; 01M4K3YM2D AC-BLC-1; 01M56MXNS4 AC-AU-3; 01KXG828W7 AC-RELEASE-ADVISORY; 01KYHREBH7 AC-WH-1; 01M4J2VJN1 AC-BLS3-3; 01M51E9YP1 AC-CRIT-6; 01KXX4R6JY AC-P-4; 01KZR7GP6C AC-JV-5, AC-JV-6; 01M59KW8XH AC-DC2-8; 01M59KWA2T AC-DC2-12; 01M59KWBA0 AC-DC2-18, AC-DC2-22; 01M59KWCK0 AC-DC2-25; 01M5P5H8H8 AC-RI-2, AC-RI-5; 01M5V0DG2S AC-MI-5; 01M5V1CPR2 AC-WP-7; 01M5V80SS3 AC-HC-5, AC-HC-9; 01M4N0D4VE AC-RID-5, AC-RID-15 (keep the Bash rewrite half), AC-RID-16 (statement → '…pre-tool-harness-run.mjs on PreToolUse for Bash…', drop 'and mcp__.*lore_.*'); 01KXMY4KVD (SPEC-046) AC-046-A (keep the setup-pure manifest/planInstall/mergeSettings half) and `lore anchor rm spec-spec-046-distribution-part-1-asset-ssot-local-safe-installe packages/core/src/register-mcp.ts`; 01M4ZDKPR3 AC-TE-1; SPEC-046 registration sections; spec-cli-adapter (SPEC-003) Phase-2 table; PRD-001 G4 / architecture / threat model.

AC:
- Each listed criterion's statement no longer names MCP and `lore verify <owning-plan> --ac <id>` still passes for it.
- Every demoted spec is approved again (`lore get <spec>` status approved).
