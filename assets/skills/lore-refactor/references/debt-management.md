# Technical Debt Management

> Core frameworks for debt assessment and prioritization. Claude already knows debt theory — this file provides **decision structures** only.

## Debt Quadrant (Classification)

```yaml
quadrant:
  deliberate_prudent: "We know this is debt, taking it on consciously → Document, track, schedule"
  deliberate_reckless: "We know this is bad, don't care → Avoid!"
  inadvertent_prudent: "We learned better ways after building → Expected, improve as you learn"
  inadvertent_reckless: "We don't know what we don't know → Education, code review, mentoring"
```

## Debt Categories

| Category | Detection Tools (use these first) | Manual Detection |
|----------|----------------------------------|------------------|
| Code | ESLint, Biome, SonarQube, `jscpd` | Code review, complexity metrics |
| Architecture | Dependency analysis tools, Madge | Architecture review, change impact |
| Test | Coverage reports (`c8`, `istanbul`, `pytest-cov`) | Bug escape rate analysis |
| Infrastructure | CI/CD metrics, deployment frequency | Build times, deployment friction |
| Documentation | `lore search` for gaps | Onboarding feedback |
| Dependencies | `npm audit`, Dependabot, Renovate, `pip-audit` | Version checking, license review |

> **Rule**: Always run automated detection tools before manual assessment.

## RICE Prioritization

```yaml
formula: "(Reach × Impact × Confidence) / Effort"

reach: "How much of codebase is affected (1-10)"
impact: "How much it affects productivity/quality (1-10)"
confidence: "How sure are we about estimates (0.5-1.0)"
effort: "Time to address (days)"

example:
  item: "Replace legacy auth system"
  score: "(8 × 7 × 0.7) / 20 = 1.96"
```

## Prioritization Matrix

| | Low Effort | High Effort |
|---|-----------|-------------|
| **High Value** | Do first | Plan and schedule |
| **Low Value** | Do opportunistically | Avoid or reconsider |

## Allocation Strategy

```yaml
recommended: "Combination approach"
  dedicated_time: "15-20% of sprint capacity for debt repayment"
  boy_scout_rule: "Leave code better than you found it during regular work"
  debt_sprints: "Every 4-6 sprints, one dedicated debt sprint for big items"
```

## Dependency Update Workflow

⚠️ **When updating dependencies, MUST query docs first**:

```yaml
dependency_update:
  1_audit:
    tools: ["npm audit", "pip-audit", "Dependabot alerts"]
    action: "Identify outdated/vulnerable dependencies"

  2_docs_lookup:
    mandatory: true
    tools: [context7, gitmcp]
    queries:
      - "{package} CHANGELOG from {current_version} to {target_version}"
      - "{package} migration guide {target_version}"
      - "{package} breaking changes"

  3_update:
    prefer_tools: ["npm-check-updates (ncu)", "Renovate", "Dependabot PRs"]
    manual_only_when: "Automated tools cannot handle the update"

  4_verify:
    action: "Run full test suite after each dependency update"
```

## Tracking

```yaml
github_integration:
  issue_write: "Create debt tracking issues with labels"
  search_issues: "Find existing debt tickets before creating duplicates"
  create_pull_request: "Submit remediation PRs"

review_cadence:
  weekly: "Team reviews top items"
  monthly: "Prioritization review"
  quarterly: "Strategy review with stakeholders"
```
