# Mode: incident

**Purpose**: Incident response, management, and post-mortem (ICS-based)

## Severity Classification

| Sev | Description | Impact | Response Time | Comms Cadence |
|-----|-------------|--------|---------------|---------------|
| 1 | Complete outage / data breach | All users affected | < 15 min | Every 15 min + exec + status page |
| 2 | Significant degradation (>25% users) | Major feature down | < 30 min | Every 30 min + stakeholders |
| 3 | Limited impact, workaround exists | Minor feature, subset | < 2 hr | Every 1 hr + on-call team |
| 4 | Minimal / cosmetic impact | Negligible | < 24 hr | Ticket-based |

### Severity Decision Tree
```
Customer-facing outage?
  ├─ YES → Revenue/security impact? → YES → SEV-1
  │                                 → NO  → SEV-2
  └─ NO  → >5% users affected?    → YES → SEV-2
                                    → NO  → Workaround? → NO  → SEV-3
                                                         → YES → SEV-4
```

## Incident Roles (ICS Model)

| Role | Responsibilities | Required For |
|------|-----------------|-------------|
| **Incident Commander (IC)** | Coordinate response, make decisions, manage comms, track timeline | All SEV-1/2 |
| **Tech Lead** | Lead investigation, propose and execute mitigations | All SEV-1/2/3 |
| **Comms Lead** | Status page, stakeholder updates, customer comms | SEV-1/2 |
| **Scribe** | Document timeline, decisions, action items in real-time | SEV-1/2 |

**Role assignment rule**: IC is first responder until explicitly handed off. Never self-assign both IC and Tech Lead.

## Workflow (6 Phases)

### Phase 1: Detect
- Review alert details, check dashboards, verify customer reports
- Assess blast radius: which services, which users, which regions
- Classify initial severity (can be upgraded/downgraded later)

Tools: `agent-browser: navigate, eval` (dashboards, status pages) | `serena: execute_shell_command` (metrics queries)

### Phase 2: Triage
- Assign IC and roles based on severity
- Open communication channel (Slack channel, war room, bridge call)
- Create incident ticket with initial details
- Update status page if SEV-1/2

Output: `[INCIDENT_TRIAGE] id: {id} | severity: {N} | IC: {name} | channel: {link}`

### Phase 3: Investigate
Follow the systematic investigation path:

```
1. Check recent changes (deploys, configs, feature flags)
2. Check infrastructure (CPU, memory, disk, network)
3. Check dependencies (upstream APIs, databases, caches)
4. Check application logs (errors, exceptions, timeouts)
5. Form hypothesis → test with evidence → confirm or pivot
```

**Investigation anti-patterns to avoid**:
- Jumping to conclusions without data
- Multiple people changing things simultaneously
- Not documenting what was tried

Tools: `serena: execute_shell_command, search_for_pattern, find_symbol` | `lore: lore search --type knowledge` (runbooks, past incidents)

### Phase 4: Mitigate
**Principle: Mitigation FIRST, root cause fix LATER.**

| Action | When | Example Command | Rollback |
|--------|------|-----------------|----------|
| Rollback | Bad deploy suspected | `kubectl rollout undo deployment/{name}` | Re-deploy |
| Scale up | Capacity exhaustion | `kubectl scale deployment/{name} --replicas={n}` | Scale down |
| Restart | Bad state / memory leak | `kubectl rollout restart deployment/{name}` | N/A |
| Feature flag | Faulty feature | Disable flag in config | Re-enable |
| Rate limit | Traffic spike / abuse | Apply rate limit rule | Remove rule |
| Failover | Regional / AZ failure | Switch traffic to backup region | Switch back |
| Cache bypass | Stale cache causing errors | Force cache invalidation | Re-enable cache |

**Decision rule**: Choose the mitigation with the smallest blast radius and fastest time-to-effect.

Tools: `serena: execute_shell_command` | `github: create_pull_request` (for config/flag changes)

### Phase 5: Communicate
Use status page templates (tailor to your incident):

- **Investigating**: "We are investigating reports of {issue}. Some users may experience {impact}. We will provide an update within {timeframe}."
- **Identified**: "We have identified the cause of {issue}. The team is working on a fix. ETA: {estimate}. Next update: {time}."
- **Monitoring**: "A fix has been applied for {issue}. We are monitoring the situation to confirm resolution."
- **Resolved**: "The issue affecting {service} has been resolved. Service returned to normal at {time}. Duration: {duration}."

### Stakeholder Communication Matrix

| Audience | SEV-1 | SEV-2 | SEV-3 | SEV-4 |
|----------|-------|-------|-------|-------|
| Engineering team | Real-time channel | Real-time channel | Async channel | Ticket |
| Engineering leadership | Every 15 min | Every 30 min | Summary | N/A |
| Product / Business | Every 30 min | Every 1 hr | Post-incident | N/A |
| Executive | Every 30 min | Hourly summary | N/A | N/A |
| Customers (status page) | Real-time | Real-time | If requested | N/A |
| Support team | Real-time script | Talking points | FYI | N/A |

