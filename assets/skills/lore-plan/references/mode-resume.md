# Plan Mode: resume

**Purpose**: Load existing plan with full constraint context, risk awareness, and critical path status into current session

## Triggers

- "continue", "resume", "pick up where left off", specific plan slug
- Session start: hook-injected bootstrap (`lore bootstrap --json`) surfaces active_plans / my_claims / latest_handoffs / resume_hint
- Workflow routes here when active plan detected

## Workflow

```yaml
# 1. Identify plan
- Hook-injected bootstrap → active_plans + resume_hint (consume, don't re-call)
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
