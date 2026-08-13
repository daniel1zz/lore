---
id: TASK-071
type: task
role: plan
title: "T5 projection: AC checklist in get non-raw + export-docs"
status: archived
priority: medium
phase: "assess-projection"
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-018
plan: PLAN-018
links:
  - {id: TASK-070, type: blocks}
---
Objective: text-projection rendering of structured ACs (SPEC-032 seam).
Spec: SPEC-038 §6 (projection half). ACs covered: AC-ACODE-9.
Work:
1. Locate the SPEC-032 renderResolvedToMarkdown splice seam (adapter-level, NOT CorpusService — see packages/lore/src/service/CLAUDE.md). Append "## Acceptance Criteria (structured)" checklist after spec body for CLI get non-raw AND export-docs body: one line per AC — [mode] id: statement (+ verify binding: oracle+command / rubric / note); when the spec has a plan with tasks, prefix each line ✔ (any pass, no fail) / ✘ (any fail) / · (no evidence) from computeAcCoverage.
2. get --raw MUST NOT render the block (raw = stored content only).
3. Tests: projection with/without structured ACs; raw untouched; export-docs roundtrip stability (export-index drift check unaffected).
Oracle: bun run typecheck + both runners (affected).
Depends: T1. File anchors: the SPEC-032 projection module + export-docs command file + matching tests (identify exact paths at execution; declare them in evidence). No overlap with T4 anchors.
