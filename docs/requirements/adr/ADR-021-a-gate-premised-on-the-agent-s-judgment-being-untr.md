---
id: ADR-021
type: adr
role: decision
title: "A gate premised on the agent's judgment being untrustworthy must have NO agent-settable override"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
# A gate premised on the agent's judgment being untrustworthy must have NO agent-settable override

## Context

`pre-bash-git-safety-gate.mjs` blocks destructive git operations and, unlike every
sibling gate in this repo, defines **no override of any kind** — no env var, no
allowlist, no reason-carrying escape (`grep -E "BYPASS|process\.env"` over the SSOT
returns nothing). Its siblings all have one: lore's deterministic checkpoints honour
`LORE_GATE_BYPASS=1`, the dispatch gate honours `CLAUDE_SUBAGENT_GATE_BYPASS=1`.

The asymmetry was hit directly: an owner explicitly authorised an agent to drop a
stash entry the agent had independently proven redundant (its 12 lines were already
live in `.claude/settings.json` and already committed as `46e1157`). The operation
was still impossible for the agent to perform, and the owner's authorisation had
nowhere to land.

The obvious reading is that this is an inconsistency to fix by adding an override.
That reading was written down in this session and is **wrong**. This ADR records why,
because the wrong version is the intuitive one and will be re-proposed.

## Decision

**No override is added. The absence is the feature.**

The gate's premise is that *an agent's assessment that a destructive operation is
safe cannot be trusted* — Design B states it directly, refusing to auto-allow even
when its own read-only probe reports a clean tree, on the grounds that a probe bug
would become a false-allow and cost data.

An override implemented as an environment variable is settable by the agent itself.
So is a sentinel file (the agent holds `Write`). So is a config key (the agent edits
config). **Every channel inside the agent's environment is agent-forgeable**, which
means any such override collapses to: an agent that wants `git reset --hard` sets the
variable and proceeds. The gate would then block only agents that don't want to be
blocked.

There is exactly one authorisation channel an agent cannot forge: **a shell the agent
does not control.** That is why the gate's own message says to ask the user to run it
themselves. The escape hatch already exists; it is deliberately located outside the
agent's reach, and it is not a workflow inconvenience to be engineered away.

## Consequences

**Accepted cost.** An owner cannot delegate a verified-safe destructive operation to
an agent. Owner-authorised work of this kind requires two steps: the agent verifies
and emits the exact command with its evidence, the owner runs it. This is slower, and
it is the price of the guarantee.

**What the agent still owes.** Because the owner is now the executor, the agent must
make that step cheap and safe: emit the command verbatim and copy-pasteable, state
what was verified and how, and re-verify the preconditions in the same turn the
command is emitted (a stale "it was safe an hour ago" is worthless when the operand
is shared mutable state like a stash index).

**Distinguish this from the gate's real defect class.** The gate legitimately had a
defect — argument-blind probes reporting the wrong blast radius, plus a measured
under-block where a mis-paired quote let `git reset --hard` through at exit 0 (see
`spec-git-safety-gate-probes-report-the-wrong-blast-radius` D6). Fixing the evidence
a gate reports, and fixing what it fails to catch, are always in scope. Weakening
whether it blocks is not.

**The generalisable rule.** For any control whose justification is "the actor's own
judgment is not trustworthy here", an override the actor can set is not an override —
it is a removal with extra steps. Site the authorisation outside the actor, or accept
that the control is absolute.

## Alternatives rejected

- **`GIT_SAFETY_GATE_BYPASS=1`, consistent with sibling gates.** Rejected: agent-settable, therefore equivalent to deleting the gate. The sibling gates it would match are not comparable — `LORE_GATE_BYPASS` guards *corpus workflow conformance* (a wrong bypass produces a badly-shaped document, recoverable), while this gate guards *irreversible working-tree destruction*. Same syntax, incomparable blast radius.
- **A reason-carrying override that logs loudly.** Rejected: an audit trail records what happened after the data is gone. Loudness is not a control.
- **Auto-allow when the probe reports the operation is a no-op.** Rejected by Design B on its original grounds, and reinforced by this session's measurement that a probe CAN be wrong in the narrowing direction: the pre-fix `probeStash` reported the whole 8-entry stash for a single-entry drop, and `probeWorktreeForce` fell through to "Likely SAFE" whenever its git calls failed.
