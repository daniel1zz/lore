# Mode: scaling

**Purpose**: Capacity planning, load testing, auto-scaling configuration, and performance optimization

## Scaling Strategies

| Strategy | When | Tradeoffs | Platforms |
|----------|------|-----------|-----------|
| **Horizontal** | Stateless services, read-heavy, fan-out | + Linear scaling, fault tolerant | K8s HPA, AWS ASG, Cloud Run, ECS |
| | | - State management, consistency | |
| **Vertical** | Databases, stateful, single-threaded | + Simple, no code changes | RDS instance resize, VM upgrade |
| | | - Downtime risk, cost ceiling, single point | |
| **Functional** | Microservices, domain boundaries | + Independent scaling per function | K8s per-deployment, Lambda |
| | | - Operational complexity | |
| **Data Partitioning** | Large datasets, multi-tenant | + Unlimited data scaling | Vitess, Citus, CockroachDB |
| | | - Query complexity, rebalancing | |

### Strategy Selection Decision Tree
```
Is the bottleneck CPU/memory on a single instance?
  ├─ YES → Can the workload be parallelized?
  │         ├─ YES → Horizontal scaling
  │         └─ NO  → Vertical scaling (check cost ceiling)
  └─ NO  → Is it a data/storage bottleneck?
            ├─ YES → Data partitioning (sharding, read replicas)
            └─ NO  → Is it a specific service?
                      ├─ YES → Functional scaling (isolate + scale independently)
                      └─ NO  → Network/external dependency → optimize or cache
```

## Capacity Planning Methodology

### Step 1: Measure Current State

Collect baseline metrics for all services in scope:

| Metric | Source | Purpose |
|--------|--------|---------|
| Request rate (RPS) | Prometheus/APM | Current load |
| P50/P95/P99 latency | Prometheus histograms | Response time distribution |
| CPU utilization | Node/container metrics | Compute headroom |
| Memory utilization | Node/container metrics | Memory headroom |
| Disk I/O | Node metrics | Storage bottleneck |
| Connection pool usage | Application metrics | DB/cache saturation |
| Queue depth | Queue metrics | Backpressure signal |
| Error rate | Application metrics | Current reliability |

Tools: `serena: execute_shell_command` (Prometheus queries, kubectl top) | `agent-browser: navigate` (Grafana dashboards)

Output: `[CAPACITY_BASELINE] service: {name} | rps: {N} | p99: {ms} | cpu: {%} | mem: {%} | headroom: {%}`

### Step 2: Project Growth

Estimate future load using available data:

| Method | Data Source | Confidence |
|--------|------------|------------|
| Historical trend | Past 3-6 months metrics | High (if stable growth) |
| Business forecast | Product roadmap, marketing plans | Medium |
| Seasonal patterns | Year-over-year comparison | Medium |
| Event-driven | Known launches, campaigns, sales | Low-Medium |

**Projection formula**: `projected_load = current_load * growth_factor * safety_margin`
- `growth_factor`: derived from data above
- `safety_margin`: 1.5x for production, 2x for critical path

### Step 3: Identify Bottlenecks

For each service, find the limiting resource:

```
For each service:
  1. Check: CPU > 70%? → CPU-bound
  2. Check: Memory > 80%? → Memory-bound
  3. Check: Disk IOPS near limit? → I/O-bound
  4. Check: Connection pool > 80%? → Connection-bound
  5. Check: Queue growing? → Processing-bound
  6. Check: External API at rate limit? → Dependency-bound
  7. None of the above? → Not yet bottlenecked
```

Output: `[BOTTLENECK] service: {name} | resource: {type} | current: {value} | limit: {value} | utilization: {%}`

### Step 4: Plan Scaling Actions

For each identified bottleneck, plan the scaling response:

| Bottleneck | Scaling Action | Validation Method |
|------------|---------------|-------------------|
| CPU-bound | Add replicas OR increase CPU limit | Load test at projected RPS |
| Memory-bound | Increase memory limit OR optimize (cache eviction, pagination) | Memory profiling under load |
| I/O-bound | Faster storage class OR read replicas OR caching layer | I/O benchmark |
| Connection-bound | Increase pool size OR add connection pooler (PgBouncer) | Connection saturation test |
| Processing-bound | Add workers OR optimize algorithm | Queue depth under load |
| Dependency-bound | Cache responses OR negotiate higher limits OR circuit breaker | Dependency mock test |

### Step 5: Load Testing

**MANDATORY before any scaling change.** Validate assumptions with actual load.

