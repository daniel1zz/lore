# Plan Mode: update

**Purpose**: Record task progress with oracle evidence, AC verification, risk tracking, and constraint carry-forward

## Triggers

- Task completed → verify AC → record evidence → archive
- Phase completed → Phase Gate
- Risk materialized → update risk register
- Session ending → capture carry-forward (handoff)
- User requests progress save

## Workflow

### Task-Level Update (completion path)

1. Identify tasks worked on this session (`lore tree <plan>` badges show claims + evidence)
2. For each task, **AC verification** (MANDATORY):
   - `lore get <task>` → extract `AC:` criteria + `Covers:` spec AC ids
   - Run the oracles; the ORACLE's exit status decides the result — never self-asserted
   - Output: `**[AC CHECK]** task-xxx: ✅ criterion1 | ✅ criterion2 | ...`
3. **Record evidence** (append-only, one record per oracle run):
   ```
   lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual|other> \
     --command "<exact command>" --result <pass|fail> \
     --capture [--ac <spec-AC-id>]
   ```
   - `--capture` makes the runner spawn `--command` and record its own output; `--result pass` without it is refused (only `--oracle manual` takes a hand-written `--output-tail`)
   - A failing oracle is recorded as `--result fail`, then fixed, then re-recorded — the trail is the point
   - Script-mode spec ACs: prefer `lore verify <plan> --task <task>` — the trusted runner
     executes the declared command and records ATTESTED evidence (exit code decides).
     Non-interactive/CI runs need `--allow-new-commands` for new/changed commands (exit 7
     `NEEDS_APPROVAL` otherwise — approve deliberately, don't reflex-flag).
4. **Release + archive** (all AC pass):
   ```
   lore release <task>
   lore set <task> --status approved      # draft → approved (fast-track)
   lore set <task> --status archived      # approved → archived = DONE; unblocks dependents
   ```
   Archiving is what makes `lore ready` mark dependent tasks ready — evidence alone does not.
5. If AC fail and can't be fixed this session: `lore release <task> --reason "AC not met: {detail}"` — the task stays unarchived (still blocking dependents), the reason lands in version history
6. **Estimation tracking**: compare actual effort vs. estimate
   - Output: `**[ESTIMATE_ACTUAL]** task-xxx: estimated {S|M|L} actual {S|M|L}`
   - If actual > estimated by ≥1 size → flag for Reference Class Forecasting adjustment on similar remaining tasks
7. Check newly unblocked work: `lore ready <plan> --json` → display newly ready tasks (highlight critical path)

### Risk Review (per task completion)

- Check if completed task was a risk mitigation task → update risk status to "mitigated"
- Check if any risk triggers were observed during task execution → update risk register
- If risk materialized → activate contingency plan, consider `replan` mode

### Failure Criteria Check (after each task update)

- Check failure/abandonment criteria from SKILL.md:
  - >50% of critical path tasks blocked for >2 sessions? → warn + suggest `replan`
  - >3 risks materialized in same phase? → warn + suggest pause and reassess
  - Scope change invalidates >30% of existing tasks? → warn + suggest `replan`
- Output: `**[HEALTH_CHECK]** criteria: {all_clear | warning: {detail}}`

### Phase Gate (MANDATORY when a phase's last task archives)

```yaml
# 1. Re-read Invariants
- lore get <plan> → parse Invariants from content

# 2. Acceptance Check
- lore list --type task --plan-id <plan> --phase "{phase}" --json → this phase's tasks
- For each: confirm pass evidence exists for every AC (evidence trail in extra, badges on lore tree)
- List: ✅ passed / ❌ failed with reason

# 3. Cross-Phase Consistency
- Compare current phase outputs against prior completed phases
- Check: naming consistency, structural patterns, quality level

# 4. Risk Review (Phase-Level)
- Review Risk Register for this phase:
  - Risks that were expected: mitigated? triggered? irrelevant?
  - New risks discovered during phase execution?
- Output: `**[PHASE_RISK]** mitigated: {n} | triggered: {n} | new: {n} | carried: {n}`

# 5. Estimation Accuracy (Phase-Level)
- Compare estimated vs. actual session-units for the phase
- Output: `**[PHASE_ESTIMATE]** estimated: {e} session-units | actual: {a} session-units | accuracy: {pct}%`
- If accuracy < 70% → apply Reference Class Forecasting multiplier to remaining phases
  - RCF multiplier = actual/estimated for this phase

# 6. Plan-doc update (batched — do it ONCE per phase gate, not per task)
- Editing an approved doc auto-resets it to draft, and re-approving re-fires the
  plan-promote gate. So batch ALL content updates (risk register status, RCF-revised
  estimates, Decisions Log entries, deviations) into one edit at the phase gate:
  - lore get <plan> --raw → current content
  - apply edits → lore set <plan> --content-file /tmp/plan-content.md
  - lore approve <plan> → back to approved (gate re-checks the spec chain — expected to pass)
- Fix deviations before proceeding, or escalate to user

# 7. Proceed — no per-phase user stop (shared/batched-governance.md § Execution)
- Phase Gate passed → auto-proceed to the next phase; record the gate result
  (risk review + estimation accuracy) in the batched plan-doc edit of step 6
- Invariant violated → hard block: fix, re-run the gate (loop back to step 2)
- A measured result on a pre-registered branch path → follow that path, log it
- A result outside every pre-registered branch, or an unfixable Invariant
  violation → the only case to ask the user; replan → switch to mode-replan
```

### Session-End Handoff (replaces in-doc session logs)

Carry-forward context is a HANDOFF doc, not an edit to the plan (keeps the approved plan
stable; `lore feed session-resume` consumes it next session):

```
lore handoff --plan <plan> \
  --file <modified-path> [--file ...] \
  --decision "<judgment>[@<confidence 0-100>]" [--decision ...] \
  --next "<next step>" [--next ...] \
  [--failing-command "<oracle cmd>" --failing-tail-file <path>]
```

- One handoff per session with an active plan — even mid-phase
- `--next` entries are the resume anchor: concrete, ordered, self-contained
- A failing oracle at session end MUST be captured (`--failing-command` + tail) so the
  next session resumes from the failure, not from scratch
- New architectural decisions → `lore create adr --parent <spec it governs> --title ... --decision-status accepted`
  + `lore link <adr> <plan> --type=informs` (durable decisions outlive handoffs)
- Session learnings worth sharing → `lore create knowledge --parent <plan or spec it reviews> --sub-type retro`

### Pre-Completion DoD Check (when all tasks archived)

Before declaring the plan complete, verify all 7 DoD criteria from SKILL.md § Definition of Done. SKILL.md is the single source of truth — do not restate the criteria here.

Checklist items (by reference):
1. All tasks archived or deprecated with rationale? ✅/❌
2. Pass evidence per task; attested evidence for script ACs (`lore verify <plan>`)? ✅/❌
3. `lore assess <plan>` run (in the initiative's end-of-run batch) + findings triaged? ✅/❌
4. Risk register reviewed — all H/M risks mitigated or accepted with rationale? ✅/❌
5. No open `[NEEDS CLARIFICATION]` markers? ✅/❌
6. Handoff written with carry-forward context? ✅/❌
7. Estimation accuracy logged (actual vs. estimated per phase)? ✅/❌

Output: `**[DOD_CHECK]** {passed_count}/7 | status: {PASS | FAIL: {missing items}}`

## Required Output

- Task evidence recorded (oracle, command, result, ac refs) + tasks archived
- Estimation actuals tracked per task
- Risk register updated (batched into the phase-gate plan edit)
- Phase Gate executed (if phase completed) — including risk review + estimation accuracy
- Failure criteria health check displayed
- Handoff written with carry-forward constraints + risk watch items (session end)
- Progress summary displayed (`lore ready <plan> --json` for newly unblocked work)
