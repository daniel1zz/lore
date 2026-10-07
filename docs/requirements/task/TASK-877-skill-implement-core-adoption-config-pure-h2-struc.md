---
id: TASK-877
type: task
role: plan
title: "[Skill:implement] core adoption config + pure H2 structure check + composition + status surface"
status: archived
priority: critical
phase: "Phase 1: Foundation"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
links:
  - {id: TASK-870, type: blocks}
  - {id: TASK-868, type: blocks}
  - {id: TASK-872, type: blocks}
  - {id: TASK-875, type: blocks}
---
Estimate: L
Approach: per spec-claude-md-root-section-structure-check-and-adoption-mode §Public Interface / §Design Decisions D1,D2,D3,D5,D6,D10. Parse with mdast-util-from-markdown@^2.1.0 (heading nodes depth===2) + mdast-util-to-string@^4.0.0 (plan D2); add both to packages/lore/package.json only.
Source: existing pattern service/claude-md-admission.ts (pure, injected facts) + claude-md-findings.ts kinds; config defaults ONLY in core config.ts contextConfigSchema (.strict) and resolveMemoryFileBudgets (absent adoption → 'warn', mode_source 'default').
Dimensions: D-FUNC, D-CODE
Scope-Alt: section_empty advisory may be dropped if it blocks (spec Definitions keep it; record in Decisions Log if dropped).
Covers: AC-STR-1, AC-STR-2

Work:
- core: ROOT_REQUIRED_SECTIONS / MODULE_REQUIRED_SECTIONS constants (browser-safe, no IO), exported via core barrel; `memory_files.adoption: z.enum(['enforce','warn']).optional()`.
- service/claude-md-structure.ts (new, pure, mode-free): parseH2Headings, checkRootStructure(file, required), checkModuleStructure(file, required).
- findings: deterministic kinds section_missing | section_order | section_duplicate; advisory kinds section_extra | section_empty | module_section_missing | downgraded (with downgraded_kind).
- runMemoryFileChecks: call structure checks per role (root/module; never rules); apply adoption — in warn, move EVERY deterministic finding (all kinds) to advisory 'downgraded'; return adoption {mode, mode_source, downgraded_count, promotable}.
- render + status.ts: JSON data.claude_md.adoption; HUMAN prints advisory downgraded findings and a line starting 'WARN adoption=warn' every warn run. Corpus-free invariant I1 kept.
- Update packages/lore/src/service/CLAUDE.md module facts (one line, index-entry contract).

Re-pin existing enforce oracles (reviewer finding 1): absent `adoption` now resolves to warn and warn downgrades EVERY deterministic kind (user-confirmed 2026-10-07), so existing tests that assert exit 3 / deterministic refusal with no adoption key go red. The 15 existing test files added to this task's anchors (status-claude-md*, claude-md-wiring, pre-push(-claude-md)-trip, claude-md-guard-hook-trip, binary-provenance-check, claude-md-advisories/emphasis/rules-discovery/slug-pointers, memory-file-budget-provenance, context-flow, claude-md-eviction-floor/headroom) are yours: in each fixture that expects enforcement, write `adoption: enforce` explicitly (plan invariant I6). ⛔ Do not weaken an assertion to make it pass — if a test's intent was enforcement, pin enforce; if it asserted the default, assert the new default (warn, mode_source default). List every file you changed and why in the evidence note.

AC:
- `bunx vitest run packages/lore/tests/unit/service/claude-md-structure.test.ts packages/lore/tests/integration/status-claude-md-adoption.test.ts` → all pass (T1's RED tests turn green unchanged).
- `bun run typecheck` exit 0.
- Existing claude-md suites still green: `bun run test:changed main` PLUS, by hand, every file in this task's anchors (test:changed under-selects; `.bun.test.ts` via `cd packages/lore && bun test <file>`).
- Integration: `lore status --check-claude-md` (the production call site) is the surface exercised by AC-STR-2 — no new function without a live caller.
