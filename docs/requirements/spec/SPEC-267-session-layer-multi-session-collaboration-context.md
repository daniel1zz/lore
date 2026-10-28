---
id: SPEC-267
type: spec
role: spec
title: "Session Layer (multi-session collaboration & context continuity) (domain overview)"
status: deprecated
priority: medium
created: 2026-07-26
updated: 2026-10-10
tags: []
---
## 15. Session Layer (multi-session collaboration & context continuity)

**Vision (owner, 2026-07-10)**: sessions become governed, first-class work units. Today Lore governs artifacts (docs) and their production functions (prompt/skill — IoC P1), but not the unit that produces them: an agent session. Cross-session amnesia, context-drift-vs-`/clear`-loss, and multi-session write conflicts are the three highest-ranked unsolved pain points in the 2026-07-10 strategic review. Three capabilities, all read-side computed (SPEC-025 ethos — no daemon, no heartbeat):

- **S1 Session bootstrap** — a `lore_bootstrap` MCP tool / CLI verb emitting the pointer-set (tree roots, active plans, pending queue, caller's fresh claims, armed gates) for SessionStart hook injection. Replaces the DocMan bootstrap dependency (gap recorded in `knowledge-docman-replacement-assessment`). Pointers + summaries, never full dump (IoC ADR boundary 2).
- **S2 Session handoff** — `lore handoff` persists a typed session digest (knowledge `sub_type: handoff`: modified files, active plan/task ids, key decisions with confidence scores, failing oracle output) and `lore feed session-resume` replays it at the next session's start. Makes `/clear` lossless: the cure for context drift stops costing the context. Handoff docs enter the same review/judge loop as every other doc — an unreviewed handoff is advisory, never authoritative.
- **S3 Session registry & write-conflict safety** — lightweight session records (actor, machine, worktree, branch, held claims) surfaced in `lore ready` / `lore tree`; a file-anchor overlap predicate at the task-claim gate upgrades the worktree-mutex *convention* (CLAUDE.md) into a corpus-enforced *predicate* — the same convention→predicate move P2 made for upstream approval.
- **S4 Two-tier worktree seat model (committed v0.10)** — a *plan seat* (worktree on branch `plan/<slug>`, bound to a plan — never to a session) is the cross-session home for a feature's execution: sessions serially occupy it (SPEC-047 auto-derives the actor from the branch), code-state WIP commits to the plan branch between sessions (the handoff doc carries corpus context; the plan branch carries code context), and short-lived task/subagent worktrees fork from and merge back to it; the plan branch merges to main exactly once, at plan close — aligning the git integration boundary with the plan-close gate (SPEC-054) and `lore assess`. `lore seat` (the sugar SPEC-047 explicitly deferred, now committed) mechanizes the seat lifecycle: `seat <plan>` (entry: readiness check + rebase + worktree add + branch naming), `seat list` (enumerate active seats — load-bearing for choosing among >1 concurrent plan seat), `seat resume` (re-enter an existing seat). Bootstrap's `resume_hint` becomes seat-aware: `lore bootstrap` gains a seat-signal input (branch or worktree, supplied by the SessionStart hook from its SPEC-047 detection — today `bootstrap(by, now)` carries no such signal, a named design change) and inside a seat resolves to that seat's plan thread, never the corpus-global newest handoff; behavior is specified per equivalence class (main checkout / seat worktree / task-worktree-under-seat / detached HEAD), each with its own oracle. Seat discipline is mechanized, not aspirational: WIP MUST be committed to the seat branch before session end (the seat briefing states it; `lore handoff` warns on a dirty seat tree); deleting a seat worktree with unmerged commits is REFUSED by `lore seat` (escape: explicit `--force` naming the branch that still holds the commits); a cross-plan merge conflict at plan→main is a LOUD rejected merge resolved on the integration checkout, never a silent overwrite. Honest limits (recorded, not hidden): the anchor-overlap gate is plan-scoped — cross-plan file conflicts surface only at plan→main merge (mitigation: disjoint file scopes across concurrent plans as a planning-time discipline); single-task plans collapse to one tier (a worktree straight off main, merged and removed at task end). Cost counter-metric tracked alongside G13: live branch count + seat branch lifetime + merges-per-plan vs the pre-seat baseline — if the seat tier's integration cost exceeds its disambiguation benefit on this data, the two-tier model reverts to single-tier (kill criterion, §8 family).

Non-goals: no live message bus between sessions (the corpus is the medium); no daemon (freshness TTL-computed like claims); no seat lock service (git's own index.lock + serialized merges on the integration checkout suffice).

### Session-start handoff neutrality (SPEC-096, live 2026-07-27)

The tier-1 session-start injection no longer nominates a single `resume_hint` (seat-scoped runs keep it — a seat IS a resume context); instead the injection presents a neutral open-thread directory. Handoff derivation filters archived/deprecated/invalidated docs so dead threads never resurface, and the corpus-workflow governance prose carries the never-self-resume prohibition: a session consumes handoffs it did not write — it never re-enters its own.

### Resume-ticket accounting is bounded from BOTH ends (live 2026-08-01)

S2's handoff replay is bounded from above by the ticket render and from below by
an accounting duty: a consumed resume ticket prints one ordinal-tagged line per
item behind a cardinality line, and the session may not end until every printed
item carries a disposition — `done`, or `deferred:<reason>`. The obligation is to
ACCOUNT, not to complete: a ticket whose items are all legitimately out of scope
closes cleanly once each carries its own deferral reason.

Three properties make that floor real rather than declarative, each landed after
its predecessor was measured inert:

- **The verdict travels the Stop block channel** (`spec-resume-ticket-coverage-floor-blocking-channel-arming`
  H1/H2). An exit-1 status is a NON-blocking Stop status and was measured to
  change nothing — 0 of 130 turns complied — while the same model complied 10/10
  when the same obligation arrived as a stdout `{"decision":"block"}` carrying a
  required-output template. The exit status now carries no verdict at all.
- **Arming keys on the tool that PRODUCED the ticket** (H4), not on text that
  merely contains one, so auditing or quoting an archived handoff imposes no
  fabricated duty; and dispositions accumulate across the whole post-ticket
  transcript (H5), so one accounting closes an item permanently instead of
  re-arming every turn.
- **The satisfaction side is bounded too** (`spec-resume-coverage-floor-the-satisfaction-boundaries-a`
  S1/S2): a deferral without a non-empty reason closes nothing — the reason is
  what keeps an unconditionally-armed floor from degrading into noise — and a
  disposition emitted on a SIDECHAIN (subagent) chain cannot discharge the duty,
  while arming stays chain-blind. The asymmetry is deliberate: a subagent that
  consumes a ticket obliges the main agent to account for it in output the
  operator actually reads, and no subagent output can silently discharge it.

Honest limit, recorded rather than hidden: the sidechain rule is a tightening
against an UNSTATED environment assumption, not against a live vector. On the
harness measured 2026-08-01, subagent turns go to separate
`<session-id>/subagents/agent-<id>.jsonl` files and never appear in the main-chain
transcript a Stop hook hands the verb, so shadow-discharge was unreachable — the
rule exists so that a future harness merging the chains cannot silently satisfy
an obligation the operator never sees. That environment fact is deliberately NOT
an acceptance criterion (S3): asserting where the harness writes its transcripts
would test the harness, and would go red on a change that is not a lore
regression.

### Ownership is queryable, and liveness is honest about what it cannot see (live 2026-08-13)

Two read surfaces landed by `plan-land-multi-session-concurrency-p1-queryable-ownership-of`
make "who owns this?" answerable without asking a human:

- `lore territory` partitions every worktree and branch corpus-wide into
  **mine / foreign / unowned / unmeasured** (AC-OWN-1). Before it existed, a session
  deciding whether a worktree was safe to remove had only git metadata, which cannot
  distinguish "a peer is mid-session here" from "abandoned and already merged" — the
  question that caused a near-loss of 726 lines of unmerged work.
- `lore session list` / `lore session show <id>` joins corpus claims against PROBED
  process liveness (AC-OWN-5).

The load-bearing property is the fourth partition value. Liveness is measurable ONLY
for a session that has itself run the command at least once on this machine; a peer
that never has reports `unmeasured`, NOT `dead`. So an empty or silent liveness answer
is a measurement limit that the output states, rather than a claim that nobody is
working. ⛔ A caller must never read `unmeasured` — or `lore bootstrap`'s
`active_sessions` coming back empty — as evidence that no peer session is live.
Measured 2026-08-18: a peer session held this checkout, committed to `main` mid-turn
and pruned its own worktree, while `active_sessions` read `[]` throughout, exactly as
the contract permits.

⛔ A session-collapse report is never repaired by prescribing a more unique
`LORE_ACTOR`: identity uniqueness and liveness measurability are different properties,
and only the second is what these surfaces report.


## Acceptance Criteria (structured)

- [·] [script] AC-DOV-1: Content parity with source PRD section holds: lore migrate prd-to-outline --dry-run for this section exits 0 reporting already_migrated=true with 0 failed invariants (char-coverage, section-ref set equality, R-id set equality)
  script: e2e — lore migrate prd-to-outline --prd prd-lore-internal-first-ai-team-knowledge-platform --section session-layer-multi-session-collaboration-context-continuity --dry-run
