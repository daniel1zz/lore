---
id: SPEC-142
type: spec
role: spec
title: "Multi-session concurrency: queryable ownership, checkout-scoped exclusion, probed liveness"
status: approved
priority: medium
created: 2026-08-12
updated: 2026-08-13
tags: []
parent: PRD-001
links:
  - {id: SPEC-095, type: implements}
  - {id: ADR-033, type: relates-to}
  - {id: SPEC-042, type: relates-to}
---
## Overview/Goal

Lore's concurrency control covers the append-only side of the corpus and nothing
else. This spec adds the missing side: ownership that is queryable, exclusion that
covers every shared singleton, and liveness that is probed rather than inferred.

The governing decision — decentralised coordination, no resident daemon, two lock
classes, probed liveness, communication separate from exclusion — is recorded in
the companion ADR. This spec defines the mechanisms that implement it.

**Goal, scoped to what actually gates**: after L0 lands, a session can answer
"who is touching what right now" using only lore commands — ownership is
queryable from both truth sources and liveness is probed rather than inferred.

⛔ Exclusion is NOT delivered by that. "A session cannot silently write a resource
another live session is writing" is the goal of L1 (P2/P3), whose criteria are
prose only and gate nothing today (see §Acceptance Criteria). Until they land,
this spec makes concurrent work VISIBLE, not SAFE — and a reader who takes
visibility for safety has the failure mode this document exists to remove.

**Non-goals**

- Cross-machine authoritative exclusion. The mutable resources that conflict are
  per-machine by construction; only the corpus is genuinely shared and it already
  has compare-and-swap. Cross-machine state is reported as advisory.
- Replacing the optimistic tier. `CorpusService.set`'s `expectedVersion` CAS stays
  exactly as it is.
- Deadlock detection. Avoided structurally by a fixed acquisition order rather
  than detected at runtime.

## Scope

### The four gaps this closes

| Gap | Statement | Evidence (measured 2026-08-11/12) |
|---|---|---|
| GAP-A | Scope mismatch: exclusion is decided per PLAN, conflict happens per CHECKOUT | `buildAnchorGateContext` takes its sibling set from `getPlanBundle().tasks[]`; `lore ready`'s `anchor_conflicts` reads the same bundle. Both returned empty while a peer held three live claims on another plan. |
| GAP-B | Resource coverage: claims protect only `task.extra.file_anchors` | The main working tree, the `dist/lore` symlink target, and `docs/requirements` + `.lore/export-index.json` are anchors of no task, so no claim ever mentions them. |
| GAP-C | One-way binding between the two truth sources | corpus records `claim.worktree`; git records no session; `active_sessions[].branches` exists but was `[]` for a session whose worktree held a branch with one unmerged commit. |
| GAP-D | Liveness is inferred | `isClaimStale(claim, nowIso, ttlMinutes)` is pure timestamp arithmetic. A killed agent's claim stays "fresh" for the rest of its TTL. |

### Layers

**L0 — Ownership.** Makes ownership queryable from both sides.

- `TaskClaim` gains `branch`, written by `lore claim` from the caller's worktree.
- Commits made under a claim carry a git-native trailer `Lore-Session: <id>`,
  readable with `git log --format='%(trailers:key=Lore-Session,valueonly)'`.
- `active_sessions[].branches` is populated instead of always empty.
- New read-only command `lore territory --json`: corpus-wide (NOT plan-scoped),
  partitioning every worktree and branch into `mine`, `foreign`, `unowned`, and
  `unmeasured`, each foreign entry naming its holder `session_id` and worktree.
- New read-only command `lore session list|show`: joins corpus claims, filesystem
  locks and process liveness into one answer.
- The merge protocol changes from "scan `git branch -a` unconditionally" to
  "partition with `lore territory`, act only on `mine` and `unowned`".

**L1 — Exclusion.** Two lock classes, because a session outlives its processes.

