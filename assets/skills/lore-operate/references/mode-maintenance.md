# Mode: maintenance

**Purpose**: Routine maintenance, upgrades, toil reduction, and operational hygiene

## Task Classification

| Category | Examples | Frequency | Risk Level |
|----------|----------|-----------|------------|
| **Scheduled** | DB vacuum/analyze, index rebuild, log archival, backup testing, cert renewal | Weekly-Monthly | Low-Medium |
| **On-Demand** | Emergency patches, security updates, perf tuning, capacity expansion | As needed | Medium-High |
| **Automated** | Log rotation, metric cleanup, session purge, temp file cleanup | Daily-Hourly | Low |
| **Lifecycle** | Version upgrades, dependency updates, deprecation migration, EOL replacement | Quarterly | High |

## Maintenance Workflow

### Step 1: Plan

1. **Scope assessment**: What systems are affected? What's the blast radius?
2. **Risk classification**:

| Risk Level | Criteria | Approval | Window |
|------------|----------|----------|--------|
| Low | No downtime, no data risk, reversible | Self-approve | Any time |
| Medium | Brief impact, data safe, rollback plan | Peer review | Low-traffic window |
| High | Potential downtime, data migration, irreversible | Team lead + stakeholders | Scheduled maintenance window |
| Critical | Extended downtime, data risk, cross-service | Engineering leadership | Dedicated maintenance event |

3. **Schedule maintenance window**: Select based on traffic patterns
4. **Notify stakeholders**: Affected teams, customers (if public-facing)
5. **Prepare rollback plan**: Every change MUST have a documented rollback

Output: `[MAINT_PLAN] task: {name} | risk: {level} | window: {datetime} | rollback: {strategy} | approvals: {status}`

Tools: `lore: lore create knowledge --sub-type reference` (maintenance RFC) | `serena: execute_shell_command` (traffic analysis)

### Step 2: Pre-Checks (MANDATORY)

Before any maintenance work, verify:

| Check | Command/Tool | Expected Result |
|-------|-------------|-----------------|
| **Backup status** | Verify latest backup exists and is restorable | Backup < 24h old, restore tested |
| **Current health** | Check all health endpoints, SLO status | All services healthy, SLOs green |
| **Baseline metrics** | Capture current performance metrics | Screenshot / query output saved |
| **Active incidents** | Check incident tracker | No active SEV-1/2 incidents |
| **Deployment status** | Check recent/pending deploys | No deploys in progress or planned |
| **Dependency status** | Check upstream/downstream health | All dependencies healthy |

**HARD BLOCK**: Do NOT proceed if any critical pre-check fails. Document failure and reschedule.

Output: `[PRE_CHECK] backup: pass/fail | health: pass/fail | baseline: captured | incidents: none/blocked | deps: pass/fail`

Tools: `serena: execute_shell_command` | `agent-browser: navigate, eval` | `lore: lore search`

### Step 3: Execute

During maintenance execution:

1. **Enable maintenance mode** (if applicable): status page, feature flags, traffic draining
2. **Execute changes** following the documented plan — no improvisation
3. **Monitor continuously**: Watch metrics, logs, error rates during execution
4. **Document deviations**: Any difference from plan gets recorded immediately
5. **Rollback trigger**: If any of these occur, execute rollback plan:
   - Error rate > 2x baseline
   - Latency > 3x baseline
   - Health check failures
   - Unexpected data inconsistency

Tools: `serena: execute_shell_command, create_text_file` | `agent-browser: navigate, eval`

### Step 4: Validate

Post-maintenance health verification:

| Validation | Method | Threshold |
|------------|--------|-----------|
| **Health checks** | Hit all service health endpoints | All return 200 |
| **Functional smoke test** | Execute critical user paths | All pass |
| **Metric comparison** | Compare post vs baseline | Within 10% of baseline |
| **Error rate** | Check error rate trend | At or below baseline |
| **SLO status** | Check error budget impact | No budget consumed by maintenance |
| **Data integrity** | Run consistency checks if data was modified | All checks pass |

**Monitoring period**: Watch metrics for 30 min post-maintenance before declaring success.

Output: `[POST_CHECK] health: pass/fail | smoke: pass/fail | metrics_delta: {%} | errors: {rate} | SLO: {status}`

### Step 5: Document

After successful maintenance:

1. **Update runbook** with procedure, timing, gotchas discovered
2. **Update maintenance log**: date, scope, duration, issues encountered
3. **Update automation**: If manual steps can be automated, create ticket
4. **Schedule next occurrence** (if recurring)

