# Plan Mode: resume

**Purpose**: Load existing plan with full constraint context, risk awareness, and critical path status into current session

## Triggers

- "continue", "resume", "pick up where left off", specific plan slug
- Session start: the injection carries only this seat's claims and plan handoff; run `lore bootstrap --json` on demand for active_plans / latest_handoffs / resume_hint
- Workflow routes here when active plan detected

## Workflow

```yaml
# 1. Identify plan
- `lore bootstrap --json` on demand → active_plans + resume_hint
- If specific plan slug → lore get <plan-slug> → load plan content
- If not specified → lore list --type plan --json → prompt user to select

# 2. Pull session-resume context
- lore feed session-resume --plan <plan>
  → latest handoff for this plan: modified files, decisions, next steps, failing oracles
- If a direct handoff slug is known: lore feed session-resume --handoff <slug>

# 3. Load task state
- lore tree <plan> → tasks grouped under phase headers, claim/evidence badges
  ([claimed:by@branch (stale) ✔n/✘n], [invalid])
- lore list --type task --plan-id <plan> --json → full task fields
- Identify: current phase (unarchived tasks with evidence), completed phases
  (all tasks archived), pending phases

# 4. Load constraints (MANDATORY — prevents drift)
- Parse Invariants from plan content (lore get <plan>)
- Identify current phase constraints from the phase --description + plan content
- Read latest handoff (step 2) for carry-forward context
- Combine into constraint briefing (~30 lines)

# 5. Load risk context (MANDATORY — prevents blind spots)
- Parse Risk Register from plan content
- Identify: active risks (not yet mitigated/closed), triggered risks, risks relevant to current phase
- Check: any risks with triggers that should be re-evaluated given current state?
- If environment changed since last session → flag risks that need re-assessment

# 6. Load critical path & estimation context
- Parse Critical Path section from plan content; cross-check surviving (unarchived) tasks
- Calculate: remaining critical path duration (session-units)
- Compare: actual progress vs. estimated progress (ahead/behind schedule?)
- If behind schedule → flag and suggest priorities or replan consideration

# 7. Get ready tasks + live sessions
- lore ready <plan> --json → ready records + sessions[] + anchor_conflicts[]
- sessions[] shows who else (which actors/worktrees) currently holds fresh claims —
  do NOT dispatch onto tasks another live session is working
- anchor_conflicts[] non-empty → resolve before dispatch (serialize or release stale claims:
  the report names the exact `lore release <slug> --force` recovery command)
- Highlight critical path tasks (--priority critical/high) among ready tasks
```

## Resume ticket disposition

Enforced by the Stop-time resume-ticket coverage check:

- A consumed resume ticket is bounded from BELOW as well as from above: it prints one ordinal-tagged line per item (`KD<n>` per key decision, `NS<n>` per next step), preceded by a cardinality line stating how many items there are in total. Account for EVERY printed item before the session ends — one line each, `<item-id>: done` or `<item-id>: deferred:<reason>`. The obligation is to ACCOUNT, not to complete: a ticket whose items are all legitimately out of this session's scope closes cleanly once every item carries its own deferral reason AND that reason names WHERE the deferred work went — a filed issue reference (`#<n>`) or a corpus slug. A reason alone is not a destination: it parks the work nowhere. New problems found mid-session belong in `lore report-issue`, not in this session's scope — that is what makes the deferral honest and lets the original task close (measured 2026-08-25: of 696 next-step items across 139 handoffs, 458 were bare prose that entered no queue). None may go unmentioned. Obeying the scope declaration alone does not satisfy this duty; the two bound opposite directions (measured 2026-07-30: a report dropped 3 of 10 printed items while trespassing on nothing).

## Constraint Briefing Format

```markdown
**Resuming Plan: [title]** (slug: plan-xxx)
Progress: {completion_pct}% ({archived}/{total})
Schedule: {estimated_remaining} session-units remaining | {ahead/behind/on-track}
Phases: ✅ Phase 1 | 🔄 Phase 2 | ○ Phase 3

**Invariants (global)**:
- [invariant 1]
- [invariant 2]

**Current Phase Constraints**:
- [constraint 1]
- [constraint 2]

**Carry-Forward (from latest handoff)**:
- [pattern established]
- [decision made]
- [failing oracle to resume from, if any]

**Active Risks** ({count}):
- 🔴 [H-impact risk — trigger + mitigation status]
- 🟡 [M-impact risk — trigger + mitigation status]

**Critical Path** (remaining: {N} session-units):
→ task-xxx → task-yyy → task-zzz

**Live Sessions** ({count}): [actor@machine:worktree — task slugs held]
**Anchor Conflicts**: [none | list with recovery commands]

**Ready Tasks** ({count}):
- ⭐ task-xxx: [title] (priority: critical, **critical path**)
- task-yyy: [title] (priority: medium, slack: {n} units)
```

## Required Output

- Context briefing with constraint + risk + schedule summary
- Task tree displayed (`lore tree <plan>`)
- Ready tasks listed with slugs (critical path highlighted)
- Live sessions + anchor conflicts surfaced (from `lore ready --json`)
- Active risks listed with status
- Schedule health: ahead/behind/on-track
- User informed of next actions