| Class | Used for | Mechanism | Liveness |
|---|---|---|---|
| Operation lock | one `lore set`, one mirror export, one build | `flock(2)` held for the command's duration | none needed — the kernel releases on fd close, including on `kill -9` |
| Session lease | a whole orchestrating session's hold on the checkout | record under `.lore/` | probe orchestrator `pid` + process start time |

Resource namespace and fixed acquisition order (deadlock avoided structurally):

```
checkout://worktree  <  checkout://build  <  corpus://mirror  <  file://<path>
```

Locks are read/write: readers share, writers exclude. Read-only commands
(`get`, `search`, `list`, `ready`, `territory`, `session`) never block.

Two invariants carried from existing lore behaviour:

- Locks are acquired in the SERVICE layer, so CLI, MCP and HTTP are bound
  identically. An adapter-level lock is worse than none: it looks covered.
- An unmeasurable precondition REFUSES rather than permits, copying
  `ANCHOR_OVERLAP_SESSION_UNMEASURED`. A permit is indistinguishable from a
  truthful "no conflict".

Refusals name their holder — `session_id` and worktree path — copying git's
`fatal: 'feature' is already used by worktree at <path>`.

GAP-A closes WHEN THIS LAYER LANDS, not before: the exclusion decision domain
moves from plan to checkout/corpus, and `lore ready`'s `anchor_conflicts` moves
with it. Fixing only one of the two leaves a half that still looks complete. ⛔ As
of L0 this is an unstarted commitment — the anchor mutex is still plan-scoped and
`anchor_conflicts: []` is still not evidence of safety.

**L2 — Communication (advisory).** `.lore/mailbox/<session_id>/` file delivery,
readable and writable by any runtime, so it ships to consumers. The Claude Code
harness's own peer messaging may be used as an optional enhancement but MUST NOT
be a dependency — it does not exist for consumers on other runtimes.

Communication carries no exclusion semantics, and the surface says so: two
sessions able to message each other can still write the same file at the same
time.

**Cross-cutting — binary identity.** `bun run build` writes
`dist/lore.<content-hash>` and moves the pointer with `rename(2)`. A session binds
its binary path at start.

This resource is singled out because its conflict differs in kind: other
conflicts have two writers overwriting each other, this one has a single writer
replacing the tool under every reader's feet, and the victim's symptom is "my
commands behave differently" rather than anything resembling a race. It is also
certain rather than occasional, since building is part of every repair flow.

Locking the build instead was rejected: acquiring the lock requires running
`lore`, which is the binary being replaced.

## Design Decisions

| Decision | Choice | Rationale | Trade-off | Dissenting view |
|---|---|---|---|---|
| Coordinator | No daemon; files + probing | Preserves single-binary distribution; no supervision | No global view; no deadlock detection | A daemon would make liveness free — rejected because a dead arbiter blocks everything, worse than the intermittent defect |
| Lock granularity | Per-resource RW locks | The whole 2026-08-11 diagnosis was read-only and a global mutex would have blocked it; git never took the global route | Several lock files; order must be enforced | A single mutex is simpler to reason about |
| Session liveness | pid + process start time | `kill -0` alone is defeated by pid reuse | Same-machine only | TTL is portable — rejected, it is inference not measurement |
| Operation liveness | `flock(2)` | Kernel releases on death, so no stale-lock cleanup exists to get wrong | Needs a held fd, unusable for session scope | O_EXCL files are more portable — rejected, that is exactly why git tells humans to delete `index.lock` by hand |
| Binary | Content-addressed + atomic pointer | No bootstrap deadlock; running processes keep their inode | Build writes more files | Build lock is simpler — rejected, it deadlocks on itself |
| Communication | Advisory, separate mechanism | Message passing does not imply mutual exclusion | Two mechanisms to learn | Unifying them is simpler — rejected, it would let a chat protocol masquerade as a safety property |

## Risk Registry

⛔ Every mitigation below that names an AC-EXCL / AC-LOCK / AC-SCOPE / AC-BIN /
AC-MSG criterion describes a control that does NOT yet exist — those eleven are
prose only (see §Acceptance Criteria). Until the phase that declares them lands,
the corresponding risk is UNMITIGATED, not mitigated-by-a-pending-check.

