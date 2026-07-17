# Deployment Strategy Selection Framework

## Purpose

This framework provides a systematic method for selecting the optimal deployment strategy based on application characteristics, infrastructure constraints, and risk tolerance. It replaces ad-hoc strategy selection with a requirements-driven decision process.

## Strategy Catalog

### Rolling Update

**Mechanism**: Replace instances incrementally. Old pods terminate as new pods become ready.

**K8s config**: `strategy.type: RollingUpdate`, `maxSurge: 25%`, `maxUnavailable: 25%`

**Strengths**: No extra infrastructure cost, built-in to most orchestrators, zero downtime.

**Weaknesses**: Both versions run simultaneously during rollout (must be backward-compatible), slow rollback (reverse rolling update), hard to test new version in isolation.

**Best for**: Routine updates to stateless services with backward-compatible changes.

### Blue-Green

**Mechanism**: Two identical environments (blue = current, green = new). Deploy to green, verify, switch traffic via load balancer or service selector.

**K8s config**: Two Deployments with different `version:` labels. Service selector switches.

**Strengths**: Instant rollback (switch selector back), full testing of new version before any user traffic, clean separation.

**Weaknesses**: 2x infrastructure cost during deployment, database must support both versions, stateful connections need draining.

**Best for**: Critical services where instant rollback is non-negotiable, major version upgrades.

### Canary

**Mechanism**: Deploy new version to a small subset (1-10%), monitor SLIs, progressively increase traffic if healthy.

**K8s config**: Stable Deployment (N replicas) + Canary Deployment (1 replica), shared Service on `app:` label. Or use service mesh (Istio VirtualService weight-based routing).

**Progressive rollout example**: 1% → 5min observe → 10% → 10min observe → 50% → 15min observe → 100%

**Strengths**: Minimal blast radius, real production traffic validation, data-driven promotion decisions, supports A/B testing.

**Weaknesses**: Requires traffic splitting infrastructure, more complex setup, longer deployment time, not suitable for synchronous multi-service transactions.

**Best for**: New features, risky changes, A/B testing, services with high traffic volume (meaningful canary sample).

### Recreate

**Mechanism**: Terminate all old instances, then start new instances. Brief downtime.

**K8s config**: `strategy.type: Recreate`

**Strengths**: Simple, no version compatibility issues, clean state.

**Weaknesses**: Downtime during transition, no rollback without re-deploy.

**Best for**: Development/staging environments, stateful applications that cannot run two versions, batch processing systems with maintenance windows.

### Atomic Deploy (Serverless/Edge/Static)

**Mechanism**: Platform-native immutable deployment. Each deploy creates a new immutable snapshot. Traffic switches atomically.

**Platforms**: Vercel, Netlify, CloudFlare Workers/Pages, AWS Lambda aliases, Google Cloud Run revisions.

**Strengths**: Zero configuration, instant rollback (re-point to previous deployment), built-in preview deployments, no infrastructure management.

**Weaknesses**: Platform-specific, limited customization, cold start considerations (serverless).

**Best for**: Static sites, serverless functions, edge workers, JAMstack applications.

### Expand-Migrate-Contract (Database/Data)

**Mechanism**: Three-phase process for schema changes. Expand (add new) → Migrate (dual-write, backfill) → Contract (remove old).

**Strengths**: Zero downtime for schema changes, each phase independently verifiable and reversible.

**Weaknesses**: Longer deployment cycle (3 separate deployments), requires application awareness of both schemas during transition.

**Best for**: Any schema change in a system that cannot afford downtime.

---

## Decision Matrix

Use this matrix to narrow strategy choices. Score each factor (1-3) for your deployment context, then select the strategy with the best match.

| Factor | Question to ask | Rolling | Blue-Green | Canary | Recreate | Atomic |
|--------|----------------|---------|------------|--------|----------|--------|
| **Rollback speed** | How fast must rollback be? | Slow (minutes) | Instant | Fast (seconds) | Slow (redeploy) | Instant |
| **Infra cost** | Budget for duplicate resources? | 1x + surge | 2x | 1x + small % | 1x | Platform cost |
| **Zero-downtime** | Can you afford any downtime? | Yes | Yes | Yes | No | Yes |
| **DB compatibility** | Schema backward-compatible? | Must be | Both versions run | Both versions run | Single version | N/A (usually) |
| **Session handling** | Sticky sessions or stateless? | Graceful drain | Drain or stateless | Split by route | Reconnect | Stateless |
| **Validation window** | How long to validate before full rollout? | Per-pod only | Pre-switch | Progressive | Post-deploy only | Preview deploy |
| **Traffic splitting** | Can infra split traffic by %? | N/A | N/A | Required | N/A | Built-in |
| **Team experience** | Team familiarity with strategy? | High (default) | Medium | Low-Medium | High | High (if on platform) |

## Decision Flowchart

```
START
  |
  ├─ Is this a database/schema change?
  |    YES → Expand-Migrate-Contract (see mode-migration)
  |    NO ↓
  |
  ├─ Is target serverless/edge/static?
  |    YES → Atomic Deploy (platform-native)
  |    NO ↓
  |
  ├─ Is instant rollback critical (SLA >99.99% or financial impact)?
  |    YES → Blue-Green
  |    NO ↓
  |
  ├─ Is this a risky change (new feature, major refactor, first deploy of service)?
  |    YES → Canary (if traffic splitting available) OR Blue-Green (if not)
  |    NO ↓
  |
  ├─ Can the system tolerate brief downtime (dev/staging, maintenance window)?
  |    YES → Recreate (simplest)
  |    NO ↓
  |
  └─ Default → Rolling Update
```

## Contraindication Matrix

A contraindication means **DO NOT use this strategy** even if it seems like a good fit.

| Strategy | Contraindication | Why | Alternative |
|----------|-----------------|-----|-------------|
| Rolling | Breaking API change between versions | Old and new pods serve simultaneously → mixed responses | Blue-Green with API versioning |
| Rolling | Schema change incompatible with old code | Old pods crash on new schema | Expand-Migrate-Contract first |
| Blue-Green | Service holds long-lived connections (WebSocket, gRPC streams) | Connection drain may take too long or lose state | Rolling with graceful shutdown + reconnect logic |
| Blue-Green | Total memory > cluster capacity × 2 | Cannot run both versions simultaneously | Canary (small additional footprint) |
| Canary | Synchronous multi-service transaction | Canary may hit old version of dependency → inconsistent behavior | Deploy dependencies first, then canary the caller |
| Canary | No traffic splitting capability | Cannot route subset of traffic to canary | Blue-Green or Rolling |
| Recreate | Production service with SLA | Downtime violates SLA | Any zero-downtime strategy |
| Atomic | Stateful backend with local storage | Platform assumes stateless | Container-based strategy |

## Multi-Service Deployment Ordering

When deploying changes across multiple services:

1. **Identify dependency graph**: Which services call which?
2. **Deploy leaf services first**: Services with no downstream dependencies
3. **Deploy backward-compatible changes first**: API additions before removals
4. **Use feature flags for behavior changes**: Decouple deployment from activation
5. **Coordinate schema + code**: Schema expand → code deploy → schema contract

**Anti-pattern**: Deploying all services simultaneously with breaking changes across service boundaries.
