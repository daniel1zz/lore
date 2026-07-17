# Logging Best Practices (Quick Reference)

## Structured Log Fields (JSON)

| Field | Required | Notes |
|-------|----------|-------|
| timestamp | yes | ISO 8601 |
| level | yes | debug/info/warn/error/fatal |
| message | yes | Human-readable |
| service | yes | Service name |
| trace_id | prod | Distributed tracing |

## What to Log / Not Log

| DO Log | DO NOT Log |
|--------|------------|
| Auth events (login/logout/fail) | Passwords, API keys, tokens |
| CRUD operations | Credit cards, SSN, PHI |
| Errors + stack traces | Every DB query (use sampling) |
| Slow queries, config changes | Routine heartbeats |
| Service start/stop | Same error repeatedly (rate-limit) |

## Data Masking
Redact fields: password, token, secret, api_key, credit_card, ssn, authorization

## Log Libraries
- **Node.js**: pino (with child loggers for request context)
- **Python**: structlog
- **Go**: zerolog

## Correlation IDs
Generate at entry point -> pass via `X-Request-ID` / `X-Trace-ID` -> include in all logs

## Aggregation Stacks
- **ELK**: Elasticsearch + Logstash + Kibana. Index: `logs-{service}-{date}`
- **Loki + Grafana**: Label-based, lower resource. LogQL: `{service="api"} |= "error"`

## Retention Strategy

| Tier | Duration | Storage |
|------|----------|---------|
| Hot | 7 days | Fast SSD |
| Warm | 30 days | Standard |
| Cold | 1 year | Archive |

Compliance: GDPR (minimize PII), HIPAA (6yr), PCI-DSS (1yr), SOX (7yr)

## Performance
- Sampling for high-volume low-value logs
- Async/buffered writers (don't block requests)
- Batch shipping (100 msgs / 5s flush)
