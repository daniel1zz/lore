---
id: SPEC-71
type: spec
role: spec
title: "Execution liveness signals: session actor tier, evidence claim renewal, plan last-activity"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-27
tags: []
parent: PRD-001
---
## Overview/Goal

Close the three multi-session plan-execution collision windows with derived liveness signals — no locks, no new stored state, no restriction on legitimate concurrency. Extends SPEC-042's "sessions are derived, never stored" ethos:

| # | Window | Root cause | Consequence |
|---|--------|-----------|-------------|
| W1 | No-claim window | Claims are task-granular and acquired just-in-time; between "session decides to execute a plan" and the first `lore claim` — and between task release and the next claim — the corpus carries zero signal | A fresh session treats an actively-executed plan as unowned and takes it |
| W2 | Same-actor blindness | Two sessions with no `LORE_ACTOR` both resolve to the OS username; `existingClaim.by === opts.by` is treated as a same-holder refresh (task-workflow-service.ts `_claimImpl`) | Both sessions silently "hold" the same task; the claim defense never fires |
| W3 | TTL false takeover | A claim older than `claim_ttl_minutes` (default 120) is claimable without `--steal`; a live session on a >2h task is judged dead | The same task is executed twice |

Three additive features, one per window:

- **F1 — session-derived actor tier (W2)**: `resolveActorWithSource` gains a tier between `$LORE_ACTOR` and the OS-username fallback: when `CLAUDE_CODE_SESSION_ID` (or `CLAUDE_SESSION_ID`) is set, the actor resolves to `agent:session-<8-char sanitized prefix>`. Verified empirically: `CLAUDE_CODE_SESSION_ID` IS present in Claude Code's Bash tool environment — the mechanism lives in the CLI itself and needs no agent compliance.
- **F2 — evidence auto-renews the holder's claim (W3)**: appending evidence whose recorder IS the current claim holder refreshes `claim.at` in the SAME single CAS write. A session still producing evidence is alive; TTL takeover should only hit actually-dead sessions.
- **F3 — `last_activity_at` on bootstrap `active_plans` (W1)**: each active-plan entry gains a required `last_activity_at` — the max `updated_at` across the plan doc and its child tasks. Pure derivation over data `SessionService.bootstrap` already holds in memory; zero extra store calls.

## Scope

**In:**
- `@lore/core`: pure `sessionActorFromId(sessionId)` + `SESSION_ACTOR_PREFIX` constant; pure `renewClaimForEvidence(claim, actor, nowIso)` (task-workflow.ts); pure `deriveLastActivityAt(plan, tasks)` + required `last_activity_at` on `bootstrapActivePlanSchema` (session.ts).
- `packages/lore/src/adapters/cli/utils.ts`: `resolveActorWithSource(explicit?, env = process.env)` env-parameterized + the new `"session"` `ActorSource` variant.
- `packages/lore/src/service/task-workflow-service.ts` AND `phase-workflow-service.ts`: both `appendEvidenceEntry` paths wire `renewClaimForEvidence` (parallel copies must not silently diverge); audit `details.claim_renewed: true` on renewal; module-header `@invariant` revised to declare the bounded same-holder side-effect.
- `packages/lore/src/service/session-service.ts`: populate `last_activity_at` in the existing activePlans loop.
- `packages/lore/src/adapters/cli/commands/bootstrap.ts`: text formatter renders relative time for `last_activity_at`.
- Test-fixture migration for the required F3 field (shared `makeActivePlan()` factory absorbs it).

**Out:**
- Any plan-level lock or stored execution marker (violates derived-state ethos; blocks legitimate concurrency).
- Hook changes (F1 lives in the CLI; if a hook later needs the actor format, the SPEC-057 golden-fixture-parity precedent applies).
- MCP/HTTP surface changes beyond report passthrough (`lore_bootstrap` passes the report through — implementer verifies no reshape drops the field).
- Claim-TTL config changes; `deriveSessions` changes; `lore ready` shape changes.

## Design Decisions

