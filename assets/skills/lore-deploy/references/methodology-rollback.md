# Rollback Methodology

## Purpose

This document defines when, how, and who triggers rollbacks, with platform-specific procedures and data safety rules. A rollback plan must be documented BEFORE every deployment — this is a hard quality gate.

## Rollback Decision Framework

### Automated Trigger Criteria

Configure monitoring to auto-evaluate these thresholds. Any single trigger warrants rollback evaluation.

| Signal | Threshold | Window | Severity |
|--------|-----------|--------|----------|
| Error rate (5xx) | > 2x pre-deploy baseline | > 2 minutes sustained | Critical |
| Latency p99 | > 3x pre-deploy baseline | > 5 minutes sustained | High |
| Latency p50 | > 2x pre-deploy baseline | > 10 minutes sustained | Medium |
| Health check failures | > 30% of instances | > 1 minute | Critical |
| Memory usage | > 90% and climbing | > 5 minutes (leak indicator) | High |
| Business metric (conversion, orders, sign-ups) | > 20% drop vs same time window | > 10 minutes | Critical |
| Dependency circuit breaker | > 50% open | > 2 minutes | High |

### Manual Trigger Criteria

Any team member can initiate a manual rollback. The post-mortem determines if the decision was correct — never penalize conservative rollback decisions.

Manual triggers:
- User-reported critical functionality broken
- Security vulnerability discovered in new version
- Data corruption detected
- Compliance violation identified

### Rollback vs Forward-Fix Decision

| Situation | Action | Reasoning |
|-----------|--------|-----------|
| Clear regression, previous version known-good | **Rollback** | Fastest path to recovery |
| Bug in new code, fix is <10 lines and obvious | **Forward-fix** | Faster than rollback + redeploy cycle |
| Schema change already applied | **Forward-fix** | Schema rollback may cause data loss |
| Multiple services already updated | **Rollback in dependency order** | Reverse of deployment order |
| Root cause unknown | **Rollback first, investigate second** | Restore service while debugging |
| Intermittent issue, <5% of requests | **Monitor + prepare rollback** | May be transient; rollback cost > impact |

**Default rule**: When in doubt, rollback. Availability > velocity.

---

## Platform-Specific Rollback Procedures

### Kubernetes

**Rolling Update Rollback**:
```bash
# View rollout history
kubectl rollout history deployment/{name} -n {namespace}

# Rollback to previous revision
kubectl rollout undo deployment/{name} -n {namespace}

# Rollback to specific revision
kubectl rollout undo deployment/{name} -n {namespace} --to-revision={N}

# Monitor rollback progress
kubectl rollout status deployment/{name} -n {namespace} --timeout=300s
```

**Blue-Green Rollback**:
```bash
# Switch service selector back to blue (previous version)
kubectl patch service {name} -n {namespace} -p '{"spec":{"selector":{"version":"blue"}}}'

# Verify traffic routing
kubectl get endpoints {name} -n {namespace}
```

**Canary Rollback**:
```bash
# Scale canary to 0
kubectl scale deployment {name}-canary -n {namespace} --replicas=0

# If using Istio, route 100% to stable
kubectl patch virtualservice {name} -n {namespace} --type merge -p '
spec:
  http:
  - route:
    - destination:
        host: {name}
        subset: stable
      weight: 100'
```

### Terraform / IaC

```bash
# Option 1: Revert to previous state (if state history available)
terraform state pull > current-state-backup.json
# Apply previous known-good configuration
git checkout {previous-commit} -- main.tf
terraform plan  # ALWAYS plan before apply
terraform apply

# Option 2: Targeted resource revert
terraform plan -target=module.{name}
terraform apply -target=module.{name}

# Option 3: Import and reconcile (when state is out of sync)
terraform import {resource_type}.{name} {cloud_id}
```

**CRITICAL**: Always `terraform plan` before `terraform apply` during rollback. Never blind-apply.

### Docker / Docker Compose

```bash
# Rollback to previous image tag
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps {service}

# Or pull and run specific version
docker pull {registry}/{image}:{previous-tag}
docker compose up -d --no-deps {service}
```

