# Mode: chaos

**Purpose**: Resilience validation through controlled failure injection (chaos engineering)

## Boundary with Other Modes

- `operate:chaos` = **Proactive** — Deliberately inject failures to validate resilience assumptions
- `operate:incident` = **Reactive** — Respond to unplanned failures
- `test:performance` = **Load** — Validate performance under load (no failure injection)

## Scope

Failure INJECTION | Steady-state VALIDATION | Game Day EXECUTION | Resilience ASSESSMENT | Blast-radius CONTROL

## Workflow

### Step 1: Resilience Assessment

Before running experiments, assess current resilience posture:

1. **Identify critical paths**: Which user journeys depend on this service?
2. **Map failure modes**: For each dependency, what happens if it fails?
3. **Check existing mitigations**: Circuit breakers? Retries? Fallbacks? Redundancy?
4. **Review SLOs**: What's the error budget status? Can we afford to inject failures?

Output: `[RESILIENCE_ASSESSMENT] service: {name} | critical_paths: {N} | failure_modes: {N} | mitigations: {N} | gaps: {N}`

Tools: `serena: find_symbol, get_symbols_overview, search_for_pattern` (find circuit breakers, retry logic) | `lore: lore search "<q>" --type knowledge --json` (runbooks, SLO docs)

### Step 2: Experiment Design

Select and design the experiment following the chaos engineering methodology in `chaos-engineering.md`:

1. **Define steady-state hypothesis** with measurable metrics
2. **Select failure scenario** from the catalog (see reference)
3. **Configure blast radius controls** — scope, duration, abort conditions
4. **Prepare rollback mechanism** and verify it works
5. **Document in experiment spec**

Output: `[CHAOS_EXPERIMENT] target: {service} | failure: {type} | duration: {min} | blast_radius: {scope} | abort_conditions: {list}`

Tools: `lore: lore create knowledge --parent <spec or prd it concerns> --sub-type reference` (experiment spec) | `serena: execute_shell_command` (verify rollback mechanism)

### Step 3: Pre-Flight

Before injecting any failure:

| Check | Method | Required |
|-------|--------|----------|
| Steady-state metrics captured | Query Prometheus baseline | YES |
| Abort conditions in monitoring | Verify alert thresholds | YES |
| Rollback tested | Execute rollback dry-run | YES |
| Team notified | Post in team channel | YES |
| No active incidents | Check incident tracker | YES |
| Error budget allows experiment | Check SLO dashboard | YES |
| Business hours (first-time experiments) | Check calendar | YES (first run) |

**HARD BLOCK**: Do NOT proceed if any required check fails.

Output: `[CHAOS_PREFLIGHT] baseline_captured: Y/N | abort_configured: Y/N | rollback_tested: Y/N | team_notified: Y/N | budget_ok: Y/N`

Tools: `serena: execute_shell_command` (metrics queries) | `agent-browser: navigate` (dashboards)

### Step 4: Execute Experiment

1. Start observing metrics dashboard
2. Inject failure using selected tool
3. Observe system response against hypothesis
4. Document observations with timestamps
5. If abort conditions triggered → rollback immediately, document findings
6. After planned duration → stop injection, observe recovery

Tools: `serena: execute_shell_command` (chaos tool commands) | `agent-browser: navigate, eval` (dashboard monitoring)

### Step 5: Analyze & Report

Compare actual behavior against hypothesis:

| Metric | Baseline | During Experiment | After Recovery | Acceptable? |
|--------|----------|-------------------|----------------|------------|
| Availability | {%} | {%} | {%} | Y/N |
| P99 latency | {ms} | {ms} | {ms} | Y/N |
| Error rate | {%} | {%} | {%} | Y/N |

Document result:
- **Hypothesis confirmed**: System handled failure as expected
- **Hypothesis disproved**: Create P0/P1 action items for gaps found
- **Unexpected behavior**: Add to failure mode catalog, investigate

Output: `[CHAOS_RESULT] experiment: {name} | result: CONFIRMED/DISPROVED/INCONCLUSIVE | findings: {N} | actions: {N}`

Tools: `lore: lore create knowledge --sub-type retro` (experiment report) | `lore phase add <plan> "Chaos Remediation"` + `lore create task --parent <plan> --plan-id <plan> --phase "Chaos Remediation"` (action items for gaps — create leaf tasks under a "Chaos Remediation" phase, or a new remediation plan via `lore create plan --parent <spec it implements>` if one does not yet exist)

### Step 6: Action Items

For every gap discovered:

| Gap Type | Action | Priority |
|----------|--------|----------|
| No circuit breaker for dependency X | Implement circuit breaker | P0 |
| No fallback when cache fails | Implement graceful degradation | P1 |
| Alert didn't fire during failure | Fix alert expression / add alert | P0 |
| Recovery took > 5 min | Investigate slow recovery, add auto-healing | P1 |
| Runbook didn't cover this scenario | Update runbook with new procedure | P1 |

Handoff: `→ Skill('implement', 'backend')` for code changes, `→ Skill('operate', 'monitor')` for alert fixes

## Common First Experiments

For teams new to chaos engineering, start with these low-risk experiments:

| # | Experiment | Target | Expected Behavior | Risk |
|---|-----------|--------|-------------------|------|
| 1 | Kill a single pod | Stateless service | K8s reschedules, no user impact | Very Low |
| 2 | Add 200ms latency to DB | Service → DB connection | Requests slow but complete | Low |
| 3 | Block an external API | Service → 3rd party | Circuit breaker trips, fallback activates | Low |
| 4 | Fill disk to 90% | Worker node | Alerts fire, cleanup runs | Low |
| 5 | Terminate a cache node | Redis/Memcached | Cache miss spike, DB handles load | Medium |

## Game Day Orchestration

For a full Game Day event (2-4 hour team exercise), see the Game Day format in `chaos-engineering.md`.

Quick checklist for Game Day facilitation:

1. **1 week before**: Select 3-4 scenarios, assign roles, prepare experiments
2. **Day of**: Brief team (15 min) → Run scenarios (2-3 hours) → Debrief (30 min)
3. **After**: Document results, create action items, schedule follow-ups
4. **Rotate IC role** each scenario — everyone practices incident command

Output: `[GAME_DAY_COMPLETE] scenarios: {N} | confirmed: {N} | disproved: {N} | actions: {N}`

## Exit Criteria

Mode is COMPLETE when ALL of:
- [ ] Resilience assessment documented: `[RESILIENCE_ASSESSMENT]`
- [ ] Experiment designed with steady-state hypothesis and blast radius controls: `[CHAOS_EXPERIMENT]`
- [ ] Pre-flight checks all passed: `[CHAOS_PREFLIGHT]`
- [ ] Experiment executed with real-time observations documented
- [ ] Results analyzed against hypothesis: `[CHAOS_RESULT]`
- [ ] Action items created for any gaps found (with owners and priority)
- [ ] Experiment report stored in lore (`lore create knowledge --parent <plan or spec it reviews> --sub-type retro`)
- [ ] Runbook updated with any new failure modes discovered
- [ ] Report: `[CHAOS_COMPLETE] experiments: {N} | confirmed: {N} | disproved: {N} | actions: {N} | next_game_day: {date}`

## Static References

- [chaos-engineering.md](chaos-engineering.md) — Full chaos methodology, tools, templates
- [sre-methodology.md](sre-methodology.md) — SLO/error budget for experiment gating
- [incident-response.md](incident-response.md) — If experiment triggers real incident
