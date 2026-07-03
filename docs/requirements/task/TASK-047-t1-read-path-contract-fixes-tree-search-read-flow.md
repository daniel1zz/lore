---
id: TASK-047
type: task
role: plan
title: "T1: read-path contract fixes (tree/search) + read-flow e2e (AC-1/2/3/4/6)"
status: archived
priority: high
created: 2026-07-03
updated: 2026-07-03
tags: [spec-031]
parent: PLAN-011
plan: PLAN-011
---
Adapt frontend to real backend envelopes. Files: packages/dashboard/src/lib/api.ts (TreeNode, SearchResponse, apiTree, apiSearch), src/components/DocTree.tsx, src/routes/tree.tsx, src/routes/search.tsx, tests/component/DocTree.test.tsx, search route tests, NEW tests/e2e/read-flow.pw.ts. Backend is SSOT; no backend changes. Oracles: typecheck + vitest + playwright.