| Risk | Severity | Mitigation |
|---|---|---|
| The mechanism passes vacuously — lock files exist but exclude nothing | High | Every exclusion AC contends two real processes and asserts the loser's EXACT exit code plus holder identity in output; each observed red at least once |
| Pid reuse grants a takeover against a live holder | High | Identity is pid + process start time, never pid alone; AC constructs a live pid with a mismatched start time |
| A write path is left unlocked and looks covered | High | Locks live in the service layer; ACs drive CLI, MCP and HTTP for the same resource |
| Fixing the gate but not the report (or the reverse) | Medium | One oracle spans both, across two plans; either half alone looks complete |
| Read-only work blocked by a writer | Medium | RW locks; an AC asserts the read set exits 0 while a write lease is held |
| A wedged session blocks the checkout with no escape | Medium | `lore session steal --force` with an audit row; refuses without the flag |
| Cross-machine use silently weaker than same-machine | Medium | Cross-machine verdicts are labelled advisory in output, never rendered as exclusion |

## Migration Plan

| Phase | Scope | Why this order |
|---|---|---|
| P1 | L0 ownership | Fields already exist, commands are read-only, nothing is blocked. Removes two of the three measured failures immediately, and is a prerequisite for P2/P3 — without ownership binding, a lock holder cannot be mapped back to the git side |
| P2 | L1 session lease on the checkout, default-deny | Turns "one checkout, one orchestrator" from an implicit assumption into an enforced invariant |
| P3 | L1 per-resource locks + binary content addressing | Restores real parallelism once safety exists |
| P4 | L2 mailbox | Advisory; last |

Rollback: P1 is additive and read-only. P2-P4 are each gated by
`workflow.gates.<checkpoint>.enabled`, matching how existing lore gates are
disarmed.

## Acceptance Criteria

### What actually gates today, and what does not

⛔ Read this before citing any criterion below as a control. The seventeen
criteria in this section are NOT equivalent in force:

- **Six are DECLARED and GATING** — AC-OWN-1 through AC-OWN-5 and AC-REPLAY-1.
  They exist as structured criteria (`lore ac add`), `lore verify` executes them,
  and `lore done` refuses a task whose declared scope names one without an
  attested pass. These cover L0 only.
- **Eleven are PROSE CONTRACT ONLY, and gate nothing** — AC-EXCL-1 through
  AC-EXCL-5, AC-LOCK-1 through AC-LOCK-3, AC-SCOPE-1, AC-BIN-1 and AC-MSG-1.
  They state what P2, P3 and P4 must satisfy. No tool reads them, no run can fail
  because of them, and nothing prevents a P2 task from being archived without
  them.

They are deliberately undeclared rather than merely unwritten: pinning an oracle
to a file path that does not exist, whose shape is being guessed, is how a
criterion ends up with no runnable oracle at all. They are declared at the start
of the phase that implements them, once the file layout is measured rather than
predicted.

The consequence for everything else in this document: wherever the Risk Registry
or the layer descriptions name one of those eleven as the thing that catches a
risk, that is a COMMITMENT for the phase in question, not an active control. In
particular, GAP-A and GAP-B are NOT closed by this spec as it stands — GAP-A
closes when L1 moves the exclusion domain from plan to checkout AND the same
oracle spans two plans; GAP-B closes when L1's resource locks cover the three
singletons. Only GAP-C and GAP-D are closed by the six gating criteria.

⛔ Command shape: every script-mode command names its test file as a path from
the repo root (`bun test packages/lore/tests/...`). Two independent floors —
`oracle-file-existence.ts::extractCdPrefixTarget` and
`attestation-completeness.ts::commandRunsFileUnfiltered` — recognise only a
literal `cd <dir> &&` prefix as root-shifting, and this repo forbids a `cd` in
front of a measurement. The root-relative form is the only shape that satisfies
both floors and the discipline at once. Measured 2026-08-13; filed as
`01KZV3XFFY7SEZ9E11NZDC81W8` and `01KZVPHGEMFYWRW3JYB8RYP8F1`.