| Test Type | Purpose | When |
|-----------|---------|------|
| **Baseline** | Establish current performance | Before any change |
| **Stress** | Find breaking point | Capacity planning |
| **Soak** | Find memory leaks, degradation over time | Before production deploy |
| **Spike** | Validate auto-scaling response time | After HPA/ASG config |

Load test methodology:
1. Define success criteria: target RPS, max p99 latency, max error rate
2. Start at 50% of target → ramp to 100% → hold for 10 min → ramp to 150%
3. Monitor: latency, error rate, CPU, memory, connection pool
4. Record results: `[LOAD_TEST] target_rps: {N} | achieved_rps: {N} | p99: {ms} | error_rate: {%} | pass: Y/N`

Tools: `serena: execute_shell_command` (k6, vegeta, wrk, ab) | `agent-browser: navigate` (Grafana during test)

### Step 6: Cost Analysis

Every scaling decision has a cost impact. Document it.

| Action | Cost Impact | Alternative |
|--------|------------|-------------|
| Add 2 replicas | +${monthly} | Optimize before scaling? |
| Upgrade instance | +${monthly} | Horizontal instead? |
| Add caching layer | +${monthly} + dev effort | Worth the latency savings? |

Output: `[COST_IMPACT] action: {desc} | monthly_delta: ${N} | justification: {reason}`

## Auto-Scaling Configuration

### HPA (Horizontal Pod Autoscaler) Template

```yaml
# Standard HPA configuration
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {service}-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {service}
  minReplicas: {min}     # Never go below (maintain availability)
  maxReplicas: {max}     # Cost ceiling
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60    # Wait before scaling up
      policies:
        - type: Pods
          value: 2                       # Max 2 pods at a time
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300   # 5 min before scaling down
      policies:
        - type: Percent
          value: 10                      # Max 10% reduction at a time
          periodSeconds: 60
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70         # Scale up at 70% CPU
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80         # Scale up at 80% memory
```

### Auto-Scaling Parameters Guide

| Parameter | Conservative | Balanced | Aggressive |
|-----------|-------------|----------|------------|
| CPU target | 50% | 70% | 85% |
| Memory target | 60% | 80% | 90% |
| Scale-up cooldown | 120s | 60s | 30s |
| Scale-down cooldown | 600s | 300s | 120s |
| Max surge per step | 1 pod | 2 pods | 50% |

**Selection rule**: Start conservative for new services, move to balanced after 2 weeks of stable data.

### Custom Metrics Scaling

When CPU/memory are not the right signals:

| Metric | Good For | Example |
|--------|----------|---------|
| Request rate (RPS) | Web services | Scale at 500 RPS/pod |
| Queue depth | Workers | Scale when depth > 100 |
| Active connections | WebSocket servers | Scale at 1000 conn/pod |
| Custom business metric | Domain-specific | Scale at 50 active_jobs/pod |

## Database Scaling Patterns

| Pattern | When | Implementation |
|---------|------|---------------|
| **Read replicas** | Read-heavy (>80% reads) | Add replicas, route reads to replicas |
| **Connection pooling** | Connection exhaustion | PgBouncer, ProxySQL, RDS Proxy |
| **Vertical resize** | Overall capacity limit | Scheduled maintenance window |
| **Sharding** | Single-DB throughput limit | Partition by tenant, geography, or hash |
| **Caching layer** | Repeated reads, expensive queries | Redis/Memcached in front of DB |

## Exit Criteria

Mode is COMPLETE when ALL of:
- [ ] Current capacity baseline measured with evidence: `[CAPACITY_BASELINE]`
- [ ] Bottlenecks identified with resource utilization data: `[BOTTLENECK]`
- [ ] Growth projection documented with data source and confidence level
- [ ] Scaling plan defined with specific actions and timelines
- [ ] Load test validates scaling assumptions: `[LOAD_TEST]` (or explicit skip reason)
- [ ] Cost impact documented: `[COST_IMPACT]`
- [ ] Auto-scaling config reviewed (min/max/cooldown/metrics)
- [ ] Runbook updated with new scaling thresholds and procedures
- [ ] Report: `[SCALING_COMPLETE] services: {N} | bottlenecks: {N} | actions: {list} | cost_delta: ${N}/mo`

## Static References

- [prometheus-patterns.md](prometheus-patterns.md) — Metrics queries for capacity analysis
- [sre-methodology.md](sre-methodology.md) — SLO-driven scaling priorities
