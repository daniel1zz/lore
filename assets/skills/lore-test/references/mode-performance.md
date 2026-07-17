# Mode: Performance Testing

**Purpose**: Performance testing, benchmarking, frontend metrics, and resilience verification.

## Loop Specialization

| Step | Performance specifics |
|------|----------------------|
| ANALYZE | SLOs, hot paths, resource bottlenecks, dependency topology, frontend CWV baseline |
| DESIGN | Workload model: user profiles, traffic patterns, data volume. Select test type below |
| SETUP | Isolated environment, baseline data at production scale, warmup period defined |
| EXECUTE | Run with controlled conditions: no other load, stable network, consistent hardware |
| GATE | SLO compliance, no regression vs baseline, resource usage within budget |
| CLEANUP | Stop load generators, collect metrics, archive baseline for next run |
| PERSIST | Update test-plan with: baseline metrics, comparison, bottleneck analysis |

## Test Types

| Type | Purpose | Tool | Duration |
|------|---------|------|----------|
| **Load** | Expected traffic → verify SLOs hold | k6, Artillery | 5-15 min |
| **Stress** | Beyond capacity → find breaking point | k6 | 10-30 min |
| **Spike** | Sudden surge → test auto-scaling and recovery | k6 | 5-10 min |
| **Soak** | Extended duration → find memory leaks, resource exhaustion | k6 | 1-4 hours |
| **Benchmark** | Code-level micro-benchmarks | vitest.bench, Benchmark.js, hyperfine | seconds |
| **Frontend** | Core Web Vitals, bundle size, render performance | Lighthouse CI, web-vitals | per-page |

## k6 Patterns

### Basic Load Test

```javascript
// load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const latency = new Trend('api_latency');

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // ramp up
    { duration: '5m', target: 50 },   // steady state
    { duration: '1m', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],  // SLO
    errors: ['rate<0.01'],                            // <1% error rate
  },
};

export default function () {
  const res = http.get('http://localhost:3000/api/products');
  check(res, {
    'status 200': (r) => r.status === 200,
    'body not empty': (r) => r.body.length > 0,
  });
  latency.add(res.timings.duration);
  errorRate.add(res.status !== 200);
  sleep(1);
}
```

### Stress Test (Find Breaking Point)

```javascript
export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '2m', target: 400 },
    { duration: '2m', target: 800 },  // push beyond expected
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.1'],
  },
};
```

### Spike Test

```javascript
export const options = {
  stages: [
    { duration: '1m', target: 10 },   // baseline
    { duration: '10s', target: 500 },  // spike
    { duration: '2m', target: 500 },   // sustain spike
    { duration: '10s', target: 10 },   // drop back
    { duration: '2m', target: 10 },    // recovery
  ],
};
```

### Authenticated Load Test

```javascript
import http from 'k6/http';

export function setup() {
  const res = http.post('http://localhost:3000/api/login', JSON.stringify({
    email: 'loadtest@test.com', password: 'test123',
  }), { headers: { 'Content-Type': 'application/json' } });
  return { token: res.json().token };
}

export default function (data) {
  http.get('http://localhost:3000/api/dashboard', {
    headers: { Authorization: `Bearer ${data.token}` },
  });
}
```

## Artillery Patterns

```yaml
# artillery-config.yml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 300
      arrivalRate: 50
      name: "Sustained load"
  ensure:
    p95: 500
    maxErrorRate: 1

scenarios:
  - name: "Browse and checkout"
    flow:
      - get:
          url: "/api/products"
          capture:
            json: "$[0].id"
            as: "productId"
      - post:
          url: "/api/cart"
          json:
            productId: "{{ productId }}"
            quantity: 1
      - post:
          url: "/api/checkout"
```

```bash
npx artillery run artillery-config.yml --output report.json
npx artillery report report.json  # HTML report
```

## Frontend Performance

### Core Web Vitals Targets

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| **LCP** (Largest Contentful Paint) | ≤ 2.5s | ≤ 4.0s | > 4.0s |
| **INP** (Interaction to Next Paint) | ≤ 200ms | ≤ 500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | ≤ 0.1 | ≤ 0.25 | > 0.25 |
| **TTFB** (Time to First Byte) | ≤ 800ms | ≤ 1.8s | > 1.8s |

