---
id: KN-272
type: knowledge
role: knowledge
title: "Handoff supersession keys on (plan, actor) — concurrent sessions sharing an actor archive each other's live tickets"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
# Handoff supersession keys on (plan, actor) — so concurrent sessions sharing an actor archive each other's live tickets

## Measured 2026-07-31

Writing a session-closing handoff as `agent:main-orchestrator`, then running the
routine hygiene sweep:

```
lore archive --sweep
  [superseded_handoff] knowledge-handoff-agent-main-orchestrator-50 —
    superseded by newer handoff knowledge-handoff-agent-main-orchestrator-51
    for the same plan+actor pair
```

Handoff `-50` was **not written by this session**. It belongs to a different,
concurrently running session that happens to use the same actor string. Applying
the sweep would have archived another session's live resume ticket.

The same collision fired in the other direction minutes earlier: this session's
own `-47` was archived as superseded by `-50` — a handoff from a session it has no
relationship to — while `-47`'s next-steps were still partly open.

Both handoffs are correct. Both sessions are correct. The supersession predicate is
what conflates them: it keys on `(plan, actor)`, and with `plan` absent (a
planless, cross-cutting session) the key degenerates to actor alone. Every session
that does not export a distinct `LORE_ACTOR` therefore competes for one slot.

## Why this is worse than the anchor-gate version of the same problem

The corpus already documents actor collision for the `noAnchorOverlap` gate, where
the failure is a gate that **never fires** — a missed protection. Here the failure
is **active**: a sweep that runs and archives the wrong document. A missed gate
leaves things as they were; this changes state, and it changes the state of a
session that has no idea it happened. The next `lore feed session-resume` for that
session's ticket reads an archived doc.

## Severity: LOW, measured rather than assumed

The first draft of this document said "severity is bounded" without measuring it.
Measured directly on this session's own wrongly-archived `-47`:

```
lore feed session-resume --handoff knowledge-handoff-agent-main-orchestrator-47
EXIT=0 — full render, all 12 items (6 decisions + 6 next steps)
```

**An archived handoff stays fully resumable by explicit slug.** So the wrong
archival does not cost recoverability; it costs a row in `latest_handoffs`, the
bootstrap discovery directory. And the governance snippet is explicit that
`latest_handoffs` is a NEUTRAL directory which an agent must never self-resume
from — the user routes by pasting a slug, and that path is unaffected.

So the honest severity is LOW: a hygiene-semantics wart, not a data-integrity
defect. Recorded at this severity deliberately, because the earlier framing
("another session's in-flight ticket is archived by my hygiene command") is
rhetorically stronger than the measurement supports.

## The constraint that makes the root fix a design decision, not a patch

`HandoffExtra` carries exactly `by`, `key_decisions`, `modified_files`,
`next_steps`, `task_refs` — **no session identity of any kind**. And the obvious
candidate, SPEC-042's `(by, machine, worktree)` triple used by `deriveSessions`,
does NOT discriminate here: two concurrent orchestrator sessions run on the same
machine, in the same main checkout, under the same actor string, so all three
components are identical.

Keying supersession per-session therefore requires plumbing a genuinely new
session identifier into `lore handoff` — and that carries a distribution question
this document cannot answer: the harness supplies a session id to HOOKS, but a
consumer invoking the bare binary has none, so the field would be absent for them
and the grouping would silently degenerate right back to actor-only.

That is why this is left as an owner decision rather than fixed unilaterally.

## What was done instead

The sweep result was read and NOT applied. `lore archive --sweep` prints its
candidates precisely so this is possible; the discipline that matters is that
`--sweep` output is a proposal to be read, never a preamble to `--apply`.

## Two separate fixes, and they are not substitutes

1. **Actor discipline (available today, prose-only).** A session that exports a
   distinct `LORE_ACTOR` cannot collide. This is already mandated for worktree
   dispatch and for main-checkout oracle runs; it is NOT currently mandated for the
   orchestrator's own handoff writes, and `agent:main-orchestrator` is precisely
   the shared string the existing guidance tells everyone to use. The guidance is
   self-defeating here.
2. **Predicate hardening (mechanism).** Supersession by `(plan, actor)` cannot
   distinguish "the same thread continued" from "two threads that share a name".
   Per the constraint above, a session-keyed fix needs a new identifier plumbed in
   and answers for the consumer-without-a-hook case.

   **The minimal safe change, if the owner wants one line rather than a design:**
   give R2 the same recency guard R3 already has. The asymmetry is the actual hole
   — `archive-candidates.ts` R3 (expired) requires BOTH `age > handoffTtlMinutes`
   AND planless-or-plan-terminal, while R2 (superseded) requires NEITHER, so a
   handoff written seconds ago is instantly a candidate. Gating R2 on age makes a
   still-live ticket unreachable by the sweep while leaving R2's purpose intact
   (it would still reclaim superseded handoffs under an ACTIVE plan, which R3
   never touches — so the two rules stay distinct rather than collapsing).

Fix 1 alone leaves the trap armed for anyone who forgets. Fix 2's minimal form is
one condition and strictly reduces reachable harm; its full form is a design
decision. Recording all of it so the next session does not rediscover this by
archiving someone's ticket — and, more importantly, so nobody treats
`lore archive --sweep` output as a preamble to `--apply` without reading it.
