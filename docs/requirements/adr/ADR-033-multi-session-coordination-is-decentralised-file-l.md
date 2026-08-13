---
id: ADR-033
type: adr
role: decision
title: "Multi-session coordination is decentralised: file locks plus process probing, no resident daemon"
status: approved
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
## Context

Lore's concurrency control was designed for one topology — a single orchestrator
session driving N controlled subagents inside one checkout. In that topology the
orchestrator IS the arbitration point, so advisory mechanisms (a claim lease, a
checkpoint gate, an actor label) are sufficient: nothing can conflict without the
orchestrator being the one to cause it.

The real topology is now N orchestrator sessions sharing one checkout, one corpus
and one installed binary. Measured on 2026-08-11 while resuming a handoff:

- A peer session (`lore-28`, busy 2h) held three live claims under `session_id`
  `b2841cb4` while this session read the same checkout.
- `lore ready <plan> --json` returned `sessions: []` and `anchor_conflicts: []`
  at that same moment, because the anchor mutex and its report are both
  plan-scoped (`buildAnchorGateContext` <- `getPlanBundle().tasks[]`) and the peer
  was working a different plan.
- `active_sessions[].branches` was `[]` for a session whose worktree demonstrably
  held a branch with one unmerged commit.
- Consequently this session read the peer's in-flight branch as an orphan to be
  rescued, using raw `git branch -a` / `git log main..<branch>` — there is no lore
  command that answers "which branch belongs to whom".

The generalisation: lore validates a PROXY for the property, not the property
(`adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`).

- True property: is anyone else touching this resource right now?
- Proxy: does another fresh claim inside THIS PLAN declare an overlapping file
  anchor?

The proxy is isomorphic to the true property under one orchestrator and stops
being isomorphic under two. Three dimensions come apart at once: scope (plan vs
checkout), resource set (file anchors vs every shared singleton), and liveness
(TTL inference vs process probing).

Git is the reference implementation for exactly this problem, and measurement
shows which half we are missing. Probed 2026-08-12 in a throwaway repo:

| Probe | Result |
|---|---|
| `git worktree add <same branch>` twice | exit 128, `fatal: 'feature' is already used by worktree at <path>` |
| `git commit` while holding `.git/index.lock` | exit 128 |
| `git update-ref` with wrong old-value | exit 128; with correct old-value, exit 0 |

Git runs a two-tier model: optimistic concurrency with compare-and-swap on the
immutable/append-only side (objects, refs), pessimistic exclusion with a
holder-naming refusal on the mutable side (working tree, index).

Lore already implements the optimistic tier — `CorpusService.set` takes
`expectedVersion` and returns `STALE_VERSION`; `compareClaimSessions` is
three-valued; `noAnchorOverlap` refuses rather than permits when the session
dimension is unmeasurable. Lore implements none of the pessimistic tier:
`grep -r 'flock|lockfile|O_EXCL'` over `packages/` returns zero hits. Every
failure measured above happened on the mutable side.

## Decision

Multi-session coordination is DECENTRALISED. Coordination state lives in files on
the local filesystem; liveness is established by probing the operating system;
there is no resident coordinator process.

Five commitments follow:

1. **No daemon.** The coordinator role is played by lock files plus process
   probing, never by a long-running arbiter.
2. **Two lock classes with different mechanisms**, because a session outlives the
   process that speaks for it. Operation-scoped locks use `flock(2)`, whose
   release is guaranteed by the kernel when the file descriptor closes.
   Session-scoped leases cannot use `flock(2)` — the lore CLI is a short-lived
   stateless process while an orchestrating session is long-lived — so they are
   records validated by probing the orchestrator's `pid` plus process start time.
3. **Liveness is probed, never inferred.** `isClaimStale`'s TTL arithmetic stays
   as a hint for reporting, but no exclusion decision may rest on it. A fresh
   timestamp does not mean alive and a stale one does not mean dead.
4. **Communication is advisory and separate from exclusion.** Sessions may
   exchange messages, but no message exchange creates mutual exclusion.
5. **State location follows scope, in two tiers.** An earlier revision of this
   record said flatly that coordination state lives under `.lore/`. Implementing
   L0 showed that to be too coarse, and the distinction it was missing is the
   one that matters:
   - **Authoritative exclusion state** — locks and leases — lives under `.lore/`,
     because it is scoped to THIS checkout and a reader must be able to find it
     by looking at the repo it is blocked on. A lock whose location does not
     name its checkout cannot answer "who holds this working tree".
   - **Advisory liveness beacons** live in machine-scoped storage OUTSIDE any
     repo (`os.tmpdir()`), because they are scoped to a PROCESS, not a checkout,
     and because a beacon that lands inside a repo can be committed by accident.
     The checkout dimension is supplied by the corpus claim it is joined against
     (`claim.worktree`), not by the beacon's own path.

   ⛔ Neither tier may be conflated with a corpus write. The standing rule
   forbidding writes to a repo's own `.lore/` refers to the DOCUMENT STORE. A
   lock file at `.lore/<name>.lock` is not a corpus write, and reading the rule
   as if it were is what pushed L0's heartbeat into `os.tmpdir()` — a choice this
   record now ratifies for beacons specifically, but which was reached by
   misreading rather than by design.

