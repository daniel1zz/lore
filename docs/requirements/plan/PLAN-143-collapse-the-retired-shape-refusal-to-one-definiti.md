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

⛔ Behaviour is ALREADY CORRECT on all three surfaces — MCP refuses all three shapes today.
This plan removes a duplication that no oracle would have caught diverging.

⛔ CORRECTION (measured after this baseline was written, and after `lore assess` flagged the
contradiction): the clause originally read "and its retired message is byte-identical to the
classifier's". That was FALSE. `git show <pre-fix>:...` on both files:

- `report-issue-wiring.ts` -> `... to file/list issue reports via GitHub.`
- `adapters/mcp/tools.ts`  -> `... to file issue reports via GitHub.`  (no `/list`)

The copies had ALREADY DRIFTED and nothing noticed, for exactly as long as the copy existed.
The false claim came from grepping only the SHARED substring, finding it in both, and reading
that as equality — a partial comparison is not an equality check. This makes the plan's purpose
stronger, not weaker: it was not preventing a hypothetical future drift, it was closing a live
one. ⛔ assess was right to flag that the shipped docstring contradicted this table; the
docstring was correct and the table was wrong.

## Sequencing

P1 → P2 strictly: P2's ACs name the probe file P1 creates. Anchors do not intersect (P1 owns
two test files, P2 owns two source files).
