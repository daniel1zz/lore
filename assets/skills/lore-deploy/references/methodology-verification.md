# Post-Deploy Verification Protocol

## Purpose

This protocol defines a systematic, evidence-based method for verifying that a deployment is successful. "It deployed" is not "it works." Every deployment must produce verifiable evidence of correctness before being declared complete.

## Verification Sequence

Execute steps in order. **Stop on first FAIL** — do not proceed to later steps if an earlier step fails. Fix the issue or trigger rollback.

### Step 1: Smoke Tests

**Goal**: Verify critical paths respond at all.

**What to check**:
- Health endpoint returns 200
- Primary API endpoints return expected status codes
- Authentication flow completes
- Static assets load (for web applications)

**How to verify**:
```bash
# Health check
curl -sf https://{domain}/health | jq .

# Key API endpoints (adapt to your service)
curl -sf -o /dev/null -w "%{http_code}" https://{domain}/api/v1/{primary-endpoint}

# For Kubernetes
kubectl exec -n {namespace} {pod} -- wget -qO- http://localhost:{port}/health
```

**Pass criteria**: All critical endpoints return expected HTTP status codes with valid response bodies.

**Fail action**: Check pod logs, describe pod events. If crash loop → immediate rollback.

### Step 2: Health Probe Verification

**Goal**: All instances are healthy and receiving traffic.

**What to check**:
- All pods/instances in Running state
- Liveness probes passing
- Readiness probes passing (instance receiving traffic)
- No recent restarts (OOMKilled, CrashLoopBackOff)

**How to verify**:
```bash
# Kubernetes
kubectl get pods -n {namespace} -l app={name} -o wide
kubectl describe deployment {name} -n {namespace} | grep -A5 "Conditions:"

# Check for restarts
kubectl get pods -n {namespace} -l app={name} -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[*].restartCount}{"\n"}{end}'

# Docker Compose
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Health}}"

# Serverless
vercel ls --json | jq '.[] | select(.state == "READY")'
```

**Pass criteria**: 100% of expected instances healthy, zero restarts since deployment, all probes passing.

**Fail action**: Check resource limits (OOM?), probe configuration (path correct?), startup time (startup probe threshold sufficient?).

### Step 3: SLI Baseline Comparison

**Goal**: Service performance has not regressed compared to pre-deployment state.

**Pre-deployment**: Record baseline SLIs BEFORE starting deployment.
- Error rate (5xx / total requests)
- Latency p50, p95, p99
- Saturation (CPU %, memory %, connection pool usage)
- Throughput (requests per second)

**Post-deployment comparison**:

| SLI | Acceptable Delta | Alert Threshold |
|-----|-----------------|----------------|
| Error rate | < 1.5x baseline | > 2x baseline |
| Latency p50 | < 1.2x baseline | > 2x baseline |
| Latency p99 | < 1.5x baseline | > 3x baseline |
| CPU usage | < 1.3x baseline | > 80% absolute |
| Memory usage | < 1.2x baseline | > 85% absolute |
| Throughput | > 0.9x baseline (no drop) | < 0.7x baseline |

**How to verify**:
```promql
# Prometheus/Grafana — error rate comparison
# Pre-deploy baseline (record this before deploy):
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# Post-deploy (same query, compare values)
# Latency p99
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
```

```bash
# CloudWatch (AWS)
aws cloudwatch get-metric-statistics --namespace {ns} --metric-name 5XXError --period 300 --statistics Average --start-time {deploy-time} --end-time {now}

# Vercel
vercel logs --json | jq 'select(.statusCode >= 500)' | wc -l
```

**Pass criteria**: All SLIs within acceptable delta. No SLI exceeds alert threshold.

**Fail action**: If within alert threshold but above acceptable delta → extend bake time and monitor. If exceeding alert threshold → evaluate rollback per trigger criteria.

### Step 4: Synthetic Transactions

**Goal**: Key user journeys complete end-to-end, not just individual endpoints.

**What to verify** (select relevant journeys for this deployment):
- User sign-up / login flow
- Primary business transaction (e.g., place order, create resource, send message)
- Data retrieval and display (list, search, detail views)
- Payment / billing flow (if applicable)
- Webhook delivery (if applicable)

