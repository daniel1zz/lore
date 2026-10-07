---
id: TASK-918
type: task
role: plan
title: "[Skill:test] D15 RED — static fragments as lore rules files, outlet rename, re-baseline"
status: archived
priority: critical
phase: "Phase 3: Surfaces & wiring"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
---
Estimate: M
Source: spec D15 (approved v50) + revised AC-CF-4, 6, 8, 12, 13, 15, 14, 19, 21 statements (`lore ac list spec-context-fragments-config-driven-layered-rule-injection`)
TDD-Role: red | Paired-Impl: task-skill-implement-d15-static-fragments-as-lore-rules-files
Scenarios (re-baseline existing tests to the D15 contract; keep every describe name's AC id):
- Outlet ids renamed claude-md:project → rules:project, claude-md:user → rules:user everywhere tests reference them (core context-fragments.test.ts, select.test.ts, fragments-flow.test.ts).
- AC-CF-6 (e2e): after refresh each winning static main fragment exists as .claude/rules/lore-<id>.md with first line `<!-- lore:managed fragment=<id> hash=<8hex> -->` and verbatim body; CLAUDE.md has no fragments section; hand-edited lore rules file → diverged_skip + bytes unchanged; fragment removed from project layer → its file pruned while a non-lore .claude/rules/team.md control is byte-unchanged.
- AC-CF-15 (e2e): --scope user writes <HOME>/.claude/rules/lore-<id>.md for user-layer static main fragments only; <HOME>/.claude/CLAUDE.md and <HOME>/.claude/rules/mine.md byte-unchanged.
- AC-CF-4 / AC-CF-12 (e2e): drift/staleness is about .claude/rules/lore-*.md (changed, missing, or extra file), not a Z1 section.
- AC-CF-8 (e2e) + resume-coverage AC-RC-8 + context-provenance AC-CP-7/9: the governance sentinel / disposition text must be found in a project .claude/rules/lore-corpus-workflow-*.md file (not CLAUDE.md Z1).
- AC-CF-13 (unit refresh-cas): CAS conflict on a lore rules file; refresh-idempotence: two refreshes → identical rules files and identical CLAUDE.md.
AC:
- All re-baselined tests run RED against current main for the missing D15 behaviour (not harness errors); record expected-fail evidence per file at that moment, each with original assertion + why-correction (D15 owner decision).
