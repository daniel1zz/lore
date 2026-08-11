---
id: TASK-398
type: task
role: plan
title: "The MCP assess adapter still calls deriveCommitSetForPlan with the old 2-arg shape, so the convention-mismatch suppression the CLI just gained is silently absent for every MCP caller"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-02
tags: []
parent: PRD-001
links:
  - {id: TASK-408, type: relates-to}
  - {id: ADR-028, type: relates-to}
---
Residual of `task-lore-assess-derives-a-plan-s-commits-by-grepping-task`, carved out because
`packages/lore/src/adapters/mcp/tools.ts` was under concurrent write when that task shipped and the
implementer was explicitly forbidden from touching it. Filed so the gap cannot be lost to memory.

## The gap (reported by the implementer, verified by the orchestrator against the branch)

The CLI path (`commands/assess.ts`) now computes `allTasksArchived`, passes it to
`deriveCommitSetForPlan`, and threads `commitDerivationUnverifiable` into `assessPlan`, so an
all-archived plan whose commits carry no task slug yields status
`"unverifiable_convention_mismatch"` and a forced `unverifiable[]` entry with `scope_fidelity`
removed from `dimension_scores`.

`tools.ts:1611` still calls `deriveCommitSetForPlan` with the OLD 2-arg shape. Both new parameters
were made optional and additive precisely so that call keeps compiling — which is why `typecheck`
is clean and the 12 pre-existing `mcp-tools-assess.test.ts` tests still pass. **The silence is the
defect**: nothing fails, and `lore_assess` over MCP still reports `"no_commits_found"` for the
contradiction state and still publishes an absence-scored `scope_fidelity`.

So the false-major-finding route that the CLI now closes remains OPEN for every MCP caller — which
is every AI agent using lore through the MCP adapter, i.e. the majority surface.

## Proxy / Silence / Opt-in

- **Proxy** — none new; this task only propagates an already-reviewed mechanism to a second adapter.
  The optional-parameter default (`false`) is itself the proxy that made the omission invisible:
  "compiles" proxied "is wired". Concrete violating input: the 2-arg MCP call — it satisfies the
  type checker while never reaching the new branch.
- **Silence** — the whole defect. An adapter that silently keeps the old behaviour is
  indistinguishable from one that was updated. The fix must include an oracle that FAILS if either
  adapter regresses to the 2-arg shape, not merely a test of the MCP path's happy case.
- **Opt-in** — after this lands, no adapter may opt out. Prefer removing the optional defaults once
  both call sites pass the arguments, so a third adapter cannot repeat this silently.

## Required

- Add to `tools.ts` the same three steps the CLI sibling performs: compute `allTasksArchived`, pass
  it to `deriveCommitSetForPlan`, thread `commitDerivationUnverifiable` into `assessPlan`.
- Then make the parameters REQUIRED (drop the `false` defaults) so the type checker enforces every
  future adapter — this is the mechanization that prevents recurrence, and it is the point of the
  task. If that proves impossible, state why in writing.

## Oracle

- RED first: an MCP `lore_assess` over a fixture all-archived plan with conventional (slug-less)
  commits currently returns `no_commits_found` and an absence-scored `scope_fidelity`; after the fix
  it returns `unverifiable_convention_mismatch` with `scope_fidelity` absent from `dimension_scores`
  and a `NOT SCORED` `unverifiable[]` entry. Must fail before the change.
- CONTROL: the 12 pre-existing `mcp-tools-assess.test.ts` tests stay green, byte-identical.
- CONTROL: the CLI path's behaviour is unchanged (same values for the same fixture).
- CONTROL: after the defaults are dropped, deleting either argument at either call site FAILS
  `bun run typecheck`. Prove it by deleting one and observing the error, then restoring.
- Fixture corpus is a throwaway (`mkdtemp` + `lore init`), never the repo's own `.lore/`.
