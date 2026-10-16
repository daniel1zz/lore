---
id: KN-677
type: knowledge
role: knowledge
title: "Assessment: Shipped skill descriptions state when to use the skill (2026-10-15)"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-184
links:
  - {id: PLAN-184, type: informs}
---
# Assessment: met (87/100)

Scope: plan `01M4ZTQ4VWMBXQ2F440P62R8A4`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-SD-1 | 92 | checkOpening runs over every assets/skills dir that has a SKILL.md, after stripping the Args suffix. The scan asserts at least 40 skills. Attested pass [4] follows a red run [1]. Visible rewrites all open with 'Use when'. | 01M4ZTQ9MDATVN6BYPMP5FPYYQ (evidence [1],[4]) |
| AC-SD-2 | 91 | checkLength caps the core at 500 chars. Boundary cases 500/501 and an Args-suffixed 500-char core are covered in 6b. Attested pass [5]. Long tails were moved into 'Also use when' body sections. | 01M4ZTQ9MDATVN6BYPMP5FPYYQ (evidence [5]) |
| AC-SD-3 | 88 | referencedSkills collects 'use X' targets, /slash names and lore-* tokens, then checks them against the shipped directories. Unshipped names (frontend-design, ui-ux-pro-max, review/diagnose) were removed. Attested pass [6]. The stopword list is heuristic. | 01M4ZTQ9MDATVN6BYPMP5FPYYQ (evidence [6]) |
| AC-SD-4 | 88 | Quoted phrases are trimmed, lowercased and must contain a letter; collisions are counted across skills. Visible overlaps were resolved ('new project' kept only in kickoff, '业务规则' only in baseline). Attested pass [7]. The apostrophe-handling parser is heuristic but has a test. | 01M4ZTQ9MDATVN6BYPMP5FPYYQ (evidence [7]) |
| AC-SD-5 | 88 | All 8 pairs are checked in both directions. The visible diffs name each other. lore-refactor and lore-project-bootstrap are truncated, so their side rests on the attested pass [8]. | 01M4ZTQ9MDATVN6BYPMP5FPYYQ (evidence [8]) |
| AC-SD-6 | 93 | All four negative controls run through the same checker functions as the real scan, each with a positive counterpart. Attested pass [9]: 4 tests passed. | 01M4ZTQ9MDATVN6BYPMP5FPYYQ (evidence [9]) |
| AC-SD-7 | 80 | The repo copy's description equals the asset copy's (visible in the diff), and there is an attested pass [10]. The guide check is weak: 'Use when' anywhere in the body plus a /500[- ]char/ regex. The lore-write-a-skill diff is not shown. | 01M4ZTQ9MDATVN6BYPMP5FPYYQ (evidence [10]) |

## Gaps

- Trigger phrases such as 'init tools' and 'what bugs are hiding' were moved from descriptions into body sections of assets/skills/lore-auto-wire/SKILL.md and assets/skills/lore-bug-hunt/SKILL.md. Agents see only the description when selecting a skill, so these phrases may no longer route to it.
- packages/lore/src/generated/assets-manifest.ts was regenerated, but evidence covers only two test files and the typecheck. No full-suite or manifest-consistency run is recorded.
- packages/lore/tests/unit/assets/skill-description-trigger-contract.test.ts checks the guide with toContain('Use when') and /500[- ]char/, which would pass on incidental mentions.

## Recommendations

- Run the full lore unit suite after manifest regeneration and attach it as evidence.
- Require AC-SD-7 to match a specific normative sentence in lore-write-a-skill.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 34274ms
- Retried: false
- Truncated sections: diff:assets/skills/lore-product/SKILL.md, diff:assets/skills/lore-project-bootstrap/SKILL.md, diff:assets/skills/lore-prototype/SKILL.md, diff:assets/skills/lore-refactor/SKILL.md, diff:assets/skills/lore-review/SKILL.md, diff:assets/skills/lore-session-capture/SKILL.md, diff:assets/skills/lore-session-review/SKILL.md, diff:assets/skills/lore-tdd/SKILL.md, diff:assets/skills/lore-test/SKILL.md, diff:assets/skills/lore-to-issues/SKILL.md, diff:assets/skills/lore-triage/SKILL.md, diff:assets/skills/lore-uat/SKILL.md, diff:assets/skills/lore-write-a-skill/SKILL.md, diff:assets/skills/lore/SKILL.md

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.75 | evidence | All 7 ACs pass under a contract test that is not vacuous. The visible rewrites meet the standard. Some trigger recall moved into skill bodies. |
| evidence_integrity | 87 | 0.8 | evidence | Red run first, then attested per-AC passes and a typecheck. Negative controls share code with the real checks. No full-suite run. |
| scope_fidelity | 90 | 0.75 | evidence | Changes are limited to skill descriptions, the repo copy, the manifest and the new test. The 'Also use when' body additions are a reasonable side effect. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | — | Trigger phrases such as 'init tools' and 'what bugs are hiding' were moved from descriptions into body sections of assets/skills/lore-auto-wire/SKILL.md and assets/skills/lore-bug-hunt/SKILL.md. Agents see only the description when selecting a skill, so these phrases may no longer route to it. |
| evidence_integrity | minor | — | packages/lore/src/generated/assets-manifest.ts was regenerated, but evidence covers only two test files and the typecheck. No full-suite or manifest-consistency run is recorded. |
| outcome | minor | AC-SD-7 | packages/lore/tests/unit/assets/skill-description-trigger-contract.test.ts checks the guide with toContain('Use when') and /500[- ]char/, which would pass on incidental mentions. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Run the full lore unit suite after manifest regeneration and attach it as evidence. | A digest change can break other tests that are not covered here. |
| spec | Require AC-SD-7 to match a specific normative sentence in lore-write-a-skill. | The current check is satisfiable by incidental text. |

## Unverifiable Materials

- Diffs for 14 truncated skill files (e.g. lore-refactor, lore-project-bootstrap, lore-write-a-skill): Their conformance rests on the attested test passes alone.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.90
