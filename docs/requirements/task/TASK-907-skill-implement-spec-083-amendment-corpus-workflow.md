---
id: TASK-907
type: task
role: plan
title: "[Skill:implement] SPEC-083 amendment — corpus-workflow prose becomes shipped fragments, governance topic retired"
status: archived
priority: high
phase: "Phase 3: Surfaces & wiring"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-910, type: blocks}
  - {id: TASK-906, type: blocks}
  - {id: TASK-904, type: blocks}
  - {id: TASK-902, type: blocks}
---
Estimate: L
Approach: per spec D9. (1) Split assets/governance/corpus-workflow.md into shipped static `main` fragments under assets/context/*.md (one per H2 section, id prefix `corpus-workflow-`, audience [main], mode static, text verbatim). (2) Delete assets/governance/corpus-workflow.md. (3) commands/governance.ts: drop 'corpus-workflow' from GOVERNANCE_TOPIC_ASSETS; `lore governance corpus-workflow` and the no-topic default exit non-zero with stderr naming `lore fragments`; seat-briefing / bootstrap-framing / claude-md unchanged. (4) Every other reference, enumerated (grep `corpus-workflow` outside generated/): report-issue-hint.ts:31, setup-check.ts:71, setup-project-flow.ts:517 (comments → name assets/context fragments, file:symbol form); scripts/ac-ref-exemption-ledger.json entry; tests governance-bootstrap-framing-compiled, governance-claude-md-compiled, governance-compiled, npm-install-simulation, real-setup-ports, setup-render, setup-service, setup-governance-retirement → re-baseline. NOT yours: context-flow.ts:216 (refresh task), real-asset-source.ts / assemble.ts (assets-dist task, already landed before you), tests/e2e/context-provenance-compiled + resume-coverage-compiled (hooks-session task). (5) For EVERY re-baselined assertion record in `lore evidence` notes: original command, exact failure, why this is a correction (SPEC-083 amended by D9) not a weakening. (6) Regenerate assets manifest.
Source: spec D9; lore get spec-083-governance-prose-runtime-injection-retire-the
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CF-17

AC:
- `cd packages/lore && bun test tests/e2e/context-fragments-compiled.bun.test.ts -t 'AC-CF-17'` → ≥1 pass, 0 fail.
- `grep -rln corpus-workflow packages scripts hooks assets` (excluding generated/ and node_modules) lists only files owned by refresh / hooks-session tasks or none.
- The 8 listed test files pass under their runner; `bun scripts/embed-assets-manifest.mjs --check` exit 0.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
