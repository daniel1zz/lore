# Incident Response (Quick Reference)

## Severity Levels

| Sev | Impact | Ack Time | Engage | Comms |
|-----|--------|----------|--------|-------|
| 1 | Full outage / breach | < 5 min | < 15 min | Exec + all hands + status page |
| 2 | Major degradation (>25% users) | < 15 min | < 30 min | On-call + stakeholders |
| 3 | Limited impact, workaround exists | < 1 hr | < 2 hr | On-call team |
| 4 | Minimal / cosmetic | < 4 hr | < 24 hr | Ticket |

## Response Phases

1. **Detect**: Check dashboards, verify impact, classify severity
2. **Triage**: Assign IC, open comms channel, update status page
3. **Investigate**: Dashboards -> recent deploys -> infra -> logs -> form hypothesis -> test
4. **Mitigate**: Rollback / scale / restart / failover / rate-limit (mitigation FIRST, fix LATER)
5. **Communicate**: Update every 15m (SEV1), 30m (SEV2), 1h (SEV3)
6. **Resolve**: Confirm metrics normal, monitoring silence 15-30min, update status page

## Incident Roles
- **IC**: Coordinate, decide, manage comms, track timeline
- **Tech Lead**: Lead investigation, propose solutions
- **Comms Lead**: Status page, stakeholders, customer comms
- **Scribe**: Document timeline, decisions, action items

## Common Mitigations

| Action | When | Command |
|--------|------|---------|
| Rollback | Bad deploy | `kubectl rollout undo deployment/{name}` |
| Scale | Capacity issue | `kubectl scale deployment/{name} --replicas={n}` |
| Restart | Bad state | `kubectl rollout restart deployment/{name}` |
| Feature flag | Faulty feature | Disable flag |

## Post-Mortem
- Meeting within 48h, document within 1 week
- **Blameless**: Focus on systems, not individuals
- Template: Metadata -> Impact table -> Timeline -> Root Cause -> Action Items (P0/P1/P2)

## Status Page Templates
- **Investigating**: "We are investigating reports of {issue}. Some users may experience {impact}."
- **Identified**: "We have identified the cause. Working on a fix. Update within {timeframe}."
- **Monitoring**: "A fix has been applied. We are monitoring."
- **Resolved**: "The issue has been resolved. Service returned to normal."
