---
id: TASK-2041
type: task
role: plan
title: "R2 judge-text fingerprints use structured cites, never wording"
status: archived
priority: medium
phase: "R"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-270
plan: PLAN-270
---
Resolves #405.

For judge-text dimensions (spec_conformance, correctness_vs_acs, concurrency_safety, any non-measured dimension) root-cause-fingerprint.ts mixes the finding's normalised free-text summary into the fingerprint, so each re-review words the same defect differently and opens a new issue (live: #375, #391, #395, #399 are one defect; AS-17 in #368, #378, #384).

- The fingerprint of a judge-text finding uses structured, stable cites only: AC ids, rule ids, file paths and symbols the finding names (extracted from the stored review's structured fields; if the judge output has no structured cite fields, add them to the review output schema and the judge prompt so each failed finding names its cites).
- A finding with no cite at all is a review error for that plan (recorded, retried), never a free-text fingerprint.
- Measured dimensions (regression: suite failing set; snapshot_accuracy: contradicted rule ids) are unchanged.
- The title keeps the original summary.

Tests: two findings with different wording but the same cites share one fingerprint and file one issue; different cites → different fingerprints; a finding with no cites yields the review error.
