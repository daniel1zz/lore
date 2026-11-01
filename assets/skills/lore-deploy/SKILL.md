---
name: lore-deploy
description: "Use when deploying, configuring CI/CD pipelines, managing infrastructure, creating releases, or setting up monitoring/observability. Args: '<mode> [context]' — the FIRST token is the mode, one of: ci|container|infra|migration|observability|release."
---

# Deploy - Mode: $0

Read `references/mode-$0.md` before starting. No mode → ask user.

| Mode | Reference | Focus |
|------|-----------|-------|
| `ci` | `references/mode-ci.md` | CI/CD pipeline setup |
| `container` | `references/mode-container.md` | Docker/container patterns |
| `infra` | `references/mode-infra.md` | Infrastructure as code |
| `release` | `references/mode-release.md` | Release management |
| `migration` | `references/mode-migration.md` | Database/service migration |
| `observability` | `references/mode-observability.md` | Monitoring, logging, tracing |

---

## Deployment Methodology Engine (cross-cutting — applies to ALL modes)

### Deployment Lifecycle: Analyze → Select Strategy → Implement → Verify → Rollback Plan

Every deployment follows this 5-phase lifecycle. **No phase may be skipped.** The methodology transforms deployment from a checklist activity into a decision-driven process where each phase gates the next.

#### Phase 1: ANALYZE

Gather context and assess risk before any deployment action.

1. **Load context**: lore corpus runbooks (`knowledge --sub-type reference`), tech-specs, ADRs for infrastructure decisions (`lore search "<query>" --type knowledge --json`, `lore search --type spec --json`)
2. **Query platform docs**: context7/deepwiki for target platform BEFORE configuring
3. **Scan existing patterns**: Serena `find_file` for CI configs, Dockerfiles, K8s manifests, IaC files
4. **Identify change scope**: schema change | code change | infra change | config change | multi-type
5. **Assess risk level** using this matrix:

| Risk Factor | Low | Medium | High | Critical |
|-------------|-----|--------|------|----------|
| Blast radius | Single service, no deps | Service with <3 consumers | Shared infra, >3 consumers | Platform-wide, data layer |
| Reversibility | Instant rollback | Minutes rollback | Hours rollback | Irreversible (data loss) |
| Change frequency | Routine, done before | Similar to past changes | First time for this type | Novel architecture change |
| Data impact | Read-only, no schema | Additive schema | Schema modification | Destructive schema change |

Output: `[DEPLOY_CONTEXT] target: {platform} | scope: {type} | risk: {level} | blast_radius: {description}`

#### Phase 2: SELECT STRATEGY

Apply the Strategy Selection Decision Matrix. See `references/methodology-strategy-selection.md` for full framework.

**Quick decision tree** (use full matrix for non-obvious cases):
- Stateless service + routine update → **Rolling Update**
- Need instant rollback OR critical service → **Blue-Green**
- Need gradual validation OR A/B testing → **Canary**
- Database schema change → **Expand-Migrate-Contract** (see mode-migration)
- Infrastructure change → **Terraform plan/apply** with state locking
- Static site / serverless / edge → **Atomic deploy** (platform-native: Vercel/Netlify/CloudFlare)
- First deploy / greenfield → **Recreate** (no traffic to protect)

**Contraindication check** (MUST verify before proceeding):

| Strategy | NEVER use when |
|----------|---------------|
| Rolling | Breaking schema change, binary protocol change |
| Blue-Green | Stateful connections without drain, extreme memory cost |
| Canary | No traffic splitting infrastructure, synchronous multi-service transaction |
| Recreate | Production with >0 downtime tolerance |

Output: `[STRATEGY] {name} | reason: {why} | contraindications_checked: {list} | rollback_method: {how}`

#### Phase 3: IMPLEMENT

Execute the mode-specific workflow from `references/mode-$0.md`. Apply quality gates (see below) at each sub-step.

**Before implementation begins**: Document the rollback plan (Phase 5). If you cannot define how to rollback, you cannot proceed.

#### Phase 4: VERIFY (Post-Deploy Verification Protocol)

See `references/methodology-verification.md` for full protocol.

**5-step verification sequence** (execute in order, stop on first failure):

