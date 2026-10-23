---
id: PLAN-218
type: plan
role: plan
title: "Baseline coverage: refuse only undeclared commands, strip site-map excuses"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: [baseline, coverage]
parent: SPEC-218
phases:
  - {name: "P1-code", description: "Coverage outcome and floor, rule-only write path, retired guards, strip and count scripts"}
  - {name: "P2-corpus", description: "Run the strip script after P1 lands, retire other specs' criteria on retired rules, verify, apply the rule change set"}
---
# Baseline coverage: refuse only undeclared commands, strip site-map excuses

## Goal

Implement `spec-baseline-coverage-refuses-only-undeclared-commands-a-site` (ADR `adr-a-structural-gate-refuses-only-what-an-excuse-cannot`): the merge floor refuses only undeclared commands without running the site census; coverage reports sites; `site_map` holds BR-n only; excuse entries are stripped from the corpus.

## Phases

- **P1 code**: T1 coverage outcome and floor (AC-BCG-1, AC-BCG-2); T2 rule-only write path, retired guards, owned-by removal (AC-BCG-3, AC-BCG-5, AC-BCG-6), blocked by T1 (both edit `leaf-coverage.ts`); T3 strip and count scripts (AC-BCG-4), parallel with T1.
- **P2 corpus**: right after P1 lands: run the strip script, verify AC-BCG-7; retire or reword the criteria of other specs that cite retired rules; re-review and approve those specs; `lore verify`; `lore rule apply`; replan `plan-baseline-completeness-restoration-every-verb-declared-0` P1 and P5; close the census-excuse drafts.

## Risks

- The corpus is branchless: the strip script must not run before T1 and T2 land on main (main's old floor would refuse every merge).
- `lore rule apply` needs an attested pass on every criterion citing a changed rule, including criteria on other specs.