Tools: `lore: lore set, lore create knowledge --sub-type reference` | `serena: create_text_file`

## Common Maintenance Procedures

### Database Maintenance

| Task | Frequency | Procedure | Risk |
|------|-----------|-----------|------|
| VACUUM ANALYZE (PostgreSQL) | Weekly | `VACUUM ANALYZE {table};` during low traffic | Low |
| Index rebuild | Monthly | `REINDEX TABLE CONCURRENTLY {table};` | Low |
| Unused index cleanup | Quarterly | Query `pg_stat_user_indexes` → drop unused | Medium |
| Connection pool review | Monthly | Check pool utilization, adjust sizes | Low |
| Backup restore test | Monthly | Restore to staging, verify data | Low |
| Schema migration | As needed | Follow migration playbook, blue-green if possible | High |

### Certificate Management

| Task | Timing | Automation |
|------|--------|------------|
| Monitor expiry | Daily check | Alert when < 30 days |
| Renew certs | 14 days before expiry | cert-manager / Let's Encrypt auto-renewal |
| Rotate secrets | Quarterly | Vault / AWS Secrets Manager rotation |
| Update trust chains | When CA updates | Manual verification required |

### Dependency Updates

| Category | Frequency | Strategy |
|----------|-----------|----------|
| Security patches | Immediately | Automated via Dependabot/Renovate, fast-track review |
| Minor versions | Weekly | Batch updates, automated testing |
| Major versions | Quarterly | Manual review, changelog analysis, staged rollout |
| Runtime/OS | Quarterly | Test in staging for 1 week before production |

### Log and Data Hygiene

| Task | Frequency | Implementation |
|------|-----------|---------------|
| Log rotation | Daily | logrotate / container log driver |
| Metric retention | Per tier | Hot 7d → Warm 30d → Cold 1yr → Archive |
| Session cleanup | Daily | Purge expired sessions |
| Temp file cleanup | Daily | Cron job, /tmp age > 24h |
| Orphaned resource cleanup | Weekly | Scan for unattached volumes, stale DNS, unused secrets |

## Toil Reduction Framework

Toil is the operational work that is manual, repetitive, automatable, reactive, and produces no lasting value.

### Toil Identification

For each operational task, score on 5 dimensions:

| Dimension | Score 0 | Score 1 | Score 2 |
|-----------|---------|---------|---------|
| Manual effort | Fully automated | Partially automated | Fully manual |
| Frequency | < 1x/month | Weekly | Daily or more |
| Automation feasibility | Cannot automate | Could automate with effort | Easy to automate |
| Reactive vs proactive | Proactive/preventive | Mix | Purely reactive |
| Lasting value | Creates lasting improvement | Neutral | No lasting value |

**Total score ≥ 7 → High-priority automation candidate**

### Toil Automation Priority Matrix

| Priority | Criteria | Timeline |
|----------|----------|----------|
| P0 | Score ≥ 8, daily frequency, easy to automate | This sprint |
| P1 | Score ≥ 7, weekly frequency | This quarter |
| P2 | Score ≥ 5, monthly frequency | Backlog |

Output: `[TOIL_ASSESSMENT] task: {name} | score: {N}/10 | frequency: {x/week} | time: {min} | automation: P{N}`

### Common Toil Automation Patterns

| Toil Task | Automation Approach |
|-----------|-------------------|
| Manual scaling | HPA/ASG with proper metrics |
| Certificate renewal | cert-manager with auto-renewal |
| Log cleanup | logrotate + retention policies |
| Health check verification | Automated health monitoring + alerting |
| Incident response runbooks | Automated runbook execution (PagerDuty/Rundeck) |
| Dependency updates | Dependabot/Renovate with auto-merge for passing CI |

## Exit Criteria

Mode is COMPLETE when ALL of:
- [ ] Maintenance plan documented with risk level and rollback strategy: `[MAINT_PLAN]`
- [ ] Pre-checks all passed: `[PRE_CHECK]`
- [ ] Maintenance executed according to plan (deviations documented)
- [ ] Post-validation confirms healthy state: `[POST_CHECK]`
- [ ] Runbook updated with procedure and findings
- [ ] Toil identified and automation opportunities documented (if applicable): `[TOIL_ASSESSMENT]`
- [ ] Next maintenance scheduled (if recurring)
- [ ] Report: `[MAINT_COMPLETE] task: {name} | risk: {level} | duration: {time} | issues: {N} | runbook_updated: Y/N`

## Static References

- [runbook-template.md](runbook-template.md) — Runbook structure for maintenance procedures
- [sre-methodology.md](sre-methodology.md) — Toil measurement framework
