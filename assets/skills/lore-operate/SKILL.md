---
name: lore-operate
description: "Use when user needs monitoring setup, incident response, scaling decisions, maintenance operations, chaos engineering, or SLO lifecycle management."
---

# Operate - Mode: $0

Read `references/mode-$0.md` before starting. No mode → ask user.

| Mode | Reference | Focus |
|------|-----------|-------|
| `monitor` | `references/mode-monitor.md` | Observability analysis, SLO status, alert tuning |
| `incident` | `references/mode-incident.md` | Incident response (ICS), post-mortem |
| `scaling` | `references/mode-scaling.md` | Capacity planning, load testing, auto-scaling |
| `maintenance` | `references/mode-maintenance.md` | Scheduled ops, upgrades, toil reduction |
| `chaos` | `references/mode-chaos.md` | Resilience validation, game days, failure injection |

---

## SRE Methodology Engine (cross-cutting — applies to ALL modes)

### SLO/SLI Lifecycle

**Core SRE discipline.** See `references/sre-methodology.md` for full methodology.

Quick reference — the 5-stage lifecycle:
1. **SLI Selection**: Choose indicators by service type (see SLI menu in reference)
2. **SLO Targeting**: Set targets from baselines (p50 + buffer), not aspirational numbers
3. **Error Budget Policy**: Define budget, exhaustion actions, and stakeholder sign-off
4. **Burn-Rate Alerting**: Multi-window alerts (fast burn 1h/5m, slow burn 6h/30m)
5. **SLO Review Cadence**: Monthly review → adjust targets, retire stale SLOs

Output: `[SLO_STATUS] service: {name} | SLIs: {N} | budget_remaining: {%} | burn_rate: {x}`

### Toil Measurement

Toil = manual, repetitive, automatable, reactive, no lasting value.

| Metric | Measurement | Target |
|--------|-------------|--------|
| Toil ratio | Hours of toil / total ops hours per sprint | < 50% (Google SRE standard) |
| Automation candidates | Tasks performed > 3x/week manually | Automate top-3 per quarter |
| Toil reduction velocity | Number of toil tasks automated per quarter | Increasing trend |

Track with `[TOIL] task: {name} | frequency: {x/week} | time: {min} | automatable: Y/N`

### Error Handling & Escalation Strategy

**Applies across all modes.** Map operational events to response paths:

| Signal | Response | Escalation |
|--------|----------|------------|
| SLO burn > 1x normal | Investigate, no page | Team channel notification |
| SLO burn > 2x (slow burn) | Alert on-call, start investigation | 30-min ticket |
| SLO burn > 14.4x (fast burn) | Page immediately, incident triage | SEV-2 auto-escalation |
| Error budget exhausted | Feature freeze, reliability sprint | Engineering leadership |

---

## Quality Dimensions (dimensions this skill owns)

This skill owns these dimensions. Output `[DIMENSION CHECK]` before marking task complete.

| Dimension | Standard |
|-----------|----------|
| **D-RELIABILITY** | SLOs defined with measurable SLIs. Error budget tracked. Alert coverage for all critical paths. |
| **D-OBSERVABILITY** | All services have RED/USE metrics. Structured logging with correlation IDs. Trace coverage on critical paths. |
| **D-RESILIENCE** | Failure modes documented. Degradation strategies defined. Chaos experiments validate assumptions. |
| **D-OPERABILITY** | Runbooks exist for all high-priority services. On-call can resolve common issues without escalation. |

**Dimensions NOT owned by this skill** (leave to other skills):
- D-FUNC, D-CODE → implement skill
- D-PERF, D-SEC → review skill
- D-INFRA → deploy skill

**Output format** (at Verify phase):
```
**[DIMENSION CHECK]**
- D-RELIABILITY: pass/fail {evidence: SLO count, budget status}
- D-OBSERVABILITY: pass/fail {evidence: metric coverage, log structure}
- D-RESILIENCE: pass/fail {evidence: failure modes documented, chaos results}
- D-OPERABILITY: pass/fail {evidence: runbook coverage, on-call readiness}
```

## Quality Gates (HARD BLOCK — all modes)

**REFUSE to finalize** operational output unless ALL required gates for the mode pass.

| Mode | Required Gates |
|------|---------------|
| `monitor` | (1) SLIs selected with rationale (2) Alert thresholds derived from baselines, not guesses (3) Dashboard covers RED + USE for target service (4) Runbook linked for every alert |
| `incident` | (1) Severity classified with impact evidence (2) Timeline documented with timestamps (3) Root cause identified or explicitly marked unknown (4) Post-mortem scheduled within 48h for SEV1/2 |
| `scaling` | (1) Capacity model based on measured data (2) Load test validates scaling assumptions (3) Auto-scaling config has min/max/cooldown (4) Cost impact estimated |
| `maintenance` | (1) Rollback plan documented before execution (2) Pre-checks passed (backups, baselines) (3) Change window communicated to stakeholders (4) Post-maintenance validation confirms health |
| `chaos` | (1) Steady-state hypothesis defined with measurable criteria (2) Blast radius limited and abort conditions set (3) Rollback mechanism verified before experiment (4) Results documented with action items |

---

## Step 0: Context

Load operational context:
1. lore: `lore search "<q>" --type knowledge --json` for runbook, slo-definition, alert-config, ops-* knowledge docs
2. Load project monitoring config (Prometheus rules, Grafana dashboards, alert policies)
3. Check `shared/ops-runbook-generation.md` for runbook management standards
4. If incident mode → also load recent incident history from lore (`lore search "incident" --type knowledge --json`)

