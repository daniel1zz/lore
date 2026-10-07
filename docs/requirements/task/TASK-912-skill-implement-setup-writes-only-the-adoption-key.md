---
id: TASK-912
type: task
role: plan
title: "[Skill:implement] setup writes only the adoption key (no frozen default budgets) + findings/comment cleanup"
status: archived
priority: high
phase: "Phase 3: Dogfood & verify"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
links:
  - {id: TASK-881, type: blocks}
---
Estimate: S
Approach: in adapters/cli/commands/setup.ts writeAdoptionModeToConfig, stop round-tripping the parsed+defaulted config. Read the RAW .lore/config.yaml text, add only `adoption: <mode>` under context.memory_files (creating `context:`/`memory_files:` if absent) with the repo's existing YAML library (check package.json for `yaml`; use its Document API to preserve comments/order), then validate the result with loadConfig before writing (fail loud on parse/validation error). Keep the "kept" path when adoption already exists. Also: remove the never-set `downgraded_reference` field from AdvisoryFinding (claude-md-findings.ts) or set it where a downgraded finding carried `reference` — pick whichever keeps tests green and document; update the stale context-flow.ts comment that says advisory output is "computed and discarded".
Source: lore assess knowledge-assessment-claude-md-root-section-structure-check-and (gaps: frozen defaults, unused field, stale comment); plan D7
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-STR-11

AC:
- Write the new test file FIRST and record a captured red run (`--result expected-fail --capture --ac AC-STR-11`), then fix.
- `cd packages/lore && bun test tests/integration/setup-adoption-config-write.bun.test.ts tests/integration/setup-claude-md-adoption.bun.test.ts` pass; `bunx vitest run packages/lore/tests/unit/flows/setup-project-claudemd.test.ts packages/lore/tests/unit/flows/context-flow.test.ts packages/lore/tests/unit/flows/context-flow-adoption.test.ts packages/lore/tests/integration/status-claude-md-adoption.test.ts` pass; `bun run typecheck` exit 0.