**How to verify**:
```bash
# API-level synthetic transaction
# Example: create resource → read → verify → cleanup
RESOURCE_ID=$(curl -sf -X POST https://{domain}/api/v1/resources -H 'Content-Type: application/json' -d '{"test": true}' | jq -r .id)
curl -sf https://{domain}/api/v1/resources/$RESOURCE_ID | jq .
curl -sf -X DELETE https://{domain}/api/v1/resources/$RESOURCE_ID

# Browser-level (Playwright)
npx playwright test --grep @smoke

# If using external synthetic monitoring (Datadog, New Relic, Checkly)
# Verify latest synthetic check results via their API
```

**Pass criteria**: All synthetic transactions complete successfully. Response data matches expected shape and values.

**Fail action**: Identify which step of the journey fails. Check logs for that specific flow. May indicate integration issue (database, external service, cache).

### Step 5: Bake Time

**Goal**: Observe the deployment under real traffic for a minimum period to catch slow-onset failures.

**Why bake time matters**:
- Memory leaks manifest over hours, not seconds
- Connection pool exhaustion builds gradually
- Cache warming effects on latency
- Traffic pattern variations (peak vs off-peak)
- Cron jobs or scheduled tasks that run on intervals

**Bake time by risk level**:

| Risk Level | Minimum Bake | Recommended Bake | What to Watch |
|------------|-------------|-----------------|---------------|
| Low | 5 minutes | 15 minutes | Error rate, latency |
| Medium | 15 minutes | 30 minutes | + Memory trend, connection count |
| High | 30 minutes | 2 hours | + Full traffic cycle, cron executions |
| Critical | 2 hours | 24 hours | + Peak traffic window, batch job completion |

**During bake time**:
1. Monitor all SLIs continuously
2. Watch for trending metrics (memory climbing, connections growing)
3. Check application logs for new warning/error patterns
4. Verify no alert has fired

**Pass criteria**: Bake period completed with all SLIs stable (no upward trend in error rate or latency, no downward trend in throughput).

**Fail action**: If degradation detected during bake → evaluate rollback. If metrics stable but below optimal → log concern, may need follow-up investigation.

---

## Verification Output Template

After completing all 5 steps, produce this output:

```
**[VERIFY]**
- smoke: PASS | endpoints checked: {N}, all responded correctly
- health: PASS | instances: {N}/{N} healthy, restarts: 0
- SLI_delta: error_rate {X}→{Y} ({Z}x), p99 {X}ms→{Y}ms ({Z}x)
- synthetic: PASS | journeys tested: {N}, all completed
- bake: {duration} | alerts fired: 0, trends: stable
- **verdict: PASS** (or FAIL with {reason})
```

---

## Verification Tiers

Not every deployment needs all 5 steps at full depth. Match verification depth to risk.

| Deployment Type | Steps Required | Bake Time |
|-----------------|---------------|-----------|
| Config change (env vars, feature flags) | 1 (smoke) + 2 (health) | 5 min |
| Routine code update (low risk) | 1-3 | 15 min |
| New feature deployment (medium risk) | 1-4 | 30 min |
| Infrastructure change (high risk) | 1-5 (full) | 2 hours |
| Database migration (critical) | 1-5 (full) + data verification | 2-24 hours |

**Data verification additions for migrations**:
- Row count comparison (pre vs post)
- Checksum on critical columns
- Sample query validation (random sample of N rows, verify data integrity)
- Referential integrity check (FK constraints hold)

---

## Failure Modes Reference

Common verification failures and their typical root causes:

| Failure | Likely Cause | First Check |
|---------|-------------|-------------|
| Smoke test timeout | Pod not ready, wrong port, network policy | `kubectl describe pod`, check service/ingress |
| Health probe failing | App crash on startup, wrong health path | `kubectl logs`, check probe config |
| Error rate spike | Code bug, missing env var, dependency down | Application logs, check env vars |
| Latency regression | Missing index, N+1 query, cold cache | APM traces, database slow query log |
| Memory climbing | Memory leak, unbounded cache, connection leak | Heap dump, connection pool metrics |
| Throughput drop | Resource limits too low, HPA not scaling | CPU/memory metrics, HPA status |