Every script-mode command prints a summary line on the success path, because a
silent oracle can only leave an attested pass with an empty output tail.

The governing oracle for the whole spec is AC-REPLAY-1: the 2026-08-11 diagnosis
is reproducible using lore commands alone. It asserts that a conclusion can be
reached, not that a command exists, so it cannot pass against an unwired
capability.

- AC-OWN-1 — `lore territory --json` partitions branches into mine/foreign/unowned/unmeasured, naming the holder for each foreign entry.
- AC-OWN-2 — `lore claim` persists `claim.branch`; a claim with no measurable branch records `unmeasured`, never `unowned`.
- AC-OWN-3 — `active_sessions[].branches` is non-empty when the claiming worktree has a branch.
- AC-OWN-4 — commits made under a claim carry the `Lore-Session:` git trailer.
- AC-OWN-5 — `lore session list` reports a liveness verdict derived from pid + start time, never from claim age.
- AC-REPLAY-1 — a replay script of lore invocations alone yields all four facts the 2026-08-11 diagnosis required.
- AC-EXCL-1 — a second writer against a held lease exits exactly 4 with the holder's session_id and worktree in its output.
- AC-EXCL-2 — read-only commands exit 0 while a write lease is held.
- AC-EXCL-3 — a lease whose pid is live but whose start time differs is treated as dead.
- AC-EXCL-4 — `lore session steal` refuses without `--force` and writes an audit row with it.
- AC-EXCL-5 — the lease is enforced in the service layer: CLI, MCP and HTTP writes are all refused.
- AC-LOCK-1 — under N concurrent contenders for one resource lock, exactly one succeeds and every loser exits exactly 4.
- AC-LOCK-2 — `flock`-held locks are released when the holder is killed with SIGKILL.
- AC-LOCK-3 — out-of-order acquisition is rejected.
- AC-SCOPE-1 — a cross-plan anchor collision is refused by the gate AND reported by `lore ready`, asserted by one oracle spanning two plans.
- AC-BIN-1 — `bun run build` produces a content-addressed binary and switches the pointer atomically; a process holding the previous binary open is unaffected.
- AC-MSG-1 — a mailbox message is delivered between sessions, and the surface labels it advisory.


## Acceptance Criteria (structured)

- [⚑] [script] AC-OWN-1: lore territory --json partitions every worktree and branch corpus-wide into mine / foreign / unowned / unmeasured; the four buckets are disjoint and their union equals the total discovered set (sum-equals-total asserted over a seeded corpus); a branch that cannot be classified is filed under unmeasured and is NEVER dropped; every foreign entry names its holder session_id and worktree path
  script: test — bun test packages/lore/tests/unit/adapters/cli/territory-partition.bun.test.ts 2>&1 && echo 'AC-OWN-1 PASS: territory partitions branches corpus-wide and names each foreign holder'
- [⚑] [script] AC-OWN-2: lore claim persists claim.branch from the caller worktree; when no branch is measurable the record is unmeasured, never unowned
  script: test — bun test packages/lore/tests/unit/service/claim-branch-binding.bun.test.ts 2>&1 && echo 'AC-OWN-2 PASS: claim.branch persisted; unmeasurable branch records unmeasured not unowned'
- [⚑] [script] AC-OWN-3: active_sessions[].branches is non-empty whenever the claiming session worktree has a branch, replacing the always-empty value measured on 2026-08-11
  script: test — bun test packages/lore/tests/unit/service/active-sessions-branches.bun.test.ts 2>&1 && echo 'AC-OWN-3 PASS: active_sessions[].branches populated from the claiming worktree'