| # | Decision | Choice | Rationale | Trade-off |
|---|----------|--------|-----------|-----------|
| D1 | W2 fix location | CLI-built-in session tier, NOT hook-injected prose | `CLAUDE_CODE_SESSION_ID` verified present in Bash tool env → mechanism needs no agent compliance; prose reinforcement measurably failed 4× (dogfood log) | Covers Claude Code environments only; other agent frameworks still hit os-fallback (advisory remains) |
| D2 | Actor namespace | `agent:session-<id8>`, reusing the `agent:` prefix | Consistent with existing `agent:<branch-or-slug>` discipline; `parseAuditActor` treats every non-`ai:` actor identically — no new regression | Shares prefix with seat actors; distinguished by the `session-` infix |
| D3 | `ActorSource` variant name | `"session"` | Tier vocabulary names where identity came from (`explicit`/`env`/`os-fallback`); a session id is a real signal, not a fallback | — |
| D4 | F2 placement | Pure core fn + wiring in BOTH services | `PhaseWorkflowService` is SPEC-056's go-forward model; fixing one of two parallel copies is a known silent-divergence bug class | One extra indirection; ~5 lines per service |
| D5 | F2 renewal condition | Same-holder only (fresh OR stale); non-holder never touches the claim | Mirrors `claim()`'s existing same-holder refresh semantics; implicit acquisition via evidence would break claim explicitness | A previous holder whose stale claim was legitimately taken over gets no renewal (correct — the claim changed hands) |
| D6 | F3 derivation source | `max(updated_at)` over plan + child tasks, not claim/evidence timestamp arithmetic | `release` clears the claim (activity invisible afterwards); `updated_at` bounds every write timestamp and always exists (total function); over-reporting is the safe direction — a fresh session avoiding one extra plan costs far less than a collision | Title edits count as "activity" — semantics documented as "last corpus write in the plan's subtree", never presented as execution-only |
| D7 | F3 schema requiredness | **required** `z.string()` | Fail-loud: a producer that forgets the field throws at the existing `bootstrapReportSchema.parse` self-check; optional's silent absence is exactly the Zod strip-unknown trap | ~33 test fixture sites migrate mechanically (shared factory absorbs it) |
| D8 | F1 testability | `env` parameter with `process.env` default | Tests pass literal env objects — no `process.env` mutation hygiene, no parallel-test pollution; existing `LORE_ACTOR` read migrates into the parameter too | Signature widens by one defaulted param (zero-change for existing callers) |

## Module Boundary

Public interfaces (all pure, browser-safe, time via parameters — no `Date.now()` in core):

```ts
// @lore/core (new)
export const SESSION_ACTOR_PREFIX = "agent:session-";
export function sessionActorFromId(sessionId: string): string; // → agent:session-<8-char sanitized prefix>

// @lore/core task-workflow.ts (new)
/** Refreshed claim when the evidence recorder IS the current holder (same `by`,
 *  fresh OR stale), else null. Never mutates input. */
export function renewClaimForEvidence(
  claim: TaskClaim | undefined, actor: string, nowIso: string,
): TaskClaim | null;

// @lore/core session.ts (new)
/** Max updated_at across the plan doc and its child tasks. Total. */
export function deriveLastActivityAt(plan: DocRecord, tasks: DocRecord[]): string;

// adapters/cli/utils.ts (changed)
export type ActorSource = "explicit" | "env" | "session" | "os-fallback";
export function resolveActorWithSource(
  explicit?: string, env: Record<string, string | undefined> = process.env,
): ResolvedActor;
```

Implementation constraints:
- **F2 must reuse the already-captured `nowIso`** — never invoke the `now()` thunk twice (the STALE_VERSION test recipe relies on single-fire; evidence `recorded_at` and renewed `claim.at` must be the same instant). Atomicity oracle: doc `version` delta === 1 for evidence-append-plus-renewal.
- **F3 schema and TS type move together** (`z.object` strips unknown keys at the parse self-check).
- Renewal preserves `branch`/`machine`/`worktree` claim fields untouched.

## Acceptance Criteria

Note on AC ids: the structured ids retain the `AC-069-*` prefix from this spec's pre-renumber draft (the number 069 was already held by the attestation-floor spec). AC ids are opaque tokens — renaming them would dangle every recorded evidence `ac_ref`, so evidence continuity wins over cosmetic renumbering.

