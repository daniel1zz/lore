---
id: TASK-347
type: task
role: plan
title: "MCP lore_create.supersedes still creates-then-fails — the type precheck landed in the CLI command, above the shared flow both surfaces document as the anti-divergence seam"
status: archived
priority: high
created: 2026-08-02
updated: 2026-08-07
tags: []
parent: PRD-001
---
# Defect

`lore create --supersedes` validates the target's TYPE before any write; MCP
`lore_create.supersedes` does not. The MCP surface still exhibits the create-then-fail
behaviour that `task-a-task-cannot-be-retracted-supersedes-emits-a-repair` (Defect 1) was
filed to remove — it creates the new doc, fails the invalidate, and emits a
`supersede_repair_command` that fails IDENTICALLY on retry for a type-ineligible target.

Measured 2026-08-02 on `main`:

- CLI: `packages/lore/src/adapters/cli/commands/create.ts:561-578` — resolves the target,
  checks `SUPERSEDE_CREATE_ELIGIBLE_TYPES`, exits 4 creating NOTHING.
- MCP: `packages/lore/src/adapters/mcp/tools.ts:996-1026` — goes straight to
  `createWithSupersedes` with no type precheck.
- Shared flow: `packages/lore/src/flows/supersede-flow.ts` — contains no type validation.

# Mechanism root — the fix landed on ONE adapter, below which the shared seam already existed

`supersede-flow.ts`'s own module header states the design intent verbatim:

> a thin, surface-neutral sequencing helper living in `flows/` (above the service layer,
> below the adapters) so CLI and MCP call the SAME function rather than each
> re-implementing the two-call sequence

and `create.ts:534-537` restates it:

> the SAME function MCP `lore_create.supersedes` uses, so the two surfaces can never diverge
> on half-failure behavior

The precheck was nonetheless written INSIDE the CLI command, above that seam — so the two
surfaces diverge on exactly the behaviour both comments promise they cannot. The shared
module existed and was pointed at; the fix simply did not land in it.

⛔ Transferable: when a defect is fixed on an adapter that documents a shared seam beneath
it, the fix belongs in the seam. A comment asserting non-divergence is not a mechanism that
prevents divergence — nothing failed when the divergence was introduced.

# Required fix

Move the eligibility precheck into `createWithSupersedes` (`flows/supersede-flow.ts`), which
must resolve the target and refuse BEFORE calling `deps.create`. `SUPERSEDE_CREATE_ELIGIBLE_TYPES`
moves with it. Both adapters then render the refusal in their own idiom (CLI stderr + exit 4;
MCP `errorContent`), and neither re-implements the predicate.

This requires a third injected dep (a `get`/resolve port) on `SupersedeOrchestrationDeps` —
consistent with the module's existing Law-of-Demeter shape (inject the narrow calls, never
the `App`).

⛔ Do not fix by copying the CLI's block into `tools.ts`. That reproduces the divergence
hazard with two copies instead of one, and the next surface added inherits neither.

# Proxy / Silence / Opt-in

**Proxy.** After the fix, "the target resolves and its type is eligible" is checked
directly, not by proxy. The residual proxy is `SUPERSEDE_CREATE_ELIGIBLE_TYPES` standing for
"can meaningfully be superseded" — an input satisfying the proxy while violating the
property: an `adr` that is already `superseded`, which is type-eligible but arguably not a
sensible target. ACCEPTED, and named here: invalidating an already-invalidated doc is
handled downstream by `ValidityService` and is not this predicate's job.

**Silence.** Present behaviour on the MCP path is loud-but-useless: it reports an error AND
leaves a created doc plus an unrunnable repair command. After the fix, refusal is loud and
leaves no partial state. The half-failure path that remains (create ok, invalidate fails for
a NON-type reason) keeps its existing loud `supersede_error` + repair command — that one is a
genuine race, not a knowable-up-front precondition, and must not be silently swallowed.

**Opt-in.** None — the precheck binds every caller of the shared flow, which is the point.

# Oracle

- MCP `lore_create` with `supersedes` naming a `task` (type-ineligible) returns `isError`
  AND the corpus doc count is UNCHANGED before/after — the count assertion is load-bearing,
  since the pre-fix behaviour also returned an error while creating a doc.
- The same call via CLI keeps its existing exit 4 + unchanged-count behaviour (REGRESSION).
- CONTROL: a type-ELIGIBLE target still supersedes successfully on BOTH surfaces, so a
  blanket-refuse regression cannot pass as green.
- A grep-shaped assertion that `SUPERSEDE_CREATE_ELIGIBLE_TYPES` is referenced in exactly
  one module — the shared flow — so a future adapter cannot silently re-implement it.
