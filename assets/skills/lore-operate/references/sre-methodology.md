# SRE Methodology Reference

## SLI/SLO/Error Budget Lifecycle

### Stage 1: SLI Selection

Choose Service Level Indicators based on service type. SLIs measure user-perceived quality.

#### SLI Menu by Service Type

| Service Type | Primary SLIs | Measurement |
|-------------|-------------|-------------|
| **Request-serving** (API, web) | Availability, Latency, Error rate | `good_requests / total_requests` |
| **Data processing** (pipeline, ETL) | Freshness, Correctness, Coverage | `records_processed_on_time / total_records` |
| **Storage** (database, cache, blob) | Durability, Availability, Throughput | `successful_ops / total_ops` |
| **Streaming** (event, message queue) | Freshness, Throughput, Processing latency | `events_processed_within_SLA / total_events` |

#### SLI Specification Template

For each SLI, define precisely:

```
SLI: {name}
Type: availability | latency | throughput | correctness | freshness
Numerator: {what counts as "good"}
Denominator: {total events}
Measurement: {how to collect — logs, metrics, synthetic probes}
Exclusions: {what NOT to count — health checks, internal traffic, test users}
```

**Common SLI patterns with Prometheus**:

```promql
# Availability SLI (request-serving)
sum(rate(http_requests_total{status!~"5.."}[window]))
/ sum(rate(http_requests_total[window]))

# Latency SLI (below threshold)
sum(rate(http_request_duration_seconds_bucket{le="0.3"}[window]))
/ sum(rate(http_request_duration_seconds_count[window]))

# Freshness SLI (data pipeline)
1 - (sum(rate(stale_records_total[window])) / sum(rate(records_processed_total[window])))
```

#### SLI Selection Heuristics

