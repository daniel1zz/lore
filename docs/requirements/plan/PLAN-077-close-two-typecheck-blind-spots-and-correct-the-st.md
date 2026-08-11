---
id: PLAN-077
type: plan
role: plan
title: "Close two typecheck blind spots and correct the stale comments that understate them"
status: draft
priority: medium
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: SPEC-132
phases:
  - {name: "coverage", description: "One e2e tsconfig project wired into the typecheck chain, plus an explicit route-tree prerequisite, with both stale comments corrected"}
---
# Goal

Typecheck the 27 `.ts` files under `packages/dashboard/tests/e2e` that no tsconfig project currently resolves, and remove the positional dependency that makes `typecheck:dashboard-tests` lie on a fresh clone.

⛔ Both gaps are already described in comments, and one understates itself by 13x ("two helper files" vs a measured 27). Correcting each comment is part of the same unit as closing its gap.

⛔ C2's red already exists and needs no new code: with `routeTree.gen.ts` moved aside, `bun run typecheck:dashboard-tests` exits 2 with 24 errors (21 TS2345, 2 TS7006, 1 TS2307), measured 2026-08-10.
