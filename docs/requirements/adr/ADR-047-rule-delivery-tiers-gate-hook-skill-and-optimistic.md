---
id: ADR-047
type: adr
role: decision
title: "Rule delivery tiers (gate / hook / skill) and optimistic interception at the nearest cheap-repair checkpoint"
status: approved
priority: high
created: 2026-10-15
updated: 2026-10-15
tags: [governance, hooks, skills, distribution]
parent: PRD-001
links:
  - {id: ADR-015, type: relates-to}
---
# ADR: Rule delivery tiers and optimistic interception

## Status
Accepted (owner directive, 2026-10-15)

## Context
Lore delivers discipline to agents through three mechanisms that were never told apart: deterministic gates (service layer, or a hook that denies), hook injection (SessionStart / SubagentStart text), and skills (model-invoked). Measured 2026-10-15 in this repo and its three consumer projects:

- Form was mistaken for force. `pre-subagent-gate` is a PreToolUse hook on every Edit that never refuses: its notice reaches the model as additionalContext (since 1d09f4b4, which fixed #142), but the read-tracking file it consults has no shipped producer, so it reports every edit as 'file not Read this turn' (#184). A per-edit advisory that fires on every edit is noise, not enforcement.
- High-frequency nodes carry checks. One plain Bash call starts 6 lore hook processes at user level and 10 in this repo (g1–g4 registered twice, #22); each costs 50–65 ms. Claude Code runs matching hooks in parallel ("All matching hooks run in parallel", code.claude.com/docs/en/hooks), so wall latency is small; the real cost of a frequent check is the deny → re-plan → retry loop it triggers.
- The g1–g4 gate hooks duplicate checks the service layer already performs for CLI, MCP and HTTP alike.
- A SessionStart hook (`session-start-fragments`) runs every session for an outlet that has zero fragments, and prints a false failure banner when it has nothing to say (#143).

## Decision

### 1. Every rule or check names its tier — "what stops this when it is violated?"

| Tier | Mechanism | Guarantees | Does not guarantee | Holds |
|---|---|---|---|---|
| L1 gate | lore service-layer gate (identical for CLI/MCP/HTTP), or a hook that returns deny/block | the violating action does not happen | compliance next time (it returns a feeding pack, but the model must still act on it) | invariants that must hold |
| L2 hook injection | SessionStart / SubagentStart / Stop output the model sees | the model sees it | that the model follows it | fixed-moment state and fixed procedure the model must know |
| L3 skill | model-invoked; may pull live data with `` !`cmd` `` | zero context cost until needed | that it is loaded at all (model's choice, code.claude.com/docs/en/skills) | judgment: AC design, decomposition, dispatch composition, triage |

Corollaries:
- A tier is decided by what a hook DOES, not by its event: the same event (e.g. Stop) can inject text the model sees (L2) or block the turn (L1 at the turn-end checkpoint of section 2).
- A hook is a delivery channel, not an enforcement point by virtue of being a hook. A hook that neither denies nor reaches the model (stderr + exit 0) belongs to no tier and must be moved into one.
- Real enforcement lives in the lore binary's service layer. Hooks exist only in Claude Code; MCP, HTTP and other agents never pass through them.
- A rule may move from always-loaded (rules file / L2) to L3 only if some checkpoint in section 2 backstops it. A rule with no backstop stays always-loaded or gets a gate first.

### 2. Optimistic interception — check at the nearest aggregation point where repair is still cheap
Default assumption: the model follows the rules it was given. Checks run at aggregation points, not on every action, and a check that fires blocks once with the full list of findings.

| Checkpoint | Frequency | May do | Examples |
|---|---|---|---|
| Per tool call (PreToolUse/PostToolUse on Edit, Write, Read, plain Bash) | highest | record without judging; block ONLY irreversible actions | `post-edit-mark` (record), `pre-bash-git-safety-gate` (reset --hard, branch -D) |
| Turn end (Stop) | once per turn | behavioural discipline over the turn's accumulated record | main agent edited source instead of dispatching; docs made stale by this turn's edits |
| Milestones (claim, evidence/verify, done, merge, plan close, push) | low | result quality | tests, attestation, anchors, floors |

Rules:
- "Optimistic" never means "as late as possible". The checkpoint is the nearest one at which the change, its reason and its context are still in hand. Behavioural checks therefore run at Stop, not at merge or push; merge/push checks remain only as a second line of defence.
- A per-tool-call block is justified only when repair after the fact costs far more than the interruption (irreversible or cross-session-destructive actions).
- A turn-end check must stay quiet when compliant (no edits → no output) and its false-positive rate is a tracked metric: a check that fires on compliant turns has degraded into frequent interception.

## Consequences
- Spec A (unified upgrade reminder): `lore setup --project --check`; one directive advisory from `session-start-resume`; `session-start-fragments` and the `hook:session-start` outlet are retired (#143, #144).
- Spec B (move interception points): delete the g1–g4 gate hooks after verifying service-layer parity (#22); replace per-Edit `pre-subagent-gate` with a single Stop check merged with `stop-doc-sync` (#184, #190); fix `pre-tool-harness-run`'s prefix (#146).
- Spec C (re-tier rules): audit the 22 rules files, move backstopped judgment content into existing skills, path-scope file-specific rules.
- Review question for every new hook, gate or rule: which tier, which checkpoint, and what is its repair cost if caught there?