| Step | Check | Pass Criteria | Tool |
|------|-------|--------------|------|
| 1. Smoke test | Critical API endpoints respond | HTTP 200, correct response shape | `curl` / `httpie` / platform health URL |
| 2. Health probes | All liveness + readiness probes passing | 100% pods/instances healthy | `kubectl get pods` / cloud console / platform status |
| 3. SLI comparison | Error rate, latency, saturation vs pre-deploy baseline | Within threshold (error <2x, p99 <2x) | Monitoring dashboard / PromQL / CloudWatch |
| 4. Synthetic transactions | Key user journeys complete end-to-end | All synthetic tests pass | Playwright / synthetic monitoring / API test suite |
| 5. Bake time | Observe for minimum window with no degradation | No alerts fired during bake period | Time-based: 5min (low risk) → 30min (high) → 2h (critical) |

**Bake time by risk level**:
| Risk | Minimum bake | Recommended bake |
|------|-------------|-----------------|
| Low | 5 minutes | 15 minutes |
| Medium | 15 minutes | 30 minutes |
| High | 30 minutes | 2 hours |
| Critical | 2 hours | 24 hours |

Output: `[VERIFY] smoke: {P/F} | health: {P/F} | SLI_delta: {error_rate, p99_latency} | synthetic: {P/F} | bake: {duration} | verdict: PASS/FAIL`

#### Phase 5: ROLLBACK PLAN (documented BEFORE Phase 3, executed IF Phase 4 fails)

See `references/methodology-rollback.md` for full procedures.

**Trigger criteria** (any one triggers rollback evaluation):
- Error rate > 2x pre-deploy baseline for > 2 minutes
- Latency p99 > 3x pre-deploy baseline for > 5 minutes
- Health check failures > 30% for > 1 minute
- Business metric (conversion, transaction rate) drops > 20%

**Rollback steps by strategy**:

| Strategy | Rollback Method | Expected Time |
|----------|----------------|---------------|
| Rolling | `kubectl rollout undo deployment/{name}` | 1-5 minutes |
| Blue-Green | Switch service selector / load balancer back to previous version | Seconds |
| Canary | Remove canary, route 100% to stable | Seconds |
| Terraform | `terraform apply` with previous state / targeted revert | 2-10 minutes |
| Serverless | Redeploy previous version / revert alias | Seconds-1 minute |
| Database | Forward-fix migration (preferred) OR point-in-time recovery (last resort) | Minutes-hours |

**Database rollback rules**:
1. NEVER rollback destructive schema changes (column drops, type changes) — forward-fix only
2. Additive changes (new columns, new tables) — safe to leave in place, cleanup later
3. Data migrations — maintain old+new paths until verified, then cleanup
4. Always test rollback path in staging before production

**Post-rollback**: Re-run Phase 4 verification. Create incident doc via lore (`lore create knowledge --parent <plan or spec it reviews> --sub-type retro --title ... --fields-file f.yaml`; skeleton: `lore template show knowledge --kind retro --blank`). Hand off to `operate` skill if extended investigation needed.

---

## Quality Gates (HARD BLOCK — per lifecycle phase)

**REFUSE to proceed** to next phase unless all HARD gates for current phase pass.

| Phase | Gate | Criteria | Block |
|-------|------|----------|-------|
| Analyze | Context loaded | lore runbooks/specs queried (`lore search`), platform docs consulted | HARD |
| Analyze | Risk assessed | Change scope + risk level documented with evidence | HARD |
| Strategy | Decision documented | Strategy name + reasons + contraindications checked | HARD |
| Strategy | Rollback plan exists | Written rollback procedure BEFORE implementation starts | HARD |
| Implement | Pre-flight safety | All safety checklist items pass (see below) | HARD |
| Implement | Artifact verified | Build passes, image scanned (if container), IaC plan reviewed (if infra) | HARD |
| Implement | Secrets safe | No secrets in code/config, using env vars or secret manager | HARD |
| Verify | Smoke tests | Critical paths respond correctly | HARD |
| Verify | Health checks | All probes passing | HARD |
| Verify | SLI comparison | No regression beyond defined thresholds | HARD |
| Verify | Bake time | Minimum observation window completed without alerts | SOFT |
| Handoff | Runbook updated | Deployment runbook reflects current state | SOFT |

### Pre-Flight Safety Checklist (expanded)

