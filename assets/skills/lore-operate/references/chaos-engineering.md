# Chaos Engineering Reference

## Overview

Chaos engineering is the discipline of experimenting on a system to build confidence in its ability to withstand turbulent conditions in production. It validates that the system's resilience assumptions actually hold.

**Core loop**: Steady state → Hypothesize → Experiment → Analyze → Improve

## Principles of Chaos Engineering

1. **Build a hypothesis around steady-state behavior**: Define what "normal" looks like with measurable criteria
2. **Vary real-world events**: Inject realistic failures, not artificial ones
3. **Run experiments in production**: Or as close to production as possible
4. **Automate experiments to run continuously**: Not just one-off tests
5. **Minimize blast radius**: Start small, have abort conditions, always have rollback

## Experiment Design Framework

### Step 1: Define Steady-State Hypothesis

Before injecting any failure, document what "normal" looks like:

```markdown
## Steady-State Definition: {Service Name}

| Metric | Normal Range | Measurement | Source |
|--------|-------------|-------------|--------|
| Availability | > 99.9% | Success rate over 5m window | Prometheus |
| P99 latency | < 500ms | 99th percentile request duration | Prometheus |
| Error rate | < 0.1% | 5xx responses / total responses | Prometheus |
| Throughput | 800-1200 RPS | Requests per second | Prometheus |
| Queue depth | < 100 | Messages in queue | Queue metrics |

**Hypothesis**: When {failure condition} occurs, the system will continue to operate within steady-state bounds, with degradation limited to {expected degradation}.
```

### Step 2: Select Failure Scenario

Choose experiments based on real-world failure modes:

#### Failure Scenario Catalog

| Category | Failure | Tool | Complexity |
|----------|---------|------|-----------|
| **Infrastructure** | | | |
| | Instance termination | Chaos Monkey, Litmus, `kubectl delete pod` | Low |
| | AZ/region failure | AWS FIS, Gremlin, traffic shifting | High |
| | Disk full | Litmus, `fallocate`, `dd` | Low |
| | CPU stress | stress-ng, Chaos Mesh | Low |
| | Memory pressure | stress-ng, Chaos Mesh | Low |
| **Network** | | | |
| | Latency injection | tc netem, Chaos Mesh, Toxiproxy | Medium |
| | Packet loss | tc netem, Chaos Mesh | Medium |
| | DNS failure | Block DNS, corrupt resolv.conf | Medium |
| | Network partition | iptables, Chaos Mesh | High |
| **Application** | | | |
| | Dependency failure | Toxiproxy, feature flag, mock | Medium |
| | Database failover | Trigger RDS failover, kill primary | High |
| | Cache failure | Restart Redis/Memcached | Medium |
| | Config corruption | Invalid config push, feature flag | Medium |
| **External** | | | |
| | Third-party API failure | Block endpoint, inject errors | Medium |
| | Certificate expiry | Simulate expired cert | Medium |
| | Rate limiting | Flood upstream API | Low |

#### Experiment Selection Priority

| Priority | Criteria | Examples |
|----------|----------|---------|
| P0 | Single point of failure, no redundancy | Single DB, single region, no fallback for critical dependency |
| P1 | Redundancy exists but untested | Multi-AZ but never tested failover, read replicas never promoted |
| P2 | Known gaps in observability | No alerts for dependency failures, no circuit breakers |
| P3 | Performance under stress | Behavior under 2x/5x normal load |

### Step 3: Define Blast Radius Controls

Every experiment MUST have controls to limit damage:

```markdown
## Blast Radius Controls

**Scope**:
- Target: {specific service/pod/instance}
- Affected users: {percentage or specific segment}
- Duration: {max experiment duration}

**Abort conditions** (stop experiment immediately if ANY triggered):
- [ ] SLO burn rate exceeds 14.4x (fast burn)
- [ ] Error rate exceeds {threshold}% (e.g., 5%)
- [ ] Latency p99 exceeds {threshold}ms
- [ ] Customer-reported impact
- [ ] Any data corruption signal

**Rollback mechanism**:
- Method: {kill injection process / restore pod / feature flag off}
- Time to rollback: {expected seconds}
- Verified: {YES — tested before experiment / NO — test first}

**Runbook**: {link to experiment-specific runbook}
```

### Step 4: Execute Experiment

Execution protocol:

1. **Pre-flight checklist**:
   - [ ] Steady-state metrics captured (baseline)
   - [ ] Abort conditions configured in monitoring
   - [ ] Rollback mechanism tested
   - [ ] Stakeholders notified (team channel)
   - [ ] No active incidents
   - [ ] No other experiments running
   - [ ] During business hours (for first run of any new experiment)

2. **Execute**:
   - Start monitoring dashboard
   - Inject failure
   - Observe system behavior against hypothesis
   - Document observations in real-time
   - If abort conditions triggered → execute rollback immediately

3. **Duration**:
   - First run: 5-15 minutes
   - Subsequent runs: 15-60 minutes
   - Continuous (automated): until abort or scheduled end

### Step 5: Analyze Results

