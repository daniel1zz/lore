---
id: PLAN-126
type: plan
role: plan
title: "Land read-side reachability: enumerable trace counts, knowledge code anchors under check-drift, and a store-level sub-type filter"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: SPEC-140
phases:
  - {name: "reachable-facts"}
  - {name: "sub-type-filter"}
---
# Goal

Land the three mechanisms of
`spec-a-write-side-fact-with-no-read-side-address-counts-with-no` so every count
`lore trace stats` reports has an enumerable member list, a `knowledge` doc's
assertions about code are drift-checked, and the 9 knowledge sub-types are reachable
as a retrieval filter.

# Phases

**Phase 1 — reachable-facts.** Two tasks with DISJOINT file anchors, dispatched
concurrently.

- `lore trace stats --enumerate <field>` — M1, AC-RR-1/2/3. Mirrors `lore status
  --enumerate`'s registry contract exactly: the count is the list's length, an
  unregistered field is refused by name, and the zero-hit enumeration honours the
  existing `--raw-queries` privacy boundary. Adds two list-returning store methods
  beside the existing counting pair.
- Knowledge code anchors — M2, AC-RR-4/8. `lore anchor add|rm|list` accepts a
  `knowledge` target, `DriftCheckService` scans knowledge alongside spec,
  `DriftRow.spec_slug` becomes `doc_slug` + a required `doc_type`, and
  `DriftCheckResult` gains `knowledge_checked`. The rename touches every consumer in
  one change — ⛔ the two spellings are never allowed to coexist.

**Phase 2 — sub-type-filter.** M3, AC-RR-5/6/7. Serialized AFTER phase 1 because both
tasks edit the same four store files (`store-interface.ts`, `sqlite-store.ts`,
`turso-store.ts`, `in-memory-store.ts`) — the anchor mutex would refuse a concurrent
claim, correctly. The predicate lands in the store query, never as a post-filter:
`lore list` already paginates with `--limit`/`--offset`, and filtering after the
window would return fewer rows than asked while more matches existed past the offset.

# Risks

- **Cross-plan anchor collisions are invisible.** The sibling plan for
  `spec-the-defect-channel-cannot-be-honestly-maintained-an` runs concurrently, and
  the anchor mutex plus `lore ready`'s `anchor_conflicts` are both PLAN-scoped.
  Mitigation: the two anchor sets were compared by hand before dispatch and are
  disjoint; every merge is followed by an overlap check rather than trusting the gate.
- **The `spec_slug` rename has consumers outside this package.**
  `packages/core/src/code-anchors.ts`, `flows/drift-flow.ts`, `commands/status.ts`,
  and the MCP drift projection all read the field. A partial rename compiles in some
  configurations and silently drops a column in others, so the task's own oracle
  includes a repo-wide search for the retired spelling returning zero hits.
- **A knowledge doc gaining anchors arms `--check-drift` for the whole corpus.** This
  repo's own knowledge docs declare none today, so `knowledge_checked` starts at 0 and
  nothing new breaches on landing — but the FIRST knowledge doc to declare an anchor
  arms a pre-push gate for every subsequent push. That is the intended effect; it is
  named here so it is not discovered as a surprise.

# Verification

Every AC is script-mode with a runner-attested pass required (`lore verify <plan>
--task <task>`). Each task records its RED observation at the moment it is red
(`lore evidence --result expected-fail`), by the agent that produced it.
