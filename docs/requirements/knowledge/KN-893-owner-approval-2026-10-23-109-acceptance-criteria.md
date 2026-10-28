---
id: KN-893
type: knowledge
role: knowledge
title: "Owner approval 2026-10-23: 109 acceptance criteria retired with the features they described"
status: draft
priority: medium
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: ADR-058
---
# Owner approval 2026-10-23: 109 acceptance criteria retired with the features they described

The owner approved these in-session, by group, on 2026-10-23, after a side review noted that they had been retired without the owner approval the decision standard (adr-ai-decision-standard-four-checks-references-from-excellent, check 1) requires.

- Group 1, 69 ACs: the plan-close checks removed by D1.
- Group 2, 17 ACs: the handoff-coverage hook and command, and the duplicate CLAUDE.md budget checks.
- Group 3, 23 ACs: the approve judgment outside spec and ADR, override escalation and the sampling audit, and the test-timeout budget check.

All three groups were approved.

## Superseded ACs (59)

Each line gives the spec, the AC and what supersedes it.

- spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b AC-ACODE-4 → AC-LG-12
- spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b AC-ACODE-5 → AC-LG-12
- spec-spec-039-trusted-runner-attested-evidence-for-script-mode-a AC-VRF-9 → AC-LG-12
- spec-spec-067-ai-surface-robustness-assess-timeout-floor-partial AC-067-4 → AC-LG-12
- spec-spec-067-ai-surface-robustness-assess-timeout-floor-partial AC-067-5 → AC-LG-12
- spec-spec-067-ai-surface-robustness-assess-timeout-floor-partial AC-067-6 → AC-LG-12
- spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann AC-069-1 → AC-LG-12
- spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann AC-069-2 → AC-LG-12
- spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann AC-069-3 → AC-LG-12
- spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann AC-069-4 → AC-LG-12
- spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann AC-069-8 → AC-LG-12
- spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann AC-069-9 → AC-LG-12
- spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann AC-069-10 → AC-LG-12
- spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann AC-069-11 → AC-LG-12
- spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann AC-069-12 → AC-LG-12
- spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann AC-069-13 → AC-LG-12
- spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann AC-069-14 → AC-LG-12
- spec-project-claude-md-content-contract-governance-injected AC-CMC-3 → AC-LG-7
- spec-context-verb-family-two-zone-claude-md-anatomy-lore AC-CTX-5 → AC-LG-7
- spec-verify-reachability-plan-promote-early-warning AC-VRW-2 → AC-LG-12
- spec-verify-reachability-plan-promote-early-warning AC-VRW-3 → AC-LG-12
- spec-plan-closure-must-be-loud-terminality-divergence-silent AC-CLOSURE-6 → AC-LG-12
- spec-plan-close-predicates-measure-invariants-an-applicability AC-PCI-1 → AC-LG-12
- spec-plan-close-predicates-measure-invariants-an-applicability AC-PCI-2 → AC-LG-12
- spec-plan-close-predicates-measure-invariants-an-applicability AC-PCI-3 → AC-LG-12
- spec-plan-close-predicates-measure-invariants-an-applicability AC-PCI-4 → AC-LG-12
- spec-plan-close-predicates-measure-invariants-an-applicability AC-PCI-7 → AC-LG-12
- spec-plan-close-predicates-measure-invariants-an-applicability AC-PCI-8 → AC-LG-12
- spec-plan-close-predicates-measure-invariants-an-applicability AC-PCI-10 → AC-LG-12
- spec-plan-close-predicates-measure-invariants-an-applicability AC-PCI-9 → AC-LG-12
- spec-plan-close-predicates-measure-invariants-an-applicability AC-PCI-17 → AC-LG-12
- spec-plan-close-predicates-measure-invariants-an-applicability AC-PCI-18 → AC-LG-12
- spec-plan-close-predicates-measure-invariants-an-applicability AC-PCI-19 → AC-LG-12
- spec-plan-close-predicates-measure-invariants-an-applicability AC-PCI-20 → AC-LG-12
- spec-resume-ticket-coverage-a-shipped-upper-bound-left-the AC-RC-7 → AC-LG-7
- spec-resume-ticket-coverage-a-shipped-upper-bound-left-the AC-RC-9 → AC-LG-7
- spec-resume-ticket-coverage-a-shipped-upper-bound-left-the AC-RC-10 → AC-LG-7
- spec-resume-ticket-coverage-a-shipped-upper-bound-left-the AC-RC-12 → AC-LG-7
- spec-declared-scope-attestation-contract-task-owned-ac-scope AC-VS-8 → AC-LG-12
- spec-declared-scope-attestation-contract-task-owned-ac-scope AC-VS-7 → AC-LG-12
- spec-an-escalate-blocks-approval-for-every-doc-type-and-the AC-ESC-1 → AC-LG-6
- spec-an-escalate-blocks-approval-for-every-doc-type-and-the AC-ESC-2 → AC-LG-6
- spec-an-escalate-blocks-approval-for-every-doc-type-and-the AC-ESC-3 → AC-LG-6
- spec-an-escalate-blocks-approval-for-every-doc-type-and-the AC-ESC-4 → AC-LG-6
- spec-an-escalate-blocks-approval-for-every-doc-type-and-the AC-ESC-5 → AC-LG-6
- spec-an-escalate-blocks-approval-for-every-doc-type-and-the AC-ESC-7 → AC-LG-6
- spec-an-escalate-blocks-approval-for-every-doc-type-and-the AC-ESC-8 → AC-LG-6
- spec-an-escalate-blocks-approval-for-every-doc-type-and-the AC-ESC-9 → AC-LG-6
- spec-resume-ticket-coverage-floor-blocking-channel-arming AC-RCH-1 → AC-LG-7
- spec-resume-ticket-coverage-floor-blocking-channel-arming AC-RCH-2 → AC-LG-7
- spec-resume-ticket-coverage-floor-blocking-channel-arming AC-RCH-3 → AC-LG-7
- spec-resume-ticket-coverage-floor-blocking-channel-arming AC-RCH-4 → AC-LG-7
- spec-resume-ticket-coverage-floor-blocking-channel-arming AC-RCH-5 → AC-LG-7
- spec-resume-ticket-coverage-floor-blocking-channel-arming AC-RCH-6 → AC-LG-7
- spec-resume-ticket-coverage-floor-blocking-channel-arming AC-RCH-8 → AC-LG-7
- spec-governance-visibility-an-armed-gate-that-vacuously-passes AC-GV-1 → AC-LG-12
- spec-governance-visibility-an-armed-gate-that-vacuously-passes AC-GV-6 → AC-LG-12
- spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-7 → AC-LG-8
- spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-10 → AC-LG-14

## Deprecated specs (7, with 50 ACs between them)

- spec-lore-assess-ai-plan-outcome-assessment-llm-as-judge-feedbac (2 ACs)
- spec-spec-040-assessment-dimension-framework-v2-facts-judgment-s (14 ACs)
- spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review (7 ACs)
- spec-assessment-freshness-plan-close-denies-a-stale-assessment (5 ACs)
- spec-a-test-case-s-timeout-budget-must-be-declared-when-its (6 ACs)
- spec-resume-coverage-floor-the-satisfaction-boundaries-a (4 ACs)
- spec-lore-assess-project-evidence-rows-instead-of-embedding-the (12 ACs)