| Outcome | Meaning | Action |
|---------|---------|--------|
| **Hypothesis confirmed** | System handled failure as expected | Document success, increase scope next time |
| **Hypothesis disproved** | System did NOT handle failure as expected | Create action items (P0/P1), fix before re-testing |
| **Unexpected behavior** | Something happened we didn't predict | Investigate, add to failure mode catalog, create new hypothesis |
| **Inconclusive** | Metrics unclear or experiment too short | Improve instrumentation, re-run with longer duration |

### Experiment Report Template

```markdown
# Chaos Experiment Report: {Name}

## Metadata
- **Date**: {date}
- **Duration**: {minutes}
- **Target**: {service/component}
- **Failure injected**: {description}
- **Tool used**: {tool name}

## Hypothesis
{What we expected to happen}

## Steady-State Baseline
| Metric | Baseline | During Experiment | Delta |
|--------|----------|-------------------|-------|
| Availability | {%} | {%} | {diff} |
| P99 latency | {ms} | {ms} | {diff} |
| Error rate | {%} | {%} | {diff} |

## Observations
{What actually happened, timestamped notes}

## Result: CONFIRMED / DISPROVED / INCONCLUSIVE

## Action Items
| Priority | Action | Owner | Due |
|----------|--------|-------|-----|
| {P0-P2} | {fix/improvement} | {name} | {date} |

## Lessons Learned
{Key insights for the team}
```

## Game Day Format

A Game Day is a scheduled event where the team deliberately injects failures and practices incident response.

### Game Day Planning

| Phase | Duration | Activities |
|-------|----------|-----------|
| **Preparation** (1 week before) | 2-4 hours | Select scenarios, prepare experiments, brief team |
| **Execution** | 2-4 hours | Run experiments, practice response, rotate roles |
| **Debrief** | 1 hour | Review results, capture learnings, create action items |

### Game Day Agenda Template

```
## Game Day: {Date}

### Preparation (done before Game Day)
- [ ] Scenarios selected and documented
- [ ] Blast radius controls configured
- [ ] Rollback mechanisms verified
- [ ] Team roles assigned (IC, operators, observers)
- [ ] Monitoring dashboards ready

### Execution Schedule
| Time | Scenario | Injector | Observer |
|------|----------|----------|----------|
| 10:00 | Pod kill — API service | {name} | {name} |
| 10:30 | Network latency — DB connection | {name} | {name} |
| 11:00 | Dependency failure — payment API | {name} | {name} |
| 11:30 | Cache failure — Redis cluster | {name} | {name} |

### Rules of Engagement
- IC rotates each scenario (practice IC skills)
- No "cheating" — responders use only runbooks and standard tools
- Observer documents everything (timeline, decisions, gaps)
- Abort if production impact exceeds thresholds

### Debrief Questions
1. Did our runbooks cover the scenario?
2. Did alerts fire when expected?
3. How long to detect, triage, mitigate?
4. What surprised us?
5. What needs to be fixed before next Game Day?
```

### Game Day Cadence

| Maturity Level | Frequency | Scope |
|---------------|-----------|-------|
| Starting | Quarterly | Staging environment, simple scenarios |
| Developing | Monthly | Production, single-service scenarios |
| Mature | Bi-weekly | Production, multi-service scenarios |
| Advanced | Continuous | Automated chaos in production with guardrails |

## Chaos Engineering Maturity Model

| Level | Description | Practices |
|-------|-------------|----------|
| **0 — None** | No chaos engineering | Failures are surprises |
| **1 — Ad-hoc** | Manual experiments in staging | Kill a pod manually, observe |
| **2 — Planned** | Regular Game Days, documented experiments | Quarterly Game Days, experiment catalog |
| **3 — Systematic** | Automated experiments, CI integration | Chaos tests in pipeline, continuous experiments |
| **4 — Advanced** | Continuous chaos in production | Automated chaos with auto-abort, SLO-gated experiments |

## Tool Reference

| Tool | Type | Best For | Platform |
|------|------|----------|----------|
| **Chaos Mesh** | K8s-native | Pod/network/IO chaos | Kubernetes |
| **Litmus** | K8s-native | Workflow-based experiments | Kubernetes |
| **Gremlin** | SaaS | Enterprise, multi-cloud | Any |
| **AWS FIS** | Cloud-native | AWS-specific fault injection | AWS |
| **Toxiproxy** | Proxy-based | Network fault simulation | Any |
| **stress-ng** | Host-based | CPU/memory/IO stress | Linux |
| **tc netem** | Kernel-based | Network latency/loss/corruption | Linux |

### Quick Start: Chaos Mesh on K8s

```yaml
# Pod kill experiment
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: pod-kill-api
spec:
  action: pod-kill
  mode: one
  selector:
    namespaces: [production]
    labelSelectors:
      app: api-server
  duration: "30s"
  scheduler:
    cron: "@every 1h"  # For continuous chaos
```

### Quick Start: Toxiproxy for Dependency Failure

```bash
# Add a proxy for a downstream service
toxiproxy-cli create downstream_api -l localhost:8474 -u downstream.service:443

# Add latency toxic (simulate slow dependency)
toxiproxy-cli toxic add downstream_api -t latency -a latency=500 -a jitter=100

# Add timeout toxic (simulate dependency failure)
toxiproxy-cli toxic add downstream_api -t timeout -a timeout=0
```