- [⚑] [script] AC-OWN-4: a commit created under a claim carries the Lore-Session git trailer, readable via git log --format=%(trailers:key=Lore-Session,valueonly); and a commit created in that SAME worktree after a `lore release` of that claim carries NO such trailer. Both directions MUST be driven through TaskWorkflowService live call sites (claim binds, release unbinds) — an oracle that calls the real-git-port exports directly proves only that the exported capability works, which is the exact unwired state this criterion exists to refuse. NARROWING RECORD (2026-08-13, post-attestation): the sentence above previously read as an UNCONDITIONAL promise about any commit under any claim. The shipped mechanism is deliberately narrower and its own code says so: `real-git-port.ts` installs the commit-msg hook only when the resolved hooks directory lies inside the git dir OR inside a KNOWN working tree of this repo (reusing `parsePorcelainWorktreeList`), and returns `skipped-unsafe-hooks-path` when `core.hooksPath` resolves OUTSIDE EVERY known working tree. Verified by reading the guard 2026-08-13. This is a STATEMENT-TO-IMPLEMENTATION alignment, NOT a weakening of the oracle: the command, its 6 pass rows and its 5 attestations are byte-unchanged, and the refusal being documented is a SAFETY property (never install a hook at an unknown location), not a gap. The unconditional reading is what was never true — so this criterion now certifies exactly the guarantee that ships. In this repo `core.hooksPath` is `hooks`, inside the main checkout, so the trailer does install; a consumer pointing hooksPath outside every worktree gets no trailer BY DESIGN.
  script: test — bun test packages/lore/tests/unit/adapters/cli/lore-session-trailer.bun.test.ts 2>&1 && echo 'AC-OWN-4 PASS: claim binds and release unbinds the Lore-Session trailer, both through TaskWorkflowService live call sites'
- [⚑] [script] AC-OWN-5: lore session list derives each liveness verdict from a probed process identity (pid plus process start time) and NEVER from claim age; a live pid with a mismatched start time is reported dead. NARROWING RECORD (2026-08-13, post-attestation): the sentence above previously said "the orchestrator pid". The shipped mechanism records `process.ppid` — the parent that invoked THIS `lore` binary, i.e. the orchestrating shell or agent process — and its own comment at `packages/lore/src/adapters/cli/commands/session.ts:149` states this is "still an approximation of the orchestrator" and that "full orchestrator-pid capture is P2 session-lease mechanism, out of this plan". Verified by reading the call site 2026-08-13. TWO consequences a reader must not have to discover: (1) the identity probed is the CALLER process, not a durable orchestrator identity; (2) self-registration is best-effort and runs ONLY inside `lore session list|show`, skipped entirely when the caller has no measurable session id (MCP/HTTP callers with no CLAUDE_CODE_SESSION_ID) — so a peer session that never ran `lore session list|show` has no heartbeat and is `unmeasured`, which is NOT the same as dead and must never be read as a liveness verdict about it. This is a STATEMENT-TO-IMPLEMENTATION alignment, NOT a weakening: the command, its 4 pass rows and its 4 attestations are byte-unchanged, and what the oracle proves — verdicts come from a probed pid+start-time pair rather than from elapsed claim age — is exactly what it proved before. Recording `process.pid` instead was measured to make every session report dead on the very next probe, so `process.ppid` is the deliberate choice, and closing the remaining gap is P2 work (capture the orchestrator own pid and start time at TaskClaim time), not a defect of this criterion.
  script: test — bun test packages/lore/tests/unit/service/session-liveness-probe.bun.test.ts 2>&1 && echo 'AC-OWN-5 PASS: liveness probed via pid+start-time, never inferred from claim age'
- [⊘] [script] AC-REPLAY-1: against a fixture seeded with exactly 2 sessions and 3 branches (one mine, one foreign holding exactly 1 unmerged commit, one unowned), a replay of lore invocations alone yields the EXACT expected value for each of the four facts the 2026-08-11 diagnosis required: foreign branch set, unmerged commit count per branch, holder session_id per branch, liveness verdict per session; the assertion fails if any of the four is an empty set, so a silent no-op cannot pass
  script: test — bun test packages/lore/tests/integration/territory-replay.bun.test.ts 2>&1 && echo 'AC-REPLAY-1 PASS: the 2026-08-11 diagnosis is reproducible through lore commands alone'
