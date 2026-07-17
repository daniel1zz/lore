# Operations Runbook Generation

Generate and maintain project-specific ops runbooks in `docs/ops/`.

## Document Types
| File | Purpose |
|------|---------|
| `runbooks/{service}-runbook.md` | Service-specific: overview, health checks, alerts, scaling, deployment, maintenance |
| `runbooks/general-runbook.md` | Cross-service: infra, database, monitoring, communication templates |
| `alerts/{service}-alerts.md` | Alert definitions: expression, meaning, impact, quick response, false positive check |
| `slo-definitions.md` | SLOs: availability, latency, throughput targets + error budget policy |
| `on-call-guide.md` | On-call: access, triage, common scenarios, handoff |
| `index.yaml` | Service registry with runbook/alert paths, owners, criticality |

## Generation Workflow
1. Identify service scope from context
2. Analyze: service code (endpoints, error handling), monitoring config (alerts, metrics), deployment config
3. Generate runbook from analysis (use standard SRE runbook structure)
4. Generate alerts doc with explanations and remediation
5. Update `index.yaml`

## Mode-Specific Context Loading
| Mode | Runbook Section | Additional |
|------|----------------|------------|
| monitor | health_checks | Dashboards, key metrics |
| incident | common_alerts, remediation | Escalation, comms templates, past incidents |
| scaling | scaling | Current capacity, limits |
| maintenance | maintenance | Scheduled windows, dependency notifications |

## Post-Incident Update
After incident resolution: capture learnings → update runbook (add alert, remediation, gotchas) → update alerts doc → link to incident history → prompt SLO review if breached.

## Service Priority
- **HIGH** (mandatory runbook): user-facing, payments/auth, critical business logic
- **MEDIUM** (recommended): internal services, background jobs, data pipelines
- **LOW** (optional): dev tools, test services