- [ ] No secrets in code/config (use env vars or secret managers)
- [ ] Container images pinned to specific versions (no `latest` tag)
- [ ] Network policies restrict unnecessary access
- [ ] RBAC with least privilege applied
- [ ] Health checks and readiness probes configured
- [ ] Rollback procedure documented and tested in staging
- [ ] Upstream dependencies verified (test suite passes, build succeeds)
- [ ] Change management ticket linked (if regulated environment)
- [ ] Cost estimate reviewed (if infrastructure change)
- [ ] SBOM generated (if new images/dependencies introduced)

---

## Quality Dimensions (dimensions this skill owns)

Output `[DIMENSION CHECK]` before marking any deploy task complete.

| Dimension | Standard |
|-----------|----------|
| **D-DEPLOY** | Deployment completes without unplanned downtime. Rollback tested or documented. Verification protocol passed. |
| **D-INFRA** | Infrastructure is reproducible (IaC), immutable (no manual changes), version-controlled. State files locked. |
| **D-SEC-DEPLOY** | No secrets in code/config. Images scanned. RBAC least-privilege. Network policies applied. Supply chain verified. |
| **D-OBS** | Observability instrumented: metrics, logs, traces configured. SLIs defined. Alerts actionable with runbook links. |

**Dimensions NOT owned by this skill** (leave to other skills):
- D-FUNC, D-CODE → implement skill
- D-PERF, D-SEC → review skill
- D-OPS → operate skill (runtime monitoring)

**Output format** (at Verify phase):
```
**[DIMENSION CHECK]**
- D-DEPLOY: OK/FAIL {evidence: verification output, rollback status}
- D-INFRA: OK/FAIL/N-A {evidence: IaC state, reproducibility}
- D-SEC-DEPLOY: OK/FAIL {evidence: scan results, RBAC audit}
- D-OBS: OK/FAIL/N-A {evidence: dashboards, alerts, SLIs}
```

---

## Deployment Anti-Patterns (what NOT to do)

| Anti-Pattern | Why it fails | Correct approach |
|-------------|-------------|-----------------|
| Deploy Friday afternoon | No team available for incidents | Deploy early in the week with full team coverage |
| Skip staging | "It works on my machine" | Every change goes through staging with same verification protocol |
| Manual hotfix on running instance | Drift from declared state, unreproducible | Build new artifact with fix → deploy through pipeline |
| `latest` tag in production | Non-deterministic, impossible to rollback to exact version | Pin to SHA digest or semver tag |
| Rollback plan = "we'll figure it out" | Panic-driven decisions during incident | Document specific rollback steps BEFORE deployment |
| Deploy schema + code simultaneously | Schema rollback may be impossible, code rollback leaves broken schema | Expand-Migrate-Contract: schema first, code second, cleanup third |
| Ignore bake time | Slow-onset failures (memory leaks, connection exhaustion) missed | Enforce minimum bake per risk level |
| Alert on every metric | Alert fatigue, real issues missed | Alert on symptoms (SLIs), not causes. Every alert must be actionable. |

---

## Mode-Specific Exit Criteria

A mode is COMPLETE only when ALL exit criteria are met. Report as checklist.

| Mode | Exit Criteria |
|------|--------------|
| `ci` | Pipeline runs green on default branch. PR checks enforce build+typecheck+lint+test. Caching configured. Secrets via OIDC/vault (not plain env). Branch protection enabled. |
| `container` | Image builds successfully. Security scan passes (no critical/high CVEs). Non-root user. Health check endpoint responds. Image size within baseline. .dockerignore configured. |
| `infra` | `terraform plan` (or equivalent) shows only expected changes. State locked and remote. Modules versioned. Environments separated (dev/staging/prod). Cost estimate reviewed. |
| `release` | Version bumped (semver). Changelog generated from commits. Git tag pushed. GitHub/GitLab release created. Artifacts published to registry. Release notes linked in lore (`lore link`). |
| `migration` | Schema applied with zero downtime (verified). Rollback tested in staging. Data verified (row counts, checksums, sample queries). Old+new code paths work during transition. |
| `observability` | Golden signals dashboarded. SLIs defined with targets. Alerts configured with severity + runbook links. Log aggregation active. Trace sampling configured. |

---

## Cross-Cutting Concerns (evaluate for EVERY deployment)

