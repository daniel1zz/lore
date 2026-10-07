---
id: TASK-878
type: task
role: plan
title: "[Skill:test] structure check + CLI adoption surface — RED"
status: archived
priority: critical
phase: "Phase 1: Foundation"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
---
Estimate: S
Source: spec-claude-md-root-section-structure-check-and-adoption-mode (Public Interface, Definitions, D5) — AC-STR-1, AC-STR-2
TDD-Role: red | Paired-Impl: I1 (core + structure + composition + status)
Covers: AC-STR-1, AC-STR-2

Scenarios (unit, vitest, describe 'checkRootStructure' / 'checkModuleStructure'):
- Given a root file with all five H2 in order, When checkRootStructure, Then 0 deterministic findings.
- Given root missing '## Commands', Then exactly one section_missing with reference 'Commands'.
- Given Commands after Architecture, Then one section_order finding.
- Given '## Commands' twice, Then section_duplicate.
- Given '### Commands' or '## commands' instead of '## Commands', Then section_missing (H2-only, case-sensitive).
- Given a setext H2 ('Commands' underlined with '---'), Then it COUNTS as Commands (CommonMark).
- Given '## Commands' inside a ``` fence or an indented code block, Then it does NOT count.
- Given an extra '## North Star', Then advisory section_extra, 0 deterministic.
- Given a required section whose body is only blanks/HTML comments, Then advisory section_empty; with an H3 inside, Then no section_empty.
- Given a module file without '## Purpose', Then advisory module_section_missing.
- Signature check: checkRootStructure/checkModuleStructure accept (file, required) only.

Scenarios (integration, vitest, spawning the CLI in a mkdtemp repo — never this repo's .lore):
- adoption enforce + missing Commands → exit EXACTLY 3, stdout/stderr names section_missing and Commands, JSON data.claude_md.adoption.mode === 'enforce'.
- adoption warn, same file → exit 0, HUMAN output has a line starting 'WARN adoption=warn', JSON adoption.downgraded_count === 1, an advisory finding kind 'downgraded' with downgraded_kind 'section_missing'.
- adoption warn + over-ceiling root file → exit 0, downgraded_kind 'max_lines'.
- no adoption key → JSON adoption.mode 'warn', mode_source 'default'.
- warn + conforming file → promotable true, downgraded_count 0.

AC:
- Both test files exist and are executable under vitest.
- Run on the current base: every scenario RED for missing implementation (import/assertion failure), NOT a test bug. Record it at the moment it is red: `lore evidence <this-task> --oracle test --command "<cmd>" --result expected-fail --ac AC-STR-1` (and AC-STR-2).
