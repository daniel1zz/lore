---
id: SPEC-264
type: spec
role: spec
title: "Decision records cover code-anchor removal and keep exemption decisions"
status: approved
priority: medium
created: 2026-10-28
updated: 2026-10-28
tags: []
links:
  - {id: SPEC-258, type: relates-to}
---
# Decision records cover code-anchor removal and keep exemption decisions

## Overview/Goal

`spec-a-decision-carrying-write-records-its-decision-on-its` (DR, landed 2026-10-28) stores an agent's decision on the version row of each decision-carrying write and re-checks it at the milestone. Two gaps were found after it landed:

- #483: `lore anchor rm` on a non-draft spec or knowledge document removes a code anchor, and with it the drift check for that file, yet carries no decision. DR's scope table neither lists nor excludes the anchor verbs.
- #481: `lore ac exempt` requires a decision and then discards it (`ac-exemption-service.ts`: "validated, not kept"), because an exemption is a row in the exemption table and creates no version row. The milestone re-check and `lore decision rates` therefore never see it.

Goal: every decision an agent is required to give is stored where the milestone re-check and the rates read it, and the scope names every write that carries one.

Relates to: DR (this spec extends its scope; DR is locked), `adr-an-agent-s-decision-between-milestones-is-a-record-gates`.

## Scope

- **`lore anchor rm`** on a spec or knowledge document that is not a draft, made by an agent run, is decision-carrying: without a reason, an S..C premise and an alternative it is refused with exit 4 and nothing is removed; the decision is stored on the version row the removal creates (the `code_anchors` write already creates one).
- **`lore anchor add`** is not decision-carrying: it only adds checking and is the routine close-out step after a landing. Named here so the scope leaves no verb open.
- **`lore ac exempt`**: the exemption row gains a nullable `decision` column (the next store migration), and an agent's grant stores the judged decision there. The milestone re-check selects exemption decisions by the same rules as version-row decisions (the plan's spec, or a claim run within its window) and checks them the same way; `lore decision rates` counts them.

Out: changing what the gate requires; human-party writes (exempt, as in DR).

## Design Decisions

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| D1 | Anchor verbs | gate `anchor rm`, not `anchor add` | gate both; gate neither | removal switches off a check, so it is a substantive change; adding is routine after every landing and only adds checking |
| D2 | Exemption decisions | stored on the exemption row and read by the re-check and rates | drop `ac exempt` from the gated writes; write a spec version row for each exemption | dropping it leaves a gate-bypassing decision unrecorded; a version row per exemption would rewrite the spec for a table change |

## Acceptance Criteria

Declared with `lore ac add` (AC-DX-1, AC-DX-2).

## Structure

```
packages/lore/src/service/{anchor or task-workflow}-service.ts, packages/lore/src/adapters/cli/commands/anchor.ts   (anchor rm gate)
packages/lore/src/store/migrations/migration-<next>.ts, exemption store paths                                    (exemption decision column)
packages/lore/src/service/ac-exemption-service.ts, decision-recheck.ts, decision-outcome-service.ts              (store, re-check, rates)
```


## Acceptance Criteria (structured)

- [⚑] [script] AC-DX-1: An agent's lore anchor rm on an approved spec and on an approved knowledge document, with reason, a tier S..C premise or an alternative missing, exits exactly 4 naming each missing part and leaves the anchor; with a complete decision the anchor is removed and the decision is on the version row the removal created; on a draft spec, as a human party, and for lore anchor add, no decision is needed.
  script: test — bun run test:file packages/lore/tests/integration/cli/anchor-rm-decision.bun.test.ts -t 'AC-DX-1' && echo 'AC-DX-1 PASS: anchor removal on a non-draft document carries a decision'
- [⚑] [script] AC-DX-2: After the store migration, an agent's lore ac exempt with a complete decision stores it on the exemption row (older rows read null); the milestone re-check selects it for the plan whose spec it exempts and reports a wrong-when-written file premise on it; lore decision rates counts it among the decisions passed.
  script: test — bun run test:file packages/lore/tests/integration/cli/exemption-decision.bun.test.ts -t 'AC-DX-2' && echo 'AC-DX-2 PASS: exemption decisions are kept, re-checked and counted'
