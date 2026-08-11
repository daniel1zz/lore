---
id: KN-320
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-101
---
# Handoff — agent:main-orchestrator

## Plan

plan-implementation-context-provenance-scope-declaring

## Task Refs

(none)

## Modified Files

- packages/core/src/session.ts
- packages/lore/src/adapters/cli/commands/governance.ts
- assets/hooks/session-start-resume.mjs
- assets/governance/corpus-workflow.md
- packages/lore/src/flows/feed-flow.ts

## Key Decisions

| Judgment | Confidence |
|---|---|
| Feature DELIVERED and attested: 7/7 live ACs green under lore verify on a clean tree at commit 17c1a44, all 5 tasks archived with runner-attested evidence, boundary declarations shipping via binary + assets SSOT.@high | — |
| Plan deliberately left OPEN, not exempted: both blocking plan-close predicates are design defects per adr-plan-close-predicates-must-measure-invariants-not-proxies. An exemption would destroy the ADR's cleanest evidence.@high | — |
| My spec authored FOUR contradictions against approved specs. All caught by implementers' scoped tests or the judge's intra-document dimensions; none by a gate or the judge's cross-document contract dimension.@high | — |

## Failing Oracle

(none)

## Next Steps

- Implement the ADR: replace attestationFloor's plan-wide ratio with per-claimed-AC attested coverage (scope to ac_refs the plan's tasks actually claim so phased plans are not false-blocked; keep condition 1 as per-task backstop; min_ratio opt-in default off, AND-ed when on, explicitly-set configs preserved). Then AND a relatedness conjunct onto prdOutlineSynced's window. Files: gate-predicates.ts, checkpoint-registry.ts, core deriveAttestationSummary.
- Then close this plan: it already satisfies per-claimed-AC coverage 7/7 and should pass with no exemption. Run lore assess LAST — every lore verify appends evidence and re-stales the assessment. If prd_sync still blocks, that is the ADR's known-open false-block class for mechanism-fix plans: prd_sync_exempt with a reason citing the ADR.
- Three unrelated mechanism defects stay open with proposals in knowledge-gates-and-the-review-judge-validate-a-spec-against (8 findings): no gate dereferences a spec's 'extends X' claim against X's text; ACs have no supersede path (3 dangling ac_refs here are deliberate loud breaks); test:changed defaults to merge-base main HEAD, wrong in this feature-branch repo.
