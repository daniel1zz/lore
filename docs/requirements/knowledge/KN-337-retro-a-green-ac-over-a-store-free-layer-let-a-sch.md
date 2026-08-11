---
id: KN-337
type: knowledge
role: knowledge
title: "Retro — a green AC over a store-free layer let a schema change ship dead: we reproduced the consumer-reported integration-reachability defect while fixing issues"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PRD-001
links:
  - {id: TASK-550, type: informs}
  - {id: PLAN-103, type: informs}
---
## What happened

While building the mechanism that closes consumer-filed defect reports, we reproduced — inside that very build — the defect a consuming project had reported the same day.

P1 of `plan-implementation-issue-closure-loop-resolves-edge-computed` added `"resolves"` to `linkTypeSchema` and shipped a pure `computeIssueResolution`. Its two ACs were bound to a vitest unit file and both passed; `bun run typecheck` passed; the branch merged clean. The deliverable was dead on the real path: `packages/lore/src/store/migrations/migration-004.ts` pins `links.link_type` to a 7-value `CHECK` constraint, and no migration widened it. Every real `SQLiteStore` write of a `resolves` edge failed:

```
STORE_ERROR: CHECK constraint failed:
link_type IN ('parent','implements','informs','supersedes','relates-to','blocks','governs')
```

Three downstream agents hit it independently in the next phase; one was fully blocked and had to file a handoff. A second, narrower copy of the same list (`adapters/cli/commands/link.ts`'s hardcoded `VALID_LINK_TYPES`) failed the same way one layer up, and a third copy (a dashboard component test's literal 7-member array) went red on merge.

The consuming project `babyai` had filed this exact class of defect hours earlier: *"Task-scoped oracles cannot verify integration reachability: an AC passes green while its deliverable is dead code."* We confirmed their report by living it.

## Root cause

Purity and integration-reachability are ORTHOGONAL, and we treated the first as evidence for the second.

Keeping `computeIssueResolution` store-free was a deliberate, correct design choice — it made the function testable under vitest without `bun:sqlite`. The AC then bound its oracle to that same store-free layer. So the AC measured the layer the design had specifically isolated FROM the store, and the schema change's only real consumer — the store — was never exercised by anything the AC could see. Exit code 0 meant "the pure function is correct", not "a `resolves` edge can be written".

This is the fifth false-oracle vector's sibling: not a mistyped path, not a stale binary, but an AC whose oracle sits at a layer the change must pass THROUGH but does not TERMINATE at.

## Mechanization (the actual fix, not the symptom)

The symptom fix was `migration-012.ts`. The durable fixes:

1. **A schema-enum change needs an AC that terminates at the store.** When a change adds a member to a persisted enum (`linkTypeSchema`, doc status, doc type), at least one AC must exercise a real `SQLiteStore` write of the new member — a `.bun.test.ts`, never an `InMemoryStore` double. Purity of the computation is separately valuable and separately tested.
2. **Detect enum-vs-migration divergence deterministically.** A persisted enum whose member set exceeds the newest migration's `CHECK` list is mechanically detectable: parse `linkTypeSchema.options` against the latest migration SQL and fail loudly on a mismatch. This is a candidate `lore status --check-*` predicate or a build-time assertion, and it would have caught this before the branch merged.
3. **One list, one source.** The link-type set existed in FOUR places (Zod schema, SQLite CHECK, CLI `VALID_LINK_TYPES`, dashboard test literal). Three of them drifted the moment the first changed. Derive from `linkTypeSchema.options` everywhere a runtime list is needed; the SQLite CHECK is the one copy that legitimately cannot derive, which is exactly why it needs mechanization #2.

## Standing lesson

A green AC proves the oracle's layer is correct. It says nothing about layers the change must traverse to reach production. Ask, for every change: which layer does this change TERMINATE at, and does any AC execute THAT layer?
