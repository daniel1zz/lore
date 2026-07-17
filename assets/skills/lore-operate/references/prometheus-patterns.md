# Prometheus Patterns (Quick Reference)

## Naming: `{namespace}_{subsystem}_{name}_{unit}`
- Base units: seconds, bytes, meters. Suffix: `_total`=counter, `_bucket`=histogram

## Metric Type Cheat Sheet

| Type | Use For | Key Query |
|------|---------|-----------|
| Counter | requests, errors | `rate(metric_total[5m])` |
| Gauge | memory, queue size | `avg_over_time(metric[5m])` |
| Histogram | latency, sizes | `histogram_quantile(0.99, sum(rate(metric_bucket[5m])) by (le))` |

## Label Rules
- Cardinality < 1000 combos. Useful: method, status, service, environment, region
- AVOID: user_id, request_id, full_url. Use path templates: `/api/users/{id}`

## Bucket Recommendations
- Latency (s): `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`
- Size (bytes): `[100, 1000, 10000, 100000, 1000000, 10000000]`

## Recording Rules
Format: `{level}:{metric}:{operations}` (e.g., `job:http_requests:rate5m`)

## Key Alert Patterns

```yaml
# Error rate > 1%
sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
/ sum(rate(http_requests_total[5m])) by (service) > 0.01

# P99 latency > 1s
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (service, le)) > 1

# SLO burn rate (14.4x for 99.9% SLO)
(sum(rate(http_requests_total{status=~"5.."}[1h])) / sum(rate(http_requests_total[1h]))) > (14.4 * 0.001)
```

## Dashboard Patterns
- **RED** (services): Rate, Error rate, Duration (p50/p95/p99)
- **USE** (resources): Utilization, Saturation, Errors

## K8s Service Discovery
Pod annotations: `prometheus.io/scrape: "true"`, `prometheus.io/port`, `prometheus.io/path`