### Lighthouse CI

```bash
# Install
npm i -D @lhci/cli

# Run against dev server
npx lhci autorun --collect.url=http://localhost:3000 \
  --assert.preset=lighthouse:recommended \
  --assert.assertions.categories:performance=off
```

```javascript
// lighthouserc.js
module.exports = {
  ci: {
    collect: {
      url: ['http://localhost:3000/', 'http://localhost:3000/dashboard'],
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'interactive': ['error', { maxNumericValue: 3500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
```

### Bundle Size Monitoring

```bash
# Size-limit: budget per entry point
npx size-limit --json > bundle-size.json
```

```javascript
// .size-limit.js
module.exports = [
  { path: 'dist/index.js', limit: '50 kB', gzip: true },
  { path: 'dist/vendor.js', limit: '120 kB', gzip: true },
];
```

### Code-Level Benchmarks (vitest.bench)

```typescript
import { bench, describe } from 'vitest';

describe('search algorithm', () => {
  const data = generateLargeDataset(10_000);

  bench('linear search', () => {
    linearSearch(data, 'target');
  });

  bench('binary search', () => {
    binarySearch(data, 'target');
  });

  bench('hash lookup', () => {
    hashLookup(data, 'target');
  });
});
```

## Backend Metrics

| Metric | Target | Tool |
|--------|--------|------|
| Response time p50/p95/p99 | Per SLO | k6, Artillery |
| Throughput (req/s) | Per SLO | k6 |
| Error rate under load | < 1% | k6 thresholds |
| Memory usage trend | No leak (flat over soak) | Grafana, `process.memoryUsage()` |
| CPU usage | < 80% at expected load | Container metrics |
| DB query time | p95 < 100ms | Slow query log, APM |
| Connection pool exhaustion | 0 timeouts | Pool metrics |

## Execution Protocol

1. **Warmup**: 10% load for 2 min → populate caches, warm JIT
2. **Steady state**: Target load for defined duration
3. **Cooldown**: Taper load, wait for metrics to stabilize
4. **Collect**: Export metrics, generate report before teardown

## Baseline Management

- Store baseline metrics in `docs/testing/baselines/` or a lore knowledge doc
- Compare each run against baseline: flag >10% regression
- Update baseline only after intentional architecture changes (with justification)
- Track trends over time: weekly performance CI job

## Chaos / Resilience Testing

| Scenario | Method | Verify |
|----------|--------|--------|
| **Dependency timeout** | Inject latency (toxiproxy, msw delay) | Graceful degradation, circuit breaker trips |
| **Dependency unavailable** | Block network to service | Fallback behavior, error handling, cached responses |
| **Partial failure** | Kill N% of instances | Load redistribution, no data loss |
| **Resource exhaustion** | Limit memory/CPU (cgroups) | OOM handling, graceful restart |
| **Network partition** | Drop packets between services | Eventually consistent state, no data corruption |
| **Clock skew** | Offset system time | JWT validation, TTL handling, cron jobs |

### Chaos Tools

| Tool | Scope | Best For |
|------|-------|----------|
| **toxiproxy** | Network-level fault injection | Service dependency failures |
| **chaos-mesh** | Kubernetes pod/network/IO faults | K8s environments |
| **litmus** | Kubernetes chaos experiments | K8s with experiment catalog |
| **manual** | `tc` / `iptables` rules | Quick one-off tests |

## CI/CD Integration

```yaml
# Nightly performance job
name: Performance
on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily
jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker compose up -d  # start services
      - run: npm i -g k6
      - run: k6 run load-test.js --out json=results.json
      - run: |
          # Compare against baseline, fail on regression
          node scripts/compare-perf-baseline.js results.json baseline.json
  
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build && npm start &
      - uses: treosh/lighthouse-ci-action@v12
        with:
          configPath: ./lighthouserc.js
```

## Official Docs (MANDATORY)

- context7: resolve-library-id for k6 → query-docs for scenarios, thresholds, checks
- context7: resolve-library-id for lighthouse → query-docs for CI configuration
- Fallback: gitmcp or mcp-deepwiki
