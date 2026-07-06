---
id: PLAN-012
type: plan
role: plan
title: "SPEC-032 Implementation — output-contract mechanization"
status: archived
priority: high
created: 2026-07-06
updated: 2026-07-06
tags: [spec-032, implementation]
parent: SPEC-032
phases:
  - {name: "taxonomy", description: "spec_kind enum + default + CLI + migrate audit"}
  - {name: "blueprint", description: "lore.tree.yaml authoring + arming check-tree"}
  - {name: "splice", description: "resolve_mdx revival + renderResolvedToMarkdown + get/export consumers"}
  - {name: "readiness", description: "ready() upstream_unapproved advisory"}
---
Implementation plan for SPEC-032 (approved v4). Execution order driven by file-anchor mutex: T1 first (corpus-service.ts writer), then T2/T4/T5 in parallel worktrees, then T3 (corpus-service.ts again). Oracle: AC-8 = tsc + both test runners green. Closeout: lore assess per PRD §14.6 self-hosted gate convention.