| Concern | Trigger | Action |
|---------|---------|--------|
| **Security** | Every deployment | Image scanning (Trivy/Snyk), secret rotation check, RBAC audit, network policy review |
| **Compliance** | Regulated environment (SOC2, HIPAA, PCI) | Audit trail, approval gates, change management ticket linked, data residency verified |
| **Cost** | Infrastructure changes | Cost estimate before apply (Infracost / cloud pricing calculator), right-sizing review, resource tagging |
| **Supply Chain** | New dependencies, new base images | SBOM generation (Syft/Trivy), provenance verification (SLSA), pinned versions with hash |
| **Incident Response** | Post-deploy failure detected | Auto-link to operate skill, create incident doc via lore (`lore create knowledge --parent <plan or spec it reviews> --sub-type retro`), trigger rollback if criteria met |
| **Data Privacy** | PII handling, new data stores | Encryption at rest/transit verified, retention policy applied, access audit enabled |

---

## Integration Points

### Upstream (inputs to this skill)

| Source | What it provides | How to load |
|--------|-----------------|-------------|
| `implement` | Build-ready code, env requirements, `.env.example` | Verified `tsc + lint` pass confirmation |
| `test` | Test suite passing, coverage report | CI gate: tests must pass before deploy triggers |
| `design` | Infrastructure requirements, health endpoints, scaling targets | lore spec (`--kind design`) → deploy constraints |
| `review` | Security/architecture approval | PR approval gate before merge-to-deploy |
| lore corpus | Runbooks, tech-specs, ADRs, domain knowledge | `lore search "<q>" --type knowledge --json`, `lore get <id-or-slug>` |

### Downstream (outputs from this skill)

| Target | What to hand off | Format |
|--------|-----------------|--------|
| `operate` | Deployed service, runbook, observability config, dashboard links | lore runbook doc + `[VERIFY]` output |
| `diagnose` | Deployment logs, change context, rollback history | Linked deployment record in lore |
| incident response | Rollback procedures, blast radius, trigger criteria | Rollback plan from Phase 5 |
| lore corpus | Task completion, deployment evidence | `lore evidence <task> --oracle build --command "<cmd>" --result pass\|fail --capture` |

---

## AI-Native Patterns

| Pattern | When | How |
|---------|------|-----|
| **Parallel provisioning** | Independent infra modules (networking, compute, storage) | Dispatch subagents per module with worktree isolation |
| **Deployment diff analysis** | Before applying any change | `terraform plan`, `kubectl diff`, `docker compose config --no-interpolate` → analyze diff before apply |
| **Automated canary analysis** | Canary deployments | Compare canary SLIs vs stable baseline → auto-promote if within threshold, auto-rollback if not |
| **Drift detection** | Infrastructure audit | Compare declared state (IaC files) vs actual state (cloud API) → report drift |
| **Cost forecasting** | Before infra changes | Run Infracost / cloud pricing → compare current vs projected |
| **Deployment simulation** | High-risk changes | Dry-run in isolated environment → verify behavior before production |

---

## Principles (5 max — actionable decision rules, not aspirations)

1. **Immutable over mutable**: Never patch running instances. Build new artifact → deploy → verify → remove old. Exception: emergency hotfix with documented justification and immediate follow-up proper deployment.
2. **Verify before trust**: Every deployment has a verification phase. "It deployed successfully" is not "it works." SLI comparison against pre-deploy baseline is mandatory.
3. **Rollback before rollout**: Document rollback procedure BEFORE starting deployment. If you cannot define how to rollback, you cannot deploy. This is a HARD BLOCK.
4. **Blast radius minimization**: Prefer strategies that limit failure impact. Canary (1% → 10% → 50% → 100%) over big-bang. Feature flags over code deploys for behavior changes. Progressive delivery over instant cutover.
5. **Reproducibility**: Same inputs → same outputs. Pin versions, lock state files, declare everything. Any team member can reproduce the deployment from the same commit + config.

---

## Persist

- Create/update runbook: `lore create knowledge --parent <spec or prd it concerns> --sub-type reference --title ... --fields-file f.yaml` (skeleton: `lore template show knowledge --kind reference --blank`) or `lore set <runbook> --fields-file f.yaml`
- Link to upstream specs: `lore link <runbook> <tech-spec> --type=implements`, `lore link <runbook> <adr> --type=relates-to`
- Update task: `lore evidence <task> --oracle build --command "<cmd>" --result pass --capture` then `lore release <task>`
