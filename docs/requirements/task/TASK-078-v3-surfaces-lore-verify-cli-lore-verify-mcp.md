---
id: TASK-078
type: task
role: plan
title: "V3 surfaces: lore verify CLI + lore_verify MCP"
status: archived
priority: high
phase: "surfaces"
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-019
plan: PLAN-019
links:
  - {id: TASK-076, type: blocks}
---
Objective: expose the runner on both agent-facing surfaces. ACs: AC-VRF-2 (adapter half), AC-VRF-10.
Work:
1. NEW packages/lore/src/adapters/cli/commands/verify.ts — lore verify <plan> [--ac <id> repeatable] [--task <t>] [--json] [--by]; thin pipe onto VerifyRunnerService.verifyPlan; render per-AC line (pass/fail/timed_out + duration) + skipped ai/human list + draft-spec warning passthrough; exit 0 all pass, exit 1 any fail, exit 4 validation (ambiguous task etc.), exit codes per SPEC-003 utils exitCode() SSOT — read it, follow system truth. Register in CLI loader.
2. packages/lore/src/adapters/mcp/tools.ts — NEW lore_verify {plan, ac?: string[], task?, by} (24th tool; by REQUIRED like other SPEC-025 tools; follow existing pre-declared schema style — ADR tsc-OOM constraint, no inline mega-shapes). Confirm lore_evidence_add path rejects attestation-carrying input (service does it; add adapter test).
3. Tests: integration CLI (throwaway corpus, real spawn of a trivially-true command like "true" is acceptable here — one fast happy path; everything else via unit with injected doubles where the CLI construction allows, else subprocess asserts on exit codes/output): happy, --ac filter, ambiguous-task exit 4, no-script-ACs notice, draft-spec warning line, forged-attestation rejection. MCP: schema roundtrip + handler arg threading (spy style per mcp-tools-task-workflow.test.ts precedent).
Oracle: bun run typecheck + both runners (affected).
Depends: V2 merged. File anchors: packages/lore/src/adapters/cli/commands/verify.ts (new), CLI loader/index, packages/lore/src/adapters/mcp/tools.ts, mcp/CLAUDE.md + cli/CLAUDE.md, matching tests. ⛔ do not touch ai/ or service/ (V4 parallel owns ai/; service is frozen post-V2).
