---
id: SPEC-159
type: spec
role: spec
title: "The review judge reads the document as stored, including its structured parts"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
---
# The review judge reads the document as stored, including its structured parts

Issue #107 (and the open sibling where plan review feeds the parent spec's body but not its structured ACs). Rule BR-960 (baseline-judge-a-document).

## Problem
`lore review` builds the AI judge's input from `content` (and the parent's body). Documents whose substance lives in structured `extra` are judged as if it were absent: every baseline leaf escalates with "the leaf has no Rules section" (measured 2026-10-10 on baseline-cite-a-baseline-rule, 19 rules in extra.rules), and `lore approve` then refuses. All 121 baseline nodes are draft.

## Design
- One pure function renders a document's structured parts as fenced data for the judge, per type: baseline -> node kind, label, rules (id, statement, confidence, lifecycle, enforced_by, examples), glossary, depends_on, declared commands; spec -> acceptance_criteria (id, statement, verify mode/oracle/command, cites); plan's parent spec -> its acceptance_criteria too.
- The rendered block is appended to the judge input under a clear heading and treated as data. Size: rules are never truncated silently; if a cap applies, the input states how many were omitted.
- Mechanical pre-checks unchanged.

## Non-goals
Changing verdict semantics, approval gates, or the judge prompt version policy beyond what the new input requires.

## Acceptance criteria
See `lore ac list` (AC-RJI-1).


## Acceptance Criteria (structured)

- [⚑] [script] AC-RJI-1: With a stub judge that records its input (describe 'review judge sees structured parts (#107)'): reviewing a baseline leaf puts every rule id and statement, the glossary terms and depends_on ids in the judge input; reviewing a plan puts every acceptance criterion id and statement of its parent spec in the input, including one added after the spec body was written; a criterion or rule omitted by a size cap is counted in the input, never silently dropped
  script: test — bunx vitest run packages/lore/tests/unit/service/review-judge-structured-input.test.ts && echo 'AC-RJI-1 PASS: judge input carries baseline rules/glossary/depends_on and the parent spec criteria'

## Code anchors

- packages/lore/src/ai/review-template.ts
