---
id: KN-578
type: knowledge
role: knowledge
title: "A gate that refuses a spec overturning an accepted ADR decision while the ADR stays unchanged"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: [adr, gate, baseline]
links:
  - {id: ADR-045, type: relates-to}
---
## Requirement (user, session e25636da, 2026-10-11)

The user rule "new technology: update the ADR before the plan" was deleted from user-07, because prose without a mechanism does not bind. What it protected still matters. If a spec or plan overturns an accepted ADR decision and the ADR is left unchanged, the corpus states the opposite of the code. This item asks for a MECHANISM that refuses that state.

## Why "detect contradiction" is the wrong oracle

Whether a spec contradicts an ADR is semantic. An AI judge can flag it, but only as advisory (deterministic-zone rule). We need a deterministic proxy that the corpus already produces when a decision is overturned.

## Measured trace from the first real overturn (2026-10-11)

Overturning decision 6 of `adr-run-identity-is-issued-by-lore-and-attested-by-the-harness` left these mechanical traces:

1. Baseline rules describing the old behaviour were deprecated: BR-1018, BR-1022, BR-1033. They were retired on landing.
2. New rules were added, BR-1055 to BR-1059, and cited by the new spec's ACs.
3. A new ADR was linked `relates-to` the old one, and the old ADR's decision 6 was annotated SUPERSEDED (manual, prose).

## Candidate mechanisms

- **(A) Rule-lifecycle gate, at spec-promote.**
  - A spec whose criteria cite a rule that is deprecated or retired is refused.
  - A spec that is the reason a rule moved to deprecated must link an ACCEPTED ADR that names the change.
  - Today the "reason" link does not exist. `lore rule set --lifecycle deprecated` takes no note or successor (issue #160).
  - Fix #160 first by adding `--superseded-by <BR-n>` and `--because <adr-slug>`. Then the gate checks that the cited ADR is accepted.
- **(B) Decision-addressable ADRs.**
  - ADR decisions get ids (ADR-slug#D6), like AC ids.
  - A spec declares `overturns: [adr#D6]`. spec-promote refuses unless that decision is marked superseded by an accepted ADR.
  - A spec that does not declare it but deprecates a rule the ADR decision is anchored to is refused.
  - This needs decision ids and decision-to-rule anchors: more schema, stronger addressability (North Star property 3).
- **(C) AI-judge advisory only.** The spec review prompt is shown the accepted ADRs linked to the touched rules and asked to flag contradictions. It is cheap, but by design it never refuses.

## Recommendation (pending user)

A now (it reuses #160 and the existing rule lifecycle), then B once the score-gated autonomy decision log exists. C as a complement.

## Open decisions for the user

- D1: Is a rule-lifecycle proxy acceptable as the definition of "overturns an ADR"?
- D2: Should ADR decisions become individually addressable (B)?