Tools: `lore: lore search, lore get` (the session-start injection carries only this seat's claims and plan handoff; pull corpus state with `lore bootstrap --json` on demand) | `serena: execute_shell_command, search_for_pattern`

Output: `[CONTEXT_LOADED] runbooks: {N} | SLOs: {N} | alerts: {N} | incidents_recent: {N}`

## Step 1: Mode Execution

Follow the mode-specific reference file. Each mode has its own workflow, tools, and exit criteria.

## Step 2: Runbook Update (MANDATORY after any operational work)

After completing any mode's work, update operational documentation:

1. **New findings** → add to relevant runbook section (see `references/runbook-template.md`)
2. **New alerts** → document alert name, expression, meaning, response in alerts doc
3. **SLO changes** → update `docs/ops/slo-definitions.md`, notify stakeholders
4. **Incident learnings** → add to `docs/troubleshooting/incident-history.md`

Tools: `lore: lore create knowledge --sub-type reference, lore set, lore link` | `serena: create_text_file`

## Step 3: Verify & Report

1. Run mode-specific exit criteria (see Quality Gates above)
2. Output `[DIMENSION CHECK]` per Quality Dimensions
3. Report: `[OPERATE_COMPLETE] mode: {mode} | actions: {summary} | runbook_updated: Y/N | SLO_impact: {description}`

---

## Cross-Cutting Concerns (apply to ALL modes)

| Concern | Trigger | Action |
|---------|---------|--------|
| **FinOps / Cost** | Any scaling, new infra, resource change | Estimate cost impact, compare alternatives, set budget alerts |
| **Security-Ops** | Any access change, secret rotation, audit trail | Follow least-privilege, rotate credentials, log security events |
| **Change Management** | Any production change | RFC/change ticket, approval workflow, rollback plan |
| **Compliance** | Regulated data, audit requirements | Ensure audit trail, retention policies, access controls |
| **Data Privacy** | PII in logs/metrics, GDPR scope | Mask/redact PII, enforce retention tiers, document processing |

---

## Principles (5 max — actionable, not aspirational)

1. **Mitigation FIRST, Fix LATER**: During incidents, stop the bleeding before root-causing. Rollback > hotfix > investigation.
2. **SLO-Driven Decisions**: Every operational priority derives from SLO impact. No SLO impact = lower priority.
3. **Automate Toil Away**: If you do it > 3 times manually, automate it. Track toil ratio per sprint.
4. **Measure, Then Act**: Baselines before thresholds. Load test before scaling. Steady-state before chaos. No guessing.
5. **Blameless Culture**: Post-mortems focus on systems, not individuals. Action items fix processes, not people.

---

## Integration Points

### Upstream (inputs to this skill)
| Source | What it provides | How to load |
|--------|-----------------|-------------|
| deploy:observability | Monitoring config, alert rules, dashboard definitions | lore `lore search --type knowledge` (ops-config) |
| design:system | SLA targets, capacity requirements, failure mode analysis | lore `lore get` (spec --kind design) |
| implement | Application code, error handling, instrumentation | Serena `find_symbol`, `get_symbols_overview` |
| domain ADRs/retrospectives | Business-critical paths, data sensitivity | `Skill('domain','activate')` |

### Downstream (outputs from this skill)
| Target | What to hand off | Format |
|--------|-----------------|--------|
| diagnose skill | Alert investigation results, anomaly patterns, timeline | `[INCIDENT_HANDOFF]` with timeline + evidence |
| implement skill | Bug fixes from incidents, automation requests from toil | lore task (`lore create task`) with root cause analysis |
| deploy skill | Scaling requirements, infra changes, config updates | lore knowledge doc (`--sub-type reference`, ops-change) |
| test skill | Chaos experiment results, failure modes to test | `[CHAOS_RESULTS]` with findings |
| lore corpus | Runbook updates, SLO status, incident reports | `lore create knowledge` / `lore set` |

### Handoff Protocols

**operate → diagnose**: When incident investigation reveals a code-level bug:
```
[INCIDENT_HANDOFF] incident: {id} | severity: {sev} | symptom: {desc}
Timeline: {timestamps} | Hypothesis: {theory} | Evidence: {logs/metrics}
→ Dispatch: Skill('diagnose', 'bug')
```

**operate → implement**: When toil automation or incident fix needs code:
```
[TOIL_AUTOMATE] task: {name} | frequency: {x/week} | current_time: {min}
Expected savings: {hours/quarter} | Approach: {automation strategy}
→ Dispatch: Skill('implement', 'backend')
```

**deploy → operate**: After deployment, operate takes ownership of runtime:
```
[DEPLOY_HANDOFF] service: {name} | version: {v} | deploy_time: {ts}
→ Monitor: SLO burn rate for 30min post-deploy | Rollback if SLO violation
```

---

## Static References

- [sre-methodology.md](references/sre-methodology.md) — SLI/SLO/error budget/burn-rate lifecycle
- [runbook-template.md](references/runbook-template.md) — Runbook structure and quality criteria
- [chaos-engineering.md](references/chaos-engineering.md) — Chaos methodology, game day format
- [incident-response.md](references/incident-response.md) — ICS quick reference
- [prometheus-patterns.md](references/prometheus-patterns.md) — Metrics naming, queries, alerting
- [logging-best-practices.md](references/logging-best-practices.md) — Structured logging, retention
- [shared/ops-runbook-generation.md](../shared/ops-runbook-generation.md) — Runbook lifecycle management
