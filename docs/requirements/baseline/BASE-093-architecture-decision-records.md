---
id: BASE-093
type: baseline
role: intent
title: "Architecture: decision records"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-095
links:
  - {id: SPEC-093, type: supersedes}
---
# Architecture decision records

Index of the 43 corpus ADRs (`lore list --type adr`, 2026-10-10). The ADR documents are the source; this list only groups them. Read one with `lore get <slug>`.

## Product shape and corpus model
- adr-the-product-is-a-baseline-tree-specs-are-implementations
- adr-an-acceptance-criterion-is-placed-by-the-business-outcome
- adr-spec-kind-as-a-field-on-spec-taxonomy-option-c-not-a-first
- adr-ac-as-code-oracle (proposed)
- adr-corpus-governed-active-ai-workflow-inversion-of-control-with
- adr-a-tracker-is-replaceable-a-corpus-is-not-github-is-the
- adr-answers-to-the-three-blocking-questions-on-the-2026-07-28
- adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan

## Gates, evidence and verification
- adr-lore-verify-s-attested-evidence-scope-belongs-to-the-task
- adr-lore-done-requires-a-runner-attested-pass-the-sixth-false
- adr-lore-evidence-proves-a-filtered-pass-with-the-runner-s-own (draft)
- adr-falsifiability-moves-from-the-task-tier-to-the-oracle-tier
- adr-a-falsifier-s-scratch-worktree-gets-dependencies-by-hybrid
- adr-plan-close-predicates-must-measure-invariants-not-proxies
- adr-a-newly-armed-structural-oracle-enforces-from-a-baseline
- adr-a-guard-does-not-exist-until-it-runs-against-the-real-tree (draft, proposed)
- adr-a-gate-premised-on-the-agent-s-judgment-being-untrustworthy
- adr-the-coverage-floor-s-mcp-arming-compares-the-tool-name-s
- adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the
- adr-a-record-with-no-state-stamp-is-acceptable-but-never-green (proposed)
- adr-verdict-staleness-is-measured-by-blast-radius-never-by-git (proposed)

## Review and judgment
- adr-an-escalate-gates-every-doc-type-a-reject-stays-scoped-to
- adr-judge-flakiness-keep-d5-unchanged-explicit-human-dismissal
- adr-design-and-planning-governance-is-batched-one-interview-one (draft)
- adr-governance-document-conflict-exposure-is-deferred-read (proposed)

## Sessions and concurrency
- adr-multi-session-coordination-is-decentralised-file-locks-plus

## Context and memory files
- adr-context-capability-is-a-first-class-lore-verb-family-init (proposed)
- adr-claude-md-root-h2-structure-is-deterministic-with-one
- adr-claude-md-carries-only-standing-discipline-histories-archive
- adr-claude-md-specs-section-is-pointer-only-per-spec-index
- adr-a-claude-md-standing-lesson-is-evicted-when-a-deterministic

## Distribution and configuration
- adr-distribution-first-every-improvement-names-its-consumer (draft)
- adr-retire-lore-planner-agent-vendor-upstream-workflow-skills-in
- adr-the-vendor-intake-address-ships-in-the-binary-config
- adr-ci-cd-is-the-consuming-team-s-own-infrastructure-not-a-lore
- adr-loreconfig-carriage-for-mcp-tools-getter-param-now-app (proposed)
- adr-product-skill-chain-derive-features-via-ost-execute-graded (draft)
- adr-verification-skill-family-routed-convergence-shared-failure

## Dashboard
- adr-dashboard-positioned-as-general-admin-console-owner
- adr-dashboard-review-queues-include-in-review-docs-ahead-of
- adr-dashboard-cookie-session-writes-attribute-author-via
- adr-newdocmodal-spec-create-cli-skill-only-authoring-disable
- adr-planphasestatus-projects-declared-extra-phases-alongside

Status in parentheses where the doc is not approved or the decision is not accepted; the live value is whatever `lore get` shows.
