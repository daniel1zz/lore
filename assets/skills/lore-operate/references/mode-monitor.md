# Mode: monitor

**Purpose**: Runtime monitoring analysis, observability operations, and SLO status management

## Boundary with deploy:observability

- `deploy:observability` = **Build Time** — Create config files, setup infrastructure, install agents
- `operate:monitor` = **Run Time** — Analyze live data, investigate alerts, tune thresholds, track SLO status

## Scope

Metrics ANALYSIS | Log INVESTIGATION | Trace ANALYSIS | Alert INVESTIGATION | Dashboard INTERPRETATION | SLO/SLI STATUS | Alert TUNING | Anomaly DETECTION

## Observability Pillars

| Pillar | Patterns | Platforms | Key Questions |
|--------|----------|-----------|---------------|
| Metrics | RED (services), USE (resources) | Prometheus, Grafana, DataDog, CloudWatch | What is happening? How much? |
| Logs | Structured JSON, Correlation IDs | ELK, Loki, CloudWatch Logs | Why did it happen? What context? |
| Traces | Spans, context propagation, sampling | Jaeger, Zipkin, OpenTelemetry | Where in the call chain? How long? |

## Workflow

### 1. SLI/SLO Status Review

Before investigating specific alerts, assess overall service health:

1. **Check SLO dashboards** for all services in scope
2. **Calculate error budget remaining**: `budget_remaining = 1 - (bad_events / total_events) / (1 - SLO_target)`
3. **Identify burn rate**: Is budget being consumed faster than expected?
4. **Classify urgency**:

| Burn Rate | Budget Horizon | Action |
|-----------|---------------|--------|
| < 1x | > 30 days | Healthy — no action |
| 1-3x | 10-30 days | Monitor closely, plan improvements |
| 3-10x | 3-10 days | Investigate, prioritize fixes |
| > 10x | < 3 days | Escalate, consider incident declaration |

Output: `[SLO_STATUS] service: {name} | budget_remaining: {%} | burn_rate: {x} | action: {classify}`

Tools: `serena: execute_shell_command` (query Prometheus/Grafana API) | `agent-browser: eval` (dashboard screenshots)

### 2. Alert Investigation

When investigating a firing alert:

1. **Identify the alert**: Name, severity, when it started, which service
2. **Check context**: Recent deploys, config changes, upstream/downstream status
3. **Analyze metrics**: Is this a spike, trend, or step change?
4. **Correlate signals**: Cross-reference metrics + logs + traces for the same time window
5. **Determine action**: Tune threshold / escalate to incident / document false positive

Decision tree for alert outcomes:
```
Alert fires →
  ├─ Real issue, customer impact → Escalate: Skill('operate', 'incident')
  ├─ Real issue, no customer impact → Investigate, fix, update runbook
  ├─ False positive → Tune threshold, document in alert doc
  └─ Transient spike → Add hysteresis/for-duration, document pattern
```

Tools: `serena: execute_shell_command, search_for_pattern` | `agent-browser: navigate, eval` | `lore: lore search, lore get`

### 3. Instrument Code (when gaps found)

If monitoring analysis reveals instrumentation gaps:

1. **Identify missing signals**: Which RED/USE metric is absent? Which path has no traces?
2. **Add instrumentation**: Metrics counters, histogram buckets, log enrichment, span creation
3. **Verify collection**: Confirm new metrics appear in collection pipeline
4. **Update dashboards**: Add panels for new signals

Tools: `serena: find_symbol, replace_symbol_body, insert_after_symbol` | `lore: lore set`

### 4. Dashboard Analysis

When interpreting dashboards for operational review:

| Pattern | What It Means | Next Step |
|---------|--------------|-----------|
| Gradual increase | Resource leak, growing load | Capacity planning (scaling mode) |
| Periodic spikes | Batch jobs, cron, traffic patterns | Correlate with schedule, consider pre-scaling |
| Step change | Deploy, config change, external factor | Correlate with deploy timeline |
| Sawtooth | GC cycles, cache eviction, rotation | Check GC tuning, cache sizing |
| Flat-line at limit | Resource saturation | Immediate scaling or optimization |

### 5. Alert Tuning

Systematic approach to reduce noise and improve signal:

1. **Audit alert inventory**: List all alerts, their fire frequency, action rate
2. **Classify each alert**:
   - Actionable (human must do something) → Keep, ensure runbook exists
   - Informational (FYI only) → Convert to dashboard annotation, remove page
   - Noisy (fires often, rarely actionable) → Tune threshold, add for-duration, aggregate
   - Stale (references removed service/metric) → Delete
3. **Target**: Every page-worthy alert has a runbook entry. Alert-to-action ratio > 80%.

Output: `[ALERT_AUDIT] total: {N} | actionable: {N} | noisy: {N} | stale: {N} | tuned: {N}`

## On-Call Support

When supporting on-call engineers:

| Situation | Guidance |
|-----------|----------|
| Alert with runbook | Follow runbook steps, escalate if no resolution in time budget |
| Alert without runbook | Investigate using observability pillars, document resolution, create runbook entry |
| Unclear severity | Default to higher severity, downgrade after investigation |
| Cognitive overload | Focus on customer impact first, delegate investigation of non-impacting alerts |

### On-Call Handoff Checklist
- Outstanding alerts and their status
- Active incidents and current IC
- Recent changes (deploys, config) in last 24h
- SLO budget status for critical services
- Any known upcoming maintenance windows

## Exit Criteria

Mode is COMPLETE when ALL of:
- [ ] SLO status reviewed for all in-scope services → `[SLO_STATUS]` output produced
- [ ] All firing alerts investigated with documented outcome (escalate / tune / fix)
- [ ] Any instrumentation gaps documented or addressed
- [ ] Alert tuning recommendations documented (if alert audit was performed)
- [ ] Runbook updated with new findings (`docs/ops/runbooks/` or lore via `lore set <runbook>`)
- [ ] Report: `[MONITOR_COMPLETE] services: {N} | alerts_investigated: {N} | SLO_violations: {N} | actions: {list}`

## Static References

- [sre-methodology.md](sre-methodology.md) — SLI/SLO lifecycle
- [prometheus-patterns.md](prometheus-patterns.md) — Metrics patterns and queries
- [logging-best-practices.md](logging-best-practices.md) — Log structure and analysis
