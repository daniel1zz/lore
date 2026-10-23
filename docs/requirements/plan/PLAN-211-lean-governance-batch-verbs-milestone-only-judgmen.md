---
id: PLAN-211
type: plan
role: plan
title: "Lean governance: batch verbs, milestone-only judgment, lean context"
status: approved
priority: critical
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: SPEC-233
phases:
  - {name: "A", description: "Batch verbs"}
  - {name: "B", description: "Judgment off the small steps"}
  - {name: "C", description: "Lean context"}
  - {name: "D", description: "Milestone review and self-measurement"}
  - {name: "E", description: "Corpus cleanup with the batch verbs"}
  - {name: "G", description: "Main green"}
---
# Lean governance

## Goal

Land `spec-lean-governance-batch-verbs-judgment-only-at-milestones`: batch verbs, judgment only at milestones, lean context, and a milestone review with self-measurement. Then use the batch verbs to clear the stale corpus in one pass.

## Preconditions

- The spec is approved (v33). The ADR `adr-ai-decision-standard-four-checks-references-from-excellent` is accepted.
- Tasks in the same phase have disjoint anchors and run in parallel worktrees.
- The store migrations are serialised: the read counter (B5) lands before the check-outcome table (D2).

## Tasks

- **A, batch**: A1 bulk verbs, draft→deprecated, MCP parity (AC-LG-1..4).
- **B, judgment off the small steps**:
  - B1 lean floor (AC-LG-5);
  - B2 judge only spec/adr (AC-LG-6);
  - B3 removed hooks (AC-LG-7);
  - B4 three human classes (AC-LG-8);
  - B5 read counter (AC-LG-9).
- **C, lean context**: C1 bounded handoff (AC-LG-10); C2 bounded command output (AC-LG-11).
- **D, milestone review**:
  - D1 seven-dimension review gates plan close (AC-LG-12), after B4;
  - D2 check outcomes and quality stats (AC-LG-13, 14), after B3 and B5.
- **E, corpus cleanup** (main agent, corpus only, after A1):
  - close the finished plans;
  - deprecate the history-migration tasks;
  - archive stale execution drafts;
  - close obsolete issues;
  - supersede AC-AU-7/8;
  - apply the spec's rule changes at plan close.
