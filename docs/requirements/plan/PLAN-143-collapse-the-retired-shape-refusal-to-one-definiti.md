---
id: PLAN-143
type: plan
role: plan
title: "Collapse the retired-shape refusal to one definition and strengthen the exit-code-only green control"
status: archived
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: [ssot, mcp, oracle-design]
parent: SPEC-149
phases:
  - {name: "P1: Red"}
  - {name: "P2: Fix"}
---
## Goal

Collapse the retired-shape refusal message to ONE definition consumed by every surface, and
strengthen the green control that a single exit-code assertion left weak. Governing spec:
`spec-the-retired-shape-refusal-message-has-two-byte-identical` (AC-MS-1 … AC-MS-4).

## Phases

**P1 Red** — author `packages/lore/tests/unit/adapters/mcp-issue-shape-message-ssot.test.ts`
(describes for AC-MS-2 and AC-MS-3), and add the missing stderr-substring assertion to the
existing AC-IS-2 case in `issues-upstream-shape-refusal.bun.test.ts` (AC-MS-4a). Record the
red with `lore evidence --result expected-fail` at the moment it is red.

**P2 Fix** — export `buildRetiredFeedbackUpstreamError` from `report-issue-wiring.ts` and make
`adapters/mcp/tools.ts` consume it instead of restating the message. Keep the lazy
`await import()` (it exists to keep `gh-runner`/`github-intake-port` out of every `tools.ts`
consumer's vitest graph — an unrelated, still-valid reason).

## Measured baseline (2026-08-24, HEAD 063d07c1)

Every AC's oracle was executed against HEAD before this plan was written.

| AC | probe | at HEAD | required |
|---|---|---|---|
| AC-MS-1 | source files outside `report-issue-wiring.ts` containing `configured with the retired SQLite shape` (whole-tree grep, excludes `tests/`) | **1** (`adapters/mcp/tools.ts`) | 0 |
| AC-MS-2 (a) | `export function buildRetiredFeedbackUpstreamError` in `report-issue-wiring.ts` | **absent** (module-private) | present |
| AC-MS-2 (b) | MCP retired refusal message EQUALS the exported builder's output | n/a — probe file does not exist | equal |
| AC-MS-3 | MCP unconfigured/GitHub branches asserted against named literals | n/a — probe file does not exist | pass |
| AC-MS-4 (a) STRUCTURAL | `a later phase of spec-the-defect-channel-reaches-no-machine` present in the AC-IS-2 probe file | **0** | >= 1 (P1) |
| AC-MS-4 (b) BEHAVIOURAL | that file's AC-IS-2 case still passes | **passing** at HEAD | still passing (P1) |

⛔ AC-MS-4's substring is the one spec D4 names and MEASURES as already emitted (the D4 block
quotes the exact stderr). This plan changes no behaviour, so a probe may only assert what the
message ALREADY says — an absent substring could not be made to appear here.

⛔ Behaviour is ALREADY CORRECT on all three surfaces — MCP refuses all three shapes today,
and its retired message is byte-identical to the classifier's. This plan removes a duplication
that no oracle would have caught diverging; it is not a defect fix. Do not let a report frame
it as one.

## Sequencing

P1 → P2 strictly: P2's ACs name the probe file P1 creates. Anchors do not intersect (P1 owns
two test files, P2 owns two source files).
