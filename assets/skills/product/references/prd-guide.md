# PRD Guide

## PRD Structure

| Part | Sections | Key Fields |
|------|----------|------------|
| 1. Context | metadata, executive_summary, problem_statement, strategic_context | id:`PRD-{NNN}`, status:`draft\|review\|approved\|deprecated`, priority:`P0\|P1\|P2` |
| 2. Users | target_users, user_journey | primary/secondary/excluded users; current vs target journey with emotions |
| 3. Solution | goals_and_metrics (OKR+SMART), non_goals, solution_overview | metric + baseline + target + measurement |
| 4. Requirements | functional (FR-{PRD}-{NNN}), non_functional | P0=MVP must, P1=should, P2=nice; NFR: perf/security/scale/a11y/i18n/compliance |
| 5. Acceptance | Given-When-Then format | One behavior per AC, testable, no subjective words, include edge cases |
| 6. Risks | assumptions, risks, dependencies | assumption→if_wrong→validation; risk→likelihood×impact→mitigation→owner |
| 7. Validation | before/during/after build; kill_criteria; release_criteria | Kill: e.g. "30d post-launch, metric <10% lift" |
| 8. Appendix | glossary, change_log, references | — |

## Problem Statement Must-Avoid
- Smuggling solutions into problem description
- Assuming problem exists without evidence
- Overly broad problem framing

## PRD Downstream Consumption

| Consumer | Reads | Enforcement |
|----------|-------|-------------|
| Design | user_journey, goals, requirements, NFR.accessibility | MANDATORY |
| Implement | requirements, AC, NFR, dependencies | MANDATORY |
| Test | AC, NFR, goals | MANDATORY (1 AC = 1+ test) |
| Review | goals, non_goals, AC | MANDATORY |

## Minimum Viable PRD

Use when: feature improvement, <2wk dev, low risk, easily reversible.
Required: metadata, problem_statement (1-2 para), 1 goal+metric, ≥2 non_goals, P0 requirements+AC, success_criteria.

## PRD Quality Checklist

- Problem user-centric with evidence? No solution smuggling?
- Goals AND Non-goals clear? MVP scope minimized?
- Every FR has ID + priority + AC? ACs testable (Given-When-Then)?
- Metrics SMART with baseline+target? Measurement method defined?
- Assumptions + risks documented with mitigations?
- Downstream teams (design/eng/QA) can work from this?

## User Story Format

Standard: `As a [role], I want [goal], so that [benefit]`
Enhanced: + AC (Given-When-Then) + Priority + Story Points (1/2/3/5/8)
Hierarchy: Epic → Feature → User Story → Task
Quality: INVEST (Independent, Negotiable, Valuable, Estimable, Small, Testable)

## Templates
- `~/.claude/templates/prd-full.md`
- `~/.claude/templates/prd-minimal.md`
- `~/.claude/templates/user-story.md`
