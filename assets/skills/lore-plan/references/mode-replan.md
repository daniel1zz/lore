# Plan Mode: replan

**Purpose**: Modify plan structure in response to scope changes, risk materialization, estimation misses, or user requests. Plans are living documents, not immutable artifacts.

## Triggers

- Scope change (new/dropped requirements from user or spec update)
- Risk materialized (contingency activation needed)
- Estimation miss (task took much longer/shorter than estimated, critical path shifted)
- Dependency change (blocked by external, new dependency discovered)
- Failure criteria met (see SKILL.md Plan Exit Criteria)
- User request ("add task", "remove task", "restructure", "re-scope")

## Workflow

```yaml
# 1. Load current plan state
- lore get <plan> → plan content (Invariants, Risk Register, Critical Path)
- lore tree <plan> → task tree with phase grouping + claim/evidence badges
- lore ready <plan> --json → ready/blocked state + live sessions + anchor conflicts
- Identify: which tasks are archived (done), claimed (in flight), pending, blocked, deprecated

# 2. Change Request Analysis (ST reasoning MANDATORY)
- Use mcp__sequential-thinking__sequentialthinking to analyze:
  - **What changed**: describe the change trigger (scope, risk, estimation, dependency)
  - **What's affected**: which tasks, phases, blocks edges are impacted
  - **Critical path impact**: does the change affect the critical path? new duration?
  - **New risks**: does the change introduce new risks?
  - **Options**: ≥2 replan approaches with tradeoffs

# 3. Change Impact Assessment (MANDATORY — output before making changes)
- Output: `**[REPLAN_IMPACT]**`
  - `Change: {description}`
  - `Affected tasks: {list of task slugs}`
  - `Critical path: {unchanged | shifted from X to Y session-units}`
  - `New risks: {list or NONE}`
  - `In-flight collisions: {tasks currently claimed that this replan touches — coordinate before modifying}`
  - `Recommended approach: {option N} — {rationale}`
- Approach inside the pre-registered branches → the AI picks the recommended option, logs it, proceeds to step 4 (no stop)
- Outside every pre-registered branch → the approach is one question in a scoped batched-governance S1 interview, together with every other question this replan raises

# 4. Execute Plan Modifications
- Operations available (can combine multiple):

  ## 4a. Add tasks / phases
  - New phase: lore phase add <plan> "Phase N: {name}" --description "..."
  - New task:  lore create task --title "[Skill:xxx] ..." --parent <plan> --plan-id <plan> \
                 --phase "Phase N: {name}" --anchor <path> --fields-file /tmp/task.yaml   # skeleton: lore template show task --blank
  - All new tasks must satisfy full INVEST compliance (Estimate, Approach, AC, Scope-Alt, anchors)
  - Wire dependencies: lore link <blocker> <blocked> --type=blocks

  ## 4b. Cancel tasks (NOT delete — preserve history)
  - lore set <task> --status approved && lore set <task> --status deprecated
    (draft tasks fast-track through approved; content edit first if a cancellation
     rationale should be recorded in the task body)
  - ⛔ Rewire dependents: a deprecated blocker NEVER satisfies readiness (only archived
    does) — every `blocks` edge FROM the cancelled task MUST be removed or re-pointed:
      lore unlink <cancelled-task> <dependent-task>
      lore link <replacement-blocker> <dependent-task> --type=blocks   # if still needed
  - Verify with lore ready <plan> --json: no dependent stuck behind the cancelled task

  ## 4c. Restructure phases
  - Rename: lore phase rename <plan> "<old>" "<new>"   # updates plan + all referencing tasks
  - Remove empty phase: lore phase rm <plan> "<name>"  # fails while tasks still reference it
  - Move a task between phases: recreate is NOT needed — update the task's phase via
    the same write path used at creation (task-phase validation runs at write time)
  - Split/merge phases: add the new phase, move tasks, rm the emptied phase

  ## 4d. Re-estimate
  - Update task content with revised estimates based on actuals (lore set <task> --fields-file ...)
  - Reference Class Forecasting: if phase 1 tasks averaged 1.5x estimated → apply multiplier to remaining
  - Output: `**[RE_ESTIMATE]** original: {N} session-units → revised: {M} session-units (factor: {x})`

  ## 4e. Re-prioritize
  - lore set <task> --priority <critical|high|medium|low>
  - Critical path tasks always get the boost

  ## 4f. Risk register update
  - Add new risks identified during replan; close risks no longer relevant
  - Update risk status: mitigated / accepted / triggered / closed
  - Lands in the step-7 batched plan-doc edit

# 5. Re-run Critical Path Analysis
- Recalculate critical path with the modified DAG (blocks links + estimates)
- Compare old vs new: `**[CRITICAL_PATH_DELTA]** old: {old_path} ({N} units) → new: {new_path} ({M} units)`
- Update --priority on tasks that entered/left the critical path

# 6. Re-validate plan
- lore ready <plan> --json → structural check: no orphaned tasks, no anchor conflicts,
  non-empty ready set (empty + nothing archived = cycle in blocks links)
- Verify DoR compliance for new/modified tasks
- Material restructure (>30% of remaining tasks) → ONE lore-reader pass over every
  changed artifact together (batched-governance S3 scoped to the change) — the
  5-dimension audit (executability / ac_oracle_binding / context_sufficiency /
  atomicity / dependency & anchor safety)
- If validation fails → fix before proceeding

# 7. Log change in Decisions Log (ONE batched plan edit)
- lore get <plan> --raw → current content; append to Decisions Log:
  ```
  | {date} | REPLAN: {change description} | {rationale} | Impact: {critical path delta}, {tasks added/removed/modified} |
  ```
- Also update Risk Register + Estimation Summary + Critical Path sections in the same edit
- lore set <plan> --fields-file /tmp/plan-fields.yaml   # changed fields / dimension answers only
- lore approve <plan>   # edit reset it to draft; re-approval re-fires plan-promote (expected pass)

# 8. User confirmation — only when the change leaves the pre-registered branches
- Replan that follows a pre-registered branch path → no stop; display the
  modified tree + critical path delta + risk changes and continue
- Replan outside every pre-registered branch → batched-governance S1–S4 scoped to
  the affected artifacts: one interview, one review, one approval
```

## Replan Scope Guard

- Replan modifies the plan structure; it does NOT execute tasks
- After replan, switch to `resume` or `update` mode for execution
- If replan changes >50% of remaining tasks → consider creating a new plan instead
  (link old → new: `lore link <new-plan> <old-plan> --type=relates-to`; deprecate the old one)
- Archived (completed) tasks are NEVER modified by replan — only pending/blocked tasks can be changed
- Tasks with a FRESH claim (see `lore ready --json` sessions[]) are in flight — coordinate
  with the holder (or wait for release) before restructuring them

## Required Output

- Change impact assessment displayed (before modifications)
- Modified task tree displayed (after modifications)
- Critical path delta: old vs. new
- Risk register updates
- Decisions Log entry added (batched plan edit + re-approve)
- Estimation delta: old vs. new total
- User confirmation received (only for a replan outside the pre-registered branches)