1. **User-centric**: SLIs must reflect what users experience, not internal system state
2. **Measurable**: Must be quantifiable from existing or easily-added instrumentation
3. **3-5 per service**: More SLIs = more noise. Focus on the critical few
4. **Avoid vanity metrics**: CPU utilization is NOT an SLI (users don't care about CPU)
5. **Include all critical paths**: If a path matters to users, it needs an SLI

### Stage 2: SLO Targeting

Set Service Level Objectives — the target value for each SLI.

#### Target-Setting Methodology

**NEVER set aspirational targets.** Derive from measured baselines:

1. Collect 30 days of SLI data
2. Calculate percentiles: p50, p90, p95, p99
3. Set initial SLO slightly below current performance:
   - **Availability**: `SLO = floor(current_p50_availability * 10) / 10` (round down to nearest 0.1%)
   - **Latency**: `SLO_threshold = ceil(current_p95_latency * 1.2)` (20% headroom above p95)
4. Validate: Does this target align with user expectations and business needs?
5. Adjust based on business context (competitive requirements, cost of higher target)

#### SLO Target Reference

| Availability | Monthly Downtime Budget | Typical Use Case |
|-------------|----------------------|-----------------|
| 99% | 7h 18m | Internal tools, dev environments |
| 99.5% | 3h 39m | Non-critical B2B services |
| 99.9% | 43m 50s | Standard production services |
| 99.95% | 21m 55s | Important user-facing services |
| 99.99% | 4m 23s | Critical infrastructure, payments |

**Cost-reliability curve**: Each additional "9" roughly 10x the engineering cost. Choose the minimum target that satisfies user needs.

#### SLO Document Template

```markdown
## SLO: {Service Name}

| SLI | Target | Window | Measurement |
|-----|--------|--------|-------------|
| Availability | 99.9% | 30-day rolling | Ratio of non-5xx responses |
| Latency (p99) | < 500ms | 30-day rolling | 99th percentile request duration |
| Error rate | < 0.1% | 30-day rolling | Ratio of application errors |

**Owner**: {team}
**Review cadence**: Monthly
**Last reviewed**: {date}
**Next review**: {date}
```

### Stage 3: Error Budget Policy

The error budget = `1 - SLO target`. For 99.9% availability, the error budget is 0.1% over 30 days.

#### Error Budget Calculation

```
budget_total = (1 - SLO_target) * total_events_in_window
budget_consumed = bad_events_in_window
budget_remaining = budget_total - budget_consumed
budget_remaining_pct = budget_remaining / budget_total * 100
```

Example: 99.9% SLO over 30 days with 10M requests/day:
- Budget total: 0.001 * 300M = 300,000 allowed bad requests
- If 150,000 bad requests so far: 50% budget remaining

#### Error Budget Policy Template

The error budget policy defines what happens at each budget threshold:

| Budget Remaining | Status | Engineering Action | Business Action |
|-----------------|--------|-------------------|-----------------|
| > 50% | Green | Normal feature velocity | Normal roadmap |
| 25-50% | Yellow | Prioritize reliability work (20% sprint) | Review launch plans |
| 10-25% | Orange | Reliability sprint (50% capacity) | Defer non-critical launches |
| 0-10% | Red | Feature freeze, all hands on reliability | Halt launches, stakeholder comms |
| Exhausted | Critical | Full reliability focus until budget recovers | No new features until recovered |

**Policy enforcement**:
- Budget status reviewed weekly in team standup
- Monthly SLO review with engineering leadership
- Budget exhaustion triggers automatic feature freeze (no exceptions without VP approval)

### Stage 4: Burn-Rate Alerting

Multi-window, multi-burn-rate alerting (Google SRE methodology).

#### Burn Rate Concept

Burn rate = how fast the error budget is being consumed relative to the window.

- **1x burn rate**: Budget will be exactly exhausted at window end (steady state)
- **14.4x burn rate**: Budget will be exhausted in ~2% of window (fast burn — page immediately)
- **6x burn rate**: Budget will be exhausted in ~5% of window (slow burn — ticket)

#### Multi-Window Alert Configuration

| Alert | Burn Rate | Long Window | Short Window | Action |
|-------|-----------|-------------|--------------|--------|
| **Page (SEV-1)** | 14.4x | 1 hour | 5 min | Immediate page, start incident |
| **Page (SEV-2)** | 6x | 6 hours | 30 min | Page on-call, investigate |
| **Ticket** | 3x | 1 day | 2 hours | Create ticket, investigate this sprint |
| **Record** | 1x | 3 days | 6 hours | Log for SLO review, no action needed |

**Why two windows?** The long window catches sustained issues; the short window prevents alerting on already-resolved issues.

#### Prometheus Alert Rules

```yaml
# Fast burn: 14.4x over 1h, confirmed by 5m (SEV-1 page)
- alert: SLOBurnRateFast
  expr: |
    (
      sum(rate(http_requests_total{status=~"5.."}[1h])) by (service)
      / sum(rate(http_requests_total[1h])) by (service)
    ) > (14.4 * (1 - 0.999))
    and
    (
      sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
      / sum(rate(http_requests_total[5m])) by (service)
    ) > (14.4 * (1 - 0.999))
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: "SLO burn rate critical for {{ $labels.service }}"
    description: "Error budget being consumed at 14.4x rate. Budget exhaustion in ~50 minutes."

# Slow burn: 6x over 6h, confirmed by 30m (SEV-2 page)
- alert: SLOBurnRateSlow
  expr: |
    (
      sum(rate(http_requests_total{status=~"5.."}[6h])) by (service)
      / sum(rate(http_requests_total[6h])) by (service)
    ) > (6 * (1 - 0.999))
    and
    (
      sum(rate(http_requests_total{status=~"5.."}[30m])) by (service)
      / sum(rate(http_requests_total[30m])) by (service)
    ) > (6 * (1 - 0.999))
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "SLO burn rate elevated for {{ $labels.service }}"
    description: "Error budget being consumed at 6x rate. Budget exhaustion in ~5 hours."

# Ticket: 3x over 1d, confirmed by 2h
- alert: SLOBurnRateTicket
  expr: |
    (
      sum(rate(http_requests_total{status=~"5.."}[1d])) by (service)
      / sum(rate(http_requests_total[1d])) by (service)
    ) > (3 * (1 - 0.999))
    and
    (
      sum(rate(http_requests_total{status=~"5.."}[2h])) by (service)
      / sum(rate(http_requests_total[2h])) by (service)
    ) > (3 * (1 - 0.999))
  for: 15m
  labels:
    severity: info
  annotations:
    summary: "SLO burn rate elevated for {{ $labels.service }}"
    description: "Error budget being consumed at 3x rate. Create investigation ticket."
```

**Parameterize for different SLO targets**: Replace `0.999` with the actual SLO target value. The formula is: `threshold = burn_rate * (1 - SLO_target)`.

### Stage 5: SLO Review Cadence

Regular reviews ensure SLOs remain relevant and aligned with business needs.

#### Monthly SLO Review Agenda

1. **Budget status**: Current remaining budget per SLI
2. **Burn rate trends**: Was budget consumed steadily or in bursts?
3. **Incident correlation**: Did SLO breaches correspond to real user pain?
4. **False positive/negative analysis**: Did we page when we shouldn't have? Did we miss real issues?
5. **Target adjustment**: Should targets be tightened (too easy) or loosened (too aggressive)?
6. **SLI relevance**: Do current SLIs still reflect user experience? New features need new SLIs?
7. **Action items**: What reliability work is needed based on budget trends?

#### SLO Lifecycle States

```
Draft → Active → Review → Adjust/Retire
  │                  │         │
  │                  ↓         │
  └─── Every new service   Quarterly or after
       needs SLOs within   significant incidents
       30 days of launch
```

## Toil Measurement Framework

### Definition (Google SRE)

Toil is work that is:
1. **Manual** — human performs the steps
2. **Repetitive** — done frequently, not one-time
3. **Automatable** — could be done by software
4. **Tactical** — reactive, interrupt-driven
5. **No enduring value** — does not improve the system permanently
6. **Scales linearly** — grows with service/user count

### Measurement

Track toil as a percentage of total operational hours:

```
toil_ratio = hours_spent_on_toil / total_ops_hours
```

**Google SRE target**: Keep toil below 50% of any team's time. Aim for < 30%.

### Toil Tracking Template

| Task | Frequency | Time/Instance | Monthly Hours | Automatable? | Priority |
|------|-----------|--------------|---------------|-------------|----------|
| {task} | {x/week} | {min} | {calc} | Yes/Partial/No | P0/P1/P2 |

**Automation ROI**: `monthly_savings = frequency * time_per_instance - automation_maintenance_cost`
If `monthly_savings > 0` and payback period < 3 months → automate immediately.
