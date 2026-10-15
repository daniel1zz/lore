---
id: TASK-1337
type: task
role: plan
title: "[Skill:implement] Expand variables in installed assets and hash the same bytes"
status: archived
priority: medium
phase: "Phase 2: Shipped assets and literal lint"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
links:
  - {id: TASK-1330, type: blocks}
  - {id: TASK-1334, type: blocks}
---
Estimate: M
Approach: expand in RealAssetSource.load() for kinds skill|agent|hook (outlet asset:install, LORE_CONTEXT_VARIABLES); scripts/embed-assets-manifest.mjs hashes the same loaded bytes (imports the pure expander + registry; revise its "no @lore/core coupling" header); update assets-ssot parity to compare against expanded bytes; regenerate packages/lore/src/generated/assets-manifest.ts with the script (never by hand).
Source: spec D6; packages/lore/src/adapters/real-asset-source.ts (~92, ~316); scripts/embed-assets-manifest.mjs (~37-40, ~210, ~222, ~240)
Covers: AC-CV-4, AC-CV-5

Also: put {{lore:capture_tail_chars}} into assets/skills/lore/SKILL.md near the `--output-tail` usage (~line 69: 'only the last {{lore:capture_tail_chars}} characters are kept') — the first installed-kind use the ACs exercise; make the manifest script refuse '{{lore:' in governance/project assets (they install byte-for-byte).

AC:
- AC-CV-4 and AC-CV-5 commands exit 0; assets-ssot and embed-assets-manifest tests exit 0; `bun scripts/embed-assets-manifest.mjs --check` exit 0; `bun run build` exit 0.
