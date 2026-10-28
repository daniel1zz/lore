# Deploy Mode: Observability

> Observability infrastructure setup — metrics, logs, traces, dashboards, alerting.

**Boundary**: `deploy:observability` = **build-time** config files and instrumentation setup. `operate:monitor` = **run-time** live analysis, alert response, and incident management.

## Workflow

1. **Assess current state** — what observability exists? What gaps?
2. **Define SLIs** — based on service type and user expectations
3. **Instrument application** — auto-instrumentation first, manual for business logic
4. **Configure collection** — metrics scraping, log aggregation, trace sampling
5. **Build dashboards** — golden signals overview + service-specific
6. **Configure alerts** — symptom-based, actionable, with runbook links
7. **Verify** — signals flowing, dashboards populated, test alert fires correctly

## Three Pillars — Implementation Guide

| Pillar | What to Collect | Stack Options | Key Config |
|--------|----------------|---------------|------------|
| **Metrics** | Request rate, error rate, latency, saturation | Prometheus + Grafana, DataDog, CloudWatch | Scrape interval: 15s (default), 5s (high-res) |
| **Logs** | Structured JSON, correlation IDs, no PII | ELK, Loki + Grafana, CloudWatch Logs | Retention: 30d hot, 90d warm, 1y cold |
| **Traces** | Request flow across services | Jaeger, Tempo + Grafana, Datadog APM | Sampling: 100% (low traffic), 10% head (high traffic) |

## SLI/SLO Definition Framework

### SLI Selection by Service Type

| Service Type | Primary SLI | Secondary SLIs |
|-------------|-------------|----------------|
| HTTP API | Availability (successful requests / total) | Latency p99, Error rate by type |
| Background worker | Processing rate (jobs completed / jobs submitted) | Queue depth, Processing latency |
| Data pipeline | Freshness (time since last successful update) | Completeness (records processed / expected) |
| Real-time service | Latency p50 (user-perceived) | Message delivery rate, Connection stability |
| Static site / CDN | Availability (cache hit rate) | TTFB p95, Error rate |

### SLO Target Guidance

| Tier | Availability SLO | Error Budget (30d) | Monthly Downtime |
|------|-----------------|-------------------|------------------|
| Tier 1 (critical) | 99.99% | 0.01% = 4.3 min | ~4 minutes |
| Tier 2 (important) | 99.9% | 0.1% = 43.2 min | ~43 minutes |
| Tier 3 (standard) | 99.5% | 0.5% = 3.6 hrs | ~3.6 hours |
| Tier 4 (best-effort) | 99% | 1% = 7.2 hrs | ~7.2 hours |

## Instrumentation Patterns

### OpenTelemetry Auto-Instrumentation (Start Here)

```bash
# Node.js — auto-instrument HTTP, Express, database clients
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node

# Python — auto-instrument Flask/Django, requests, SQLAlchemy
pip install opentelemetry-distro opentelemetry-exporter-otlp
opentelemetry-bootstrap -a install

# Java — agent JAR auto-instruments Spring, JDBC, gRPC
java -javaagent:opentelemetry-javaagent.jar -jar app.jar
```

### Manual Instrumentation (Business Logic)

Add manual spans and metrics for:
- Business transaction boundaries (order placed, payment processed)
- Cache hit/miss rates
- Feature flag evaluation counts
- External API call duration and status
- Queue publish/consume timing

### Structured Logging Standard

```json
{
  "timestamp": "2026-03-30T10:15:30.123Z",
  "level": "error",
  "message": "Payment processing failed",
  "service": "payment-service",
  "trace_id": "abc123def456",
  "span_id": "789ghi",
  "user_id": "usr_xxx",
  "error": {
    "type": "PaymentGatewayError",
    "message": "Timeout after 5000ms",
    "stack": "..."
  },
  "context": {
    "order_id": "ord_yyy",
    "amount": 4999,
    "gateway": "stripe"
  }
}
```

**Rules**:
- Always JSON format (not unstructured text)
- Always include trace_id for correlation
- Never log PII (passwords, tokens, full credit card numbers)
- Include enough context to diagnose without additional queries

## Golden Signals Dashboard Template

Every service dashboard should include these panels:

| Panel | Metric | PromQL Example |
|-------|--------|---------------|
| **Request Rate** | Requests per second | `sum(rate(http_requests_total[5m]))` |
| **Error Rate** | 5xx / total (%) | `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100` |
| **Latency p50/p95/p99** | Response time distribution | `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))` |
| **Saturation** | CPU, memory, connections | `container_cpu_usage_seconds_total`, `container_memory_working_set_bytes` |
| **SLO Burn Rate** | Error budget consumption speed | Multi-window burn rate (1h, 6h, 24h windows) |

## Alerting Best Practices

### Alert Design Rules

| Rule | Why |
|------|-----|
| Alert on symptoms, not causes | "Error rate > 1%" not "CPU > 80%" (high CPU may be fine) |
| Every alert must be actionable | If no one can do anything about it, it's a dashboard metric |
| Include runbook link | Alert → operator must know what to do immediately |
| Severity = impact, not urgency | Critical = user-facing degradation, Warning = potential issue |
| Use multi-window burn rate | Avoid false positives from brief spikes |

### Alert Severity Levels

| Severity | Criteria | Notification | Response Time |
|----------|----------|-------------|---------------|
| Critical (P1) | User-facing degradation, data loss risk | PagerDuty / phone | Immediate |
| High (P2) | Approaching SLO breach, degraded performance | Slack + on-call | 30 minutes |
| Warning (P3) | Error budget consumption elevated, trend concerning | Slack | Next business day |
| Info (P4) | Informational, no action needed | Dashboard only | Review weekly |

### Alert Template

```yaml
# Prometheus alert rule example
groups:
  - name: slo-alerts
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m]))
          / sum(rate(http_requests_total[5m])) > 0.01
        for: 5m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "Error rate > 1% for {{ $labels.service }}"
          description: "Current error rate: {{ $value | humanizePercentage }}"
          runbook_url: "https://wiki.example.com/runbooks/high-error-rate"
          dashboard_url: "https://grafana.example.com/d/xxx?orgId=1"
```

## Exit Criteria

- [ ] Golden signals dashboarded (request rate, error rate, latency, saturation)
- [ ] SLIs defined with measurable targets
- [ ] SLOs set with error budgets calculated
- [ ] Alerts configured with severity levels and runbook links
- [ ] Log aggregation active (structured JSON, retention policy set)
- [ ] Trace sampling configured (appropriate rate for traffic volume)
- [ ] Correlation IDs flow through all services (trace_id in logs)
- [ ] Test alert verified (fires correctly, routes to right channel)
- [ ] Dashboard accessible to on-call team

## Tools

- `serena`: create_text_file (configs, dashboards), execute_shell_command (deploy configs)
- `context7`: OpenTelemetry, Prometheus, Grafana docs
- `lore`: `lore search --type knowledge` for existing monitoring runbooks, `lore create knowledge --parent <spec or prd it concerns> --sub-type reference` for the observability runbook