## Quality Attributes Affected

| Attribute | Impact | Scenario |
|---|---|---|
| Correctness under concurrency | + | Two sessions can no longer silently write the same singleton resource |
| Availability | + | No arbiter process to crash, restart or supervise |
| Distribution simplicity | + | `lore init` remains sufficient; consumers manage no background process |
| Latency | - | Every write command pays a lock acquisition |
| Cross-machine strength | - | Probing is same-machine only; across machines exclusion degrades to advisory |

## Alternatives Considered

| Option | Pros | Cons | Why rejected |
|---|---|---|---|
| Resident coordinator daemon (`lore serve --coordinator`) | Global view; deadlock detection; liveness is free because a dropped connection means a dead client | Single point of failure needing supervision; consumers must manage a background process lifecycle | Breaks the distribution model. Lore ships as one binary that must work immediately after `lore init`. The failure mode is also worse than the problem: a dead coordinator blocks all work, whereas today's defect is intermittent. |
| One global checkout mutex | Trivial to implement and reason about | Serialises operations that do not actually conflict; blocks read-only work | Measured counter-example: the entire 2026-08-11 diagnosis was read-only and would have been blocked. Git itself never took this route — `index.lock`, `refs/<name>.lock` and the worktree lock are separate. |
| Advisory-only (documentation and stricter discipline) | Zero code | Already the status quo, and it already failed | Each of the three failures was already covered by written prose in CLAUDE.md and the corpus. A defect already covered by prose is proof the prose layer is the wrong layer. |
| Cross-machine consensus (lease in Turso) | Works beyond one machine | Requires sync enabled; adds network dependency to every local write; no `kill -0` equivalent | The mutable resources that actually conflict (working tree, installed binary, mirror) are per-machine by construction. Only the corpus is genuinely shared, and it already has CAS. |

## Consequences

**Easier**

- "Who owns this branch / worktree / lock" becomes a lore query rather than an
  inference from git topology.
- Crash recovery needs no human step: `flock(2)` releases on process death, and
  a session lease whose `pid`+start-time no longer matches is provably dead.
- The refusal path can name its holder, copying the behaviour of git's worktree
  refusal, so a blocked session gets an address rather than a mystery.

**Harder**

- Every write path must acquire before mutating, in a fixed order, at the service
  layer — so CLI, MCP and HTTP are bound identically. A lock reachable from only
  one adapter is worse than no lock, because it looks covered.
- Two lock classes mean two failure models to test rather than one.
- Cross-machine operation cannot be made authoritative by this decision and must
  be explicitly reported as advisory rather than silently weaker.

**Known precondition P2 must satisfy before its lease can be authoritative**

L0 records a liveness beacon carrying `process.ppid` — the parent of the
short-lived `lore` CLI invocation, which is the invoking shell, not necessarily
the long-lived orchestrator. The implementation discloses this in
`SessionService.recordOwnHeartbeat`'s JSDoc rather than presenting it as an
orchestrator pid. It is sufficient for L0's question ("is a process behind this
session still alive") and NOT sufficient for a lease that refuses another
session's writes.

⛔ P2 must therefore capture the orchestrator's own pid and start time, not the
CLI's parent, and must not inherit L0's beacon as if it already did. An exclusion
decision resting on a shell's pid would refuse or permit on the wrong identity —
and a lease that permits on the wrong identity is indistinguishable from a lease
that correctly found no conflict, which is the failure mode this whole record
exists to prevent.

The reason L0 could not simply put `{pid, started_at}` on `TaskClaim` is worth
recording as a process fact, not a technical one: the claim's owning files were
anchored to a DIFFERENT task in the same plan, so the agent implementing liveness
had no permission to extend the claim and built a parallel store instead. The
anchor split, not the implementer, produced the second mechanism.

**Unchanged**

- The optimistic tier stays as-is. Document writes keep using `expectedVersion`
  CAS; this decision adds the pessimistic tier beside it, it does not replace it.

## Validation Plan

The decision is validated when the 2026-08-11 diagnosis can be replayed entirely
through lore commands, with zero fallback to `git branch -a`, `git log main..`,
or the harness peer listing. That oracle asserts reproducibility of a conclusion,
not the existence of a command, so it cannot pass on an unwired capability.

Each exclusion mechanism additionally requires a reverse control: two real
processes contend, and the loser's exit code is asserted to be EXACTLY the
expected value with the holder's `session_id` and worktree path present in its
output. An assertion of "non-zero" is not accepted, because a crash also produces
non-zero. Every such oracle must be observed red at least once before it counts.
