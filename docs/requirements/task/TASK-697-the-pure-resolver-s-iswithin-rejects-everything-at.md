---
id: TASK-697
type: task
role: plan
title: "The pure resolver's isWithin rejects everything at the filesystem root, so each caller must route around it"
status: archived
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Raised by `lore assess` on plan-land-corpus-resolution-provenance-one-pure-resolver-one (minor, AC-CP-1), and independently discovered by the AC-CP-2 implementer while building the CLI adapter, which is why the workaround already exists in the tree.

## The defect

`packages/core/src/corpus-provenance.ts`'s `isWithin(root, candidate)` normalizes `root` and then tests `candidate === root || candidate.startsWith(root + "/")`. When `root` is the filesystem root `"/"`, `stripTrailingSlash` leaves it as `"/"` and the test degrades to `startsWith("//")`, which no real path satisfies. So a `callerTreeRoot` of `"/"` rejects every candidate, and the resolver reports a miss for a walk that should have succeeded.

The CLI adapter already works around this: `packages/lore/src/adapters/cli/corpus-resolution.ts` supplies `highestNonRootAncestor()` instead of `"/"`, and documents why. The workaround is correct for that caller and was verified against the pre-existing `gate-bypass-audit.test.ts` non-git-tmpdir case.

## Why it still needs fixing

The pure resolver is the SHARED surface. §D1's whole point is that the policy has exactly one attachment site. A trap that each caller must remember to route around is the opposite of that: the next consumer — MCP already calls `resolveCorpus`, HTTP is named in the same table — will re-hit it, and the failure mode is a silent miss rather than an error.

## What must land

1. `isWithin` handles `root === "/"` correctly, so a `callerTreeRoot` of `"/"` behaves like a real boundary rather than rejecting everything.
2. `highestNonRootAncestor` and its explanatory comment are deleted from `corpus-resolution.ts`, with the CLI passing the real root through.
3. A test pins the `"/"` case directly on the pure resolver, and a control proves it discriminates — a resolver that rejects everything must still go red.