Structured ACs are authored via `lore ac add` (script-mode, exit-code oracles). Summary:

1. F1: precedence chain `--by` > `$LORE_ACTOR` > session tier > OS username, with literal-env-object tests (new dedicated vitest file).
2. F1: `sessionActorFromId` format/sanitization/truncation invariants (core pure test).
3. F2: `renewClaimForEvidence` pure-fn truth table — same-holder fresh, same-holder stale, foreign holder, absent claim (core pure test).
4. F2: `TaskWorkflowService.addEvidence` renewal — single version bump, `claim_renewed` audit detail, foreign-holder claim byte-identical, STALE_VERSION recipe regression (service vitest file).
5. F2: `PhaseWorkflowService` parity — same assertions on the phase append path (service vitest file).
6. F3: `deriveLastActivityAt` totality (zero-task plan → plan.updated_at) + `SessionService.bootstrap` populates the field + schema parse fail-loud when absent (service vitest file).
7. Whole-repo: `bun run typecheck` clean.
8. Whole-repo: both test runners green (`bun run test:vitest` + `bun run test:bun`) — regression floor.


## Acceptance Criteria (structured)

- [✔] [script] AC-069-1: Actor precedence chain resolves --by > LORE_ACTOR > session tier (agent:session-<id8> from CLAUDE_CODE_SESSION_ID/CLAUDE_SESSION_ID) > OS username, verified with literal env objects (no process.env mutation); ActorSource gains 'session'
  script: test — bunx vitest run packages/lore/tests/unit/cli/actor-session-tier.test.ts
- [✔] [script] AC-069-3: renewClaimForEvidence truth table: same-holder fresh -> renewed at=nowIso with branch/machine/worktree preserved; same-holder stale -> renewed; foreign holder -> null; absent claim -> null; input never mutated
  script: test — bunx vitest run packages/lore/tests/unit/core/renew-claim-for-evidence.test.ts
- [✔] [script] AC-069-4: TaskWorkflowService.addEvidence renewal: same-holder evidence refreshes claim.at in ONE CAS write (doc version delta === 1), audit details carries claim_renewed=true, evidence recorded_at === renewed claim.at; foreign-holder evidence leaves extra.claim byte-identical; STALE_VERSION now()-seam recipe still passes (REGRESSION)
  script: test — bunx vitest run packages/lore/tests/unit/service/task-workflow-evidence-renewal.test.ts
- [✔] [script] AC-069-5: PhaseWorkflowService parity: identical renewal assertions (single version bump, claim_renewed audit detail, foreign-holder untouched) on the phase appendEvidenceEntry path
  script: test — bunx vitest run packages/lore/tests/unit/service/phase-workflow-evidence-renewal.test.ts
- [✔] [script] AC-069-6: deriveLastActivityAt is total (zero-task plan -> plan.updated_at; else max across plan+tasks); SessionService.bootstrap populates required last_activity_at on every active_plans entry; bootstrapReportSchema.parse throws when the field is absent (fail-loud)
  script: test — bunx vitest run packages/lore/tests/unit/service/session-bootstrap-last-activity.test.ts
- [✔] [script] AC-069-7: Whole-repo typecheck exits 0
  script: tsc — bun run typecheck
- [✘] [script] AC-069-8: Both test runners exit 0 (vitest + bun test) — regression floor incl. ~33 bootstrap fixture migrations for the required F3 field
  script: test — bun run test
- [✔] [script] AC-069-2: sessionActorFromId produces agent:session-<8-char sanitized prefix>; sanitization collapses non-[a-z0-9-] runs to a single hyphen (sanitizeBranchSegment semantics) with leading/trailing hyphens trimmed; sanitize-to-empty input throws in core (fail-loud, never a bare prefix) and the CLI session tier catches it, degrading to os-fallback
  script: test — bunx vitest run packages/lore/tests/unit/core/session-actor.test.ts

## Code anchors

- packages/core/src/session-actor.ts#sessionActorFromId
- packages/core/src/task-workflow.ts#renewClaimForEvidence
- packages/core/src/session.ts#deriveLastActivityAt
- packages/lore/src/adapters/cli/utils.ts#resolveActorWithSource
