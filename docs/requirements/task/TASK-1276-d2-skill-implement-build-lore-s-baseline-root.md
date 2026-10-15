---
id: TASK-1276
type: task
role: plan
title: "[D2] [Skill:implement] build lore's baseline root, specification branch and leaves through the CLI"
status: archived
priority: high
phase: "Phase D: specification-branch pilot"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1275, type: blocks}
---
Estimate: M
Approach: re-verify each rule of `knowledge-specification-branch-baseline-draft-from-experiment` against current main (code or a throwaway corpus); create `baseline-root` (node=root, parent root PRD) → branch `specification` → leaves with `lore baseline add`; allocate every rule with `lore rule add` (never hand-written ids); branch glossary via `lore baseline glossary add`; excavated-intent rules use confidence `observed`.
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`). §C8 step 2
Covers: AC-BLS1-11 (precondition)

AC:
- Precondition: on merged main, `bun run build` exit 0 and `./dist/lore baseline --help` lists add, set-label, depends, glossary, tree; `./dist/lore rule --help` lists add, set; `./dist/lore ac --help` lists cite. Use that binary (or the installed one after it is refreshed) for every write.
- `lore status --check-baseline` exit 0 after the build.
- `lore baseline tree --states` lists the branch with ≥ 1 leaf and every leaf's rule count; 0 rules carry ids not issued by the registry.
- BL-11 lint warnings on the pilot rules are listed in the task evidence (count + tokens).
