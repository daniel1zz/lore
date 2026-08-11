---
id: TASK-384
type: task
role: plan
title: "Two concurrent orchestrators both resolve to agent:main-orchestrator — LORE_ACTOR suppresses the only precedence tier carrying a session discriminator, collapsing SPEC-042 sessions and disabling noAnchorOverlap"
status: archived
priority: high
created: 2026-08-02
updated: 2026-08-03
tags: []
parent: PRD-001
---
# Defect

Two concurrently-live orchestrator sessions in the SAME main checkout both resolve to the
actor string `agent:main-orchestrator`. `deriveSessions` then groups them into ONE session,
`active_sessions` reports one where two exist, and `noAnchorOverlap` — which refuses a claim
whose anchors intersect a *foreign* actor's — sees same-actor and **permits** the overlap.

Measured 2026-08-02 (this session and a peer session, both live, both in
`/Users/apple/Projects/zz/lore`):

- both exported `LORE_ACTOR=agent:main-orchestrator`
- peer had 3 locked worktrees running implementers; peer's own handoff
  (`01KZ17MQ`, NS6) records the same observation independently, having asked the user
  about it three times without an answer
- consequence chain already realised twice: an orchestrator read `active_sessions: []`
  and removed a live agent's worktree
  (`task-active-sessions-derives-only-over-active-plans-`)

# Mechanism root — the discipline that fixes tier 5 suppresses tier 3

`resolveActor` precedence (`packages/lore/src/adapters/cli/utils.ts:576-578`):

    1. --by
    2. $LORE_ACTOR
    3. session tier  ($CLAUDE_CODE_SESSION_ID / $CLAUDE_SESSION_ID -> agent:session-<8char>)
    4. worktree-derived agent:<branch>   (SPEC-104)
    5. OS username                        (warns once)

**Tier 3 is the ONLY tier that carries a per-session discriminator, and it is skipped
whenever tier 2 is set.** The project's own standing discipline mandates setting tier 2 for
every main-checkout run (root `CLAUDE.md`: *"Main-checkout oracle runs need actor identity
(`LORE_ACTOR=agent:main-orchestrator`)"*), because tier 5 collapses every claim onto one OS
username. The retro cited at `utils.ts:419` records that original tier-5 collapse. The fix
for it installed a tier-2 collapse with the same downstream effect — a constant literal is
no more session-distinguishing than a constant username.

Compounding it, the grouping key carries no session fact either
(`packages/core/src/session.ts:550`):

    const key = JSON.stringify([claim.by, claim.machine ?? null, claim.worktree ?? null]);

Two orchestrators in one main checkout produce a byte-identical triple: same `by`, same
machine, same (absent) worktree.

⛔ The conflation is the defect: **actor identity ("who") and session instance ("which run")
are different facts, and `by` is being asked to carry both.** The claim record already
models `machine` and `worktree` as separate captured facts; a session instance belongs in
exactly that set, not smuggled into the identity string.

# Required fix — mechanism, not prose

⛔ Do NOT fix this by prescribing a more unique `LORE_ACTOR` in CLAUDE.md or a dispatch
bundle. Prose that should have been followed is not a mechanism
(`adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`), and this defect
*already exists inside* a prose discipline that was followed correctly.

1. `TaskWorkflowService.claim` captures the session id (`$CLAUDE_CODE_SESSION_ID` /
   `$CLAUDE_SESSION_ID`, sanitized prefix) into the claim record as its OWN field, beside
   `machine`/`worktree` — independent of, and never merged into, actor resolution.
2. `deriveSessions`'s grouping key includes that field.
3. `noAnchorOverlap` treats *same `by`, different session id* as FOREIGN — the whole point
   of the gate is cross-session mutual exclusion, and same-actor is not evidence of
   same-session.
4. Absent session id on either side is **not-measured**, never "same session": the gate must
   say so rather than permit. See Silence below.

Distribution surface: binary-side (`packages/lore/**` + `@lore/core`) — ships with the
compiled `lore`, no consumer config edit required.

# Proxy / Silence / Opt-in (binding — adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the)

**Proxy.** `claim.by` is a proxy for "which session holds this claim". Concrete input that
SATISFIES the proxy while VIOLATING the property: any two sessions exporting the same
`LORE_ACTOR` literal — the observed case, and the case the project's own discipline
*instructs* operators to produce. Not accepted; that is why this task exists. The fix
replaces the proxy with the captured fact rather than tightening the proxy.

**Silence.** Today the collapse is silent in the PERMISSIVE direction: `noAnchorOverlap`
returns "no conflict" and `active_sessions` returns a shorter list. Neither an empty
`active_sessions` nor a passing overlap check is distinguishable from a truthful one. After
the fix, an absent session id on a claim being compared MUST NOT resolve to "same session";
it must surface as an explicit not-measured marker that the gate reports, so a legacy
session-id-less claim cannot silently re-open the hole.

**Opt-in.** Today session distinguishability is opt-in on the operator choosing a unique
`LORE_ACTOR` — constraining exactly the population that did not need constraining. After the
fix, capture happens at claim time for everyone, with no flag.

# Oracle

- Two claims written with identical `by`/`machine`/absent-worktree but different
  `$CLAUDE_CODE_SESSION_ID` derive **two** sessions, not one; a control run with the SAME
  session id on both derives one. Both assertions in one test, so a matcher that silently
  matches nothing cannot pass.
- `noAnchorOverlap` REFUSES a claim whose declared anchors intersect a fresh claim by the
  same `by` under a different session id (exit 4, stderr naming the conflicting task) —
  plus a control proving it still PERMITS the same-session-id case, so a blanket-refuse
  regression cannot pass as green.
- A claim carrying NO session id compared against one that does produces the explicit
  not-measured marker, not a permit.
- REGRESSION: `packages/lore/tests/unit/**` session/claim suites pass unmodified; run via
  `bun run test:changed <base>` (both runners).
