---
id: TASK-1616
type: task
role: plan
title: "D2 every retained check records its outcome; lore checks stats with removal candidates and escaped-defect quality"
status: archived
priority: medium
phase: "D"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
links:
  - {id: TASK-1614, type: blocks}
---
Spec: spec-lean-governance-batch-verbs-judgment-only-at-milestones (read Parts and the AC statements; they are the contract). ADR: adr-ai-decision-standard-four-checks-references-from-excellent. Delete-by-default: remove code, tests and docs that only served the removed behaviour; no compat shim, no flag to bring it back. Update every comment and module CLAUDE.md line naming the old behaviour. Reference: LaunchDarkly stale-flag insights; ESLint --report-unused-disable-directives. Hooks record outcomes through one lore call they already make, or append to a local file lore ingests; never a new process per hook run. Escaped defects: issues (GitHub, via the existing issue reader) filed within 14 days of plan close citing the plan or one of its tasks.

 Also remove the 1-in-10 human sampling audit (packages/lore/src/service/autonomy-calibration-service.ts:22,52) and its pending audit queue; quality ground truth = escaped defects (AC-LG-14 corrected).
