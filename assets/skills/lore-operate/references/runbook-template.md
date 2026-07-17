# Runbook Template & Quality Criteria

## Runbook Structure

Every service runbook should follow this structure. Not all sections are required for every service — use the priority guide below.

```markdown
# Runbook: {Service Name}

## Service Overview
- **Description**: {What this service does, in one sentence}
- **Owner**: {Team/person}
- **Criticality**: HIGH / MEDIUM / LOW
- **Dependencies**: {Upstream and downstream services}
- **Repository**: {Link}
- **Dashboards**: {Links to Grafana/DataDog/etc}
- **Logs**: {How to access logs — Kibana query, Loki label, CloudWatch group}

## SLOs
| SLI | Target | Dashboard Link |
|-----|--------|---------------|
| Availability | {%} | {link} |
| Latency (p99) | {ms} | {link} |
| Error rate | {%} | {link} |

## Health Checks
| Check | Endpoint/Command | Expected | Frequency |
|-------|-----------------|----------|-----------|
| HTTP health | `GET /health` | 200 OK | 30s |
| Readiness | `GET /ready` | 200 OK | 10s |
| DB connectivity | {command} | Connection OK | 60s |
| Cache connectivity | {command} | PONG | 60s |

## Common Alerts

### {Alert Name}
- **Expression**: `{PromQL or alert rule}`
- **Severity**: {SEV-1/2/3/4}
- **What it means**: {Plain English explanation}
- **Likely causes**: {List of common causes}
- **Response steps**:
  1. {Step 1}
  2. {Step 2}
  3. {Step 3}
- **False positive check**: {How to determine if this is a false alarm}
- **Escalation**: {Who to contact if not resolved in X minutes}

### {Next Alert Name}
...

## Remediation Procedures

### {Procedure Name}: {e.g., "Restart Service"}
- **When to use**: {Trigger conditions}
- **Impact**: {What users will experience}
- **Steps**:
  1. {Step with exact command}
  2. {Step with exact command}
  3. {Verification step}
- **Rollback**: {How to undo if it makes things worse}
- **Time estimate**: {Expected duration}

### {Next Procedure}
...

## Scaling
- **Current capacity**: {N replicas, instance type}
- **Auto-scaling**: {HPA config summary — min/max/metric}
- **Manual scaling**: `{exact kubectl/aws command}`
- **Scaling limits**: {Max replicas, cost ceiling, known bottlenecks}

## Deployment
- **Deploy method**: {CI/CD pipeline, manual, etc.}
- **Rollback command**: `{exact command}`
- **Deploy verification**: {What to check after deploy}
- **Feature flags**: {How to disable new features without rollback}

## Maintenance
- **Scheduled tasks**: {List of cron jobs, maintenance windows}
- **Database maintenance**: {vacuum schedule, index rebuilds}
- **Certificate renewal**: {When, how, automation status}
- **Backup schedule**: {Frequency, retention, restore procedure}

## Known Issues
| Issue | Symptoms | Workaround | Status |
|-------|----------|------------|--------|
| {description} | {what you see} | {what to do} | Open/Resolved |

## Incident History
| Date | Severity | Summary | Post-Mortem Link |
|------|----------|---------|-----------------|
| {date} | SEV-{N} | {one-line summary} | {link} |

## Access & Credentials
- **Production access**: {How to get access — VPN, bastion, IAM role}
- **Secrets**: {Where secrets are stored — Vault path, AWS Secrets Manager ARN}
- **Admin tools**: {Links to admin panels, CLI commands}
```

## Alert Documentation Template

For `docs/ops/alerts/{service}-alerts.md`:

```markdown
# Alert Definitions: {Service Name}

## Alert Inventory

| Alert | Severity | Expression | Runbook Section |
|-------|----------|-----------|-----------------|
| {name} | {sev} | {expr} | {link to runbook section} |

## Alert Details

### {Alert Name}

**Expression**:
\`\`\`promql
{full PromQL expression}
\`\`\`

**Severity**: {SEV-1/2/3/4}
**For duration**: {how long condition must persist before firing}

**What it means**:
{Plain English explanation of what this alert indicates}

**Impact**:
{What users experience when this alert fires}

**Likely causes** (ordered by frequency):
1. {Most common cause}
2. {Second most common}
3. {Less common}

**Quick response**:
1. Check dashboard: {link}
2. Check logs: `{log query}`
3. {Service-specific diagnostic command}
4. If {condition} → {action}
5. If unresolved after {time} → escalate to {team/person}

**False positive indicators**:
- {Condition that indicates false positive}
- {Another false positive indicator}

**Related alerts**: {Other alerts that may fire simultaneously}
```

## Runbook Quality Criteria

A runbook is considered high-quality when it meets these criteria:

### Must-Have (all runbooks)

| Criterion | Test | Pass |
|-----------|------|------|
| **Actionable** | Every alert has concrete response steps with exact commands | Commands are copy-pasteable |
| **Current** | Last reviewed within 90 days | Review date documented |
| **Complete** | All production alerts have corresponding runbook entries | No alert without a runbook entry |
| **Accessible** | On-call can find and use it within 2 minutes | Linked from alert annotations |
| **Tested** | Procedures have been executed at least once | Tested date per procedure |

### Should-Have (HIGH-criticality services)

| Criterion | Test |
|-----------|------|
| **Estimated time** | Each procedure has expected duration |
| **Rollback** | Every procedure has undo steps |
| **Escalation paths** | Clear who to contact and when |
| **Incident history** | Past incidents linked with learnings applied |
| **SLO-linked** | Alerts tied to SLO burn rates |

### Nice-to-Have (mature operations)

| Criterion | Test |
|-----------|------|
| **Automated verification** | Runbook steps have automated equivalents |
| **Training material** | New on-call members can onboard from runbook alone |
| **Chaos-validated** | Procedures tested via chaos experiments |

## Runbook Lifecycle

```
Create (new service) → Review (monthly) → Update (after incidents) → Archive (service retired)
```

| Event | Runbook Action |
|-------|---------------|
| New service deployed | Create runbook within 30 days (P0 for HIGH-criticality) |
| New alert added | Add alert response entry within 1 day |
| Incident resolved | Update runbook with learnings within 1 week |
| Quarterly review | Check all entries for accuracy, remove stale content |
| Service retired | Archive runbook, update index |

## Index File (docs/ops/index.yaml)

```yaml
services:
  - name: api-gateway
    criticality: HIGH
    owner: platform-team
    runbook: runbooks/api-gateway-runbook.md
    alerts: alerts/api-gateway-alerts.md
    slo: slo-definitions.md#api-gateway
    last_review: 2026-03-15

  - name: payment-service
    criticality: HIGH
    owner: payments-team
    runbook: runbooks/payment-service-runbook.md
    alerts: alerts/payment-service-alerts.md
    slo: slo-definitions.md#payment-service
    last_review: 2026-03-01
```
