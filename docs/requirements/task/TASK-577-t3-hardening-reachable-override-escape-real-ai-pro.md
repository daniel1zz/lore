---
id: TASK-577
type: task
role: plan
title: "T3 hardening: reachable override escape, real ai_provenance tuple, atomic re-fast-track check"
status: archived
priority: medium
phase: "P3-hardening"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-109
plan: PLAN-109
---
Three findings from the diff-backed SPEC-103 assessment (knowledge-assessment-implementation-tiered-review-spec-103-202-2), two confirmed by source reading. (1) DEFECT — --override-judgment is unreachable for the most common denial: review-service.ts requires the passed id to resolve to an existing judgment ON THE DOC, but the NO_JUDGMENT denial means zero judgments exist, so there is no id to supply. SPEC-103 M2 names this flag as unlock path (b); make it cover the zero-judgment case (optional id / documented sentinel) while STILL writing an audit row that records exactly what was overridden, and add an AC-TIER-5 sub-case proving the zero-judgment override path. (2) HONESTY GAP — AIProviderService.generate stamps ai_provenance as {provider: this.active, model: this.active, prompt_version: 'v1'}: model is the provider name and the version is a hardcoded placeholder, so I1's collision tuple carries no real model/prompt discrimination (the whole reason ai_provenance was introduced). Source model from the provider's actual model id where the provider exposes one, and add a real prompt-version registry for BUILT_IN_TEMPLATES mirroring the existing ASSESS_PROMPT_VERSION/REVIEW_PROMPT_VERSION precedent that the current JSDoc itself names as the missing piece. If a real model id is genuinely unavailable for a provider, fail loud in the tuple rather than substituting the provider name, and report it. (3) VERIFY FIRST — the assessment calls the ledger re-fast-track non-transactional (SPEC-103 D4 says atomic). Read corpus-service.ts and determine whether reset and re-fast-track share one transaction/CAS write; if they already do, report that and change nothing; if they do not, make them atomic or state the intended semantics in the spec-facing comment.