### Serverless / Platform (Vercel, AWS Lambda, Cloud Run)

```bash
# Vercel: promote previous deployment
vercel promote {previous-deployment-url}

# AWS Lambda: update alias to previous version
aws lambda update-alias --function-name {name} --name live --function-version {prev}

# Cloud Run: update traffic to previous revision
gcloud run services update-traffic {name} --to-revisions={prev-revision}=100
```

### GitHub Actions (CI/CD Pipeline Rollback)

```bash
# Re-run previous successful deployment workflow
gh run rerun {previous-run-id}

# Or trigger deployment of specific tag
gh workflow run deploy.yml -f version={previous-tag}
```

---

## Database Rollback Rules

Database rollbacks are the most dangerous category. Apply these rules strictly.

### Safe to Rollback

| Change | Rollback Method | Risk |
|--------|----------------|------|
| Add nullable column | Drop column (if no code writes to it yet) | Low |
| Add new table | Drop table (if no data written yet) | Low |
| Add index | Drop index | None |
| Insert reference data | Delete inserted rows | Low |

### Forward-Fix Only (NEVER direct rollback)

| Change | Why no rollback | Forward-Fix Approach |
|--------|----------------|---------------------|
| Drop column | Data already lost | Re-add column, backfill from backup/audit log |
| Change column type | Data already converted | Add new column with old type, dual-write |
| Rename column | Old code references old name | Add alias/view, migrate code, then cleanup |
| Merge tables | Data restructured | Cannot un-merge; create view for old shape |
| Data migration (transforms) | Original data overwritten | Backfill from audit log or backup |

### Point-in-Time Recovery (PITR) — Last Resort

Use ONLY when:
1. Data corruption is widespread
2. Forward-fix is impossible (no audit trail, no backup of original values)
3. Business impact of data loss (transactions after PITR point) is accepted by stakeholders

**PITR procedure**:
1. Stop all writes to the database
2. Notify stakeholders of data loss window
3. Perform PITR to last known-good timestamp
4. Reconcile lost transactions from application logs / external systems
5. Resume writes
6. Post-mortem: why was PITR necessary? How to prevent next time?

---

## Rollback Plan Template

Document this BEFORE every deployment. Store in lore as part of the deployment runbook (`lore create knowledge --parent <spec or prd it concerns> --sub-type reference`).

```markdown
## Rollback Plan: {deployment name} — {date}

### Deployment Summary
- **Service**: {name}
- **Change**: {description}
- **Strategy**: {rolling/blue-green/canary/etc.}
- **Risk Level**: {low/medium/high/critical}

### Monitoring (what to watch)
- Dashboard: {link}
- Key SLIs: {error rate baseline: X%, p99 baseline: Xms}
- Alert channel: {Slack/PagerDuty channel}

### Trigger Criteria
- Auto-rollback if: {specific thresholds}
- Manual evaluation if: {conditions}

### Rollback Steps
1. {Specific command or action}
2. {Specific command or action}
3. {Verify rollback successful: specific check}

### Database Considerations
- Schema changes in this deploy: {yes/no}
- If yes: rollback approach: {forward-fix / safe to revert / N/A}
- Data migration: {yes/no, reversible?}

### Post-Rollback
1. Re-run verification protocol (Phase 4)
2. Create incident doc in lore (`lore create knowledge --parent <plan or spec it reviews> --sub-type retro`)
3. Notify stakeholders
4. Schedule post-mortem within 48 hours

### Estimated Rollback Time
- Best case: {time}
- Worst case: {time}
```

---

## Rollback Testing

Rollback plans that are never tested are not plans — they are hopes.

**When to test rollback**:
- Every deployment to staging should include a rollback exercise
- Before any high/critical risk production deployment
- Quarterly for disaster recovery validation

**How to test**:
1. Deploy new version to staging
2. Verify it works (Phase 4 in staging)
3. Execute rollback procedure exactly as documented
4. Verify previous version works (Phase 4 again)
5. Record actual rollback time vs estimated
6. Update rollback plan with lessons learned
