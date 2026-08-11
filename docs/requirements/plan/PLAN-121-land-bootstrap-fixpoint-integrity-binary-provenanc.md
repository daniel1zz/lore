---
id: PLAN-121
type: plan
role: plan
title: "Land bootstrap fixpoint integrity: binary provenance, the anchor-coverage ratchet, and mirror content drift"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: SPEC-134
phases:
  - {name: "binary-provenance", description: "Embed the build commit into the binary, expose it via lore status --json, add the three-state --check-binary-provenance, and wire it into both byte-identical pre-push copies. AC-BFI-1/2/3."}
  - {name: "anchor-ratchet", description: "Register an anchor-coverage enumerator on the existing COUNT_FIELD_ENUMERATORS seam, ship the exemption ledger dispositioning all 55 currently-unanchored specs, arm the ratchet plus its stale-exemption reverse check, and wire the checker into pre-push. AC-BFI-4/5/6/7/9."}
  - {name: "mirror-content", description: "Extend the spec-mirror --check to compare mirror bodies against corpus content, exiting MIRROR_DRIFT_EXIT_CODE (2) and naming divergent slugs, without regenerating what it inspects. AC-BFI-8. BLOCKED on agent:mirror-id-unify's live claim."}
---
# Land bootstrap fixpoint integrity: binary provenance, the anchor-coverage ratchet, and mirror content drift

Implements `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor` (approved, 9 ACs).

## Dispatch dependency graph

Anchors decide concurrency; the gate enforces it (`gate:task-claim:anchor-overlap`). Three tasks
may start immediately, three are blocked on a predecessor's merge:

```
phase binary-provenance   T1 provenance+check ─┐
                          T2 pre-push wiring ──┼─ concurrent (disjoint anchors)
phase anchor-ratchet      T4 ledger+checker ───┘
                          T3 coverage enumerator  ← blocked on T1 (both touch commands/status.ts)
                          T5 ratchet pre-push     ← blocked on T2 (both touch hooks/pre-push)
phase mirror-content      T6 mirror content drift ← blocked on agent:mirror-id-unify (foreign claim)
```

⛔ T6's anchors intersect a LIVE foreign claim measured 2026-08-11T02:50Z:
`agent:mirror-id-unify` holds `task-unify-mirror-identifiers-on-zero-padded-form-export-all` in
worktree `worktree-agent-a9f801dd0f61837b2`, anchoring `scripts/export-spec-mirror.ts`,
`scripts/export-spec-mirror-core.ts`, `scripts/tests/spec-mirror-export.test.ts`, `package.json`.
Re-read that claim immediately before dispatching T6 — never from this document's snapshot.

## Preconditions the dispatcher must re-verify, not assume

1. **`main` is RED right now.** `bunx vitest run packages/lore/tests/unit/eval/migration-coverage.test.ts`
   exits 1 with `links_broken` = 43. That failure belongs to `agent:mirror-id-unify`'s task, not to
   this plan. Do not dispatch T6 until it is green, and do not attribute it to this plan's tasks.
2. **The spec is `approved`.** `lore ac add`/`ac set` demote it to `draft`, which hard-blocks every
   descendant claim. Re-read the spec's status immediately before each dispatch.
3. **`git pull --rebase origin main` before creating any worktree** — the harness branches from
   current HEAD and does not pull.

## Red-first evidence already on record

Two ACs are runnable today and were measured RED by segment on 2026-08-11, before any
implementation existed — recorded so the red is not a post-hoc reconstruction:

| AC | parity segment | wiring segment | full command |
|---|---|---|---|
| AC-BFI-3 | exit 0 | exit 1 | exit 1 |
| AC-BFI-9 | exit 0 | exit 1 | exit 1 |

The parity segment passing is what gives these ACs discriminating power: the red comes from the
missing wiring, not from a pre-existing byte-difference between the two `pre-push` copies. An
implementer that wires only one copy turns the parity segment red instead — both directions are live.

## Definition of done

- All 9 ACs attested via `lore verify <plan> --task <task>` (⛔ never an unfiltered `lore verify` on
  a partially-complete plan — it mints fresh `fail` rows for every not-yet-implemented AC).
- Every task carries an `expected-fail` evidence row recorded **by the agent that observed the red**,
  at the moment it was red.
- `lore status --check-tree --check-drift` exits 0, and the spec declares code anchors for what this
  slice implements — this plan adds a coverage ratchet, so landing it unanchored would put its own
  mechanism in violation on the landing commit.