### Phase 6: Resolve
1. Confirm metrics return to normal baselines
2. Monitor in silence period (15-30 min with no re-occurrence)
3. Update status page to "Resolved"
4. Create post-mortem ticket (within 1 hour for SEV-1/2)
5. Schedule post-mortem meeting

## Escalation Matrix

| Condition | Escalation Action |
|-----------|------------------|
| No progress after 30 min (SEV-1) | Engage secondary on-call + engineering manager |
| No progress after 1 hr (SEV-2) | Engage team lead + cross-team SME |
| Suspected security breach | Engage security team immediately, follow security IR playbook |
| Customer data exposure | Engage legal + privacy officer, preserve evidence |
| Multi-service cascade | Declare cross-team incident, appoint senior IC |
| IC burnout (> 2 hrs active) | Mandatory IC handoff with context transfer |

## Security Incident Branch

When incident involves security (breach, unauthorized access, data exposure):

1. **Preserve evidence** — do NOT destroy logs, do NOT restart services before capturing state
2. **Engage security team** — follow security-specific IR playbook
3. **Contain** — isolate affected systems, revoke compromised credentials
4. **Legal notification** — assess regulatory reporting requirements (GDPR 72h, etc.)
5. **Communication** — security-specific comms (do not disclose attack vectors publicly)

## Post-Mortem Framework

### Scheduling
- SEV-1: Within 48 hours
- SEV-2: Within 1 week
- SEV-3: Within 2 weeks (optional, if systemic)
- SEV-4: No post-mortem required (capture in ticket)

### Post-Mortem Template

```markdown
# Post-Mortem: {Incident Title}

## Metadata
- **Date**: {date}
- **Duration**: {start} — {end} ({total duration})
- **Severity**: SEV-{N}
- **IC**: {name}
- **Authors**: {names}

## Impact
| Metric | Value |
|--------|-------|
| Users affected | {number or %} |
| Revenue impact | {estimate} |
| SLO impact | {which SLOs breached, budget consumed} |
| Data impact | {any data loss or corruption} |

## Timeline
| Time (UTC) | Event |
|------------|-------|
| HH:MM | Alert fired: {description} |
| HH:MM | IC assigned: {name} |
| HH:MM | Investigation: {what was checked} |
| HH:MM | Mitigation applied: {action} |
| HH:MM | Service recovered |
| HH:MM | Monitoring confirmed stable |

## Root Cause
{Detailed technical explanation. Use "5 Whys" to dig past symptoms.}

## Contributing Factors
- {Factor 1: e.g., missing monitoring for X}
- {Factor 2: e.g., no rate limiting on Y}

## What Went Well
- {Positive 1}
- {Positive 2}

## What Could Be Improved
- {Improvement 1}
- {Improvement 2}

## Action Items
| Priority | Action | Owner | Due Date | Status |
|----------|--------|-------|----------|--------|
| P0 | {Prevent recurrence} | {name} | {date} | Open |
| P1 | {Improve detection} | {name} | {date} | Open |
| P2 | {Process improvement} | {name} | {date} | Open |

## Lessons Learned
{Key takeaways for the organization}
```

**Blameless principle**: Focus on systems and processes, not individuals. "What allowed this to happen?" not "Who caused this?"

## Post-Operation Runbook Update (MANDATORY after incidents)

After resolution, capture and update:
- **New alert responses** not in runbook → add to common_alerts section
- **New remediation steps** → add to remediation section
- **Gotchas** (unexpected behaviors) → add to known issues
- **Missing monitoring** → flag gaps, create tickets
- Update: `docs/ops/runbooks/{service}-runbook.md`, `docs/ops/alerts/{service}-alerts.md`
- Link to: `docs/troubleshooting/incident-history.md`

Tools: `lore: lore create knowledge --parent <plan or spec it reviews> --sub-type retro, lore set, lore link` | `serena: create_text_file`

## Exit Criteria

Mode is COMPLETE when ALL of:
- [ ] Incident severity classified with evidence
- [ ] Timeline documented with key timestamps
- [ ] Mitigation applied and confirmed effective
- [ ] Status page updated through all phases (investigating → resolved)
- [ ] Root cause identified OR explicitly marked "unknown — further investigation needed"
- [ ] Post-mortem scheduled (SEV-1/2) or ticket created (SEV-3)
- [ ] Runbook updated with new findings
- [ ] Action items created with owners and due dates
- [ ] SLO impact assessed: `[SLO_IMPACT] budget_consumed: {%} | breach: Y/N`
- [ ] Report: `[INCIDENT_COMPLETE] id: {id} | severity: {N} | duration: {time} | root_cause: {summary} | actions: {N}`

## Static References

- [incident-response.md](incident-response.md) — ICS quick reference
- [sre-methodology.md](sre-methodology.md) — SLO impact assessment
